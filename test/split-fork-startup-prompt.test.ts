import assert from "node:assert/strict";
import test from "node:test";

import { registerSplitFork, buildPiStartupInput } from "../extensions/split-fork/index.ts";

type SplitForkExtensionStub = {
	handlers: Map<string, (...args: unknown[]) => unknown>;
	sentMessages: string[];
	on: (event: string, handler: (...args: unknown[]) => unknown) => void;
	registerCommand: (...args: unknown[]) => void;
	sendUserMessage: (message: string) => void;
};

function createSplitForkExtensionStub(): SplitForkExtensionStub {
	return {
		handlers: new Map(),
		sentMessages: [],
		on(event: string, handler: (...args: unknown[]) => unknown) {
			this.handlers.set(event, handler);
		},
		registerCommand() {},
		sendUserMessage(message: string) {
			this.sentMessages.push(message);
		},
	};
}

test("buildPiStartupInput passes prompt through env instead of CLI args", () => {
	const prompt = "--model dangerous";
	const startupInput = buildPiStartupInput("/tmp/session.jsonl", prompt);

	assert.match(startupInput, /PI_SPLIT_FORK_STARTUP_PROMPT_B64=/);
	assert.doesNotMatch(startupInput, / --model dangerous/);
	assert.doesNotMatch(startupInput, /'--model dangerous'/);
	assert.doesNotMatch(startupInput, /\s--\s/);
});

test("split-fork sends startup prompt from env on session start", async () => {
	const previousPrompt = process.env.PI_SPLIT_FORK_STARTUP_PROMPT_B64;
	process.env.PI_SPLIT_FORK_STARTUP_PROMPT_B64 = Buffer.from("--model dangerous", "utf8").toString("base64");

	try {
		const pi = createSplitForkExtensionStub();
		registerSplitFork(pi);

		const sessionStart = pi.handlers.get("session_start");
		assert.ok(sessionStart);
		await sessionStart?.({}, {});

		assert.deepEqual(pi.sentMessages, ["--model dangerous"]);
		assert.equal(process.env.PI_SPLIT_FORK_STARTUP_PROMPT_B64, undefined);
	} finally {
		if (previousPrompt === undefined) delete process.env.PI_SPLIT_FORK_STARTUP_PROMPT_B64;
		else process.env.PI_SPLIT_FORK_STARTUP_PROMPT_B64 = previousPrompt;
	}
});
