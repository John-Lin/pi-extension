import { test } from "node:test";
import assert from "node:assert/strict";

import { buildAnthropicRequestBody, buildCodexRequestBody, parseArgs } from "./search.mjs";

test("parseArgs defaults OpenAI thinking effort to medium and accepts both thinking options", () => {
	const defaults = parseArgs(["q"]);
	assert.equal(defaults.thinkingEffort, "medium");
	assert.equal(defaults.thinkingBudget, undefined);
	assert.equal(parseArgs(["--thinking", "high", "q"]).thinkingEffort, "high");
	assert.equal(parseArgs(["--thinking-budget=1024", "q"]).thinkingBudget, 1024);
	assert.throws(() => parseArgs(["--thinking-budget=invalid", "q"]), /at least 1024/);
	assert.throws(() => parseArgs(["--thinking-budget=1023", "q"]), /at least 1024/);
});

test("buildCodexRequestBody sends the selected reasoning effort", () => {
	const body = buildCodexRequestBody({
		model: "gpt-5.6-luna",
		query: "vite 7 breaking changes",
		purpose: "upgrade plan",
		thinkingEffort: "high",
	});
	assert.deepEqual(body.reasoning, { effort: "high" });
});

test("buildAnthropicRequestBody sends a thinking budget only when requested", () => {
	const withoutBudget = buildAnthropicRequestBody({
		model: "claude-haiku-4-5",
		query: "vite 7 breaking changes",
		purpose: "upgrade plan",
	});
	const withBudget = buildAnthropicRequestBody({
		model: "claude-haiku-4-5",
		query: "vite 7 breaking changes",
		purpose: "upgrade plan",
		thinkingBudget: 1024,
	});
	assert.equal(withoutBudget.thinking, undefined);
	assert.deepEqual(withBudget.thinking, { type: "enabled", budget_tokens: 1024 });
	assert.throws(
		() =>
			buildAnthropicRequestBody({
				model: "claude-haiku-4-5",
				query: "q",
				purpose: "p",
				thinkingBudget: 16000,
			}),
		/less than 16000/,
	);
});
