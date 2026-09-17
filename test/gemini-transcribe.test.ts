import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { captureRequests } from "./helpers/gemini-cli.ts";

const script = fileURLToPath(new URL("../skills/gemini-transcribe/transcribe.mjs", import.meta.url));
const uploadUrl = "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=sample";
const fileUri = "https://generativelanguage.googleapis.com/v1beta/files/sample";

function localAudio(t: TestContext) {
	const directory = mkdtempSync(join(tmpdir(), "gemini-transcribe-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const audioPath = join(directory, "sample.wav");
	// A valid PCM WAV containing one silent 16-bit sample at 16 kHz.
	const audio = Buffer.from(
		"524946462600000057415645666d74201000000001000100803e0000007d00000200100064617461020000000000",
		"hex",
	);
	writeFileSync(audioPath, audio);
	const env = { ...process.env, PI_CODING_AGENT_DIR: directory };
	delete env.GEMINI_API_KEY;
	delete env.SRE_LLM_PAT;
	return { directory, audioPath, audio, env };
}

function run(args: string[], env: NodeJS.ProcessEnv) {
	return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
}

function uploadResponses(mimeType?: string) {
	return [
		new Response(null, { headers: { "x-goog-upload-url": uploadUrl } }),
		Response.json({ file: { name: "files/sample", uri: fileUri, mime_type: mimeType } }),
	];
}

test("transcribe --help explains direct Google credentials without needing a file", (t) => {
	const { env } = localAudio(t);
	const result = run(["--help"], env);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Usage:.*transcribe\.mjs <audio-file>/);
	assert.match(result.stdout, /GEMINI_API_KEY/);
	assert.match(result.stdout, /auth\.json/);
	assert.equal(result.stderr, "");
});

test("transcribe requires exactly one audio file", (t) => {
	const { env } = localAudio(t);
	for (const args of [[], ["one.wav", "two.wav"]]) {
		const result = run(args, env);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /^Error: exactly one audio file is required\nUsage:/);
		assert.equal(result.stdout, "");
	}
});

test("transcribe reports a missing file before resolving credentials", (t) => {
	const { directory, env } = localAudio(t);
	const result = run([join(directory, "missing.wav")], env);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /^Error: file not found: .*missing\.wav\n$/);
	assert.equal(result.stdout, "");
});

test("a corporate PAT cannot replace a Google API key", (t) => {
	const { audioPath, env } = localAudio(t);
	const result = run([audioPath], { ...env, SRE_LLM_PAT: "corporate-test-token" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /^Error: No credentials found\. Set GEMINI_API_KEY,.*auth\.json\.\n$/);
	assert.equal(result.stdout, "");
});

test("transcribe uses the same Pi credential precedence as Gemini web search", (t) => {
	const { directory, env } = localAudio(t);
	const audioPath = join(directory, "sample.txt");
	writeFileSync(audioPath, "not audio");
	writeFileSync(join(directory, "auth.json"), "{ invalid json");

	const malformed = run([audioPath], env);
	assert.equal(malformed.status, 1);
	assert.match(malformed.stderr, /^Error: Could not parse .*auth\.json:/);
	assert.equal(malformed.stdout, "");

	const fromEnv = run([audioPath], { ...env, GEMINI_API_KEY: "env-test-key" });
	assert.equal(fromEnv.status, 1);
	assert.equal(fromEnv.stderr, "Error: unsupported audio format: .txt\n");
	assert.equal(fromEnv.stdout, "");

	writeFileSync(join(directory, "auth.json"), JSON.stringify({ google: { type: "api_key", key: "auth-test-key" } }));
	const fromAuth = run([audioPath], env);
	assert.equal(fromAuth.status, 1);
	assert.equal(fromAuth.stderr, "Error: unsupported audio format: .txt\n");
	assert.equal(fromAuth.stdout, "");
});

test("transcribe recognizes supported audio MIME types case-insensitively", async () => {
	const { mimeTypeForPath } = await import("../skills/gemini-transcribe/transcribe.mjs");
	for (const [path, want] of [
		["sample.aac", "audio/aac"], ["sample.flac", "audio/flac"],
		["sample.m4a", "audio/m4a"], ["sample.mp3", "audio/mpeg"],
		["sample.ogg", "audio/ogg"], ["sample.WAV", "audio/wav"], ["sample.webm", "audio/webm"],
	]) {
		assert.equal(mimeTypeForPath(path), want);
	}
	assert.throws(() => mimeTypeForPath("sample.txt"), /unsupported audio format: .txt/);
	assert.throws(() => mimeTypeForPath("sample"), /unsupported audio format: \(no extension\)/);
});

test("transcribe uploads bytes, requests smart transcription, and deletes the file directly at Google", async (t) => {
	const { transcribe } = await import("../skills/gemini-transcribe/transcribe.mjs");
	const { audioPath, audio } = localAudio(t);
	const requests = captureRequests(t, [
		...uploadResponses("audio/wav"), Response.json({ status: "completed", output_text: "Hello, John." }), new Response(null, { status: 204 }),
	]);

	assert.deepEqual(await transcribe(audioPath, "google-test-key"), { status: "completed", output_text: "Hello, John." });
	assert.deepEqual(requests.map(({ url, method }) => [url, method]), [
		["https://generativelanguage.googleapis.com/upload/v1beta/files", "POST"],
		[uploadUrl, "POST"],
		["https://generativelanguage.googleapis.com/v1beta/interactions", "POST"],
		[fileUri, "DELETE"],
	]);
	for (const { headers } of requests) {
		assert.equal(headers.get("x-goog-api-key"), "google-test-key");
		assert.equal(headers.has("x-bf-vk"), false);
	}
	assert.deepEqual(JSON.parse(requests[0].body as string), { file: { display_name: "sample.wav" } });
	assert.equal(requests[0].headers.get("x-goog-upload-protocol"), "resumable");
	assert.equal(requests[0].headers.get("x-goog-upload-command"), "start");
	assert.equal(requests[0].headers.get("x-goog-upload-header-content-length"), "46");
	assert.equal(requests[0].headers.get("x-goog-upload-header-content-type"), "audio/wav");
	assert.deepEqual(requests[1].body, audio);
	assert.equal(requests[1].headers.get("content-length"), "46");
	assert.equal(requests[1].headers.get("x-goog-upload-offset"), "0");
	assert.equal(requests[1].headers.get("x-goog-upload-command"), "upload, finalize");
	assert.equal(requests[2].headers.get("content-type"), "application/json");
	assert.deepEqual(JSON.parse(requests[2].body as string), {
		model: "gemini-3.5-transcribe",
		store: false,
		input: [{ type: "audio", uri: fileUri, mime_type: "audio/wav" }],
		generation_config: { transcription_config: { mode: "smart" } },
	});
});

test("transcribe prefers the uploaded MIME type and otherwise uses the local type", async (t) => {
	const { transcribe } = await import("../skills/gemini-transcribe/transcribe.mjs");
	const { audioPath } = localAudio(t);
	for (const [uploadedType, want] of [["audio/x-wav", "audio/x-wav"], [undefined, "audio/wav"]]) {
		const requests = captureRequests(t, [...uploadResponses(uploadedType), Response.json({ status: "completed", output_text: "text" }), new Response()]);
		await transcribe(audioPath, "test-key");
		assert.equal(JSON.parse(requests[2].body as string).input[0].mime_type, want);
		t.mock.restoreAll();
	}
});

for (const scenario of [
	{ name: "upload initialization fails", responses: () => [new Response("bad key", { status: 403 })], error: /file upload initialization failed \(403\): bad key/, count: 1 },
	{ name: "upload URL is missing", responses: () => [new Response()], error: /did not return x-goog-upload-url/, count: 1 },
	{ name: "byte upload fails", responses: () => [uploadResponses()[0], new Response("too large", { status: 413 })], error: /file upload failed \(413\): too large/, count: 2 },
	{ name: "uploaded file metadata is missing", responses: () => [uploadResponses()[0], Response.json({ file: {} })], error: /did not include file URI and name/, count: 2 },
	{ name: "transcription is rejected", responses: () => [...uploadResponses(), new Response("quota exceeded", { status: 429 }), new Response()], error: /transcription failed \(429\): quota exceeded/, count: 4 },
	{ name: "transcription returns invalid JSON", responses: () => [...uploadResponses(), new Response("not JSON"), new Response()], error: /JSON/, count: 4 },
	{ name: "transcription has a network failure", responses: () => [...uploadResponses(), new Error("connection lost"), new Response()], error: /connection lost/, count: 4 },
	{ name: "remote deletion fails", responses: () => [...uploadResponses(), Response.json({ status: "completed", output_text: "text" }), new Response("try later", { status: 503 })], error: /uploaded file deletion failed \(503\): try later/, count: 4 },
]) {
	test(`transcribe reports when ${scenario.name} and cleans up any completed upload`, async (t) => {
		const { transcribe } = await import("../skills/gemini-transcribe/transcribe.mjs");
		const { audioPath } = localAudio(t);
		const requests = captureRequests(t, scenario.responses());
		await assert.rejects(transcribe(audioPath, "test-key"), scenario.error);
		assert.equal(requests.length, scenario.count);
		if (scenario.count === 4) {
			assert.equal(requests[3].url, fileUri);
			assert.equal(requests[3].method, "DELETE");
		}
	});
}

for (const status of ["failed", "incomplete", "budget_exceeded", "cancelled", "in_progress", "requires_action", "queued", undefined]) {
	test(`transcribe rejects ${status ?? "missing"} status and deletes the upload`, async (t) => {
		const { transcribe } = await import("../skills/gemini-transcribe/transcribe.mjs");
		const { audioPath } = localAudio(t);
		const requests = captureRequests(t, [
			...uploadResponses(), Response.json({ status, output_text: "Partial transcript" }), new Response(),
		]);
		await assert.rejects(transcribe(audioPath, "test-key"), new RegExp(`did not complete.*${status ?? "missing"}`));
		assert.equal(requests.length, 4);
		assert.equal(requests[3].method, "DELETE");
		assert.equal(requests[3].url, fileUri);
	});
}

for (const output_text of [undefined, "", " \n "]) {
	test(`transcribe rejects an empty completed response (${JSON.stringify(output_text)})`, async (t) => {
		const { transcribe } = await import("../skills/gemini-transcribe/transcribe.mjs");
		const { audioPath } = localAudio(t);
		const requests = captureRequests(t, [
			...uploadResponses(), Response.json({ status: "completed", output_text }), new Response(),
		]);
		await assert.rejects(transcribe(audioPath, "test-key"), /did not contain text/);
		assert.equal(requests[3].method, "DELETE");
	});
}

test("transcribe preserves both errors when transcription and cleanup fail", async (t) => {
	const { transcribe } = await import("../skills/gemini-transcribe/transcribe.mjs");
	const { audioPath } = localAudio(t);
	captureRequests(t, [
		...uploadResponses(),
		new Response("quota exceeded", { status: 429 }),
		new Response("try later", { status: 503 }),
	]);
	await assert.rejects(transcribe(audioPath, "test-key"), (error: Error) => {
		assert.match(error.message, /transcription failed \(429\): quota exceeded/);
		assert.match(error.message, /uploaded file deletion failed \(503\): try later/);
		return true;
	});
});

test("transcribe bounds HTTP error details and normalizes whitespace", async (t) => {
	const { transcribe } = await import("../skills/gemini-transcribe/transcribe.mjs");
	const { audioPath } = localAudio(t);
	captureRequests(t, [new Response(`  bad\n request ${"x".repeat(1000)}`, { status: 400 })]);
	await assert.rejects(transcribe(audioPath, "test-key"), (error: Error) => {
		assert.equal(error.message, `file upload initialization failed (400): bad request ${"x".repeat(488)}`);
		return true;
	});
});
