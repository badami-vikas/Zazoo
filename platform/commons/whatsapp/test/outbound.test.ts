/**
 * The outbound ORDER. These tests are about sequencing, not about the rules —
 * `policy.test.ts` and `send.test.ts` own those.
 *
 * The one that matters most is `a_refused_send_never_becomes_an_approval_prompt`:
 * Track C deliberately runs policy refusals before `decideSend` so a first
 * contact never turns into a consent dialog, and the whole value of that prompt
 * is that it is rare enough to still be read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  performAutomatedSend,
  type SendPort,
  type SendPortResult,
} from "../src/outbound.js";
import type { SendPolicyContext, ThreadActivity } from "../src/policy.js";
import type { RecipientApproval, SendRequest } from "../src/send.js";

const RECIPIENT = "whatsapp:+919876543210";
const NOW = "2026-08-02T12:00:00.000Z";
const LINKED_LONG_AGO = "2026-01-01T00:00:00.000Z";

const CONSENTED: ThreadActivity = {
  inboundCount: 3,
  outboundCount: 1,
  firstInboundAt: "2026-07-01T09:00:00.000Z",
  lastInboundAt: "2026-07-30T09:00:00.000Z",
  firstOutboundAt: "2026-07-02T09:00:00.000Z",
  lastOutboundAt: "2026-07-02T09:00:00.000Z",
};

const APPROVED: RecipientApproval[] = [
  { recipientKey: RECIPIENT, approvedBy: "Vikas", approvedAt: "2026-07-01T00:00:00.000Z" },
];

const REQUEST: SendRequest = {
  targetKind: "person",
  targetId: "919876543210@c.us",
  recipientKey: RECIPIENT,
  body: "Following up on the note you sent.",
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

/** A port that records whether it was reached at all. */
function spyPort(result: SendPortResult = { status: "sent", messageId: "MSG1" }) {
  const calls: SendRequest[] = [];
  const port: SendPort = async (request) => {
    calls.push(request);
    return result;
  };
  return { port, calls };
}

test("an allowed send reaches the shell and carries its pacing delay", async () => {
  const { port, calls } = spyPort();
  const outcome = await performAutomatedSend(REQUEST, APPROVED, context(), port);
  assert.equal(outcome.status, "sent");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.recipientKey, RECIPIENT);
  if (outcome.status === "sent") {
    assert.equal(outcome.messageId, "MSG1");
    // Pacing survives to the caller rather than being silently dropped.
    assert.ok(outcome.delaySeconds >= 30);
  }
});

test("a refused send never becomes an approval prompt and never reaches the shell", async () => {
  const { port, calls } = spyPort();

  // A thread the recipient has never written in: automation would be opening
  // the conversation, which is the single strongest ban trigger. There are no
  // approvals recorded, so an implementation that ran `decideSend` first would
  // return `needs_approval` here — training exactly the click-through this
  // ordering exists to prevent.
  const firstContact = await performAutomatedSend(
    REQUEST,
    [],
    context({ thread: { inboundCount: 0, outboundCount: 0 } }),
    port,
  );
  assert.equal(firstContact.status, "refused");
  assert.match((firstContact as { reason: string }).reason, /first contact/i);

  // Same for a halt: it is refused outright, not turned into a prompt.
  const halted = await performAutomatedSend(
    REQUEST,
    [],
    context({
      account: {
        linkedAt: LINKED_LONG_AGO,
        killSwitch: { status: "halted", haltedAt: NOW, reason: "a WhatsApp warning" },
      },
    }),
    port,
  );
  assert.equal(halted.status, "refused");
  assert.equal((halted as { code?: string }).code, "kill_switch");

  assert.equal(calls.length, 0, "a refused send must never reach the shell");
});

test("a recipient with no approval stops at the prompt, before the shell", async () => {
  const { port, calls } = spyPort();
  const outcome = await performAutomatedSend(REQUEST, [], context(), port);
  assert.equal(outcome.status, "needs_approval");
  assert.equal(calls.length, 0, "nothing is sent while consent is outstanding");
});

test("a withdrawn approval outranks good behaviour", async () => {
  const { port, calls } = spyPort();
  const revoked: RecipientApproval[] = [
    { ...APPROVED[0]!, revokedAt: "2026-07-15T00:00:00.000Z" },
  ];
  const outcome = await performAutomatedSend(REQUEST, revoked, context(), port);
  assert.equal(outcome.status, "needs_approval");
  assert.equal(calls.length, 0);
});

test("a deferred send waits rather than spending a slot on the shell", async () => {
  const { port, calls } = spyPort();
  // 03:00 for the recipient — outside sending hours.
  const outcome = await performAutomatedSend(
    REQUEST,
    APPROVED,
    context({ now: "2026-08-02T03:00:00.000Z" }),
    port,
  );
  assert.equal(outcome.status, "deferred");
  if (outcome.status === "deferred") {
    assert.equal(outcome.code, "business_hours");
    assert.ok(outcome.earliestAtMs && outcome.earliestAtMs > Date.parse("2026-08-02T03:00:00.000Z"));
  }
  assert.equal(calls.length, 0);
});

test("the Rust ceiling has the last word, even when the renderer said yes", async () => {
  // The renderer's history is empty, so its advisory copy sees no reason to
  // refuse. The durable ledger on the other side of the IPC boundary disagrees,
  // and the durable one wins. This is the whole point of ADR-158's "a cap that
  // does not bind is not protection".
  const capped = spyPort({
    status: "refused",
    code: "WHATSAPP_SEND_DAILY_CAP",
    reason: "30 automated messages were sent in the last 24 hours; the cap is 30.",
    earliestAtMs: Date.parse("2026-08-03T09:00:00.000Z"),
  });
  const deferred = await performAutomatedSend(REQUEST, APPROVED, context(), capped.port);
  assert.equal(capped.calls.length, 1, "the renderer allowed it; the shell refused it");
  assert.equal(deferred.status, "deferred");
  if (deferred.status === "deferred") {
    assert.equal(deferred.code, "WHATSAPP_SEND_DAILY_CAP");
    assert.equal(deferred.earliestAtMs, Date.parse("2026-08-03T09:00:00.000Z"));
  }

  // A halt from the shell carries no retry time, so it must NOT be presented as
  // something that will resolve itself with patience.
  const halted = spyPort({
    status: "refused",
    code: "WHATSAPP_SEND_HALTED",
    reason: "Automated sending is halted and needs a person to re-arm it.",
  });
  const outcome = await performAutomatedSend(REQUEST, APPROVED, context(), halted.port);
  assert.equal(outcome.status, "refused");
  assert.equal((outcome as { code?: string }).code, "WHATSAPP_SEND_HALTED");
});

test("a shell refusal without a reason still says something honest", async () => {
  const { port } = spyPort({ status: "refused" });
  const outcome = await performAutomatedSend(REQUEST, APPROVED, context(), port);
  assert.equal(outcome.status, "refused");
  assert.match((outcome as { reason: string }).reason, /ceiling/i);
});

test("a malformed request is refused without a prompt and without a send", async () => {
  const { port, calls } = spyPort();
  for (const bad of [
    { ...REQUEST, body: "   " },
    { ...REQUEST, targetId: "not-an-id" },
    { ...REQUEST, body: "a".repeat(4097) },
  ]) {
    const outcome = await performAutomatedSend(bad, APPROVED, context(), port);
    assert.equal(outcome.status, "refused", `${bad.targetId} / ${bad.body.length} chars`);
  }
  assert.equal(calls.length, 0);
});
