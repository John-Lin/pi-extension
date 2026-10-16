import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { captureOutput, captureRequests } from "./helpers/gemini-cli.ts";

const script = fileURLToPath(new URL("../skills/gemini-video-understanding/analyze.mjs", import.meta.url));
const modulePath = "../skills/gemini-video-understanding/analyze.mjs";
const youtubeUrl = "https://www.youtube.com/watch?v=9hE5-98ZeCg";
const interactionsUrl = "https://generativelanguage.googleapis.com/v1beta/interactions";
// Google's inline limit applies to the request payload, so it bounds the
// base64-encoded video: 3 raw bytes become 4 encoded bytes.
const MAX_INLINE_BYTES = 100 * 1024 * 1024;
const MAX_RAW_BYTES = (MAX_INLINE_BYTES / 4) * 3;

function localVideo(t: TestContext, name = "clip.mp4") {
	const directory = mkdtempSync(join(tmpdir(), "gemini-video-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const videoPath = join(directory, name);
	// The bytes are never decoded locally; only their base64 encoding is checked.
	const video = Buffer.from("000000186674797069736f6d0000020069736f6d69736f32", "hex");
	writeFileSync(videoPath, video);
	const env = { ...process.env, PI_CODING_AGENT_DIR: directory };
	delete env.GEMINI_API_KEY;
	return { directory, videoPath, video, env };
}

function run(args: string[], env: NodeJS.ProcessEnv) {
	return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
}

test("analyze --help documents both video sources and Google credentials", (t) => {
	const { env } = localVideo(t);
	const result = run(["--help"], env);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /^Usage:\n  node analyze\.mjs <video-file\|youtube-url> "<prompt>"/);
	assert.match(result.stdout, /100 MB/);
	assert.match(result.stdout, /YouTube/);
	assert.match(result.stdout, /--processing\s+static \| agentic/);
	assert.match(result.stdout, /GEMINI_API_KEY/);
	assert.match(result.stdout, /auth\.json/);
	assert.equal(result.stderr, "");
});

test("analyze requires a video source and a prompt", (t) => {
	const { env } = localVideo(t);
	for (const args of [[], [youtubeUrl], [youtubeUrl, "  "]]) {
		const result = run(args, env);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /^Error: a video source and a prompt are required\nUsage:/);
		assert.equal(result.stdout, "");
	}
});

test("parseArgs joins the prompt words and reads option overrides", async () => {
	const { parseArgs } = await import(modulePath);
	assert.deepEqual(parseArgs([youtubeUrl, "Summarize", "the", "talk"]), {
		help: false,
		source: youtubeUrl,
		prompt: "Summarize the talk",
		model: "gemini-3.8-flash",
		thinkingLevel: "medium",
		timeoutMs: 300000,
		processing: undefined,
	});
	assert.deepEqual(
		parseArgs(["--model", "gemini-3.5-flash-lite", "clip.mp4", "--thinking=low", "--timeout", "5000", "--processing", "agentic", "What happens?"]),
		{
			help: false,
			source: "clip.mp4",
			prompt: "What happens?",
			model: "gemini-3.5-flash-lite",
			thinkingLevel: "low",
			timeoutMs: 5000,
			processing: "agentic",
		},
	);
	assert.equal(parseArgs(["--timeout=10", youtubeUrl, "q"]).timeoutMs, 1000);
	assert.equal(parseArgs(["--processing=static", youtubeUrl, "q"]).processing, "static");
	assert.throws(() => parseArgs(["--timeout", "soon", youtubeUrl, "q"]), /--timeout expects a number of milliseconds, got 'soon'/);
});

test("isYouTubeUrl accepts YouTube hosts only", async () => {
	const { isYouTubeUrl } = await import(modulePath);
	for (const url of [
		youtubeUrl,
		"https://youtube.com/watch?v=abc",
		"https://m.youtube.com/watch?v=abc",
		"https://youtu.be/abc",
		"http://www.youtube.com/shorts/abc",
	]) {
		assert.equal(isYouTubeUrl(url), true, url);
	}
	for (const value of [
		"clip.mp4",
		"https://example.com/clip.mp4",
		"https://youtube.com.example.com/watch?v=abc",
		"ftp://youtube.com/watch?v=abc",
	]) {
		assert.equal(isYouTubeUrl(value), false, value);
	}
});

test("mimeTypeForPath maps the documented video formats case-insensitively", async () => {
	const { mimeTypeForPath } = await import(modulePath);
	for (const [path, want] of [
		["a.mp4", "video/mp4"], ["a.mpeg", "video/mpeg"], ["a.mpg", "video/mpg"],
		["a.MOV", "video/mov"], ["a.avi", "video/avi"], ["a.flv", "video/x-flv"],
		["a.webm", "video/webm"], ["a.wmv", "video/wmv"], ["a.3gp", "video/3gpp"],
	]) {
		assert.equal(mimeTypeForPath(path), want);
	}
	assert.throws(() => mimeTypeForPath("a.mkv"), /unsupported video format: \.mkv/);
	assert.throws(() => mimeTypeForPath("clip"), /unsupported video format: \(no extension\)/);
});

test("buildVideoPart passes a YouTube URL by reference", async () => {
	const { buildVideoPart } = await import(modulePath);
	assert.deepEqual(await buildVideoPart("https://youtu.be/abc"), { type: "video", uri: "https://youtu.be/abc" });
});

test("buildVideoPart inlines a local video as base64 with its MIME type", async (t) => {
	const { buildVideoPart } = await import(modulePath);
	const { videoPath, video } = localVideo(t);
	assert.deepEqual(await buildVideoPart(videoPath), {
		type: "video",
		data: video.toString("base64"),
		mime_type: "video/mp4",
	});
});

test("buildVideoPart rejects sources it cannot send inline", async (t) => {
	const { buildVideoPart } = await import(modulePath);
	const { directory } = localVideo(t);
	const oversized = join(directory, "big.mp4");
	writeFileSync(oversized, "");
	truncateSync(oversized, MAX_RAW_BYTES + 1);
	const unsupported = join(directory, "clip.mkv");
	writeFileSync(unsupported, "x");

	await assert.rejects(buildVideoPart("https://example.com/clip.mp4"), /only YouTube URLs are supported/);
	await assert.rejects(buildVideoPart(join(directory, "missing.mp4")), /file not found: .*missing\.mp4/);
	await assert.rejects(buildVideoPart(unsupported), /unsupported video format: \.mkv/);
	await assert.rejects(buildVideoPart(oversized), /video is 75\.0 MB \(100\.0 MB base64-encoded\), which exceeds the 100 MB inline request limit$/);
});

test("buildVideoPart accepts a local video whose base64 encoding is exactly 100 MB", async (t) => {
	const { buildVideoPart } = await import(modulePath);
	const { directory } = localVideo(t);
	const atLimit = join(directory, "limit.mp4");
	writeFileSync(atLimit, "");
	truncateSync(atLimit, MAX_RAW_BYTES);
	const part = await buildVideoPart(atLimit);
	assert.equal(part.data.length, MAX_INLINE_BYTES);
});

test("buildRequestBody places the video before the prompt and disables storage", async () => {
	const { buildRequestBody } = await import(modulePath);
	const videoPart = { type: "video", uri: youtubeUrl };
	assert.deepEqual(
		buildRequestBody({ model: "gemini-3.8-flash", videoPart, prompt: "Summarize", thinkingLevel: "high" }),
		{
			model: "gemini-3.8-flash",
			store: false,
			input: [videoPart, { type: "text", text: "Summarize" }],
			generation_config: { thinking_level: "high" },
		},
	);
});

test("buildRequestBody sets the processing mode on the video part only when one is chosen", async () => {
	const { buildRequestBody } = await import(modulePath);
	const videoPart = { type: "video", uri: youtubeUrl };
	const request = (processing?: string) =>
		buildRequestBody({ model: "gemini-3.8-flash", videoPart, prompt: "Summarize", thinkingLevel: "medium", processing });
	assert.deepEqual(request("agentic").input[0], { type: "video", uri: youtubeUrl, processing: "agentic" });
	assert.deepEqual(request("static").input[0], { type: "video", uri: youtubeUrl, processing: "static" });
	assert.deepEqual(request().input[0], { type: "video", uri: youtubeUrl });
	assert.deepEqual(videoPart, { type: "video", uri: youtubeUrl });
});

test("a local file is checked before credentials are resolved", (t) => {
	const { directory, env } = localVideo(t);
	const result = run([join(directory, "missing.mp4"), "Summarize"], env);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /^Error: file not found: .*missing\.mp4\n$/);
	assert.equal(result.stdout, "");
});

test("analyze reports missing credentials and rejects a corporate PAT", (t) => {
	const { env } = localVideo(t);
	const result = run([youtubeUrl, "Summarize"], { ...env, SRE_LLM_PAT: "corporate-test-token" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /^Error: No credentials found\. Set GEMINI_API_KEY,.*auth\.json\.\n$/);
	assert.equal(result.stdout, "");
});

test("analyze main sends the inline video directly to Google and prints the answer", async (t) => {
	const { main } = await import(modulePath);
	const { videoPath, video } = localVideo(t);
	const { stdout, stderr } = captureOutput(t);
	const requests = captureRequests(t, [Response.json({ status: "completed", output_text: "A cat jumps." })]);

	assert.equal(await main([videoPath, "What happens?"]), 0);
	assert.deepEqual(stdout, ["A cat jumps."]);
	assert.deepEqual(stderr, []);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].url, interactionsUrl);
	assert.equal(requests[0].method, "POST");
	assert.equal(requests[0].headers.get("x-goog-api-key"), "google-test-key");
	assert.equal(requests[0].headers.get("content-type"), "application/json");
	assert.deepEqual(JSON.parse(requests[0].body as string), {
		model: "gemini-3.8-flash",
		store: false,
		input: [
			{ type: "video", data: video.toString("base64"), mime_type: "video/mp4" },
			{ type: "text", text: "What happens?" },
		],
		generation_config: { thinking_level: "medium" },
	});
});

test("analyze main sends a YouTube URL with the selected model and thinking level", async (t) => {
	const { main } = await import(modulePath);
	const { stdout } = captureOutput(t);
	const requests = captureRequests(t, [Response.json({ status: "completed", output_text: "A talk about AI." })]);

	assert.equal(await main([youtubeUrl, "Summarize", "--model", "gemini-3.5-flash-lite", "--thinking", "low"]), 0);
	assert.deepEqual(stdout, ["A talk about AI."]);
	assert.deepEqual(JSON.parse(requests[0].body as string), {
		model: "gemini-3.5-flash-lite",
		store: false,
		input: [{ type: "video", uri: youtubeUrl }, { type: "text", text: "Summarize" }],
		generation_config: { thinking_level: "low" },
	});
});

for (const scenario of [
	{ name: "an HTTP error", response: () => new Response(`  quota\n exceeded ${"x".repeat(1000)}`, { status: 429 }), error: `Error: video analysis failed (429): quota exceeded ${"x".repeat(485)}` },
	{ name: "invalid JSON", response: () => new Response("not JSON"), error: /^Error: .*JSON/ },
	{ name: "a network failure", response: () => new Error("connection lost"), error: "Error: connection lost" },
	{ name: "an incomplete interaction", response: () => Response.json({ status: "incomplete", output_text: "Partial" }), error: "Error: Gemini interaction did not complete (status: incomplete)." },
	{ name: "a missing status", response: () => Response.json({ output_text: "Partial" }), error: "Error: Gemini interaction did not complete (status: missing)." },
	{ name: "an empty answer", response: () => Response.json({ status: "completed", output_text: " \n " }), error: "Error: video analysis response did not contain text" },
]) {
	test(`analyze main reports ${scenario.name} without printing an answer`, async (t) => {
		const { main } = await import(modulePath);
		const { stdout, stderr } = captureOutput(t);
		captureRequests(t, [scenario.response()]);
		assert.equal(await main([youtubeUrl, "Summarize"]), 1);
		assert.deepEqual(stdout, []);
		assert.equal(stderr.length, 1);
		if (typeof scenario.error === "string") assert.equal(stderr[0], scenario.error);
		else assert.match(stderr[0], scenario.error);
	});
}

test("analyze main aborts a request that exceeds the timeout", async (t) => {
	const { main } = await import(modulePath);
	const { stdout, stderr } = captureOutput(t);
	t.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
		// A hung real request holds an open socket that keeps the process alive
		// until the timeout aborts it; this timer stands in for that socket.
		const openSocket = setTimeout(() => {}, 60000);
		options.signal!.addEventListener("abort", () => {
			clearTimeout(openSocket);
			reject(options.signal!.reason);
		});
	}));
	assert.equal(await main([youtubeUrl, "Summarize", "--timeout", "1000"]), 1);
	assert.deepEqual(stdout, []);
	assert.match(stderr[0], /^Error: .*timed? ?out/i);
});

// Shape observed from the live API: processing steps carry only ids and
// opaque signatures; the answer arrives in the final model_output step.
function agenticInteraction(steps: object[]) {
	return {
		status: "completed",
		steps: [...steps, { type: "thought", signature: "t" }, { type: "model_output", content: [{ type: "text", text: "At 00:20 the counter shows 20." }] }],
	};
}
const processingCall = (id: string) => ({ type: "processing_call", id, signature: "c" });
const processingResult = (call_id: string, extra = {}) => ({ type: "processing_result", call_id, signature: "r", ...extra });

test("analyze main requests agentic processing and prints the answer once the video was navigated", async (t) => {
	const { main } = await import(modulePath);
	const { stdout, stderr } = captureOutput(t);
	const requests = captureRequests(t, [Response.json(agenticInteraction([
		processingCall("call_1"), processingResult("call_1"), processingCall("call_2"), processingResult("call_2"),
	]))]);

	assert.equal(await main([youtubeUrl, "What does the counter show at 00:20?", "--processing", "agentic"]), 0);
	assert.deepEqual(stdout, ["At 00:20 the counter shows 20."]);
	assert.deepEqual(stderr, []);
	assert.deepEqual(JSON.parse(requests[0].body as string).input[0], { type: "video", uri: youtubeUrl, processing: "agentic" });
});

for (const scenario of [
	{ name: "no processing steps (the model ignored agentic mode)", steps: [] },
	{ name: "a call without a result", steps: [processingCall("call_1")] },
	{ name: "a result that matches no call", steps: [processingCall("call_1"), processingResult("call_1"), processingResult("call_9")] },
	{ name: "a call without an id", steps: [{ type: "processing_call" }, processingResult("")] },
	{ name: "a failed result", steps: [processingCall("call_1"), processingResult("call_1", { is_error: true })] },
]) {
	test(`analyze main rejects agentic output with ${scenario.name}`, async (t) => {
		const { main } = await import(modulePath);
		const { stdout, stderr } = captureOutput(t);
		captureRequests(t, [Response.json(agenticInteraction(scenario.steps))]);
		assert.equal(await main([youtubeUrl, "Summarize", "--processing", "agentic"]), 1);
		assert.deepEqual(stdout, []);
		assert.equal(stderr.length, 1);
		assert.match(stderr[0], /^Error: agentic video processing /);
	});
}

test("analyze main does not require processing steps in static mode", async (t) => {
	const { main } = await import(modulePath);
	const { stdout } = captureOutput(t);
	const requests = captureRequests(t, [Response.json(agenticInteraction([]))]);
	assert.equal(await main([youtubeUrl, "Summarize", "--processing", "static"]), 0);
	assert.deepEqual(stdout, ["At 00:20 the counter shows 20."]);
	assert.equal(JSON.parse(requests[0].body as string).input[0].processing, "static");
});
