# pi-extension

Personal extensions for pi.

## Structure

```text
extensions/
  notify.ts
  btw/
    index.ts
    child.ts
    ghostty.ts
    launch.ts
    session.ts
  split-fork/
    index.ts
    count-osascript.ts
    layout.ts
    osascript.ts
```

Pi auto-discovers top-level extension files and directory entrypoints like `extensions/btw/index.ts`.

## Usage

Load a single extension for testing:

```bash
pi -e ./extensions/notify.ts
pi -e ./extensions/btw/index.ts
```

Install this repository as a project-local pi package:

```bash
pi install -l /path/to/pi-extension
```

After installation, pi loads extensions from `extensions/` using the `pi` manifest in `package.json`.
