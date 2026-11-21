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

- Queries and purposes go to Google. `store: false` disables stored Interaction
  objects, not provider retention.
- Only completed, successfully grounded responses are printed. No matches is
  distinct from failed grounding. Report grounding errors, including 429,
  rather than switching models.
- Citation URLs are Google redirects; source domains appear in citation titles.
- If automatic selection fails, the script warns and uses its direct-retrieval
  fallback.
