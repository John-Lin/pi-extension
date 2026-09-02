// Shared plumbing for the Gemini grounding skills. Talks to Google AI Studio's
// Interactions REST API (/v1beta/interactions) directly (no corporate gateway)
// with Node's built-in fetch, so no SDK dependency is required.
//
// Credentials: GEMINI_API_KEY, or the "google" api_key entry in pi's
// ~/.pi/agent/auth.json as a fallback. Sent as the x-goog-api-key header.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const TOKEN_ENV = "GEMINI_API_KEY";
export const AUTH_HEADER = "x-goog-api-key";

// Pi stores credentials in auth.json keyed by provider name. The built-in
// provider for Google AI is called "google".
const PI_AUTH_PROVIDER = "google";

export function parseTimeout(raw, fallback) {
	if (raw === undefined || raw === "") return fallback;
	const ms = Number(raw);
	if (!Number.isFinite(ms)) throw new Error(`--timeout expects a number of milliseconds, got '${raw}'.`);
	return Math.max(1000, ms);
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

export async function createInteraction({ body, apiKey, timeoutMs }) {
	const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;

	const res = await fetch(INTERACTIONS_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
			...buildAuthHeaders(apiKey),
		},
		body: JSON.stringify(body),
		signal,
	});
	const payload = await res.text();
	if (!res.ok) {
		throw new Error(`Interactions request failed (${res.status})\nBody: ${payload}`);
	}
	return JSON.parse(payload);
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

export function stepTypes(interaction) {
	return (interaction?.steps || []).map((s) => s?.type).filter(Boolean);
}
