import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreThesisFit } from "../src/scoring.js";
import type { ThesisProfile } from "../src/types.js";

const thesis: ThesisProfile = { industries: ["HVAC"], geo: ["Texas"], sdeMin: 300000, sdeMax: 800000 };

test("scoreThesisFit: full match produces the strong-fit domain band", () => {
  const result = scoreThesisFit({ industry: "HVAC", geo: "Texas", sde: 500000 }, thesis);
  assert.equal(result.band, "strong_fit");
  assert.equal(result.score, 1);
});

test("scoreThesisFit: industry match but SDE out of range is not strong fit", () => {
  const result = scoreThesisFit({ industry: "HVAC", geo: "Texas", sde: 50000 }, thesis);
  assert.notEqual(result.band, "strong_fit");
  assert.ok(result.reasons.some((r) => r.includes("outside thesis range")));
});

test("scoreThesisFit: no matches produce the weak-fit domain band", () => {
  const result = scoreThesisFit({ industry: "Software", geo: "California", sde: 50000 }, thesis);
  assert.equal(result.band, "weak_fit");
});

test("scoreThesisFit: missing fields don't crash, just aren't counted as matches", () => {
  const result = scoreThesisFit({}, thesis);
  assert.equal(result.score, 0);
  assert.equal(result.band, "weak_fit");
});
