/**
 * Pi Notify Extension
 *
 * Adapted from:
 * https://github.com/badlogic/pi-mono
 * packages/coding-agent/examples/extensions/notify.ts
 * License: MIT
 *
 * Sends a native terminal notification when Pi is ready for input and, on
 * macOS, plays the local completion sound.
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const NOTIFY_TITLE = "Pi";
const NOTIFY_BODY = "Ready for input";
const SOUND_FILE = "/System/Library/Sounds/Blow.aiff";

type PiExecutor = Pick<ExtensionAPI, "exec">;
type PlatformName = NodeJS.Platform | (string & {});
type RuntimeEnvironment = Record<string, string | undefined>;
type TextWriter = (chunk: string) => void;

type NotifyRuntimeOptions = {
	platform?: PlatformName;
	env?: RuntimeEnvironment;
	stdoutWrite?: TextWriter;
	stderrWrite?: TextWriter;
	sendWindowsToast?: (title: string, body: string) => void;
};

export type CompletionSoundCommand = {
	command: string;
	args: string[];
};

function windowsToastScript(title: string, body: string): string {
	const type = "Windows.UI.Notifications";
	const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText01`;
	const toast = `[${type}.ToastNotification]::new($xml)`;
	return [
		`${mgr} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show(${toast})`,
	].join("; ");
}

export function notifyOSC777(title: string, body: string, stdoutWrite: TextWriter): void {
	stdoutWrite(`\x1b]777;notify;${title};${body}\x07`);
}

export function notifyOSC99(title: string, body: string, stdoutWrite: TextWriter): void {
	stdoutWrite(`\x1b]99;i=1:d=0;${title}\x1b\\`);
	stdoutWrite(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

export function sendWindowsToast(title: string, body: string): void {
	execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)]);
}

export function sendTerminalNotification(
	title: string,
	body: string,
	env: RuntimeEnvironment,
	stdoutWrite: TextWriter,
	windowsToast: (title: string, body: string) => void,
): void {
	if (env.WT_SESSION) {
		windowsToast(title, body);
		return;
	}

	if (env.KITTY_WINDOW_ID) {
		notifyOSC99(title, body, stdoutWrite);
		return;
	}

	notifyOSC777(title, body, stdoutWrite);
}

export function getCompletionSoundCommand(platform: PlatformName): CompletionSoundCommand | null {
	if (platform === "darwin") {
		return {
			command: "afplay",
			args: [SOUND_FILE],
		};
	}

	if (platform === "linux") {
		// TODO: Add a Linux sound backend once we decide which desktop/audio interface to support.
		return null;
	}

	return null;
}

export async function playCompletionSound(
	pi: PiExecutor,
	platform: PlatformName,
	stderrWrite: TextWriter,
): Promise<void> {
	const soundCommand = getCompletionSoundCommand(platform);
	if (!soundCommand) {
		return;
	}

	const result = await pi.exec(soundCommand.command, soundCommand.args);
	if (result.code !== 0) {
		const reason = result.stderr?.trim() || result.stdout?.trim() || "unknown completion sound error";
		stderrWrite(`notify.ts: failed to play completion sound: ${reason}\n`);
	}
}

export async function handleAgentEnd(
	pi: PiExecutor,
	options: NotifyRuntimeOptions = {},
): Promise<void> {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const stdoutWrite = options.stdoutWrite ?? ((chunk: string) => {
		process.stdout.write(chunk);
	});
	const stderrWrite = options.stderrWrite ?? ((chunk: string) => {
		process.stderr.write(chunk);
	});
	const windowsToast = options.sendWindowsToast ?? sendWindowsToast;

	sendTerminalNotification(NOTIFY_TITLE, NOTIFY_BODY, env, stdoutWrite, windowsToast);
	await playCompletionSound(pi, platform, stderrWrite);
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async () => {
		await handleAgentEnd(pi);
	});
}
