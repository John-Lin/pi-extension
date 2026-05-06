import assert from "node:assert/strict";
import test from "node:test";

import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";

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

function createThemeStub() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		strikethrough: (text: string) => text,
		underline: (text: string) => text,
	};
}

test("btw opens a bottom overlay and answers from the current branch context", async () => {
	const faux = registerFauxProvider({
		models: [{ id: "btw-test-model" }],
		tokensPerSecond: 0,
		tokenSize: { min: 32, max: 32 },
	});
	let capturedContext: unknown;
	faux.setResponses([
		(context) => {
			capturedContext = context;
			return fauxAssistantMessage("Bottom overlay answer");
		},
	]);

	try {
		const pi = createExtensionStub();
		btwExtension(pi as never);
		const command = pi.commands.get("btw");
		assert.ok(command);

		let overlayOptions: unknown;
		let rendered = "";
		let renderRequests = 0;
		const fakeTui = {
			requestRender() {
				renderRequests++;
			},
			terminal: {
				rows: 40,
				columns: 120,
			},
		};
		const theme = createThemeStub();

		await command?.handler("Can you summarize this?", {
			hasUI: true,
			model: faux.getModel(),
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return { ok: true, apiKey: "fake-key", headers: { "x-test": "1" } };
				},
			},
			sessionManager: {
				getBranch() {
					return [
						{
							type: "message",
							message: {
								role: "user",
								content: [{ type: "text", text: "What changed?" }],
								timestamp: Date.now() - 2,
							},
						},
						{
							type: "message",
							message: {
								role: "assistant",
								content: [{ type: "text", text: "The build was updated." }],
								api: faux.api,
								provider: faux.getModel().provider,
								model: faux.getModel().id,
								usage: {
									input: 0,
									output: 0,
									cacheRead: 0,
									cacheWrite: 0,
									totalTokens: 0,
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
								},
								stopReason: "stop",
								timestamp: Date.now() - 1,
							},
						},
						{ type: "custom", customType: "btw-marker" },
					];
				},
			},
			ui: {
				notify() {},
				async custom(factory: (...args: unknown[]) => { render: (width: number) => string[] }, options: unknown) {
					overlayOptions = options;
					let close!: () => void;
					const closed = new Promise<void>((resolve) => {
						close = resolve;
					});
					const component = factory(fakeTui, theme, {}, close);
					await new Promise((resolve) => setTimeout(resolve, 0));
					await new Promise((resolve) => setTimeout(resolve, 0));
					rendered = component.render(80).join("\n");
					close();
					return closed;
				},
			},
		});

		assert.deepEqual((capturedContext as { messages: Array<{ role: string }> }).messages.map((message) => message.role), [
			"user",
			"assistant",
			"user",
		]);
		assert.equal(
			((capturedContext as { messages: Array<{ role: string; content: Array<{ type: string; text: string }> }> }).messages.at(-1)
				?.content.at(0)?.text),
			"Can you summarize this?",
		);
		assert.equal((capturedContext as { tools?: unknown }).tools, undefined);
		assert.match((capturedContext as { systemPrompt?: string }).systemPrompt ?? "", /one-shot side assistant/i);
		assert.match(rendered, /\/btw Can you summarize this\?/);
		assert.doesNotMatch(rendered, /Q:/);
		assert.match(rendered, /Bottom overlay answer/);
		assert.ok(renderRequests > 0);
		assert.deepEqual(overlayOptions, {
			overlay: true,
			overlayOptions: {
				anchor: "bottom-center",
				width: "100%",
				maxHeight: "40%",
				margin: { left: 0, right: 0, bottom: 0 },
			},
		});
	} finally {
		faux.unregister();
	}
});
