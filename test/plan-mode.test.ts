import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("plan-mode entrypoint exposes the plan command and flag", async () => {
	const source = await readFile(new URL("../extensions/plan-mode/index.ts", import.meta.url), "utf8");

	assert.match(source, /registerCommand\("plan"/);
	assert.match(source, /registerCommand\("todos"/);
	assert.match(source, /registerFlag\("plan"/);
});

test("plan-mode utilities extract plan steps and block destructive commands", async () => {
	const utils = await import("../extensions/plan-mode/utils.ts");

	assert.equal(utils.isSafeCommand("rg TODO src"), true);
	assert.equal(utils.isSafeCommand("rm -rf /tmp/foo"), false);
	assert.deepEqual(
		utils.extractTodoItems("Plan:\n1. Inspect the command parser\n2. Update the UI status widget"),
		[
			{ step: 1, text: "Inspect the command parser", completed: false },
			{ step: 2, text: "UI status widget", completed: false },
		],
	);
});
