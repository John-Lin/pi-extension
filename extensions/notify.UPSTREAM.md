# Upstream Source

- Source repo: <https://github.com/earendil-works/pi> (formerly `earendil-works/pi-mono`)
- Upstream path: `packages/coding-agent/examples/extensions/notify.ts`
- Upstream license: MIT
- License copy: `../third_party/licenses/pi-MIT.txt`
- Adapted from a local checkout of `pi`.
- The exact upstream commit for the imported file was not separately recorded.

## Local changes

- Added macOS completion sound playback via `afplay` and Linux playback via `paplay`.
- Kept terminal notification support alongside sound playback.
- Aligned completion notifications with Pi 1.4.0's `agent_settled` event so retries,
  compaction, and queued work finish before notifying.
- Restricted notifications and sound to `ctx.mode === "tui"` with TTY stdout.
  RPC also reports `hasUI`, so it is not a terminal-safety check.
- Added local unit tests in `test/notify.test.ts`.
