/**
 * The scheduled-action queue.
 *
 * `a_refusal_never_becomes_a_scheduled_retry` is the one that matters: a
 * scheduler that queues refusals is a scheduler that eventually retries its way
 * into the consent gate. Deferrals wait; refusals do not become rows.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  EMPTY_SCHEDULE_LEDGER,
  ScheduleError,
  cancelAction,
  cancelActionsForRule,
  dueActions,
  explainSchedule,
  findAction,
  markStarted,
  queueAction,
  queuedActions,
  scheduleFromPolicy,
  type ScheduleLedger,
} from "../src/schedule.js";
import { SEND_POLICY_LIMITS, type SendPolicyDecision } from "../src/policy.js";
import type { AssignmentSubject } from "../src/assignment.js";

const NOW = "2026-08-02T12:00:00.000Z";
const CHAT: AssignmentSubject = { kind: "chat", key: "919876543210@c.us" };

const BASE = {
  agentId: "conversation-steward",
  subject: CHAT,
  goal: "Draft a reply about pricing",
  now: NOW,
  ruleId: "r1",
};

function queue(ledger: ScheduleLedger, id: string, scheduledFor: string): ScheduleLedger {
  return queueAction(ledger, {
    ...BASE,
    id,
    scheduledFor,
    reason: { code: "pacing", explanation: `Paced to ${scheduledFor}.` },
  }).ledger;
}

// ── Queueing ─────────────────────────────────────────────────────────────────

test("an empty queue is empty — there is no sample row", () => {
  assert.deepEqual(queuedActions(EMPTY_SCHEDULE_LEDGER), []);
  assert.deepEqual(dueActions(EMPTY_SCHEDULE_LEDGER, NOW), []);
});

test("a queued action names the Agent that will run and carries no message body", () => {
  const { action } = queueAction(EMPTY_SCHEDULE_LEDGER, {
    ...BASE,
    id: "s1",
    scheduledFor: "2026-08-02T13:00:00.000Z",
    reason: { code: "pacing", explanation: "Paced." },
  });
  assert.equal(action.agentId, "conversation-steward");
  assert.equal(action.status, "queued");
  assert.equal("body" in action, false, "the queue holds Agent Runs, not messages");
});

test("a queued action needs an Agent, a valid time, and a unique id", () => {
  assert.throws(
    () =>
      queueAction(EMPTY_SCHEDULE_LEDGER, {
        ...BASE,
        id: "s1",
        agentId: "  ",
        scheduledFor: NOW,
        reason: { code: "pacing", explanation: "x" },
      }),
    /names the Agent that will run/,
  );
  assert.throws(
    () =>
      queueAction(EMPTY_SCHEDULE_LEDGER, {
        ...BASE,
        id: "s1",
        scheduledFor: "not a date",
        reason: { code: "pacing", explanation: "x" },
      }),
    ScheduleError,
  );
  const one = queue(EMPTY_SCHEDULE_LEDGER, "s1", NOW);
  assert.throws(() => queue(one, "s1", NOW), /already exists/);
});

test("the queue is ordered soonest-first and only 'due' actions come back as due", () => {
  let ledger = queue(EMPTY_SCHEDULE_LEDGER, "later", "2026-08-05T09:00:00.000Z");
  ledger = queue(ledger, "soon", "2026-08-02T11:00:00.000Z");
  ledger = queue(ledger, "middle", "2026-08-03T09:00:00.000Z");

  assert.deepEqual(queuedActions(ledger).map((a) => a.id), ["soon", "middle", "later"]);
  assert.deepEqual(dueActions(ledger, NOW).map((a) => a.id), ["soon"]);
});

// ── From a policy decision ───────────────────────────────────────────────────

function fromPolicy(decision: SendPolicyDecision, ledger = EMPTY_SCHEDULE_LEDGER) {
  return scheduleFromPolicy(ledger, {
    ...BASE,
    id: "s1",
    decision,
    limits: SEND_POLICY_LIMITS,
    jitterDraw: 0,
  });
}

test("a_refusal_never_becomes_a_scheduled_retry", () => {
  for (const rule of ["consent_gate", "kill_switch", "near_identical_body", "unknown_recipient_time"] as const) {
    const outcome = fromPolicy({ status: "refused", rule, reason: `refused: ${rule}` });
    assert.equal(outcome.status, "refused", `${rule} was queued`);
    if (outcome.status !== "refused") return;
    assert.equal(outcome.rule, rule);
    // And crucially there is no ledger on a refusal to accidentally persist.
    assert.equal("ledger" in outcome, false);
  }
});

test("a deferral is queued at the earliest permitted time, and says which rule set it", () => {
  const outcome = fromPolicy({
    status: "deferred",
    rule: "business_hours",
    reason: "It is 22:00 for the recipient; automated sending runs 9:00–21:00 their time.",
    earliestAt: "2026-08-03T03:30:00.000Z",
  });
  assert.equal(outcome.status, "queued");
  if (outcome.status !== "queued") return;
  assert.equal(outcome.action.reason.code, "policy_deferral");
  assert.equal(outcome.action.reason.policyRule, "business_hours");
  assert.match(outcome.action.reason.explanation, /22:00 for the recipient/);
  // jitterDraw 0 → the minimum pacing delay, added ON TOP of the earliest time
  // so a whole queue does not fire in lockstep the moment a window opens.
  assert.equal(
    outcome.action.scheduledFor,
    new Date(Date.parse("2026-08-03T03:30:00.000Z") + SEND_POLICY_LIMITS.minJitterSeconds * 1000).toISOString(),
  );
});

test("even an allowed decision waits — nothing fires the instant it is triggered", () => {
  const outcome = fromPolicy({ status: "allowed", delaySeconds: 42 });
  assert.equal(outcome.status, "queued");
  if (outcome.status !== "queued") return;
  assert.equal(outcome.action.reason.code, "pacing");
  assert.ok(
    Date.parse(outcome.action.scheduledFor) > Date.parse(NOW),
    "an allowed action must still be paced",
  );
});

// ── Cancelling ───────────────────────────────────────────────────────────────

test("cancelling stamps rather than deletes, and records who", () => {
  const ledger = queue(EMPTY_SCHEDULE_LEDGER, "s1", "2026-08-05T09:00:00.000Z");
  const cancelled = cancelAction(ledger, "s1", "Vikas", NOW);

  assert.equal(cancelled.ledger.actions.length, 1);
  assert.deepEqual(queuedActions(cancelled.ledger), []);
  assert.equal(cancelled.action.status, "cancelled");
  assert.equal(cancelled.action.cancelledBy, "Vikas");
  assert.match(explainSchedule(cancelled.action), /Cancelled by Vikas/);
});

test("cancelling something unknown, already cancelled, or without a name is an error", () => {
  const ledger = queue(EMPTY_SCHEDULE_LEDGER, "s1", "2026-08-05T09:00:00.000Z");
  assert.throws(() => cancelAction(ledger, "nope", "Vikas", NOW), /No scheduled action/);
  assert.throws(() => cancelAction(ledger, "s1", " ", NOW), /records the person who did it/);
  const once = cancelAction(ledger, "s1", "Vikas", NOW).ledger;
  assert.throws(() => cancelAction(once, "s1", "Vikas", NOW), /already cancelled/);
});

test("deleting a rule can cancel every action it queued, and nothing else's", () => {
  let ledger = queue(EMPTY_SCHEDULE_LEDGER, "s1", "2026-08-05T09:00:00.000Z");
  ledger = queue(ledger, "s2", "2026-08-06T09:00:00.000Z");
  ledger = queueAction(ledger, {
    ...BASE,
    id: "other",
    ruleId: "r2",
    scheduledFor: "2026-08-07T09:00:00.000Z",
    reason: { code: "pacing", explanation: "x" },
  }).ledger;

  const swept = cancelActionsForRule(ledger, "r1", "Vikas", NOW);
  assert.equal(swept.cancelled, 2);
  assert.deepEqual(queuedActions(swept.ledger).map((a) => a.id), ["other"]);
});

// ── Starting ─────────────────────────────────────────────────────────────────

test("starting links the queue entry to the Agent Run it became", () => {
  const ledger = queue(EMPTY_SCHEDULE_LEDGER, "s1", "2026-08-02T11:00:00.000Z");
  const started = markStarted(ledger, "s1", NOW, "run-77");
  const action = findAction(started, "s1")!;
  assert.equal(action.status, "started");
  assert.equal(action.agentRunId, "run-77");
  assert.match(explainSchedule(action), /Agent Run run-77/);
  assert.throws(() => markStarted(started, "s1", NOW, "run-78"), /cannot start/);
  assert.throws(() => markStarted(ledger, "nope", NOW, "run-78"), /No scheduled action/);
});

// ── Explaining ───────────────────────────────────────────────────────────────

test("every queued row explains itself, with a concrete wait", () => {
  const ledger = queue(EMPTY_SCHEDULE_LEDGER, "s1", "2026-08-02T12:30:00.000Z");
  const soon = explainSchedule(findAction(ledger, "s1")!, NOW);
  assert.match(soon, /Due in 30 minutes\./);

  const hours = queue(EMPTY_SCHEDULE_LEDGER, "s2", "2026-08-02T20:00:00.000Z");
  assert.match(explainSchedule(findAction(hours, "s2")!, NOW), /Due in 8 hours\./);

  const days = queue(EMPTY_SCHEDULE_LEDGER, "s3", "2026-08-09T12:00:00.000Z");
  assert.match(explainSchedule(findAction(days, "s3")!, NOW), /Due in 7 days\./);

  const overdue = queue(EMPTY_SCHEDULE_LEDGER, "s4", "2026-08-01T12:00:00.000Z");
  assert.match(explainSchedule(findAction(overdue, "s4")!, NOW), /Due now\./);
});

test("the scheduler exports nothing that sends", async () => {
  // Structural, not behavioural: the scheduler proposes, and the policy plus
  // the Rust ceiling dispose. Nothing in this module's surface may be a send,
  // and nothing may be async — a pure ledger transform has nothing to await.
  const schedule = await import("../src/schedule.js");
  for (const [name, value] of Object.entries(schedule)) {
    assert.equal(/send|deliver|dispatch/i.test(name), false, `${name} looks like a send`);
    if (typeof value === "function") {
      assert.notEqual(value.constructor.name, "AsyncFunction", `${name} performs I/O`);
    }
  }
});
