import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	buildPrompt,
	buildRequestBody,
	extractPlaces,
	parseArgs,
	usage,
} from "../skills/gemini-maps-search/search.mjs";

const sample = JSON.parse(
	readFileSync(new URL("../skills/gemini-maps-search/fixtures/sample-interaction.json", import.meta.url), "utf8"),
);

test("parseArgs collects the query and defaults", () => {
	const a = parseArgs(["italian", "restaurants", "nearby"]);
	assert.equal(a.query, "italian restaurants nearby");
	assert.equal(a.purpose, "general place research");
	assert.equal(a.latitude, undefined);
	assert.equal(a.longitude, undefined);
	assert.equal(a.json, false);
	assert.equal(a.raw, false);
	assert.equal(a.model, undefined);
});

test("parseArgs reads coordinates in both flag forms", () => {
	const split = parseArgs(["--lat", "25.033964", "--lng", "121.564468", "q"]);
	assert.equal(split.latitude, 25.033964);
	assert.equal(split.longitude, 121.564468);
	const joined = parseArgs(["--lat=-33.8688", "--lng=151.2093", "q"]);
	assert.equal(joined.latitude, -33.8688);
	assert.equal(joined.longitude, 151.2093);
});

test("a non-numeric or out-of-range coordinate is rejected instead of reaching the API", () => {
	assert.throws(() => parseArgs(["q", "--lat", "abc"]), /--lat/);
	assert.throws(() => parseArgs(["q", "--lat", "91"]), /--lat/);
	assert.throws(() => parseArgs(["q", "--lng", "181"]), /--lng/);
});

test("a coordinate given on its own is rejected, since the API needs the pair", () => {
	assert.throws(() => parseArgs(["q", "--lat", "25.03"]), /--lng/);
	assert.throws(() => parseArgs(["q", "--lng", "121.56"]), /--lat/);
});

test("usage advertises Gemini 3.8 Flash as the default model", () => {
	assert.match(usage(), /Default model: gemini-3\.8-flash/);
	assert.match(usage(), /GEMINI_API_KEY/);
});

test("buildPrompt carries the query and purpose", () => {
	const p = buildPrompt("best ramen", "dinner plan");
	assert.ok(p.includes("best ramen"));
	assert.ok(p.includes("dinner plan"));
	assert.ok(/google_maps/.test(p));
});

test("buildRequestBody enables google_maps grounding and carries the prompt", () => {
	const body = buildRequestBody({ model: "gemini-3.8-flash", query: "best ramen", purpose: "dinner plan" });
	assert.equal(body.model, "gemini-3.8-flash");
	assert.deepEqual(body.tools, [{ type: "google_maps" }]);
	assert.ok(body.input.includes("best ramen"));
	assert.ok(body.input.includes("dinner plan"));
	assert.deepEqual(body.generation_config, { thinking_level: "medium" });
});

test("buildRequestBody attaches coordinates to the google_maps tool when given", () => {
	const body = buildRequestBody({
		model: "gemini-3.8-flash",
		query: "coffee",
		purpose: "break",
		latitude: 25.033964,
		longitude: 121.564468,
	});
	assert.deepEqual(body.tools, [{ type: "google_maps", latitude: 25.033964, longitude: 121.564468 }]);
});

test("extractPlaces dedupes a real interaction by place_id and strips the Google Maps suffix", () => {
	const places = extractPlaces(sample);
	assert.deepEqual(
		places.map((p) => p.name),
		["Fake Sober Taipei", "Fika Fika Cafe A13"],
	);
	for (const place of places) {
		assert.ok(place.url.startsWith("https://"));
		assert.ok(typeof place.placeId === "string" && place.placeId.length > 0);
	}
});

test("extractPlaces drops review citations, which point at a review rather than the place", () => {
	const places = extractPlaces({
		steps: [
			{
				type: "model_output",
				content: [
					{
						type: "text",
						text: "x",
						annotations: [
							{
								type: "place_citation",
								place_id: "PLACE_A",
								name: "Review of Simple Kaffa - Google Maps",
								url: "https://www.google.com/maps/reviews/data=abc",
							},
							{
								type: "place_citation",
								place_id: "PLACE_A",
								name: "Simple Kaffa - Google Maps",
								url: "https://maps.google.com/maps?cid=1",
							},
						],
					},
				],
			},
		],
	});
	assert.equal(places.length, 1);
	assert.equal(places[0].name, "Simple Kaffa");
	assert.equal(places[0].url, "https://maps.google.com/maps?cid=1");
});

test("extractPlaces keeps a place whose only citation is a review, so nothing is silently lost", () => {
	const places = extractPlaces({
		steps: [
			{
				type: "model_output",
				content: [
					{
						type: "text",
						text: "x",
						annotations: [
							{
								type: "place_citation",
								place_id: "PLACE_B",
								name: "Review of Lonely Diner - Google Maps",
								url: "https://www.google.com/maps/reviews/data=xyz",
							},
						],
					},
				],
			},
		],
	});
	assert.deepEqual(places, [
		{ placeId: "PLACE_B", name: "Lonely Diner", url: "https://www.google.com/maps/reviews/data=xyz" },
	]);
});

test("extractPlaces ignores url_citation annotations, which are not places", () => {
	const places = extractPlaces({
		steps: [
			{
				type: "model_output",
				content: [{ type: "text", text: "x", annotations: [{ type: "url_citation", url: "https://a.example" }] }],
			},
		],
	});
	assert.deepEqual(places, []);
});
