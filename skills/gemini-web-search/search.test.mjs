import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRequestBody, parseArgs } from "./search.mjs";

test("parseArgs defaults thinking level to medium and accepts an override", () => {
	assert.equal(parseArgs(["q"]).thinkingLevel, "medium");
	assert.equal(parseArgs(["--thinking", "high", "q"]).thinkingLevel, "high");
	assert.equal(parseArgs(["--thinking=low", "q"]).thinkingLevel, "low");
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
