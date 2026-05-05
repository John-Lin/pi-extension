# Upstream Source

- Source repo: <https://github.com/mitsuhiko/agent-stuff>
- Upstream path: `extensions/split-fork.ts`
- Upstream license: Apache License 2.0
- License copy: `../../third_party/licenses/agent-stuff-Apache-2.0.txt`
- The exact import commit was not recorded.
- Upstream reference checked on 2026-05-05: `b861028c706edf3e3f983cde09dd8cc8549ec948`

## Local changes

- Refactored the original single file into a directory-based extension.
- Extracted AppleScript helpers into dedicated modules.
- Added Ghostty split layout selection and launch-result parsing helpers.
- Adjusted startup input handling to avoid relying on `--` positional argument parsing.
