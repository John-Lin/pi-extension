#!/usr/bin/env node

// Gemini place search via Google AI Studio called directly (no corporate
// gateway). Talks to the Interactions REST API (/v1beta/interactions) with
// Node's built-in fetch, so no SDK dependency is required.
//
// Credentials: GEMINI_API_KEY, or the "google" api_key entry in pi's
// ~/.pi/agent/auth.json as a fallback. Sent as the x-goog-api-key header.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const TOKEN_ENV = "GEMINI_API_KEY";
const AUTH_HEADER = "x-goog-api-key";

// Pi stores credentials in auth.json keyed by provider name. The built-in
// provider for Google AI is called "google".
const PI_AUTH_PROVIDER = "google";

const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_THINKING_LEVEL = "medium";
const DEFAULT_TIMEOUT_MS = 120000;

// Maps citations carry the source's Google Maps title, which always ends with
// this suffix and, for review sources, starts with "Review of".
const MAPS_TITLE_SUFFIX = " - Google Maps";
const REVIEW_TITLE_PREFIX = "Review of ";

function parseTimeout(raw, fallback) {
	if (raw === undefined || raw === "") return fallback;
	const ms = Number(raw);
	if (!Number.isFinite(ms)) throw new Error(`--timeout expects a number of milliseconds, got '${raw}'.`);
	return Math.max(1000, ms);
}

function parseCoordinate(raw, flag, limit) {
	const value = Number(raw);
	if (raw === undefined || raw === "" || !Number.isFinite(value)) {
		throw new Error(`${flag} expects a number, got '${raw}'.`);
	}
	if (Math.abs(value) > limit) {
		throw new Error(`${flag} must be between -${limit} and ${limit}, got ${value}.`);
	}
	return value;
}

export function parseArgs(argv) {
	const out = {
		model: undefined,
		purpose: "general place research",
		thinkingLevel: DEFAULT_THINKING_LEVEL,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		latitude: undefined,
		longitude: undefined,
		json: false,
		raw: false,
		help: false,
		query: "",
	};

	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--help" || arg === "-h") {
			out.help = true;
		} else if (arg === "--json") {
			out.json = true;
		} else if (arg === "--raw") {
			out.raw = true;
		} else if (arg === "--model") {
			out.model = argv[++i] || out.model;
		} else if (arg.startsWith("--model=")) {
			out.model = arg.slice("--model=".length) || out.model;
		} else if (arg === "--purpose") {
			out.purpose = argv[++i] || out.purpose;
		} else if (arg.startsWith("--purpose=")) {
			out.purpose = arg.slice("--purpose=".length) || out.purpose;
		} else if (arg === "--thinking") {
			out.thinkingLevel = argv[++i] || out.thinkingLevel;
		} else if (arg.startsWith("--thinking=")) {
			out.thinkingLevel = arg.slice("--thinking=".length) || out.thinkingLevel;
		} else if (arg === "--lat") {
			out.latitude = parseCoordinate(argv[++i], "--lat", 90);
		} else if (arg.startsWith("--lat=")) {
			out.latitude = parseCoordinate(arg.slice("--lat=".length), "--lat", 90);
		} else if (arg === "--lng") {
			out.longitude = parseCoordinate(argv[++i], "--lng", 180);
		} else if (arg.startsWith("--lng=")) {
			out.longitude = parseCoordinate(arg.slice("--lng=".length), "--lng", 180);
		} else if (arg === "--timeout") {
			out.timeoutMs = parseTimeout(argv[++i], out.timeoutMs);
		} else if (arg.startsWith("--timeout=")) {
			out.timeoutMs = parseTimeout(arg.slice("--timeout=".length), out.timeoutMs);
		} else {
			positional.push(arg);
		}
	}

	// The API takes the anchor point as a pair; half of one is a typo, not a
	// weaker hint.
	if (out.latitude !== undefined && out.longitude === undefined) {
		throw new Error("--lat needs a matching --lng.");
	}
	if (out.longitude !== undefined && out.latitude === undefined) {
		throw new Error("--lng needs a matching --lat.");
	}

	out.query = positional.join(" ").trim();
	return out;
}

export function usage() {
	return `Usage:
  node search.mjs "<query>" [--lat <deg> --lng <deg>] [--purpose "<why>"] [--model <id>] [--thinking <level>] [--timeout <ms>] [--json] [--raw]

Coordinates are optional: without them the model resolves place names from the
query itself, so name the area ("near Taipei Main Station") when you omit them.

Thinking level: defaults to ${DEFAULT_THINKING_LEVEL}.

Calls Google AI Studio directly. Credentials (first match wins):
  ${TOKEN_ENV}   API key, sent as the "${AUTH_HEADER}" header.
  ~/.pi/agent/auth.json "google" api_key entry (fallback).

Default model: ${DEFAULT_MODEL} (override with --model).

Examples:
  node search.mjs "coffee shops within a 10 minute walk" --lat 25.033964 --lng 121.564468
  node search.mjs "best beef noodles near Taipei Main Station" --purpose "dinner plan" --json`;
}

export function buildAuthHeaders(apiKey) {
	return { [AUTH_HEADER]: apiKey };
}

function getAgentDir() {
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (!configured) return join(homedir(), ".pi", "agent");
	if (configured === "~") return homedir();
	if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
	return configured;
}

// Pi config values may be a literal key, the name of an env var, or a
// "!command" to run for the value.
function resolveConfigValue(value, env) {
	if (typeof value !== "string" || !value) return undefined;
	if (value.startsWith("!")) {
		try {
			const out = execSync(value.slice(1), {
				encoding: "utf8",
				timeout: 10000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			return out || undefined;
		} catch {
			return undefined;
		}
	}
	return env[value] || value;
}

export function resolveApiKey(env = process.env, authPath = join(getAgentDir(), "auth.json")) {
	const fromEnv = env[TOKEN_ENV];
	if (fromEnv) {
		return { apiKey: fromEnv, source: `env:${TOKEN_ENV}` };
	}

	if (existsSync(authPath)) {
		let data;
		try {
			data = JSON.parse(readFileSync(authPath, "utf8"));
		} catch (err) {
			// A corrupt file is a different problem from a missing key; reporting it
			// as "no credentials" would send the reader off to re-authenticate for
			// nothing.
			throw new Error(`Could not parse ${authPath}: ${err?.message || err}`);
		}
		const entry = data?.[PI_AUTH_PROVIDER];
		const type = entry?.type || (entry?.key ? "api_key" : undefined);
		if (type === "api_key") {
			const key = resolveConfigValue(entry.key, env);
			if (key) return { apiKey: key, source: `auth.json:${PI_AUTH_PROVIDER}` };
		}
	}

	throw new Error(
		`No credentials found. Set ${TOKEN_ENV}, or add a '${PI_AUTH_PROVIDER}' api_key entry to ${authPath}.`,
	);
}

export function buildPrompt(query, purpose) {
	return [
		"You are a local guide. Use the google_maps tool to ground every place you",
		"mention in real Google Maps data. Never invent a place, address or rating.",
		"",
		`Find places for: ${query}`,
		"",
		`Purpose: ${purpose}`,
		"",
		"Return a concise shortlist with:",
		"- 2 to 5 places, best first",
		"- for each: name, address, and what makes it fit this purpose",
		"- opening hours, rating or price level when the tool reports them",
		"- say so explicitly when the tool returns nothing that fits, rather than guessing.",
	].join("\n");
}

export function buildRequestBody({
	model,
	query,
	purpose,
	latitude,
	longitude,
	thinkingLevel = DEFAULT_THINKING_LEVEL,
}) {
	const maps = { type: "google_maps" };
	if (latitude !== undefined && longitude !== undefined) {
		maps.latitude = latitude;
		maps.longitude = longitude;
	}
	return {
		model,
		input: buildPrompt(query, purpose),
		// Interactions API tool spec: {type:"google_maps"} (NOT the legacy
		// generateContent {googleMaps:{}}).
		tools: [maps],
		generation_config: { thinking_level: thinkingLevel },
	};
}

export function extractText(interaction) {
	if (typeof interaction?.output_text === "string" && interaction.output_text) {
		return interaction.output_text;
	}
	if (typeof interaction?.outputText === "string" && interaction.outputText) {
		return interaction.outputText;
	}
	const parts = [];
	for (const step of interaction?.steps || []) {
		if (step?.type !== "model_output") continue;
		for (const block of step.content || []) {
			if (block?.type === "text" && typeof block.text === "string") {
				parts.push(block.text);
			}
		}
	}
	return parts.join("\n\n").trim();
}

// One place is cited many times over, and its review pages are cited as
// separate sources under the same place_id. Collapse both into one entry per
// place, preferring the place's own Maps link over a review link.
export function extractPlaces(interaction) {
	const byPlace = new Map();
	for (const step of interaction?.steps || []) {
		if (step?.type !== "model_output") continue;
		for (const block of step.content || []) {
			for (const ann of block?.annotations || []) {
				if (ann?.type !== "place_citation") continue;
				const rawName = typeof ann.name === "string" ? ann.name : "";
				const name = rawName.endsWith(MAPS_TITLE_SUFFIX)
					? rawName.slice(0, -MAPS_TITLE_SUFFIX.length)
					: rawName;
				const isReview = name.startsWith(REVIEW_TITLE_PREFIX);
				const place = {
					placeId: ann.place_id || ann.url,
					name: isReview ? name.slice(REVIEW_TITLE_PREFIX.length) : name,
					url: ann.url,
				};
				if (!place.placeId || !place.name || !place.url) continue;

				const existing = byPlace.get(place.placeId);
				if (!existing) {
					byPlace.set(place.placeId, { ...place, isReview });
					continue;
				}
				// A place link supersedes the review link we recorded first.
				if (existing.isReview && !isReview) {
					byPlace.set(place.placeId, { ...place, isReview });
				}
			}
		}
	}
	return Array.from(byPlace.values()).map(({ placeId, name, url }) => ({ placeId, name, url }));
}

function formatHuman({ model, source, query, purpose, latitude, longitude, text, places, steps, showRaw }) {
	const lines = [];
	lines.push(`Model: ${model} (auth: ${source})`);
	lines.push(`Query: ${query}`);
	lines.push(`Purpose: ${purpose}`);
	lines.push(`Location: ${latitude !== undefined ? `${latitude}, ${longitude}` : "(none, resolved from the query)"}`);
	if (showRaw) {
		lines.push(`Steps: ${steps.join(" -> ") || "(none)"}`);
	}
	lines.push("");
	lines.push(text || "(empty response)");
	if (places.length > 0) {
		lines.push("");
		lines.push("Places:");
		places.forEach((p, i) => {
			lines.push(`  [${i + 1}] ${p.name} — ${p.url}`);
		});
	}
	return lines.join("\n");
}

async function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
	if (args.help || !args.query) {
		console.error(usage());
		process.exit(args.help ? 0 : 1);
	}

	let apiKey;
	let source;
	try {
		({ apiKey, source } = resolveApiKey());
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}

	const model = args.model || DEFAULT_MODEL;

	const signal =
		typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(args.timeoutMs) : undefined;

	let interaction;
	try {
		const res = await fetch(INTERACTIONS_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				...buildAuthHeaders(apiKey),
			},
			body: JSON.stringify(
				buildRequestBody({
					model,
					query: args.query,
					purpose: args.purpose,
					latitude: args.latitude,
					longitude: args.longitude,
					thinkingLevel: args.thinkingLevel,
				}),
			),
			signal,
		});
		const payload = await res.text();
		if (!res.ok) {
			console.error(`Error: Interactions request failed (${res.status})`);
			console.error(`Body: ${payload}`);
			process.exit(1);
		}
		interaction = JSON.parse(payload);
	} catch (err) {
		console.error(`Error: ${err?.message || String(err)}`);
		process.exit(1);
	}

	const text = extractText(interaction);
	const places = extractPlaces(interaction);
	const steps = (interaction?.steps || []).map((s) => s?.type).filter(Boolean);

	if (args.json) {
		console.log(
			JSON.stringify(
				{
					model,
					source,
					query: args.query,
					purpose: args.purpose,
					latitude: args.latitude,
					longitude: args.longitude,
					text,
					places,
					steps,
				},
				null,
				2,
			),
		);
		return;
	}

	console.log(
		formatHuman({
			model,
			source,
			query: args.query,
			purpose: args.purpose,
			latitude: args.latitude,
			longitude: args.longitude,
			text,
			places,
			steps,
			showRaw: args.raw,
		}),
	);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	main().catch((err) => {
		console.error(`Error: ${err?.message || err}`);
		process.exit(1);
	});
}
