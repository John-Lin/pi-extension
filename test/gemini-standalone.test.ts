import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";

function standaloneSkill(t: TestContext, skill: string) {
	const directory = mkdtempSync(join(tmpdir(), "gemini standalone "));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const destination = join(directory, skill);
	cpSync(new URL(`../skills/${skill}`, import.meta.url), destination, { recursive: true });
	const script = join(destination, skill === "gemini-transcribe" ? "transcribe.mjs" : "search.mjs");
	const env = { ...process.env, PI_CODING_AGENT_DIR: directory };
	delete env.GEMINI_API_KEY;
	return { directory, script, env };
}

for (const skill of ["gemini-web-search", "gemini-maps-search", "gemini-transcribe"]) {
	test(`${skill} starts when only its directory is copied outside the repository`, (t) => {
		const { directory, script, env } = standaloneSkill(t, skill);
		const result = spawnSync(process.execPath, [script, "--help"], { cwd: directory, env, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		if (skill === "gemini-transcribe") {
			assert.match(result.stdout, /^Usage:/);
			assert.equal(result.stderr, "");
		} else {
			assert.match(result.stderr, /^Usage:/);
			assert.equal(result.stdout, "");
		}
	});

	test(`${skill} starts through a symlink to its isolated script`, (t) => {
		const { directory, script, env } = standaloneSkill(t, skill);
		const link = join(directory, "entry.mjs");
		symlinkSync(script, link);
		const result = spawnSync(process.execPath, [link, "--help"], { cwd: directory, env, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
		assert.match(skill === "gemini-transcribe" ? result.stdout : result.stderr, /^Usage:/);
		assert.equal(skill === "gemini-transcribe" ? result.stderr : result.stdout, "");
	});

	test(`${skill} reports missing credentials without requiring another skill or Pi installation`, (t) => {
		const { directory, script, env } = standaloneSkill(t, skill);
		let args = ["test query"];
		if (skill === "gemini-transcribe") {
			const audioPath = join(directory, "sample.wav");
			writeFileSync(audioPath, Buffer.from("524946462600000057415645666d74201000000001000100803e0000007d00000200100064617461020000000000", "hex"));
			args = [audioPath];
		}
		const result = spawnSync(process.execPath, [script, ...args], { cwd: directory, env, encoding: "utf8" });
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.match(result.stderr, /^Error: No credentials found\. Set GEMINI_API_KEY,.*auth\.json\.\n$/);
	});

	test(`${skill} builds a stateless Google request from its isolated directory`, async (t) => {
		const { script } = standaloneSkill(t, skill);
		const module = await import(pathToFileURL(script).href);
		const request = skill === "gemini-transcribe"
			? module.buildTranscriptionRequest("https://generativelanguage.googleapis.com/v1beta/files/sample", "audio/wav")
			: module.buildRequestBody({ model: "gemini-3.8-flash", query: "test query" });
		assert.equal(request.store, false);
		if (skill === "gemini-transcribe") {
			assert.equal(request.model, "gemini-3.5-transcribe");
			assert.deepEqual(request.generation_config, { transcription_config: { mode: "smart" } });
		} else {
			assert.deepEqual(request.tools, [{ type: skill === "gemini-web-search" ? "google_search" : "google_maps" }]);
		}
	});
}

test("standalone transcription resolves its own Google credentials", (t) => {
	const { directory, script, env } = standaloneSkill(t, "gemini-transcribe");
	const audioPath = join(directory, "sample.txt");
	writeFileSync(audioPath, "not audio");
	writeFileSync(join(directory, "auth.json"), JSON.stringify({ google: { type: "api_key", key: "auth-test-key" } }));
	for (const credentials of [env, { ...env, GEMINI_API_KEY: "env-test-key" }]) {
		const result = spawnSync(process.execPath, [script, audioPath], { cwd: directory, env: credentials, encoding: "utf8" });
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.equal(result.stderr, "Error: unsupported audio format: .txt\n");
	}
});
