#!/usr/bin/env node

// Gemini place search via Google AI Studio's Google Maps grounding tool.
// Shares auth, transport and text extraction with the other Gemini skills; see
// ../lib/gemini-interactions.mjs.

import { pathToFileURL } from "node:url";

import {
	AUTH_HEADER,
	TOKEN_ENV,
	createInteraction,
	extractText,
	parseTimeout,
	resolveApiKey,
	stepTypes,
} from "../lib/gemini-interactions.mjs";

const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_THINKING_LEVEL = "medium";
const DEFAULT_TIMEOUT_MS = 120000;

// Maps citations carry the source's Google Maps title, which always ends with
// this suffix and, for review sources, starts with "Review of".
const MAPS_TITLE_SUFFIX = " - Google Maps";
const REVIEW_TITLE_PREFIX = "Review of ";

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

	let interaction;
	try {
		interaction = await createInteraction({
			body: buildRequestBody({
				model,
				query: args.query,
				purpose: args.purpose,
				latitude: args.latitude,
				longitude: args.longitude,
				thinkingLevel: args.thinkingLevel,
			}),
			apiKey,
			timeoutMs: args.timeoutMs,
		});
	} catch (err) {
		console.error(`Error: ${err?.message || String(err)}`);
		process.exit(1);
	}

	const text = extractText(interaction);
	const places = extractPlaces(interaction);
	const steps = stepTypes(interaction);

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
