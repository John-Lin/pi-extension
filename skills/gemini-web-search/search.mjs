#!/usr/bin/env node

// Gemini web search via Google AI Studio's Google Search grounding tool.
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

// Only gemini-3.8-flash (default) and gemini-3.5-flash-lite (lower latency)
// are supported here; both do google_search grounding.
const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_THINKING_LEVEL = "medium";
const DEFAULT_TIMEOUT_MS = 120000;

export function parseArgs(argv) {
	const out = {
		model: undefined,
		purpose: "general research support",
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

Thinking level: defaults to ${DEFAULT_THINKING_LEVEL}.

Calls Google AI Studio directly. Credentials (first match wins):
  ${TOKEN_ENV}   API key, sent as the "${AUTH_HEADER}" header.
  ~/.pi/agent/auth.json "google" api_key entry (fallback).

Default model: ${DEFAULT_MODEL} (override with --model).

Examples:
  node search.mjs "latest python release" --purpose "update dependency notes"
  node search.mjs "vite 7 breaking changes" --json`;
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

export function buildRequestBody({ model, query, purpose, thinkingLevel = DEFAULT_THINKING_LEVEL }) {
	return {
		model,
		input: buildPrompt(query, purpose),
		// Interactions API tool spec: {type:"google_search"} (NOT the legacy
		// generateContent {googleSearch:{}}).
		tools: [{ type: "google_search" }],
		generation_config: { thinking_level: thinkingLevel },
	};
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

function formatHuman({ model, source, query, purpose, text, citations, steps, showRaw }) {
	const lines = [];
	lines.push(`Model: ${model} (auth: ${source})`);
	lines.push(`Query: ${query}`);
	lines.push(`Purpose: ${purpose}`);
	if (showRaw) {
		lines.push(`Steps: ${steps.join(" -> ") || "(none)"}`);
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

	let interaction;
	try {
		interaction = await createInteraction({
			body: buildRequestBody({
				model,
				query: args.query,
				purpose: args.purpose,
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
	const citations = extractCitations(interaction);
	const steps = stepTypes(interaction);

	if (args.json) {
		console.log(
			JSON.stringify({ model, source, query: args.query, purpose: args.purpose, text, citations, steps }, null, 2),
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
