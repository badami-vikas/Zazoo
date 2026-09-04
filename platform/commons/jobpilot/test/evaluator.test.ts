import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateTailoredMaterials } from "../src/evaluator.js";

const master = "Led backend team at Acme Inc as Senior Engineer, 2019-2023. Skills: Python, SQL, Kubernetes.";

test("evaluateTailoredMaterials: all changes cite real evidence => approved", () => {
  const verdict = evaluateTailoredMaterials(master, [
    { field: "summary", action: "rewrite", evidence: "Led backend team at Acme Inc" },
    { field: "skills", action: "add", evidence: "Python, SQL" },
  ]);
  assert.equal(verdict.approved, true);
  assert.deepEqual(verdict.blockingIssues, []);
});

test("evaluateTailoredMaterials: jd_added on a non-protected field is allowed evidence-free", () => {
  const verdict = evaluateTailoredMaterials(master, [{ field: "skills", action: "add", tag: "jd_added" }]);
  assert.equal(verdict.approved, true);
});

test("evaluateTailoredMaterials: jd_added on a protected field is blocked even without other issues", () => {
  const verdict = evaluateTailoredMaterials(master, [{ field: "employer", action: "add", tag: "jd_added" }]);
  assert.equal(verdict.approved, false);
  assert.ok(verdict.blockingIssues.some((i) => i.includes("employer")));
});

test("evaluateTailoredMaterials: fabricated employer with no evidence in master => rejected", () => {
  const verdict = evaluateTailoredMaterials(master, [{ field: "employer", action: "add", evidence: "Google" }]);
  assert.equal(verdict.approved, false);
  assert.ok(verdict.blockingIssues.some((i) => i.includes("employer")));
});
