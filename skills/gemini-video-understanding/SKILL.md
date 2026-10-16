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

## Processing mode

Pick `--processing` per request; it trades tokens against latency:

- **static** (default): best for short clips (under ~5 minutes) and summaries
  that need the whole video.
- **agentic**: best for long videos (over ~5–10 minutes) and questions about
  specific moments or topics. On a 32-minute video with a targeted question it
  used ~80% fewer tokens than static, but took longer.

An agentic answer is printed only when the response proves the model actually
loaded the video. A model without agentic support fails with "agentic video
processing was not executed" — switch to the default model or to static rather
than retrying.

## Notes

- Requests use `store: false` to disable Interactions API object storage. Video
  and prompt still go to Google; this is not a guarantee of zero provider retention.
- A request waits at most 5 minutes; Node's fetch caps it and `--timeout` can
  only shorten it. Report a timeout rather than retrying the same request.
- A 429 means the quota is exhausted — report it rather than switching models.

## References

[Video understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
