/**
 * Completion Sound Extension
 *
 * Plays the same macOS completion sound used by the local Claude Code Stop hook.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SOUND_FILE = "/System/Library/Sounds/Glass.aiff";

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async () => {
		if (process.platform !== "darwin") {
			return;
		}

		const result = await pi.exec("afplay", [SOUND_FILE]);
		if (result.code !== 0) {
			const reason = result.stderr?.trim() || result.stdout?.trim() || "unknown afplay error";
			process.stderr.write(`notify.ts: failed to play completion sound: ${reason}\n`);
		}
	});
}
