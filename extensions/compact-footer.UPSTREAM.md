# compact-footer upstream notes

Turn status behavior was adapted from `packages/coding-agent/examples/extensions/status-line.ts` in `earendil-works/pi-mono`.

Local changes:
- Merged turn status updates into the compact footer extension.
- Renders extension statuses inline with token/model footer stats instead of on a separate footer line.
- Adds local render and lifecycle test coverage in `test/compact-footer.test.ts`.
