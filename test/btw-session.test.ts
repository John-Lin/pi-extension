import assert from "node:assert/strict";
import test from "node:test";

import btwExtension from "../extensions/btw/index.ts";

type RegisteredCommand = {
	description: string;
	handler: (...args: unknown[]) => unknown;
};

type ExtensionStub = {
	commands: Map<string, RegisteredCommand>;
	registerCommand: (name: string, command: RegisteredCommand) => void;
};

function createExtensionStub(): ExtensionStub {
	return {
		commands: new Map(),
		registerCommand(name: string, command: RegisteredCommand) {
			this.commands.set(name, command);
		},
	};
}

test("btw requires a prompt before opening the overlay", async () => {
	const pi = createExtensionStub();
	btwExtension(pi as never);
	const command = pi.commands.get("btw");
	assert.ok(command);

	const notifications: Array<{ message: string; level: string }> = [];
	let openedOverlay = false;

	await command?.handler("   ", {
		hasUI: true,
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
			async custom() {
				openedOverlay = true;
			},
		},
	});

	assert.equal(openedOverlay, false);
	assert.deepEqual(notifications, [
		{
			message: "Usage: /btw <question>. BTW panes require a question at launch.",
			level: "warning",
		},
	]);
});

test("btw requires interactive mode for the bottom overlay UI", async () => {
	const pi = createExtensionStub();
	btwExtension(pi as never);
	const command = pi.commands.get("btw");
	assert.ok(command);

	const notifications: Array<{ message: string; level: string }> = [];

	await command?.handler("What changed?", {
		hasUI: false,
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
		},
	});

	assert.deepEqual(notifications, [
		{
			message: "/btw requires interactive mode.",
			level: "warning",
		},
	]);
});
