/**
 * DrizzleJobPilotStore — the persistence `@bridge/jobpilot` never had (that
 * package is pure scoring/pipeline/table-spec logic, see its manifest.ts
 * header). Shaped 1:1 with `jobsTableSpec` (jobpilot/src/table.ts) so the
 * `@bridge/tables` Gallery/Board views can bind to these rows directly.
 * Job/application creation is workspace-authenticated CRUD (same tier as
 * workspace membership, dealpilot captures) — not routed through the governed
 * pipeline, since tracking a job posting has no external effect requiring
 * approval. `fitScore` is computed by the router via `scoreJobFit` at read
 * time from the caller's thesis-equivalent inputs, not stored pre-computed,
 * mirroring how `dealpilot.list` scores fit on read rather than on write.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, count } from "drizzle-orm";
import { normalizeLegacyFitFlag } from "@bridge/jobpilot";
import type { Database } from "./client.js";
import { jobpilotJobs, jobpilotApplications } from "./schema.js";

export interface PageOpts {
  limit: number;
  offset: number;
}
export interface Page<T> {
  items: T[];
  total: number;
}

export type JobRow = typeof jobpilotJobs.$inferSelect;
export type ApplicationRow = typeof jobpilotApplications.$inferSelect;

export interface CreateJobInput {
  workspaceId: string;
  title: string;
  company: string;
  location?: string;
  salaryMax?: number;
  url?: string;
  source?: string;
}

/**
 * TASK-010 review round-4 item 11 — applied at EVERY store-level read
 * boundary (not only a test-only helper): `applications.flag` is a plain
 * `text` column with no CHECK constraint yet (TASK-008 RM4 owns migration
 * `0015`; the real backfill + constraint is deferred to `0016+` once that
 * lands — see `outputs/2026-07-17-task010-review-remediation.md`), so a row
 * persisted before the AP-023 green/yellow/red -> pursue/review/pass rename
 * still carries its OLD value until backfilled. Normalizing HERE (rather
 * than leaving it to each individual router procedure) means no caller of
 * this store — present or future — can forget the step and leak a legacy
 * value to a client.
 */
function normalizeApplicationRow(row: ApplicationRow): ApplicationRow {
  const normalized = normalizeLegacyFitFlag(row.flag);
  return normalized === row.flag ? row : { ...row, flag: normalized };
}

export class DrizzleJobPilotStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  /** Creates the job and its tracking application row (stage "queued") in one call —
   * every job JobPilot knows about is, by definition, being tracked. */
  async createJob(input: CreateJobInput): Promise<{ job: JobRow; application: ApplicationRow }> {
    const jobId = randomUUID();
    const [job] = await this.#db
      .insert(jobpilotJobs)
      .values({
        id: jobId,
        workspaceId: input.workspaceId,
        title: input.title,
        company: input.company,
        ...(input.location ? { location: input.location } : {}),
        ...(input.salaryMax != null ? { salaryMax: input.salaryMax } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.source ? { source: input.source } : {}),
      })
      .returning();
    const [application] = await this.#db
      .insert(jobpilotApplications)
      .values({ id: randomUUID(), workspaceId: input.workspaceId, jobId })
      .returning();
    return { job: job!, application: normalizeApplicationRow(application!) };
  }

  async listJobs(workspaceId: string, opts: PageOpts): Promise<Page<JobRow & { application: ApplicationRow | null }>> {
    const where = eq(jobpilotJobs.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select({ job: jobpilotJobs, application: jobpilotApplications })
        .from(jobpilotJobs)
        .leftJoin(jobpilotApplications, eq(jobpilotApplications.jobId, jobpilotJobs.id))
        .where(where)
        .orderBy(desc(jobpilotJobs.createdAt))
        .limit(opts.limit)
        .offset(opts.offset),
      this.#db.select({ value: count() }).from(jobpilotJobs).where(where),
    ]);
    return {
      items: rows.map((r) => ({ ...r.job, application: r.application ? normalizeApplicationRow(r.application) : null })),
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  /** Moves an application to a new stage/flag — the state-machine transition itself
   * (valid-transition checking) lives in `@bridge/jobpilot`'s `transition()`; the
   * router calls that first and only persists the already-validated result here. */
  async updateApplication(
    applicationId: string,
    patch: { stage?: string; flag?: string | null; fitScore?: number },
  ): Promise<ApplicationRow | null> {
    const [row] = await this.#db
      .update(jobpilotApplications)
      .set({
        ...(patch.stage ? { stage: patch.stage } : {}),
        ...(patch.flag !== undefined ? { flag: patch.flag } : {}),
        ...(patch.fitScore != null ? { fitScore: String(patch.fitScore) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(jobpilotApplications.id, applicationId))
      .returning();
    return row ? normalizeApplicationRow(row) : null;
  }

  async getApplication(applicationId: string, workspaceId: string): Promise<ApplicationRow | null> {
    const rows = await this.#db
      .select()
      .from(jobpilotApplications)
      .where(and(eq(jobpilotApplications.id, applicationId), eq(jobpilotApplications.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ? normalizeApplicationRow(rows[0]) : null;
  }
}
