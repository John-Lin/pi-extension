---
name: gemini-web-search
description: "Web search backed by Google Search grounding. Use specifically when you want Google's search index or broad source coverage."
---

# Gemini Web Search

Run a **Gemini model with the `google_search` grounding tool** against Google
AI Studio and get a concise research summary with a deduplicated Citations
section.

## Setup

No npm install required (uses Node built-in `fetch`). Needs a Gemini API key —
`GEMINI_API_KEY`, or the `google` api_key entry in pi's `~/.pi/agent/auth.json`.

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

- `--model <id>` (default: `gemini-3.8-flash`; use `gemini-3.5-flash-lite` for lower latency)
- `--thinking <level>` (default: `medium`; values: `minimal`, `low`, `medium`, `high`)
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
- A 429 means the search-grounding quota is exhausted — report it rather than
  switching to another model.
