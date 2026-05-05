# Attribution and Third-Party Notices

This repository is licensed under MIT for original work by John Lin. Some files include material adapted from other repositories. Those files remain subject to the upstream license notices documented here and copied under `third_party/licenses/`.

## Original work

- `extensions/btw/` — original extension developed by John Lin.

## Adapted from `badlogic/pi-mono` (MIT)

- Source repo: <https://github.com/badlogic/pi-mono>
- Upstream license: MIT
- License copy: `third_party/licenses/pi-mono-MIT.txt`
- Imported or adapted paths:
  - `extensions/notify.ts` from `packages/coding-agent/examples/extensions/notify.ts`
  - `extensions/plan-mode/` from `packages/coding-agent/examples/extensions/plan-mode/`
  - `extensions/status-line.ts` from `packages/coding-agent/examples/extensions/status-line.ts`
- Notes:
  - `notify.ts` adds macOS completion sound playback and local tests.
  - `plan-mode/` was copied from a local checkout of `pi-mono` on 2026-05-05. The exact upstream commit for the copied files was not separately recorded.

## Adapted from `mitsuhiko/agent-stuff` (Apache-2.0)

- Source repo: <https://github.com/mitsuhiko/agent-stuff>
- Upstream license: Apache License 2.0
- License copy: `third_party/licenses/agent-stuff-Apache-2.0.txt`
- Adapted path:
  - `extensions/split-fork/` based on `extensions/split-fork.ts`
- Notes:
  - The exact import commit was not recorded.
  - Upstream reference checked during attribution update: `b861028c706edf3e3f983cde09dd8cc8549ec948` on 2026-05-05.
  - Local changes include refactoring the single file into a directory, extracting AppleScript helpers, and adding split layout selection logic.
