/**
 * DrizzleLedgerStore — binds the core `LedgerStore` port to the append-only
 * `ledger` table. This is the SAME ledger the prototype already writes to (A3b),
 * now reachable from the governed pipeline.
 *
 * The pipeline records a decision as a NEW row referencing the proposal (append-
 * only: UPDATE/DELETE are revoked on this table in prod). `refLedgerId` and `seed`
 * have no dedicated columns in Schema v2, so they ride in the `diff` jsonb under
 * reserved keys and are reconstructed on read — keeping the table shape faithful
 * to SCHEMA.sql while preserving the pipeline's linkage.
 */
import { eq, sql } from "drizzle-orm";
import type { LedgerEntry, LedgerStore } from "@bridge/core";
import type { Database } from "./client.js";
import { ledger } from "./schema.js";

const REF_KEY = "__refLedgerId";
const SEED_KEY = "__seed";

function packDiff(entry: LedgerEntry): unknown {
  const base = (entry.diff && typeof entry.diff === "object" ? entry.diff : { value: entry.diff }) as Record<
    string,
    unknown
  >;
  const packed: Record<string, unknown> = { ...base };
  if (entry.refLedgerId) packed[REF_KEY] = entry.refLedgerId;
  if (entry.seed) packed[SEED_KEY] = entry.seed;
  return Object.keys(packed).length ? packed : null;
}

function unpack(row: typeof ledger.$inferSelect): LedgerEntry {
  const diff = (row.diff ?? null) as Record<string, unknown> | null;
  const refLedgerId = diff?.[REF_KEY] as string | undefined;
  const seed = diff?.[SEED_KEY] as string | undefined;
  let cleanDiff: unknown = diff;
  if (diff && (REF_KEY in diff || SEED_KEY in diff)) {
    const { [REF_KEY]: _r, [SEED_KEY]: _s, ...rest } = diff;
    cleanDiff = Object.keys(rest).length ? rest : undefined;
  }
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
    ...(cleanDiff !== undefined ? { diff: cleanDiff } : {}),
    policyResults: (row.policyResults ?? []) as LedgerEntry["policyResults"],
    ...(refLedgerId ? { refLedgerId } : {}),
    ...(seed ? { seed } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleLedgerStore implements LedgerStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async append(entry: LedgerEntry): Promise<LedgerEntry> {
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
      diff: packDiff(entry),
      policyResults: entry.policyResults,
      createdAt: new Date(entry.createdAt),
    });
    return entry;
  }

  async get(id: string): Promise<LedgerEntry | null> {
    const rows = await this.#db.select().from(ledger).where(eq(ledger.id, id)).limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  async decisionFor(proposalId: string): Promise<LedgerEntry | null> {
    // Decision rows carry refLedgerId inside the diff jsonb (REF_KEY) and a non-null
    // user_decision. Match on the jsonb key text.
    const rows = await this.#db
      .select()
      .from(ledger)
      .where(sql`${ledger.diff}->>${REF_KEY} = ${proposalId} and ${ledger.userDecision} is not null`)
      .limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }
}
