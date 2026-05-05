import assert from "node:assert/strict";
import test from "node:test";

import childExtension from "../extensions/btw/child.ts";
import { buildBtwStartupCommand } from "../extensions/btw/launch.ts";

type ChildExtensionStub = {
	handlers: Map<string, (...args: unknown[]) => unknown>;
	sentMessages: string[];
	on: (event: string, handler: (...args: unknown[]) => unknown) => void;
	sendUserMessage: (message: string) => void;
};

function createChildExtensionStub(): ChildExtensionStub {
	return {
		handlers: new Map(),
		sentMessages: [],
		on(event: string, handler: (...args: unknown[]) => unknown) {
			this.handlers.set(event, handler);
		},
		sendUserMessage(message: string) {
			this.sentMessages.push(message);
		},
	};
}

test("buildBtwStartupCommand passes prompt through env instead of CLI args", () => {
	const prompt = "--model dangerous";
	const command = buildBtwStartupCommand({
		sessionFile: "/tmp/session.jsonl",
		childExtensionPath: "/tmp/child.ts",
		prompt,
	});

	assert.match(command, /PI_BTW_STARTUP_PROMPT_B64=/);
	assert.doesNotMatch(command, / --model dangerous/);
	assert.doesNotMatch(command, /'--model dangerous'/);
	assert.doesNotMatch(command, /\s--\s/);
});

test("btw child sends startup prompt from env on session start", async () => {
	const previousSession = process.env.PI_BTW_TEMP_SESSION;
	const previousPrompt = process.env.PI_BTW_STARTUP_PROMPT_B64;
	process.env.PI_BTW_TEMP_SESSION = "/tmp/btw-session.jsonl";
	process.env.PI_BTW_STARTUP_PROMPT_B64 = Buffer.from("--model dangerous", "utf8").toString("base64");

	try {
		const pi = createChildExtensionStub();
		childExtension(pi);

		const sessionStart = pi.handlers.get("session_start");
		assert.ok(sessionStart);
		await sessionStart?.({}, { hasUI: false });

		assert.deepEqual(pi.sentMessages, ["--model dangerous"]);
		assert.equal(process.env.PI_BTW_STARTUP_PROMPT_B64, undefined);
	} finally {
		if (previousSession === undefined) delete process.env.PI_BTW_TEMP_SESSION;
		else process.env.PI_BTW_TEMP_SESSION = previousSession;
		if (previousPrompt === undefined) delete process.env.PI_BTW_STARTUP_PROMPT_B64;
		else process.env.PI_BTW_STARTUP_PROMPT_B64 = previousPrompt;
	}
});

test("btw child hides the editor and does not gate user input", async () => {
	const previousSession = process.env.PI_BTW_TEMP_SESSION;
	process.env.PI_BTW_TEMP_SESSION = "/tmp/btw-session.jsonl";

	try {
		const pi = createChildExtensionStub();
		childExtension(pi);

		// Direction 2: input is dropped because the editor is hidden — no input gate.
		assert.equal(pi.handlers.has("input"), false);

		const setEditorCalls: unknown[] = [];
		const setFooterCalls: unknown[] = [];
		const sessionStart = pi.handlers.get("session_start");
		assert.ok(sessionStart);
		await sessionStart?.(
			{},
			{
				hasUI: true,
				ui: {
					setEditorComponent: (factory: unknown) => setEditorCalls.push(factory),
					setFooter: (factory: unknown) => setFooterCalls.push(factory),
					notify: () => {},
				},
			},
		);

		assert.equal(setEditorCalls.length, 1);
		assert.equal(typeof setEditorCalls[0], "function");
		assert.equal(setFooterCalls.length, 1);
		const footerFactory = setFooterCalls[0] as () => { render: (w: number) => string[] };
		assert.deepEqual(footerFactory().render(80), []);
	} finally {
		if (previousSession === undefined) delete process.env.PI_BTW_TEMP_SESSION;
		else process.env.PI_BTW_TEMP_SESSION = previousSession;
	}
});
