export function getSplitDirectionForTerminalCount(terminalCount) {
	return terminalCount > 0 && terminalCount % 2 === 0 ? "down" : "right";
}

export function parseGhosttyTerminalCount(output) {
	const normalized = String(output ?? "").trim();
	if (!normalized) {
		return null;
	}

	if (normalized === "no-windows") {
		return 0;
	}

	const count = Number.parseInt(normalized, 10);
	return Number.isInteger(count) && count >= 0 ? count : null;
}

export function parseGhosttyLaunchResult(output) {
	const normalized = String(output ?? "").trim();
	if (!normalized) {
		return null;
	}

	const [kind, terminalId] = normalized.split("\t");
	if ((kind === "split" || kind === "new-window") && terminalId) {
		return { kind, terminalId };
	}

	return null;
}
