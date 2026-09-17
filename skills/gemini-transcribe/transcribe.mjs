#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { extname, basename } from "node:path";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { INTERACTIONS_URL, buildAuthHeaders, extractText, resolveApiKey } from "../gemini-web-search/search.mjs";

const GOOGLE_BASE_URL = new URL(INTERACTIONS_URL).origin;
const MODEL = "gemini-3.5-transcribe";

const MIME_TYPES = {
	".aac": "audio/aac",
	".flac": "audio/flac",
	".m4a": "audio/m4a",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".webm": "audio/webm",
};

export function usage() {
	return `Usage: node transcribe.mjs <audio-file>

Transcribes an audio file with ${MODEL} directly through Google AI Studio.

Credentials (first match wins):
  GEMINI_API_KEY   API key, sent as the "x-goog-api-key" header.
  ~/.pi/agent/auth.json "google" api_key entry (fallback).

Example:
  node transcribe.mjs recording.mp3`;
}

export function parseArgs(argv) {
	if (argv.includes("--help") || argv.includes("-h")) {
		return { help: true };
	}
	if (argv.length !== 1) {
		throw new Error("exactly one audio file is required");
	}
	return { audioPath: argv[0], help: false };
}

export function mimeTypeForPath(audioPath) {
	const mimeType = MIME_TYPES[extname(audioPath).toLowerCase()];
	if (!mimeType) {
		throw new Error(`unsupported audio format: ${extname(audioPath) || "(no extension)"}`);
	}
	return mimeType;
}

export function buildTranscriptionRequest(fileUri, mimeType) {
	return {
		model: MODEL,
		store: false,
		input: [
			{
				type: "audio",
				uri: fileUri,
				mime_type: mimeType,
			},
		],
		generation_config: {
			transcription_config: {
				mode: "smart",
			},
		},
	};
}

function responseError(operation, response, body) {
	const detail = body.trim().replace(/\s+/g, " ").slice(0, 500);
	return new Error(`${operation} failed (${response.status})${detail ? `: ${detail}` : ""}`);
}

async function uploadAudio(audioPath, mimeType, apiKey) {
	const size = (await stat(audioPath)).size;
	const startResponse = await fetch(`${GOOGLE_BASE_URL}/upload/v1beta/files`, {
		method: "POST",
		headers: {
			...buildAuthHeaders(apiKey),
			"Content-Type": "application/json",
			"X-Goog-Upload-Protocol": "resumable",
			"X-Goog-Upload-Command": "start",
			"X-Goog-Upload-Header-Content-Length": String(size),
			"X-Goog-Upload-Header-Content-Type": mimeType,
		},
		body: JSON.stringify({ file: { display_name: basename(audioPath) } }),
	});
	const startBody = await startResponse.text();
	if (!startResponse.ok) {
		throw responseError("file upload initialization", startResponse, startBody);
	}

	const uploadUrl = startResponse.headers.get("x-goog-upload-url");
	if (!uploadUrl) {
		throw new Error("file upload initialization did not return x-goog-upload-url");
	}

	const uploadResponse = await fetch(uploadUrl, {
		method: "POST",
		headers: {
			...buildAuthHeaders(apiKey),
			"Content-Length": String(size),
			"Content-Type": mimeType,
			"X-Goog-Upload-Offset": "0",
			"X-Goog-Upload-Command": "upload, finalize",
		},
		body: Readable.toWeb(createReadStream(audioPath)),
		duplex: "half",
	});
	const uploadBody = await uploadResponse.text();
	if (!uploadResponse.ok) {
		throw responseError("file upload", uploadResponse, uploadBody);
	}

	const uploaded = JSON.parse(uploadBody).file;
	if (!uploaded?.uri || !uploaded?.name) {
		throw new Error("file upload response did not include file URI and name");
	}
	return uploaded;
}

async function deleteUploadedFile(fileName, apiKey) {
	const response = await fetch(`${GOOGLE_BASE_URL}/v1beta/${fileName}`, {
		method: "DELETE",
		headers: buildAuthHeaders(apiKey),
	});
	if (!response.ok) {
		throw responseError("uploaded file deletion", response, await response.text());
	}
}

export async function transcribe(audioPath, apiKey) {
	const mimeType = mimeTypeForPath(audioPath);
	const uploaded = await uploadAudio(audioPath, mimeType, apiKey);
	let transcriptionError;
	try {
		const response = await fetch(INTERACTIONS_URL, {
			method: "POST",
			headers: {
				...buildAuthHeaders(apiKey),
				"Content-Type": "application/json",
			},
			body: JSON.stringify(buildTranscriptionRequest(uploaded.uri, uploaded.mime_type || mimeType)),
		});
		const body = await response.text();
		if (!response.ok) {
			throw responseError("transcription", response, body);
		}
		return JSON.parse(body);
	} catch (error) {
		transcriptionError = error;
		throw error;
	} finally {
		try {
			await deleteUploadedFile(uploaded.name, apiKey);
		} catch (error) {
			if (transcriptionError) {
				throw new Error(`${transcriptionError.message}; ${error.message}`);
			}
			throw error;
		}
	}
}

async function main() {
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`Error: ${error.message}`);
		console.error(usage());
		process.exitCode = 1;
		return;
	}
	if (args.help) {
		console.log(usage());
		return;
	}

	try {
		await stat(args.audioPath);
	} catch {
		console.error(`Error: file not found: ${args.audioPath}`);
		process.exitCode = 1;
		return;
	}

	try {
		const { apiKey } = resolveApiKey();
		const interaction = await transcribe(args.audioPath, apiKey);
		const transcript = extractText(interaction);
		if (!transcript) {
			throw new Error("transcription response did not contain text");
		}
		console.log(transcript);
	} catch (error) {
		console.error(`Error: ${error.message || String(error)}`);
		process.exitCode = 1;
	}
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	main();
}
