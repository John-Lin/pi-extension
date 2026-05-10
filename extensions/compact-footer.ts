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
	type: "message";
	message: {
		role: "assistant";
		usage: Usage;
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
	entries: readonly unknown[];
	contextUsage: ContextUsageLike | undefined;
	model: ModelLike | undefined;
	providerCount: number;
	thinkingLevel: string;
	usingSubscription?: boolean;
};

type BuildRightSideOptions = {
	model: ModelLike | undefined;
	providerCount: number;
	thinkingLevel: string;
	leftWidth: number;
	width: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isUsage(value: unknown): value is Usage {
	if (!isRecord(value) || !isRecord(value.cost)) return false;
	return (
		isNumber(value.input) &&
		isNumber(value.output) &&
		isNumber(value.cacheRead) &&
		isNumber(value.cacheWrite) &&
		isNumber(value.cost.total)
	);
}

function isAssistantEntryWithUsage(entry: unknown): entry is SessionEntryLike {
	if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return false;
	return entry.message.role === "assistant" && isUsage(entry.message.usage);
}

function getTotals(entries: readonly unknown[]): Usage {
	const totals: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: { total: 0 },
	};

	for (const entry of entries) {
		if (!isAssistantEntryWithUsage(entry)) continue;
		totals.input += entry.message.usage.input;
		totals.output += entry.message.usage.output;
		totals.cacheRead += entry.message.usage.cacheRead;
		totals.cacheWrite += entry.message.usage.cacheWrite;
		totals.cost.total += entry.message.usage.cost.total;
	}

	return totals;
}

function buildStatusParts(statuses: ReadonlyMap<string, string>): readonly string[] {
	return Array.from(statuses.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, text]) => sanitizeStatusText(text))
		.filter(Boolean);
}

function buildTokenParts(theme: FooterTheme, totals: Usage, usingSubscription: boolean | undefined): readonly string[] {
	const parts: string[] = [];
	if (totals.input) parts.push(theme.fg("dim", `↑${formatTokens(totals.input)}`));
	if (totals.output) parts.push(theme.fg("dim", `↓${formatTokens(totals.output)}`));
	if (totals.cacheRead) parts.push(theme.fg("dim", `R${formatTokens(totals.cacheRead)}`));
	if (totals.cacheWrite) parts.push(theme.fg("dim", `W${formatTokens(totals.cacheWrite)}`));
	if (totals.cost.total || usingSubscription) {
		parts.push(theme.fg("dim", `$${totals.cost.total.toFixed(3)}${usingSubscription ? " (sub)" : ""}`));
	}
	return parts;
}

function buildContextPart(theme: FooterTheme, contextUsage: ContextUsageLike | undefined, model: ModelLike | undefined): string {
	const contextWindow = contextUsage?.contextWindow ?? model?.contextWindow ?? 0;
	const contextPercentValue = contextUsage?.percent;
	const contextDisplay =
		contextPercentValue != null
			? `${contextPercentValue.toFixed(1)}%/${formatTokens(contextWindow)}`
			: `?/${formatTokens(contextWindow)}`;

	if (contextPercentValue != null && contextPercentValue > 90) return theme.fg("error", contextDisplay);
	if (contextPercentValue != null && contextPercentValue > 70) return theme.fg("warning", contextDisplay);
	return theme.fg("dim", contextDisplay);
}

function buildRightSide(options: BuildRightSideOptions): string {
	const modelName = options.model?.id || "no-model";
	let withoutProvider = modelName;
	if (options.model?.reasoning) {
		withoutProvider = options.thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${options.thinkingLevel}`;
	}

	if (!options.model || options.providerCount <= 1) return withoutProvider;

	const withProvider = `(${options.model.provider}) ${withoutProvider}`;
	return options.leftWidth + 2 + visibleWidth(withProvider) > options.width ? withoutProvider : withProvider;
}

export function renderCompactFooterLines(options: RenderCompactFooterOptions): string[] {
	const totals = getTotals(options.entries);
	const statusParts = buildStatusParts(options.statuses);
	const tokenParts = buildTokenParts(options.theme, totals, options.usingSubscription);
	const contextPart = buildContextPart(options.theme, options.contextUsage, options.model);
	const statsParts = [...statusParts, ...tokenParts, contextPart];

	let statsLeft = statsParts.join(" ");
	let statsLeftWidth = visibleWidth(statsLeft);
	if (statsLeftWidth > options.width) {
		statsLeft = truncateToWidth(statsLeft, options.width, options.theme.fg("dim", "..."));
		statsLeftWidth = visibleWidth(statsLeft);
	}

	const rightSide = buildRightSide({
		model: options.model,
		providerCount: options.providerCount,
		thinkingLevel: options.thinkingLevel,
		leftWidth: statsLeftWidth,
		width: options.width,
	});
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
	const dimRemainder = options.theme.fg("dim", statsLine.slice(statsLeft.length));

	return [
		truncateToWidth(options.theme.fg("dim", pwd), options.width, options.theme.fg("dim", "...")),
		statsLeft + dimRemainder,
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
						home: process.env.HOME,
						branch: footerData.getGitBranch(),
						sessionName: ctx.sessionManager.getSessionName(),
						statuses: footerData.getExtensionStatuses(),
						entries: ctx.sessionManager.getEntries(),
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
