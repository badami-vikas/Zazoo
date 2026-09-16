import { TRPCError } from "@trpc/server";
import { join } from "node:path";
import { z } from "zod";
import { assertModuleGovernance, ModuleGovernanceDenied } from "@bridge/core";
import { eq } from "drizzle-orm";
import { schema as accountingSchema, validateExpression } from "@bridge/accounting";
import { TABLE_SCHEMA_NAMESPACE_PREFIX, applyColumnOp, automationDependencies, formulaDependencies, formulaDependentIds, readStoredTableSchema, relationDependencies, skillDependencies, viewDependencies, type ColumnDependencyPreview } from "../table-schema.js";
import { CHOICE_KINDS, COLUMN_KINDS, assertHumanIdentity, procedure, readResolvedModuleGovernance, readTableSchemaCapability, t } from "../router-shared.js";

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
            /** The choices the column offers AFTER the retype (TASK-112).
             * Retyping to `select`/`status`/`multiselect` without them left a
             * chooser over nothing — a control that cannot be honoured. */
            options: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
          }),
          z.object({
            kind: z.literal("setLocked"),
            columnId: z.string().trim().min(1),
            locked: z.boolean(),
          }),
          z.object({ kind: z.literal("delete"), columnId: z.string().trim().min(1) }),
          z.object({
            kind: z.literal("add"),
            // An id is a field NAME — it addresses a value in a stored Record
            // and reaches the client as an object key. Bounding it to this
            // alphabet at the edge is what keeps a Record document from
            // gaining a "__proto__" or a "constructor" field.
            columnId: z
              .string()
              .trim()
              .regex(
                /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/,
                "A column id starts with a letter and holds only letters, digits and underscores",
              ),
            label: z.string().trim().min(1).max(120),
            columnKind: z.enum(COLUMN_KINDS),
            /** The choices a `select`/`status`/`multiselect` column offers
             * (TASK-108). Without them an added choice column rendered a
             * chooser over nothing — a control that cannot be honoured. */
            options: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
            /** Where it lands. Omitted, the column goes to the end — which is
             * what "Add column" in the toolbar means; the column menu's own
             * left/right items name the column they were opened on. */
            position: z
              .object({
                relativeTo: z.string().trim().min(1),
                side: z.enum(["left", "right"]),
              })
              .optional(),
          }),
        ]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // A schema an Agent can rewrite is not a schema. Same floor as every
      // other authority change in this router.
      assertHumanIdentity(ctx, "Changing a Database's columns");
      const capability = await readTableSchemaCapability(
        ctx.wiring,
        input.organizationId,
        input.specId,
      );
      if (!capability.spec) {
        throw new TRPCError({ code: "NOT_FOUND", message: capability.reason ?? input.specId });
      }
      const present = capability.spec.columns.some((column) => column.id === input.op.columnId);
      // Options belong to a column that HAS options. Storing them on a text
      // column would be an overlay entry nothing could ever read. Same rule on
      // both ops that carry a kind — `add` and `setKind`.
      if (
        (input.op.kind === "add" || input.op.kind === "setKind") &&
        input.op.options?.length &&
        !CHOICE_KINDS.includes(input.op.columnKind)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A ${input.op.columnKind} column has no options to choose from`,
        });
      }
      if (input.op.kind === "add") {
        // Adding is the one command that depends on the ROW STORE, not just on
        // the spec: a Database whose rows are sqlite columns has nowhere to
        // put a new one, and the capability says so rather than storing an
        // overlay column that could never hold a value (ADR-247).
        if (!capability.canAddColumn) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: capability.addReason ?? `${input.specId} cannot gain a column`,
          });
        }
        // A duplicate would render twice and write to one cell.
        if (present) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `${input.specId} already has a column ${input.op.columnId}`,
          });
        }
      } else if (!present) {
        // A command against a column that is not there would be stored where
        // nothing reads it, and the user would believe they had changed
        // something. Say so instead.
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
      assertHumanIdentity(ctx, "Undoing a Database schema change");
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
      assertHumanIdentity(ctx, "Editing a formula's expression");

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
