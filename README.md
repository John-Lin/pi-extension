# pi-extension

Personal extensions for pi.

## Structure

```text
extensions/
```

## Usage

Load a single extension for testing:

```bash
pi -e ./extensions/my-extension.ts
```

Install this repository as a project-local pi package:

```bash
pi install -l /path/to/pi-extension
```

After installation, pi loads extensions from `extensions/` using the `pi` manifest in `package.json`.
