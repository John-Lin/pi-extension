import assert from "node:assert/strict";
import test from "node:test";

import { BtwBottomOverlay } from "../extensions/btw/panel.ts";

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
