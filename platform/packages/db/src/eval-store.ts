/**
 * DrizzleEvalStore — binds @bridge/core's `EvalStore` port (eval/store.ts) to
 * `eval_datasets` / `eval_runs` / `eval_comparisons` (ADR-164).
 *
 * Why this exists: `evalStore` was bound to `InMemoryEvalStore` in BOTH wiring
 * modes, so every eval run died with the process. That was not merely a lost
 * dashboard — `capability.approve` only runs the promotion comparison when it
 * can load a run for the candidate AND its lineage baseline, so after any
 * restart the gate found nothing, fell through to "not applicable", and
 * approved. The gate could not fail because it could not see.
 *
 * Organization scoping: the port's methods carry no organizationId (they take a
 * dataset/run/capability id only), while every table in this schema is
 * organization-scoped. Rather than widen the port — which would touch core and
 * every call site — the store is BOUND to one Organization at construction, so
 * an instance IS that Organization's view of its eval history. Reads and writes
 * both run inside `withOrganizationOnly`, so RLS applies exactly as it does for
 * the row-shaped stores.
 *
 * jsonb validation follows DrizzleCapabilityStore's reasoning: @bridge/core is a
 * zero-runtime-dependency module, so the wire-shape schemas live here, at the
 * only place that touches the raw columns. A malformed row throws loudly rather
 * than silently degrading to an empty score set — an eval run that reads back as
 * "no scores" would be indistinguishable from a genuinely failing capability,
 * which is the one confusion this table exists to prevent.
 */
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@bridge/core";
import type { Comparison, EvalDataset, EvalRun, EvalStore } from "@bridge/core";
import type { Database } from "./client.js";
import { evalComparisons, evalDatasets, evalRuns } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

const axisScoresSchema = z
  .object({
    success: z.number().optional(),
    correction: z.number().optional(),
    quality: z.number().optional(),
    route_p: z.number().optional(),
    route_r: z.number().optional(),
    reliability: z.number().optional(),
    safety: z.number().optional(),
    efficiency: z.number().optional(),
  })
  .strict()
  .transform(withoutUndefined);

const evalCaseSchema = z
  .object({
    id: z.string().min(1),
    input: z.unknown(),
    reference: z.unknown().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    rubric: z.string().optional(),
    origin: z.enum(["seed", "mined", "red-team"]),
    authored_by_capability: z.string().optional(),
  })
  .strict()
  .transform(withoutUndefined);

/**
 * The parsed case shape differs from EvalCase in exactly one way TypeScript
 * cannot bridge: `z.unknown()` infers as OPTIONAL (unknown subsumes undefined)
 * while `EvalCase.input` is required. Every field is still validated at runtime
 * — this annotation narrows the declared type, it does not skip a check.
 */
const casesSchema = z.array(evalCaseSchema) as unknown as z.ZodType<EvalDataset["cases"]>;
const perCaseSchema = z.array(z.object({ caseId: z.string().min(1), axes: axisScoresSchema }).strict());
const significanceSchema = z
  .object({
    n: z.number(),
    ci95: z.record(z.string(), z.tuple([z.number(), z.number()])),
  })
  .strict()
  .transform(withoutUndefined);

/**
 * Zod's `.optional()` yields `key?: T | undefined`, which `exactOptionalPropertyTypes`
 * refuses to treat as the port's `key?: T`. Dropping the explicitly-undefined keys
 * is the honest fix rather than a cast: an axis that was never scored must be
 * ABSENT, not present-and-undefined — `aggregateScores` filters on
 * `typeof value === "number"`, so a materialised undefined would be silently
 * dropped anyway, and `"safety" in aggregate` must stay false when safety was
 * never measured.
 */
type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

function withoutUndefined<T extends object>(value: T): Defined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Defined<T>;
}

/** Parse a jsonb column, naming the row so a corrupt payload is actionable. */
function parseColumn<S extends z.ZodTypeAny>(schema: S, value: unknown, table: string, id: string, column: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${table}.${column} is malformed for id ${id}: ${result.error.message}`);
  }
  return result.data;
}

const evalRunRowSchema = z
  .object({
    id: z.string(),
    capability_id: z.string(),
    capability_version: z.string(),
    dataset_id: z.string(),
    perCase: perCaseSchema,
    aggregate: axisScoresSchema,
    model_version: z.string().optional(),
    started_at: z.string(),
    finished_at: z.string(),
  })
  .strict()
  .transform(withoutUndefined);

export class DrizzleEvalStore implements EvalStore {
  readonly #db: Database;
  readonly #organizationId: string;

  constructor(db: Database, organizationId: string) {
    this.#db = db;
    this.#organizationId = organizationId;
  }

  #scoped<T>(operation: (tx: Database) => Promise<T>): Promise<T> {
    return withOrganizationOnly(this.#db, this.#organizationId, operation);
  }

  async createDataset(row: EvalDataset): Promise<EvalDataset> {
    return this.#scoped(async (tx) => {
      const existing = await tx
        .select({ id: evalDatasets.id })
        .from(evalDatasets)
        .where(and(eq(evalDatasets.organizationId, this.#organizationId), eq(evalDatasets.id, row.id)))
        .limit(1);
      // Mirrors InMemoryEvalStore: a duplicate id is a caller bug, not an
      // upsert. Silently overwriting a dataset would invalidate every run that
      // already scored against it.
      if (existing.length > 0) throw new Error(`eval dataset: duplicate id ${row.id}`);
      await tx.insert(evalDatasets).values({
        id: row.id,
        organizationId: this.#organizationId,
        capabilityType: row.capability_type,
        version: row.version,
        cases: row.cases,
      });
      return row;
    });
  }

  async getDataset(id: string): Promise<EvalDataset | null> {
    return this.#scoped(async (tx) => {
      const rows = await tx
        .select()
        .from(evalDatasets)
        .where(and(eq(evalDatasets.organizationId, this.#organizationId), eq(evalDatasets.id, id)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        capability_type: row.capabilityType,
        version: row.version,
        cases: parseColumn(casesSchema, row.cases, "eval_datasets", row.id, "cases"),
      };
    });
  }

  async listDatasets(opts: { limit: number; offset: number }): Promise<{ items: EvalDataset[]; total: number }> {
    return this.#scoped(async (tx) => {
      const where = eq(evalDatasets.organizationId, this.#organizationId);
      const [rows, totals] = await Promise.all([
        tx.select().from(evalDatasets).where(where).orderBy(asc(evalDatasets.id)).limit(opts.limit).offset(opts.offset),
        tx.select({ value: count() }).from(evalDatasets).where(where),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          capability_type: row.capabilityType,
          version: row.version,
          cases: parseColumn(casesSchema, row.cases, "eval_datasets", row.id, "cases"),
        })),
        total: totals[0]?.value ?? 0,
      };
    });
  }

  async createRun(row: Omit<EvalRun, "id"> & { id?: string }): Promise<EvalRun> {
    // uuidv7 rather than the in-memory counter: ids must not collide across
    // processes or restarts once they outlive one.
    const id = row.id ?? `evalrun_${uuidv7()}`;
    return this.#scoped(async (tx) => {
      const existing = await tx
        .select({ id: evalRuns.id })
        .from(evalRuns)
        .where(and(eq(evalRuns.organizationId, this.#organizationId), eq(evalRuns.id, id)))
        .limit(1);
      if (existing.length > 0) throw new Error(`eval run: duplicate id ${id}`);
      await tx.insert(evalRuns).values({
        id,
        organizationId: this.#organizationId,
        capabilityId: row.capability_id,
        capabilityVersion: row.capability_version,
        datasetId: row.dataset_id,
        perCase: row.perCase,
        aggregate: row.aggregate,
        modelVersion: row.model_version ?? null,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      });
      return { ...row, id };
    });
  }

  async getRun(id: string): Promise<EvalRun | null> {
    return this.#scoped(async (tx) => {
      const rows = await tx
        .select()
        .from(evalRuns)
        .where(and(eq(evalRuns.organizationId, this.#organizationId), eq(evalRuns.id, id)))
        .limit(1);
      return rows[0] ? unpackRun(rows[0]) : null;
    });
  }

  async listRuns(capabilityId: string, opts: { limit: number; offset: number }): Promise<{ items: EvalRun[]; total: number }> {
    return this.#scoped(async (tx) => {
      const where = and(eq(evalRuns.organizationId, this.#organizationId), eq(evalRuns.capabilityId, capabilityId));
      // Ascending by started_at, matching InMemoryEvalStore — the promotion gate
      // reads `.at(-1)` for the latest run, so the order is load-bearing.
      const [rows, totals] = await Promise.all([
        tx.select().from(evalRuns).where(where).orderBy(asc(evalRuns.startedAt)).limit(opts.limit).offset(opts.offset),
        tx.select({ value: count() }).from(evalRuns).where(where),
      ]);
      return { items: rows.map(unpackRun), total: totals[0]?.value ?? 0 };
    });
  }

  async createComparison(row: Omit<Comparison, "id"> & { id?: string }): Promise<Comparison> {
    const id = row.id ?? `evalcmp_${uuidv7()}`;
    return this.#scoped(async (tx) => {
      const existing = await tx
        .select({ id: evalComparisons.id })
        .from(evalComparisons)
        .where(and(eq(evalComparisons.organizationId, this.#organizationId), eq(evalComparisons.id, id)))
        .limit(1);
      if (existing.length > 0) throw new Error(`eval comparison: duplicate id ${id}`);
      await tx.insert(evalComparisons).values({
        id,
        organizationId: this.#organizationId,
        baseline: row.baseline,
        candidate: row.candidate,
        deltas: row.deltas,
        verdict: row.verdict,
        significance: row.significance,
      });
      return { ...row, id };
    });
  }

  async getComparison(id: string): Promise<Comparison | null> {
    return this.#scoped(async (tx) => {
      const rows = await tx
        .select()
        .from(evalComparisons)
        .where(and(eq(evalComparisons.organizationId, this.#organizationId), eq(evalComparisons.id, id)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        baseline: parseColumn(evalRunRowSchema, row.baseline, "eval_comparisons", row.id, "baseline") as EvalRun,
        candidate: parseColumn(evalRunRowSchema, row.candidate, "eval_comparisons", row.id, "candidate") as EvalRun,
        deltas: parseColumn(axisScoresSchema, row.deltas, "eval_comparisons", row.id, "deltas"),
        verdict: row.verdict as Comparison["verdict"],
        significance: parseColumn(significanceSchema, row.significance, "eval_comparisons", row.id, "significance") as Comparison["significance"],
      };
    });
  }
}

function unpackRun(row: typeof evalRuns.$inferSelect): EvalRun {
  return {
    id: row.id,
    capability_id: row.capabilityId,
    capability_version: row.capabilityVersion,
    dataset_id: row.datasetId,
    perCase: parseColumn(perCaseSchema, row.perCase, "eval_runs", row.id, "per_case"),
    aggregate: parseColumn(axisScoresSchema, row.aggregate, "eval_runs", row.id, "aggregate"),
    ...(row.modelVersion !== null ? { model_version: row.modelVersion } : {}),
    started_at: row.startedAt,
    finished_at: row.finishedAt,
  };
}
