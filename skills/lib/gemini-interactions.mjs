export function validateInteraction(interaction, groundingTool) {
	if (interaction?.status !== "completed") {
		throw new Error(`Gemini interaction did not complete (status: ${interaction?.status ?? "missing"}).`);
	}
	if (!groundingTool) return;

	const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
	const calls = steps.filter((step) => step?.type === `${groundingTool}_call`);
	if (calls.length === 0) {
		throw new Error(`${groundingTool} grounding was not executed.`);
	}
	const toolResults = steps.filter((step) => step?.type === `${groundingTool}_result`);
	for (const call of calls) {
		const results = toolResults.filter((result) => call.id && result.call_id === call.id);
		if (results.length === 0) {
			throw new Error(`${groundingTool} grounding result is missing.`);
		}
		if (results.some((result) => result.is_error === true)) {
			throw new Error(`${groundingTool} grounding failed.`);
		}
		if (results.some((result) => !Array.isArray(result.result))) {
			throw new Error(`${groundingTool} grounding result is invalid.`);
		}
	}
	if (toolResults.some((result) => !calls.some((call) => call.id && call.id === result.call_id))) {
		throw new Error(`${groundingTool} grounding result does not match a call.`);
	}
}
