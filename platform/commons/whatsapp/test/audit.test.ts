import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  appendAuditEvent,
  auditEventFromOutcome,
  emptyAuditState,
  listAuditEvents,
  readAuditState,
  summarizeAudit,
  type AuditEvent,
  type AuditState,
} from "../src/audit.js";
import type { OutboundOutcome } from "../src/outbound.js";
import type { SendRequest } from "../src/send.js";

const T0 = "2026-08-01T10:00:00.000Z";
const T1 = "2026-08-01T11:00:00.000Z";
const T2 = "2026-08-02T10:00:00.000Z";

const REQUEST: SendRequest = {
  targetKind: "person",
  targetId: "919876543210@c.us",
  recipientKey: "whatsapp:+919876543210",
  body: "Following up on our chat.",
};

function event(id: string, overrides: Partial<AuditEvent> = {}): AuditEvent {
  return { id, kind: "sync_run", at: T0, ...overrides };
}

// ── The honest empty state ───────────────────────────────────────────────────

test("an empty log reports nothing and claims no window", () => {
  const summary = summarizeAudit(emptyAuditState());
  assert.equal(summary.total, 0);
  assert.equal(summary.dropped, 0);
  assert.equal(summary.earliestAt, undefined);
  assert.equal(summary.latestAt, undefined);
  assert.deepEqual(summary.byKind, []);
  assert.deepEqual(summary.refusalsByRule, []);
  assert.deepEqual(summary.sends, {
    attempted: 0,
    sent: 0,
    refused: 0,
    deferred: 0,
    needsApproval: 0,
  });
});

test("byKind lists only kinds that actually occurred", () => {
  const state = appendAuditEvent(emptyAuditState(), event("a", { kind: "extraction_run" }));
  assert.deepEqual(summarizeAudit(state).byKind, [{ kind: "extraction_run", count: 1 }]);
});

// ── Append ───────────────────────────────────────────────────────────────────

test("events are newest first", () => {
  let state = appendAuditEvent(emptyAuditState(), event("a", { at: T0 }));
  state = appendAuditEvent(state, event("b", { at: T1 }));
  assert.deepEqual(state.events.map((e) => e.id), ["b", "a"]);
});

test("appending the same id twice is a no-op, so a retry cannot double-count", () => {
  const first = appendAuditEvent(emptyAuditState(), event("a"));
  assert.equal(appendAuditEvent(first, event("a", { kind: "send_sent" })), first);
  assert.equal(first.events.length, 1);
});

test("retention drops the oldest and counts what it dropped", () => {
  let state = emptyAuditState();
  for (let i = 0; i < 5; i += 1) {
    state = appendAuditEvent(state, event(`e${i}`, { at: `2026-08-01T0${i}:00:00.000Z` }), 3);
  }
  assert.equal(state.events.length, 3);
  assert.equal(state.dropped, 2);
  // The newest three survived.
  assert.deepEqual(state.events.map((e) => e.id), ["e4", "e3", "e2"]);
});

test("a zero-or-negative retention still keeps at least one event", () => {
  const state = appendAuditEvent(emptyAuditState(), event("a"), 0);
  assert.equal(state.events.length, 1);
});

test("dropped is reported so a zero count can be read correctly", () => {
  let state = emptyAuditState();
  for (let i = 0; i < 4; i += 1) {
    state = appendAuditEvent(state, event(`e${i}`), 2);
  }
  assert.equal(summarizeAudit(state).dropped, 2);
});

// ── Outcomes from the real send path become rows ─────────────────────────────

test("a sent outcome records the delay it was paced by", () => {
  const outcome: OutboundOutcome = {
    status: "sent",
    request: REQUEST,
    messageId: "msg-1",
    delaySeconds: 120,
  };
  const row = auditEventFromOutcome("a", T0, REQUEST.recipientKey, outcome);
  assert.equal(row.kind, "send_sent");
  assert.equal(row.recipientKey, REQUEST.recipientKey);
  assert.deepEqual(row.detail, { delaySeconds: 120 });
});

test("a refusal keeps the rule that refused it and the reason given", () => {
  const outcome: OutboundOutcome = {
    status: "refused",
    reason: "This recipient has never written in this thread.",
    code: "consent_gate",
  };
  const row = auditEventFromOutcome("a", T0, REQUEST.recipientKey, outcome);
  assert.equal(row.kind, "send_refused");
  assert.equal(row.rule, "consent_gate");
  assert.equal(row.reason, "This recipient has never written in this thread.");
});

test("a deferral carries the instant it becomes retryable", () => {
  const earliest = Date.parse(T1);
  const outcome: OutboundOutcome = {
    status: "deferred",
    reason: "The cap is full.",
    code: "daily_cap",
    earliestAtMs: earliest,
  };
  const row = auditEventFromOutcome("a", T0, REQUEST.recipientKey, outcome);
  assert.equal(row.kind, "send_deferred");
  assert.equal(row.earliestAt, T1);
});

test("a needs_approval outcome is recorded as such, never as a refusal", () => {
  const outcome: OutboundOutcome = {
    status: "needs_approval",
    request: REQUEST,
    reason: "This recipient has not been approved.",
  };
  assert.equal(auditEventFromOutcome("a", T0, REQUEST.recipientKey, outcome).kind, "send_needs_approval");
});

test("a row can be attributed to the rule and subject that produced it", () => {
  const outcome: OutboundOutcome = { status: "refused", reason: "no", code: "kill_switch" };
  const row = auditEventFromOutcome("a", T0, REQUEST.recipientKey, outcome, {
    subjectKey: "chat:919876543210@c.us",
    ruleId: "rule-7",
  });
  assert.equal(row.subjectKey, "chat:919876543210@c.us");
  assert.equal(row.ruleId, "rule-7");
});

test("a refusal with no code records no rule rather than inventing one", () => {
  const outcome: OutboundOutcome = { status: "refused", reason: "the shell said no" };
  assert.equal(auditEventFromOutcome("a", T0, REQUEST.recipientKey, outcome).rule, undefined);
});

// ── Queries ──────────────────────────────────────────────────────────────────

function populated(): AuditState {
  let state = emptyAuditState();
  state = appendAuditEvent(state, event("s1", { kind: "sync_run", at: T0 }));
  state = appendAuditEvent(
    state,
    event("r1", { kind: "send_refused", at: T1, rule: "consent_gate", reason: "never wrote" }),
  );
  state = appendAuditEvent(
    state,
    event("r2", { kind: "send_refused", at: T2, rule: "consent_gate", reason: "never wrote" }),
  );
  state = appendAuditEvent(
    state,
    event("d1", { kind: "send_deferred", at: T2, rule: "daily_cap", reason: "cap full" }),
  );
  return state;
}

test("filtering by kind returns only that kind", () => {
  const hits = listAuditEvents(populated(), { kinds: ["send_refused"] });
  assert.deepEqual(hits.map((e) => e.id), ["r2", "r1"]);
});

test("the since window excludes anything older", () => {
  const hits = listAuditEvents(populated(), { sinceIso: T2 });
  assert.deepEqual(hits.map((e) => e.id).sort(), ["d1", "r2"]);
});

test("an unparseable since is ignored rather than dropping every row", () => {
  assert.equal(listAuditEvents(populated(), { sinceIso: "not-a-date" }).length, 4);
});

test("a limit truncates but keeps newest first", () => {
  assert.deepEqual(listAuditEvents(populated(), { limit: 2 }).map((e) => e.id), ["d1", "r2"]);
});

test("filtering by subject and by rule id both narrow the log", () => {
  let state = emptyAuditState();
  state = appendAuditEvent(state, event("a", { subjectKey: "chat:x", ruleId: "rule-1" }));
  state = appendAuditEvent(state, event("b", { subjectKey: "chat:y", ruleId: "rule-2" }));
  assert.deepEqual(listAuditEvents(state, { subjectKey: "chat:x" }).map((e) => e.id), ["a"]);
  assert.deepEqual(listAuditEvents(state, { ruleId: "rule-2" }).map((e) => e.id), ["b"]);
});

// ── Rollup ───────────────────────────────────────────────────────────────────

test("refusals are grouped by rule, most frequent first, with a reason", () => {
  const summary = summarizeAudit(populated());
  assert.deepEqual(summary.refusalsByRule, [
    { rule: "consent_gate", count: 2, reason: "never wrote" },
    { rule: "daily_cap", count: 1, reason: "cap full" },
  ]);
});

test("send counters split refused from deferred from approval-needed", () => {
  const summary = summarizeAudit(populated());
  assert.deepEqual(summary.sends, {
    attempted: 0,
    sent: 0,
    refused: 2,
    deferred: 1,
    needsApproval: 0,
  });
});

test("the reported window bounds are the events actually held", () => {
  const summary = summarizeAudit(populated());
  assert.equal(summary.earliestAt, T0);
  assert.equal(summary.latestAt, T2);
});

test("a rollup over a window counts only that window", () => {
  const summary = summarizeAudit(populated(), { sinceIso: T2 });
  assert.equal(summary.total, 2);
  assert.equal(summary.earliestAt, T2);
});

test("a refusal recorded without a rule is grouped as unspecified, not dropped", () => {
  const state = appendAuditEvent(
    emptyAuditState(),
    event("a", { kind: "send_refused", reason: "shell said no" }),
  );
  assert.deepEqual(summarizeAudit(state).refusalsByRule, [
    { rule: "unspecified", count: 1, reason: "shell said no" },
  ]);
});

// ── Persistence round-trip ───────────────────────────────────────────────────

test("state survives a JSON round trip, which is what restart means here", () => {
  const state = populated();
  assert.deepEqual(readAuditState(JSON.parse(JSON.stringify(state))), state);
});

test("an unrecognised persisted value yields empty state rather than throwing", () => {
  assert.deepEqual(readAuditState(null), emptyAuditState());
  assert.deepEqual(readAuditState({ version: 2, events: [] }), emptyAuditState());
  assert.deepEqual(readAuditState({ version: 1, events: "nope" }), emptyAuditState());
});

test("a malformed row is skipped and counted as dropped, keeping the good rows", () => {
  const reloaded = readAuditState({
    version: 1,
    dropped: 3,
    events: [
      { id: "good", kind: "sync_run", at: T0 },
      { id: "bad-kind", kind: "not_a_kind", at: T0 },
      { id: "", kind: "sync_run", at: T0 },
      { id: "no-at", kind: "sync_run" },
      null,
    ],
  });
  assert.deepEqual(reloaded.events.map((e) => e.id), ["good"]);
  // 3 previously dropped, plus the 4 skipped now.
  assert.equal(reloaded.dropped, 7);
});

test("detail is kept only for scalar fields, so a body cannot smuggle in", () => {
  const reloaded = readAuditState({
    version: 1,
    events: [
      {
        id: "a",
        kind: "send_sent",
        at: T0,
        detail: { delaySeconds: 30, ok: true, label: "x", nested: { body: "secret" } },
      },
    ],
  });
  assert.deepEqual(reloaded.events[0]?.detail, { delaySeconds: 30, ok: true, label: "x" });
});

test("a negative persisted dropped count is floored at zero", () => {
  const reloaded = readAuditState({ version: 1, dropped: -5, events: [] });
  assert.equal(reloaded.dropped, 0);
});
