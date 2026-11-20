// Run manually before changing search models; this calls the real, billable
// Gemini API and is intentionally outside the offline npm test glob.
// Usage: GEMINI_LIVE_EVALUATION=1 node --test test/gemini-search-models.live.mjs
// Help: node test/gemini-search-models.live.mjs --help

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	INTERACTIONS_URL,
	buildAuthHeaders,
	buildRequestBody,
	extractCitations,
	extractText,
	resolveApiKey,
} from "../skills/gemini-web-search/search.mjs";
import { validateInteraction } from "../skills/gemini-web-search/gemini-interactions.mjs";

const cases = [
	["light/npm", "Compare npm ci and npm install for GitHub Actions CI using official npm documentation.", "Choose a reproducible dependency installation command."],
	["light/index", "Explain the differences between PostgreSQL CREATE INDEX and CREATE INDEX CONCURRENTLY using official documentation.", "Choose an index creation method for a busy production table."],
	["light/docker", "Compare Docker published ports bound to 127.0.0.1 versus 0.0.0.0, including version-specific security caveats, using official documentation.", "Expose a local development service without exposing it to other machines."],
	["light/storage", "Explain Gemini Interactions API store:false and its restrictions on background execution and previous_interaction_id using official Gemini documentation.", "Configure a stateless search service without stored interaction objects."],
	["light/permissions", "Compare GitHub Actions contents:read and contents:write permissions using official GitHub documentation.", "Give a CI workflow only the permissions it needs to check out and test code."],
	["deep/migration", "Recommend a zero-downtime PostgreSQL rollout for adding a NOT NULL column when old and new application versions write concurrently. Compare defaults, backfills, constraint validation, lock risks, and rollback using official PostgreSQL documentation.", "Plan a production schema migration without breaking old writers."],
	["deep/webhooks", "Design reliable GitHub webhook ingestion with signature verification, duplicate deliveries, possible out-of-order events, durable processing, and outages. Distinguish provider guarantees from application responsibilities using official GitHub documentation.", "Build a secure ingestion service without assuming exactly-once or ordered delivery."],
	["deep/locks", "Plan an investigation of intermittent PostgreSQL lock waits after an index migration when several writers and long transactions are involved. No logs are available: distinguish hypotheses from verified facts and propose diagnostic queries and a safe rollback using official documentation.", "Find the root cause without inventing evidence or causing more lock contention."],
	["deep/forks", "Recommend a least-privilege GitHub Actions design for testing untrusted fork pull requests while a separate trusted workflow publishes artifacts. Compare pull_request and pull_request_target, secrets, token permissions, and checkout risks using official GitHub documentation.", "Prevent untrusted pull request code from accessing deployment credentials."],
	["deep/grounding", "Recommend a reliable Google Search-grounded Gemini workflow under rate limits. Address query classification, complete-answer latency, citations, transient HTTP errors, and missing or failed grounding using official Gemini documentation.", "Design search that never presents an ungrounded or incomplete response as verified research."],
];

if (process.argv.includes("--help")) {
	console.log("Usage: GEMINI_LIVE_EVALUATION=1 node --test test/gemini-search-models.live.mjs\n\nRequires explicit opt-in before any credentials or paid requests are used.\nRuns 25 paid Google Search requests: 5 light queries at Flash/low and Hydrogen/low,\nand 5 deep queries at Flash/medium, Hydrogen/medium and Hydrogen/high.\nUses GEMINI_API_KEY or Pi's Google API key. No mocks or retries.\nStops on unexpected failures. A 120-second timeout at the exploratory high\nlevel is recorded as an unsuitable candidate, not a successful answer.\nPrints timings, usage, citations and a temporary artifact directory containing\nraw responses for manual quality review.\nUse Node's --test-name-pattern to select a smaller subset.\nThese small, single-run samples do not establish a latency SLA or quality score.");
} else if (process.env.GEMINI_LIVE_EVALUATION !== "1") {
	test("live model evaluation requires explicit opt-in", { skip: "Set GEMINI_LIVE_EVALUATION=1 to authorize paid requests." }, () => {});
} else {
	const directory = mkdtempSync(join(tmpdir(), "gemini-search-eval-"));
	let stopped = false;
	for (const [index, [name, query, purpose]] of cases.entries()) {
		test(name, async (t) => {
			if (stopped) {
				t.skip("A previous request failed; no more paid requests will be made.");
				return;
			}
			const { apiKey } = resolveApiKey();
			t.diagnostic(`Artifacts: ${directory}`);
			const configurations = name.startsWith("light/")
				? [["gemini-3.8-flash", "low"], ["gemini-4-hydrogen", "low"]]
				: [["gemini-3.8-flash", "medium"], ["gemini-4-hydrogen", "medium"], ["gemini-4-hydrogen", "high"]];
			// Alternate order so one model does not always get the first request.
			if (index % 2) configurations.reverse();
			for (const [model, thinkingLevel] of configurations) {
				let failed = false;
				await t.test(`${name} ${model}/${thinkingLevel}`, async (t) => {
					const request = buildRequestBody({ model, thinkingLevel, query, purpose });
					const started = performance.now();
					const path = join(directory, `${name.replaceAll("/", "-")}-${model}-${thinkingLevel}.json`);
					let record = { request };
					try {
						const response = await fetch(INTERACTIONS_URL, {
							method: "POST",
							headers: { "content-type": "application/json", ...buildAuthHeaders(apiKey) },
							body: JSON.stringify(request),
							signal: AbortSignal.timeout(120000),
						});
						const payload = await response.text();
						const elapsedMs = Math.round(performance.now() - started);
						record = { request, httpStatus: response.status, elapsedMs, payload };
						writeFileSync(path, JSON.stringify(record, null, 2));
						assert.ok(response.ok, `HTTP ${response.status}: ${payload}`);
						const interaction = JSON.parse(payload);
						validateInteraction(interaction, "google_search");
						const text = extractText(interaction);
						const citations = extractCitations(interaction);
						assert.ok(text.trim(), "Search must return a complete answer.");
						assert.ok(citations.length, "Evaluation questions must have source citations.");
						t.diagnostic(JSON.stringify({ name, model, thinkingLevel, elapsedMs, citations: citations.length, usage: interaction.usage, artifact: path }));
					} catch (error) {
						const elapsedMs = Math.round(performance.now() - started);
						writeFileSync(path, JSON.stringify({ ...record, elapsedMs, error: { name: error.name, message: error.message } }, null, 2));
						if (thinkingLevel === "high" && error.name === "TimeoutError") {
							assert.ok(elapsedMs >= 120000, "Only a full request timeout is an expected high-level measurement.");
							t.diagnostic(JSON.stringify({ name, model, thinkingLevel, elapsedMs, outcome: "timeout", artifact: path }));
							return;
						}
						failed = true;
						stopped = true;
						throw error;
					}
				});
				if (failed) return;
			}
		});
	}
}
