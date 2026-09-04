import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { applyColumnOverlay, type TableSpec } from "@bridge/tables";
import type { ModuleDatabaseBinding, ModuleManifest } from "@bridge/core";
import { TABLE_SCHEMA_NAMESPACE_PREFIX, readStoredTableSchema } from "../table-schema.js";
import {
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

export function moduleRecordsSpecId(moduleName: string, databaseId: string): string {
  return `${moduleName}.${databaseId}`;
}

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

async function installedManifest(
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

/** The manifest's columns as a TableSpec, with the Organization's overlay applied. */
export function moduleDatabaseSpec(
  moduleName: string,
  database: ModuleDatabaseBinding,
  storedOverlay: unknown,
): TableSpec {
  const base: TableSpec = {
    id: moduleRecordsSpecId(moduleName, database.id),
    columns: database.columns.map((column) => ({
      id: column.id,
      label: column.label,
      kind: column.kind,
      editable: true,
      ...(column.options ? { options: [...column.options] } : {}),
      ...(column.skillId ? { skillId: column.skillId } : {}),
      ...(column.required ? { required: true } : {}),
      ...(column.defaultValue !== undefined ? { defaultValue: column.defaultValue } : {}),
      ...(column.relationTarget ? { relationTarget: column.relationTarget } : {}),
    })),
  };
  return applyColumnOverlay(base, readStoredTableSchema(storedOverlay).overlay);
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

/** A row as the client sends it: only declared columns, nothing else. */
function pickDeclared(
  spec: TableSpec,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(spec.columns.map((column) => column.id));
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.has(key)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${key} is not a column of ${spec.id}`,
      });
    }
    picked[key] = value;
  }
  return picked;
}

export const moduleRecordsRouter = t.router({
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
      return { name: database.name, spec: moduleDatabaseSpec(input.moduleName, database, overlay) };
    }),

  list: authenticatedProcedure
    .input(target)
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const manifest = await installedManifest(ctx, input.organizationId, input.moduleName);
      const database = declaredDatabase(manifest, input.databaseId);
      const stored = readStoredRecords(
        await ctx.wiring.localPlane.state.read(
          input.organizationId,
          `${MODULE_RECORDS_NAMESPACE_PREFIX}${moduleRecordsSpecId(input.moduleName, database.id)}`,
        ),
      );
      return { items: stored.rows, total: stored.rows.length };
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
      const fields = pickDeclared(spec, input.fields);
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
      const fields = pickDeclared(spec, input.fields);
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
