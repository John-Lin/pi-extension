export const BTW_STARTUP_PROMPT_ENV = "PI_BTW_STARTUP_PROMPT_B64";

export function encodeBtwStartupPrompt(prompt: string): string | undefined {
	if (prompt.length === 0) {
		return undefined;
	}

	return Buffer.from(prompt, "utf8").toString("base64");
}

export function consumeBtwStartupPrompt(env: NodeJS.ProcessEnv = process.env): string | undefined {
	const encodedPrompt = env[BTW_STARTUP_PROMPT_ENV];
	if (!encodedPrompt) {
		return undefined;
	}

	delete env[BTW_STARTUP_PROMPT_ENV];
	const prompt = Buffer.from(encodedPrompt, "base64").toString("utf8");
	return prompt.length > 0 ? prompt : undefined;
}
