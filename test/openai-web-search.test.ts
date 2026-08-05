import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	OPENAI_URL,
	buildRequestBody,
	extractResult,
	formatOutput,
	parseArgs,
	resolveApiKey,
	usage,
} from "../skills/openai-web-search/search.mjs";

const sample = JSON.parse(
	readFileSync(new URL("../skills/openai-web-search/fixtures/sample-response.json", import.meta.url), "utf8"),
);

test("the endpoint is the OpenAI API directly, not a gateway", () => {
	assert.equal(OPENAI_URL, "https://api.openai.com/v1/responses");
});

test("parseArgs collects the query from positional args", () => {
	const args = parseArgs(["latest", "python", "release"]);
	assert.equal(args.query, "latest python release");
	assert.equal(args.purpose, "general research support");
	assert.equal(args.json, false);
	assert.equal(args.model, undefined);
});

test("parseArgs reads flags in both --flag value and --flag=value forms", () => {
	const a = parseArgs(["--model", "gpt-5.6-terra", "--purpose", "migration notes", "query one"]);
	assert.equal(a.model, "gpt-5.6-terra");
	assert.equal(a.purpose, "migration notes");
	assert.equal(a.query, "query one");

	const b = parseArgs(["--model=gpt-5.6-sol", "--purpose=why", "--json", "query two"]);
	assert.equal(b.model, "gpt-5.6-sol");
	assert.equal(b.purpose, "why");
	assert.equal(b.json, true);
	assert.equal(b.query, "query two");
});

test("parseArgs sets help when -h/--help is present", () => {
	assert.equal(parseArgs(["--help"]).help, true);
	assert.equal(parseArgs(["-h"]).help, true);
});

test("a non-numeric --timeout is rejected instead of crashing later", () => {
	assert.throws(() => parseArgs(["q", "--timeout", "abc"]), /timeout/i);
	assert.throws(() => parseArgs(["q", "--timeout=abc"]), /timeout/i);
});

test("a valid --timeout is honoured and clamped to a sane floor", () => {
	assert.equal(parseArgs(["q", "--timeout", "5000"]).timeoutMs, 5000);
	assert.equal(parseArgs(["q", "--timeout", "10"]).timeoutMs, 1000);
});

test("usage names the required env var and the default model", () => {
	assert.match(usage(), /OPENAI_API_KEY/);
	assert.match(usage(), /gpt-5\.6-luna/);
});

test("resolveApiKey reads OPENAI_API_KEY from the environment", () => {
	assert.equal(resolveApiKey({ OPENAI_API_KEY: "sk-test" }), "sk-test");
});

test("a missing OPENAI_API_KEY is reported by name", () => {
	assert.throws(() => resolveApiKey({}), /OPENAI_API_KEY/);
});

test("buildRequestBody enables the web_search tool and carries the prompt", () => {
	const body = buildRequestBody({ model: "gpt-5.6-luna", query: "vite 7 breaking changes", purpose: "upgrade plan" });
	assert.equal(body.model, "gpt-5.6-luna");
	assert.deepEqual(body.tools, [{ type: "web_search" }]);
	assert.equal(body.tool_choice, "auto");
	assert.ok(body.input.some((m) => m.role === "user" && m.content.includes("vite 7 breaking changes")));
	assert.ok(body.input.some((m) => m.role === "user" && m.content.includes("upgrade plan")));
});

test("extractResult pulls the message text from a real response", () => {
	const { text } = extractResult(sample);
	assert.ok(text.length > 0);
	assert.ok(/Node\.js/i.test(text));
});

test("extractResult collects and dedupes url citations", () => {
	const { citations } = extractResult(sample);
	assert.ok(citations.length >= 2);
	for (const c of citations) {
		assert.ok(c.url.startsWith("https://"));
		assert.ok(typeof c.title === "string");
	}
	const urls = citations.map((c) => c.url);
	assert.equal(new Set(urls).size, urls.length, "citations should be deduped by url");
});

test("extractResult reports how many web searches ran", () => {
	assert.ok(extractResult(sample).searchCount >= 1);
});

test("extractResult throws on a failed response", () => {
	assert.throws(() => extractResult({ status: "failed", error: { message: "boom" } }), /boom/);
});

test("extractResult throws when no message text is present", () => {
	assert.throws(() => extractResult({ status: "completed", output: [{ type: "reasoning" }] }), /no text/i);
});

test("an incomplete response is rejected, not passed off as a full summary", () => {
	const truncated = { ...sample, status: "incomplete" };
	assert.throws(() => extractResult(truncated), /incomplete/);
});

test("formatOutput appends a deduped Citations section", () => {
	const out = formatOutput({
		text: "Some summary.",
		citations: [
			{ title: "A", url: "https://a.example/" },
			{ title: "B", url: "https://b.example/" },
		],
	});
	assert.ok(out.includes("Some summary."));
	assert.ok(out.includes("Citations"));
	assert.ok(out.includes("https://a.example/"));
	assert.ok(out.includes("https://b.example/"));
});

test("formatOutput omits the Citations section when there are none", () => {
	const out = formatOutput({ text: "No sources.", citations: [] });
	assert.ok(out.includes("No sources."));
	assert.ok(!/Citations/.test(out));
});
