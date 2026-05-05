export function buildGhosttyTerminalCountScript() {
	return `tell application "Ghostty"
	if (count of windows) = 0 then
		return "no-windows"
	end if

	set frontWindow to front window
	set targetTab to selected tab of frontWindow
	return ((count of terminals of targetTab) as text)
end tell`;
}
