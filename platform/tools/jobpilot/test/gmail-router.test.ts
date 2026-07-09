import { test } from "node:test";
import assert from "node:assert/strict";
import { routeEmail } from "../src/gmail-router.js";
import type { ApplicationRef, Classification } from "../src/gmail-router.js";

const applications: ApplicationRef[] = [
  { id: "app_1", company: "Acme", title: "Data Engineer", stage: "submitted" },
  { id: "app_2", company: "Globex", title: "Platform Engineer", stage: "applying" },
];

function classifierReturning(result: Classification) {
  return () => result;
}

test("routeEmail: high confidence + legal transition => auto_linked", () => {
  const result = routeEmail({ subject: "Interview!", body: "..." }, applications, classifierReturning({ bestMatchIndex: 1, confidence: 97, stageTarget: "confirmed" }));
  assert.equal(result.disposition, "auto_linked");
  assert.equal(result.applicationId, "app_1");
  assert.equal(result.stageTarget, "confirmed");
});

test("routeEmail: mid confidence => review pile, not auto-advanced", () => {
  const result = routeEmail({ subject: "re: application", body: "..." }, applications, classifierReturning({ bestMatchIndex: 2, confidence: 70, stageTarget: "submitted" }));
  assert.equal(result.disposition, "review");
  assert.equal(result.applicationId, "app_2");
});

test("routeEmail: low confidence => orphan", () => {
  const result = routeEmail({ subject: "newsletter", body: "..." }, applications, classifierReturning({ bestMatchIndex: 1, confidence: 20, stageTarget: "submitted" }));
  assert.equal(result.disposition, "orphan");
  assert.equal(result.applicationId, null);
});

test("routeEmail: no active applications => orphan without calling the classifier", () => {
  let called = false;
  const result = routeEmail({ subject: "x", body: "y" }, [], () => {
    called = true;
    return { bestMatchIndex: 1, confidence: 100, stageTarget: "confirmed" };
  });
  assert.equal(result.disposition, "orphan");
  assert.equal(called, false);
});

test("routeEmail: high confidence but ILLEGAL stage transition downgrades to review, never applied blindly", () => {
  // app_1 is "submitted"; jumping straight to "queued" is not a legal transition.
  const result = routeEmail({ subject: "x", body: "y" }, applications, classifierReturning({ bestMatchIndex: 1, confidence: 99, stageTarget: "queued" }));
  assert.equal(result.disposition, "review");
  assert.equal(result.applicationId, "app_1");
});
