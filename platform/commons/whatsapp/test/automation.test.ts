/**
 * Automation rules.
 *
 * The tests that matter most are the last three. A rules engine is exactly the
 * feature that grows a way around the consent gate, so this file pins the
 * three independent reasons a rule cannot:
 *
 *  1. `a_rule_cannot_start_a_run_into_a_thread_nobody_wrote_in` — the planner
 *     blocks on the same fact `evaluateSendPolicy` refuses on.
 *  2. `a_rule_cannot_widen_the_send_discipline` — `tightenLimits` takes the
 *     stricter of every field, so an override can only ever make it harsher.
 *  3. `even_a_forged_plan_is_refused_at_the_real_gate` — routing whatever a
 *     rule produced through the actual outbound path still refuses, because the
 *     gate does not consult rules at all.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  AutomationRuleError,
  EMPTY_RULE_LEDGER,
  addRule,
  deleteRule,
  describeRule,
  draftAutomationRule,
  findRule,
  limitsForRule,
  planAutomationRun,
  rulesForSubject,
  setRuleEnabled,
  tightenLimits,
  type AutomationContext,
  type AutomationRule,
} from "../src/automation.js";
import { assignAgent, EMPTY_ASSIGNMENT_LEDGER, type AssignmentSubject } from "../src/assignment.js";
import { SEND_POLICY_LIMITS, type SendPolicyContext, type ThreadActivity } from "../src/policy.js";
import { performAutomatedSend, type SendPort } from "../src/outbound.js";
import type { RecipientApproval, SendRequest } from "../src/send.js";

const NOW = "2026-08-02T12:00:00.000Z";
const CHAT: AssignmentSubject = { kind: "chat", key: "919876543210@c.us" };
const AGENTS = ["contact-steward", "conversation-steward"];

const CONSENTED: ThreadActivity = {
  inboundCount: 4,
  outboundCount: 2,
  firstInboundAt: "2026-07-01T09:00:00.000Z",
  lastInboundAt: "2026-07-20T09:00:00.000Z",
  firstOutboundAt: "2026-07-02T09:00:00.000Z",
  lastOutboundAt: "2026-07-02T09:00:00.000Z",
};

/** A thread the recipient has never written in. The first-contact case. */
const NEVER_WROTE: ThreadActivity = { inboundCount: 0, outboundCount: 3 };

const ASSIGNED = assignAgent(EMPTY_ASSIGNMENT_LEDGER, {
  id: "a1",
  subject: CHAT,
  agentId: "conversation-steward",
  assignedBy: "Vikas",
  assignedAt: "2026-07-01T00:00:00.000Z",
  allowedAgentIds: AGENTS,
}).ledger;

function rule(overrides: Partial<AutomationRule> = {}): AutomationRule {
  return {
    ...draftAutomationRule({
      id: "r1",
      name: "Answer questions about pricing",
      subject: CHAT,
      trigger: { kind: "inbound_message", bodyContains: "price" },
      goal: "Draft a reply about our pricing and hold it for approval",
      createdBy: "Vikas",
      now: "2026-07-15T00:00:00.000Z",
    }),
    ...overrides,
  };
}

/**
 * `inboundBody: undefined` is spelled out in the type because "no message
 * arrived" is a case these tests exercise deliberately, and the package builds
 * with `exactOptionalPropertyTypes`.
 */
type ContextOverrides = Partial<Omit<AutomationContext, "inboundBody">> & {
  inboundBody?: string | undefined;
};

function context(overrides: ContextOverrides = {}): AutomationContext {
  const merged = {
    now: NOW,
    assignments: ASSIGNED,
    thread: CONSENTED,
    inboundBody: "what is your price for the retainer?" as string | undefined,
    ...overrides,
  };
  const { inboundBody, ...rest } = merged;
  return { ...rest, ...(inboundBody !== undefined ? { inboundBody } : {}) };
}

// ── Authoring ────────────────────────────────────────────────────────────────

test("a rule needs a name, a goal, an author, and a subject", () => {
  const base = {
    id: "r1",
    subject: CHAT,
    trigger: { kind: "inbound_message" } as const,
    goal: "Do something useful",
    createdBy: "Vikas",
    now: NOW,
  };
  assert.throws(() => draftAutomationRule({ ...base, name: " " }), /Give the rule a name/);
  assert.throws(() => draftAutomationRule({ ...base, name: "n", goal: " " }), /needs a goal/);
  assert.throws(
    () => draftAutomationRule({ ...base, name: "n", createdBy: "" }),
    /records the person who created it/,
  );
  assert.throws(
    () => draftAutomationRule({ ...base, name: "n", subject: { kind: "chat", key: " " } }),
    /Choose the chat or Person/,
  );
});

test("a quiet-thread rule needs a quiet period of at least a day", () => {
  const base = {
    id: "r1",
    name: "Nudge",
    subject: CHAT,
    goal: "Check in",
    createdBy: "Vikas",
    now: NOW,
  };
  assert.throws(
    () => draftAutomationRule({ ...base, trigger: { kind: "thread_quiet", quietDays: 0 } }),
    AutomationRuleError,
  );
  assert.throws(
    () => draftAutomationRule({ ...base, trigger: { kind: "thread_quiet" } }),
    AutomationRuleError,
  );
  const ok = draftAutomationRule({
    ...base,
    trigger: { kind: "thread_quiet", quietDays: 14.7 },
  });
  assert.equal(ok.trigger.quietDays, 14);
});

test("an unknown trigger kind is refused rather than ignored", () => {
  assert.throws(
    () =>
      draftAutomationRule({
        id: "r1",
        name: "n",
        subject: CHAT,
        trigger: { kind: "on_import" } as never,
        goal: "g",
        createdBy: "Vikas",
        now: NOW,
      }),
    /is not a trigger this Module knows/,
  );
});

test("describeRule says what will happen, in the owner's own words", () => {
  assert.equal(
    describeRule(rule()),
    "when they message this chat mentioning “price”, start an Agent Run to: Draft a reply about our pricing and hold it for approval",
  );
});

// ── Lifecycle ────────────────────────────────────────────────────────────────

test("rules can be added, listed by subject, disabled with a reason, re-enabled, and deleted", () => {
  const added = addRule(EMPTY_RULE_LEDGER, rule());
  assert.equal(rulesForSubject(added, CHAT).length, 1);
  assert.equal(rulesForSubject(added, { kind: "person", key: "whatsapp:+1" }).length, 0);

  const off = setRuleEnabled(added, "r1", false, "Vikas", NOW, "Too chatty");
  assert.equal(findRule(off, "r1")?.enabled, false);
  assert.equal(findRule(off, "r1")?.disabledReason, "Too chatty");
  assert.equal(findRule(off, "r1")?.disabledBy, "Vikas");

  const on = setRuleEnabled(off, "r1", true, "Vikas", "2026-08-03T00:00:00.000Z");
  assert.equal(findRule(on, "r1")?.enabled, true);
  assert.equal(
    findRule(on, "r1")?.disabledReason,
    undefined,
    "a re-enabled rule must not keep a stale 'disabled because' on it",
  );

  const gone = deleteRule(on, "r1");
  assert.deepEqual(gone.rules, []);
});

test("duplicate ids, unknown ids, and unnamed actors are refused", () => {
  const added = addRule(EMPTY_RULE_LEDGER, rule());
  assert.throws(() => addRule(added, rule()), /already exists/);
  assert.throws(() => deleteRule(EMPTY_RULE_LEDGER, "r1"), /No rule with id/);
  assert.throws(() => setRuleEnabled(added, "nope", false, "Vikas", NOW), /No rule with id/);
  assert.throws(() => setRuleEnabled(added, "r1", false, "  ", NOW), /records who did it/);
});

// ── Triggers ─────────────────────────────────────────────────────────────────

test("an inbound trigger fires only when the text actually matches", () => {
  const matched = planAutomationRun(rule(), context());
  assert.equal(matched.status, "start_agent_run");

  const missed = planAutomationRun(rule(), context({ inboundBody: "hello there" }));
  assert.equal(missed.status, "not_due");

  const nothingArrived = planAutomationRun(rule(), context({ inboundBody: undefined }));
  assert.equal(nothingArrived.status, "not_due");
});

test("a quiet-thread trigger measures from the last message either way", () => {
  const quiet = rule({ trigger: { kind: "thread_quiet", quietDays: 7 } });
  // Last activity 2026-07-20, now 2026-08-02 → 13 days.
  const due = planAutomationRun(quiet, context({ inboundBody: undefined }));
  assert.equal(due.status, "start_agent_run");

  const notYet = planAutomationRun(
    rule({ trigger: { kind: "thread_quiet", quietDays: 30 } }),
    context({ inboundBody: undefined }),
  );
  assert.equal(notYet.status, "not_due");
  assert.match(notYet.status === "not_due" ? notYet.reason : "", /13 of the 30 quiet days/);
});

test("a matched run names the assigned Agent and carries a real explanation", () => {
  const plan = planAutomationRun(rule(), context());
  assert.equal(plan.status, "start_agent_run");
  if (plan.status !== "start_agent_run") return;
  assert.equal(plan.agentId, "conversation-steward");
  assert.equal(plan.assignment.assignedBy, "Vikas");
  assert.match(plan.because, /mentions “price”/);
  // A plan carries a goal and no body: a rule never writes the message.
  assert.equal("body" in plan, false);
});

// ── The blocks ───────────────────────────────────────────────────────────────

test("a disabled rule is blocked, and says since when", () => {
  const off = setRuleEnabled(addRule(EMPTY_RULE_LEDGER, rule()), "r1", false, "Vikas", NOW, "Noisy");
  const plan = planAutomationRun(findRule(off, "r1")!, context());
  assert.equal(plan.status, "blocked");
  assert.equal(plan.status === "blocked" ? plan.reason : "", "disabled");
  assert.match(plan.status === "blocked" ? plan.explanation : "", /Noisy/);
});

test("a rule with no assigned Agent is blocked — an Automation starts an Agent Run", () => {
  const plan = planAutomationRun(rule(), context({ assignments: EMPTY_ASSIGNMENT_LEDGER }));
  assert.equal(plan.status, "blocked");
  assert.equal(plan.status === "blocked" ? plan.reason : "", "no_agent_assigned");
});

test("a_rule_cannot_start_a_run_into_a_thread_nobody_wrote_in", () => {
  // Every trigger, every configuration, and an Agent that IS assigned. The only
  // thing missing is the recipient ever having written — and that alone stops it.
  const shapes: AutomationRule[] = [
    rule(),
    rule({ trigger: { kind: "inbound_message" } }),
    rule({ trigger: { kind: "thread_quiet", quietDays: 1 } }),
    // Including a rule that tries to buy its way past with limit overrides.
    rule({
      limitOverrides: { requireRecipientInitiated: false, dailyCap: 100_000 },
    }),
  ];
  for (const candidate of shapes) {
    const plan = planAutomationRun(
      candidate,
      context({ thread: NEVER_WROTE, inboundBody: "price please" }),
    );
    assert.equal(plan.status, "blocked", `${candidate.trigger.kind} was not blocked`);
    assert.equal(plan.status === "blocked" ? plan.reason : "", "consent_gate");
    assert.match(
      plan.status === "blocked" ? plan.explanation : "",
      /never opens a conversation/,
    );
  }
});

test("the consent gate is checked before the trigger, so an unfireable rule says so", () => {
  // The trigger does NOT match here (wrong body), but the answer must still be
  // "this can never fire", not "not due today".
  const plan = planAutomationRun(rule(), context({ thread: NEVER_WROTE, inboundBody: "hello" }));
  assert.equal(plan.status, "blocked");
  assert.equal(plan.status === "blocked" ? plan.reason : "", "consent_gate");
});

// ── Limits ───────────────────────────────────────────────────────────────────

test("a_rule_cannot_widen_the_send_discipline", () => {
  const greedy = limitsForRule(
    rule({
      limitOverrides: {
        dailyCap: 5_000,
        recipientCooldownDays: 0,
        similarityThreshold: 0.99,
        similarBodyRecipientLimit: 1_000,
        similarBodyWindowDays: 0,
        warmUpFirstDayCap: 500,
        warmUpDailyIncrement: 500,
        businessHourStart: 0,
        businessHourEnd: 24,
        minJitterSeconds: 0,
        maxJitterSeconds: 0,
        requireRecipientInitiated: false,
      },
    }),
  );
  // Every single field comes back as the shipped value. Nothing widened.
  assert.deepEqual(greedy, SEND_POLICY_LIMITS);
});

test("a rule CAN tighten, in every direction that means stricter", () => {
  const strict = limitsForRule(
    rule({
      limitOverrides: {
        dailyCap: 3,
        recipientCooldownDays: 30,
        similarityThreshold: 0.4,
        similarBodyRecipientLimit: 2,
        similarBodyWindowDays: 60,
        businessHourStart: 11,
        businessHourEnd: 17,
        minJitterSeconds: 120,
        maxJitterSeconds: 3_600,
        requireRecipientInitiated: true,
      },
    }),
  );
  assert.equal(strict.dailyCap, 3);
  assert.equal(strict.recipientCooldownDays, 30);
  assert.equal(strict.similarityThreshold, 0.4);
  assert.equal(strict.similarBodyRecipientLimit, 2);
  assert.equal(strict.similarBodyWindowDays, 60);
  assert.equal(strict.businessHourStart, 11);
  assert.equal(strict.businessHourEnd, 17);
  assert.equal(strict.minJitterSeconds, 120);
  assert.equal(strict.maxJitterSeconds, 3_600);
  assert.equal(strict.requireRecipientInitiated, true);
});

test("garbage and absent overrides fall back to the shipped limits", () => {
  assert.deepEqual(tightenLimits(SEND_POLICY_LIMITS, undefined), SEND_POLICY_LIMITS);
  assert.deepEqual(
    tightenLimits(SEND_POLICY_LIMITS, { dailyCap: Number.NaN, businessHourEnd: Infinity }),
    SEND_POLICY_LIMITS,
  );
});

// ── The real gate, independent of all of the above ───────────────────────────

test("even_a_forged_plan_is_refused_at_the_real_gate", async () => {
  // Suppose every defence above were bypassed and a rule produced a message for
  // a thread nobody has written in, with a fully approved recipient and the
  // widest limits it could ask for. The outbound path still refuses, because it
  // never consults a rule — it consults the thread.
  let portCalls = 0;
  const port: SendPort = async () => {
    portCalls += 1;
    return { status: "sent", messageId: "should-never-happen" };
  };

  const request: SendRequest = {
    targetKind: "person",
    targetId: "919876543210@c.us",
    recipientKey: "whatsapp:+919876543210",
    body: "Hi! Following up about pricing.",
  };
  const approvals: RecipientApproval[] = [
    { recipientKey: request.recipientKey, approvedBy: "Vikas", approvedAt: "2026-07-01T00:00:00.000Z" },
  ];
  const policyContext: SendPolicyContext = {
    now: NOW,
    account: { linkedAt: "2026-01-01T00:00:00.000Z", killSwitch: { status: "armed" } },
    thread: NEVER_WROTE,
    history: [],
    recipientUtcOffsetMinutes: 330,
    jitterDraw: 0.5,
    // The tightened limits a rule is allowed to supply. Even the widest a rule
    // could ever produce cannot turn the consent gate off.
    limits: limitsForRule(rule({ limitOverrides: { dailyCap: 100_000 } })),
  };

  const outcome = await performAutomatedSend(request, approvals, policyContext, port);
  assert.equal(outcome.status, "refused");
  assert.equal(outcome.status === "refused" ? outcome.code : "", "consent_gate");
  assert.equal(portCalls, 0, "nothing may reach the shell for a first contact");
});
