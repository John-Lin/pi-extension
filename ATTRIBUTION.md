# Attribution and Third-Party Notices

This repository is licensed under MIT for original work by John Lin. Some files include material adapted from other repositories. Those files remain subject to the upstream license notices documented here and copied under `third_party/licenses/`.

## Original work

- `extensions/btw/` — original extension developed by John Lin.
## Adapted from `earendil-works/pi` (MIT)

- Source repo: <https://github.com/earendil-works/pi> (formerly `earendil-works/pi-mono`)
- Upstream license: MIT
- License copy: `third_party/licenses/pi-MIT.txt`
- Imported or adapted paths:
  - `extensions/notify.ts` from `packages/coding-agent/examples/extensions/notify.ts`
  - `extensions/plan-mode/` from `packages/coding-agent/examples/extensions/plan-mode/`
  - `extensions/tps.ts` from `.pi/extensions/tps.ts`
- Notes:
  - `notify.ts` adds macOS completion sound playback and local tests.
  - `plan-mode/` was copied from a local checkout on 2026-05-05. The exact upstream commit for the copied files was not separately recorded.
  - `tps.ts` was copied as-is on 2026-05-18 at upstream commit `3e5ad67e0f325d4888f82f9b82966218eb4407f5`.

## Adapted from `mitsuhiko/agent-stuff` (Apache-2.0)

- Source repo: <https://github.com/mitsuhiko/agent-stuff>
- Upstream license: Apache License 2.0
- License copy: `third_party/licenses/agent-stuff-Apache-2.0.txt`
- Adapted paths:
  - `skills/native-web-search/` based on `skills/native-web-search/`
- Notes:
  - `native-web-search/` was copied on 2026-08-04 at upstream commit `a3f8ab1108a48fec9e175f6cd5d9aaa4694ce29d`.
  - Local changes to `native-web-search/` include pinning the openai-codex model, removing the `@earendil-works/pi-ai` dependency and its module resolution, dropping the credential-file write-back, adding response-completion checks, and adding tests.
  - `skills/openai-web-search/` is an original reimplementation but reuses the research-prompt wording and output contract that originate from `skills/native-web-search/` in the same upstream repo.
