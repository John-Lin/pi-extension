#!/usr/bin/env node

// Fast web research via the OpenAI Responses API called directly (no corporate
// gateway). Authenticates with the OPENAI_API_KEY environment variable and
// enables the native web_search tool.

import { pathToFileURL } from "node:url";

export const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_PURPOSE = "general research support";
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
		purpose: DEFAULT_PURPOSE,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		json: false,
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
  node search.mjs "<query>" [--purpose "<why>"] [--model <id>] [--timeout <ms>] [--json]

Calls the OpenAI Responses API directly. Required env var:
  OPENAI_API_KEY   OpenAI platform API key, sent as "Authorization: Bearer".

Default model: ${DEFAULT_MODEL} (override with --model).

Examples:
  node search.mjs "latest python release" --purpose "update dependency notes"
  node search.mjs "vite 7 breaking changes" --json`;
}

export function resolveApiKey(env = process.env) {
	const key = env.OPENAI_API_KEY;
	if (!key) {
		throw new Error("Missing required env var: OPENAI_API_KEY.");
	}
	return key;
}

function buildSystemPrompt() {
	return "You are a fast web research assistant. Always produce practical summaries and include full source URLs (no shortened links).";
}

function buildUserPrompt(query, purpose) {
	return `Search the internet for: ${query}\n\nPurpose: ${purpose}\n\nReturn a concise research summary with:\n- 3 to 7 key findings\n- for every finding: title, why it matters for this purpose, and a full canonical URL (https://...)\n- if multiple sources disagree, call that out\n- finish with a short recommendation on which source(s) to trust first.`;
}

export function buildRequestBody({ model, query, purpose }) {
	return {
		model,
		instructions: buildSystemPrompt(),
		input: [{ role: "user", content: buildUserPrompt(query, purpose) }],
		tools: [{ type: "web_search" }],
		tool_choice: "auto",
	};
}

export function extractResult(response) {
	if (response?.status === "failed" || response?.error) {
		throw new Error(response?.error?.message || "OpenAI response failed");
	}
	// A partial summary reads exactly like a whole one, so anything short of
	// "completed" is rejected instead of returned.
	if (response?.status && response.status !== "completed") {
		throw new Error(`OpenAI response ended with status '${response.status}' instead of 'completed'.`);
	}

	const output = Array.isArray(response?.output) ? response.output : [];

	const messages = output.filter((item) => item.type === "message");
	const text = messages
		.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
		.filter((c) => c.type === "output_text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n\n")
		.trim();

	if (!text) {
		throw new Error("OpenAI returned no text content");
	}

	const seen = new Set();
	const citations = [];
	for (const message of messages) {
		const content = Array.isArray(message.content) ? message.content : [];
		for (const part of content) {
			const annotations = Array.isArray(part.annotations) ? part.annotations : [];
			for (const ann of annotations) {
				if (ann.type !== "url_citation" || typeof ann.url !== "string") continue;
				if (seen.has(ann.url)) continue;
				seen.add(ann.url);
				citations.push({ title: ann.title || ann.url, url: ann.url });
			}
		}
	}

	const searchCount = output.filter((item) => item.type === "web_search_call").length;

	return { text, citations, searchCount };
}

export function formatOutput({ text, citations }) {
	if (!Array.isArray(citations) || citations.length === 0) {
		return text;
	}
	const lines = citations.map((c) => `- ${c.title}: ${c.url}`);
	return `${text}\n\n## Citations\n\n${lines.join("\n")}`;
}

function timeoutSignal(timeoutMs) {
	return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
}

async function runSearch({ apiKey, model, query, purpose, timeoutMs }) {
	const res = await fetch(OPENAI_URL, {
		method: "POST",
		headers: {
			authorization: `Bearer ${apiKey}`,
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify(buildRequestBody({ model, query, purpose })),
		signal: timeoutSignal(timeoutMs),
	});

	const payload = await res.text();
	if (!res.ok) {
		throw new Error(`OpenAI request failed (${res.status}): ${payload}`);
	}
	let parsed;
	try {
		parsed = JSON.parse(payload);
	} catch {
		throw new Error("OpenAI returned non-JSON response");
	}
	return extractResult(parsed);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || !args.query) {
		console.error(usage());
		process.exit(args.help ? 0 : 1);
	}

	const apiKey = resolveApiKey();
	const model = args.model || DEFAULT_MODEL;
	const { text, citations, searchCount } = await runSearch({
		apiKey,
		model,
		query: args.query,
		purpose: args.purpose,
		timeoutMs: args.timeoutMs,
	});

	if (args.json) {
		console.log(
			JSON.stringify({ model, query: args.query, purpose: args.purpose, searchCount, text, citations }, null, 2),
		);
		return;
	}

	console.log(`Model: ${model}`);
	console.log(`Web searches: ${searchCount}`);
	console.log("");
	console.log(formatOutput({ text, citations }));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	main().catch((err) => {
		console.error(`Error: ${err?.message || err}`);
		process.exit(1);
	});
}
