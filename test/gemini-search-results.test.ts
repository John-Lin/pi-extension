import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captureOutput, captureRequests } from "./helpers/gemini-cli.ts";

function jevResponse(choice: string, confidence: number, probabilities: Record<string, number>) {
	return Response.json({ answers: { required_work: { choice, confidence, probabilities } } });
}

// In-process entry-point unit tests, with only external HTTP replaced.
// Fixtures are recorded Google responses; failure cases alter the relevant field.
for (const [skill, tool] of [["gemini-web-search", "google_search"], ["gemini-maps-search", "google_maps"]]) {
	const module = await import(`../skills/${skill}/search.mjs`);
	const sample = JSON.parse(readFileSync(new URL(`../skills/${skill}/fixtures/sample-interaction.json`, import.meta.url), "utf8"));

	test(`${skill} returns a completed grounded answer without storing the interaction`, async (t) => {
		const { stdout, stderr } = captureOutput(t);
		const requests = captureRequests(t, [Response.json(sample)]);
		assert.equal(await module.main(["test query", "--json"]), 0);
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
			assert.equal(await module.main(["test query", "--json"]), 1);
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
			assert.equal(await module.main(["test query"]), 1);
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
		assert.equal(await module.main(["test query"]), 0);
		assert.equal(stdout.length, 1);
		assert.match(stdout[0], /No matching results\./);
		assert.deepEqual(stderr, []);
	});

	for (const output_text of ["", " \n "]) {
		test(`${skill} rejects an empty answer after successful grounding (${JSON.stringify(output_text)})`, async (t) => {
			const { stdout, stderr } = captureOutput(t);
			captureRequests(t, [Response.json({ ...sample, output_text, steps: sample.steps.filter((step) => step.type !== "model_output") })]);
			assert.equal(await module.main(["test query"]), 1);
			assert.deepEqual(stdout, []);
			assert.equal(stderr.length, 1);
			assert.match(stderr[0], /did not contain text/);
		});
	}

	test(`${skill} reports HTTP errors without emitting a result`, async (t) => {
		const { stdout, stderr } = captureOutput(t);
		captureRequests(t, [new Response("quota exceeded", { status: 429 })]);
		assert.equal(await module.main(["test query"]), 1);
		assert.deepEqual(stdout, []);
		assert.deepEqual(stderr, ["Error: Interactions request failed (429)", "Body: quota exceeded"]);
	});

	if (tool === "google_search") {
		test("gemini-web-search preserves explicit model and thinking flags without a Jev key", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			const requests = captureRequests(t, [Response.json(sample)]);
			assert.equal(await module.main(["test query", "--model", "gemini-3.8-flash", "--thinking", "low", "--json"]), 0);
			assert.equal(requests.length, 1);
			const googleRequest = JSON.parse(requests[0].body as string);
			assert.equal(googleRequest.model, "gemini-3.8-flash");
			assert.deepEqual(googleRequest.generation_config, { thinking_level: "low" });
			assert.deepEqual(stderr, []);
			assert.equal(JSON.parse(stdout[0]).model, "gemini-3.8-flash");
		});

		test("gemini-web-search applies Jev's Choice before making the Google request", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			process.env.TYPESAFE_API_KEY = "typesafe-test-key";
			const requests = captureRequests(t, [
				jevResponse("direct_retrieval", 0.82, {
					deep_reasoning: 0.08,
					light_reasoning: 0.1,
					direct_retrieval: 0.82,
				}),
				Response.json(sample),
			]);
			assert.equal(await module.main(["test query", "--model", "ignored", "--thinking", "high", "--json"]), 0);
			assert.equal(requests.length, 2);
			assert.equal(requests[0].url, "https://api.typesafe.ai/v1/systemone");
			assert.equal(requests[0].headers.get("authorization"), "Bearer typesafe-test-key");
			assert.deepEqual(JSON.parse(requests[0].body as string).state, { query: "test query" });
			const googleRequest = JSON.parse(requests[1].body as string);
			assert.equal(googleRequest.model, "gemini-3.1-flash-lite");
			assert.deepEqual(googleRequest.generation_config, { thinking_level: "minimal" });
			assert.equal(JSON.parse(stdout[0]).model, "gemini-3.1-flash-lite");
			assert.equal(JSON.parse(stdout[0]).thinkingLevel, "minimal");
			assert.deepEqual(JSON.parse(stdout[0]).jev, {
				choice: "direct_retrieval",
				confidence: 0.82,
				probabilities: {
					deep_reasoning: 0.08,
					light_reasoning: 0.1,
					direct_retrieval: 0.82,
				},
			});
			assert.deepEqual(stderr, []);
		});

		test("gemini-web-search prints Jev's selected thinking level in human output", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			process.env.TYPESAFE_API_KEY = "typesafe-test-key";
			captureRequests(t, [
				jevResponse("light_reasoning", 0.78, {
					deep_reasoning: 0.12,
					light_reasoning: 0.78,
					direct_retrieval: 0.1,
				}),
				Response.json(sample),
			]);
			assert.equal(await module.main(["test query"]), 0);
			assert.match(stdout[0], /^Model: gemini-3\.8-flash \(thinking: low, auth: env:GEMINI_API_KEY\)$/m);
			assert.match(stdout[0], /^Jev: light_reasoning \(confidence: 0\.78; probabilities: deep_reasoning=0\.12, light_reasoning=0\.78, direct_retrieval=0\.1\)$/m);
			assert.deepEqual(stderr, []);
		});

		test("gemini-web-search retries a transient Jev selection failure before searching", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			process.env.TYPESAFE_API_KEY = "typesafe-test-key";
			const requests = captureRequests(t, [
				new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
				jevResponse("light_reasoning", 0.9, {
					deep_reasoning: 0.05,
					light_reasoning: 0.9,
					direct_retrieval: 0.05,
				}),
				Response.json(sample),
			]);
			assert.equal(await module.main(["test query", "--json"]), 0);
			assert.equal(requests.length, 3);
			assert.equal(requests[0].url, "https://api.typesafe.ai/v1/systemone");
			assert.equal(requests[1].url, "https://api.typesafe.ai/v1/systemone");
			assert.equal(JSON.parse(requests[2].body as string).model, "gemini-3.8-flash");
			assert.equal(JSON.parse(stdout[0]).thinkingLevel, "low");
			assert.deepEqual(stderr, []);
		});

		test("gemini-web-search retries a Jev network failure before searching", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			process.env.TYPESAFE_API_KEY = "typesafe-test-key";
			const requests = captureRequests(t, [
				new Error("connection reset"),
				jevResponse("direct_retrieval", 0.9, {
					deep_reasoning: 0.05,
					light_reasoning: 0.05,
					direct_retrieval: 0.9,
				}),
				Response.json(sample),
			]);
			assert.equal(await module.main(["test query", "--json"]), 0);
			assert.equal(requests.length, 3);
			assert.equal(requests[0].url, "https://api.typesafe.ai/v1/systemone");
			assert.equal(requests[1].url, "https://api.typesafe.ai/v1/systemone");
			assert.notEqual(requests[0].signal, requests[1].signal);
			assert.equal(JSON.parse(requests[2].body as string).model, "gemini-3.1-flash-lite");
			assert.equal(JSON.parse(stdout[0]).thinkingLevel, "minimal");
			assert.deepEqual(stderr, []);
		});

		test("gemini-web-search retries when the Jev response body fails", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			process.env.TYPESAFE_API_KEY = "typesafe-test-key";
			const brokenBody = new ReadableStream({
				start(controller) {
					controller.error(new Error("connection reset while reading"));
				},
			});
			const requests = captureRequests(t, [
				new Response(brokenBody),
				jevResponse("light_reasoning", 0.9, {
					deep_reasoning: 0.05,
					light_reasoning: 0.9,
					direct_retrieval: 0.05,
				}),
				Response.json(sample),
			]);
			assert.equal(await module.main(["test query", "--json"]), 0);
			assert.equal(requests.length, 3);
			assert.equal(requests[0].url, "https://api.typesafe.ai/v1/systemone");
			assert.equal(requests[1].url, "https://api.typesafe.ai/v1/systemone");
			assert.equal(JSON.parse(requests[2].body as string).model, "gemini-3.8-flash");
			assert.equal(JSON.parse(stdout[0]).thinkingLevel, "low");
			assert.deepEqual(stderr, []);
		});

		test("gemini-web-search falls back to Gemini defaults after transient Jev retries fail", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			process.env.TYPESAFE_API_KEY = "typesafe-test-key";
			const overloaded = () => new Response("temporarily overloaded", {
				status: 529,
				headers: { "retry-after": "0" },
			});
			const requests = captureRequests(t, [overloaded(), overloaded(), Response.json(sample)]);
			assert.equal(await module.main(["test query", "--json"]), 0);
			assert.equal(requests.length, 3);
			assert.equal(requests[0].url, "https://api.typesafe.ai/v1/systemone");
			assert.equal(requests[1].url, "https://api.typesafe.ai/v1/systemone");
			assert.equal(requests[2].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
			assert.equal(JSON.parse(requests[2].body as string).model, "gemini-3.8-flash");
			assert.equal(JSON.parse(stdout[0]).thinkingLevel, "medium");
			assert.equal(JSON.parse(stdout[0]).jev, undefined);
			assert.deepEqual(stderr, [
				"Warning: Jev selection failed; continuing without Jev. Jev selection request failed (529): temporarily overloaded",
			]);
		});

		test("gemini-web-search falls back without retrying a non-transient Jev failure", async (t) => {
			const { stdout, stderr } = captureOutput(t);
			process.env.TYPESAFE_API_KEY = "typesafe-test-key";
			const requests = captureRequests(t, [
				new Response("invalid TypeSafe key", { status: 401 }),
				Response.json(sample),
			]);
			assert.equal(await module.main(["test query", "--json"]), 0);
			assert.equal(requests.length, 2);
			assert.equal(requests[0].url, "https://api.typesafe.ai/v1/systemone");
			assert.equal(requests[1].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
			assert.equal(JSON.parse(requests[1].body as string).model, "gemini-3.8-flash");
			assert.equal(JSON.parse(stdout[0]).jev, undefined);
			assert.deepEqual(stderr, [
				"Warning: Jev selection failed; continuing without Jev. Jev selection request failed (401): invalid TypeSafe key",
			]);
		});

		test(`${skill} rejects an unmatched grounding error beside a successful search`, async (t) => {
			const { stdout, stderr } = captureOutput(t);
			const failedResult = { type: "google_search_result", call_id: "unrelated", is_error: true, result: [] };
			captureRequests(t, [Response.json({ ...sample, steps: [...sample.steps, failedResult] })]);
			assert.equal(await module.main(["test query"]), 1);
			assert.deepEqual(stdout, []);
			assert.equal(stderr.length, 1);
			assert.match(stderr[0], /grounding result does not match a call/);
		});

		test(`${skill} rejects a grounding error even if other searches succeeded`, async (t) => {
			const { stdout, stderr } = captureOutput(t);
			const failedCall = { ...sample.steps.find((step) => step.type === "google_search_call"), id: "failed-call" };
			const failedResult = { type: "google_search_result", call_id: "failed-call", is_error: true, result: [] };
			captureRequests(t, [Response.json({ ...sample, steps: [...sample.steps, failedCall, failedResult] })]);
			assert.equal(await module.main(["test query"]), 1);
			assert.deepEqual(stdout, []);
			assert.equal(stderr.length, 1);
			assert.match(stderr[0], /google_search grounding failed/);
		});
	}
}
