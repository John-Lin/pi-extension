#!/usr/bin/env node

// Gemini video understanding via Google AI Studio called directly. Sends one
// video (a local file inlined as base64, or a public YouTube URL) plus a text
// prompt to the Interactions REST API with Node's built-in fetch.

import { existsSync, realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { validateInteraction } from "./gemini-interactions.mjs";
import { INTERACTIONS_URL, buildAuthHeaders, extractText, resolveApiKey } from "./google.mjs";

const DEFAULT_MODEL = "gemini-3.8-flash";
const LOW_LATENCY_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_THINKING_LEVEL = "medium";
const DEFAULT_TIMEOUT_MS = 300000;

// Google limits inline data to 100 MB per request payload (File input methods
// guide). The payload carries the video base64-encoded, so the limit is
// checked against the encoded size. Larger videos need the Files API, which
// this skill deliberately does not use.
const MAX_INLINE_MB = 100;
const MAX_INLINE_BYTES = MAX_INLINE_MB * 1024 * 1024;
const MAX_RAW_MB = (MAX_INLINE_MB / 4) * 3;

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

// MIME types exactly as listed in Google's supported video formats.
const MIME_TYPES = {
	".3gp": "video/3gpp",
	".avi": "video/avi",
	".flv": "video/x-flv",
	".mov": "video/mov",
	".mp4": "video/mp4",
	".mpeg": "video/mpeg",
	".mpg": "video/mpg",
	".webm": "video/webm",
	".wmv": "video/wmv",
};

export function usage() {
	return `Usage:
  node analyze.mjs <video-file|youtube-url> "<prompt>" [--model <id>] [--thinking <level>] [--timeout <ms>]

Video sources:
  Local file    Sent inline as base64; the encoded video must fit the
                ${MAX_INLINE_MB} MB inline request limit (about ${MAX_RAW_MB} MB of raw video).
                Formats: ${Object.keys(MIME_TYPES).join(" ")}
  YouTube URL   Public videos only (not private or unlisted).

Flags:
  --model       Default model: ${DEFAULT_MODEL} (${LOW_LATENCY_MODEL} for lower latency).
  --thinking    minimal | low | medium | high (default: ${DEFAULT_THINKING_LEVEL}).
  --timeout     Request timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS}).

Credentials (first match wins):
  GEMINI_API_KEY   API key, sent as the "x-goog-api-key" header.
  ~/.pi/agent/auth.json "google" api_key entry (fallback).

Examples:
  node analyze.mjs demo.mp4 "Summarize this video in 3 sentences."
  node analyze.mjs "https://www.youtube.com/watch?v=9hE5-98ZeCg" "What happens at 01:15?"`;
}

function parseTimeout(raw, fallback) {
	if (raw === undefined || raw === "") return fallback;
	const ms = Number(raw);
	if (!Number.isFinite(ms)) throw new Error(`--timeout expects a number of milliseconds, got '${raw}'.`);
	return Math.max(1000, ms);
}

export function parseArgs(argv) {
	if (argv.includes("--help") || argv.includes("-h")) {
		return { help: true };
	}

	const out = {
		help: false,
		source: "",
		prompt: "",
		model: DEFAULT_MODEL,
		thinkingLevel: DEFAULT_THINKING_LEVEL,
		timeoutMs: DEFAULT_TIMEOUT_MS,
	};
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--model") {
			out.model = argv[++i] || out.model;
		} else if (arg.startsWith("--model=")) {
			out.model = arg.slice("--model=".length) || out.model;
		} else if (arg === "--thinking") {
			out.thinkingLevel = argv[++i] || out.thinkingLevel;
		} else if (arg.startsWith("--thinking=")) {
			out.thinkingLevel = arg.slice("--thinking=".length) || out.thinkingLevel;
		} else if (arg === "--timeout") {
			out.timeoutMs = parseTimeout(argv[++i], out.timeoutMs);
		} else if (arg.startsWith("--timeout=")) {
			out.timeoutMs = parseTimeout(arg.slice("--timeout=".length), out.timeoutMs);
		} else {
			positional.push(arg);
		}
	}

	out.source = positional[0] || "";
	out.prompt = positional.slice(1).join(" ").trim();
	if (!out.source || !out.prompt) {
		throw new Error("a video source and a prompt are required");
	}
	return out;
}

export function isYouTubeUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	return (url.protocol === "https:" || url.protocol === "http:") && YOUTUBE_HOSTS.has(url.hostname);
}

export function mimeTypeForPath(videoPath) {
	const mimeType = MIME_TYPES[extname(videoPath).toLowerCase()];
	if (!mimeType) {
		throw new Error(`unsupported video format: ${extname(videoPath) || "(no extension)"}`);
	}
	return mimeType;
}

export async function buildVideoPart(source) {
	if (isYouTubeUrl(source)) {
		return { type: "video", uri: source };
	}
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
		throw new Error(`only YouTube URLs are supported for remote videos: ${source}`);
	}

	let size;
	try {
		({ size } = await stat(source));
	} catch {
		throw new Error(`file not found: ${source}`);
	}
	const mimeType = mimeTypeForPath(source);
	const encodedSize = 4 * Math.ceil(size / 3);
	if (encodedSize > MAX_INLINE_BYTES) {
		const toMb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
		throw new Error(
			`video is ${toMb(size)} MB (${toMb(encodedSize)} MB base64-encoded), which exceeds the ${MAX_INLINE_MB} MB inline request limit`,
		);
	}
	const data = (await readFile(source)).toString("base64");
	return { type: "video", data, mime_type: mimeType };
}

export function buildRequestBody({ model, videoPart, prompt, thinkingLevel }) {
	return {
		model,
		store: false,
		// Google recommends placing the text prompt after a single video part.
		input: [videoPart, { type: "text", text: prompt }],
		generation_config: { thinking_level: thinkingLevel },
	};
}

function responseError(operation, response, body) {
	const detail = body.trim().replace(/\s+/g, " ").slice(0, 500);
	return new Error(`${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`);
}

export async function analyzeVideo({ apiKey, model, videoPart, prompt, thinkingLevel, timeoutMs }) {
	const response = await fetch(INTERACTIONS_URL, {
		method: "POST",
		headers: {
			...buildAuthHeaders(apiKey),
			"Content-Type": "application/json",
		},
		body: JSON.stringify(buildRequestBody({ model, videoPart, prompt, thinkingLevel })),
		signal: AbortSignal.timeout(timeoutMs),
	});
	const body = await response.text();
	if (!response.ok) {
		throw responseError("video analysis", response, body);
	}
	const interaction = JSON.parse(body);
	validateInteraction(interaction);
	const text = extractText(interaction);
	if (!text.trim()) {
		throw new Error("video analysis response did not contain text");
	}
	return text;
}

export async function main(argv = process.argv.slice(2)) {
	let args;
	try {
		args = parseArgs(argv);
	} catch (error) {
		console.error(`Error: ${error.message}`);
		console.error(usage());
		return 1;
	}
	if (args.help) {
		console.log(usage());
		return 0;
	}

	try {
		// Local source problems are reported before credentials are needed.
		const videoPart = await buildVideoPart(args.source);
		const { apiKey } = resolveApiKey();
		console.log(await analyzeVideo({ apiKey, videoPart, ...args }));
		return 0;
	} catch (error) {
		console.error(`Error: ${error.message || String(error)}`);
		return 1;
	}
}

const invokedDirectly = process.argv[1] && existsSync(process.argv[1]) &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
	main().then((code) => { process.exitCode = code; }).catch((error) => {
		console.error(`Error: ${error.message || String(error)}`);
		process.exitCode = 1;
	});
}
