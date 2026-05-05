import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@mariozechner/pi-coding-agent";

export const BTW_MARKER_TYPE = "btw-marker";
export const BTW_TEMP_DIR = join(tmpdir(), "pi-btw");

function createEntryId() {
	return randomBytes(4).toString("hex");
}

export function createBtwMarkerEntry(parentId, timestamp = new Date().toISOString()) {
	return {
		type: "custom",
		id: createEntryId(),
		parentId: parentId ?? null,
		timestamp,
		customType: BTW_MARKER_TYPE,
	};
}

export function hasUsedBtwQuestion(branchEntries) {
	let lastMarkerIndex = -1;
	for (let i = 0; i < branchEntries.length; i++) {
		const entry = branchEntries[i];
		if (entry?.type === "custom" && entry.customType === BTW_MARKER_TYPE) {
			lastMarkerIndex = i;
		}
	}

	if (lastMarkerIndex < 0) {
		return false;
	}

	for (const entry of branchEntries.slice(lastMarkerIndex + 1)) {
		if (entry?.type === "message" && entry.message?.role === "user") {
			return true;
		}
	}

	return false;
}

export async function writeBtwSessionFile({
	baseDir = BTW_TEMP_DIR,
	currentHeader,
	currentLeafId,
	currentSessionFile,
	branchEntries,
	cwd,
}) {
	if (currentSessionFile && currentLeafId && existsSync(currentSessionFile)) {
		const sessionManager = SessionManager.open(currentSessionFile, baseDir);
		const sessionFile = sessionManager.createBranchedSession(currentLeafId);
		if (sessionFile) {
			const btwSession = SessionManager.open(sessionFile, baseDir);
			const markerId = btwSession.appendCustomEntry(BTW_MARKER_TYPE);
			const markerEntry = btwSession.getEntry(markerId);
			if (!markerEntry || markerEntry.type !== "custom") {
				throw new Error("Failed to append BTW marker entry");
			}
			return { sessionFile, markerEntry };
		}
	}

	const timestamp = new Date().toISOString();
	const fileTimestamp = timestamp.replace(/[:.]/g, "-");
	const sessionId = randomUUID();
	const sessionFile = join(baseDir, `${fileTimestamp}_${sessionId}.jsonl`);
	const markerEntry = createBtwMarkerEntry(branchEntries.at(-1)?.id ?? null, timestamp);
	const header = {
		type: "session",
		version: currentHeader?.version ?? 3,
		id: sessionId,
		timestamp,
		cwd: currentHeader?.cwd ?? cwd,
		parentSession: currentSessionFile,
	};

	if (!currentSessionFile) {
		delete header.parentSession;
	}

	const content = [
		JSON.stringify(header),
		...branchEntries.map((entry) => JSON.stringify(entry)),
		JSON.stringify(markerEntry),
	].join("\n") + "\n";

	await mkdir(baseDir, { recursive: true });
	await writeFile(sessionFile, content, "utf8");

	return { sessionFile, markerEntry };
}
