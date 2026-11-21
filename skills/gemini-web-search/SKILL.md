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
The same key authenticates both automatic model selection and web search.

## Usage

Run from the skill directory. `node search.mjs` with no arguments prints every
flag, default and example.

```bash
node search.mjs "<what to search>" --purpose "<why you need this>"
```

- **Always pass `--purpose`.** The summary is written for it: each finding is
  reported as why it matters for that purpose.
- **Omit `--model` and `--thinking` by default.** Gemini Decision 1 selects
  the search model and thinking level.
- **Set either flag to choose manually.** This skips automatic selection;
  unspecified values use the defaults shown by `--help`.

## Notes

- Search requests use `store: false` to disable Interactions API object storage.
  Decision requests send the query to Google; search requests send the query and
  purpose. This is not a guarantee of zero provider retention.
- Only completed interactions with successful Google Search execution are printed.
  A search that finds no matches is distinct from missing or failed grounding.
- Citation URLs are Google redirect URLs that resolve to the real source on
  click; the `title` carries the source domain.
- A search-grounding 429 is reported rather than switching to another model.
- Automatic selection uses `gemini-decision-1` through Google's
  [Decisions API](https://ai.google.dev/gemini-api/docs/decisions-api), with
  text instructions and contrastive criteria for three work classifications.
  Each classification maps to a fixed search model and thinking level.
- Decision network failures and HTTP 408, 429, or 5xx errors are retried once.
  If selection still fails or returns an invalid answer, the script warns and
  searches with the direct-retrieval configuration. Grounding failures remain
  fatal; they never trigger another model.
- JSON output includes `decision` (choice, confidence, and probabilities) after
  successful automatic selection. Human output includes a `Decision:` line.
