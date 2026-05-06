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

test("btw panel renders the invoked command and supports page scrolling", () => {
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
	assert.doesNotMatch(initial, /Line 11\b/);

	panel.handleInput("\x1b\[6~");
	const paged = panel.render(60).join("\n");
	assert.match(paged, /Line 11\b/);
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
