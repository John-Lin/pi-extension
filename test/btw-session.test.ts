import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { SessionManager } from "@mariozechner/pi-coding-agent";

import { writeBtwSessionFile } from "../extensions/btw/session.ts";

test("writeBtwSessionFile preserves labels from the active path clone", async () => {
	const tempRoot = await mkdtemp(join(tmpdir(), "btw-session-test-"));
	const sessionDir = join(tempRoot, "sessions");
	const btwDir = join(tempRoot, "btw");
	const cwd = join(tempRoot, "project");

	try {
		const sessionManager = SessionManager.create(cwd, sessionDir);
		const rootUserId = sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "root question" }],
			timestamp: Date.now(),
		});
		const firstAssistantId = sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "root answer" }],
			timestamp: Date.now(),
		});
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "original follow-up" }],
			timestamp: Date.now(),
		});
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "original branch answer" }],
			timestamp: Date.now(),
		});
		sessionManager.appendLabelChange(rootUserId, "keep-me");
		sessionManager.branch(firstAssistantId);
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "active follow-up" }],
			timestamp: Date.now(),
		});
		const activeAssistantId = sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "active branch answer" }],
			timestamp: Date.now(),
		});

		const sourceSessionFile = sessionManager.getSessionFile();
		const { sessionFile } = await writeBtwSessionFile({
			baseDir: btwDir,
			currentHeader: sessionManager.getHeader(),
			currentLeafId: activeAssistantId,
			currentSessionFile: sourceSessionFile,
			branchEntries: sessionManager.getBranch(),
			cwd,
		});

		const btwSession = SessionManager.open(sessionFile, btwDir);
		assert.equal(btwSession.getLabel(rootUserId), "keep-me");
		assert.equal(btwSession.getHeader().parentSession, sourceSessionFile);
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
});

test("writeBtwSessionFile falls back to branch entry copy when no persisted session file exists", async () => {
	const tempRoot = await mkdtemp(join(tmpdir(), "btw-session-test-"));
	const btwDir = join(tempRoot, "btw");
	const cwd = join(tempRoot, "project");

	try {
		const sessionManager = SessionManager.inMemory(cwd);
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "question from in-memory session" }],
			timestamp: Date.now(),
		});
		sessionManager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "answer from in-memory session" }],
			timestamp: Date.now(),
		});

		const { sessionFile, markerEntry } = await writeBtwSessionFile({
			baseDir: btwDir,
			currentHeader: sessionManager.getHeader(),
			currentLeafId: sessionManager.getLeafId(),
			currentSessionFile: sessionManager.getSessionFile(),
			branchEntries: sessionManager.getBranch(),
			cwd,
		});

		const btwSession = SessionManager.open(sessionFile, btwDir);
		const branchEntries = btwSession.getBranch();
		const textEntries = branchEntries
			.filter((entry) => entry.type === "message")
			.map((entry) => entry.message.content)
			.map((content) => (typeof content === "string" ? content : content.map((part) => (part.type === "text" ? part.text : "")).join("")));

		assert.deepEqual(textEntries, ["question from in-memory session", "answer from in-memory session"]);
		assert.equal(branchEntries.at(-1)?.type, "custom");
		assert.equal(branchEntries.at(-1)?.customType, "btw-marker");
		assert.equal(markerEntry.customType, "btw-marker");
		assert.equal(btwSession.getHeader().parentSession, undefined);
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}
});
