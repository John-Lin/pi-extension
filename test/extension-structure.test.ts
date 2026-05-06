import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
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
	assert.equal(pi.commands.get("btw")?.description, "Ask a quick side question without interrupting the main conversation");
});

test("btw helper modules stay importable from the directory layout", async () => {
	const panelModule = await import("../extensions/btw/panel.ts");

	assert.equal(typeof panelModule.BtwBottomOverlay, "function");
});

test("btw directory only keeps the overlay entrypoint and panel helper", async () => {
	const files = (await readdir(new URL("../extensions/btw", import.meta.url))).filter((file) => file.endsWith(".ts")).sort();

	assert.deepEqual(files, ["index.ts", "panel.ts"]);
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
