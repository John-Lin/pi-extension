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

type BtwStreamOptions = NonNullable<Parameters<typeof streamSimple>[2]>;

function buildBtwMessages(ctx: ExtensionCommandContext, question: string): {
	messages: Message[];
	thinkingLevel: string;
} {
	const sessionContext = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
	const messages = convertToLlm(sessionContext.messages);

	messages.push({
		role: "user",
		content: [{ type: "text", text: question }],
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
			systemPrompt: BTW_SYSTEM_PROMPT,
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

	panel.finish(extractAssistantText(finalMessage));
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
						maxHeight: "40%",
						margin: { left: 0, right: 0, bottom: 0 },
					},
				},
			);
		},
	});
}
