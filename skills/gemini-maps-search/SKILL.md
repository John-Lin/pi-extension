---
name: gemini-maps-search
description: "Place search grounded in Google Maps. Use for questions about real places — what is good nearby, whether somewhere is open, what sits near a location — rather than web pages."
---

# Gemini Maps Search

Run a **Gemini model with the `google_maps` grounding tool** against Google
AI Studio and get a shortlist of real places with a deduplicated Places
section of Google Maps links.

## Setup

No npm install required (uses Node built-in `fetch`). Needs a Gemini API key —
`GEMINI_API_KEY`, or the `google` api_key entry in pi's `~/.pi/agent/auth.json`.

## Usage

Run from the skill directory. `node search.mjs` with no arguments prints every
flag, default and example.

```bash
node search.mjs "<what to find>" [--lat <deg> --lng <deg>] --purpose "<why you need this>"
```

- **Always pass `--purpose`.** It decides which places come back, not just how
  they are described: the same query answered for "entertaining a client"
  returns kappo and omakase counters, and for "quick meal before a train"
  returns donburi and ramen chains.
- **Coordinates only steer "near me" questions.** Without them the model
  resolves the area from the query text, so name the area ("near Taipei Main
  Station") whenever you omit them.

## Notes

- `gemini-3.5-flash-lite` answers about twice as fast but follows constraints
  less well; prefer the default unless latency matters more than accuracy.
- Google documents Maps grounding as **English only**. Chinese prompts do work
  in practice and answer in Chinese, but that is unsupported behaviour — fall
  back to English if results look wrong.
- A 429 means the grounding quota is exhausted — report it rather than
  switching to another model.
