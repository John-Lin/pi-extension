import type { KeybindingsManager } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import type { EditorTheme, TUI } from "@mariozechner/pi-tui";

export class HiddenEditor extends CustomEditor {
	private kb: KeybindingsManager;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings);
		this.kb = keybindings;
	}

	render(_width: number): string[] {
		return [];
	}

	handleInput(data: string): void {
		if (this.onExtensionShortcut?.(data)) return;

		if (this.kb.matches(data, "app.clipboard.pasteImage")) {
			this.onPasteImage?.();
			return;
		}
		if (this.kb.matches(data, "app.interrupt")) {
			(this.onEscape ?? this.actionHandlers.get("app.interrupt"))?.();
			return;
		}
		if (this.kb.matches(data, "app.exit")) {
			(this.onCtrlD ?? this.actionHandlers.get("app.exit"))?.();
			return;
		}
		for (const [action, handler] of this.actionHandlers) {
			if (action !== "app.interrupt" && action !== "app.exit" && this.kb.matches(data, action)) {
				handler();
				return;
			}
		}
		// Typed characters, Enter, paste, etc. are intentionally swallowed:
		// BTW is launched with the question; the pane has no further input.
	}
}
