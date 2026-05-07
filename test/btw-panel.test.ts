import assert from "node:assert/strict";
import test from "node:test";

import { initTheme } from "@mariozechner/pi-coding-agent";

import { BtwBottomOverlay } from "../extensions/btw/panel.ts";

initTheme(undefined, false);

function createThemeStub() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		strikethrough: (text: string) => text,
		underline: (text: string) => text,
	};
}

test("btw panel shows an animated spinner indicator while waiting for the answer", () => {
	const panel = new BtwBottomOverlay(
		{
			requestRender() {},
			terminal: { rows: 40, columns: 120 },
		},
		createThemeStub(),
		"loading question",
		() => {},
	);

	try {
		const rendered = panel.render(60).join("\n");
		// Default pi-tui Loader uses Braille spinner frames; the first frame is "⠋".
		assert.match(rendered, /[⠀-⣿]/, "expected a Braille spinner frame in the loading body");
		assert.match(rendered, /Thinking/);
	} finally {
		panel.close();
	}
});

test("btw panel sizes itself to short content instead of always filling the cap", () => {
	const panel = new BtwBottomOverlay(
		{
			requestRender() {},
			terminal: { rows: 40, columns: 120 },
		},
		createThemeStub(),
		"short question",
		() => {},
	);
	panel.finish("a one-line answer");

	const lines = panel.render(60);
	assert.match(lines.join("\n"), /a one-line answer/);
	// Old behavior would render ~16 lines (40% of 40). With content-driven sizing,
	// the body section collapses to a single line and the whole panel stays compact.
	assert.ok(
		lines.length <= 8,
		`expected compact panel for short content, got ${lines.length} lines`,
	);
});

test("btw panel grows with streamed content up to a terminal-sized cap before scrolling kicks in", () => {
	const rows = 40;
	const panel = new BtwBottomOverlay(
		{
			requestRender() {},
			terminal: { rows, columns: 120 },
		},
		createThemeStub(),
		"growing answer",
		() => {},
	);

	panel.appendAnswer("first line\n");
	const small = panel.render(60);
	const smallHeight = small.length;

	for (let index = 2; index <= 80; index++) {
		panel.appendAnswer(`Line ${index}\n`);
	}
	const large = panel.render(60);

	assert.ok(large.length > smallHeight, `expected panel to grow with content (small=${smallHeight}, large=${large.length})`);
	// Cap should leave only a small outer chrome reserved for the chat/input behind
	// it (roughly the claude/src style: rows - ~6). On a 40-row terminal that means
	// the panel can use ~30+ lines for long answers.
	assert.ok(
		large.length >= rows - 10,
		`expected panel to expand near terminal height for long content, got ${large.length} lines (rows=${rows})`,
	);
	assert.ok(
		large.length <= rows - 4,
		`expected panel capped below full terminal height, got ${large.length} lines (rows=${rows})`,
	);
	assert.match(large.join("\n"), /first line/);
});

test("btw panel renders the invoked command starting at the top and supports page scrolling", () => {
	const panel = new BtwBottomOverlay(
		{
			requestRender() {},
			terminal: { rows: 40, columns: 120 },
		},
		createThemeStub(),
		"summarize the current session",
		() => {},
	);
	panel.finish(Array.from({ length: 30 }, (_, index) => `Line ${index + 1}`).join("\n"));

	const initial = panel.render(60).join("\n");
	assert.match(initial, /\/btw summarize the current session/);
	assert.doesNotMatch(initial, /Q:/);
	assert.match(initial, /Line 1\b/);
	assert.doesNotMatch(initial, /Line 30\b/);

	panel.handleInput("\x1b[6~");
	panel.handleInput("\x1b[6~");
	panel.handleInput("\x1b[6~");
	panel.handleInput("\x1b[6~");
	const paged = panel.render(60).join("\n");
	assert.match(paged, /Line 30\b/);
	assert.doesNotMatch(paged, /Line 1\b/);
});

test("btw panel renders markdown instead of showing markdown syntax", () => {
	const panel = new BtwBottomOverlay(
		{
			requestRender() {},
			terminal: { rows: 40, columns: 120 },
		},
		createThemeStub(),
		"show markdown",
		() => {},
	);
	panel.finish("This is **bold** and `code`.");

	const rendered = panel.render(80).join("\n");
	assert.match(rendered, /bold/);
	assert.match(rendered, /code/);
	assert.doesNotMatch(rendered, /\*\*bold\*\*/);
	assert.doesNotMatch(rendered, /`code`/);
});

test("btw panel stays at the top while streaming and does not auto-scroll", () => {
	const panel = new BtwBottomOverlay(
		{
			requestRender() {},
			terminal: { rows: 40, columns: 120 },
		},
		createThemeStub(),
		"stream long answer",
		() => {},
	);

	for (let index = 1; index <= 30; index++) {
		panel.appendAnswer(`Line ${index}\n`);
	}

	const rendered = panel.render(60).join("\n");
	assert.match(rendered, /Line 1\b/);
	assert.doesNotMatch(rendered, /Line 30\b/);
});

test("btw panel keeps the user's scroll position when more content streams in", () => {
	const panel = new BtwBottomOverlay(
		{
			requestRender() {},
			terminal: { rows: 40, columns: 120 },
		},
		createThemeStub(),
		"stream long answer",
		() => {},
	);

	for (let index = 1; index <= 50; index++) {
		panel.appendAnswer(`Line ${index}\n`);
	}
	panel.render(60);
	panel.handleInput("\x1b[6~");
	const afterScroll = panel.render(60).join("\n");

	for (let index = 51; index <= 80; index++) {
		panel.appendAnswer(`Line ${index}\n`);
	}
	const rendered = panel.render(60).join("\n");

	assert.doesNotMatch(rendered, /Line 80\b/);
	assert.doesNotMatch(afterScroll, /Line 1\b/);
});

test("btw panel syntax-highlights fenced code blocks", () => {
	const panel = new BtwBottomOverlay(
		{
			requestRender() {},
			terminal: { rows: 40, columns: 120 },
		},
		createThemeStub(),
		"show highlighted code",
		() => {},
	);
	panel.finish("```ts\nconst answer = 42;\n```");

	const rendered = panel.render(80).join("\n");
	assert.match(rendered, /const/);
	assert.match(rendered, /42/);
	assert.doesNotMatch(rendered, /const answer = 42;/);
});
