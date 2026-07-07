/**
 * DrizzleGraphStore — READ-only surface for Bridge's core vocabulary nouns
 * (Initiative/Touchpoint/Signal/Person/Community) that had zero tRPC coverage
 * (frontend-migration-scoping.md Phase 3). WRITES to `initiatives`/`touchpoints`
 * already flow through the governed pipeline generically (`action.propose` with
 * `resourceType: "initiative" | "touchpoint"`, see router.ts's `resourceTypeEnum`)
 * — this store exists only because the pipeline has no query-back path, the same
 * reason `dealpilot.list`/`integration.list` needed their own read stores.
 * `listPeople`/`listCommunities` were added later (KnowledgeBasePage's People/
 * Communities tabs) to the same store rather than a new one, since it's already
 * the generic home for workspace-scoped node reads.
 *
 * `signal_actions` (act/dismiss/save) is the one exception: it's the user's
 * reaction bookkeeping to a Signal, not a mutation of Person/Relationship data,
 * so it's a direct authenticated write here (same tier as workspace membership
 * CRUD — see workspace-store.ts's header comment) rather than routed through
 * UniversalActionPipeline.propose(). See docs/raw/decisions-log.md.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, count } from "drizzle-orm";
import type { Database } from "./client.js";
import { initiatives, touchpoints, signals, signalActions, people, communities } from "./schema.js";

export interface PageOpts {
  limit: number;
  offset: number;
}
export interface Page<T> {
  items: T[];
  total: number;
}

export class DrizzleGraphStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async listInitiatives(workspaceId: string, opts: PageOpts): Promise<Page<typeof initiatives.$inferSelect>> {
    const where = eq(initiatives.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(initiatives).where(where).orderBy(desc(initiatives.createdAt)).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(initiatives).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async getInitiative(id: string): Promise<typeof initiatives.$inferSelect | null> {
    const rows = await this.#db.select().from(initiatives).where(eq(initiatives.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /** Optionally scoped to one initiative (the tree view) or left workspace-wide. */
  async listTouchpoints(
    workspaceId: string,
    opts: PageOpts & { initiativeId?: string },
  ): Promise<Page<typeof touchpoints.$inferSelect>> {
    const where = opts.initiativeId
      ? and(eq(touchpoints.workspaceId, workspaceId), eq(touchpoints.initiativeId, opts.initiativeId))
      : eq(touchpoints.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(touchpoints).where(where).orderBy(touchpoints.sortOrder).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(touchpoints).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async listSignals(workspaceId: string, opts: PageOpts): Promise<Page<typeof signals.$inferSelect>> {
    const where = eq(signals.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(signals).where(where).orderBy(desc(signals.createdAt)).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(signals).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  async listPeople(workspaceId: string, opts: PageOpts): Promise<Page<typeof people.$inferSelect>> {
    const where = eq(people.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(people).where(where).orderBy(desc(people.createdAt)).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(people).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  // `communities` has no `createdAt` column (unlike `people`/`initiatives`/`signals`),
  // so pagination orders by `id` for a stable (if arbitrary) row order instead.
  async listCommunities(workspaceId: string, opts: PageOpts): Promise<Page<typeof communities.$inferSelect>> {
    const where = eq(communities.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db.select().from(communities).where(where).orderBy(communities.id).limit(opts.limit).offset(opts.offset),
      this.#db.select({ value: count() }).from(communities).where(where),
    ]);
    return { items: rows, total: Number(totalRows[0]?.value ?? 0) };
  }

  /** Records the user's reaction to a Signal (act | dismiss | save). Does not
   * itself perform "act" — that's a separate governed `action.propose` call the
   * caller makes; this only logs which verb the user chose, for signal-status
   * bookkeeping (`signals.status` is left to a later pass to auto-derive from
   * this, not touched here — out of scope, see BUGS.md if that gap needs filing). */
  async recordSignalAction(input: { workspaceId: string; signalId: string; userId: string; verb: "act" | "dismiss" | "save" }): Promise<void> {
    await this.#db.insert(signalActions).values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      signalId: input.signalId,
      userId: input.userId,
      verb: input.verb,
    });
  }
}
