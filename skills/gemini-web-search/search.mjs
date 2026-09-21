#!/usr/bin/env node

// Gemini web search via Google AI Studio called directly (no corporate
// gateway). Talks to the Interactions REST API (/v1beta/interactions) with
// Node's built-in fetch, so no SDK dependency is required.
//
// Credentials: GEMINI_API_KEY, or the "google" api_key entry in pi's
// ~/.pi/agent/auth.json as a fallback. Sent as the x-goog-api-key header.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateInteraction } from "./gemini-interactions.mjs";

export const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const TYPESAFE_SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone";
const TOKEN_ENV = "GEMINI_API_KEY";
const TYPESAFE_TOKEN_ENV = "TYPESAFE_API_KEY";
const AUTH_HEADER = "x-goog-api-key";

// Pi stores credentials in auth.json keyed by provider name. The built-in
// provider for Google AI is called "google".
const PI_AUTH_PROVIDER = "google";

const DEFAULT_MODEL = "gemini-3.8-flash";
const LOW_LATENCY_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_THINKING_LEVEL = "medium";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_RETRY_DELAY_MS = 1000;

const GEMINI_CONFIGURATIONS = {
	flash_3_8_medium: { model: "gemini-3.8-flash", thinkingLevel: "medium" },
	flash_3_8_low: { model: "gemini-3.8-flash", thinkingLevel: "low" },
	flash_3_1_flash_lite_minimal: { model: "gemini-3.1-flash-lite", thinkingLevel: "minimal" },
};

export function parseRetryAfterMs(raw) {
	if (raw === null || raw === "") return DEFAULT_RETRY_DELAY_MS;
	const seconds = Number(raw);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_RETRY_DELAY_MS;
}

function parseTimeout(raw, fallback) {
	if (raw === undefined || raw === "") return fallback;
	const ms = Number(raw);
	if (!Number.isFinite(ms)) throw new Error(`--timeout expects a number of milliseconds, got '${raw}'.`);
	return Math.max(1000, ms);
}

export function parseArgs(argv) {
	const out = {
		model: undefined,
		purpose: undefined,
		thinkingLevel: DEFAULT_THINKING_LEVEL,
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
		} else if (arg === "--thinking") {
			out.thinkingLevel = argv[++i] || out.thinkingLevel;
		} else if (arg.startsWith("--thinking=")) {
			out.thinkingLevel = arg.slice("--thinking=".length) || out.thinkingLevel;
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
  node search.mjs "<query>" [--purpose "<why>"] [--model <id>] [--thinking <level>] [--timeout <ms>] [--json] [--raw]

Flags:
  --purpose     Why you need the research; the summary is written for it.
  --model       Default model: ${DEFAULT_MODEL} (${LOW_LATENCY_MODEL} for lower latency).
  --thinking    minimal | low | medium | high (default: ${DEFAULT_THINKING_LEVEL}).
  --timeout     Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}).
  --json        Print the result as JSON instead of text.
  --raw         Also print the interaction's step-type sequence.

Credentials (first match wins):
  ${TOKEN_ENV}   API key, sent as the "${AUTH_HEADER}" header.
  ~/.pi/agent/auth.json "${PI_AUTH_PROVIDER}" api_key entry (fallback).

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

export function resolveTypesafeApiKey(env = process.env) {
	const apiKey = env[TYPESAFE_TOKEN_ENV];
	return apiKey ? { apiKey, source: `env:${TYPESAFE_TOKEN_ENV}` } : undefined;
}

export function buildThinkingSelectionRequest(query) {
	return {
		state: { query },
		model: "jev-latest",
		questions: {
			gemini_configuration: {
				type: "choice",
				instructions: "Choose the lowest-latency Gemini configuration that can reliably answer the user's search request in `query`. Direct lookup and bounded extraction default to Flash-Lite, even when the result has multiple items. Choose a stronger configuration only when the query requires interpretation or reasoning beyond retrieval. When both Flash-Lite and Flash low would be sufficient, choose Flash-Lite.",
				criteria: {
					flash_3_8_medium: "Gemini 3.8 Flash with medium thinking for analysis, comparison, planning, troubleshooting, conflicting evidence, broad synthesis, or multiple interacting constraints.",
					flash_3_8_low: "Gemini 3.8 Flash with low thinking for interpreting findings, resolving material ambiguity, reconciling conflicting sources, inferring missing details, or synthesizing conclusions beyond direct extraction.",
					flash_3_1_flash_lite_minimal: "Gemini 3.1 Flash-Lite with minimal thinking for direct factual lookup or bounded extraction or listing from one or a few authoritative sources. This includes multiple rows or fields, date filtering, and citations when no interpretation or conflict resolution is required.",
				},
			},
		},
	};
}

export function selectGeminiConfiguration(selection) {
	const answer = selection?.answers?.gemini_configuration;
	const configuration = Object.hasOwn(GEMINI_CONFIGURATIONS, answer?.choice)
		? GEMINI_CONFIGURATIONS[answer.choice]
		: undefined;
	if (!configuration || !Number.isFinite(answer?.confidence) || !answer?.probabilities || Array.isArray(answer.probabilities)) {
		throw new Error("Jev returned an invalid Gemini configuration.");
	}
	return {
		...configuration,
		jev: {
			choice: answer.choice,
			confidence: answer.confidence,
			probabilities: answer.probabilities,
		},
	};
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
		// A purpose the caller never stated would steer the summary on a guess,
		// so an absent one is left absent rather than invented.
		...(purpose ? [`Purpose: ${purpose}`, ""] : []),
		"Return a concise research summary with:",
		"- 3 to 7 key findings",
		"- for every finding: why it matters for this purpose, with an inline citation",
		"- if multiple sources disagree, call that out",
		"- finish with a short recommendation on which source(s) to trust first.",
	].join("\n");
}

export function buildRequestBody({ model, query, purpose, thinkingLevel = DEFAULT_THINKING_LEVEL }) {
	return {
		model,
		store: false,
		input: buildPrompt(query, purpose),
		// Interactions API tool spec: {type:"google_search"} (NOT the legacy
		// generateContent {googleSearch:{}}). google_search and google_maps
		// cannot be combined in a single request.
		tools: [{ type: "google_search" }],
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

function formatHuman({ model, thinkingLevel, jev, source, query, purpose, text, citations, stepTypes, showRaw }) {
	const lines = [];
	lines.push(`Model: ${model} (thinking: ${thinkingLevel}, auth: ${source})`);
	if (jev) {
		const probabilities = Object.entries(jev.probabilities).map(([choice, probability]) => `${choice}=${probability}`).join(", ");
		lines.push(`Jev: ${jev.choice} (confidence: ${jev.confidence}; probabilities: ${probabilities})`);
	}
	lines.push(`Query: ${query}`);
	if (purpose) lines.push(`Purpose: ${purpose}`);
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

export async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	if (args.help || !args.query) {
		console.error(usage());
		return args.help ? 0 : 1;
	}

	let apiKey;
	let source;
	try {
		({ apiKey, source } = resolveApiKey());
	} catch (err) {
		console.error(`Error: ${err.message}`);
		return 1;
	}

	let model = args.model || DEFAULT_MODEL;
	let thinkingLevel = args.thinkingLevel;
	let jev;
	const typesafeCredentials = resolveTypesafeApiKey();
	if (typesafeCredentials) {
		try {
			let selection;
			for (let attempt = 0; attempt < 2; attempt++) {
				const selectionSignal =
					typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(args.timeoutMs) : undefined;
				let res;
				let payload;
				try {
					res = await fetch(TYPESAFE_SYSTEM_ONE_URL, {
						method: "POST",
						headers: {
							"content-type": "application/json",
							accept: "application/json",
							authorization: `Bearer ${typesafeCredentials.apiKey}`,
						},
						body: JSON.stringify(buildThinkingSelectionRequest(args.query)),
						signal: selectionSignal,
					});
					payload = await res.text();
				} catch (err) {
					if (attempt === 0) continue;
					throw err;
				}
				if (res.ok) {
					selection = JSON.parse(payload);
					break;
				}
				if (attempt === 0 && (res.status === 429 || res.status === 529)) {
					await new Promise((resolve) => setTimeout(resolve, parseRetryAfterMs(res.headers.get("retry-after"))));
					continue;
				}
				throw new Error(`Jev selection request failed (${res.status}): ${payload}`);
			}
			const configuration = selectGeminiConfiguration(selection);
			model = configuration.model;
			thinkingLevel = configuration.thinkingLevel;
			jev = configuration.jev;
		} catch (err) {
			console.error(`Warning: Jev selection failed; continuing without Jev. ${err?.message || String(err)}`);
		}
	}

	const signal =
		typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(args.timeoutMs) : undefined;

	let interaction;
	let text;
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
					thinkingLevel,
				}),
			),
			signal,
		});
		const payload = await res.text();
		if (!res.ok) {
			console.error(`Error: Interactions request failed (${res.status})`);
			console.error(`Body: ${payload}`);
			return 1;
		}
		interaction = JSON.parse(payload);
		validateInteraction(interaction, "google_search");
		text = extractText(interaction);
		if (!text.trim()) throw new Error("Search response did not contain text.");
	} catch (err) {
		console.error(`Error: ${err?.message || String(err)}`);
		return 1;
	}

	const citations = extractCitations(interaction);
	const stepTypes = (interaction?.steps || []).map((s) => s?.type).filter(Boolean);

	if (args.json) {
		console.log(
			JSON.stringify(
				{ model, thinkingLevel, jev, source, query: args.query, purpose: args.purpose, text, citations, steps: stepTypes },
				null,
				2,
			),
		);
		return 0;
	}

	console.log(
		formatHuman({
			model,
			thinkingLevel,
			jev,
			source,
			query: args.query,
			purpose: args.purpose,
			text,
			citations,
			stepTypes,
			showRaw: args.raw,
		}),
	);
	return 0;
}

const invokedDirectly = process.argv[1] && existsSync(process.argv[1]) &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
	main().then((code) => { process.exitCode = code; }).catch((err) => {
		console.error(`Error: ${err?.message || err}`);
		process.exit(1);
	});
}
