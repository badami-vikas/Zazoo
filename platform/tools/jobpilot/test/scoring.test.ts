import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreJobFit } from "../src/scoring.js";
import type { CandidateProfile } from "../src/types.js";

const candidate: CandidateProfile = { categories: ["data engineer"], skills: ["sql", "python"], locations: ["remote"], minSalary: 120000 };

test("scoreJobFit: category + remote + salary all match => green", () => {
  const result = scoreJobFit({ title: "Senior Data Engineer", isRemote: true, salaryMax: 160000 }, candidate);
  assert.equal(result.flag, "green");
  assert.equal(result.score, 1);
  assert.ok(result.greenFlags.length > 0);
});

test("scoreJobFit: category matches but salary below floor => not green", () => {
  const result = scoreJobFit({ title: "Data Engineer", isRemote: true, salaryMax: 90000 }, candidate);
  assert.notEqual(result.flag, "green");
  assert.ok(result.redFlags.some((r) => r.includes("below floor")));
});

test("scoreJobFit: no matches at all => red", () => {
  const result = scoreJobFit({ title: "Marketing Manager", location: "Paris", salaryMax: 50000 }, candidate);
  assert.equal(result.flag, "red");
});

test("scoreJobFit: missing fields don't crash, just aren't counted as matches", () => {
  const result = scoreJobFit({}, { categories: ["data engineer"], skills: [] });
  assert.equal(result.score, 0);
  assert.equal(result.flag, "red");
});
