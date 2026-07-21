/**
 * CaptureLedger — the "every capture → inspectable Memory entry" contract
 * (docs/wiki/vision.md "Desktop-first, multi-surface").
 *
 * WHY timeline_entries (+ events) and not a new table or signals:
 *  - `timeline_entries` (packages/db/src/schema.ts) IS the Memory-entry shape
 *    already in the schema: organization-scoped, `occurred_at`, free `type`,
 *    human-readable `content`, `created_by`, linkable to any entity via
 *    `timeline_entry_refs` — exactly what "inspectable Memory entry" needs,
 *    and where derived Memories from other captures (Gmail/Calendar intake)
 *    already land. No new table is invented (per the schema rule).
 *  - `events` gets the append-only DomainEvent ("sensor.capture") via the
 *    EventBus the hub already emits on — that emission IS the blink tell.
 *  - `signals` is deliberately NOT the target: a Signal is an action
 *    recommendation (schema: `recommended_action` NOT NULL) and is read-only/
 *    derived downstream per the v2 punch-list; a capture is a fact about what
 *    happened, not a recommendation. Signal generation from context stays a
 *    downstream consumer's job.
 *
 * This port is the seam: in-memory here (dev/tests, and the local plane keeps
 * working with zero DB); a Drizzle binding over timeline_entries +
 * timeline_entry_refs lands in @bridge/db when the desktop shell wires up
 * persistence.
 */
import type { TrustOrigin } from "@bridge/core";
import type { ContextObservation } from "./types.js";

export interface MemoryEntryRecord {
  id: string;
  organizationId: string;
  /** timeline_entries.type — namespaced by provider kind, e.g. "capture.apps". */
  type: string;
  /** timeline_entries.content — the observation's inspectable summary. */
  content: string;
  occurredAt: string;
  /** timeline_entries.created_by — the provider id (provenance). */
  createdBy: string;
  /** PI-1 provenance of the captured content. */
  trustOrigin: TrustOrigin;
  /** timeline_entry_refs rows — links to the entities the capture concerns. */
  refs: Array<{ entityType: string; entityId: string }>;
  /** Derived payload + redactions, kept for inspection (derived ONLY). */
  payload: Record<string, unknown>;
  redactions: string[];
}

export interface CaptureLedger {
  /** Append one inspectable Memory entry for an observation. */
  record(entry: MemoryEntryRecord): Promise<MemoryEntryRecord>;
  /** Inspectability: list entries so a user can always see what was captured. */
  list(organizationId: string): Promise<MemoryEntryRecord[]>;
}

/** In-memory CaptureLedger — dev/test default, mirrors memory/stores.ts style. */
export class InMemoryCaptureLedger implements CaptureLedger {
  readonly entries: MemoryEntryRecord[] = [];

  async record(entry: MemoryEntryRecord): Promise<MemoryEntryRecord> {
    if (this.entries.some((e) => e.id === entry.id)) {
      throw new Error(`capture ledger: duplicate id ${entry.id} (append-only violation)`);
    }
    this.entries.push({ ...entry });
    return { ...entry };
  }

  async list(organizationId: string): Promise<MemoryEntryRecord[]> {
    return this.entries.filter((e) => e.organizationId === organizationId).map((e) => ({ ...e }));
  }
}
