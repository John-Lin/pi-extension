/**
 * Compact Footer Extension
 *
 * Keeps pi's default footer ordering, but renders extension statuses on the
 * token/model stats line instead of consuming their own footer line.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type FooterTheme = {
	fg(color: string, text: string): string;
};

type Usage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

type SessionEntryLike = {
	type: string;
	message?: {
		role?: string;
		usage?: Usage;
	};
};

type ContextUsageLike = {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
};

type ModelLike = {
	provider: string;
	id: string;
	reasoning?: boolean;
	contextWindow?: number;
};

type RenderCompactFooterOptions = {
	width: number;
	theme: FooterTheme;
	cwd: string;
	home?: string;
	branch: string | null;
	sessionName?: string;
	statuses: ReadonlyMap<string, string>;
	entries: readonly SessionEntryLike[];
	contextUsage: ContextUsageLike | undefined;
	model: ModelLike | undefined;
	providerCount: number;
	thinkingLevel: string;
	usingSubscription?: boolean;
};

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatWorkingDirectory(cwd: string, home: string | undefined, branch: string | null, sessionName: string | undefined): string {
	let pwd = cwd;
	if (home && pwd.startsWith(home)) {
		pwd = `~${pwd.slice(home.length)}`;
	}
	if (branch) {
		pwd = `${pwd} (${branch})`;
	}
	if (sessionName) {
		pwd = `${pwd} • ${sessionName}`;
	}
	return pwd;
}

function getTotals(entries: readonly SessionEntryLike[]): Usage {
	const totals: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: { total: 0 },
	};

	for (const entry of entries) {
		if (entry.type !== "message" || entry.message?.role !== "assistant" || !entry.message.usage) continue;
		totals.input += entry.message.usage.input;
		totals.output += entry.message.usage.output;
		totals.cacheRead += entry.message.usage.cacheRead;
		totals.cacheWrite += entry.message.usage.cacheWrite;
		totals.cost.total += entry.message.usage.cost.total;
	}

	return totals;
}

function buildStatusParts(statuses: ReadonlyMap<string, string>): string[] {
	return Array.from(statuses.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatusText(text))
		.filter(Boolean);
}

function buildRightSide(model: ModelLike | undefined, providerCount: number, thinkingLevel: string, leftWidth: number, width: number): string {
	const modelName = model?.id || "no-model";
	let withoutProvider = modelName;
	if (model?.reasoning) {
		withoutProvider = thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
	}

	if (!model || providerCount <= 1) return withoutProvider;

	const withProvider = `(${model.provider}) ${withoutProvider}`;
	return leftWidth + 2 + visibleWidth(withProvider) > width ? withoutProvider : withProvider;
}

export function renderCompactFooterLines(options: RenderCompactFooterOptions): string[] {
	const totals = getTotals(options.entries);
	const statsParts = buildStatusParts(options.statuses);

	if (totals.input) statsParts.push(`↑${formatTokens(totals.input)}`);
	if (totals.output) statsParts.push(`↓${formatTokens(totals.output)}`);
	if (totals.cacheRead) statsParts.push(`R${formatTokens(totals.cacheRead)}`);
	if (totals.cacheWrite) statsParts.push(`W${formatTokens(totals.cacheWrite)}`);
	if (totals.cost.total || options.usingSubscription) {
		statsParts.push(`$${totals.cost.total.toFixed(3)}${options.usingSubscription ? " (sub)" : ""}`);
	}

	const contextWindow = options.contextUsage?.contextWindow ?? options.model?.contextWindow ?? 0;
	const contextPercentValue = options.contextUsage?.percent ?? 0;
	const contextPercent = options.contextUsage?.percent !== null && options.contextUsage?.percent !== undefined ? contextPercentValue.toFixed(1) : "?";
	const contextDisplay = `${contextPercent}%/${formatTokens(Number(contextWindow))}`;
	const contextPart =
		contextPercentValue > 90
			? options.theme.fg("error", contextDisplay)
			: contextPercentValue > 70
				? options.theme.fg("warning", contextDisplay)
				: contextDisplay;
	statsParts.push(contextPart);

	let statsLeft = statsParts.join(" ");
	let statsLeftWidth = visibleWidth(statsLeft);
	if (statsLeftWidth > options.width) {
		statsLeft = truncateToWidth(statsLeft, options.width, "...");
		statsLeftWidth = visibleWidth(statsLeft);
	}

	const rightSide = buildRightSide(options.model, options.providerCount, options.thinkingLevel, statsLeftWidth, options.width);
	const rightSideWidth = visibleWidth(rightSide);
	const minPadding = 2;
	const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

	let statsLine: string;
	if (totalNeeded <= options.width) {
		statsLine = statsLeft + " ".repeat(options.width - statsLeftWidth - rightSideWidth) + rightSide;
	} else {
		const availableForRight = options.width - statsLeftWidth - minPadding;
		if (availableForRight > 0) {
			const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
			statsLine = statsLeft + " ".repeat(Math.max(0, options.width - statsLeftWidth - visibleWidth(truncatedRight))) + truncatedRight;
		} else {
			statsLine = statsLeft;
		}
	}

	const pwd = formatWorkingDirectory(options.cwd, options.home, options.branch, options.sessionName);
	const dimStatsLeft = options.theme.fg("dim", statsLeft);
	const dimRemainder = options.theme.fg("dim", statsLine.slice(statsLeft.length));

	return [
		truncateToWidth(options.theme.fg("dim", pwd), options.width, options.theme.fg("dim", "...")),
		dimStatsLeft + dimRemainder,
	];
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					return renderCompactFooterLines({
						width,
						theme,
						cwd: ctx.sessionManager.getCwd(),
						home: process.env.HOME || process.env.USERPROFILE,
						branch: footerData.getGitBranch(),
						sessionName: ctx.sessionManager.getSessionName(),
						statuses: footerData.getExtensionStatuses(),
						entries: ctx.sessionManager.getEntries() as readonly SessionEntryLike[],
						contextUsage: ctx.getContextUsage(),
						model: ctx.model,
						providerCount: footerData.getAvailableProviderCount(),
						thinkingLevel: pi.getThinkingLevel(),
						usingSubscription: ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false,
					});
				},
			};
		});
	});
}
