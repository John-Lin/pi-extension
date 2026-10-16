---
name: gemini-video-understanding
description: "Video understanding with Gemini via Google AI Studio. Use when you need to summarize, describe, or answer questions about a local video file (up to about 75 MB) or a public YouTube video."
---

# Gemini Video Understanding

Send one video plus a prompt to a **Gemini model** and print its answer.

## Setup

No npm install required (uses Node built-in `fetch`). Needs a Gemini API key —
`GEMINI_API_KEY`, or the `google` api_key entry in pi's `~/.pi/agent/auth.json`.

## Usage

Run from the skill directory. `node analyze.mjs --help` prints every flag,
default, supported format and example.

```bash
node analyze.mjs <video-file|youtube-url> "<what you want to know>"
```

- **Local file** is sent inline as base64. Google's inline limit is 100 MB per
  request, so the raw video can be about 75 MB at most. For a larger file,
  report the limit; this skill has no upload path.
- **YouTube URL** must point to a public video; private and unlisted videos fail.
- Refer to moments in the prompt as `MM:SS` (e.g. "What happens at 01:15?").

## Notes

- Requests use `store: false` to disable Interactions API object storage. Video
  and prompt still go to Google; this is not a guarantee of zero provider retention.
- Long videos take time; raise `--timeout` rather than retrying a timed-out request.
- A 429 means the quota is exhausted — report it rather than switching models.

## References

[Video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
