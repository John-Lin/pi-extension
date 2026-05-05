export function buildGhosttyLaunchScript(direction) {
	const splitCommand = direction === "down"
		? "set newTerminal to split targetTerminal direction down with configuration cfg"
		: "set newTerminal to split targetTerminal direction right with configuration cfg";

	return `on run argv
	set targetCwd to item 1 of argv
	tell application "Ghostty"
		set cfg to new surface configuration
		set initial working directory of cfg to targetCwd

		if (count of windows) > 0 then
			try
				set frontWindow to front window
				set targetTerminal to focused terminal of selected tab of frontWindow
				${splitCommand}
				return "split\t" & (id of newTerminal as text)
			on error
				set newWindow to new window with configuration cfg
				set newTerminal to focused terminal of selected tab of newWindow
				return "new-window\t" & (id of newTerminal as text)
			end try
		else
			set newWindow to new window with configuration cfg
			set newTerminal to focused terminal of selected tab of newWindow
			return "new-window\t" & (id of newTerminal as text)
		end if
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
