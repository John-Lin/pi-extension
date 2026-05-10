import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderCompactFooterLines } from "../extensions/compact-footer.ts";

const theme = {
	fg(_color: string, text: string) {
		return text;
	},
};

test("compact footer prefixes extension status to the stats line", () => {
	const lines = renderCompactFooterLines({
		width: 120,
		theme,
		cwd: "/home/johnlin/workspace/pi-extension",
		home: "/home/johnlin",
		branch: null,
		sessionName: undefined,
		statuses: new Map([["status-demo", "✓ Turn 12 complete"]]),
		entries: [
			{
				type: "message",
				message: {
					role: "assistant",
					usage: {
						input: 150_000,
						output: 8_600,
						cacheRead: 596_000,
						cacheWrite: 0,
						cost: { total: 1.308 },
					},
				},
			},
		],
		contextUsage: { tokens: 68_816, contextWindow: 272_000, percent: 25.3 },
		model: { provider: "openai", id: "gpt-5.5", reasoning: true },
		providerCount: 2,
		thinkingLevel: "medium",
	});

	assert.equal(lines.length, 2);
	assert.equal(lines[0], "~/workspace/pi-extension");
	assert.match(
		lines[1],
		/^✓ Turn 12 complete ↑150k ↓8\.6k R596k \$1\.308 25\.3%\/272k +\(openai\) gpt-5\.5 • medium$/,
	);
});

test("compact footer does not render extension statuses as a separate line", () => {
	const lines = renderCompactFooterLines({
		width: 100,
		theme,
		cwd: "/tmp/project",
		home: "/home/johnlin",
		branch: "main",
		statuses: new Map([["status-demo", "Ready"]]),
		entries: [],
		contextUsage: { tokens: null, contextWindow: 272_000, percent: null },
		model: { provider: "openai", id: "gpt-5.5", reasoning: false },
		providerCount: 2,
		thinkingLevel: "off",
	});

	assert.equal(lines.length, 2);
	assert.equal(lines[1].includes("Ready"), true);
});

test("compact footer renders unknown context percent without percent coloring", () => {
	const colors: string[] = [];
	const lines = renderCompactFooterLines({
		width: 100,
		theme: {
			fg(color: string, text: string) {
				colors.push(color);
				return text;
			},
		},
		cwd: "/tmp/project",
		home: "/home/johnlin",
		branch: null,
		statuses: new Map(),
		entries: [],
		contextUsage: { tokens: null, contextWindow: 272_000, percent: null },
		model: { provider: "openai", id: "gpt-5.5", reasoning: false },
		providerCount: 2,
		thinkingLevel: "off",
	});

	assert.equal(lines[1].includes("?/272k"), true);
	assert.equal(colors.includes("warning"), false);
	assert.equal(colors.includes("error"), false);
});

test("compact footer ignores assistant entries with invalid usage shape", () => {
	const lines = renderCompactFooterLines({
		width: 100,
		theme,
		cwd: "/tmp/project",
		home: "/home/johnlin",
		branch: null,
		statuses: new Map(),
		entries: [
			{
				type: "message",
				message: {
					role: "assistant",
					usage: {
						input: "not-a-number",
						output: 10,
						cacheRead: 20,
						cacheWrite: 30,
						cost: { total: "not-a-number" },
					},
				},
			},
		] as readonly unknown[],
		contextUsage: { tokens: 1_000, contextWindow: 272_000, percent: 0.4 },
		model: { provider: "openai", id: "gpt-5.5", reasoning: false },
		providerCount: 2,
		thinkingLevel: "off",
	});

	assert.equal(lines[1].includes("not-a-number"), false);
	assert.equal(lines[1].includes("NaN"), false);
});

test("compact footer colors context display as warning when usage exceeds 70%", () => {
	const calls: { color: string; text: string }[] = [];
	const lines = renderCompactFooterLines({
		width: 100,
		theme: {
			fg(color: string, text: string) {
				calls.push({ color, text });
				return text;
			},
		},
		cwd: "/tmp/project",
		home: "/home/johnlin",
		branch: null,
		statuses: new Map(),
		entries: [],
		contextUsage: { tokens: 204_000, contextWindow: 272_000, percent: 75.0 },
		model: { provider: "openai", id: "gpt-5.5", reasoning: false },
		providerCount: 1,
		thinkingLevel: "off",
	});

	assert.ok(calls.some((c) => c.color === "warning" && c.text === "75.0%/272k"));
	assert.equal(calls.some((c) => c.color === "error"), false);
	assert.ok(lines[1].includes("75.0%/272k"));
});

test("compact footer colors context display as error when usage exceeds 90%", () => {
	const calls: { color: string; text: string }[] = [];
	const lines = renderCompactFooterLines({
		width: 100,
		theme: {
			fg(color: string, text: string) {
				calls.push({ color, text });
				return text;
			},
		},
		cwd: "/tmp/project",
		home: "/home/johnlin",
		branch: null,
		statuses: new Map(),
		entries: [],
		contextUsage: { tokens: 258_000, contextWindow: 272_000, percent: 95.0 },
		model: { provider: "openai", id: "gpt-5.5", reasoning: false },
		providerCount: 1,
		thinkingLevel: "off",
	});

	assert.ok(calls.some((c) => c.color === "error" && c.text === "95.0%/272k"));
	assert.equal(calls.some((c) => c.color === "warning"), false);
	assert.ok(lines[1].includes("95.0%/272k"));
});

test("compact footer truncates stats with ellipsis when they exceed the line width", () => {
	const lines = renderCompactFooterLines({
		width: 30,
		theme,
		cwd: "/tmp/project",
		home: "/home/johnlin",
		branch: null,
		statuses: new Map([["status-demo", "Ready"]]),
		entries: [
			{
				type: "message",
				message: {
					role: "assistant",
					usage: {
						input: 150_000,
						output: 8_600,
						cacheRead: 596_000,
						cacheWrite: 0,
						cost: { total: 1.308 },
					},
				},
			},
		],
		contextUsage: { tokens: 68_816, contextWindow: 272_000, percent: 25.3 },
		model: { provider: "openai", id: "gpt-5.5", reasoning: false },
		providerCount: 1,
		thinkingLevel: "off",
	});

	assert.ok(lines[1].includes("..."));
	assert.equal(lines[1].includes("gpt-5.5"), false);
	assert.equal(visibleWidth(lines[1]), 30);
});

test("compact footer truncates the right side when the model name does not fit", () => {
	const longModelId = "extremely-long-model-name-that-overflows-the-line";
	const lines = renderCompactFooterLines({
		width: 50,
		theme,
		cwd: "/tmp/project",
		home: "/home/johnlin",
		branch: null,
		statuses: new Map([["status-demo", "Ready"]]),
		entries: [],
		contextUsage: { tokens: null, contextWindow: 272_000, percent: null },
		model: { provider: "openai", id: longModelId, reasoning: false },
		providerCount: 1,
		thinkingLevel: "off",
	});

	assert.ok(lines[1].startsWith("Ready"));
	assert.equal(lines[1].includes(longModelId), false);
	assert.ok(lines[1].includes(longModelId.slice(0, 20)));
	assert.equal(visibleWidth(lines[1]), 50);
});

test("compact footer normalizes whitespace and control chars in status text", () => {
	const lines = renderCompactFooterLines({
		width: 120,
		theme,
		cwd: "/tmp/project",
		home: "/home/johnlin",
		branch: null,
		statuses: new Map([["status-demo", "  ✓\tTurn 4   complete\n  "]]),
		entries: [],
		contextUsage: { tokens: 1_000, contextWindow: 272_000, percent: 0.4 },
		model: { provider: "openai", id: "gpt-5.5", reasoning: false },
		providerCount: 1,
		thinkingLevel: "off",
	});

	assert.ok(lines[1].includes("✓ Turn 4 complete"));
	assert.equal(lines[1].includes("\n"), false);
	assert.equal(lines[1].includes("\t"), false);
	assert.equal(lines[1].includes("Turn 4  complete"), false);
});

test("compact footer registers a session_start handler", async () => {
	type EventHandler = (...args: unknown[]) => unknown;
	const handlers = new Map<string, EventHandler>();
	const pi = {
		on(event: string, handler: EventHandler) {
			handlers.set(event, handler);
		},
	};
	const module = await import("../extensions/compact-footer.ts");
	module.default(pi);

	assert.ok(handlers.has("session_start"));
});

test("compact footer keeps token stats dim after colored status text resets ansi", () => {
	const dim = "\x1b[2m";
	const green = "\x1b[32m";
	const reset = "\x1b[0m";
	const ansiTheme = {
		fg(color: string, text: string) {
			if (color === "dim") return `${dim}${text}${reset}`;
			if (color === "success") return `${green}${text}${reset}`;
			return text;
		},
	};

	const lines = renderCompactFooterLines({
		width: 120,
		theme: ansiTheme,
		cwd: "/tmp/project",
		home: "/home/johnlin",
		branch: null,
		statuses: new Map([["status-demo", `${ansiTheme.fg("success", "✓")}${ansiTheme.fg("dim", " Turn 12 complete")}`]]),
		entries: [
			{
				type: "message",
				message: {
					role: "assistant",
					usage: {
						input: 150_000,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						cost: { total: 0 },
					},
				},
			},
		],
		contextUsage: { tokens: 1_000, contextWindow: 272_000, percent: 0.4 },
		model: { provider: "openai", id: "gpt-5.5", reasoning: false },
		providerCount: 2,
		thinkingLevel: "off",
	});

	assert.equal(lines[1].includes(`${reset} ${dim}↑150k`), true);
});
