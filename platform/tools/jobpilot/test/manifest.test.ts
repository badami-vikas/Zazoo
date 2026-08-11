import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeEvidenceEvaluatorManifest } from "../src/index.js";

test("resume evidence evaluator exposes a private, reviewable capability", () => {
  assert.equal(resumeEvidenceEvaluatorManifest.kind, "skill");
  assert.equal(resumeEvidenceEvaluatorManifest.id, "resume-evidence-evaluator");
  assert.deepEqual(resumeEvidenceEvaluatorManifest.capabilities, [
    { resourceType: "resume", action: "read", dataScope: "private", egress: false },
  ]);
  assert.ok(resumeEvidenceEvaluatorManifest.provides.some((entry) => entry.id === "evaluate.resume"));
});
