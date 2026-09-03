---
name: gemini-web-search
description: "Web research grounded in Google Search. Use when you want Google's index behind the answer, with a citation for every claim."
---

# Gemini Web Search

Run a **Gemini model with the `google_search` grounding tool** against Google
AI Studio and get a concise research summary with a deduplicated Citations
section.

## Setup

No npm install required (uses Node built-in `fetch`). Needs a Gemini API key —
`GEMINI_API_KEY`, or the `google` api_key entry in pi's `~/.pi/agent/auth.json`.

## Usage

Run from the skill directory. `node search.mjs` with no arguments prints every
flag, default and example.

```bash
node search.mjs "<what to search>" --purpose "<why you need this>"
```

- **Always pass `--purpose`.** The summary is written for it: each finding is
  reported as why it matters for that purpose.

## Notes

- Citation URLs are Google redirect URLs that resolve to the real source on
  click; the `title` carries the source domain.
- A 429 means the search-grounding quota is exhausted — report it rather than
  switching to another model.
