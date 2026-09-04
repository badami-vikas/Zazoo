/**
 * Send discipline (ADR-158). These are the rules that stand between the owner's
 * personal number and a permanent, unappealable ban, so the tests worth having
 * are the adversarial ones: a first contact must be refused, the cap must bind
 * exactly at its boundary, and the kill switch must never let go on its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SEND_POLICY_LIMITS,
  bodySimilarity,
  decideAutomatedSend,
  effectiveDailyCap,
  evaluateSendPolicy,
  haltAutomation,
  jitterSeconds,
  localHour,
  normalizeBody,
  rearmAutomation,
  type AutomatedSendRecord,
  type SendPolicyContext,
  type ThreadActivity,
} from "../src/policy.js";
import type { RecipientApproval, SendRequest } from "../src/send.js";

const RECIPIENT = "whatsapp:+919876543210";
const NOW = "2026-08-02T12:00:00.000Z"; // 12:00 UTC — inside hours at offset 0.
const LINKED_LONG_AGO = "2026-01-01T00:00:00.000Z";

/** A thread the recipient wrote in first. The consented baseline. */
const CONSENTED: ThreadActivity = {
  inboundCount: 3,
  outboundCount: 1,
  firstInboundAt: "2026-07-01T09:00:00.000Z",
  lastInboundAt: "2026-07-30T09:00:00.000Z",
  firstOutboundAt: "2026-07-02T09:00:00.000Z",
  lastOutboundAt: "2026-07-02T09:00:00.000Z",
};

function context(overrides: Partial<SendPolicyContext> = {}): SendPolicyContext {
  return {
    now: NOW,
    account: { linkedAt: LINKED_LONG_AGO, killSwitch: { status: "armed" } },
    thread: CONSENTED,
    history: [],
    recipientUtcOffsetMinutes: 0,
    jitterDraw: 0.5,
    ...overrides,
  };
}

function sends(count: number, options: Partial<AutomatedSendRecord> = {}): AutomatedSendRecord[] {
  return Array.from({ length: count }, (_unused, index) => ({
    recipientKey: `whatsapp:+1000000${String(index).padStart(4, "0")}`,
    // Spread through the last 12 hours, all inside the rolling window.
    sentAt: new Date(Date.parse(NOW) - (index + 1) * 60_000).toISOString(),
    body: `unique body number ${index} with entirely different wording ${"x".repeat(index)}`,
    ...options,
  }));
}

// ── Consent gate ─────────────────────────────────────────────────────────────

test("a first contact is REFUSED, not deferred and not prompted", async () => {
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "hello there",
    context({ thread: { inboundCount: 0, outboundCount: 0 } }),
  );
  assert.equal(decision.status, "refused");
  assert.equal(decision.status === "refused" && decision.rule, "consent_gate");
});

test("a thread where we wrote but they never replied is still a first contact", async () => {
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "following up",
    context({
      thread: {
        inboundCount: 0,
        outboundCount: 4,
        firstOutboundAt: "2026-07-01T09:00:00.000Z",
        lastOutboundAt: "2026-07-20T09:00:00.000Z",
      },
    }),
  );
  assert.equal(decision.status, "refused");
  assert.equal(decision.status === "refused" && decision.rule, "consent_gate");
});

test("an inbound count without a first-inbound timestamp is not trusted", async () => {
  // A caller that reports engagement it cannot date does not get to open a thread.
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "hi",
    context({ thread: { inboundCount: 5, outboundCount: 0 } }),
  );
  assert.equal(decision.status, "refused");
  assert.equal(decision.status === "refused" && decision.rule, "consent_gate");
});

test("a reply counts as consent, even in a thread we opened", async () => {
  const decision = evaluateSendPolicy(RECIPIENT, "thanks, noted", context());
  assert.equal(decision.status, "allowed");
});

test("requireRecipientInitiated tightens consent to the literal reading", async () => {
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "thanks, noted",
    context({
      thread: {
        ...CONSENTED,
        firstOutboundAt: "2026-06-01T09:00:00.000Z", // before their first inbound
      },
      limits: { requireRecipientInitiated: true },
    }),
  );
  assert.equal(decision.status, "refused");
  assert.equal(decision.status === "refused" && decision.rule, "consent_gate");
});

test("the consent gate refuses BEFORE any approval is requested", async () => {
  const request: SendRequest = {
    targetKind: "person",
    targetId: "919876543210@c.us",
    recipientKey: RECIPIENT,
    body: "cold outreach",
  };
  // No approvals at all — decideSend alone would say "needs_approval".
  const decision = decideAutomatedSend(
    request,
    [],
    context({ thread: { inboundCount: 0, outboundCount: 0 } }),
  );
  assert.equal(decision.status, "refused");
  assert.notEqual(decision.status, "needs_approval");
});

// ── Daily cap ────────────────────────────────────────────────────────────────

test("the cap binds exactly at its boundary", async () => {
  const cap = SEND_POLICY_LIMITS.dailyCap;
  const under = evaluateSendPolicy(
    RECIPIENT,
    "one more",
    context({ history: sends(cap - 1) }),
  );
  assert.equal(under.status, "allowed", "cap - 1 sends must still allow one more");

  const at = evaluateSendPolicy(RECIPIENT, "one more", context({ history: sends(cap) }));
  assert.equal(at.status, "deferred", "the cap-th send must bind");
  assert.equal(at.status === "deferred" && at.rule, "daily_cap");
});

test("the cap is a ROLLING window — messages older than 24h do not count", async () => {
  const stale = sends(SEND_POLICY_LIMITS.dailyCap).map((record, index) => ({
    ...record,
    sentAt: new Date(Date.parse(NOW) - 25 * 3_600_000 - index * 60_000).toISOString(),
  }));
  const decision = evaluateSendPolicy(RECIPIENT, "one more", context({ history: stale }));
  assert.equal(decision.status, "allowed");
});

test("a capped send is deferred to when the window frees a slot, not to midnight", async () => {
  const history = sends(SEND_POLICY_LIMITS.dailyCap);
  const decision = evaluateSendPolicy(RECIPIENT, "one more", context({ history }));
  assert.equal(decision.status, "deferred");
  if (decision.status !== "deferred") return;
  const oldest = Math.min(...history.map((r) => Date.parse(r.sentAt)));
  assert.equal(Date.parse(decision.earliestAt), oldest + 86_400_000);
});

test("the cap cannot be raised past the shipped ceiling by a caller", async () => {
  // A caller may tighten the cap; the ceiling that a Rust enforcer mirrors is
  // the warm-up-clamped SEND_POLICY_LIMITS.dailyCap.
  assert.ok(SEND_POLICY_LIMITS.dailyCap >= 30 && SEND_POLICY_LIMITS.dailyCap <= 50);
  const tightened = evaluateSendPolicy(
    RECIPIENT,
    "one more",
    context({ history: sends(3), limits: { dailyCap: 3 } }),
  );
  assert.equal(tightened.status, "deferred");
});

// ── Warm-up ──────────────────────────────────────────────────────────────────

test("a newly linked account ramps rather than starting at full rate", async () => {
  const day0 = effectiveDailyCap(NOW, NOW, SEND_POLICY_LIMITS);
  assert.equal(day0, SEND_POLICY_LIMITS.warmUpFirstDayCap);
  const day1 = effectiveDailyCap(
    NOW,
    new Date(Date.parse(NOW) - 86_400_000).toISOString(),
    SEND_POLICY_LIMITS,
  );
  assert.equal(
    day1,
    SEND_POLICY_LIMITS.warmUpFirstDayCap + SEND_POLICY_LIMITS.warmUpDailyIncrement,
  );
  // And it never exceeds the steady-state cap.
  assert.equal(
    effectiveDailyCap(NOW, LINKED_LONG_AGO, SEND_POLICY_LIMITS),
    SEND_POLICY_LIMITS.dailyCap,
  );
});

test("the warm-up cap binds on a fresh account", async () => {
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "one more",
    context({
      account: { linkedAt: NOW, killSwitch: { status: "armed" } },
      history: sends(SEND_POLICY_LIMITS.warmUpFirstDayCap),
    }),
  );
  assert.equal(decision.status, "deferred");
  assert.equal(decision.status === "deferred" && decision.rule, "daily_cap");
});

test("an account linked in the future sends nothing", async () => {
  assert.equal(
    effectiveDailyCap(NOW, "2027-01-01T00:00:00.000Z", SEND_POLICY_LIMITS),
    0,
  );
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "hi",
    context({
      account: { linkedAt: "2027-01-01T00:00:00.000Z", killSwitch: { status: "armed" } },
    }),
  );
  assert.equal(decision.status, "deferred");
  assert.equal(decision.status === "deferred" && decision.rule, "daily_cap");
});

// ── Per-recipient cooldown ───────────────────────────────────────────────────

test("a recipient messaged inside the cooldown is deferred", async () => {
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "checking in again",
    context({
      history: [
        {
          recipientKey: RECIPIENT,
          sentAt: new Date(Date.parse(NOW) - 2 * 86_400_000).toISOString(),
          body: "checking in",
        },
      ],
    }),
  );
  assert.equal(decision.status, "deferred");
  assert.equal(decision.status === "deferred" && decision.rule, "recipient_cooldown");
});

test("the cooldown releases exactly at its boundary", async () => {
  const days = SEND_POLICY_LIMITS.recipientCooldownDays;
  const justInside = evaluateSendPolicy(
    RECIPIENT,
    "hello again",
    context({
      history: [
        {
          recipientKey: RECIPIENT,
          sentAt: new Date(Date.parse(NOW) - days * 86_400_000 + 1000).toISOString(),
          body: "hello",
        },
      ],
    }),
  );
  assert.equal(justInside.status, "deferred");
  const justOutside = evaluateSendPolicy(
    RECIPIENT,
    "hello again",
    context({
      history: [
        {
          recipientKey: RECIPIENT,
          sentAt: new Date(Date.parse(NOW) - days * 86_400_000).toISOString(),
          body: "hello",
        },
      ],
    }),
  );
  assert.equal(justOutside.status, "allowed");
});

// ── Near-identical bodies ────────────────────────────────────────────────────

test("similarity sees through a swapped name and punctuation", async () => {
  const a = "Hi John, hope you're well! Quick question about the Q3 report.";
  const b = "Hi Mary, hope you're well. Quick question about the Q3 report!";
  assert.ok(
    bodySimilarity(a, b) >= SEND_POLICY_LIMITS.similarityThreshold,
    `mail-merge bodies scored ${bodySimilarity(a, b)}, below the threshold`,
  );
});

test("similarity does not flag genuinely different messages", async () => {
  const a = "Hi John, hope you're well! Quick question about the Q3 report.";
  const b = "Running twenty minutes late for the dentist, sorry about that.";
  assert.ok(bodySimilarity(a, b) < SEND_POLICY_LIMITS.similarityThreshold);
});

test("similarity is reflexive, symmetric and bounded", async () => {
  assert.equal(bodySimilarity("same text", "same text"), 1);
  assert.equal(bodySimilarity("", ""), 1);
  const a = "one message here";
  const b = "a different message";
  assert.equal(bodySimilarity(a, b), bodySimilarity(b, a));
  assert.ok(bodySimilarity(a, b) >= 0 && bodySimilarity(a, b) <= 1);
  assert.equal(normalizeBody("  Hi,   THERE!! "), "hi there");
});

test("bulk near-identical text is refused once it reaches the recipient limit", async () => {
  const template = "Hi NAME, hope you're well! Quick question about the Q3 report.";
  const blast = Array.from(
    { length: SEND_POLICY_LIMITS.similarBodyRecipientLimit },
    (_unused, index) => ({
      recipientKey: `whatsapp:+2000000${index}`,
      sentAt: new Date(Date.parse(NOW) - (index + 1) * 3_600_000).toISOString(),
      body: template.replace("NAME", `Person${index}`),
    }),
  );
  const decision = evaluateSendPolicy(
    RECIPIENT,
    template.replace("NAME", "Someone"),
    context({ history: blast }),
  );
  assert.equal(decision.status, "refused");
  assert.equal(decision.status === "refused" && decision.rule, "near_identical_body");

  // One fewer recipient is still allowed — the limit binds, it does not creep.
  const under = evaluateSendPolicy(
    RECIPIENT,
    template.replace("NAME", "Someone"),
    context({ history: blast.slice(0, -1) }),
  );
  assert.equal(under.status, "allowed");
});

test("re-sending the same text to the SAME recipient is not a bulk signature", async () => {
  const template = "Hi there, hope you're well! Quick question about the Q3 report.";
  const repeats = Array.from({ length: 10 }, (_unused, index) => ({
    recipientKey: RECIPIENT,
    sentAt: new Date(Date.parse(NOW) - (index + 20) * 86_400_000).toISOString(),
    body: template,
  }));
  const decision = evaluateSendPolicy(RECIPIENT, template, context({ history: repeats }));
  // Not the near-identical rule — the same person is not "more than a small
  // number of recipients". (Cooldown is clear: all repeats are 20+ days old.)
  assert.equal(decision.status, "allowed");
});

test("bulk text outside the lookback window no longer counts", async () => {
  const template = "Hi NAME, hope you're well! Quick question about the Q3 report.";
  const old = Array.from(
    { length: SEND_POLICY_LIMITS.similarBodyRecipientLimit + 3 },
    (_unused, index) => ({
      recipientKey: `whatsapp:+3000000${index}`,
      sentAt: new Date(
        Date.parse(NOW) - (SEND_POLICY_LIMITS.similarBodyWindowDays + 1) * 86_400_000,
      ).toISOString(),
      body: template.replace("NAME", `Person${index}`),
    }),
  );
  const decision = evaluateSendPolicy(
    RECIPIENT,
    template.replace("NAME", "Someone"),
    context({ history: old }),
  );
  assert.equal(decision.status, "allowed");
});

// ── Business hours ───────────────────────────────────────────────────────────

test("a night send is deferred to the next morning in the RECIPIENT's time", async () => {
  // 12:00 UTC is 02:00 for a recipient at +14:00 (offset 840).
  assert.equal(localHour(NOW, 840), 2);
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "hello",
    context({ recipientUtcOffsetMinutes: 840 }),
  );
  assert.equal(decision.status, "deferred");
  assert.equal(decision.status === "deferred" && decision.rule, "business_hours");
  if (decision.status !== "deferred") return;
  assert.equal(localHour(decision.earliestAt, 840), SEND_POLICY_LIMITS.businessHourStart);
  assert.ok(Date.parse(decision.earliestAt) > Date.parse(NOW));
});

test("a negative offset resolves correctly across the date line", async () => {
  // 12:00 UTC is 04:00 for a recipient at -08:00.
  assert.equal(localHour(NOW, -480), 4);
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "hello",
    context({ recipientUtcOffsetMinutes: -480 }),
  );
  assert.equal(decision.status, "deferred");
  if (decision.status !== "deferred") return;
  assert.equal(localHour(decision.earliestAt, -480), SEND_POLICY_LIMITS.businessHourStart);
});

test("an unknown recipient time is refused, not assumed to be daytime", async () => {
  const { recipientUtcOffsetMinutes: _unknown, ...withoutOffset } = context();
  const decision = evaluateSendPolicy(RECIPIENT, "hello", withoutOffset);
  assert.equal(decision.status, "refused");
  assert.equal(decision.status === "refused" && decision.rule, "unknown_recipient_time");
});

test("the window boundary is inclusive at the start and exclusive at the end", async () => {
  const start = SEND_POLICY_LIMITS.businessHourStart;
  const end = SEND_POLICY_LIMITS.businessHourEnd;
  const at = (hour: number): string =>
    `2026-08-02T${String(hour).padStart(2, "0")}:00:00.000Z`;
  assert.equal(evaluateSendPolicy(RECIPIENT, "x", context({ now: at(start) })).status, "allowed");
  assert.equal(evaluateSendPolicy(RECIPIENT, "x", context({ now: at(end) })).status, "deferred");
  assert.equal(
    evaluateSendPolicy(RECIPIENT, "x", context({ now: at(start - 1) })).status,
    "deferred",
  );
});

// ── Jitter ───────────────────────────────────────────────────────────────────

test("jitter stays inside the 30s–15min pacing window", async () => {
  assert.equal(jitterSeconds(0, SEND_POLICY_LIMITS), 30);
  assert.equal(jitterSeconds(0.999999, SEND_POLICY_LIMITS), 900);
  for (const draw of [-5, 0.25, 0.5, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
    const delay = jitterSeconds(draw, SEND_POLICY_LIMITS);
    assert.ok(delay >= 30 && delay <= 900, `draw ${draw} produced ${delay}s`);
  }
});

test("jitter is a pure function of its draw", async () => {
  const first = evaluateSendPolicy(RECIPIENT, "hello", context({ jitterDraw: 0.25 }));
  const second = evaluateSendPolicy(RECIPIENT, "hello", context({ jitterDraw: 0.25 }));
  assert.deepEqual(first, second);
  const other = evaluateSendPolicy(RECIPIENT, "hello", context({ jitterDraw: 0.75 }));
  assert.notDeepEqual(first, other);
});

// ── Kill switch ──────────────────────────────────────────────────────────────

test("a halted account refuses every send", async () => {
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "hello",
    context({
      account: {
        linkedAt: LINKED_LONG_AGO,
        killSwitch: {
          status: "halted",
          haltedAt: "2026-08-01T00:00:00.000Z",
          reason: "WhatsApp showed a spam warning",
        },
      },
    }),
  );
  assert.equal(decision.status, "refused");
  assert.equal(decision.status === "refused" && decision.rule, "kill_switch");
  assert.match(
    decision.status === "refused" ? decision.reason : "",
    /spam warning/,
  );
});

test("the kill switch NEVER auto-resumes, however much time passes", async () => {
  const halted = haltAutomation({ status: "armed" }, "unexpected disconnect", "2020-01-01T00:00:00.000Z");
  // Six years later, on an otherwise perfect send.
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "hello",
    context({ account: { linkedAt: LINKED_LONG_AGO, killSwitch: halted } }),
  );
  assert.equal(decision.status, "refused");
  assert.equal(decision.status === "refused" && decision.rule, "kill_switch");
});

test("halting twice keeps the FIRST reason", async () => {
  const first = haltAutomation({ status: "armed" }, "spam warning", "2026-08-01T00:00:00.000Z");
  const second = haltAutomation(first, "a later disconnect", "2026-08-02T00:00:00.000Z");
  assert.equal(second.reason, "spam warning");
  assert.equal(second.haltedAt, "2026-08-01T00:00:00.000Z");
});

test("re-arming requires a named human and restores sending", async () => {
  const halted = haltAutomation({ status: "armed" }, "spam warning", "2026-08-01T00:00:00.000Z");
  assert.throws(() => rearmAutomation(halted, "   ", NOW), /requires the human/);
  const rearmed = rearmAutomation(halted, "vikas", NOW);
  assert.equal(rearmed.status, "armed");
  assert.equal(rearmed.rearmedBy, "vikas");
  assert.equal(rearmed.rearmedAt, NOW);
  const decision = evaluateSendPolicy(
    RECIPIENT,
    "hello",
    context({ account: { linkedAt: LINKED_LONG_AGO, killSwitch: rearmed } }),
  );
  assert.equal(decision.status, "allowed");
});

test("halting an armed switch and re-arming an armed switch are idempotent", async () => {
  const armed = { status: "armed" as const };
  assert.equal(rearmAutomation(armed, "vikas", NOW), armed);
  const halted = haltAutomation(armed, "reason", NOW);
  assert.equal(halted.status, "halted");
});

// ── Composition with the approval gate ───────────────────────────────────────

const REQUEST: SendRequest = {
  targetKind: "person",
  targetId: "919876543210@c.us",
  recipientKey: RECIPIENT,
  body: "Following up on your question about the report.",
};

const APPROVED: RecipientApproval[] = [
  { recipientKey: RECIPIENT, approvedBy: "vikas", approvedAt: "2026-07-31T00:00:00.000Z" },
];

test("an approved, consented, in-hours send is allowed with a grant and a delay", async () => {
  const decision = decideAutomatedSend(REQUEST, APPROVED, context());
  assert.equal(decision.status, "allowed");
  if (decision.status !== "allowed") return;
  assert.equal(decision.grant.recipientKey, RECIPIENT);
  assert.ok(decision.delaySeconds >= 30 && decision.delaySeconds <= 900);
});

test("a revoked approval beats good behaviour", async () => {
  const decision = decideAutomatedSend(
    REQUEST,
    [{ ...APPROVED[0]!, revokedAt: "2026-08-01T00:00:00.000Z" }],
    context(),
  );
  assert.equal(decision.status, "needs_approval");
});

test("a halted account refuses before the approval gate is consulted", async () => {
  const decision = decideAutomatedSend(
    REQUEST,
    [],
    context({
      account: {
        linkedAt: LINKED_LONG_AGO,
        killSwitch: haltAutomation({ status: "armed" }, "warning", NOW),
      },
    }),
  );
  assert.equal(decision.status, "refused");
  assert.equal(decision.status === "refused" && decision.rule, "kill_switch");
});

test("an unsendable request is refused by decideSend even when policy is clean", async () => {
  const decision = decideAutomatedSend(
    { ...REQUEST, body: "   " },
    APPROVED,
    context(),
  );
  assert.equal(decision.status, "refused");
  assert.equal(decision.status === "refused" && decision.rule, undefined);
});

test("timing speaks last: an unapproved recipient is prompted, not deferred", async () => {
  const decision = decideAutomatedSend(
    REQUEST,
    [],
    context({
      history: [
        { recipientKey: RECIPIENT, sentAt: new Date(Date.parse(NOW) - 1000).toISOString(), body: "hi" },
      ],
    }),
  );
  assert.equal(decision.status, "needs_approval");
});

test("an approved recipient inside the cooldown is deferred", async () => {
  const decision = decideAutomatedSend(
    REQUEST,
    APPROVED,
    context({
      history: [
        { recipientKey: RECIPIENT, sentAt: new Date(Date.parse(NOW) - 1000).toISOString(), body: "hi" },
      ],
    }),
  );
  assert.equal(decision.status, "deferred");
  assert.equal(decision.status === "deferred" && decision.rule, "recipient_cooldown");
});

// ── Portability ──────────────────────────────────────────────────────────────

test("a malformed instant is rejected rather than silently treated as epoch", async () => {
  assert.throws(
    () => evaluateSendPolicy(RECIPIENT, "hi", context({ now: "not a date" })),
    /ISO-8601/,
  );
});

test("the shipped ceiling stays inside the range ADR-158 approved", async () => {
  // These constants are the contract a Rust-side enforcer mirrors.
  assert.ok(SEND_POLICY_LIMITS.dailyCap >= 30 && SEND_POLICY_LIMITS.dailyCap <= 50);
  assert.equal(SEND_POLICY_LIMITS.minJitterSeconds, 30);
  assert.equal(SEND_POLICY_LIMITS.maxJitterSeconds, 15 * 60);
  assert.ok(SEND_POLICY_LIMITS.recipientCooldownDays >= 1);
  assert.ok(SEND_POLICY_LIMITS.similarBodyRecipientLimit <= 10);
});
