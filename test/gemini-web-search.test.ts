import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	INTERACTIONS_URL,
	buildAuthHeaders,
	buildPrompt,
	buildRequestBody,
	extractCitations,
	extractText,
	parseArgs,
	resolveApiKey,
	usage,
} from "../skills/gemini-web-search/search.mjs";

const sample = JSON.parse(
	readFileSync(new URL("../skills/gemini-web-search/fixtures/sample-interaction.json", import.meta.url), "utf8"),
);

function tempAuthFile(contents: string): string {
	const path = join(mkdtempSync(join(tmpdir(), "gws-")), "auth.json");
	writeFileSync(path, contents, "utf8");
	return path;
}

test("the endpoint is Google AI Studio directly, not a gateway", () => {
	assert.equal(INTERACTIONS_URL, "https://generativelanguage.googleapis.com/v1beta/interactions");
});

test("parseArgs collects the query and defaults", () => {
	const a = parseArgs(["latest", "node", "lts"]);
	assert.equal(a.query, "latest node lts");
	assert.equal(a.purpose, undefined);
	assert.equal(a.json, false);
	assert.equal(a.raw, false);
	assert.equal(a.model, undefined);
});

test("parseArgs reads --model in both forms and flags", () => {
	assert.equal(parseArgs(["--model=gemini-3.5-flash-lite", "q"]).model, "gemini-3.5-flash-lite");
	assert.equal(parseArgs(["--model", "gemini-3.5-flash-lite", "q"]).model, "gemini-3.5-flash-lite");
	assert.equal(parseArgs(["--json", "--raw", "q"]).json, true);
	assert.equal(parseArgs(["--json", "--raw", "q"]).raw, true);
});

test("a non-numeric --timeout is rejected instead of crashing later", () => {
	assert.throws(() => parseArgs(["q", "--timeout", "abc"]), /timeout/i);
	assert.throws(() => parseArgs(["q", "--timeout=abc"]), /timeout/i);
});

test("usage advertises Gemini 3.8 Flash as the default model", () => {
	assert.match(usage(), /Default model: gemini-3\.8-flash/);
	assert.match(usage(), /GEMINI_API_KEY/);
});

test("auth is sent as the x-goog-api-key header AI Studio expects", () => {
	assert.deepEqual(buildAuthHeaders("KEY"), { "x-goog-api-key": "KEY" });
});

test("resolveApiKey prefers GEMINI_API_KEY from the environment", () => {
	const resolved = resolveApiKey({ GEMINI_API_KEY: "env-key" }, "/nonexistent/auth.json");
	assert.equal(resolved.apiKey, "env-key");
	assert.equal(resolved.source, "env:GEMINI_API_KEY");
});

test("resolveApiKey falls back to the pi auth.json google entry", () => {
	const path = tempAuthFile(JSON.stringify({ google: { type: "api_key", key: "auth-key" } }));
	const resolved = resolveApiKey({}, path);
	assert.equal(resolved.apiKey, "auth-key");
	assert.equal(resolved.source, "auth.json:google");
});

test("an auth.json key naming an env var resolves through the environment", () => {
	const path = tempAuthFile(JSON.stringify({ google: { type: "api_key", key: "MY_GEMINI_KEY" } }));
	const resolved = resolveApiKey({ MY_GEMINI_KEY: "indirect-key" }, path);
	assert.equal(resolved.apiKey, "indirect-key");
});

test("missing credentials are reported with the env var to set", () => {
	assert.throws(() => resolveApiKey({}, "/nonexistent/auth.json"), /GEMINI_API_KEY/);
});

test("a malformed auth.json is reported as malformed, not as missing credentials", () => {
	const path = tempAuthFile("{ not json");
	assert.throws(() => resolveApiKey({}, path), new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("buildPrompt leaves the purpose out entirely when none was given", () => {
	const p = buildPrompt("vite 7 breaking changes", undefined);
	assert.ok(p.includes("vite 7 breaking changes"));
	assert.ok(!/Purpose/.test(p));
});

test("buildRequestBody without a purpose sends a prompt that claims none", () => {
	const body = buildRequestBody({ model: "gemini-3.6-flash", query: "latest node lts" });
	assert.ok(!/Purpose/.test(body.input));
});

test("buildPrompt carries the query and purpose", () => {
	const p = buildPrompt("vite 7 breaking changes", "upgrade plan");
	assert.ok(p.includes("vite 7 breaking changes"));
	assert.ok(p.includes("upgrade plan"));
	assert.ok(/google_search/.test(p));
});

test("buildRequestBody enables google_search grounding and carries the prompt", () => {
	const body = buildRequestBody({ model: "gemini-3.6-flash", query: "latest node lts", purpose: "upgrade plan" });
	assert.equal(body.model, "gemini-3.6-flash");
	assert.deepEqual(body.tools, [{ type: "google_search" }]);
	assert.ok(body.input.includes("latest node lts"));
	assert.ok(body.input.includes("upgrade plan"));
});

test("extractText pulls model_output text from a real interaction", () => {
	const text = extractText(sample);
	assert.ok(text.length > 0);
	assert.ok(/Node\.js/i.test(text));
});

test("extractText prefers output_text when present", () => {
	assert.equal(extractText({ output_text: "quick answer" }), "quick answer");
});

test("extractCitations collects and dedupes url_citation annotations", () => {
	const citations = extractCitations(sample);
	assert.ok(citations.length >= 1);
	for (const c of citations) {
		assert.ok(c.url.startsWith("https://"));
		assert.ok(typeof c.title === "string" && c.title.length > 0);
	}
	const urls = citations.map((c) => c.url);
	assert.equal(new Set(urls).size, urls.length, "citations should be deduped by url");
});

test("extractCitations falls back to hostname when title is missing", () => {
	const citations = extractCitations({
		steps: [
			{
				type: "model_output",
				content: [
					{
						type: "text",
						text: "x",
						annotations: [{ type: "url_citation", url: "https://example.com/a" }],
					},
				],
			},
		],
	});
	assert.equal(citations.length, 1);
	assert.equal(citations[0].title, "example.com");
});
