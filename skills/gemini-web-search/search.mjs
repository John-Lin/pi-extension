#!/usr/bin/env node

// Gemini web search via Google AI Studio called directly (no corporate
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

// Newest model verified to have free-tier quota on personal API keys; the
// 3.x flash models are listed by models.list but return 429 "no quota"
// without paid billing. Override per-call with --model.
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 120000;

function parseTimeout(raw, fallback) {
	if (raw === undefined || raw === "") return fallback;
	const ms = Number(raw);
	if (!Number.isFinite(ms)) throw new Error(`--timeout expects a number of milliseconds, got '${raw}'.`);
	return Math.max(1000, ms);
}

export function parseArgs(argv) {
	const out = {
		model: undefined,
		purpose: "general research support",
		timeoutMs: DEFAULT_TIMEOUT_MS,
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
		} else if (arg === "--timeout") {
			out.timeoutMs = parseTimeout(argv[++i], out.timeoutMs);
		} else if (arg.startsWith("--timeout=")) {
			out.timeoutMs = parseTimeout(arg.slice("--timeout=".length), out.timeoutMs);
		} else {
			positional.push(arg);
		}
	}

	out.query = positional.join(" ").trim();
	return out;
}

export function usage() {
	return `Usage:
  node search.mjs "<query>" [--purpose "<why>"] [--model <id>] [--timeout <ms>] [--json] [--raw]

Calls Google AI Studio directly. Credentials (first match wins):
  ${TOKEN_ENV}   API key, sent as the "${AUTH_HEADER}" header.
  ~/.pi/agent/auth.json "google" api_key entry (fallback).

Default model: ${DEFAULT_MODEL} (override with --model).

Examples:
  node search.mjs "latest python release" --purpose "update dependency notes"
  node search.mjs "vite 7 breaking changes" --json`;
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
		"You are a fast web research assistant. Use the google_search tool to find",
		"current, authoritative information. Always cite full URLs (no shortened links).",
		"",
		`Search the internet for: ${query}`,
		"",
		`Purpose: ${purpose}`,
		"",
		"Return a concise research summary with:",
		"- 3 to 7 key findings",
		"- for every finding: why it matters for this purpose, with an inline citation",
		"- if multiple sources disagree, call that out",
		"- finish with a short recommendation on which source(s) to trust first.",
	].join("\n");
}

export function buildRequestBody({ model, query, purpose }) {
	return {
		model,
		input: buildPrompt(query, purpose),
		// Interactions API tool spec: {type:"google_search"} (NOT the legacy
		// generateContent {googleSearch:{}}). google_search and google_maps
		// cannot be combined in a single request.
		tools: [{ type: "google_search" }],
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

export function extractCitations(interaction) {
	const seen = new Map();
	for (const step of interaction?.steps || []) {
		if (step?.type !== "model_output") continue;
		for (const block of step.content || []) {
			for (const ann of block?.annotations || []) {
				if (ann?.type !== "url_citation") continue;
				const url = ann.url;
				if (!url || seen.has(url)) continue;
				let title = ann.title;
				if (!title) {
					try {
						title = new URL(url).hostname;
					} catch {
						title = url;
					}
				}
				seen.set(url, { url, title });
			}
		}
	}
	return Array.from(seen.values());
}

function formatHuman({ model, source, query, purpose, text, citations, stepTypes, showRaw }) {
	const lines = [];
	lines.push(`Model: ${model} (auth: ${source})`);
	lines.push(`Query: ${query}`);
	lines.push(`Purpose: ${purpose}`);
	if (showRaw) {
		lines.push(`Steps: ${stepTypes.join(" -> ") || "(none)"}`);
	}
	lines.push("");
	lines.push(text || "(empty response)");
	if (citations.length > 0) {
		lines.push("");
		lines.push("Citations:");
		citations.forEach((c, i) => {
			lines.push(`  [${i + 1}] ${c.title} — ${c.url}`);
		});
	}
	return lines.join("\n");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
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
			body: JSON.stringify(buildRequestBody({ model, query: args.query, purpose: args.purpose })),
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
	const citations = extractCitations(interaction);
	const stepTypes = (interaction?.steps || []).map((s) => s?.type).filter(Boolean);

	if (args.json) {
		console.log(
			JSON.stringify(
				{ model, source, query: args.query, purpose: args.purpose, text, citations, steps: stepTypes },
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
			text,
			citations,
			stepTypes,
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
