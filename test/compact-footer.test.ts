import assert from "node:assert/strict";
import test from "node:test";
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
