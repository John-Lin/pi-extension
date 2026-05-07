import { highlightCode, type Theme } from "@mariozechner/pi-coding-agent";
import { Loader, Markdown, matchesKey, truncateToWidth, type MarkdownTheme, type TUI, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

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

function createMarkdownTheme(theme: Theme): MarkdownTheme {
	return {
		heading: (text: string) => theme.fg("mdHeading", text),
		link: (text: string) => theme.fg("mdLink", text),
		linkUrl: (text: string) => theme.fg("mdLinkUrl", text),
		code: (text: string) => theme.fg("mdCode", text),
		codeBlock: (text: string) => theme.fg("mdCodeBlock", text),
		codeBlockBorder: (text: string) => theme.fg("mdCodeBlockBorder", text),
		quote: (text: string) => theme.fg("mdQuote", text),
		quoteBorder: (text: string) => theme.fg("mdQuoteBorder", text),
		hr: (text: string) => theme.fg("mdHr", text),
		listBullet: (text: string) => theme.fg("mdListBullet", text),
		bold: (text: string) => theme.bold(text),
		italic: (text: string) => theme.italic(text),
		strikethrough: (text: string) => theme.strikethrough(text),
		underline: (text: string) => theme.underline(text),
		highlightCode: (code: string, lang?: string) => highlightCode(code, lang),
	};
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
	private lastBodyLimit = 1;
	private closed = false;
	private readonly loader: Loader;

	constructor(tui: TUI, theme: Theme, question: string, done: () => void) {
		this.tui = tui;
		this.theme = theme;
		this.question = question;
		this.done = done;
		this.loader = new Loader(
			tui,
			(text) => this.theme.fg("accent", text),
			(text) => this.theme.fg("dim", text),
			"Thinking…",
		);
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
		if (this.answer.length === 0) {
			// First streamed bytes have arrived; the partial answer itself signals
			// progress, so retire the indicator.
			this.loader.stop();
		}
		this.answer += delta;
		this.tui.requestRender();
	}

	finish(finalAnswer: string): void {
		if (this.closed) {
			return;
		}
		this.loading = false;
		this.loader.stop();
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
		this.loader.stop();
		this.errorMessage = message;
		this.tui.requestRender();
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.loader.stop();
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
			return;
		}

		if (matchesKey(data, "pageDown")) {
			this.scrollOffset += this.lastBodyLimit;
			this.tui.requestRender();
			return;
		}

		if (matchesKey(data, "pageUp")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.lastBodyLimit);
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const innerWidth = Math.max(20, width - 2);
		// 1-space horizontal padding inside the borders, mirroring the
		// paddingLeft used by the upstream /btw layout.
		const horizontalPadding = 1;
		const contentWidth = Math.max(1, innerWidth - horizontalPadding * 2);
		const border = (text: string) => this.theme.fg("border", text);
		const padLine = (text: string) => truncateToWidth(text, contentWidth, "...", true);
		const padding = " ".repeat(horizontalPadding);
		const row = (text: string) => border("│") + padding + padLine(text) + padding + border("│");
		const blankRow = border("│") + " ".repeat(innerWidth) + border("│");
		const title = this.theme.fg("accent", " BTW ");
		const titlePadding = Math.max(0, innerWidth - visibleWidth(title));

		const questionLines = wrapPanelText(this.theme.fg("muted", `/btw ${this.question}`), contentWidth);
		const bodyLines = this.getBodyLines(contentWidth);
		// Leave ~12 rows of chat visible above the overlay so the panel does not
		// feel like it covers the entire screen. The panel chrome (top border,
		// separator, status, blank-before-footer, footer, bottom border = 6) plus
		// the question lines are subtracted from this cap; the body fills the rest
		// and shrinks for short content.
		const maxPanelLines = Math.max(8, this.tui.terminal.rows - 12);
		const bodyLimit = Math.max(3, maxPanelLines - questionLines.length - 6);
		this.lastBodyLimit = bodyLimit;
		const maxScrollOffset = Math.max(0, bodyLines.length - bodyLimit);
		const scrollOffset = Math.min(this.scrollOffset, maxScrollOffset);
		this.scrollOffset = scrollOffset;
		const visibleBodyLines = bodyLines.slice(scrollOffset, scrollOffset + bodyLimit);
		const canScrollUp = scrollOffset > 0;
		const canScrollDown = scrollOffset < maxScrollOffset;
		const scrollInfo = canScrollUp || canScrollDown ? ` ↑${scrollOffset} ↓${maxScrollOffset - scrollOffset}` : "";
		const statusText = this.errorMessage
			? this.theme.fg("error", "BTW request failed")
			: this.loading
				? this.theme.fg("accent", "BTW is answering…")
				: this.theme.fg("success", "BTW answer complete");
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
		lines.push(blankRow);
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
			if (this.loading) {
				// Loader prepends an empty separator line to its render output;
				// drop that and any other blank rows so the panel body stays compact.
				const loaderLines = this.loader.render(innerWidth).filter((line) => line.length > 0);
				return loaderLines.length > 0 ? loaderLines : [this.theme.fg("dim", "Thinking…")];
			}
			return [this.theme.fg("dim", "No answer returned.")];
		}

		const markdown = new Markdown(this.answer, 0, 0, createMarkdownTheme(this.theme), {
			color: (text: string) => this.theme.fg("text", text),
		});
		return markdown.render(innerWidth);
	}
}
