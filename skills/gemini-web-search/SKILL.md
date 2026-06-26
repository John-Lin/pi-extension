---
name: gemini-web-search
description: "Trigger Gemini-powered web search backed by Google Search grounding. Returns a concise summary followed by a deduplicated Citations section listing all source URLs."
---

# Gemini Web Search

Run a Gemini model with the `google_search` tool enabled (Interactions
API, `tools: [{ type: "google_search" }]`) and get a concise research
summary with citations.

Supports two modes:

- **direct** — call `ai.google.dev` directly with `GEMINI_API_KEY`.
- **proxy** — route through any Gemini-compatible gateway (corporate
  proxies, regional re-exporters, etc.) that exposes the Interactions
  API and accepts a single custom auth header.

## Setup

This skill ships with the rest of the `pi-extension` package, so
`pi install` already takes care of the `@google/genai` dependency.
When loading the skill standalone with
`pi -e ./skills/gemini-web-search/SKILL.md`, install deps once:

```bash
cd skills/gemini-web-search && npm install
```

### Credentials

| Var | Used by | Notes |
|---|---|---|
| `GEMINI_API_KEY` | direct | Standard Google AI API key. |
| `GEMINI_PROXY_URL` | proxy | Full base URL the SDK will hit. The SDK appends `/v1beta/interactions`, so pass the URL up to (but not including) the API version segment. |
| `GEMINI_PROXY_AUTH_HEADER` | proxy | Header name carrying the auth credential, e.g. `Authorization` or a gateway-specific name. |
| `GEMINI_PROXY_AUTH_VALUE` | proxy | Full header value. Include any prefix yourself (e.g. `Bearer xxxxx`). |

**Direct mode also reads `~/.pi/agent/auth.json`.** If `GEMINI_API_KEY`
is not set, the script falls back to the `google` provider entry in
pi's auth file (only `type: "api_key"` is supported; OAuth entries are
ignored). The location respects `PI_CODING_AGENT_DIR`. Values starting
with `!` are executed as shell commands, matching pi's own convention.

### Mode selection

The script picks a mode in this order:

1. `--mode direct|proxy` if passed.
2. Else **proxy** when `GEMINI_PROXY_URL` is set.
3. Else **direct** when `GEMINI_API_KEY` is set or `auth.json` has a `google` api_key entry.
4. Else: error.

### Example: corporate gateway in `~/.zshrc`

Bridge whatever variables your gateway uses onto the skill's generic
names, e.g.:

```bash
export GEMINI_PROXY_URL="https://my-llm-gateway.example.com/genai_passthrough"
export GEMINI_PROXY_AUTH_HEADER="x-my-gateway-key"
export GEMINI_PROXY_AUTH_VALUE="$MY_GATEWAY_TOKEN"
```

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
node search.mjs "vite 7 breaking changes" --mode direct --json
node search.mjs "browser HTTP/3 support" --model gemini-2.5-flash --raw
```

Flags:

- `--purpose <text>` — context shown to the model (default: `general research support`)
- `--model <id>` — Gemini model id. Default depends on mode: `gemini-3.1-flash-lite` for proxy, `gemini-2.5-flash-lite` for direct (see Notes below for why they differ).
- `--mode direct|proxy` — override auto-detection
- `--timeout <ms>` — request timeout (default: `120000`)
- `--json` — emit a JSON object with `mode`, `text`, `citations`, `steps`
- `--raw` — also print the raw step-type sequence (handy for debugging)

## Output

The model is instructed to:

- search the internet for the requested topic
- summarise findings for the given purpose
- include full URLs for every key claim
- call out disagreements between sources
- finish with a short recommendation on which source(s) to trust first

After the model response, the script appends a deduplicated `Citations`
section built from `model_output` annotations.

## Notes & Gotchas

- **Default model differs between modes.** Proxy mode defaults to
  `gemini-3.1-flash-lite` (fastest verified through corporate gateways).
  Direct mode defaults to `gemini-2.5-flash-lite` because
  `gemini-3.1-flash-lite` is not exposed as a stable model ID on the
  public `ai.google.dev` endpoint — `models.list` only returns
  `gemini-3.1-flash-lite-preview`, which is gated and returns 429 "no
  quota" on personal API keys. Override either default with `--model`.
- **Citation URLs are Google redirect URLs**
  (`https://vertexaisearch.cloud.google.com/grounding-api-redirect/...`).
  They resolve to the real source on click; the `title` field carries
  the source domain. This matches what Google returns; the script does
  not chase the redirect to avoid extra latency.
- **In proxy mode, the auth header is sent per-call.** The
  `@google/genai` SDK's Interactions next-gen client does **not**
  propagate `httpOptions.headers`, so we pass them via the second
  argument of `interactions.create(params, { headers })`. If you fork
  this and switch to `httpOptions.headers`, your proxy will likely 401.
- `google_search` and `google_maps` cannot be combined in one request.
  This skill only enables `google_search`.
- The script targets the Interactions API
  (`/v1beta/interactions`), which is newer than legacy
  `generateContent`. Don't mix tool specs across the two APIs
  (Interactions uses `{type: "google_search"}`; legacy uses
  `{googleSearch: {}}`).
