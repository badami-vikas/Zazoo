/**
 * The persisted envelope.
 *
 * The posture under test is the one `readSyncState` established: anything
 * unrecognised yields EMPTY rather than partially-trusted state, and a rule
 * whose stored `enabled` flag is missing or garbled comes back OFF. A rule that
 * resurrects itself as enabled after a bad write is the wrong failure direction
 * for something that starts Agent Runs.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  WHATSAPP_AUTOMATION_NAMESPACE,
  assignmentLedgerOf,
  emptyAutomationState,
  readAutomationState,
  ruleLedgerOf,
  scheduleLedgerOf,
  withLedgers,
} from "../src/automation-state.js";
import { addRule, draftAutomationRule, limitsForRule } from "../src/automation.js";
import { EMPTY_ASSIGNMENT_LEDGER, assignAgent } from "../src/assignment.js";
import { EMPTY_SCHEDULE_LEDGER, queueAction } from "../src/schedule.js";
import { SEND_POLICY_LIMITS } from "../src/policy.js";

const NOW = "2026-08-02T12:00:00.000Z";
const CHAT = { kind: "chat", key: "919876543210@c.us" } as const;

test("the namespace is Local Plane and module-scoped", () => {
  assert.equal(WHATSAPP_AUTOMATION_NAMESPACE, "whatsapp:automation");
});

test("nothing, junk, and a wrong version all read as empty ledgers", () => {
  for (const value of [null, undefined, 7, "state", [], {}, { version: 2, rules: [] }]) {
    assert.deepEqual(readAutomationState(value), emptyAutomationState());
  }
});

test("a full round trip preserves all three ledgers", () => {
  const rules = addRule(
    { rules: [] },
    draftAutomationRule({
      id: "r1",
      name: "Pricing",
      subject: CHAT,
      trigger: { kind: "inbound_message", bodyContains: "price" },
      goal: "Draft a reply",
      createdBy: "Vikas",
      now: NOW,
      limitOverrides: { dailyCap: 3 },
    }),
  );
  const assignments = assignAgent(EMPTY_ASSIGNMENT_LEDGER, {
    id: "a1",
    subject: CHAT,
    agentId: "conversation-steward",
    assignedBy: "Vikas",
    assignedAt: NOW,
    allowedAgentIds: ["conversation-steward"],
    note: "She replies fast",
  }).ledger;
  const schedule = queueAction(EMPTY_SCHEDULE_LEDGER, {
    id: "s1",
    ruleId: "r1",
    agentId: "conversation-steward",
    subject: CHAT,
    goal: "Draft a reply",
    now: NOW,
    scheduledFor: "2026-08-03T09:00:00.000Z",
    reason: { code: "policy_deferral", policyRule: "business_hours", explanation: "Night there." },
  }).ledger;

  const state = withLedgers(emptyAutomationState(), { rules, assignments, schedule });
  // JSON round trip: this is what a `LocalStateStore` column actually does.
  const reloaded = readAutomationState(JSON.parse(JSON.stringify(state)));

  assert.deepEqual(reloaded, state);
  assert.equal(ruleLedgerOf(reloaded).rules[0]?.name, "Pricing");
  assert.equal(assignmentLedgerOf(reloaded).assignments[0]?.note, "She replies fast");
  assert.equal(scheduleLedgerOf(reloaded).actions[0]?.reason.policyRule, "business_hours");
  // Overrides survive, and still only tighten.
  assert.equal(limitsForRule(ruleLedgerOf(reloaded).rules[0]!).dailyCap, 3);
});

test("a rule with a missing or garbled enabled flag comes back OFF", () => {
  const stored = {
    version: 1,
    rules: [
      {
        id: "r1",
        name: "Pricing",
        subject: CHAT,
        trigger: { kind: "inbound_message" },
        goal: "Draft a reply",
        createdBy: "Vikas",
        createdAt: NOW,
        // enabled deliberately absent
      },
      {
        id: "r2",
        name: "Nudge",
        subject: CHAT,
        trigger: { kind: "thread_quiet", quietDays: 14 },
        goal: "Check in",
        createdBy: "Vikas",
        createdAt: NOW,
        enabled: "yes",
      },
    ],
    assignments: [],
    scheduled: [],
  };
  const state = readAutomationState(stored);
  assert.equal(state.rules.length, 2);
  assert.equal(state.rules.every((rule) => rule.enabled === false), true);
});

test("an unparseable row is dropped, never reconstructed from guesses", () => {
  const state = readAutomationState({
    version: 1,
    rules: [
      { id: "r1" }, // no name, goal, subject or trigger
      { id: "r2", name: "n", goal: "g", createdBy: "Vikas", createdAt: NOW, subject: CHAT, trigger: { kind: "thread_quiet", quietDays: 0 } },
      "not an object",
    ],
    assignments: [{ id: "a1", agentId: "x" }],
    scheduled: [{ id: "s1", status: "flying" }],
  });
  assert.deepEqual(state, emptyAutomationState());
});

test("tampered limit overrides survive only as numbers, and still cannot widen", () => {
  const state = readAutomationState({
    version: 1,
    rules: [
      {
        id: "r1",
        name: "n",
        goal: "g",
        createdBy: "Vikas",
        createdAt: NOW,
        enabled: true,
        subject: CHAT,
        trigger: { kind: "inbound_message" },
        limitOverrides: { dailyCap: 9_999, businessHourEnd: "24", nonsense: { a: 1 } },
      },
    ],
    assignments: [],
    scheduled: [],
  });
  const limits = limitsForRule(state.rules[0]!);
  assert.equal(limits.dailyCap, SEND_POLICY_LIMITS.dailyCap);
  assert.equal(limits.businessHourEnd, SEND_POLICY_LIMITS.businessHourEnd);
});

test("withLedgers leaves untouched ledgers exactly as they were", () => {
  const base = withLedgers(emptyAutomationState(), {
    assignments: assignAgent(EMPTY_ASSIGNMENT_LEDGER, {
      id: "a1",
      subject: CHAT,
      agentId: "conversation-steward",
      assignedBy: "Vikas",
      assignedAt: NOW,
      allowedAgentIds: ["conversation-steward"],
    }).ledger,
  });
  const next = withLedgers(base, { rules: { rules: [] } });
  assert.deepEqual(next.assignments, base.assignments);
});
