import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { applyFilters, applySorts, groupBy as groupRows, type ColumnKind, type TableSpec } from "@bridge/tables";
import { moduleStructure, type ModuleDatabaseBinding, type ModuleManifest } from "@bridge/core";
import {
  RecordValueError,
  TABLE_SCHEMA_NAMESPACE_PREFIX,
  coerceRecordFields,
  moduleDatabaseSpec,
  moduleRecordsSpecId,
} from "../table-schema.js";
import {
  RECORD_QUERY_INPUT,
  assertHumanIdentity,
  assertMembership,
  assertPilotOrganization,
  authenticatedProcedure,
  organizationGuard,
  t,
} from "../router-shared.js";
import type { Wiring } from "../wiring.js";

/**
 * Records of a Builder-built Module (ADR 2026-09-04 "The Egg ships the
 * kernel; Modules live in Commons").
 *
 * A built-in Module hands the shell a TableSpec from code and serves its rows
 * from its own store. A Module the Builder made has neither: its manifest
 * declares Databases with columns, and its rows live HERE — one Local-Plane
 * state document per (Module, Database), read through the same column
 * overlay `tableSchema.*` maintains, so a rename made on the standard Page
 * survives a reload exactly as it does for Accounting.
 *
 * Writes are Human-only, like a Record note: an Agent that wants to add a
 * Record proposes it through the pipeline. That path is not built yet and is
 * said so in TASK-096 rather than faked by letting an Agent write here.
 *
 * ponytail: one JSON document per Database, rewritten on every change — fine
 * for the hundreds of rows a hand-built Module holds; a Database that grows
 * past that moves to a per-Module table (strategy §Phase 3 migrations).
 */
export const MODULE_RECORDS_NAMESPACE_PREFIX = "module:records:";

/** Re-exported from `table-schema.ts`, where the schema capability also needs
 * them — `router-shared.ts` importing a router would close an import cycle. */
export { moduleDatabaseSpec, moduleRecordsSpecId };

export type ModuleRecordRow = { id: string; createdAt: string; updatedAt: string } & Record<
  string,
  unknown
>;

interface StoredRecords {
  rows: ModuleRecordRow[];
}

function readStoredRecords(raw: unknown): StoredRecords {
  if (!raw || typeof raw !== "object") return { rows: [] };
  const rows = (raw as { rows?: unknown }).rows;
  return {
    rows: Array.isArray(rows)
      ? rows.filter(
          (row): row is ModuleRecordRow =>
            !!row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string",
        )
      : [],
  };
}

export async function installedManifest(
  ctx: { wiring: Wiring },
  organizationId: string,
  moduleName: string,
): Promise<ModuleManifest> {
  const rows = await ctx.wiring.moduleStore.listVersions(organizationId, moduleName);
  const live =
    rows.find((row) => row.state === "available" && row.status === "installed") ??
    rows.find((row) => row.state === "available") ??
    rows[rows.length - 1];
  if (!live) {
    throw new TRPCError({ code: "NOT_FOUND", message: `No installed Module named ${moduleName}` });
  }
  return live.manifest;
}

function declaredDatabase(
  manifest: ModuleManifest,
  databaseId: string,
): ModuleDatabaseBinding {
  const database = manifest.module?.databases?.find((candidate) => candidate.id === databaseId);
  if (!database) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Module ${manifest.name} declares no Database ${databaseId} in its manifest`,
    });
  }
  return database;
}

/** Human first, membership second: an Agent is refused as an Agent, not as a
 * stranger — `organizationGuard` alone would answer "not a member" and hide
 * that Records are a Human-only write. */
const humanOrganizationGuard = (what: string) =>
  t.middleware(async ({ ctx, input, next }) => {
    assertHumanIdentity(ctx, what);
    const { organizationId } = input as { organizationId: string };
    assertPilotOrganization(organizationId);
    await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
    return next();
  });

const target = z.object({
  organizationId: z.string().min(1),
  moduleName: z.string().trim().min(1).max(200),
  databaseId: z.string().trim().min(1).max(200),
});

/**
 * A row as the client sends it: only declared columns, each holding what its
 * kind can hold, and — on insert — every `required` column present.
 *
 * The rules are `coerceRecordFields` in `table-schema.ts` (pure, so they are
 * testable without a Wiring); this is only the seam that turns a refusal into
 * the BAD_REQUEST the client reads.
 */
function pickDeclared(
  spec: TableSpec,
  fields: Record<string, unknown>,
  applyDefaults: boolean,
): Record<string, unknown> {
  try {
    return coerceRecordFields(spec, fields, { applyDefaults });
  } catch (error) {
    if (error instanceof RecordValueError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

/** columnId -> kind, so `applyFilters` compares dates as instants and numbers
 * as numbers instead of as text. */
function columnKinds(spec: TableSpec): Record<string, ColumnKind> {
  return Object.fromEntries(spec.columns.map((column) => [column.id, column.kind]));
}

/** Every declared value of a row as one lowercase haystack, for free-text
 * search. Metadata (`id`, timestamps) is deliberately not in it: searching
 * "2026" should not match every Record ever created. */
function searchText(spec: TableSpec, row: ModuleRecordRow): string {
  return spec.columns
    .map((column) => {
      const value = row[column.id];
      return Array.isArray(value) ? value.join(" ") : String(value ?? "");
    })
    .join(" ")
    .toLowerCase();
}

/**
 * Compute every `rollup` column over the far side of its relation.
 *
 * Derived on READ and never stored: a stored rollup goes stale the moment the
 * far-side Record changes, and a stale number that looks live is exactly what
 * ADR-247 forbids. A relation whose target Database holds no rows yields 0 for
 * `count`/`sum` and null for the rest — "unknown" is first-class, and an
 * average of nothing is not zero.
 */
async function withRollups(
  ctx: { wiring: Wiring },
  organizationId: string,
  moduleName: string,
  spec: TableSpec,
  rows: ModuleRecordRow[],
): Promise<ModuleRecordRow[]> {
  const rollups = spec.columns.filter(
    (column) => column.kind === "rollup" && column.rollupSource && column.rollupProperty && column.rollupFunction,
  );
  if (rollups.length === 0 || rows.length === 0) return rows;
  const farRowsBySpec = new Map<string, Map<string, ModuleRecordRow>>();
  const computed = rows.map((row) => ({ ...row }));
  for (const column of rollups) {
    const relation = spec.columns.find((candidate) => candidate.id === column.rollupSource);
    if (!relation?.relationTarget) {
      // A rollup whose relation is gone has nothing to reduce. Absent, not zero.
      for (const row of computed) row[column.id] = null;
      continue;
    }
    // A target may name a Database in THIS Module by its bare id, the way the
    // manifest parser accepts it; rows are always keyed by the full spec id.
    const farSpecId = relation.relationTarget.includes(".")
      ? relation.relationTarget
      : moduleRecordsSpecId(moduleName, relation.relationTarget);
    let far = farRowsBySpec.get(farSpecId);
    if (!far) {
      const stored = readStoredRecords(
        await ctx.wiring.localPlane.state.read(organizationId, `${MODULE_RECORDS_NAMESPACE_PREFIX}${farSpecId}`),
      );
      far = new Map(stored.rows.map((row) => [row.id, row]));
      farRowsBySpec.set(farSpecId, far);
    }
    for (const row of computed) {
      const linked = row[relation.id];
      const ids = Array.isArray(linked) ? linked.map(String) : linked ? [String(linked)] : [];
      const values = ids
        .map((id) => far!.get(id))
        .filter((entry): entry is ModuleRecordRow => !!entry)
        .map((entry) => entry[column.rollupProperty!]);
      row[column.id] = reduceRollup(column.rollupFunction!, values);
    }
  }
  return computed;
}

function reduceRollup(fn: NonNullable<TableSpec["columns"][number]["rollupFunction"]>, values: unknown[]): unknown {
  const present = values.filter((value) => value !== null && value !== undefined && value !== "");
  const numbers = present.map(Number).filter((value) => Number.isFinite(value));
  const times = present.map((value) => new Date(String(value)).getTime()).filter((value) => !Number.isNaN(value));
  switch (fn) {
    case "count":
      return present.length;
    case "sum":
      return numbers.reduce((total, value) => total + value, 0);
    case "average":
      return numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : null;
    case "min":
      return numbers.length ? Math.min(...numbers) : null;
    case "max":
      return numbers.length ? Math.max(...numbers) : null;
    case "earliest":
      return times.length ? new Date(Math.min(...times)).toISOString() : null;
    case "latest":
      return times.length ? new Date(Math.max(...times)).toISOString() : null;
    case "unique":
      return [...new Set(present.map(String))];
    default:
      return present;
  }
}

export const moduleRecordsRouter = t.router({
  /**
   * The Module's resolved structure (UI Rulebook §2/§3d, TASK-100): root
   * Pages (the header toggles), sub-modules with their Pages (collapsible nav
   * children), and each Database's Sections. One resolver with the shell —
   * `moduleStructure` in core — so the api and the rail agree.
   */
  structure: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), moduleName: z.string().trim().min(1).max(200) }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const manifest = await installedManifest(ctx, input.organizationId, input.moduleName);
      const structure = moduleStructure(manifest);
      return {
        rootPages: structure.rootPages,
        subModules: structure.subModules,
        databases: (manifest.module?.databases ?? []).map((database) => ({
          id: database.id,
          name: database.name,
          sections: structure.sections(database.id),
        })),
      };
    }),

  /** The TableSpec the standard Module Page renders for one declared Database. */
  definition: authenticatedProcedure
    .input(target)
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const manifest = await installedManifest(ctx, input.organizationId, input.moduleName);
      const database = declaredDatabase(manifest, input.databaseId);
      const specId = moduleRecordsSpecId(input.moduleName, database.id);
      const overlay = await ctx.wiring.localPlane.state.read(
        input.organizationId,
        `${TABLE_SCHEMA_NAMESPACE_PREFIX}${specId}`,
      );
      return {
        name: database.name,
        spec: moduleDatabaseSpec(input.moduleName, database, overlay),
        sections: moduleStructure(manifest).sections(database.id),
      };
    }),

  /**
   * The Database's Records, QUERIED (TASK-108).
   *
   * This used to hand back the whole stored document and the standard Module
   * Page asked for `limit: 100, offset: 0` and silently stopped there — so a
   * Database's 101st Record could not be reached, and a filter typed in the
   * toolbar was a client-side pass over one page. Filter, search, sort and
   * group all run over EVERY stored row before the slice, and `total` counts
   * what the filter kept, so a pager can be honest about what is behind it.
   *
   * `@bridge/tables`' engine does the work — the same one the web tables use,
   * so a saved View and this procedure can never disagree about what "is
   * after" means.
   */
  list: authenticatedProcedure
    .input(target.merge(RECORD_QUERY_INPUT))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const manifest = await installedManifest(ctx, input.organizationId, input.moduleName);
      const database = declaredDatabase(manifest, input.databaseId);
      const specId = moduleRecordsSpecId(input.moduleName, database.id);
      const spec = moduleDatabaseSpec(
        input.moduleName,
        database,
        await ctx.wiring.localPlane.state.read(
          input.organizationId,
          `${TABLE_SCHEMA_NAMESPACE_PREFIX}${specId}`,
        ),
      );
      const stored = readStoredRecords(
        await ctx.wiring.localPlane.state.read(
          input.organizationId,
          `${MODULE_RECORDS_NAMESPACE_PREFIX}${specId}`,
        ),
      );
      // Rollups are computed BEFORE filtering and sorting: a View that filters
      // on a rolled-up total has to see the total, not an empty cell.
      const all = await withRollups(ctx, input.organizationId, input.moduleName, spec, stored.rows);
      const query = input.query?.trim().toLowerCase() ?? "";
      const searched = query ? all.filter((row) => searchText(spec, row).includes(query)) : all;
      const filtered = applyFilters(searched, input.rowFilters ?? [], input.filterMatch ?? "all", columnKinds(spec));
      const sorted = applySorts(filtered, input.sorts ?? []);
      // Grouping ORDERS the page (every row of a group together) and reports
      // the group sizes, which are counts of the whole filtered set — not of
      // the page, which would make a group header lie on page two.
      const groups = input.groupBy ? groupRows(sorted, input.groupBy) : null;
      const ordered = groups ? groups.flatMap(([, rows]) => rows) : sorted;
      const items = ordered.slice(input.offset, input.offset + input.limit);
      return {
        items,
        total: ordered.length,
        hasMore: input.offset + items.length < ordered.length,
        ...(groups ? { groups: groups.map(([key, rows]) => ({ key, count: rows.length })) } : {}),
      };
    }),

  insert: authenticatedProcedure
    .input(target.extend({ fields: z.record(z.unknown()) }))
    .use(humanOrganizationGuard("Adding a Record to a Module Database")).mutation(async ({ input, ctx }) => {
      const manifest = await installedManifest(ctx, input.organizationId, input.moduleName);
      const database = declaredDatabase(manifest, input.databaseId);
      const specId = moduleRecordsSpecId(input.moduleName, database.id);
      const spec = moduleDatabaseSpec(
        input.moduleName,
        database,
        await ctx.wiring.localPlane.state.read(
          input.organizationId,
          `${TABLE_SCHEMA_NAMESPACE_PREFIX}${specId}`,
        ),
      );
      const fields = pickDeclared(spec, input.fields, true);
      const now = ctx.run.clock.nowISO();
      const row: ModuleRecordRow = { ...fields, id: ctx.run.ids.next(), createdAt: now, updatedAt: now };
      return ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${MODULE_RECORDS_NAMESPACE_PREFIX}${specId}`,
        null,
        (current) => {
          const next = { rows: [...readStoredRecords(current).rows, row] };
          return { state: next, result: row };
        },
      );
    }),

  update: authenticatedProcedure
    .input(target.extend({ recordId: z.string().min(1), fields: z.record(z.unknown()) }))
    .use(humanOrganizationGuard("Editing a Record of a Module Database")).mutation(async ({ input, ctx }) => {
      const manifest = await installedManifest(ctx, input.organizationId, input.moduleName);
      const database = declaredDatabase(manifest, input.databaseId);
      const specId = moduleRecordsSpecId(input.moduleName, database.id);
      const spec = moduleDatabaseSpec(
        input.moduleName,
        database,
        await ctx.wiring.localPlane.state.read(
          input.organizationId,
          `${TABLE_SCHEMA_NAMESPACE_PREFIX}${specId}`,
        ),
      );
      const fields = pickDeclared(spec, input.fields, false);
      const now = ctx.run.clock.nowISO();
      return ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${MODULE_RECORDS_NAMESPACE_PREFIX}${specId}`,
        null,
        (current) => {
          const rows = readStoredRecords(current).rows;
          const index = rows.findIndex((row) => row.id === input.recordId);
          if (index < 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: `unknown Record ${input.recordId}` });
          }
          const updated: ModuleRecordRow = { ...rows[index]!, ...fields, id: input.recordId, updatedAt: now };
          const next = { rows: rows.map((row, at) => (at === index ? updated : row)) };
          return { state: next, result: updated };
        },
      );
    }),

  remove: authenticatedProcedure
    .input(target.extend({ recordIds: z.array(z.string().min(1)).min(1).max(500) }))
    .use(humanOrganizationGuard("Deleting Records of a Module Database")).mutation(async ({ input, ctx }) => {
      const manifest = await installedManifest(ctx, input.organizationId, input.moduleName);
      const database = declaredDatabase(manifest, input.databaseId);
      const specId = moduleRecordsSpecId(input.moduleName, database.id);
      const gone = new Set(input.recordIds);
      return ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${MODULE_RECORDS_NAMESPACE_PREFIX}${specId}`,
        null,
        (current) => {
          const rows = readStoredRecords(current).rows;
          const kept = rows.filter((row) => !gone.has(row.id));
          return { state: { rows: kept }, result: { removed: rows.length - kept.length } };
        },
      );
    }),
});
