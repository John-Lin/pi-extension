import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRequestBody, parseArgs } from "./search.mjs";

test("parseArgs defaults thinking level to high and accepts an override", () => {
	assert.equal(parseArgs(["q"]).thinkingLevel, "high");
	assert.equal(parseArgs(["--thinking", "medium", "q"]).thinkingLevel, "medium");
	assert.equal(parseArgs(["--thinking=low", "q"]).thinkingLevel, "low");
});

test("buildRequestBody sends the selected Gemini thinking level", () => {
	const selectedLevel = buildRequestBody({
		model: "gemini-3.6-flash",
		query: "vite 7 breaking changes",
		purpose: "upgrade plan",
		thinkingLevel: "low",
	});
	const defaultLevel = buildRequestBody({
		model: "gemini-3.6-flash",
		query: "vite 7 breaking changes",
		purpose: "upgrade plan",
	});
	assert.deepEqual(selectedLevel.generation_config, { thinking_level: "low" });
	assert.deepEqual(defaultLevel.generation_config, { thinking_level: "high" });
});
