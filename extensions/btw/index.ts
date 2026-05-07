import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import { streamSimple } from "@mariozechner/pi-ai";
import { buildSessionContext, convertToLlm, type ExtensionAPI, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { BtwBottomOverlay } from "./panel.ts";

const BTW_SYSTEM_PROMPT = [
	"You are BTW, a one-shot side assistant running in a temporary bottom overlay.",
	"Answer the launched question using only the conversation context already present in this session.",
	"Do not ask clarifying questions unless the answer would be impossible without them.",
	"Do not use tools.",
	"Keep the answer concise, direct, and practical.",
	"If the answer cannot be determined from the available context, say so briefly.",
].join(" ");

const BTW_SIDE_REMINDER = [
	"<system-reminder>This is a side question from the user. You must answer this question directly in a single response.",
	"",
	"IMPORTANT CONTEXT:",
	"- You are a separate, lightweight agent spawned to answer this one question",
	"- The main agent is NOT interrupted - it continues working independently in the background",
	"- You share the conversation context but are a completely separate instance",
	"- Do NOT reference being interrupted or what you were \"previously doing\" - that framing is incorrect",
	"",
	"CRITICAL CONSTRAINTS:",
	"- You have NO tools available - you cannot read files, run commands, search, or take any actions",
	"- This is a one-off response - there will be no follow-up turns",
	"- You can ONLY provide information based on what you already know from the conversation context",
	"- NEVER say things like \"Let me try...\", \"I'll now...\", \"Let me check...\", or promise to take any action",
	"- If you don't know the answer, say so - do not offer to look it up or investigate",
	"",
	"Simply answer the question with the information you have.</system-reminder>",
].join("\n");

function resolveBtwSystemPrompt(ctx: ExtensionCommandContext): string {
	try {
		const main = ctx.getSystemPrompt();
		if (main.trim().length > 0) return main;
	} catch {
		// ExtensionCommandContext.getSystemPrompt is required by the SDK,
		// but legacy test stubs may not provide it; fall through.
	}
	return BTW_SYSTEM_PROMPT;
}

type BtwStreamOptions = NonNullable<Parameters<typeof streamSimple>[2]>;

function stripIncompleteAssistantTrailing(messages: Message[]): Message[] {
	const last = messages.at(-1);
	if (last?.role !== "assistant") {
		return messages;
	}
	// Drop a trailing assistant turn that is not a clean completion:
	// - "aborted"/"error": the stream was interrupted before completing
	// - "toolUse": ended expecting tool results that never arrived
	// - "length": truncated by output limit
	// Sending /btw on top of any of these would leave the conversation in
	// an inconsistent state from the model's perspective.
	if (last.stopReason !== "stop") {
		return messages.slice(0, -1);
	}
	return messages;
}

function buildBtwMessages(ctx: ExtensionCommandContext, question: string): {
	messages: Message[];
	thinkingLevel: string;
} {
	const sessionContext = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
	const messages = stripIncompleteAssistantTrailing(convertToLlm(sessionContext.messages));

	messages.push({
		role: "user",
		content: [{ type: "text", text: `${BTW_SIDE_REMINDER}\n\n${question}` }],
		timestamp: Date.now(),
	});

	return {
		messages,
		thinkingLevel: sessionContext.thinkingLevel,
	};
}

function getBtwReasoning(thinkingLevel: string): BtwStreamOptions["reasoning"] | undefined {
	switch (thinkingLevel) {
		case "off":
		case "minimal":
		case "low":
		case "medium":
		case "high":
		case "xhigh":
			return thinkingLevel as BtwStreamOptions["reasoning"];
		default:
			return undefined;
	}
}

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((part): part is Extract<AssistantMessage["content"][number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("");
}

function findFirstToolCallName(message: AssistantMessage): string | undefined {
	const call = message.content.find(
		(part): part is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => part.type === "toolCall",
	);
	return call?.name;
}

async function streamBtwAnswer(
	panel: BtwBottomOverlay,
	ctx: ExtensionCommandContext,
	question: string,
	apiKey: string | undefined,
	headers: Record<string, string> | undefined,
): Promise<void> {
	const { messages, thinkingLevel } = buildBtwMessages(ctx, question);
	const answerStream = streamSimple(
		ctx.model!,
		{
			systemPrompt: resolveBtwSystemPrompt(ctx),
			messages,
		},
		{
			apiKey,
			headers,
			signal: panel.signal,
			reasoning: getBtwReasoning(thinkingLevel),
		},
	);

	let finalMessage: AssistantMessage | undefined;
	for await (const event of answerStream) {
		if (event.type === "text_delta") {
			panel.appendAnswer(event.delta);
			continue;
		}

		if (event.type === "done") {
			finalMessage = event.message;
			continue;
		}

		if (event.type === "error") {
			finalMessage = event.error;
		}
	}

	finalMessage ??= await answerStream.result();
	if (panel.isClosed()) {
		return;
	}

	if (finalMessage.stopReason === "error" || finalMessage.stopReason === "aborted") {
		panel.fail(finalMessage.errorMessage ?? "BTW request failed.");
		return;
	}

	const text = extractAssistantText(finalMessage);
	if (text.length === 0) {
		const toolName = findFirstToolCallName(finalMessage);
		if (toolName) {
			panel.finish(
				`(The model tried to call \`${toolName}\` instead of answering directly. Try rephrasing or ask in the main conversation.)`,
			);
			return;
		}
	}

	panel.finish(text);
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("btw", {
		description: "Ask a quick side question without interrupting the main conversation",
		handler: async (args, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/btw requires interactive mode.", "warning");
				return;
			}

			const prompt = args.trim();
			if (!prompt) {
				ctx.ui.notify("Usage: /btw <question>. BTW panes require a question at launch.", "warning");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("No model selected.", "error");
				return;
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
			if (!auth.ok) {
				ctx.ui.notify(auth.error, "error");
				return;
			}

			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => {
					const panel = new BtwBottomOverlay(tui, theme, prompt, done);
					void streamBtwAnswer(panel, ctx, prompt, auth.apiKey, auth.headers).catch((error) => {
						if (panel.isClosed()) {
							return;
						}
						panel.fail(error instanceof Error ? error.message : String(error));
					});
					return panel;
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "bottom-center",
						width: "100%",
						// Let the panel's own cap (rows - 6) drive the actual height. If
						// the overlay's maxHeight is smaller than what the panel renders,
						// the overlay slices lines off the bottom and the footer +
						// closing border get clipped.
						maxHeight: "100%",
						// No outer gutter: pi-tui leaves the margin area transparent, so a
						// non-zero left/right margin lets the chat behind bleed through and
						// makes the borders look broken. Internal padding inside the row
						// already gives breathing room next to the borders.
						margin: { left: 0, right: 0, bottom: 0 },
					},
				},
			);
		},
	});
}
