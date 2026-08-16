/**
 * DrizzleDevpilotStore — the persistence `@bridge/devpilot` never had (that
 * module is pure Table specs, domain types), mirroring the jobpilot_*
 * precedent (jobpilot-store.ts). Repo/Pull/Issue creation is
 * organization-authenticated CRUD driven by the governed `devpilot.syncGithub`
 * Skill — not routed through the pipeline-proposal flow, since syncing repo
 * metadata the owner already chose to track has no external effect requiring
 * approval (same tier as JobPilot's job-listing sync).
 *
 * Idempotency: every upsert targets the `(organization_id, source,
 * source_id)` unique triple, so re-running a sync after a partial failure or
 * on the next scheduled tick never duplicates a row — it updates the
 * existing one in place.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "./client.js";
import { devpilotIssues, devpilotPulls, devpilotRepos, integrationSyncState } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

export type DevpilotRepoRow = typeof devpilotRepos.$inferSelect;
export type DevpilotPullRow = typeof devpilotPulls.$inferSelect;
export type DevpilotIssueRow = typeof devpilotIssues.$inferSelect;

export interface UpsertRepoInput {
  organizationId: string;
  source: string;
  sourceId: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  archived: boolean;
  pushedAt: string | null;
  url: string;
}

export interface UpsertPullInput {
  organizationId: string;
  source: string;
  sourceId: string;
  /** The repo's OWN (source, sourceId) — resolved to a local repoId internally
   * so callers never need to know a devpilot_repos row's UUID. */
  repoSourceId: string;
  repoFullName: string;
  number: number;
  title: string;
  state: string;
  reviewState: string;
  author: string | null;
  isDraft: boolean;
  additions: number | null;
  deletions: number | null;
  url: string;
  externalUpdatedAt: string;
}

export interface UpsertIssueInput {
  organizationId: string;
  source: string;
  sourceId: string;
  repoSourceId: string | null;
  repoFullName: string | null;
  number: number;
  title: string;
  state: string;
  labels: string[];
  assignee: string | null;
  priority?: string | null;
  url: string;
  externalUpdatedAt: string;
}

export interface ListOpts {
  limit: number;
  offset: number;
}

export class DrizzleDevpilotStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async #resolveRepoId(
    organizationId: string,
    source: string,
    repoSourceId: string | null,
  ): Promise<string | null> {
    if (!repoSourceId) return null;
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx
        .select({ id: devpilotRepos.id })
        .from(devpilotRepos)
        .where(
          and(
            eq(devpilotRepos.organizationId, organizationId),
            eq(devpilotRepos.source, source),
            eq(devpilotRepos.sourceId, repoSourceId),
          ),
        )
        .limit(1);
      return rows[0]?.id ?? null;
    });
  }

  async upsertRepo(input: UpsertRepoInput): Promise<DevpilotRepoRow> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const values = {
        organizationId: input.organizationId,
        source: input.source,
        sourceId: input.sourceId,
        fullName: input.fullName,
        private: input.private,
        defaultBranch: input.defaultBranch,
        archived: input.archived,
        pushedAt: input.pushedAt ? new Date(input.pushedAt) : null,
        url: input.url,
        syncedAt: new Date(),
      };
      const [existing] = await tx
        .select({ id: devpilotRepos.id, tracked: devpilotRepos.tracked })
        .from(devpilotRepos)
        .where(
          and(
            eq(devpilotRepos.organizationId, input.organizationId),
            eq(devpilotRepos.source, input.source),
            eq(devpilotRepos.sourceId, input.sourceId),
          ),
        )
        .limit(1);
      if (existing) {
        const [row] = await tx
          .update(devpilotRepos)
          .set(values)
          .where(eq(devpilotRepos.id, existing.id))
          .returning();
        return row!;
      }
      const [row] = await tx
        .insert(devpilotRepos)
        .values({ id: randomUUID(), ...values, tracked: false })
        .returning();
      return row!;
    });
  }

  async setTracked(organizationId: string, repoId: string, tracked: boolean): Promise<DevpilotRepoRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const [row] = await tx
        .update(devpilotRepos)
        .set({ tracked })
        .where(and(eq(devpilotRepos.organizationId, organizationId), eq(devpilotRepos.id, repoId)))
        .returning();
      return row ?? null;
    });
  }

  async listRepos(organizationId: string, opts: ListOpts, trackedOnly = false): Promise<DevpilotRepoRow[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const where = trackedOnly
        ? and(eq(devpilotRepos.organizationId, organizationId), eq(devpilotRepos.tracked, true))
        : eq(devpilotRepos.organizationId, organizationId);
      return tx
        .select()
        .from(devpilotRepos)
        .where(where)
        .orderBy(desc(devpilotRepos.pushedAt))
        .limit(opts.limit)
        .offset(opts.offset);
    });
  }

  async upsertPull(input: UpsertPullInput): Promise<DevpilotPullRow> {
    const repoId = await this.#resolveRepoId(input.organizationId, input.source, input.repoSourceId);
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const values = {
        organizationId: input.organizationId,
        source: input.source,
        sourceId: input.sourceId,
        repoId,
        repoFullName: input.repoFullName,
        number: input.number,
        title: input.title,
        state: input.state,
        reviewState: input.reviewState,
        author: input.author,
        isDraft: input.isDraft,
        additions: input.additions,
        deletions: input.deletions,
        url: input.url,
        externalUpdatedAt: new Date(input.externalUpdatedAt),
        syncedAt: new Date(),
      };
      const [existing] = await tx
        .select({ id: devpilotPulls.id })
        .from(devpilotPulls)
        .where(
          and(
            eq(devpilotPulls.organizationId, input.organizationId),
            eq(devpilotPulls.source, input.source),
            eq(devpilotPulls.sourceId, input.sourceId),
          ),
        )
        .limit(1);
      if (existing) {
        const [row] = await tx.update(devpilotPulls).set(values).where(eq(devpilotPulls.id, existing.id)).returning();
        return row!;
      }
      const [row] = await tx.insert(devpilotPulls).values({ id: randomUUID(), ...values }).returning();
      return row!;
    });
  }

  /** Single-row lookup (D2): resolves the stored repoFullName/number a
   * review/analysis Skill needs to fetch fresh content from GitHub. */
  async getPull(organizationId: string, id: string): Promise<DevpilotPullRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(devpilotPulls)
        .where(and(eq(devpilotPulls.organizationId, organizationId), eq(devpilotPulls.id, id)))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async listPulls(organizationId: string, opts: ListOpts): Promise<DevpilotPullRow[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) =>
      tx
        .select()
        .from(devpilotPulls)
        .where(eq(devpilotPulls.organizationId, organizationId))
        .orderBy(desc(devpilotPulls.externalUpdatedAt))
        .limit(opts.limit)
        .offset(opts.offset),
    );
  }

  async upsertIssue(input: UpsertIssueInput): Promise<DevpilotIssueRow> {
    const repoId = await this.#resolveRepoId(input.organizationId, input.source, input.repoSourceId);
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
      const values = {
        organizationId: input.organizationId,
        source: input.source,
        sourceId: input.sourceId,
        repoId,
        repoFullName: input.repoFullName,
        number: input.number,
        title: input.title,
        state: input.state,
        labels: input.labels,
        assignee: input.assignee,
        priority: input.priority ?? null,
        url: input.url,
        externalUpdatedAt: new Date(input.externalUpdatedAt),
        syncedAt: new Date(),
      };
      const [existing] = await tx
        .select({ id: devpilotIssues.id })
        .from(devpilotIssues)
        .where(
          and(
            eq(devpilotIssues.organizationId, input.organizationId),
            eq(devpilotIssues.source, input.source),
            eq(devpilotIssues.sourceId, input.sourceId),
          ),
        )
        .limit(1);
      if (existing) {
        const [row] = await tx
          .update(devpilotIssues)
          .set(values)
          .where(eq(devpilotIssues.id, existing.id))
          .returning();
        return row!;
      }
      const [row] = await tx.insert(devpilotIssues).values({ id: randomUUID(), ...values }).returning();
      return row!;
    });
  }

  /** Single-row lookup (D2) — see getPull. */
  async getIssue(organizationId: string, id: string): Promise<DevpilotIssueRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(devpilotIssues)
        .where(and(eq(devpilotIssues.organizationId, organizationId), eq(devpilotIssues.id, id)))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async listIssues(organizationId: string, opts: ListOpts): Promise<DevpilotIssueRow[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) =>
      tx
        .select()
        .from(devpilotIssues)
        .where(eq(devpilotIssues.organizationId, organizationId))
        .orderBy(desc(devpilotIssues.externalUpdatedAt))
        .limit(opts.limit)
        .offset(opts.offset),
    );
  }

  /** Sync cursor for one (integration, logical source lane) pair — e.g.
   * `github:issues:<repoFullName>` — read via the shared `integration_sync_state`
   * table (schema.ts:838) rather than a devpilot-owned cursor column, so a
   * second Integration reusing the same lane convention (D3's Jira) never
   * needs its own cursor table. */
  async getCursor(integrationId: string, lane: string): Promise<string | undefined> {
    const rows = await this.#db
      .select({ lastCursor: integrationSyncState.lastCursor })
      .from(integrationSyncState)
      .where(and(eq(integrationSyncState.integrationId, integrationId), eq(integrationSyncState.source, lane)))
      .limit(1);
    return rows[0]?.lastCursor ?? undefined;
  }

  async setCursor(integrationId: string, lane: string, cursor: string): Promise<void> {
    await this.#db
      .insert(integrationSyncState)
      .values({ integrationId, source: lane, lastCursor: cursor, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [integrationSyncState.integrationId, integrationSyncState.source],
        set: { lastCursor: cursor, updatedAt: new Date() },
      });
  }
}
