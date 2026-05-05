import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildBtwStartupCommand } from "./launch.ts";
import {
	buildGhosttyBtwSplitScript,
	buildGhosttyInputScript,
	parseGhosttyLaunchResult,
} from "./ghostty.ts";
import { writeBtwSessionFile } from "./session.ts";

const childExtensionPath = fileURLToPath(new URL("./child.ts", import.meta.url));

async function cleanupTempSession(sessionFile: string | undefined): Promise<void> {
	if (!sessionFile) {
		return;
	}

	try {
		await unlink(sessionFile);
	} catch {
		// Ignore best-effort cleanup failures for temporary BTW sessions.
	}
}

async function launchBtwSplit(pi: ExtensionAPI, cwd: string) {
	const result = await pi.exec("osascript", ["-e", buildGhosttyBtwSplitScript(), "--", cwd]);
	if (result.code !== 0) {
		return { result, launch: null };
	}

	const launch = parseGhosttyLaunchResult(result.stdout);
	if (!launch) {
		return { result, launch: null };
	}

	return { result, launch };
}

async function sendStartupCommand(pi: ExtensionAPI, terminalId: string, startupCommand: string) {
	return pi.exec("osascript", ["-e", buildGhosttyInputScript(), "--", terminalId, startupCommand]);
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("btw", {
		description: "Open a single-question BTW side pane.",
		handler: async (args, ctx: ExtensionCommandContext) => {
			if (process.platform !== "darwin") {
				ctx.ui.notify("/btw currently requires macOS and Ghostty.", "warning");
				return;
			}

			const prompt = args.trim();
			const branchEntries = ctx.sessionManager.getBranch();
			const currentHeader = ctx.sessionManager.getHeader();
			const currentSessionFile = ctx.sessionManager.getSessionFile();
			const { sessionFile } = await writeBtwSessionFile({
				currentHeader,
				currentSessionFile,
				branchEntries,
				cwd: ctx.cwd,
			});
			const startupCommand = buildBtwStartupCommand({
				sessionFile,
				childExtensionPath,
				prompt,
			});
			const { result, launch } = await launchBtwSplit(pi, ctx.cwd);

			if (result.code !== 0) {
				await cleanupTempSession(sessionFile);
				const reason = result.stderr?.trim() || result.stdout?.trim() || "unknown osascript error";
				ctx.ui.notify(`Failed to open the BTW split: ${reason}`, "error");
				return;
			}

			if (!launch) {
				await cleanupTempSession(sessionFile);
				ctx.ui.notify(`Failed to parse Ghostty split result: ${result.stdout?.trim() || "(empty output)"}`, "error");
				return;
			}

			const inputResult = await sendStartupCommand(pi, launch.terminalId, startupCommand);
			if (inputResult.code !== 0) {
				await cleanupTempSession(sessionFile);
				const reason = inputResult.stderr?.trim() || inputResult.stdout?.trim() || "unknown osascript error";
				ctx.ui.notify(`BTW split opened, but starting the BTW child session failed: ${reason}`, "error");
				return;
			}

			ctx.ui.notify(
				prompt ? "Opened a BTW pane below with your question." : "Opened a BTW pane below. Ask one question there.",
				"info",
			);
		},
	});
}
