import { unlink } from "node:fs/promises";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { HiddenEditor } from "./hidden-editor.ts";
import { consumeBtwStartupPrompt } from "./startup-prompt.ts";

const BTW_SYSTEM_PROMPT = [
	"You are BTW, a one-shot side assistant running in a temporary split pane.",
	"Answer the launched question using only the conversation context already present in this session.",
	"Do not ask clarifying questions unless the answer would be impossible without them.",
	"Do not use tools.",
	"Keep the answer concise, direct, and practical.",
	"If the answer cannot be determined from the available context, say so briefly.",
].join(" ");

export default function (pi: ExtensionAPI): void {
	let startupPromptSent = false;
	// Pi auto-discovers top-level extension entrypoints, so without this gate the
	// BTW prompt and tool block would leak into normal sessions.
	// Only activate when invoked as a /btw child (env var set by launch.ts).
	if (!process.env.PI_BTW_TEMP_SESSION) return;

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setEditorComponent((tui, theme, keybindings) => new HiddenEditor(tui, theme, keybindings));
			// Replace built-in footer with an empty one so token/cost/model stats
			// and any extension setStatus contributions disappear from the BTW pane.
			// The streaming spinner lives in a separate container, so it stays visible.
			ctx.ui.setFooter(() => ({
				render: () => [],
				invalidate: () => {},
			}));
			ctx.ui.notify("BTW mode: input is disabled in this pane.", "info");
		}

		if (startupPromptSent) {
			return;
		}

		const startupPrompt = consumeBtwStartupPrompt();
		if (!startupPrompt) {
			return;
		}

		startupPromptSent = true;
		// Defer the startup prompt until after session_start returns so the
		// interactive UI has time to subscribe to agent events before the BTW
		// child turn begins. Otherwise the pane can miss agent_start and never
		// render the built-in working indicator.
		setTimeout(() => {
			pi.sendUserMessage(startupPrompt);
		}, 0);
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

	pi.on("agent_end", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.notify("BTW answer complete. Close this pane when you are done.", "info");
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
