import { existsSync } from "node:fs";
import path from "node:path";

export function shellQuote(value) {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function getPiInvocationParts() {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return [process.execPath, currentScript];
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return [process.execPath];
	}

	return ["pi"];
}

export function buildBtwStartupCommand({ sessionFile, childExtensionPath, prompt }) {
	const envPrefix = `PI_BTW_TEMP_SESSION=${shellQuote(sessionFile)}`;
	const commandParts = [
		...getPiInvocationParts(),
		"--session",
		sessionFile,
		"--thinking",
		"off",
		"--no-tools",
		"-e",
		childExtensionPath,
	];

	// pi's arg parser does NOT treat `--` as POSIX end-of-options; it swallows
	// the next arg as an unknown empty-named flag (cli/args.js). Append the
	// prompt directly as a positional message instead.
	if (prompt) {
		commandParts.push(prompt);
	}

	return `${envPrefix} ${commandParts.map(shellQuote).join(" ")}; rm -f ${shellQuote(sessionFile)}`;
}
