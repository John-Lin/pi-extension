# Gemini Hydrogen search migration evaluation

Evaluated on 2026-11-20 (UTC). This is a small, human-reviewed search comparison,
not a statistical model ranking or a production latency SLA.

## Decision

- Use `gemini-4-hydrogen` at `low` for light reasoning and `medium` for deep reasoning.
- Keep `gemini-3.5-flash-lite` at `high` for direct retrieval and decision failures.
- Keep `gemini-decision-1`, its classification criteria, grounding validation,
  stateless requests, and the 120-second request timeout unchanged.
- Use Hydrogen as the manual default model, but explicitly retain the application's
  `medium` thinking default rather than inheriting the provider's `high` default.
- Do not promote `high` to an automatic route: two observed high-level requests
  timed out at 120 seconds. Higher reasoning depth did improve some migration
  details, but did not consistently fit the existing interactive timeout.

## Method and execution record

`gemini-search-models.live.mjs` compares five light and five deep public technical
queries. It uses the production prompt, request builder, text/citation extraction,
and grounding validator against the real Interactions API. Model order alternates.
The selected low/medium configurations are compared with Flash at the same level;
Hydrogen/high is an exploratory deep configuration. There are no HTTP mocks.

The planned batch was 25 requests. The first batch stopped after 16 attempts:
15 grounded responses and a Hydrogen/high webhook timeout. A mistaken Node name
pattern matched the parent test and caused a second full batch instead of only
remaining cases. That batch reached 25 attempts before the outer command deadline
interrupted the final Flash/medium grounding case.

Total: **41 attempts, 38 completed grounded responses, two Hydrogen/high request
timeouts, and one outer-runner interruption**. No further paid requests were made.
The duplicate runs and missing final baseline are retained in the analysis.

The runner now exposes each query as a top-level test, so exact name filtering
works. An offline regression selects `^deep/locks$` with an empty credential
location and verifies that exactly that case reaches credential resolution.
Another regression requires explicit `GEMINI_LIVE_EVALUATION=1` before any
credentials or paid requests are used. Help is safe without credentials. An
exploratory high-level timeout is recorded as an unsuitable candidate, never as a
successful answer; unexpected failures stop further requests.

## Observed measurements

| Comparable group | Flash mean complete-answer time | Hydrogen mean complete-answer time |
| --- | ---: | ---: |
| Light/low: five queries, two runs each | 16.098 s | 21.416 s |
| Deep/medium: six paired observations | 53.805 s | 55.549 s |

The six deep pairs are migration and webhooks in both runs, plus locks and fork
security in the second run. The extra Hydrogen grounding answer is excluded from
this paired time comparison because its Flash counterpart was interrupted.

All 17 Hydrogen low/medium attempts returned completed grounded answers. This
covers all ten distinct queries, but does not prove semantic correctness or a
future success rate. Hydrogen was not demonstrated faster: light answers averaged
about 33% slower, and the paired medium answers about 3% slower.

The 38 completed responses reported 342 Google Search grounding counts. Returned
usage yields an approximately **US$1.25 token-only estimate** at the observed
standard rates, including thought tokens and cached-input discounts. If all
reported grounding counts are billable queries, they add about **US$4.79**.
Monthly free grounding quota may reduce that amount. These are estimates, not
billing records; usage for the timed-out/interrupted requests was unavailable.

## Qualitative review and limitations

An independent audit inspected response text and consequential claims against
official documentation, rather than treating citation count as a quality score.

- Both models made an incorrect zero-retention claim in the storage query.
  `store:false` disables stored Interaction objects, not all provider retention.
- Hydrogen added useful details to npm, concurrent-index, Docker, and permission
  answers, but also made a wrong blanket foreground-output limit claim.
- Migration answers at medium needed further writer/backfill sequencing and lock
  review. High covered more edge cases but was slower and sometimes timed out.
- Webhook answers required careful distinction between GUID deduplication,
  cryptographic replay protection, and atomic state updates.

The comparison does **not** establish Hydrogen as safer overall. Treat security,
privacy, and production-operation recommendations as research drafts requiring
source verification and human review. The skill already documents that stateless
storage is not a zero-retention guarantee. No prompt or classifier changes were
mixed into this model migration.

## Reproduce deliberately

This command authorizes up to 25 billable requests; approve a budget first:

```bash
GEMINI_LIVE_EVALUATION=1 node --test test/gemini-search-models.live.mjs
```

For one query, use an exact top-level case name, for example:

```bash
GEMINI_LIVE_EVALUATION=1 node --test --test-name-pattern='^deep/locks$' test/gemini-search-models.live.mjs
```

The runner prints a temporary artifact directory containing raw responses and
request/usage/timing diagnostics. Those artifacts are not committed. The offline
suite is `npm test`; it does not authorize this live evaluation.

## Official references

- [Hydrogen migration guide](https://ai.google.dev/gemini-api/docs/whats-new-gemini-4-hydrogen#migrate-from-gemini-3-8-flash)
- [Model selection](https://ai.google.dev/gemini-api/docs/choosing-a-model)
- [Thinking levels](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Interaction storage](https://ai.google.dev/gemini-api/docs/interactions-overview#data-storage-retention)
- [Google Search grounding terms](https://ai.google.dev/gemini-api/docs/terms#grounding-with-google-search)
