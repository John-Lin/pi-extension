import assert from "node:assert/strict";
import test from "node:test";

import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@mariozechner/pi-ai";
import { SessionManager } from "@mariozechner/pi-coding-agent";

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

function createUserTextMessage(text: string, timestamp = Date.now()) {
	return {
		role: "user" as const,
		content: [{ type: "text" as const, text }],
		timestamp,
	};
}

function createAssistantTextMessage(text: string, faux: ReturnType<typeof registerFauxProvider>, timestamp = Date.now()) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
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
		stopReason: "stop" as const,
		timestamp,
	};
}

function createAssistantMessageWithStop(
	stopReason: "stop" | "length" | "toolUse" | "error" | "aborted",
	content: Array<{ type: string; [k: string]: unknown }>,
	faux: ReturnType<typeof registerFauxProvider>,
	timestamp = Date.now(),
) {
	return {
		role: "assistant" as const,
		content,
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
		stopReason,
		timestamp,
	};
}

function extractTextFromContent(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

function createUiHarness() {
	const notifications: Array<{ message: string; level: string }> = [];
	let overlayOptions: unknown;
	let rendered = "";
	let renderRequests = 0;
	let openedOverlay = false;
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

	return {
		notifications,
		get overlayOptions() {
			return overlayOptions;
		},
		get rendered() {
			return rendered;
		},
		get renderRequests() {
			return renderRequests;
		},
		get openedOverlay() {
			return openedOverlay;
		},
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
			async custom(factory: (...args: unknown[]) => { render: (width: number) => string[] }, options: unknown) {
				openedOverlay = true;
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
	};
}

test("btw opens a bottom overlay and answers from the current session context", async () => {
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

		const sessionManager = SessionManager.inMemory(process.cwd());
		sessionManager.appendMessage(createUserTextMessage("What changed?", Date.now() - 2));
		sessionManager.appendMessage(createAssistantTextMessage("The build was updated.", faux, Date.now() - 1));
		const uiHarness = createUiHarness();

		await command?.handler("Can you summarize this?", {
			hasUI: true,
			model: faux.getModel(),
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return { ok: true, apiKey: "fake-key", headers: { "x-test": "1" } };
				},
			},
			sessionManager,
			ui: uiHarness.ui,
		});

		assert.deepEqual((capturedContext as { messages: Array<{ role: string }> }).messages.map((message) => message.role), [
			"user",
			"assistant",
			"user",
		]);
		const lastUserText = (capturedContext as { messages: Array<{ role: string; content: Array<{ type: string; text: string }> }> }).messages.at(-1)
			?.content.at(0)?.text ?? "";
		assert.match(lastUserText, /Can you summarize this\?/);
		assert.match(lastUserText, /<system-reminder>/);
		assert.match(lastUserText, /main agent is NOT interrupted/i);
		assert.match(lastUserText, /NO tools available/i);
		assert.match(lastUserText, /Let me try/);
		assert.match(lastUserText, /<\/system-reminder>/);
		assert.equal((capturedContext as { tools?: unknown }).tools, undefined);
		assert.match((capturedContext as { systemPrompt?: string }).systemPrompt ?? "", /one-shot side assistant/i);
		assert.match(uiHarness.rendered, /\/btw Can you summarize this\?/);
		assert.doesNotMatch(uiHarness.rendered, /Q:/);
		assert.match(uiHarness.rendered, /Bottom overlay answer/);
		assert.ok(uiHarness.renderRequests > 0);
		assert.deepEqual(uiHarness.overlayOptions, {
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

test("btw resolves compacted session context before asking the follow-up question", async () => {
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

		const sessionManager = SessionManager.inMemory(process.cwd());
		sessionManager.appendMessage(createUserTextMessage("old question", Date.now() - 4));
		sessionManager.appendMessage(createAssistantTextMessage("old answer", faux, Date.now() - 3));
		const recentUserId = sessionManager.appendMessage(createUserTextMessage("recent question", Date.now() - 2));
		sessionManager.appendMessage(createAssistantTextMessage("recent answer", faux, Date.now() - 1));
		sessionManager.appendCompaction("summary of earlier conversation", recentUserId, 123);
		const uiHarness = createUiHarness();

		await command?.handler("What should I do next?", {
			hasUI: true,
			model: faux.getModel(),
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return { ok: true, apiKey: "fake-key" };
				},
			},
			sessionManager,
			ui: uiHarness.ui,
		});

		const texts = (capturedContext as { messages: Array<{ content: string | Array<{ type: string; text?: string }> }> }).messages.map(
			(message) => extractTextFromContent(message.content),
		);
		assert.equal(texts.some((text) => text.includes("old question")), false);
		assert.equal(texts.some((text) => text.includes("old answer")), false);
		assert.ok(texts.some((text) => text.includes("summary of earlier conversation")));
		assert.ok(texts.some((text) => text.includes("recent question")));
		assert.ok(texts.some((text) => text.includes("recent answer")));
		assert.ok(texts.some((text) => text.includes("What should I do next?")));
	} finally {
		faux.unregister();
	}
});

test("btw accepts request auth that only provides headers", async () => {
	const faux = registerFauxProvider({
		models: [{ id: "btw-test-model" }],
		tokensPerSecond: 0,
		tokenSize: { min: 32, max: 32 },
	});
	faux.setResponses([() => fauxAssistantMessage("Header-only auth works")]);

	try {
		const pi = createExtensionStub();
		btwExtension(pi as never);
		const command = pi.commands.get("btw");
		assert.ok(command);

		const sessionManager = SessionManager.inMemory(process.cwd());
		sessionManager.appendMessage(createUserTextMessage("What changed?"));
		const uiHarness = createUiHarness();

		await command?.handler("Can you summarize this?", {
			hasUI: true,
			model: faux.getModel(),
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return { ok: true, headers: { Authorization: "Bearer token" } };
				},
			},
			sessionManager,
			ui: uiHarness.ui,
		});

		assert.equal(uiHarness.openedOverlay, true);
		assert.deepEqual(uiHarness.notifications, []);
		assert.match(uiHarness.rendered, /Header-only auth works/);
	} finally {
		faux.unregister();
	}
});

test("btw uses the main agent system prompt for cache alignment when available", async () => {
	const faux = registerFauxProvider({
		models: [{ id: "btw-test-model" }],
		tokensPerSecond: 0,
		tokenSize: { min: 32, max: 32 },
	});
	let capturedContext: unknown;
	faux.setResponses([
		(context) => {
			capturedContext = context;
			return fauxAssistantMessage("ok");
		},
	]);

	try {
		const pi = createExtensionStub();
		btwExtension(pi as never);
		const command = pi.commands.get("btw");
		assert.ok(command);

		const sessionManager = SessionManager.inMemory(process.cwd());
		sessionManager.appendMessage(createUserTextMessage("hi"));
		const uiHarness = createUiHarness();
		const mainSystemPrompt = "MAIN_AGENT_SYSTEM_PROMPT_BYTES_FOR_CACHE";

		await command?.handler("Quick question", {
			hasUI: true,
			model: faux.getModel(),
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return { ok: true, apiKey: "fake-key" };
				},
			},
			sessionManager,
			ui: uiHarness.ui,
			getSystemPrompt: () => mainSystemPrompt,
		});

		assert.equal((capturedContext as { systemPrompt?: string }).systemPrompt, mainSystemPrompt);
		const lastUserText = (capturedContext as { messages: Array<{ content: Array<{ type: string; text: string }> }> }).messages.at(-1)
			?.content.at(0)?.text ?? "";
		assert.match(lastUserText, /<system-reminder>/);
		assert.match(lastUserText, /Quick question/);
	} finally {
		faux.unregister();
	}
});

async function runBtwAndCaptureMessages(
	sessionSetup: (sessionManager: SessionManager, faux: ReturnType<typeof registerFauxProvider>) => void,
	question = "Quick question",
): Promise<Array<{ role: string }>> {
	const faux = registerFauxProvider({
		models: [{ id: "btw-test-model" }],
		tokensPerSecond: 0,
		tokenSize: { min: 32, max: 32 },
	});
	let capturedContext: { messages: Array<{ role: string }> } | undefined;
	faux.setResponses([
		(context) => {
			capturedContext = context as { messages: Array<{ role: string }> };
			return fauxAssistantMessage("ok");
		},
	]);

	try {
		const pi = createExtensionStub();
		btwExtension(pi as never);
		const command = pi.commands.get("btw");
		assert.ok(command);

		const sessionManager = SessionManager.inMemory(process.cwd());
		sessionSetup(sessionManager, faux);
		const uiHarness = createUiHarness();

		await command?.handler(question, {
			hasUI: true,
			model: faux.getModel(),
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return { ok: true, apiKey: "fake-key" };
				},
			},
			sessionManager,
			ui: uiHarness.ui,
		});

		assert.ok(capturedContext, "expected provider to be called");
		return capturedContext!.messages;
	} finally {
		faux.unregister();
	}
}

test("btw drops a trailing aborted assistant message before sending", async () => {
	const messages = await runBtwAndCaptureMessages((sessionManager, faux) => {
		sessionManager.appendMessage(createUserTextMessage("user q"));
		sessionManager.appendMessage(
			createAssistantMessageWithStop("aborted", [{ type: "text", text: "partial..." }], faux),
		);
	});

	assert.deepEqual(messages.map((m) => m.role), ["user", "user"]);
});

test("btw drops a trailing error assistant message before sending", async () => {
	const messages = await runBtwAndCaptureMessages((sessionManager, faux) => {
		sessionManager.appendMessage(createUserTextMessage("user q"));
		sessionManager.appendMessage(
			createAssistantMessageWithStop("error", [{ type: "text", text: "boom" }], faux),
		);
	});

	assert.deepEqual(messages.map((m) => m.role), ["user", "user"]);
});

test("btw drops a trailing toolUse assistant message with no following toolResult", async () => {
	const messages = await runBtwAndCaptureMessages((sessionManager, faux) => {
		sessionManager.appendMessage(createUserTextMessage("user q"));
		sessionManager.appendMessage(
			createAssistantMessageWithStop(
				"toolUse",
				[{ type: "toolCall", id: "t1", name: "read", arguments: {} }],
				faux,
			),
		);
	});

	assert.deepEqual(messages.map((m) => m.role), ["user", "user"]);
});

test("btw preserves a clean trailing assistant message", async () => {
	const messages = await runBtwAndCaptureMessages((sessionManager, faux) => {
		sessionManager.appendMessage(createUserTextMessage("user q"));
		sessionManager.appendMessage(createAssistantTextMessage("clean answer", faux));
	});

	assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user"]);
});

test("btw surfaces a friendly fallback when the model emits only a tool call", async () => {
	const faux = registerFauxProvider({
		models: [{ id: "btw-test-model" }],
		tokensPerSecond: 0,
		tokenSize: { min: 32, max: 32 },
	});
	faux.setResponses([
		() =>
			fauxAssistantMessage([fauxToolCall("read_file", { path: "x" })], {
				stopReason: "toolUse",
			}),
	]);

	try {
		const pi = createExtensionStub();
		btwExtension(pi as never);
		const command = pi.commands.get("btw");
		assert.ok(command);

		const sessionManager = SessionManager.inMemory(process.cwd());
		sessionManager.appendMessage(createUserTextMessage("hi"));
		const uiHarness = createUiHarness();

		await command?.handler("Tell me", {
			hasUI: true,
			model: faux.getModel(),
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return { ok: true, apiKey: "fake-key" };
				},
			},
			sessionManager,
			ui: uiHarness.ui,
		});

		assert.match(uiHarness.rendered, /tried to call/i);
		assert.match(uiHarness.rendered, /read_file/);
		assert.doesNotMatch(uiHarness.rendered, /No answer returned/);
	} finally {
		faux.unregister();
	}
});

test("btw forwards the current session thinking level to the model request", async () => {
	const faux = registerFauxProvider({
		models: [{ id: "btw-test-model", reasoning: true }],
		tokensPerSecond: 0,
		tokenSize: { min: 32, max: 32 },
	});
	let capturedOptions: unknown;
	faux.setResponses([
		(_context, options) => {
			capturedOptions = options;
			return fauxAssistantMessage("Thinking level carried over");
		},
	]);

	try {
		const pi = createExtensionStub();
		btwExtension(pi as never);
		const command = pi.commands.get("btw");
		assert.ok(command);

		const sessionManager = SessionManager.inMemory(process.cwd());
		sessionManager.appendThinkingLevelChange("high");
		sessionManager.appendMessage(createUserTextMessage("What changed?"));
		const uiHarness = createUiHarness();

		await command?.handler("Can you summarize this?", {
			hasUI: true,
			model: faux.getModel(),
			modelRegistry: {
				async getApiKeyAndHeaders() {
					return { ok: true, apiKey: "fake-key" };
				},
			},
			sessionManager,
			ui: uiHarness.ui,
		});

		assert.equal((capturedOptions as { reasoning?: string } | undefined)?.reasoning, "high");
	} finally {
		faux.unregister();
	}
});
