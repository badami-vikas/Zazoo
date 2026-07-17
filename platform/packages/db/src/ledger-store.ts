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
import { and, count, desc, eq, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  AlreadyResolvedError,
  type DataScope,
  type LedgerEntry,
  type LedgerStore,
  type RunContext,
  type TrustOrigin,
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
const LEGACY_SEQUENCE_BUCKET_SIZE = 1024;

function isRefLedgerUniqueViolation(err: unknown): boolean {
  // drizzle-orm ≥0.45 no longer throws the driver error directly — it wraps it in a
  // `DrizzleQueryError` and hangs the real Postgres error (which carries `.code` /
  // `.constraint`) on `.cause`. Older versions threw the driver error at the top level.
  // Walk the cause chain so the 23505 → AlreadyResolvedError translation keeps working on
  // both; without this, concurrent decides would surface as a raw DB error instead of the
  // domain error, breaking the ledger's optimistic-concurrency contract.
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 6; depth++) {
    const pg = e as { code?: unknown; message?: unknown; constraint?: unknown; cause?: unknown };
    if (pg.code === UNIQUE_VIOLATION) {
      const text = `${String(pg.constraint ?? "")} ${String(pg.message ?? "")}`;
      if (text.includes(REF_LEDGER_UNIQUE_INDEX)) return true;
    }
    e = pg.cause;
  }
  return false;
}

function unpack(row: typeof ledger.$inferSelect): LedgerEntry {
  // 0015 leaves pre-existing rows nullable to avoid a production ledger rewrite.
  // Its sequence watermark reserves this deterministic legacy range before new appends.
  const appendSequence =
    row.appendSequence ??
    row.createdAt.getTime() * LEGACY_SEQUENCE_BUCKET_SIZE +
      (Number.parseInt(row.id.replaceAll("-", "").slice(-3), 16) % LEGACY_SEQUENCE_BUCKET_SIZE);
  if (!Number.isSafeInteger(appendSequence) || appendSequence <= 0) {
    throw new Error(`Ledger row ${row.id} cannot be assigned a safe append sequence`);
  }
  return {
    id: row.id,
    appendSequence,
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
    ...(row.trustOrigin ? { trustOrigin: row.trustOrigin as TrustOrigin } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

function privateRelationOwnerScope(privateOwnerUserId: string | undefined) {
  if (!privateOwnerUserId) return undefined;
  return or(
    ne(ledger.resourceType, "relation"),
    and(
      eq(ledger.resourceType, "relation"),
      or(
        and(
          eq(ledger.onBehalfOfType, "user"),
          eq(ledger.onBehalfOfId, privateOwnerUserId),
        ),
        and(
          or(isNull(ledger.onBehalfOfType), ne(ledger.onBehalfOfType, "user")),
          eq(ledger.actorType, "user"),
          eq(ledger.actorId, privateOwnerUserId),
        ),
      ),
    ),
  );
}

export class DrizzleLedgerStore implements LedgerStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async append(entry: LedgerEntry): Promise<LedgerEntry> {
    try {
      if (
        entry.refLedgerId &&
        entry.userDecision !== null &&
        (await this.decisionFor(entry.refLedgerId))
      ) {
        throw new AlreadyResolvedError(entry.refLedgerId);
      }
      const rows = await this.#db
        .insert(ledger)
        .values({
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
          ...(entry.trustOrigin ? { trustOrigin: entry.trustOrigin } : {}),
          createdAt: new Date(entry.createdAt),
        })
        .returning();
      const persisted = rows[0];
      if (!persisted) throw new Error("Ledger append returned no row");
      return unpack(persisted);
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
      .where(
        and(
          isNotNull(ledger.userDecision),
          or(
            eq(ledger.refLedgerId, proposalId),
            sql`lower(coalesce(
              ${ledger.inputs}->>'proposalId',
              ${ledger.inputs}->>'proposal_id'
            )) = lower(${proposalId})`,
          ),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${ledger.refLedgerId} IS NULL THEN 1 ELSE 0 END`,
        sql`${ledger.appendSequence} ASC NULLS LAST`,
        ledger.createdAt,
        ledger.id,
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const entry = unpack(row);
    return entry.refLedgerId
      ? entry
      : { ...entry, refLedgerId: proposalId.toLowerCase() };
  }

  async listPending(
    workspaceId: string,
    opts: { limit: number; offset: number; privateOwnerUserId?: string },
  ): Promise<{ items: LedgerEntry[]; total: number }> {
    const resolvingRows = alias(ledger, "resolving_rows");
    const where = and(
      eq(ledger.workspaceId, workspaceId),
      isNull(ledger.userDecision),
      isNull(ledger.refLedgerId),
      sql`${ledger.diff}->>'rejected' is null`,
      privateRelationOwnerScope(opts.privateOwnerUserId),
      notExists(
        this.#db
          .select({ id: resolvingRows.id })
          .from(resolvingRows)
          .where(
            and(
              or(
                eq(resolvingRows.refLedgerId, ledger.id),
                sql`lower(coalesce(
                  ${resolvingRows.inputs}->>'proposalId',
                  ${resolvingRows.inputs}->>'proposal_id'
                )) = lower(${ledger.id}::text)`,
              ),
              isNotNull(resolvingRows.userDecision),
            ),
          ),
      ),
    );
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(ledger).where(where).orderBy(desc(ledger.createdAt)).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(ledger).where(where),
    ]);
    return { items: rows.map(unpack), total: Number(totalRows[0]?.value ?? 0) };
  }

  async listHistory(
    workspaceId: string,
    opts: { limit: number; offset: number; privateOwnerUserId?: string },
  ): Promise<{ items: LedgerEntry[]; total: number }> {
    const where = and(
      eq(ledger.workspaceId, workspaceId),
      privateRelationOwnerScope(opts.privateOwnerUserId),
    );
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select()
        .from(ledger)
        .where(where)
        .orderBy(
          sql`${ledger.appendSequence} DESC NULLS LAST`,
          desc(ledger.createdAt),
          desc(ledger.id),
        )
        .limit(opts.limit)
        .offset(opts.offset),
      this.#db.select({ value: count() }).from(ledger).where(where),
    ]);
    return { items: rows.map(unpack), total: Number(totalRows[0]?.value ?? 0) };
  }
}
