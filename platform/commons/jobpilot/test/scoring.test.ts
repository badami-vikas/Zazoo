import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreJobFit } from "../src/scoring.js";
import { normalizeLegacyFitFlag } from "../src/types.js";
import type { CandidateProfile } from "../src/types.js";

const candidate: CandidateProfile = { categories: ["data engineer"], skills: ["sql", "python"], locations: ["remote"], minSalary: 120000 };

test("scoreJobFit: category + remote + salary all match => pursue", () => {
  const result = scoreJobFit({ title: "Senior Data Engineer", isRemote: true, salaryMax: 160000 }, candidate);
  assert.equal(result.flag, "pursue");
  assert.equal(result.score, 1);
  assert.ok(result.strengths.length > 0);
});

test("scoreJobFit: category matches but salary below floor => not pursue", () => {
  const result = scoreJobFit({ title: "Data Engineer", isRemote: true, salaryMax: 90000 }, candidate);
  assert.notEqual(result.flag, "pursue");
  assert.ok(result.concerns.some((r) => r.includes("below floor")));
});

test("scoreJobFit: no matches at all => pass", () => {
  const result = scoreJobFit({ title: "Marketing Manager", location: "Paris", salaryMax: 50000 }, candidate);
  assert.equal(result.flag, "pass");
});

test("scoreJobFit: missing fields don't crash, just aren't counted as matches", () => {
  const result = scoreJobFit({}, { categories: ["data engineer"], skills: [] });
  assert.equal(result.score, 0);
  assert.equal(result.flag, "pass");
});

test("normalizeLegacyFitFlag: passes new values through, maps legacy green/yellow/red, rejects everything else (review item 9 — pending migration bridge)", () => {
  assert.equal(normalizeLegacyFitFlag("pursue"), "pursue");
  assert.equal(normalizeLegacyFitFlag("review"), "review");
  assert.equal(normalizeLegacyFitFlag("pass"), "pass");
  assert.equal(normalizeLegacyFitFlag("green"), "pursue");
  assert.equal(normalizeLegacyFitFlag("yellow"), "review");
  assert.equal(normalizeLegacyFitFlag("red"), "pass");
  assert.equal(normalizeLegacyFitFlag(null), null);
  assert.equal(normalizeLegacyFitFlag(undefined), null);
  assert.equal(normalizeLegacyFitFlag("garbage"), null);
});
