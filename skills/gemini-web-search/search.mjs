#!/usr/bin/env node

import { GoogleGenAI } from "@google/genai";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_TIMEOUT_MS = 120000;

// Env var names. The skill is intentionally vendor-neutral; map your
// gateway credentials onto these in your shell config.
const ENV = {
	directApiKey: "GEMINI_API_KEY",
	proxyUrl: "GEMINI_PROXY_URL",
	proxyAuthHeader: "GEMINI_PROXY_AUTH_HEADER",
	proxyAuthValue: "GEMINI_PROXY_AUTH_VALUE",
};

// Pi stores credentials in auth.json keyed by provider name. The built-in
// provider for Google AI is called "google".
const PI_AUTH_PROVIDER = "google";

function parseArgs(argv) {
	const out = {
		model: DEFAULT_MODEL,
		purpose: "general research support",
		timeoutMs: DEFAULT_TIMEOUT_MS,
		mode: undefined,
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
			continue;
		}
		if (arg === "--json") {
			out.json = true;
			continue;
		}
		if (arg === "--raw") {
			out.raw = true;
			continue;
		}
		if (arg === "--model") {
			out.model = argv[++i] || out.model;
			continue;
		}
		if (arg.startsWith("--model=")) {
			out.model = arg.slice("--model=".length) || out.model;
			continue;
		}
		if (arg === "--mode") {
			out.mode = argv[++i];
			continue;
		}
		if (arg.startsWith("--mode=")) {
			out.mode = arg.slice("--mode=".length);
			continue;
		}
		if (arg === "--purpose") {
			out.purpose = argv[++i] || out.purpose;
			continue;
		}
		if (arg.startsWith("--purpose=")) {
			out.purpose = arg.slice("--purpose=".length) || out.purpose;
			continue;
		}
		if (arg === "--timeout") {
			out.timeoutMs = Math.max(1000, Number(argv[++i] || out.timeoutMs));
			continue;
		}
		if (arg.startsWith("--timeout=")) {
			out.timeoutMs = Math.max(1000, Number(arg.slice("--timeout=".length) || out.timeoutMs));
			continue;
		}
		positional.push(arg);
	}

	out.query = positional.join(" ").trim();
	return out;
}

function usage() {
	return `Usage:
  node search.mjs "<query>" [--purpose "<why>"] [--model <id>] [--mode direct|proxy] [--timeout <ms>] [--json] [--raw]

Modes:
  direct  Call ai.google.dev directly.
          Requires: ${ENV.directApiKey}
  proxy   Route through a Gemini-compatible gateway (e.g. a corporate proxy).
          Requires: ${ENV.proxyUrl}, ${ENV.proxyAuthHeader}, ${ENV.proxyAuthValue}

If --mode is omitted, the script picks proxy when ${ENV.proxyUrl} is set,
otherwise direct when ${ENV.directApiKey} is set.

Examples:
  node search.mjs "latest python release" --purpose "update dependency notes"
  node search.mjs "vite 7 breaking changes" --mode direct --json`;
}

function getAgentDir() {
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (!configured) return join(homedir(), ".pi", "agent");
	if (configured === "~") return homedir();
	if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
	return configured;
}

function resolveConfigValue(value) {
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
	return process.env[value] || value;
}

function readPiAuthKey() {
	const authPath = join(getAgentDir(), "auth.json");
	if (!existsSync(authPath)) return undefined;
	let data;
	try {
		data = JSON.parse(readFileSync(authPath, "utf8"));
	} catch {
		return undefined;
	}
	const entry = data?.[PI_AUTH_PROVIDER];
	if (!entry) return undefined;
	const type = entry.type || (entry.key ? "api_key" : undefined);
	if (type !== "api_key") return undefined;
	return resolveConfigValue(entry.key);
}

function selectMode(args) {
	const env = process.env;
	const hasProxy = !!env[ENV.proxyUrl];
	const directKeyEnv = env[ENV.directApiKey];
	const directKeyAuth = directKeyEnv ? undefined : readPiAuthKey();
	const hasDirect = !!(directKeyEnv || directKeyAuth);

	let mode = args.mode;
	if (!mode) {
		if (hasProxy) mode = "proxy";
		else if (hasDirect) mode = "direct";
		else {
			throw new Error(
				`No credentials found. Set ${ENV.directApiKey} (or add a 'google' api_key ` +
					`entry to ~/.pi/agent/auth.json) for direct mode, or ${ENV.proxyUrl} ` +
					`(+ ${ENV.proxyAuthHeader} + ${ENV.proxyAuthValue}) for proxy mode.`,
			);
		}
	}

	if (mode === "direct") {
		const apiKey = directKeyEnv || directKeyAuth;
		const apiKeySource = directKeyEnv ? `env:${ENV.directApiKey}` : "auth.json:google";
		if (!apiKey) {
			throw new Error(
				`direct mode requires ${ENV.directApiKey} or a 'google' api_key entry in ~/.pi/agent/auth.json.`,
			);
		}
		return { mode, baseUrl: undefined, apiKey, headers: undefined, apiKeySource };
	}

	if (mode === "proxy") {
		const baseUrl = env[ENV.proxyUrl];
		const headerName = env[ENV.proxyAuthHeader];
		const headerValue = env[ENV.proxyAuthValue];
		const missing = [];
		if (!baseUrl) missing.push(ENV.proxyUrl);
		if (!headerName) missing.push(ENV.proxyAuthHeader);
		if (!headerValue) missing.push(ENV.proxyAuthValue);
		if (missing.length) {
			throw new Error(`proxy mode requires: ${missing.join(", ")}.`);
		}
		return {
			mode,
			baseUrl: baseUrl.replace(/\/+$/, ""),
			// The SDK requires an apiKey; the proxy ignores it because auth
			// comes from the custom header below.
			apiKey: "proxy-auth-via-header",
			headers: { [headerName]: headerValue },
			apiKeySource: `env:${ENV.proxyAuthValue}`,
		};
	}

	throw new Error(`Unknown --mode '${mode}' (expected: direct, proxy).`);
}

function createClient(modeConfig) {
	const opts = { apiKey: modeConfig.apiKey };
	if (modeConfig.baseUrl) {
		opts.httpOptions = { baseUrl: modeConfig.baseUrl };
	}
	return new GoogleGenAI(opts);
}

function buildPrompt(query, purpose) {
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

function extractText(interaction) {
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

function extractCitations(interaction) {
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

function formatHuman({ mode, apiKeySource, model, query, purpose, text, citations, stepTypes, showRaw }) {
	const lines = [];
	lines.push(`Mode: ${mode}${apiKeySource ? ` (auth: ${apiKeySource})` : ""}`);
	lines.push(`Model: ${model}`);
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

	let modeConfig;
	try {
		modeConfig = selectMode(args);
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}

	const client = createClient(modeConfig);

	const signal =
		typeof AbortSignal !== "undefined" && AbortSignal.timeout
			? AbortSignal.timeout(args.timeoutMs)
			: undefined;

	const callOptions = { fetch_options: signal ? { signal } : undefined };
	if (modeConfig.headers) {
		// SDK does NOT propagate httpOptions.headers to the Interactions
		// next-gen client, so custom auth headers must be passed per-call.
		callOptions.headers = modeConfig.headers;
	}

	let interaction;
	try {
		interaction = await client.interactions.create(
			{
				model: args.model,
				input: buildPrompt(args.query, args.purpose),
				tools: [{ type: "google_search" }],
			},
			callOptions,
		);
	} catch (err) {
		const body = err?.body || err?.cause?.body;
		const status = err?.statusCode || err?.cause?.statusCode;
		console.error(`Error: ${err?.message || String(err)}`);
		if (status) console.error(`Status: ${status}`);
		if (body) console.error(`Body: ${typeof body === "string" ? body : JSON.stringify(body)}`);
		process.exit(1);
	}

	const text = extractText(interaction);
	const citations = extractCitations(interaction);
	const stepTypes = (interaction?.steps || []).map((s) => s?.type).filter(Boolean);

	if (args.json) {
		console.log(
			JSON.stringify(
				{
					mode: modeConfig.mode,
					model: args.model,
					query: args.query,
					purpose: args.purpose,
					text,
					citations,
					steps: stepTypes,
				},
				null,
				2,
			),
		);
		return;
	}

	console.log(
		formatHuman({
			mode: modeConfig.mode,
			apiKeySource: modeConfig.apiKeySource,
			model: args.model,
			query: args.query,
			purpose: args.purpose,
			text,
			citations,
			stepTypes,
			showRaw: args.raw,
		}),
	);
}

main().catch((err) => {
	console.error(`Error: ${err?.message || err}`);
	process.exit(1);
});
