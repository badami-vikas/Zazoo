/**
 * In-memory OutboxStore — zero-infra adapter (tests + dev). The SQLite adapter
 * (Plan 03) binds the same OutboxStore port and re-runs the shared conformance suite.
 *
 * Deterministic by design: the store never reads a clock. Callers pass `now` /
 * `nextAttemptAt`, mirroring the platform's injected-Clock discipline.
 */
import type { CaptureDraft, OutboxRecord, OutboxStore } from "../ports.js";

export class InMemoryOutboxStore implements OutboxStore {
  readonly records = new Map<string, OutboxRecord>();

  async enqueue(d: CaptureDraft): Promise<void> {
    if (this.records.has(d.id)) return; // idempotent: duplicate enqueue is a no-op
    this.records.set(d.id, {
      draft: { ...d },
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
