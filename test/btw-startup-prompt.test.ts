import assert from "node:assert/strict";
import test from "node:test";

import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	InMemoryCredentialStore,
	type Message,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { ModelRegistry, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

import btwExtension from "../extensions/btw/index.ts";

type RegisteredCommand = {
	description: string;
	handler: (...args: unknown[]) => unknown;
};

type ExtensionStub = {
	commands: Map<string, RegisteredCommand>;
	registerCommand: (name: string, command: RegisteredCommand) => void;
};

type FauxProviderHandle = ReturnType<typeof fauxProvider>;

const MAIN_SYSTEM_PROMPT = "MAIN_AGENT_SYSTEM_PROMPT_BYTES_FOR_CACHE";

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

// A real model registry whose only provider is registered on the session model
// runtime, not in the global compat api-registry. This is how pi wires providers
// that extensions register, so a request that bypasses ctx.modelRegistry fails here.
async function createFauxModelRegistry(models: Array<{ id: string; reasoning?: boolean }> = [{ id: "btw-test-model" }]) {
	const faux = fauxProvider({ models, tokensPerSecond: 0, tokenSize: { min: 32, max: 32 } });
	const runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		refreshOnCreate: false,
	});
	runtime.registerNativeProvider(faux.provider);
	return { faux, modelRegistry: new ModelRegistry(runtime) };
}

function createUserTextMessage(text: string, timestamp = Date.now()) {
	return {
		role: "user" as const,
		content: [{ type: "text" as const, text }],
		timestamp,
	};
}

function createAssistantMessageWithStop(
	stopReason: "stop" | "length" | "toolUse" | "error" | "aborted",
	content: Array<{ type: string; [k: string]: unknown }>,
	faux: FauxProviderHandle,
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

function createAssistantTextMessage(text: string, faux: FauxProviderHandle, timestamp = Date.now()) {
	return createAssistantMessageWithStop("stop", [{ type: "text", text }], faux, timestamp);
}

function extractTextFromContent(content: Message["content"]): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
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
				// Wait for the streamed answer to settle; the panel status leaves
				// "answering" once the request finished or failed.
				for (let attempt = 0; attempt < 200; attempt++) {
					rendered = component.render(80).join("\n");
					if (!rendered.includes("BTW is answering")) {
						break;
					}
					await new Promise((resolve) => setTimeout(resolve, 5));
				}
				close();
				return closed;
			},
		},
	};
}

type BtwRun = {
	context: TranscriptContext | undefined;
	options: SimpleStreamOptions | undefined;
	ui: ReturnType<typeof createUiHarness>;
};

async function runBtw({
	question = "Quick question",
	models,
	response = fauxAssistantMessage("ok"),
	sessionSetup = (sessionManager) => sessionManager.appendMessage(createUserTextMessage("hi")),
	getSystemPrompt = () => MAIN_SYSTEM_PROMPT,
}: {
	question?: string;
	models?: Array<{ id: string; reasoning?: boolean }>;
	response?: ReturnType<typeof fauxAssistantMessage>;
	sessionSetup?: (sessionManager: SessionManager, faux: FauxProviderHandle) => void;
	getSystemPrompt?: () => string;
} = {}): Promise<BtwRun> {
	const { faux, modelRegistry } = await createFauxModelRegistry(models);
	const run: BtwRun = { context: undefined, options: undefined, ui: createUiHarness() };
	faux.setResponses([
		(context, options) => {
			run.context = context;
			run.options = options;
			return response;
		},
	]);

	const pi = createExtensionStub();
	btwExtension(pi as never);
	const command = pi.commands.get("btw");
	assert.ok(command);

	const sessionManager = SessionManager.inMemory(process.cwd());
	sessionSetup(sessionManager, faux);

	await command.handler(question, {
		mode: "tui",
		model: faux.getModel(),
		modelRegistry,
		sessionManager,
		ui: run.ui.ui,
		getSystemPrompt,
	});

	return run;
}

function roles(run: BtwRun): string[] {
	assert.ok(run.context, "expected provider to be called");
	return run.context.messages.map((message) => message.role);
}

test("btw opens a bottom overlay and answers from the current session context", async () => {
	const run = await runBtw({
		question: "Can you summarize this?",
		response: fauxAssistantMessage("Bottom overlay answer"),
		sessionSetup: (sessionManager, faux) => {
			sessionManager.appendMessage(createUserTextMessage("What changed?", Date.now() - 2));
			sessionManager.appendMessage(createAssistantTextMessage("The build was updated.", faux, Date.now() - 1));
		},
	});

	assert.deepEqual(roles(run), ["system", "user", "assistant", "user"]);
	const lastUserText = extractTextFromContent(run.context!.messages.at(-1)!.content);
	assert.match(lastUserText, /Can you summarize this\?/);
	assert.match(lastUserText, /<system-reminder>/);
	assert.match(lastUserText, /main agent is NOT interrupted/i);
	assert.match(lastUserText, /NO tools available/i);
	assert.match(lastUserText, /Let me try/);
	assert.match(lastUserText, /<\/system-reminder>/);
	assert.match(run.ui.rendered, /\/btw Can you summarize this\?/);
	assert.doesNotMatch(run.ui.rendered, /Q:/);
	assert.match(run.ui.rendered, /Bottom overlay answer/);
	assert.ok(run.ui.renderRequests > 0);
	assert.deepEqual(run.ui.notifications, []);
	assert.deepEqual(run.ui.overlayOptions, {
		overlay: true,
		overlayOptions: {
			anchor: "bottom-center",
			width: "100%",
			maxHeight: "100%",
			margin: { left: 0, right: 0, bottom: 0 },
		},
	});
});

test("btw sends the request through the session model registry", async () => {
	// The faux provider exists only on the session model runtime, as providers
	// registered by extensions do; resolving it elsewhere fails the request.
	const run = await runBtw({ response: fauxAssistantMessage("Registry-routed answer") });

	assert.ok(run.context, "expected provider to be called");
	assert.doesNotMatch(run.ui.rendered, /BTW request failed/);
	assert.match(run.ui.rendered, /Registry-routed answer/);
});

test("btw uses the main agent system prompt for cache alignment", async () => {
	const run = await runBtw();

	const systemMessage = run.context?.messages[0];
	assert.equal(systemMessage?.role, "system");
	assert.equal(extractTextFromContent(systemMessage.content), MAIN_SYSTEM_PROMPT);
	const lastUserText = extractTextFromContent(run.context!.messages.at(-1)!.content);
	assert.match(lastUserText, /<system-reminder>/);
	assert.match(lastUserText, /Quick question/);
});

test("btw falls back to its own system prompt when the main prompt is empty", async () => {
	const run = await runBtw({ getSystemPrompt: () => "  " });

	const systemMessage = run.context?.messages[0];
	assert.equal(systemMessage?.role, "system");
	assert.match(extractTextFromContent(systemMessage.content), /one-shot side assistant/i);
});

test("btw does not forward the session transcript's system messages or tools", async () => {
	const run = await runBtw({
		sessionSetup: (sessionManager) => {
			sessionManager.appendMessage({
				role: "system",
				content: "",
				sections: { preamble: "SESSION_TRANSCRIPT_PROMPT" },
				toolsAdded: [{ name: "bash", description: "Run a command", parameters: { type: "object", properties: {} } }],
				timestamp: Date.now() - 1,
			} as Message);
			sessionManager.appendMessage(createUserTextMessage("hi"));
		},
	});

	assert.deepEqual(roles(run), ["system", "user", "user"]);
	const systemMessage = run.context!.messages[0];
	assert.equal(systemMessage.role, "system");
	assert.equal(extractTextFromContent(systemMessage.content), MAIN_SYSTEM_PROMPT);
	assert.equal(systemMessage.sections, undefined);
	assert.equal(systemMessage.toolsAdded, undefined);
});

test("btw resolves compacted session context before asking the follow-up question", async () => {
	const run = await runBtw({
		question: "What should I do next?",
		sessionSetup: (sessionManager, faux) => {
			sessionManager.appendMessage(createUserTextMessage("old question", Date.now() - 4));
			sessionManager.appendMessage(createAssistantTextMessage("old answer", faux, Date.now() - 3));
			const recentUserId = sessionManager.appendMessage(createUserTextMessage("recent question", Date.now() - 2));
			sessionManager.appendMessage(createAssistantTextMessage("recent answer", faux, Date.now() - 1));
			sessionManager.appendCompaction("summary of earlier conversation", recentUserId, 123);
		},
	});

	assert.ok(run.context, "expected provider to be called");
	const texts = run.context.messages.map((message) => extractTextFromContent(message.content));
	assert.equal(texts.some((text) => text.includes("old question")), false);
	assert.equal(texts.some((text) => text.includes("old answer")), false);
	assert.ok(texts.some((text) => text.includes("summary of earlier conversation")));
	assert.ok(texts.some((text) => text.includes("recent question")));
	assert.ok(texts.some((text) => text.includes("recent answer")));
	assert.ok(texts.some((text) => text.includes("What should I do next?")));
});

test("btw drops a trailing aborted assistant message before sending", async () => {
	const run = await runBtw({
		sessionSetup: (sessionManager, faux) => {
			sessionManager.appendMessage(createUserTextMessage("user q"));
			sessionManager.appendMessage(createAssistantMessageWithStop("aborted", [{ type: "text", text: "partial..." }], faux));
		},
	});

	assert.deepEqual(roles(run), ["system", "user", "user"]);
});

test("btw drops a trailing error assistant message before sending", async () => {
	const run = await runBtw({
		sessionSetup: (sessionManager, faux) => {
			sessionManager.appendMessage(createUserTextMessage("user q"));
			sessionManager.appendMessage(createAssistantMessageWithStop("error", [{ type: "text", text: "boom" }], faux));
		},
	});

	assert.deepEqual(roles(run), ["system", "user", "user"]);
});

test("btw drops a trailing toolUse assistant message with no following toolResult", async () => {
	const run = await runBtw({
		sessionSetup: (sessionManager, faux) => {
			sessionManager.appendMessage(createUserTextMessage("user q"));
			sessionManager.appendMessage(
				createAssistantMessageWithStop("toolUse", [{ type: "toolCall", id: "t1", name: "read", arguments: {} }], faux),
			);
		},
	});

	assert.deepEqual(roles(run), ["system", "user", "user"]);
});

test("btw preserves a clean trailing assistant message", async () => {
	const run = await runBtw({
		sessionSetup: (sessionManager, faux) => {
			sessionManager.appendMessage(createUserTextMessage("user q"));
			sessionManager.appendMessage(createAssistantTextMessage("clean answer", faux));
		},
	});

	assert.deepEqual(roles(run), ["system", "user", "assistant", "user"]);
});

test("btw surfaces a friendly fallback when the model emits only a tool call", async () => {
	const run = await runBtw({
		question: "Tell me",
		response: fauxAssistantMessage([fauxToolCall("read_file", { path: "x" })], { stopReason: "toolUse" }),
	});

	assert.match(run.ui.rendered, /tried to call/i);
	assert.match(run.ui.rendered, /read_file/);
	assert.doesNotMatch(run.ui.rendered, /No answer returned/);
});

test("btw shows the provider error when the request fails", async () => {
	const run = await runBtw({
		response: fauxAssistantMessage("", { stopReason: "error", errorMessage: "upstream exploded" }),
	});

	assert.match(run.ui.rendered, /BTW request failed/);
	assert.match(run.ui.rendered, /upstream exploded/);
});

for (const thinkingLevel of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
	test(`btw forwards the session thinking level "${thinkingLevel}" to the model request`, async () => {
		const run = await runBtw({
			models: [{ id: "btw-test-model", reasoning: true }],
			sessionSetup: (sessionManager) => {
				sessionManager.appendThinkingLevelChange(thinkingLevel);
				sessionManager.appendMessage(createUserTextMessage("What changed?"));
			},
		});

		assert.equal(run.options?.reasoning, thinkingLevel);
	});
}

test("btw requests no reasoning when the session thinking level is off", async () => {
	const run = await runBtw({
		models: [{ id: "btw-test-model", reasoning: true }],
		sessionSetup: (sessionManager) => {
			sessionManager.appendThinkingLevelChange("off");
			sessionManager.appendMessage(createUserTextMessage("What changed?"));
		},
	});

	assert.ok(run.options, "expected provider to be called");
	assert.equal(run.options.reasoning, undefined);
});
