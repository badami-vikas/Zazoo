import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { parseAuthoredColumns } from "@bridge/core";
import { t, procedure, requireAuthoredDatabase, validateAuthoredRecordInput } from "../router-shared.js";

/**
 * P2 Capability modules (docs/raw/capability-module-format.md, ADR-018) —
 * the shipping unit ABOVE one capability_manifests row. Mirrors the
 * `capability` router's shape one level up: `register` always creates a
 * `private`-state installation row (generation != activation, same
 * invariant); `install` is the governed step — computes risk over the FULL
 * bundled+dependency closure (computeModuleRisk), applies the lethal-
 * trifecta union check, then routes through the SAME pipeline
 * propose/decide semantics `capability.approve`/`organization.blueprint.activate`
 * use (external band = same non-removable hard floor). `promote`/`rollback`
 * enforce single-live-version-per-organization (packages/core/src/module/
 * lifecycle.ts) — promoting auto-demotes the prior available version;
 * rollback forks a NEW draft from history, never an in-place revert.
 */
/**
 * Databases and Records belonging to Modules the owner authored through
 * Chief of Staff. A built-in Module reads its own table; an authored one has
 * no table of its own, so this is the surface its Pages read and write.
 *
 * Every write re-validates against the columns stored on the APPROVED
 * manifest (`validateAuthoredRecord`). jsonb is not self-checking, so this
 * seam is the only thing standing between a typo and a corrupt Record.
 */
export const authoredModulesRouter = t.router({
  /** The authored Databases of one installed Module, with their columns —
   * what a Page needs to render a table. */
  databases: procedure
    .input(z.object({
      organizationId: z.string().uuid(),
      moduleName: z.string().trim().min(1).max(60),
    }))
    .query(async ({ input, ctx }) => {
      const installation = await ctx.wiring.moduleStore.getAvailable(
        input.organizationId,
        input.moduleName,
      );
      if (!installation || installation.status !== "installed") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `installed Module "${input.moduleName}" not found`,
        });
      }
      const rows = await ctx.wiring.authoredModules.listDatabases(
        input.organizationId,
        input.moduleName,
      );
      return {
        displayName: installation.manifest.module?.displayName ?? installation.moduleName,
        databases: rows.map((row) => ({
          id: row.id,
          databaseId: row.databaseId,
          label: row.label,
          columns: parseAuthoredColumns(row.columns, row.databaseId),
        })),
      };
    }),

  /** One authored Database's Records. An empty Database returns an empty
   * list — an honest empty state, never seeded sample rows. */
  records: procedure
    .input(z.object({
      organizationId: z.string().uuid(),
      moduleName: z.string().trim().min(1).max(60),
      databaseId: z.string().trim().min(1).max(60),
      limit: z.number().int().min(1).max(500).default(200),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const database = await requireAuthoredDatabase(ctx.wiring, input);
      const page = await ctx.wiring.authoredModules.listRecords(
        input.organizationId,
        database.id,
        { limit: input.limit, offset: input.offset },
      );
      return {
        columns: parseAuthoredColumns(database.columns, database.databaseId),
        total: page.total,
        items: page.items.map((row) => ({
          id: row.id,
          properties: row.properties as Record<string, unknown>,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      };
    }),

  createRecord: procedure
    .input(z.object({
      organizationId: z.string().uuid(),
      moduleName: z.string().trim().min(1).max(60),
      databaseId: z.string().trim().min(1).max(60),
      properties: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireAuthoredDatabase(ctx.wiring, input);
      const properties = validateAuthoredRecordInput(database, input.properties);
      const row = await ctx.wiring.authoredModules.createRecord(
        input.organizationId,
        database.id,
        properties,
      );
      return { record: { id: row.id, properties: row.properties as Record<string, unknown> } };
    }),

  updateRecord: procedure
    .input(z.object({
      organizationId: z.string().uuid(),
      moduleName: z.string().trim().min(1).max(60),
      databaseId: z.string().trim().min(1).max(60),
      recordId: z.string().uuid(),
      properties: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireAuthoredDatabase(ctx.wiring, input);
      const properties = validateAuthoredRecordInput(database, input.properties);
      const row = await ctx.wiring.authoredModules.updateRecord(
        input.organizationId,
        input.recordId,
        properties,
      );
      if (!row || row.databaseRowId !== database.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Record not found in this Database" });
      }
      return { record: { id: row.id, properties: row.properties as Record<string, unknown> } };
    }),

  archiveRecord: procedure
    .input(z.object({
      organizationId: z.string().uuid(),
      moduleName: z.string().trim().min(1).max(60),
      databaseId: z.string().trim().min(1).max(60),
      recordId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await requireAuthoredDatabase(ctx.wiring, input);
      const row = await ctx.wiring.authoredModules.archiveRecord(
        input.organizationId,
        input.recordId,
      );
      if (!row || row.databaseRowId !== database.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Record not found in this Database" });
      }
      return { archived: true as const, recordId: row.id };
    }),
});
