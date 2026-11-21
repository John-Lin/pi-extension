import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captureOutput, captureRequests } from "./helpers/gemini-cli.ts";

function decisionResponse(choice: string, confidence: number, probabilities: Record<string, number>) {
	return Response.json({
		answers: { required_work: { type: "choice", choice, confidence, probabilities } },
		usage: {
			total_input_tokens: 100,
			input_tokens_by_modality: [{ modality: "text", tokens: 100 }],
			total_output_tokens: 0,
			total_tokens: 100,
		},
	});
}

// In-process entry-point unit tests, with only external HTTP replaced.
// Grounding fixtures are recorded Google responses; decision cases follow the documented schema.
for (const [skill, tool] of [["gemini-web-search", "google_search"], ["gemini-maps-search", "google_maps"]]) {
	const module = await import(`../skills/${skill}/search.mjs`);
	// Exercise grounding validation independently of automatic model selection.
	const runSearch = (args: string[]) => module.main(tool === "google_search" ? [...args, "--model", "gemini-4-hydrogen"] : args);
	const sample = JSON.parse(readFileSync(new URL(`../skills/${skill}/fixtures/sample-interaction.json`, import.meta.url), "utf8"));

	test(`${skill} returns a completed grounded answer without storing the interaction`, async (t) => {
		const { stdout, stderr } = captureOutput(t);
		const requests = captureRequests(t, [Response.json(sample)]);
		assert.equal(await runSearch(["test query", "--json"]), 0);
		assert.equal(stdout.length, 1);
		assert.equal(JSON.parse(stdout[0]).text, sample.steps.find((step) => step.type === "model_output").content[0].text);
		assert.deepEqual(stderr, []);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
		assert.equal(requests[0].headers.get("x-goog-api-key"), "google-test-key");
		assert.equal(JSON.parse(requests[0].body as string).store, false);
	});

	for (const status of ["failed", "incomplete", "budget_exceeded", "cancelled", "in_progress", "requires_action", "queued", undefined]) {
		test(`${skill} rejects ${status ?? "missing"} status even when an answer exists`, async (t) => {
			const { stdout, stderr } = captureOutput(t);
			captureRequests(t, [Response.json({ ...sample, status })]);
			assert.equal(await runSearch(["test query", "--json"]), 1);
			assert.deepEqual(stdout, []);
			assert.equal(stderr.length, 1);
			assert.match(stderr[0], new RegExp(`did not complete.*${status ?? "missing"}`));
		});
	}

	for (const [name, alter, message] of [
		["no grounding execution", (steps) => steps.filter((step) => step.type === "model_output"), /grounding was not executed/],
		["no grounding result", (steps) => steps.filter((step) => step.type !== `${tool}_result`), /grounding result is missing/],
		["an unrelated grounding result", (steps) => steps.map((step) => step.type === `${tool}_result` ? { ...step, call_id: "unrelated" } : step), /grounding result is missing/],
		["malformed grounding results", (steps) => steps.map((step) => step.type === `${tool}_result` ? { ...step, result: null } : step), /grounding result is invalid/],
		["an extra unmatched grounding result", (steps) => [...steps, { ...steps.find((step) => step.type === `${tool}_result`), call_id: "unrelated" }], /grounding result does not match a call/],
	] as const) {
		test(`${skill} rejects ${name} instead of presenting unverified text`, async (t) => {
			const { stdout, stderr } = captureOutput(t);
			captureRequests(t, [Response.json({ ...sample, steps: alter(sample.steps) })]);
			assert.equal(await runSearch(["test query"]), 1);
			assert.deepEqual(stdout, []);
			assert.equal(stderr.length, 1);
			assert.match(stderr[0], message);
		});
	}

	test(`${skill} accepts a successful grounding call that found no matches`, async (t) => {
		const { stdout, stderr } = captureOutput(t);
		const steps = sample.steps.map((step) => {
			if (step.type === `${tool}_result`) return { ...step, result: [] };
			if (step.type === "model_output") return { ...step, content: [{ type: "text", text: "No matching results.", annotations: [] }] };
			return step;
		});
		captureRequests(t, [Response.json({ ...sample, steps })]);
		assert.equal(await runSearch(["test query"]), 0);
		assert.equal(stdout.length, 1);
		assert.match(stdout[0], /No matching results\./);
		assert.deepEqual(stderr, []);
	});

	for (const output_text of ["", " \n "]) {
		test(`${skill} rejects an empty answer after successful grounding (${JSON.stringify(output_text)})`, async (t) => {
			const { stdout, stderr } = captureOutput(t);
			captureRequests(t, [Response.json({ ...sample, output_text, steps: sample.steps.filter((step) => step.type !== "model_output") })]);
			assert.equal(await runSearch(["test query"]), 1);
			assert.deepEqual(stdout, []);
			assert.equal(stderr.length, 1);
			assert.match(stderr[0], /did not contain text/);
		});
	}

	test(`${skill} reports HTTP errors without emitting a result`, async (t) => {
		const { stdout, stderr } = captureOutput(t);
		captureRequests(t, [new Response("quota exceeded", { status: 429 })]);
		assert.equal(await runSearch(["test query"]), 1);
		assert.deepEqual(stdout, []);
		assert.deepEqual(stderr, ["Error: Interactions request failed (429)", "Body: quota exceeded"]);
	});

	// Node's built-in fetch gives up waiting for response headers after 300 s
	// (UND_ERR_HEADERS_TIMEOUT), so a longer timeout could never take effect.
	test(`${skill} caps --timeout at the 300 s Node fetch limit`, () => {
		assert.equal(module.parseArgs(["q"]).timeoutMs, 120000);
		assert.equal(module.parseArgs(["q", "--timeout", "600000"]).timeoutMs, 300000);
		assert.equal(module.parseArgs(["q", "--timeout=250000"]).timeoutMs, 250000);
		assert.match(module.usage(), /--timeout\s+Request timeout in milliseconds \(default: 120000, maximum: 300000\)/);
	});

	test(`${skill} names the underlying cause when fetch fails`, async (t) => {
		const { stdout, stderr } = captureOutput(t);
		// Shape of Node's built-in fetch failure when no response headers arrive in time.
		const cause = Object.assign(new Error("Headers Timeout Error"), { name: "HeadersTimeoutError", code: "UND_ERR_HEADERS_TIMEOUT" });
		captureRequests(t, [new TypeError("fetch failed", { cause })]);
		assert.equal(await runSearch(["test query"]), 1);
		assert.deepEqual(stdout, []);
		assert.deepEqual(stderr, ["Error: fetch failed: Headers Timeout Error (UND_ERR_HEADERS_TIMEOUT)"]);
	});

	if (tool === "google_search") {
		for (const [flags, model, thinkingLevel] of [
			[["--model", "gemini-3.5-flash-lite"], "gemini-3.5-flash-lite", "high"],
			[["--model=gemini-3.5-flash-lite"], "gemini-3.5-flash-lite", "high"],
			[["--model", "gemini-4-hydrogen"], "gemini-4-hydrogen", "high"],
			[["--thinking", "low"], "gemini-3.5-flash-lite", "low"],
			[["--thinking=medium"], "gemini-3.5-flash-lite", "medium"],
			[["--model", "gemini-4-hydrogen", "--thinking=xhigh"], "gemini-4-hydrogen", "xhigh"],
			[["--model", "gemini-4-hydrogen", "--thinking", "high"], "gemini-4-hydrogen", "high"],
		] as const) {
			test(`gemini-web-search bypasses decisions for explicit ${flags.join(" ")}`, async (t) => {
				const { stdout, stderr } = captureOutput(t);
				const requests = captureRequests(t, [Response.json(sample)]);
				assert.equal(await module.main(["test query", ...flags, "--json"]), 0);
				assert.equal(requests.length, 1);
				assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
				const googleRequest = JSON.parse(requests[0].body as string);
				assert.equal(googleRequest.model, model);
				assert.deepEqual(googleRequest.generation_config, { thinking_level: thinkingLevel });
				const result = JSON.parse(stdout[0]);
				assert.equal(result.model, model);
				assert.equal(result.thinkingLevel, thinkingLevel);
				assert.equal(result.decision, undefined);
				assert.deepEqual(stderr, []);
			});
		}

		for (const [choice, model, thinkingLevel, probabilities] of [
			["direct_retrieval", "gemini-3.5-flash-lite", "high", { direct_retrieval: 0.8, light_reasoning: 0.1, deep_reasoning: 0.1 }],
			["light_reasoning", "gemini-4-hydrogen", "low", { direct_retrieval: 0.1, light_reasoning: 0.8, deep_reasoning: 0.1 }],
			["deep_reasoning", "gemini-4-hydrogen", "medium", { direct_retrieval: 0.1, light_reasoning: 0.1, deep_reasoning: 0.8 }],
		] as const) {
			test(`gemini-web-search applies Gemini's ${choice} decision before grounding`, async (t) => {
				const { stdout, stderr } = captureOutput(t);
				const requests = captureRequests(t, [decisionResponse(choice, 0.8, probabilities), Response.json(sample)]);
				assert.equal(await module.main(["test query", "--purpose", "test purpose", "--json"]), 0);
				assert.equal(requests.length, 2);
				assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/decisions");
				assert.equal(requests[0].headers.get("x-goog-api-key"), "google-test-key");
				assert.equal(requests[0].headers.get("authorization"), null);
				assert.equal(requests[0].method, "POST");
				const decisionRequest = JSON.parse(requests[0].body as string);
				assert.equal(decisionRequest.model, "gemini-decision-1");
				assert.deepEqual(JSON.parse(decisionRequest.input), { query: "test query" });
				assert.equal(requests[1].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
				assert.equal(requests[1].headers.get("x-goog-api-key"), "google-test-key");
				const googleRequest = JSON.parse(requests[1].body as string);
				assert.equal(googleRequest.model, model);
				assert.deepEqual(googleRequest.generation_config, { thinking_level: thinkingLevel });
				assert.equal(googleRequest.store, false);
				assert.match(googleRequest.input, /test purpose/);
				const result = JSON.parse(stdout[0]);
				assert.equal(result.model, model);
				assert.equal(result.thinkingLevel, thinkingLevel);
				assert.deepEqual(result.decision, { choice, confidence: 0.8, probabilities });
				assert.deepEqual(stderr, []);
			});
		}

		for (const failure of ["HTTP quota", "grounding tool"]) {
			test(`gemini-web-search reports ${failure} failure after a decision without switching models`, async (t) => {
				const { stdout, stderr } = captureOutput(t);
				const groundingFailure = failure === "HTTP quota"
					? new Response("quota exceeded", { status: 429 })
					: Response.json({
						...sample,
						steps: sample.steps.map((step) => step.type === "google_search_result" ? { ...step, is_error: true } : step),
					});
				const requests = captureRequests(t, [
					decisionResponse("light_reasoning", 0.8, { direct_retrieval: 0.1, light_reasoning: 0.8, deep_reasoning: 0.1 }),
					groundingFailure,
				]);
				assert.equal(await module.main(["test query", "--json"]), 1);
				assert.equal(requests.length, 2);
				assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/decisions");
				assert.equal(requests[1].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
				assert.equal(JSON.parse(requests[1].body as string).model, "gemini-4-hydrogen");
				assert.deepEqual(stdout, []);
				assert.deepEqual(stderr, failure === "HTTP quota"
					? ["Error: Interactions request failed (429)", "Body: quota exceeded"]
					: ["Error: google_search grounding failed."]);
			});
		}

		test("gemini-web-search prints the decision and selected thinking level in human output", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			captureRequests(t, [
				decisionResponse("light_reasoning", 0.78, { deep_reasoning: 0.12, light_reasoning: 0.78, direct_retrieval: 0.1 }),
				Response.json(sample),
			]);
			assert.equal(await module.main(["test query"]), 0);
			assert.match(stdout[0], /^Model: gemini-4-hydrogen \(thinking: low, auth: env:GEMINI_API_KEY\)$/m);
			assert.match(stdout[0], /^Decision: light_reasoning \(confidence: 0\.78; probabilities: deep_reasoning=0\.12, light_reasoning=0\.78, direct_retrieval=0\.1\)$/m);
			assert.deepEqual(stderr, []);
		});

		for (const status of [408, 429, 500, 503, 504]) {
			test(`gemini-web-search retries a transient decision HTTP ${status} before searching`, async (t) => {
				const { stdout, stderr } = captureOutput(t);
				const requests = captureRequests(t, [
					new Response("temporarily unavailable", { status, headers: { "retry-after": "0" } }),
					decisionResponse("light_reasoning", 0.9, { deep_reasoning: 0.05, light_reasoning: 0.9, direct_retrieval: 0.05 }),
					Response.json(sample),
				]);
				assert.equal(await module.main(["test query", "--json"]), 0);
				assert.equal(requests.length, 3);
				assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/decisions");
				assert.equal(requests[1].url, requests[0].url);
				assert.notEqual(requests[0].signal, requests[1].signal);
				assert.equal(JSON.parse(requests[2].body as string).model, "gemini-4-hydrogen");
				assert.equal(JSON.parse(stdout[0]).thinkingLevel, "low");
				assert.deepEqual(stderr, []);
			});
		}

		for (const failure of ["network", "response body"]) {
			test(`gemini-web-search retries a decision ${failure} failure before searching`, async (t) => {
				const { stdout, stderr } = captureOutput(t);
				const brokenBody = new ReadableStream({
					start(controller) { controller.error(new Error("connection reset while reading")); },
				});
				const requests = captureRequests(t, [
					failure === "network" ? new Error("connection reset") : new Response(brokenBody),
					decisionResponse("direct_retrieval", 0.9, { deep_reasoning: 0.05, light_reasoning: 0.05, direct_retrieval: 0.9 }),
					Response.json(sample),
				]);
				assert.equal(await module.main(["test query", "--json"]), 0);
				assert.equal(requests.length, 3);
				assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/decisions");
				assert.equal(requests[1].url, requests[0].url);
				assert.notEqual(requests[0].signal, requests[1].signal);
				assert.equal(JSON.parse(requests[2].body as string).model, "gemini-3.5-flash-lite");
				assert.equal(JSON.parse(stdout[0]).thinkingLevel, "high");
				assert.deepEqual(stderr, []);
			});
		}

		test("gemini-web-search uses the Flash-Lite fallback after decision retries fail", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			const overloaded = () => new Response("temporarily overloaded", {
				status: 503,
				headers: { "retry-after": "0" },
			});
			const requests = captureRequests(t, [overloaded(), overloaded(), Response.json(sample)]);
			assert.equal(await module.main(["test query", "--json"]), 0);
			assert.equal(requests.length, 3);
			assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/decisions");
			assert.equal(requests[1].url, requests[0].url);
			assert.equal(requests[2].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
			assert.equal(JSON.parse(requests[2].body as string).model, "gemini-3.5-flash-lite");
			assert.equal(JSON.parse(stdout[0]).thinkingLevel, "high");
			assert.equal(JSON.parse(stdout[0]).decision, undefined);
			assert.deepEqual(stderr, [
				"Warning: Gemini decision failed; continuing without automatic selection. Decision request failed (503): temporarily overloaded",
			]);
		});

		for (const status of [400, 401, 403]) {
			test(`gemini-web-search falls back without retrying decision HTTP ${status}`, async (t) => {
				const { stdout, stderr } = captureOutput(t);
				const requests = captureRequests(t, [new Response("request rejected", { status }), Response.json(sample)]);
				assert.equal(await module.main(["test query", "--json"]), 0);
				assert.equal(requests.length, 2);
				assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/decisions");
				assert.equal(JSON.parse(requests[1].body as string).model, "gemini-3.5-flash-lite");
				assert.equal(JSON.parse(stdout[0]).thinkingLevel, "high");
				assert.equal(JSON.parse(stdout[0]).decision, undefined);
				assert.deepEqual(stderr, [
					`Warning: Gemini decision failed; continuing without automatic selection. Decision request failed (${status}): request rejected`,
				]);
			});
		}

		for (const [name, answers] of [
			["missing choice answer", {}],
			["array-valued choice", {
				required_work: {
					type: "choice",
					choice: ["deep_reasoning"],
					confidence: 0.8,
					probabilities: { direct_retrieval: 0.1, light_reasoning: 0.1, deep_reasoning: 0.8 },
				},
			}],
		] as const) {
			test(`gemini-web-search falls back on a decision with ${name}`, async (t) => {
				const { stdout, stderr } = captureOutput(t);
				const requests = captureRequests(t, [
					Response.json({
						answers,
						usage: {
							total_input_tokens: 100,
							input_tokens_by_modality: [{ modality: "text", tokens: 100 }],
							total_output_tokens: 0,
							total_tokens: 100,
						},
					}),
					Response.json(sample),
				]);
				assert.equal(await module.main(["test query", "--json"]), 0);
				assert.equal(requests.length, 2);
				assert.equal(JSON.parse(requests[1].body as string).model, "gemini-3.5-flash-lite");
				assert.deepEqual(JSON.parse(requests[1].body as string).generation_config, { thinking_level: "high" });
				assert.equal(JSON.parse(stdout[0]).thinkingLevel, "high");
				assert.equal(JSON.parse(stdout[0]).decision, undefined);
				assert.deepEqual(stderr, [
					"Warning: Gemini decision failed; continuing without automatic selection. Gemini Decision returned an invalid Gemini configuration.",
				]);
			});
		}

		test("gemini-web-search falls back on invalid decision JSON without retrying", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			const requests = captureRequests(t, [new Response("{ invalid json"), Response.json(sample)]);
			assert.equal(await module.main(["test query", "--json"]), 0);
			assert.equal(requests.length, 2);
			assert.equal(JSON.parse(requests[1].body as string).model, "gemini-3.5-flash-lite");
			assert.equal(JSON.parse(stdout[0]).decision, undefined);
			assert.equal(stderr.length, 1);
			assert.match(stderr[0], /^Warning: Gemini decision failed; continuing without automatic selection\..*JSON/);
		});

		test("gemini-web-search names the network cause after decision retries fail", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			const unreachable = () => new TypeError("fetch failed", {
				cause: Object.assign(new Error("getaddrinfo ENOTFOUND generativelanguage.googleapis.com"), { code: "ENOTFOUND" }),
			});
			const requests = captureRequests(t, [unreachable(), unreachable(), Response.json(sample)]);
			assert.equal(await module.main(["test query", "--json"]), 0);
			assert.equal(requests.length, 3);
			assert.equal(JSON.parse(requests[2].body as string).model, "gemini-3.5-flash-lite");
			assert.deepEqual(stderr, [
				"Warning: Gemini decision failed; continuing without automatic selection. fetch failed: getaddrinfo ENOTFOUND generativelanguage.googleapis.com (ENOTFOUND)",
			]);
			assert.equal(JSON.parse(stdout[0]).decision, undefined);
		});

		test(`${skill} rejects an unmatched grounding error beside a successful search`, async (t) => {
			const { stdout, stderr } = captureOutput(t);
			const failedResult = { type: "google_search_result", call_id: "unrelated", is_error: true, result: [] };
			captureRequests(t, [Response.json({ ...sample, steps: [...sample.steps, failedResult] })]);
			assert.equal(await runSearch(["test query"]), 1);
			assert.deepEqual(stdout, []);
			assert.equal(stderr.length, 1);
			assert.match(stderr[0], /grounding result does not match a call/);
		});

		test(`${skill} rejects a grounding error even if other searches succeeded`, async (t) => {
			const { stdout, stderr } = captureOutput(t);
			const failedCall = { ...sample.steps.find((step) => step.type === "google_search_call"), id: "failed-call" };
			const failedResult = { type: "google_search_result", call_id: "failed-call", is_error: true, result: [] };
			captureRequests(t, [Response.json({ ...sample, steps: [...sample.steps, failedCall, failedResult] })]);
			assert.equal(await runSearch(["test query"]), 1);
			assert.deepEqual(stdout, []);
			assert.equal(stderr.length, 1);
			assert.match(stderr[0], /google_search grounding failed/);
		});
	}
}
