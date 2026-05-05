import assert from "node:assert/strict";
import test from "node:test";

import notifyExtension, {
	handleAgentEnd,
	getCompletionSoundCommand,
} from "../extensions/notify.ts";

type ExecCall = {
	command: string;
	args: string[];
};

type ExecResult = {
	code: number;
	stdout?: string;
	stderr?: string;
};

type PiStub = {
	execCalls: ExecCall[];
	agentEndHandler: (() => Promise<void>) | null;
	exec: (command: string, args: string[]) => Promise<ExecResult>;
	on: (event: string, handler: () => Promise<void>) => void;
};

function createPiStub(execResult: ExecResult = { code: 0 }): PiStub {
	const execCalls: ExecCall[] = [];
	let agentEndHandler: (() => Promise<void>) | null = null;

	return {
		execCalls,
		get agentEndHandler() {
			return agentEndHandler;
		},
		set agentEndHandler(handler: (() => Promise<void>) | null) {
			agentEndHandler = handler;
		},
		exec: async (command: string, args: string[]) => {
			execCalls.push({ command, args });
			return execResult;
		},
		on: (event: string, handler: () => Promise<void>) => {
			if (event === "agent_end") {
				agentEndHandler = handler;
			}
		},
	};
}

test("handleAgentEnd sends OSC 777 notification and macOS sound", async () => {
	const pi = createPiStub();
	const stdoutWrites: string[] = [];
	const windowsToasts: Array<{ title: string; body: string }> = [];

	await handleAgentEnd(pi, {
		platform: "darwin",
		env: {},
		stdoutWrite: (chunk) => {
			stdoutWrites.push(chunk);
		},
		sendWindowsToast: (title, body) => {
			windowsToasts.push({ title, body });
		},
	});

	assert.deepEqual(stdoutWrites, ["\u001b]777;notify;Pi;Ready for input\u0007"]);
	assert.deepEqual(windowsToasts, []);
	assert.deepEqual(pi.execCalls, [
		{ command: "afplay", args: ["/System/Library/Sounds/Glass.aiff"] },
	]);
});

test("handleAgentEnd uses Kitty notifications and still plays macOS sound", async () => {
	const pi = createPiStub();
	const stdoutWrites: string[] = [];

	await handleAgentEnd(pi, {
		platform: "darwin",
		env: { KITTY_WINDOW_ID: "kitty-window" },
		stdoutWrite: (chunk) => {
			stdoutWrites.push(chunk);
		},
		sendWindowsToast: () => {
			throw new Error("Windows toast should not be used for Kitty");
		},
	});

	assert.deepEqual(stdoutWrites, [
		"\u001b]99;i=1:d=0;Pi\u001b\\",
		"\u001b]99;i=1:p=body;Ready for input\u001b\\",
	]);
	assert.deepEqual(pi.execCalls, [
		{ command: "afplay", args: ["/System/Library/Sounds/Glass.aiff"] },
	]);
});

test("handleAgentEnd uses Windows toast and skips sound on non-macOS", async () => {
	const pi = createPiStub();
	const stdoutWrites: string[] = [];
	const windowsToasts: Array<{ title: string; body: string }> = [];

	await handleAgentEnd(pi, {
		platform: "win32",
		env: { WT_SESSION: "wt" },
		stdoutWrite: (chunk) => {
			stdoutWrites.push(chunk);
		},
		sendWindowsToast: (title, body) => {
			windowsToasts.push({ title, body });
		},
	});

	assert.deepEqual(stdoutWrites, []);
	assert.deepEqual(windowsToasts, [{ title: "Pi", body: "Ready for input" }]);
	assert.deepEqual(pi.execCalls, []);
});

test("getCompletionSoundCommand leaves a Linux hook for future support", () => {
	assert.deepEqual(getCompletionSoundCommand("darwin"), {
		command: "afplay",
		args: ["/System/Library/Sounds/Glass.aiff"],
	});
	assert.equal(getCompletionSoundCommand("linux"), null);
});

test("default extension registers agent_end handler", async () => {
	const pi = createPiStub();
	notifyExtension(pi);

	assert.ok(pi.agentEndHandler);
});
