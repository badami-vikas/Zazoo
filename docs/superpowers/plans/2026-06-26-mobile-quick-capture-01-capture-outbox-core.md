# Plan 01 — Capture + Outbox Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CaptureDraft` + `OutboxStore` domain to `@bridge/local` — the durable, idempotent, offline-first queue that holds a meeting-note capture until the sync engine commits it through the Pipeline.

**Architecture:** Mirror the package's existing "one port, many adapters" seam (`ports.ts` + `stores/memory.ts` + a `node:test` conformance file). This plan ships the **port + in-memory adapter + a reusable conformance suite**. Plan 03's SQLite adapter re-runs that exact suite, so correctness is defined once here. Pure TypeScript, zero infra.

**Tech Stack:** TypeScript 5.7, `node:test` + `node:assert/strict`, pnpm workspace `@bridge/local`, ESM (NodeNext, `.js` import specifiers, compiled to `dist/` then run).

---

## File structure

- **Modify:** `platform/packages/local/src/ports.ts` — append capture/outbox types + `OutboxStore` interface.
- **Create:** `platform/packages/local/src/stores/outbox-memory.ts` — `InMemoryOutboxStore`.
- **Modify:** `platform/packages/local/src/index.ts` — export the new type(s) + adapter + factory.
- **Create:** `platform/packages/local/test/outbox-conformance.ts` — exported `runOutboxConformance(label, makeStore)` (no test runs on import).
- **Create:** `platform/packages/local/test/outbox.test.ts` — invokes the conformance suite against `InMemoryOutboxStore`.

**Convention notes (verified in repo):**
- Tests compile then run: package script is `"test": "node --test dist/test/*.test.js"`. Build first.
- Imports use explicit `.js` specifiers (e.g. `from "../src/index.js"`), even from `.ts` sources.
- No `Date.now()` is banned here (this is app code, not a workflow script) — but the store must **never call the clock itself**; callers pass `now`/`nextAttemptAt` so behavior is deterministic and testable. This mirrors the platform's injected-Clock discipline.

---

### Task 1: Define capture + outbox types and the `OutboxStore` port

**Files:**
- Modify: `platform/packages/local/src/ports.ts` (append at end of file)

- [ ] **Step 1: Append the types and interface to `ports.ts`**

Add to the end of `platform/packages/local/src/ports.ts`:

```ts
// ── Capture outbox: offline-first queue for mobile quick-capture ───────────────
//
// A CaptureDraft is a meeting note captured on a local-plane node (the phone). It is
// written to the OutboxStore SYNCHRONOUSLY at Save time (never blocks on network) and
// later replayed by the sync engine as a Pipeline action.propose. `id` is a ULID and is
// the end-to-end idempotency key: a duplicate enqueue is a no-op, and a double-propose is
// a Pipeline no-op. Audio NEVER enters this queue — only `audioLocalMediaId` (a local
// pointer); `private ∩ egress = none` means audio bytes cannot cross the gate.

export interface CaptureDraft {
  /** ULID — idempotency key, end to end. */
  id: string;
  workspaceId: string;
  /** Transcript text (on-device STT or manual). May be empty if audio-only + STT failed. */
  text: string;
  /** Optional Person quick-tag: an existing local/canonical id, or a provisional id. */
  personId?: string;
  /** True when `personId` points at a provisional (offline-created) Person. */
  personProvisional?: boolean;
  /** Pointer into LocalMediaStore for the audio blob, if retained. NEVER synced outward. */
  audioLocalMediaId?: string;
  /** Opt-in calendar write-back intent (governed egress, resolved by Plan 07). */
  calendar?: { mode: "new" | "attach"; existingEventId?: string };
  /** Epoch ms, device clock at capture. */
  capturedAt: number;
}

export type OutboxStatus = "pending" | "synced" | "failed";

export interface OutboxRecord {
  draft: CaptureDraft;
  status: OutboxStatus;
  /** Replay attempts so far. */
  attempts: number;
  /** Epoch ms; the earliest time this record may be replayed (backoff). */
  nextAttemptAt: number;
  /** Last failure message, when status === "failed". */
  lastError?: string;
}

export interface OutboxStore {
  /** Durable, SYNCHRONOUS enqueue. Idempotent: a duplicate `draft.id` is a no-op. */
  enqueue(draft: CaptureDraft): Promise<void>;
  get(id: string): Promise<OutboxRecord | null>;
  /** Records replayable at `now`: status !== "synced" AND nextAttemptAt <= now, FIFO by capturedAt. */
  listPending(now: number): Promise<OutboxRecord[]>;
  /** Mark committed. */
  markSynced(id: string): Promise<void>;
  /** Mark a failed attempt: increments `attempts`, sets `lastError` + the next backoff time. */
  markFailed(id: string, error: string, nextAttemptAt: number): Promise<void>;
}
```

- [ ] **Step 2: Typecheck the package to verify the types compile**

Run: `cd platform && pnpm --filter @bridge/local build`
Expected: PASS (clean `tsc -b`; no errors). Types-only change compiles.

- [ ] **Step 3: Commit**

```bash
cd platform
git add packages/local/src/ports.ts
git commit -m "feat(local): CaptureDraft + OutboxStore port for mobile quick-capture

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Write the reusable conformance suite (shared by every adapter)

**Files:**
- Create: `platform/packages/local/test/outbox-conformance.ts`

This file defines behavior **once**. Plan 03's SQLite adapter imports and runs it unchanged. It must NOT register tests on import — it exports a function that callers invoke.

- [ ] **Step 1: Create `outbox-conformance.ts` with the full suite**

Create `platform/packages/local/test/outbox-conformance.ts`:

```ts
/**
 * OutboxStore conformance — the single source of truth for outbox behavior.
 * Every adapter (in-memory now, SQLite in Plan 03) runs this exact suite.
 * Import and call `runOutboxConformance("<label>", makeStore)`; it registers the tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CaptureDraft, OutboxStore } from "../src/index.js";

function draft(over: Partial<CaptureDraft> = {}): CaptureDraft {
  // The repo enables `exactOptionalPropertyTypes: true` (tsconfig.base.json), so an
  // optional field must be OMITTED when undefined — assigning `undefined` is a TS2375
  // error. Conditional spreads keep the strict public CaptureDraft type intact.
  return {
    id: over.id ?? "dummy_01HZX0AAAAAAAAAAAAAAAAAAAA", // 26-char ULID body (SQLite CHECK-safe)
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
    // Guards a future SQLite adapter against `WHERE status='pending'` silently dropping retries.
  });

  test(`${label}: get returns null for unknown id; markSynced/markFailed on unknown throw`, async () => {
    const s = await makeStore();
    assert.equal(await s.get("dummy_nope"), null);
    await assert.rejects(() => s.markSynced("dummy_nope"), /unknown outbox id/);
    await assert.rejects(() => s.markFailed("dummy_nope", "x", 1), /unknown outbox id/);
  });
}
```

- [ ] **Step 2: Typecheck (the suite references `OutboxStore`/`CaptureDraft` from index — they aren't exported yet, so this is expected to fail next)**

Run: `cd platform && pnpm --filter @bridge/local build`
Expected: FAIL — `CaptureDraft`/`OutboxStore` are not exported from `../src/index.js` yet (Task 4 fixes this). This confirms the test depends on the public surface.

- [ ] **Step 3: Commit**

```bash
cd platform
git add packages/local/test/outbox-conformance.ts
git commit -m "test(local): outbox conformance suite (shared across adapters)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Implement `InMemoryOutboxStore`

**Files:**
- Create: `platform/packages/local/src/stores/outbox-memory.ts`

- [ ] **Step 1: Create the in-memory adapter**

Create `platform/packages/local/src/stores/outbox-memory.ts`:

```ts
/**
 * In-memory OutboxStore — zero-infra adapter (tests + dev). The SQLite adapter
 * (Plan 03) binds the same OutboxStore port and re-runs the shared conformance suite.
 *
 * Deterministic by design: the store never reads a clock. Callers pass `now` /
 * `nextAttemptAt`, mirroring the platform's injected-Clock discipline.
 */
import type { CaptureDraft, OutboxRecord, OutboxStore } from "../ports.js";

export class InMemoryOutboxStore implements OutboxStore {
  // private: callers must go through the public methods so idempotency + error
  // guarantees can't be bypassed by external `.records.set(...)`.
  private readonly records = new Map<string, OutboxRecord>();

  async enqueue(draft: CaptureDraft): Promise<void> {
    if (this.records.has(draft.id)) return; // idempotent: duplicate enqueue is a no-op
    this.records.set(draft.id, {
      draft: { ...draft },
      status: "pending",
      attempts: 0,
      nextAttemptAt: 0,
    });
  }

  async get(id: string): Promise<OutboxRecord | null> {
    const r = this.records.get(id);
    return r ? { ...r, draft: { ...r.draft } } : null;
  }

  async listPending(now: number): Promise<OutboxRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.status !== "synced" && r.nextAttemptAt <= now)
      .sort((a, b) => a.draft.capturedAt - b.draft.capturedAt)
      .map((r) => ({ ...r, draft: { ...r.draft } }));
  }

  async markSynced(id: string): Promise<void> {
    const r = this.records.get(id);
    if (!r) throw new Error(`unknown outbox id ${id}`);
    r.status = "synced";
  }

  async markFailed(id: string, error: string, nextAttemptAt: number): Promise<void> {
    const r = this.records.get(id);
    if (!r) throw new Error(`unknown outbox id ${id}`);
    r.status = "failed";
    r.attempts += 1;
    r.lastError = error;
    r.nextAttemptAt = nextAttemptAt;
  }
}

/** Factory mirroring createMemoryLocalPlane's convention. */
export function createMemoryOutbox(): OutboxStore {
  return new InMemoryOutboxStore();
}
```

- [ ] **Step 2: Commit (build runs in Task 4 once exports are wired)**

```bash
cd platform
git add packages/local/src/stores/outbox-memory.ts
git commit -m "feat(local): InMemoryOutboxStore adapter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Export the new surface from the package index

**Files:**
- Modify: `platform/packages/local/src/index.ts`

- [ ] **Step 1: Add exports to `index.ts`**

In `platform/packages/local/src/index.ts`, after the existing `export { createPgliteLocalPlane, ... }` line, add:

```ts
export { InMemoryOutboxStore, createMemoryOutbox } from "./stores/outbox-memory.js";
```

(The `export * from "./ports.js";` already at the top of the file re-exports `CaptureDraft`, `OutboxRecord`, `OutboxStatus`, and `OutboxStore` — no extra line needed for the types.)

- [ ] **Step 2: Build the package to verify everything compiles**

Run: `cd platform && pnpm --filter @bridge/local build`
Expected: PASS — `ports.ts`, `outbox-memory.ts`, and `outbox-conformance.ts` all compile; the Task 2 failure is now resolved because the types are exported.

- [ ] **Step 3: Commit**

```bash
cd platform
git add packages/local/src/index.ts
git commit -m "feat(local): export outbox adapter + types from package index

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Wire the conformance suite to the in-memory adapter and run it

**Files:**
- Create: `platform/packages/local/test/outbox.test.ts`

- [ ] **Step 1: Create the test entry that runs the suite against the in-memory adapter**

Create `platform/packages/local/test/outbox.test.ts`:

```ts
import { InMemoryOutboxStore } from "../src/index.js";
import { runOutboxConformance } from "./outbox-conformance.js";

runOutboxConformance("in-memory outbox", () => new InMemoryOutboxStore());
```

- [ ] **Step 2: Build, then run the outbox tests**

Run: `cd platform && pnpm --filter @bridge/local build && node --test packages/local/dist/test/outbox.test.js`
(Compiled output lives under `packages/local/dist/`, not `platform/dist/`. Equivalently: `pnpm --filter @bridge/local test`.)
Expected: PASS — all 8 conformance tests green (round-trip, idempotent enqueue, FIFO, backoff window, markSynced, attempts increment, mixed-status exclusion, unknown-id throws).

- [ ] **Step 3: Run the package's full test suite to confirm no regression**

Run: `cd platform && pnpm --filter @bridge/local build && node --test packages/local/dist/test/*.test.js`
Expected: PASS — 9 tests total (8 outbox + the existing pglite local-plane test), all green (blast-radius check: the additive ports change touched no existing adapter).

- [ ] **Step 4: Commit**

```bash
cd platform
git add packages/local/test/outbox.test.ts
git commit -m "test(local): run outbox conformance against in-memory adapter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-review notes (done while writing)

- **Spec coverage:** This plan implements the spec's "outbox" table/contract (§5.6, §7 "new mobile-only outbox") and the idempotency + offline-first guarantees (§8). It deliberately stops short of persistence (SQLite = Plan 03) and the Pipeline replay (sync engine = Plan 04) — those consume this port.
- **Determinism:** the store never reads a clock; `now`/`nextAttemptAt` are injected, matching platform discipline and making backoff testable without timers.
- **Idempotency:** `enqueue` dup = no-op (offline double-tap safe); the end-to-end ULID idempotency against the Pipeline lands in Plan 04.
- **Audio residency:** the type carries only `audioLocalMediaId` (a pointer), never bytes — enforced structurally here; the egress-payload assertion test is Plan 04.
- **Type consistency:** `OutboxStore` method names (`enqueue/get/listPending/markSynced/markFailed`) and `OutboxRecord` fields (`status/attempts/nextAttemptAt/lastError`) are used identically in the port, the adapter, and the conformance suite.
- **Vocabulary + dummy data:** fixtures are `dummy_`-prefixed; types speak Touchpoint-via-CaptureDraft, never Lead/Deal.
