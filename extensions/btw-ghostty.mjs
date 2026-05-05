export function buildGhosttyBtwSplitScript() {
	return `on run argv
	set targetCwd to item 1 of argv
	tell application "Ghostty"
		if (count of windows) = 0 then
			error "No Ghostty window is available to split."
		end if

		set cfg to new surface configuration
		set initial working directory of cfg to targetCwd
		set frontWindow to front window
		set targetTerminal to focused terminal of selected tab of frontWindow
		set newTerminal to split targetTerminal direction down with configuration cfg
		return "split\t" & (id of newTerminal as text)
	end tell
end run`;
}

export function buildGhosttyInputScript() {
	return `on run argv
	set terminalId to item 1 of argv
	set startupInput to item 2 of argv

	tell application "Ghostty"
		set targetTerminal to first terminal whose id is terminalId
		focus targetTerminal
		input text startupInput to targetTerminal
		send key "enter" to targetTerminal
		activate
	end tell
end run`;
}

export function parseGhosttyLaunchResult(output) {
	const normalized = String(output ?? "").trim();
	if (!normalized) {
		return null;
	}

	const [kind, terminalId] = normalized.split("\t");
	if (kind === "split" && terminalId) {
		return { kind, terminalId };
	}

	return null;
}
