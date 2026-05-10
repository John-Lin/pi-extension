/**
 * Split Fork Extension
 *
 * Adapted from:
 * https://github.com/mitsuhiko/agent-stuff
 * extensions/split-fork.ts
 * License: Apache-2.0
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
	getSplitDirectionForTerminalCount,
	parseGhosttyLaunchResult,
	parseGhosttyTerminalCount,
} from "./layout.ts";
import { buildGhosttyTerminalCountScript } from "./count-osascript.ts";
import {
	buildGhosttyInputScript,
	buildGhosttyLaunchScript,
} from "./osascript.ts";
import {
	SPLIT_FORK_STARTUP_PROMPT_ENV,
	consumeSplitForkStartupPrompt,
	encodeSplitForkStartupPrompt,
} from "./startup-prompt.ts";

type SplitDirection = "right" | "down";
type ForkedSessionInfo = {
	sessionFile: string | undefined;
};

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getPiInvocationParts(): string[] {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return [process.execPath, currentScript];
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return [process.execPath];
	}

	return ["pi"];
}

export function buildPiStartupInput(sessionFile: string | undefined, prompt: string): string {
	const envAssignments: string[] = [];
	const encodedPrompt = encodeSplitForkStartupPrompt(prompt);
	if (encodedPrompt) {
		envAssignments.push(`${SPLIT_FORK_STARTUP_PROMPT_ENV}=${shellQuote(encodedPrompt)}`);
	}

	const commandParts = [...getPiInvocationParts()];

	if (sessionFile) {
		commandParts.push("--session", sessionFile);
	}

	const command = commandParts.map(shellQuote).join(" ");
	const prefix = envAssignments.length > 0 ? `${envAssignments.join(" ")} ` : "";
	return `${prefix}${command}\n`;
}

async function createForkedSession(ctx: ExtensionCommandContext): Promise<ForkedSessionInfo> {
	const branchEntries = ctx.sessionManager.getBranch();
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) {
		return { sessionFile: undefined };
	}

	const sessionDir = path.dirname(sessionFile);
	const currentHeader = ctx.sessionManager.getHeader();
	const timestamp = new Date().toISOString();
	const fileTimestamp = timestamp.replace(/[:.]/g, "-");
	const newSessionId = randomUUID();
	const newSessionFile = path.join(sessionDir, `${fileTimestamp}_${newSessionId}.jsonl`);

	const newHeader = {
		type: "session",
		version: currentHeader?.version ?? 3,
		id: newSessionId,
		timestamp,
		cwd: currentHeader?.cwd ?? ctx.cwd,
		parentSession: sessionFile,
	};

	const lines = [JSON.stringify(newHeader), ...branchEntries.map((entry) => JSON.stringify(entry))].join("\n") + "\n";

	await fs.mkdir(sessionDir, { recursive: true });
	await fs.writeFile(newSessionFile, lines, "utf8");

	return { sessionFile: newSessionFile };
}

async function getGhosttyTerminalCount(pi: ExtensionAPI) {
	const result = await pi.exec("osascript", ["-e", buildGhosttyTerminalCountScript()]);
	if (result.code !== 0) {
		return { result, terminalCount: null };
	}

	return {
		result,
		terminalCount: parseGhosttyTerminalCount(result.stdout),
	};
}

async function launchGhosttyFork(pi: ExtensionAPI, cwd: string, direction: SplitDirection) {
	const result = await pi.exec("osascript", ["-e", buildGhosttyLaunchScript(direction), "--", cwd]);
	if (result.code !== 0) {
		return { result, launch: null };
	}

	const launch = parseGhosttyLaunchResult(result.stdout);
	if (!launch) {
		return { result, launch: null };
	}

	return {
		result,
		launch,
	};
}

async function sendStartupInput(pi: ExtensionAPI, terminalId: string, startupInput: string) {
	return pi.exec("osascript", ["-e", buildGhosttyInputScript(), "--", terminalId, startupInput]);
}

export default function (pi: ExtensionAPI): void {
	// Ghostty-specific: uses AppleScript to drive Ghostty split panes.
	// Skip registration entirely on non-macOS or non-Ghostty environments.
	if (process.platform !== "darwin") return;
	if (process.env.TERM_PROGRAM !== "ghostty") return;

	let startupPromptSent = false;

	pi.on("session_start", async () => {
		if (startupPromptSent) {
			return;
		}

		const startupPrompt = consumeSplitForkStartupPrompt();
		if (!startupPrompt) {
			return;
		}

		startupPromptSent = true;
		pi.sendUserMessage(startupPrompt);
	});

	pi.registerCommand("split-fork", {
		description: "Fork this session into a new pi process in chained Ghostty splits. Usage: /split-fork [optional prompt]",
		handler: async (args, ctx) => {
			const countCheck = await getGhosttyTerminalCount(pi);
			if (countCheck.result.code !== 0) {
				const reason = countCheck.result.stderr?.trim() || countCheck.result.stdout?.trim() || "unknown osascript error";
				ctx.ui.notify(`Failed to inspect the current Ghostty tab: ${reason}`, "error");
				return;
			}

			if (countCheck.terminalCount === null) {
				ctx.ui.notify(`Failed to parse the Ghostty terminal count: ${countCheck.result.stdout?.trim() || "(empty output)"}`, "error");
				return;
			}

			const currentDirection = getSplitDirectionForTerminalCount(countCheck.terminalCount) as SplitDirection;
			const wasBusy = !ctx.isIdle();
			const prompt = args.trim();
			const forkedSession = await createForkedSession(ctx);
			const startupInput = buildPiStartupInput(forkedSession.sessionFile, prompt);
			const { result, launch } = await launchGhosttyFork(pi, ctx.cwd, currentDirection);

			if (result.code !== 0) {
				const reason = result.stderr?.trim() || result.stdout?.trim() || "unknown osascript error";
				ctx.ui.notify(`Failed to launch Ghostty split: ${reason}`, "error");
				if (forkedSession.sessionFile) {
					ctx.ui.notify(`Forked session was created: ${forkedSession.sessionFile}`, "info");
				}
				return;
			}

			if (!launch) {
				ctx.ui.notify(`Failed to parse Ghostty launch result: ${result.stdout?.trim() || "(empty output)"}`, "error");
				if (forkedSession.sessionFile) {
					ctx.ui.notify(`Forked session was created: ${forkedSession.sessionFile}`, "info");
				}
				return;
			}

			const inputResult = await sendStartupInput(pi, launch.terminalId, startupInput);
			if (inputResult.code !== 0) {
				const reason = inputResult.stderr?.trim() || inputResult.stdout?.trim() || "unknown osascript error";
				ctx.ui.notify(`Ghostty opened, but failed to start pi in the new pane: ${reason}`, "error");
				if (forkedSession.sessionFile) {
					ctx.ui.notify(`Forked session was created: ${forkedSession.sessionFile}`, "info");
				}
				return;
			}

			const suffix = prompt ? " and sent prompt" : "";
			if (forkedSession.sessionFile) {
				const fileName = path.basename(forkedSession.sessionFile);
				if (launch.kind === "split") {
					ctx.ui.notify(`Forked to ${fileName} in a ${currentDirection} Ghostty split${suffix}.`, "info");
					if (wasBusy) {
						ctx.ui.notify("Forked from current committed state (in-flight turn continues in original session).", "info");
					}
				} else {
					ctx.ui.notify(`Opened ${fileName} in a new Ghostty window${suffix}.`, "warning");
				}
				return;
			}

			if (launch.kind === "split") {
				ctx.ui.notify(`Opened a ${currentDirection} Ghostty split${suffix} (no persisted session to fork).`, "warning");
			} else {
				ctx.ui.notify(`Opened a new Ghostty window${suffix} (no persisted session to fork).`, "warning");
			}
		},
	});
}
