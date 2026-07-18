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
import { and, count, desc, eq, inArray, isNotNull, isNull, ne, not, notExists, or, sql, type SQL } from "drizzle-orm";
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
  const appendSequence = row.appendSequence;
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

/** Owner-scopes private rows plus legacy Relationship rows that predate dataScope.
 * TASK-010's private correction marker remains part of the same predicate. */
function isOwnerScopedLedgerEntrySql(): SQL {
  return or(
    sql`coalesce(${ledger.dataScope}, '') = 'private'`,
    inArray(ledger.resourceType, ["relation", "person", "community", "event", "touchpoint"]),
    sql`${ledger.inputs} -> 'directive' IS NOT NULL`,
    sql`coalesce(${ledger.inputs} ->> 'visibility', '') = 'private'`,
  )!;
}

function privateProposalOwnerScope(privateOwnerUserId: string | undefined) {
  if (!privateOwnerUserId) return undefined;
  const isPrivate = isOwnerScopedLedgerEntrySql();
  return or(
    not(isPrivate),
    and(
      isPrivate,
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
  readonly #db: Database;
  readonly #defaultWorkspaceId: string | null;
  readonly #activeWorkspaceId: string | null;

  constructor(
    db: Database,
    options: {
      defaultWorkspaceId?: string;
      activeWorkspaceId?: string;
    } = {},
  ) {
    this.#db = db;
    this.#defaultWorkspaceId = options.defaultWorkspaceId ?? null;
    this.#activeWorkspaceId = options.activeWorkspaceId ?? null;
  }

  async #withWorkspace<T>(
    workspaceId: string,
    operation: (store: DrizzleLedgerStore) => Promise<T>,
  ): Promise<T> {
    return this.#db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.workspace_id', ${workspaceId}, true)`,
      );
      return operation(
        new DrizzleLedgerStore(tx, {
          defaultWorkspaceId: workspaceId,
          activeWorkspaceId: workspaceId,
        }),
      );
    });
  }

  #assertActiveWorkspace(workspaceId: string): void {
    if (
      this.#activeWorkspaceId &&
      this.#activeWorkspaceId !== workspaceId
    ) {
      throw new Error("Ledger operation crossed its workspace context");
    }
  }

  async ensureAppendSequenceFloor(floor: number): Promise<void> {
    if (!Number.isSafeInteger(floor) || floor < 0) {
      throw new Error("Ledger append sequence floor must be a non-negative integer");
    }
    if (floor === 0) return;
    await this.#db.execute(sql`
      SELECT setval(
        'ledger_append_sequence_seq',
        GREATEST(
          (SELECT last_value FROM ledger_append_sequence_seq),
          ${floor}
        ),
        true
      )
    `);
  }

  async append(entry: LedgerEntry): Promise<LedgerEntry> {
    if (!this.#activeWorkspaceId) {
      return this.#withWorkspace(entry.workspaceId, (store) =>
        store.append(entry),
      );
    }
    this.#assertActiveWorkspace(entry.workspaceId);
    if (
      entry.userDecision !== null &&
      entry.userDecision !== "auto" &&
      !entry.refLedgerId
    ) {
      throw new Error("Resolving ledger decisions require refLedgerId");
    }
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
    if (!this.#activeWorkspaceId && this.#defaultWorkspaceId) {
      return this.#withWorkspace(this.#defaultWorkspaceId, (store) =>
        store.get(id),
      );
    }
    const rows = await this.#db.select().from(ledger).where(eq(ledger.id, id)).limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  async decisionFor(proposalId: string): Promise<LedgerEntry | null> {
    if (!this.#activeWorkspaceId && this.#defaultWorkspaceId) {
      return this.#withWorkspace(this.#defaultWorkspaceId, (store) =>
        store.decisionFor(proposalId),
      );
    }
    // Decision rows carry a real ref_ledger_id column and a non-null user_decision.
    // Migration 0015 backfills the narrowly verified legacy shape once; runtime
    // resolution never infers authority from caller-controlled JSON inputs.
    // This SELECT is a fast, indexed
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
          eq(ledger.refLedgerId, proposalId),
        ),
      )
      .orderBy(
        sql`${ledger.appendSequence} ASC NULLS LAST`,
        ledger.createdAt,
        ledger.id,
      )
      .limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  async listPending(
    workspaceId: string,
    opts: { limit: number; offset: number; privateOwnerUserId?: string },
  ): Promise<{ items: LedgerEntry[]; total: number }> {
    if (!this.#activeWorkspaceId) {
      return this.#withWorkspace(workspaceId, (store) =>
        store.listPending(workspaceId, opts),
      );
    }
    this.#assertActiveWorkspace(workspaceId);
    const resolvingRows = alias(ledger, "resolving_rows");
    const where = and(
      eq(ledger.workspaceId, workspaceId),
      isNull(ledger.userDecision),
      isNull(ledger.refLedgerId),
      sql`${ledger.diff}->>'rejected' is null`,
      privateProposalOwnerScope(opts.privateOwnerUserId),
      notExists(
        this.#db
          .select({ id: resolvingRows.id })
          .from(resolvingRows)
          .where(
            and(
              eq(resolvingRows.refLedgerId, ledger.id),
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
    if (!this.#activeWorkspaceId) {
      return this.#withWorkspace(workspaceId, (store) =>
        store.listHistory(workspaceId, opts),
      );
    }
    this.#assertActiveWorkspace(workspaceId);
    const where = and(
      eq(ledger.workspaceId, workspaceId),
      privateProposalOwnerScope(opts.privateOwnerUserId),
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
