/**
 * DrizzleLedgerStore — binds the core `LedgerStore` port to the append-only
 * `ledger` table. This is the SAME ledger the prototype already writes to (A3b),
 * now reachable from the governed pipeline.
 *
 * The pipeline records a decision as a NEW row referencing the proposal (append-
 * only: UPDATE/DELETE are revoked on this table in prod). `refLedgerId`, `seed`,
 * `dataScope`, and `context` now ride in REAL columns (see
 * `migrations/0003_ledger_ref_column.sql` + schema.ts) — they previously rode in
 * the `diff` jsonb under reserved keys (`__refLedgerId`/`__seed`) with no index,
 * no constraint, and no atomicity guarantee, which let two concurrent `decide()`
 * calls both pass the "already resolved?" check and both commit (TOCTOU). A
 * partial unique index (`ledger_ref_ledger_id_resolved_uq`: at most one row with a
 * given `ref_ledger_id` may have a non-null `user_decision`) now makes the SECOND
 * concurrent append fail at the database with a unique-violation (23505), which
 * `append()` below translates into the same `AlreadyResolvedError` the in-process
 * pre-check throws.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import {
  AlreadyResolvedError,
  type DataScope,
  type LedgerEntry,
  type LedgerStore,
  type RunContext,
} from "@bridge/core";
import type { Database } from "./client.js";
import { ledger } from "./schema.js";

/** Postgres unique_violation SQLSTATE. Both postgres-js and pglite surface this
 * as a `.code` string on the thrown error object (the Postgres wire protocol
 * ErrorResponse code), so checking `.code` works against either driver. */
const UNIQUE_VIOLATION = "23505";
/** The index name from migrations/0003_ledger_ref_column.sql — used to scope the
 * translation to THIS constraint specifically, not any other unique violation a
 * future column might introduce on this table. */
const REF_LEDGER_UNIQUE_INDEX = "ledger_ref_ledger_id_resolved_uq";

function isRefLedgerUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; constraint?: unknown };
  if (e.code !== UNIQUE_VIOLATION) return false;
  const text = `${String(e.constraint ?? "")} ${String(e.message ?? "")}`;
  return text.includes(REF_LEDGER_UNIQUE_INDEX);
}

function unpack(row: typeof ledger.$inferSelect): LedgerEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    actorType: row.actorType as LedgerEntry["actorType"],
    actorId: row.actorId,
    ...(row.onBehalfOfType ? { onBehalfOfType: row.onBehalfOfType as "user" | "team" } : {}),
    ...(row.onBehalfOfId ? { onBehalfOfId: row.onBehalfOfId } : {}),
    ...(row.delegationId ? { delegationId: row.delegationId } : {}),
    action: row.action as LedgerEntry["action"],
    resourceType: row.resourceType as LedgerEntry["resourceType"],
    ...(row.resourceId ? { resourceId: row.resourceId } : {}),
    inputs: row.inputs,
    ...(row.proposedOutput != null ? { proposedOutput: row.proposedOutput } : {}),
    userDecision: (row.userDecision ?? null) as LedgerEntry["userDecision"],
    ...(row.diff !== null && row.diff !== undefined ? { diff: row.diff } : {}),
    policyResults: (row.policyResults ?? []) as LedgerEntry["policyResults"],
    ...(row.refLedgerId ? { refLedgerId: row.refLedgerId } : {}),
    ...(row.seed ? { seed: row.seed } : {}),
    ...(row.dataScope ? { dataScope: row.dataScope as DataScope } : {}),
    ...(row.context != null ? { context: row.context as RunContext } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleLedgerStore implements LedgerStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async append(entry: LedgerEntry): Promise<LedgerEntry> {
    try {
      await this.#db.insert(ledger).values({
        id: entry.id,
        workspaceId: entry.workspaceId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        ...(entry.onBehalfOfType ? { onBehalfOfType: entry.onBehalfOfType } : {}),
        ...(entry.onBehalfOfId ? { onBehalfOfId: entry.onBehalfOfId } : {}),
        ...(entry.delegationId ? { delegationId: entry.delegationId } : {}),
        action: entry.action,
        resourceType: entry.resourceType,
        ...(entry.resourceId ? { resourceId: entry.resourceId } : {}),
        inputs: entry.inputs,
        proposedOutput: entry.proposedOutput ?? null,
        userDecision: entry.userDecision,
        diff: entry.diff ?? null,
        policyResults: entry.policyResults,
        ...(entry.refLedgerId ? { refLedgerId: entry.refLedgerId } : {}),
        ...(entry.seed ? { seed: entry.seed } : {}),
        ...(entry.dataScope ? { dataScope: entry.dataScope } : {}),
        ...(entry.context ? { context: entry.context } : {}),
        createdAt: new Date(entry.createdAt),
      });
      return entry;
    } catch (err) {
      if (isRefLedgerUniqueViolation(err)) {
        throw new AlreadyResolvedError(entry.refLedgerId ?? "(unknown)");
      }
      throw err;
    }
  }

  async get(id: string): Promise<LedgerEntry | null> {
    const rows = await this.#db.select().from(ledger).where(eq(ledger.id, id)).limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  async decisionFor(proposalId: string): Promise<LedgerEntry | null> {
    // Decision rows carry a real ref_ledger_id column and a non-null user_decision
    // (see migrations/0003_ledger_ref_column.sql). This SELECT is a fast, indexed
    // pre-check for the pipeline's early-exit path; it is NOT itself the atomicity
    // guarantee — the partial unique index on (ref_ledger_id) WHERE user_decision
    // IS NOT NULL is, enforced by Postgres regardless of any race between this
    // read and a concurrent append().
    const rows = await this.#db
      .select()
      .from(ledger)
      .where(and(eq(ledger.refLedgerId, proposalId), isNotNull(ledger.userDecision)))
      .limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }
}
