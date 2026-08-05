---
name: gemini-web-search
description: "Web search backed by Google Search grounding (via Gemini on Google AI Studio, called directly with a personal API key). Use specifically when you want Google's search index or broad source coverage."
---

# Gemini Web Search

Run a **Gemini model with the `google_search` grounding tool** against Google
AI Studio directly (no corporate gateway) and get a concise research summary
with a deduplicated Citations section.

## Setup

No npm install required (uses Node built-in `fetch`). Credentials, first match
wins:

1. `GEMINI_API_KEY` env var
2. the `google` api_key entry in `~/.pi/agent/auth.json` (override the
   directory with `PI_CODING_AGENT_DIR`)

The key is sent as the `x-goog-api-key` header.

## Script

- `search.mjs`

## Usage

Run from the skill directory:

```bash
node search.mjs "<what to search>" --purpose "<why you need this>"
```

Examples:

```bash
node search.mjs "latest python release" --purpose "update dependency notes"
node search.mjs "browser HTTP/3 support" --json
```

Optional flags:

- `--model <id>` (default: `gemini-3.6-flash`; use `gemini-3.5-flash-lite` for lower latency)
- `--purpose <text>`
- `--timeout <ms>`
- `--json`
- `--raw` (also print the raw step-type sequence)

## Output expectations

The script instructs the model to:
- search the internet for the requested topic
- provide a concise summary for the given purpose
- include full URLs for each key claim
- highlight disagreements between sources

It then appends a deduplicated `Citations` section from the response annotations.

## Notes

- Citation URLs are Google redirect URLs that resolve to the real source on
  click; the `title` carries the source domain.
- Use `gemini-3.6-flash` (default) or `gemini-3.5-flash-lite` (lower latency).
  A 429 means the search-grounding quota is exhausted — report it rather than
  switching to another model.
