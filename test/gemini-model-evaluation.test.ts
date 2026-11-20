import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./gemini-search-models.live.mjs", import.meta.url);

test("model evaluation filters individual cases before resolving credentials", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "gemini-eval-auth-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const env = { ...process.env, PI_CODING_AGENT_DIR: directory, NODE_DISABLE_COLORS: "1" };
	delete env.GEMINI_API_KEY;
	delete env.NODE_TEST_CONTEXT;
	const result = spawnSync(process.execPath, [
		"--test", "--test-reporter=spec", "--test-name-pattern=^deep/locks$", script.pathname,
	], { env, encoding: "utf8" });
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stdout, /deep\/locks/);
	assert.match(result.stdout, /No credentials found\. Set GEMINI_API_KEY/);
	assert.match(result.stdout, /ℹ fail 1\n/);
	assert.equal(result.stderr, "");
});

test("model evaluation help does not start paid requests or resolve credentials", () => {
	const result = spawnSync(process.execPath, [script.pathname, "--help"], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /^Usage:/);
	assert.match(result.stdout, /25 paid Google Search requests/);
	assert.equal(result.stderr, "");
});
