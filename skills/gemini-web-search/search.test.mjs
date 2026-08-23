import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
	parseArgs,
	usage,
	resolveApiKey,
	buildPrompt,
	buildRequestBody,
	extractText,
	extractCitations,
} from "./search.mjs";

const skillDir = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(join(skillDir, "fixtures", "sample-interaction.json"), "utf8"));

test("default model is gemini-3.7-flash in usage and SKILL.md", () => {
	assert.match(usage(), /Default model: gemini-3\.7-flash/);
	const skillInstructions = readFileSync(join(skillDir, "SKILL.md"), "utf8");
	assert.match(skillInstructions, /`gemini-3\.7-flash`/);
	assert.doesNotMatch(skillInstructions, /gemini-3\.6-flash/);
});

test("parseArgs collects the query and defaults", () => {
	const a = parseArgs(["latest", "node", "lts"]);
	assert.equal(a.query, "latest node lts");
	assert.equal(a.purpose, "general research support");
	assert.equal(a.model, undefined);
	assert.equal(a.json, false);
	assert.equal(a.raw, false);
});

test("parseArgs reads --model in both forms and flags", () => {
	assert.equal(parseArgs(["--model=gemini-3.5-flash-lite", "q"]).model, "gemini-3.5-flash-lite");
	assert.equal(parseArgs(["--model", "gemini-3.5-flash-lite", "q"]).model, "gemini-3.5-flash-lite");
	assert.equal(parseArgs(["--json", "--raw", "q"]).json, true);
	assert.equal(parseArgs(["--json", "--raw", "q"]).raw, true);
});

test("parseArgs clamps --timeout and rejects non-numeric values", () => {
	assert.equal(parseArgs(["q"]).timeoutMs, 120000);
	assert.equal(parseArgs(["--timeout", "5000", "q"]).timeoutMs, 5000);
	assert.equal(parseArgs(["--timeout=200", "q"]).timeoutMs, 1000);
	assert.throws(() => parseArgs(["--timeout", "abc", "q"]), /milliseconds/);
	assert.throws(() => parseArgs(["--timeout=abc", "q"]), /milliseconds/);
});

test("parseArgs defaults thinking level to medium and accepts an override", () => {
	assert.equal(parseArgs(["q"]).thinkingLevel, "medium");
	assert.equal(parseArgs(["--thinking", "high", "q"]).thinkingLevel, "high");
	assert.equal(parseArgs(["--thinking=low", "q"]).thinkingLevel, "low");
});

test("resolveApiKey prefers GEMINI_API_KEY over auth.json", () => {
	const { apiKey, source } = resolveApiKey({ GEMINI_API_KEY: "KEY" }, "/nonexistent/auth.json");
	assert.equal(apiKey, "KEY");
	assert.equal(source, "env:GEMINI_API_KEY");
});

test("resolveApiKey falls back to the google api_key entry in auth.json", () => {
	const authPath = join(mkdtempSync(join(tmpdir(), "gemini-search-test-")), "auth.json");
	writeFileSync(authPath, JSON.stringify({ google: { type: "api_key", key: "FILEKEY" } }));
	const { apiKey, source } = resolveApiKey({}, authPath);
	assert.equal(apiKey, "FILEKEY");
	assert.equal(source, "auth.json:google");
});

test("resolveApiKey throws when no credentials are found", () => {
	assert.throws(() => resolveApiKey({}, "/nonexistent/auth.json"), /GEMINI_API_KEY/);
});

test("buildPrompt carries the query and purpose", () => {
	const p = buildPrompt("vite 7 breaking changes", "upgrade plan");
	assert.ok(p.includes("vite 7 breaking changes"));
	assert.ok(p.includes("upgrade plan"));
	assert.ok(/google_search/.test(p));
});

test("buildRequestBody sends the selected Gemini thinking level", () => {
	const high = buildRequestBody({
		model: "gemini-3.6-flash",
		query: "vite 7 breaking changes",
		purpose: "upgrade plan",
		thinkingLevel: "high",
	});
	const defaultLevel = buildRequestBody({
		model: "gemini-3.6-flash",
		query: "vite 7 breaking changes",
		purpose: "upgrade plan",
	});
	assert.deepEqual(high.generation_config, { thinking_level: "high" });
	assert.deepEqual(defaultLevel.generation_config, { thinking_level: "medium" });
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
