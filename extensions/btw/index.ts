import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import { streamSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { BtwBottomOverlay } from "./panel.ts";

const BTW_SYSTEM_PROMPT = [
	"You are BTW, a one-shot side assistant running in a temporary bottom overlay.",
	"Answer the launched question using only the conversation context already present in this session.",
	"Do not ask clarifying questions unless the answer would be impossible without them.",
	"Do not use tools.",
	"Keep the answer concise, direct, and practical.",
	"If the answer cannot be determined from the available context, say so briefly.",
].join(" ");

function buildBtwMessages(branchEntries: Array<{ type: string; message?: Message }>, question: string): Message[] {
	const messages = branchEntries
		.filter((entry): entry is { type: "message"; message: Message } => entry.type === "message" && !!entry.message)
		.map((entry) => entry.message);

	messages.push({
		role: "user",
		content: [{ type: "text", text: question }],
		timestamp: Date.now(),
	});

	return messages;
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
	apiKey: string,
	headers: Record<string, string> | undefined,
): Promise<void> {
	const answerStream = streamSimple(
		ctx.model!,
		{
			systemPrompt: BTW_SYSTEM_PROMPT,
			messages: buildBtwMessages(ctx.sessionManager.getBranch() as Array<{ type: string; message?: Message }>, question),
		},
		{
			apiKey,
			headers,
			signal: panel.signal,
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
		description: "Open a one-shot BTW assistant in a bottom overlay.",
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
			if (!auth.ok || !auth.apiKey) {
				ctx.ui.notify(auth.ok ? `No API key for ${ctx.model.provider}.` : auth.error, "error");
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
