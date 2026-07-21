import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnswerBank, normalizeQuestion } from "../src/answer-bank.js";
import { resolveEntryTier, mapAnswersToForm, nextDispatchAction, assertApprovedForSubmit } from "../src/apply.js";
import type { FormField } from "../src/apply.js";

test("resolveEntryTier: big-3 ATSs enter at Tier 1, everything else enters at Tier 2", () => {
  assert.equal(resolveEntryTier("greenhouse"), 1);
  assert.equal(resolveEntryTier("Lever"), 1);
  assert.equal(resolveEntryTier("ashby"), 1);
  assert.equal(resolveEntryTier("workday"), 2);
  assert.equal(resolveEntryTier("icims"), 2);
});

test("mapAnswersToForm: resolved fields populate the payload; unresolved required fields are collected, not thrown", () => {
  const bank = createAnswerBank([{ questionNorm: normalizeQuestion("Are you authorized to work in the US"), questionRaw: "Are you authorized to work in the US?", answer: "Yes", source: "config" }]);
  const fields: FormField[] = [
    { id: "work_auth", label: "Are you authorized to work in the US?", required: true },
    { id: "why_us", label: "Why do you want to work here?", required: false },
    { id: "salary", label: "What is your expected salary?", required: true },
  ];

  const result = mapAnswersToForm(fields, bank);

  assert.equal(result.payload.work_auth, "Yes");
  assert.equal("why_us" in result.payload, false);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0]?.id, "salary");
});

test("nextDispatchAction: APPLIED submits, EXPIRED stops permanently", () => {
  assert.deepEqual(nextDispatchAction(1, "APPLIED"), { kind: "submitted" });
  assert.deepEqual(nextDispatchAction(1, "EXPIRED"), { kind: "stopped", reason: "expired" });
});

test("nextDispatchAction: CAPTCHA/LOGIN_ISSUE always park immediately, never escalate to the next tier", () => {
  assert.deepEqual(nextDispatchAction(1, "CAPTCHA"), { kind: "parked", reason: "captcha" });
  assert.deepEqual(nextDispatchAction(2, "LOGIN_ISSUE"), { kind: "parked", reason: "login_issue" });
});

test("nextDispatchAction: FAILED escalates tier by tier, parks (exhausted) once Tier 4 itself fails", () => {
  assert.deepEqual(nextDispatchAction(1, "FAILED"), { kind: "escalate", nextTier: 2 });
  assert.deepEqual(nextDispatchAction(2, "FAILED"), { kind: "escalate", nextTier: 3 });
  assert.deepEqual(nextDispatchAction(3, "FAILED"), { kind: "escalate", nextTier: 4 });
  assert.deepEqual(nextDispatchAction(4, "FAILED"), { kind: "parked", reason: "exhausted" });
});

test("assertApprovedForSubmit: throws on an unapproved eval verdict, no-ops on an approved one", () => {
  assert.throws(() => assertApprovedForSubmit({ approved: false, blockingIssues: ["fabricated employer"] }));
  assert.doesNotThrow(() => assertApprovedForSubmit({ approved: true, blockingIssues: [] }));
});
