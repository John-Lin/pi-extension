# Upstream Source

- Source repo: <https://github.com/earendil-works/pi> (formerly `earendil-works/pi-mono`)
- Upstream path: `packages/coding-agent/examples/extensions/notify.ts`
- Upstream license: MIT
- License copy: `../third_party/licenses/pi-MIT.txt`
- Adapted from a local checkout of `pi`.
- The exact upstream commit for the imported file was not separately recorded.

## Local changes

- Added macOS completion sound playback via `afplay`.
- Kept terminal notification support alongside sound playback.
- Added local unit tests in `test/notify.test.ts`.
