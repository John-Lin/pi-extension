import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const TOKEN_ENV = "GEMINI_API_KEY";
const AUTH_HEADER = "x-goog-api-key";
const PI_AUTH_PROVIDER = "google";

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
