/**
 * OutboxStore conformance — the single source of truth for outbox behavior.
 * Every adapter (in-memory now, SQLite in Plan 03) runs this exact suite.
 * Import and call `runOutboxConformance("<label>", makeStore)`; it registers the tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CaptureDraft, OutboxStore } from "../src/index.js";

function draft(over: Partial<CaptureDraft> = {}): CaptureDraft {
  // Build the required fields, then spread only the optional fields that are
  // actually provided. Assigning `undefined` to an optional prop is rejected
  // under this repo's `exactOptionalPropertyTypes: true`, so we omit instead.
  return {
    id: over.id ?? "dummy_01HZX0AAAAAAAAAAAAAAAAAAAA",
    workspaceId: over.workspaceId ?? "dummy_ws-1",
    text: over.text ?? "met Priya at the founders dinner; warm, ex-Stripe",
    capturedAt: over.capturedAt ?? 1_000,
    ...(over.personId !== undefined ? { personId: over.personId } : {}),
    ...(over.personProvisional !== undefined ? { personProvisional: over.personProvisional } : {}),
    ...(over.audioLocalMediaId !== undefined ? { audioLocalMediaId: over.audioLocalMediaId } : {}),
    ...(over.calendar !== undefined ? { calendar: over.calendar } : {}),
  };
}

export function runOutboxConformance(label: string, makeStore: () => OutboxStore | Promise<OutboxStore>): void {
  test(`${label}: enqueue then get round-trips as pending`, async () => {
    const s = await makeStore();
    await s.enqueue(draft({ id: "dummy_a" }));
    const rec = await s.get("dummy_a");
    assert.equal(rec?.status, "pending");
    assert.equal(rec?.attempts, 0);
    assert.equal(rec?.draft.text, "met Priya at the founders dinner; warm, ex-Stripe");
    assert.equal(rec?.nextAttemptAt, 0, "pending immediately by default");
  });

  test(`${label}: enqueue is idempotent on duplicate id (no-op, no overwrite)`, async () => {
    const s = await makeStore();
    await s.enqueue(draft({ id: "dummy_dup", text: "first" }));
    await s.enqueue(draft({ id: "dummy_dup", text: "SECOND should be ignored" }));
    const rec = await s.get("dummy_dup");
    assert.equal(rec?.draft.text, "first", "duplicate enqueue must not overwrite");
    const pending = await s.listPending(10_000);
    assert.equal(pending.filter((r) => r.draft.id === "dummy_dup").length, 1, "no duplicate row");
  });

  test(`${label}: listPending returns due records FIFO by capturedAt`, async () => {
    const s = await makeStore();
    await s.enqueue(draft({ id: "dummy_late", capturedAt: 200 }));
    await s.enqueue(draft({ id: "dummy_early", capturedAt: 100 }));
    const pending = await s.listPending(10_000);
    assert.deepEqual(pending.map((r) => r.draft.id), ["dummy_early", "dummy_late"]);
  });

  test(`${label}: listPending excludes records whose nextAttemptAt is in the future`, async () => {
    const s = await makeStore();
    await s.enqueue(draft({ id: "dummy_x" }));
    await s.markFailed("dummy_x", "network down", 5_000);
    assert.equal((await s.listPending(4_999)).length, 0, "not yet due");
    const due = await s.listPending(5_000);
    assert.equal(due.length, 1, "due at exactly nextAttemptAt");
    assert.equal(due[0]?.status, "failed");
    assert.equal(due[0]?.attempts, 1);
    assert.equal(due[0]?.lastError, "network down");
  });

  test(`${label}: markSynced removes the record from pending`, async () => {
    const s = await makeStore();
    await s.enqueue(draft({ id: "dummy_done" }));
    await s.markSynced("dummy_done");
    assert.equal((await s.get("dummy_done"))?.status, "synced");
    assert.equal((await s.listPending(10_000)).length, 0, "synced never replays");
  });

  test(`${label}: markFailed increments attempts across retries`, async () => {
    const s = await makeStore();
    await s.enqueue(draft({ id: "dummy_retry" }));
    await s.markFailed("dummy_retry", "err1", 1_000);
    await s.markFailed("dummy_retry", "err2", 2_000);
    const rec = await s.get("dummy_retry");
    assert.equal(rec?.attempts, 2);
    assert.equal(rec?.lastError, "err2");
    assert.equal(rec?.nextAttemptAt, 2_000);
  });

  test(`${label}: failed-but-not-yet-due is excluded while pending-immediately is included`, async () => {
    const s = await makeStore();
    await s.enqueue(draft({ id: "dummy_now", capturedAt: 1 }));
    await s.enqueue(draft({ id: "dummy_wait", capturedAt: 2 }));
    await s.markFailed("dummy_wait", "err", 9_999);
    const due = await s.listPending(5_000);
    assert.deepEqual(due.map((r) => r.draft.id), ["dummy_now"]);
  });

  test(`${label}: get returns null for unknown id; markSynced/markFailed on unknown throw`, async () => {
    const s = await makeStore();
    assert.equal(await s.get("dummy_nope"), null);
    await assert.rejects(() => s.markSynced("dummy_nope"), /unknown outbox id/);
    await assert.rejects(() => s.markFailed("dummy_nope", "x", 1), /unknown outbox id/);
  });
}
