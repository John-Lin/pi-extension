import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import notifyExtension, {
	handleAgentSettled,
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

type AgentHandler = (event: unknown, ctx: Pick<ExtensionContext, "mode" | "hasUI">) => Promise<void>;

type PiStub = {
	execCalls: ExecCall[];
	registeredEvents: string[];
	agentSettledHandler: AgentHandler | null;
	exec: (command: string, args: string[]) => Promise<ExecResult>;
	on: (event: string, handler: AgentHandler) => void;
};

function createPiStub(execResult: ExecResult = { code: 0 }): PiStub {
	const execCalls: ExecCall[] = [];
	const registeredEvents: string[] = [];
	let agentSettledHandler: AgentHandler | null = null;

	return {
		execCalls,
		registeredEvents,
		get agentSettledHandler() {
			return agentSettledHandler;
		},
		exec: async (command: string, args: string[]) => {
			execCalls.push({ command, args });
			return execResult;
		},
		on: (event: string, handler: AgentHandler) => {
			registeredEvents.push(event);
			if (event === "agent_settled") {
				agentSettledHandler = handler;
			}
		},
	};
}

function setStdoutTTY(t: TestContext, isTTY: boolean | undefined): void {
	const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
	Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: isTTY });
	t.after(() => {
		if (descriptor) {
			Object.defineProperty(process.stdout, "isTTY", descriptor);
		} else {
			delete process.stdout.isTTY;
		}
	});
}

test("handleAgentSettled sends OSC 777 notification and macOS sound", async () => {
	const pi = createPiStub();
	const stdoutWrites: string[] = [];
	const windowsToasts: Array<{ title: string; body: string }> = [];

	await handleAgentSettled(pi, {
		mode: "tui",
		stdoutIsTTY: true,
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
		{ command: "afplay", args: ["/System/Library/Sounds/Blow.aiff"] },
	]);
});

test("handleAgentSettled uses Kitty notifications and still plays macOS sound", async () => {
	const pi = createPiStub();
	const stdoutWrites: string[] = [];

	await handleAgentSettled(pi, {
		mode: "tui",
		stdoutIsTTY: true,
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
		{ command: "afplay", args: ["/System/Library/Sounds/Blow.aiff"] },
	]);
});

test("handleAgentSettled uses Windows toast and skips sound on Windows", async () => {
	const pi = createPiStub();
	const stdoutWrites: string[] = [];
	const windowsToasts: Array<{ title: string; body: string }> = [];

	await handleAgentSettled(pi, {
		mode: "tui",
		stdoutIsTTY: true,
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

test("getCompletionSoundCommand returns platform completion sound commands", () => {
	assert.deepEqual(getCompletionSoundCommand("darwin"), {
		command: "afplay",
		args: ["/System/Library/Sounds/Blow.aiff"],
	});
	assert.deepEqual(getCompletionSoundCommand("linux"), {
		command: "paplay",
		args: ["/usr/share/sounds/freedesktop/stereo/complete.oga"],
	});
});

for (const mode of ["rpc", "json", "print"] as const) {
	for (const platform of ["darwin", "linux", "win32"] as const) {
		test(`completion is silent in ${mode} mode on ${platform}, even with a TTY`, async () => {
			const pi = createPiStub();
			const stdoutWrites: string[] = [];
			const stderrWrites: string[] = [];
			const windowsToasts: string[] = [];

			await handleAgentSettled(pi, {
				mode,
				stdoutIsTTY: true,
				platform,
				env: platform === "win32" ? { WT_SESSION: "wt" } : {},
				stdoutWrite: (chunk) => {
					stdoutWrites.push(chunk);
				},
				stderrWrite: (chunk) => {
					stderrWrites.push(chunk);
				},
				sendWindowsToast: (title, body) => {
					windowsToasts.push(`${title}: ${body}`);
				},
			});

			assert.deepEqual(stdoutWrites, []);
			assert.deepEqual(stderrWrites, []);
			assert.deepEqual(windowsToasts, []);
			assert.deepEqual(pi.execCalls, []);
		});
	}
}

test("completion is silent when TUI stdout is redirected", async () => {
	const pi = createPiStub();
	const stdoutWrites: string[] = [];

	await handleAgentSettled(pi, {
		mode: "tui",
		stdoutIsTTY: false,
		platform: "linux",
		env: {},
		stdoutWrite: (chunk) => {
			stdoutWrites.push(chunk);
		},
	});

	assert.deepEqual(stdoutWrites, []);
	assert.deepEqual(pi.execCalls, []);
});

for (const isTTY of [true, false, undefined]) {
	test(`completion uses the runtime stdout TTY flag (${isTTY})`, async (t) => {
		const pi = createPiStub();
		const stdoutWrites: string[] = [];
		setStdoutTTY(t, isTTY);

		await handleAgentSettled(pi, {
			mode: "tui",
			platform: "linux",
			env: {},
			stdoutWrite: (chunk) => {
				stdoutWrites.push(chunk);
			},
		});

		assert.deepEqual(stdoutWrites, isTTY ? ["\u001b]777;notify;Pi;Ready for input\u0007"] : []);
		assert.deepEqual(pi.execCalls, isTTY ? [
			{ command: "paplay", args: ["/usr/share/sounds/freedesktop/stereo/complete.oga"] },
		] : []);
	});
}

test("default extension registers agent_settled notification work", () => {
	const pi = createPiStub();
	notifyExtension(pi as unknown as ExtensionAPI);

	assert.ok(pi.agentSettledHandler);
	assert.deepEqual(pi.registeredEvents, ["agent_settled"]);
});

for (const mode of ["rpc", "json", "print"] as const) {
	test(`registered completion handler leaves ${mode} stdout and sound untouched`, async (t) => {
		const pi = createPiStub();
		const stdoutWrites: string[] = [];
		notifyExtension(pi as unknown as ExtensionAPI);
		assert.ok(pi.agentSettledHandler);
		setStdoutTTY(t, true);
		t.mock.method(process.stdout, "write", (chunk: string) => {
			stdoutWrites.push(chunk);
			return true;
		});

		await pi.agentSettledHandler({ type: "agent_settled" }, { mode, hasUI: mode === "rpc" });

		assert.deepEqual(stdoutWrites, []);
		assert.deepEqual(pi.execCalls, []);
	});
}
