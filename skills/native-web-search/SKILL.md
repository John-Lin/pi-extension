---
name: native-web-search
description: "Trigger native web search. Use when you need quick internet research with concise summaries and full source URLs."
---

# Native Web Search

Use this skill to run a **fast model with native web search enabled** and get a concise research summary with explicit full URLs.

## Script

- `search.mjs`

## Usage

Run from this skill directory:

```bash
node search.mjs "<what to search>" --purpose "<why you need this>"
```

Examples:

```bash
node search.mjs "latest python release" --purpose "update dependency notes"
node search.mjs "vite 7 breaking changes" --purpose "prepare migration checklist"
```

Optional flags:

- `--provider openai-codex|anthropic`
- `--model <model-id>`
- `--timeout <ms>`
- `--json`

## Output expectations

The script instructs the model to:
- search the internet for the requested topic
- provide a concise summary for the given purpose
- include full canonical URLs (`https://...`) for each key finding
- highlight disagreements between sources

## Notes

- No npm install and no `@earendil-works/pi-ai` import are required; the script only needs Node.
- Credentials are read from `~/.pi/agent/auth.json` (override the directory with `PI_CODING_AGENT_DIR`). The file is never written to.
- For OAuth providers the script uses the cached `access` token as-is. Refreshing stays pi's job, so an expired token fails with a message telling you to run `pi` once and retry.
- `openai-codex` is pinned to `gpt-5.6-luna`; pass `--model` to override.
