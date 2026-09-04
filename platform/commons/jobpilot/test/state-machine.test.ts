import { test } from "node:test";
import assert from "node:assert/strict";
import { transition, InvalidTransitionError } from "../src/state-machine.js";

test("transition: queued -> tailoring is allowed and produces a stage event", () => {
  const event = transition("queued", "tailoring", "app_1", "system");
  assert.equal(event.from, "queued");
  assert.equal(event.to, "tailoring");
  assert.equal(event.applicationId, "app_1");
  assert.ok(event.at);
});

test("transition: evaluating can retry back to tailoring (writer/evaluator loop)", () => {
  const event = transition("evaluating", "tailoring", "app_1", "evaluator-agent", { reason: "blocking_issues" });
  assert.equal(event.to, "tailoring");
  assert.deepEqual(event.meta, { reason: "blocking_issues" });
});

test("transition: parked can resume back into applying", () => {
  const event = transition("parked", "applying", "app_1", "user");
  assert.equal(event.to, "applying");
});

test("transition: submitted -> confirmed via gmail_router actor", () => {
  const event = transition("submitted", "confirmed", "app_1", "gmail_router");
  assert.equal(event.actor, "gmail_router");
});

test("transition: an invalid jump (e.g. queued -> submitted) throws InvalidTransitionError", () => {
  assert.throws(() => transition("queued", "submitted", "app_1", "system"), InvalidTransitionError);
});

test("transition: terminal stages (confirmed, failed, expired, rejected_by_user) allow no further transitions", () => {
  for (const terminal of ["confirmed", "failed", "expired", "rejected_by_user"] as const) {
    assert.throws(() => transition(terminal, "queued", "app_1", "system"), InvalidTransitionError);
  }
});
