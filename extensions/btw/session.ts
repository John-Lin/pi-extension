import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@mariozechner/pi-coding-agent";

async function fileExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

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

export async function writeBtwSessionFile({
	baseDir = BTW_TEMP_DIR,
	currentHeader,
	currentLeafId,
	currentSessionFile,
	branchEntries,
	cwd,
}) {
	if (currentSessionFile && currentLeafId && (await fileExists(currentSessionFile))) {
		// createBranchedSession mutates the manager in place: after the call, this
		// instance is now the BTW session, so reuse it for the marker append.
		const sessionManager = SessionManager.open(currentSessionFile, baseDir);
		const sessionFile = sessionManager.createBranchedSession(currentLeafId);
		if (sessionFile) {
			const markerId = sessionManager.appendCustomEntry(BTW_MARKER_TYPE);
			const markerEntry = sessionManager.getEntry(markerId);
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
