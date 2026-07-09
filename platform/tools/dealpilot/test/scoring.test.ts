import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreThesisFit } from "../src/scoring.js";
import type { ThesisProfile } from "../src/types.js";

const thesis: ThesisProfile = { industries: ["HVAC"], geo: ["Texas"], sdeMin: 300000, sdeMax: 800000 };

test("scoreThesisFit: full match on industry/geo/sde => green", () => {
  const result = scoreThesisFit({ industry: "HVAC", geo: "Texas", sde: 500000 }, thesis);
  assert.equal(result.triage, "green");
  assert.equal(result.score, 1);
});

test("scoreThesisFit: industry match but sde out of range => not green", () => {
  const result = scoreThesisFit({ industry: "HVAC", geo: "Texas", sde: 50000 }, thesis);
  assert.notEqual(result.triage, "green");
  assert.ok(result.reasons.some((r) => r.includes("outside thesis range")));
});

test("scoreThesisFit: no matches at all => red", () => {
  const result = scoreThesisFit({ industry: "Software", geo: "California", sde: 50000 }, thesis);
  assert.equal(result.triage, "red");
});

test("scoreThesisFit: missing fields don't crash, just aren't counted as matches", () => {
  const result = scoreThesisFit({}, thesis);
  assert.equal(result.score, 0);
  assert.equal(result.triage, "red");
});
