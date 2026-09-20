import assert from "node:assert/strict";
import { format } from "node:util";
import type { TestContext } from "node:test";

export function captureOutput(t: TestContext) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const env = process.env;
	const testEnv = { ...env, GEMINI_API_KEY: "google-test-key" };
	delete testEnv.TYPESAFE_API_KEY;
	process.env = testEnv;
	t.after(() => { process.env = env; });
	t.mock.method(console, "log", (...args: unknown[]) => stdout.push(format(...args)));
	t.mock.method(console, "error", (...args: unknown[]) => stderr.push(format(...args)));
	return { stdout, stderr };
}

// Only the external HTTP boundary is replaced; request construction, file
// streaming, response parsing, and cleanup run through the production code.
export function captureRequests(t: TestContext, responses: (Response | Error)[]) {
	const requests: { url: string; method: string; headers: Headers; body: string | Buffer | undefined }[] = [];
	t.mock.method(globalThis, "fetch", async (url: string | URL, options: RequestInit) => {
		const body = typeof options.body === "string" || options.body == null
			? options.body ?? undefined
			: Buffer.from(await new Response(options.body).arrayBuffer());
		requests.push({ url: String(url), method: options.method!, headers: new Headers(options.headers), body });
		const response = responses[requests.length - 1];
		assert.ok(response, `unexpected HTTP request: ${options.method} ${url}`);
		if (response instanceof Error) throw response;
		return response;
	});
	return requests;
}
