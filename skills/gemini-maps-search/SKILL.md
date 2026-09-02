---
name: gemini-maps-search
description: "Place and location search backed by Google Maps grounding (via Gemini on Google AI Studio, called directly with a personal API key). Use when the question is about real places — restaurants, shops, opening hours, what is near a location — rather than web pages."
---

# Gemini Maps Search

Run a **Gemini model with the `google_maps` grounding tool** against Google
AI Studio directly (no corporate gateway) and get a shortlist of real places
with a deduplicated Places section of Google Maps links.

Use this instead of `gemini-web-search` when the answer is a *place*: what to
eat nearby, which shop is open, what is around a set of coordinates. Web-page
research still belongs in `gemini-web-search`.

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
node search.mjs "<what to find>" [--lat <deg> --lng <deg>] --purpose "<why you need this>"
```

Examples:

```bash
node search.mjs "coffee shops within a 10 minute walk" --lat 25.033964 --lng 121.564468
node search.mjs "best beef noodles near Taipei Main Station" --purpose "dinner plan"
```

Optional flags:

- `--lat <deg>` / `--lng <deg>` — anchor point for "near me" style questions.
  Both or neither; a lone coordinate is rejected.
- `--model <id>` (default: `gemini-3.8-flash`)
- `--thinking <level>` (default: `medium`; values: `minimal`, `low`, `medium`, `high`)
- `--purpose <text>`
- `--timeout <ms>`
- `--json`
- `--raw` (also print the raw step-type sequence)

## Output expectations

The script instructs the model to:
- ground every place in the `google_maps` tool rather than inventing one
- return 2 to 5 places, best first, with name, address and why it fits
- include opening hours, rating or price level when the tool reports them
- say so explicitly when nothing fits

It then appends a `Places` section deduplicated by `place_id`.

## Notes

- Coordinates are optional. Without them the model resolves the area from the
  query text, so name the area ("near Taipei Main Station") when you omit them.
- Place links are real `maps.google.com` URLs, not redirect URLs.
- Citations arrive as `place_citation` annotations. One place is cited many
  times and its review pages are cited separately under the same `place_id`;
  the script collapses those into one entry and prefers the place's own link.
- Google documents Maps grounding as **English only**. Chinese prompts do work
  in practice and answer in Chinese, but that is unsupported behaviour — fall
  back to English if results look wrong.
- The tool may be unavailable in some regions, and results depend on Maps data
  coverage. A 429 means the grounding quota is exhausted — report it rather
  than switching to another model.
