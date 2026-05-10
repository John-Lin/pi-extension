# pi-extension

Personal extensions for pi.

## Structure

```text
extensions/
  notify.ts
  compact-footer.ts
  btw/
    index.ts
    panel.ts
  split-fork/
    index.ts
    count-osascript.ts
    layout.ts
    osascript.ts
  plan-mode/
    index.ts
    utils.ts
    README.md
```

Pi auto-discovers top-level extension files and directory entrypoints like `extensions/btw/index.ts`.

`/btw` now runs as a bottom overlay inside pi, so it no longer depends on Ghostty or AppleScript.

## Usage

### Quick testing

Load a single extension without installing the package:

```bash
pi -e ./extensions/notify.ts
pi -e ./extensions/compact-footer.ts
pi -e ./extensions/btw/index.ts
pi -e ./extensions/plan-mode/index.ts
```

### Development install

Install the local checkout while developing extensions:

```bash
# Global install from the local checkout
pi install /path/to/pi-extension

# Project-local install from the local checkout
pi install -l /path/to/pi-extension
```

After changing an extension, restart pi or run `/reload` in an existing session.

### Git install

Install this repository from GitHub:

```bash
# Global install
pi install git:github.com/John-Lin/pi-extension

# Project-local install
pi install -l git:github.com/John-Lin/pi-extension
```

### Updating an installed copy

If you installed the local checkout, update the files in this repository and then restart pi or run `/reload`.
You do not need to run `pi install` again unless the install source changes.

If you installed from GitHub, pull the latest version with:

```bash
# Global install update
pi update git:github.com/John-Lin/pi-extension

# Project-local install update
pi update -l git:github.com/John-Lin/pi-extension
```

After installation, pi loads extensions from `extensions/` using the `pi` manifest in `package.json`.

## License

Original work in this repository is licensed under MIT. See `LICENSE`.

Adapted third-party code and license copies are documented in `ATTRIBUTION.md` and `third_party/licenses/`.
