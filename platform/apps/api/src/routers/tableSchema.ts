import { TRPCError } from "@trpc/server";
import { join } from "node:path";
import { z } from "zod";
import { assertModuleGovernance, ModuleGovernanceDenied } from "@bridge/core";
import { eq } from "drizzle-orm";
import { schema as accountingSchema, validateExpression } from "@bridge/accounting";
import { TABLE_SCHEMA_NAMESPACE_PREFIX, applyColumnOp, automationDependencies, formulaDependencies, formulaDependentIds, readStoredTableSchema, relationDependencies, skillDependencies, viewDependencies, type ColumnDependencyPreview } from "../table-schema.js";
import { COLUMN_KINDS, assertHumanIdentity, assertMembership, assertPilotOrganization, procedure, readResolvedModuleGovernance, readTableSchemaCapability, t } from "../router-shared.js";

// ── Governed schema mutation (TASK-084, ADR-258 under AP-168) ──────────────
//
// ONE CONTIGUOUS BLOCK on purpose — TASK-086 is editing this file at the same
// time. The rules live in `table-schema.ts`; only the seam is here.
//
// The capability is REPORTED, never assumed. `get` answers `available: false`
// with a reason for a table whose shipped spec this process does not hold, and
// the column menu disables against that answer — which is the whole dependency
// note of TASK-084: a menu item enabled against a capability that is not there
// fails at the server, and ADR-247 forbids claiming what is not true.
export const tableSchemaRouter = t.router({
  get: procedure
    .input(z.object({ organizationId: z.string().min(1), specId: z.string().trim().min(1) }))
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      return readTableSchemaCapability(ctx.wiring, input.organizationId, input.specId);
    }),

  /**
   * What breaks if this column goes. Every source states whether it was
   * INSPECTED — an empty list from a source nobody looked at reads exactly
   * like "nothing breaks", and that is the lie ADR-247 forbids.
   *
   * A read-only question about an identifier, so it does not require the
   * identifier to be a current column: "what depends on this name" is
   * answerable either way, and refusing would make the preview useless for
   * exactly the case a user wants it.
   */
  preview: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        specId: z.string().trim().min(1),
        columnId: z.string().trim().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const capability = await readTableSchemaCapability(
        ctx.wiring,
        input.organizationId,
        input.specId,
      );
      if (!capability.spec) {
        throw new TRPCError({ code: "NOT_FOUND", message: capability.reason ?? input.specId });
      }
      const formulas = await ctx.wiring.accountingDb.select().from(accountingSchema.formulas);
      const preview: ColumnDependencyPreview = {
        specId: input.specId,
        columnId: input.columnId,
        views: viewDependencies(),
        automations: automationDependencies(),
        skills: skillDependencies(capability.spec, input.columnId),
        formulas: formulaDependencies(formulas, input.columnId),
        relations: relationDependencies(capability.spec, input.columnId),
      };
      return preview;
    }),

  mutate: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        specId: z.string().trim().min(1),
        op: z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("rename"),
            columnId: z.string().trim().min(1),
            label: z.string().trim().min(1).max(120),
          }),
          z.object({
            kind: z.literal("setKind"),
            columnId: z.string().trim().min(1),
            columnKind: z.enum(COLUMN_KINDS),
          }),
          z.object({
            kind: z.literal("setLocked"),
            columnId: z.string().trim().min(1),
            locked: z.boolean(),
          }),
          z.object({ kind: z.literal("delete"), columnId: z.string().trim().min(1) }),
        ]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      // A schema an Agent can rewrite is not a schema. Same floor as every
      // other authority change in this router.
      assertHumanIdentity(ctx, "Changing a Database's columns");
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const capability = await readTableSchemaCapability(
        ctx.wiring,
        input.organizationId,
        input.specId,
      );
      if (!capability.spec) {
        throw new TRPCError({ code: "NOT_FOUND", message: capability.reason ?? input.specId });
      }
      // A command against a column that is not there would be stored where
      // nothing reads it, and the user would believe they had changed
      // something. Say so instead.
      if (!capability.spec.columns.some((column) => column.id === input.op.columnId)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${input.specId} has no column ${input.op.columnId}`,
        });
      }
      const updatedAt = ctx.run.clock.nowISO();
      await ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${TABLE_SCHEMA_NAMESPACE_PREFIX}${input.specId}`,
        null,
        (current) => {
          const stored = readStoredTableSchema(current);
          return {
            state: {
              overlay: applyColumnOp(stored.overlay, input.op, updatedAt),
              previous: stored.overlay,
            },
            result: null,
          };
        },
      );
      // Re-read rather than echoing the input: the server has the last word on
      // what changed (ADR-247).
      return readTableSchemaCapability(ctx.wiring, input.organizationId, input.specId);
    }),

  undo: procedure
    .input(z.object({ organizationId: z.string().min(1), specId: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      assertHumanIdentity(ctx, "Undoing a Database schema change");
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      await ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${TABLE_SCHEMA_NAMESPACE_PREFIX}${input.specId}`,
        null,
        (current) => {
          const stored = readStoredTableSchema(current);
          return { state: { overlay: stored.previous ?? {}, previous: null }, result: null };
        },
      );
      return readTableSchemaCapability(ctx.wiring, input.organizationId, input.specId);
    }),

  /**
   * The fx affordance's commit path: edit a formula column's EXPRESSION
   * rather than its value.
   *
   * `validateExpression` (engine.ts) is the seam — the one place an expression
   * is understood — and it runs BEFORE the write, so a bad edit is refused
   * rather than breaking every client's dashboard. Editing a formula is global
   * and retroactive by the Module's own locked decision, which is exactly why
   * it is human-only and governed like `overrides.create`.
   */
  setFormulaExpression: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        formulaId: z.string().trim().min(1),
        expression: z.string().trim().min(1).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      assertHumanIdentity(ctx, "Editing a formula's expression");
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);

      const { resolved } = await readResolvedModuleGovernance(
        ctx.wiring,
        input.organizationId,
        "accounting",
      );
      try {
        assertModuleGovernance("accounting", resolved ?? undefined, "books.write.human");
      } catch (error) {
        if (error instanceof ModuleGovernanceDenied) {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        throw error;
      }

      const stored = await ctx.wiring.accountingDb.select().from(accountingSchema.formulas);
      const target = stored.find((formula) => formula.id === input.formulaId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: `No formula ${input.formulaId}` });
      }
      const accounts = await ctx.wiring.accountingDb.select().from(accountingSchema.accounts);
      const verdict = validateExpression(
        input.expression,
        input.formulaId,
        stored,
        accounts.map((account) => account.id),
      );
      if (!verdict.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: verdict.error ?? `Unknown reference: ${verdict.unknownReferences.join(", ")}`,
        });
      }

      await ctx.wiring.accountingDb
        .update(accountingSchema.formulas)
        .set({
          expression: input.expression,
          version: target.version + 1,
          updatedAt: ctx.run.clock.nowISO(),
        })
        .where(eq(accountingSchema.formulas.id, input.formulaId));

      // What recomputes, derived from the graph the edit produced — never
      // hand-maintained, and named so the caller can refresh exactly those
      // cells instead of claiming "everything is up to date".
      const after = stored.map((formula) =>
        formula.id === input.formulaId ? { ...formula, expression: input.expression } : formula,
      );
      const dependents = formulaDependentIds(after, input.formulaId) ?? [];
      return {
        id: input.formulaId,
        expression: input.expression,
        version: target.version + 1,
        dependencies: verdict.dependencies,
        dependents,
      };
    }),
});
