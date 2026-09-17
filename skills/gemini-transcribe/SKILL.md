---
name: gemini-transcribe
description: Transcribe local audio with Gemini 3.5 Transcribe via Google AI Studio. Use when converting speech to text or transcribing a recording.
---

# Gemini Transcribe

## Setup

Requires Node.js 18 or later; no npm install is needed. Uses `GEMINI_API_KEY`,
or the `google` api_key entry in Pi's `~/.pi/agent/auth.json`, sent as the
`x-goog-api-key` header. Uploads, transcription, and deletion go directly to
`generativelanguage.googleapis.com`.

## Usage

Run from the skill directory, or resolve `transcribe.mjs` relative to this file:

```bash
node transcribe.mjs /path/to/recording.mp3
```

Use `node transcribe.mjs --help` for command help. Redirect stdout to save the
transcript; errors go to stderr and produce a nonzero exit status.

## Transcription behavior

Accepts AAC, FLAC, M4A, MP3, OGG, WAV, and WebM. Uses smart transcription to
remove filler words, repetitions, and false starts and apply readable
punctuation and formatting. Treat the result as an edited transcript, not a
verbatim record.

The script uploads audio through the Files API and attempts to delete the
remote file after transcription succeeds or fails. Report API and cleanup
errors rather than silently switching models or providers.

## Maintenance

Keep the sibling `gemini-web-search` skill installed: the script imports its
Google endpoint, credential resolution, and response-text helpers so both
skills use the same authentication behavior.

API references: [transcription](https://ai.google.dev/gemini-api/docs/generate-content/transcribe)
and [file upload/deletion](https://ai.google.dev/gemini-api/docs/generate-content/files).
