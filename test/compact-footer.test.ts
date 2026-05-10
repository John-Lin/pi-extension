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
		autoCompactEnabled: true,
	});

	assert.equal(lines.length, 2);
	assert.equal(lines[0], "~/workspace/pi-extension");
	assert.match(
		lines[1],
		/^✓ Turn 12 complete ↑150k ↓8\.6k R596k \$1\.308 25\.3%\/272k \(auto\) +\(openai\) gpt-5\.5 • medium$/,
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
		autoCompactEnabled: true,
	});

	assert.equal(lines.length, 2);
	assert.equal(lines[1].includes("Ready"), true);
});
