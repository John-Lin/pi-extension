import assert from "node:assert/strict";
import test from "node:test";

type RegisteredCommand = {
	description: string;
	handler: (...args: unknown[]) => unknown;
};

type ExtensionStub = {
	commands: Map<string, RegisteredCommand>;
	events: string[];
	registerCommand: (name: string, command: RegisteredCommand) => void;
	on: (event: string, handler: (...args: unknown[]) => unknown) => void;
};

function createExtensionStub(): ExtensionStub {
	return {
		commands: new Map(),
		events: [],
		registerCommand(name: string, command: RegisteredCommand) {
			this.commands.set(name, command);
		},
		on(event: string) {
			this.events.push(event);
		},
	};
}

test("btw directory entrypoint registers the btw command", async () => {
	const module = await import("../extensions/btw/index.ts");
	const pi = createExtensionStub();

	module.default(pi);

	assert.ok(pi.commands.has("btw"));
});

test("btw helper modules stay importable from the directory layout", async () => {
	const sessionModule = await import("../extensions/btw/session.ts");

	assert.equal(sessionModule.BTW_MARKER_TYPE, "btw-marker");
	assert.equal(sessionModule.hasUsedBtwQuestion([]), false);
});

test("split-fork directory entrypoint registers the split-fork command", async () => {
	const module = await import("../extensions/split-fork/index.ts");
	const pi = createExtensionStub();

	module.default(pi);

	assert.ok(pi.commands.has("split-fork"));
});

test("split-fork helper modules stay importable from the directory layout", async () => {
	const layoutModule = await import("../extensions/split-fork/layout.ts");

	assert.equal(layoutModule.getSplitDirectionForTerminalCount(1), "right");
	assert.equal(layoutModule.getSplitDirectionForTerminalCount(2), "down");
});
