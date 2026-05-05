import { existsSync } from "node:fs";
import path from "node:path";
import { BTW_STARTUP_PROMPT_ENV, encodeBtwStartupPrompt } from "./startup-prompt.ts";

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
	const envAssignments = [`PI_BTW_TEMP_SESSION=${shellQuote(sessionFile)}`];
	const encodedPrompt = encodeBtwStartupPrompt(prompt);
	if (encodedPrompt) {
		envAssignments.push(`${BTW_STARTUP_PROMPT_ENV}=${shellQuote(encodedPrompt)}`);
	}
	const commandParts = [
		...getPiInvocationParts(),
		"--session",
		sessionFile,
		"--no-tools",
		"-e",
		childExtensionPath,
	];

	return `${envAssignments.join(" ")} ${commandParts.map(shellQuote).join(" ")}; rm -f ${shellQuote(sessionFile)}`;
}
