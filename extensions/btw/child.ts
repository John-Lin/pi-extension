import { unlink } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { hasUsedBtwQuestion } from "./session.ts";
import { consumeBtwStartupPrompt } from "./startup-prompt.ts";

const BTW_SYSTEM_PROMPT = [
	"You are BTW, a one-shot side assistant running in a temporary split pane.",
	"Answer exactly one follow-up question using only the conversation context already present in this session.",
	"Do not ask clarifying questions unless the answer would be impossible without them.",
	"Do not use tools.",
	"Keep the answer concise, direct, and practical.",
	"If the answer cannot be determined from the available context, say so briefly.",
].join(" ");

function isSlashCommand(text: string): boolean {
	return text.trim().startsWith("/");
}

function hasConsumedSingleQuestion(ctx: ExtensionContext): boolean {
	return hasUsedBtwQuestion(ctx.sessionManager.getBranch());
}

export default function (pi: ExtensionAPI): void {
	let startupPromptSent = false;
	// Pi auto-discovers top-level extension entrypoints, so without this gate the
	// BTW prompt and tool block would leak into normal sessions.
	// Only activate when invoked as a /btw child (env var set by launch.ts).
	if (!process.env.PI_BTW_TEMP_SESSION) return;

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.notify("BTW mode: ask one question in this split. Tools are disabled.", "info");
		}

		if (startupPromptSent) {
			return;
		}

		const startupPrompt = consumeBtwStartupPrompt();
		if (!startupPrompt) {
			return;
		}

		startupPromptSent = true;
		pi.sendUserMessage(startupPrompt);
	});

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n\n${BTW_SYSTEM_PROMPT}`,
		};
	});

	// Defense-in-depth: --no-tools blocks builtins; this hook blocks any tools registered by other auto-discovered extensions.
	pi.on("tool_call", async () => {
		return { block: true, reason: "btw sessions do not allow tools." };
	});

	pi.on("input", async (event, ctx) => {
		const text = event.text.trim();
		if (!text) {
			return { action: "continue" };
		}

		if (isSlashCommand(text)) {
			return { action: "continue" };
		}

		if (text.startsWith("!")) {
			if (ctx.hasUI) {
				ctx.ui.notify("BTW is question-only. Shell commands are disabled here.", "warning");
			}
			return { action: "handled" };
		}

		if (hasConsumedSingleQuestion(ctx)) {
			if (ctx.hasUI) {
				ctx.ui.notify("BTW accepts only one question. Close this pane and run /btw again.", "warning");
			}
			return { action: "handled" };
		}

		return { action: "continue" };
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (hasConsumedSingleQuestion(ctx) && ctx.hasUI) {
			ctx.ui.notify("BTW answer complete. This pane is now read-only; close it when you are done.", "info");
		}
	});

	pi.on("session_shutdown", async () => {
		const tempSessionFile = process.env.PI_BTW_TEMP_SESSION;
		if (!tempSessionFile) {
			return;
		}

		try {
			await unlink(tempSessionFile);
		} catch {
			// Ignore cleanup failures for temporary BTW sessions.
		}
	});
}
