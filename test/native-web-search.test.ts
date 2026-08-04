import assert from "node:assert/strict";
import test from "node:test";

import { getCachedOAuthAccess, pickFastModel, pickProvider, resolveApiKey } from "../skills/native-web-search/search.mjs";

test("openai-codex is pinned to gpt-5.6-luna", () => {
	const model = pickFastModel("openai-codex");
	assert.equal(model.id, "gpt-5.6-luna");
	assert.equal(model.baseUrl, "https://chatgpt.com/backend-api");
});

test("an explicit model overrides the pinned default", () => {
	assert.equal(pickFastModel("openai-codex", "gpt-5.4-mini").id, "gpt-5.4-mini");
});

test("provider falls back to available credentials when settings name an unknown provider", () => {
	const provider = pickProvider(undefined, { defaultProvider: "bifrost" }, { "openai-codex": { type: "oauth" } });
	assert.equal(provider, "openai-codex");
});

test("a provider without credentials is reported by name", () => {
	assert.throws(() => resolveApiKey("anthropic", {}, "/tmp/auth.json"), /anthropic/);
});

test("an api_key credential resolves to its key", () => {
	const auth = { anthropic: { type: "api_key", key: "sk-test" } };
	assert.equal(resolveApiKey("anthropic", auth, "/tmp/auth.json").apiKey, "sk-test");
});

test("an unexpired oauth credential resolves to its cached access token", () => {
	const auth = {
		"openai-codex": { type: "oauth", access: "cached-token", refresh: "r", expires: Date.now() + 600_000 },
	};
	const resolved = resolveApiKey("openai-codex", auth, "/tmp/auth.json");
	assert.equal(resolved.apiKey, "cached-token");
});

test("an expired oauth credential tells the user how to refresh it", () => {
	const auth = { "openai-codex": { type: "oauth", access: "stale", refresh: "r", expires: Date.now() - 1000 } };
	assert.throws(() => resolveApiKey("openai-codex", auth, "/tmp/auth.json"), /expired/i);
	assert.throws(() => resolveApiKey("openai-codex", auth, "/tmp/auth.json"), /\bpi\b/);
});

test("resolving credentials never mutates the auth record", () => {
	const auth = {
		"openai-codex": { type: "oauth", access: "cached-token", refresh: "r", expires: Date.now() + 600_000 },
	};
	const before = JSON.stringify(auth);
	resolveApiKey("openai-codex", auth, "/tmp/auth.json");
	assert.equal(JSON.stringify(auth), before);
});

test("a credential expiring within the skew window counts as expired", () => {
	assert.equal(getCachedOAuthAccess({ access: "t", expires: Date.now() + 5_000 }), undefined);
	assert.ok(getCachedOAuthAccess({ access: "t", expires: Date.now() + 600_000 }));
});
