import type { Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, type TUI, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

function wrapPanelText(text: string, width: number): string[] {
	const normalized = text.replace(/\r\n/g, "\n");
	const paragraphs = normalized.split("\n");
	const lines: string[] = [];

	for (const paragraph of paragraphs) {
		if (paragraph.length === 0) {
			lines.push("");
			continue;
		}
		lines.push(...wrapTextWithAnsi(paragraph, width));
	}

	return lines.length > 0 ? lines : [""];
}

export class BtwBottomOverlay {
	private readonly abortController = new AbortController();
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly question: string;
	private readonly done: () => void;
	private answer = "";
	private errorMessage: string | undefined;
	private loading = true;
	private scrollOffset = 0;
	private closed = false;

	constructor(tui: TUI, theme: Theme, question: string, done: () => void) {
		this.tui = tui;
		this.theme = theme;
		this.question = question;
		this.done = done;
	}

	get signal(): AbortSignal {
		return this.abortController.signal;
	}

	isClosed(): boolean {
		return this.closed;
	}

	appendAnswer(delta: string): void {
		if (this.closed || delta.length === 0) {
			return;
		}
		this.answer += delta;
		this.tui.requestRender();
	}

	finish(finalAnswer: string): void {
		if (this.closed) {
			return;
		}
		this.loading = false;
		if (finalAnswer.length > 0) {
			this.answer = finalAnswer;
		}
		this.tui.requestRender();
	}

	fail(message: string): void {
		if (this.closed) {
			return;
		}
		this.loading = false;
		this.errorMessage = message;
		this.tui.requestRender();
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.abortController.abort();
		this.done();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.close();
			return;
		}

		if (matchesKey(data, "up")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "down")) {
			this.scrollOffset += 1;
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const innerWidth = Math.max(20, width - 2);
		const border = (text: string) => this.theme.fg("border", text);
		const padLine = (text: string) => truncateToWidth(text, innerWidth, "...", true);
		const row = (text: string) => border("│") + padLine(text) + border("│");
		const title = this.theme.fg("accent", " BTW ");
		const titlePadding = Math.max(0, innerWidth - visibleWidth(title));

		const questionLines = wrapPanelText(this.theme.fg("muted", `Q: ${this.question}`), innerWidth);
		const bodyLines = this.getBodyLines(innerWidth);
		const maxPanelLines = Math.max(8, Math.floor(this.tui.terminal.rows * 0.4));
		const bodyLimit = Math.max(3, maxPanelLines - questionLines.length - 5);
		const maxScrollOffset = Math.max(0, bodyLines.length - bodyLimit);
		const scrollOffset = Math.min(this.scrollOffset, maxScrollOffset);
		const visibleBodyLines = bodyLines.slice(scrollOffset, scrollOffset + bodyLimit);
		const canScrollUp = scrollOffset > 0;
		const canScrollDown = scrollOffset < maxScrollOffset;
		const scrollInfo = canScrollUp || canScrollDown ? ` ↑${scrollOffset} ↓${maxScrollOffset - scrollOffset}` : "";
		const statusText = this.errorMessage
			? this.theme.fg("error", " BTW request failed")
			: this.loading
				? this.theme.fg("accent", " BTW is answering…")
				: this.theme.fg("success", " BTW answer complete");
		const footerText = canScrollUp || canScrollDown ? "↑↓ scroll • Esc close" : "Esc close";

		const lines = [border("╭") + title + border(`${"─".repeat(titlePadding)}╮`)];
		for (const line of questionLines) {
			lines.push(row(line));
		}
		lines.push(border("├") + border("─".repeat(innerWidth)) + border("┤"));
		lines.push(row(statusText + this.theme.fg("dim", scrollInfo)));
		for (const line of visibleBodyLines) {
			lines.push(row(line));
		}
		lines.push(row(this.theme.fg("dim", footerText)));
		lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {}

	private getBodyLines(innerWidth: number): string[] {
		if (this.errorMessage) {
			return wrapPanelText(this.theme.fg("error", this.errorMessage), innerWidth);
		}

		if (this.answer.length === 0) {
			return [this.theme.fg("dim", this.loading ? "Thinking…" : "No answer returned.")];
		}

		return wrapPanelText(this.answer, innerWidth);
	}
}
