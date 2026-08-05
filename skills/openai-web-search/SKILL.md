---
name: openai-web-search
description: "Web search via the OpenAI Responses API called directly with an OpenAI platform API key. Use for quick internet research needing precise summaries and auditable, first-party source URLs. For ChatGPT-subscription (codex OAuth) auth use native-web-search instead."
---

# OpenAI Web Search

Run a **fast OpenAI model with the native web_search tool** against the OpenAI
API directly (no corporate gateway) and get a concise research summary with a
deduplicated Citations section of full source URLs.

## Setup

No npm install required (uses Node built-in `fetch`). Requires `OPENAI_API_KEY`
(an OpenAI platform API key, sent as `Authorization: Bearer`).

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
node search.mjs "kubernetes 1.31 changes" --json
```

Optional flags:

- `--model <id>` (default: `gpt-5.6-luna`)
- `--purpose <text>`
- `--timeout <ms>`
- `--json`

## Output expectations

The script instructs the model to:
- search the internet for the requested topic
- provide a concise summary for the given purpose
- include full canonical URLs (`https://...`) for each key finding
- highlight disagreements between sources

It then appends a deduplicated `Citations` section from the response annotations.

## Notes

- This skill needs a paid OpenAI platform API key. If you only have a ChatGPT
  subscription (codex OAuth in `~/.pi/agent/auth.json`), use the
  `native-web-search` skill instead.
- Responses that end in any status other than `completed` are rejected rather
  than returned as a partial summary.
