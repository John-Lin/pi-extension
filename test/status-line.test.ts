import assert from "node:assert/strict";
import test from "node:test";

type EventHandler = (...args: unknown[]) => unknown;

type ExtensionStub = {
	handlers: Map<string, EventHandler>;
	on: (event: string, handler: EventHandler) => void;
};

function createExtensionStub(): ExtensionStub {
	return {
		handlers: new Map(),
		on(event: string, handler: EventHandler) {
			this.handlers.set(event, handler);
		},
	};
}

test("status-line registers session and turn lifecycle handlers", async () => {
	const module = await import("../extensions/status-line.ts");
	const pi = createExtensionStub();

	module.default(pi);

	assert.ok(pi.handlers.has("session_start"));
	assert.ok(pi.handlers.has("turn_start"));
	assert.ok(pi.handlers.has("turn_end"));
});
