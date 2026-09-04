import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertModuleGovernance, ModuleGovernanceDenied } from "@bridge/core";
import { desc } from "drizzle-orm";
import { schema as accountingSchema } from "@bridge/accounting";
import { ACCOUNTING_CLIENTS_SPEC, ACCOUNTING_REPORTS_SPEC, assertPilotOrganization, procedure, readResolvedModuleGovernance, t } from "../router-shared.js";

/**
 * Accounting — wires the imported `@bridge/accounting` domain layer
 * (ADR-246) to its own sqlite (`accounting-store.ts`) for the
 * first time. TASK-074: minimum viable is a real Clients Page and a real
 * Reports Page, both against `ctx.wiring.accountingDb` — not full P&L/
 * formula-engine parity (that stays out of scope for this pass).
 *
 * `overrides.create` is TASK-072's governed call site: a model-originated
 * write is refused by the manifest's own seeded `books.write.model` deny
 * rule (ADR-248), proving governance is enforced, not just displayed.
 */
export const accountingRouter = t.router({
  clientsDefinition: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(({ input }) => {
      assertPilotOrganization(input.organizationId);
      return ACCOUNTING_CLIENTS_SPEC;
    }),

  clientsList: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const items = await ctx.wiring.accountingDb
        .select()
        .from(accountingSchema.clients)
        .orderBy(desc(accountingSchema.clients.updatedAt));
      return { items, total: items.length };
    }),

  reportsDefinition: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(({ input }) => {
      assertPilotOrganization(input.organizationId);
      return ACCOUNTING_REPORTS_SPEC;
    }),

  /** Real data: the versioned formula registry (`seedReferenceData` in
   * accounting-store.ts) — reference data, not a fabricated client figure. */
  reportsList: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const items = await ctx.wiring.accountingDb
        .select()
        .from(accountingSchema.formulas)
        .orderBy(accountingSchema.formulas.sortOrder);
      return { items, total: items.length };
    }),

  overrides: t.router({
    /** TASK-072's real governed call site. `actor.type: "model"` hits the
     * manifest's seeded `books.write.model` deny rule and throws; `"human"`
     * succeeds. The client id must already exist — no synthetic rows are
     * created to make this call succeed. */
    create: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          clientId: z.string().min(1),
          period: z.string().min(1),
          targetKind: z.enum(["account", "metric"]),
          targetId: z.string().min(1),
          value: z.number(),
          reason: z.string().optional(),
          actor: z.object({ type: z.enum(["human", "model"]), id: z.string().min(1) }),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const action = input.actor.type === "model" ? "books.write.model" : "books.write.human";
        // TASK-088: enforce against the RESOLVED policy — the user's overlay
        // if they wrote one, otherwise the manifest's seeded default. Reading
        // the manifest directly here would make the Governance editor a
        // display that changes nothing.
        const { resolved } = await readResolvedModuleGovernance(
          ctx.wiring,
          input.organizationId,
          "accounting",
        );
        try {
          assertModuleGovernance("accounting", resolved ?? undefined, action);
        } catch (error) {
          if (error instanceof ModuleGovernanceDenied) {
            throw new TRPCError({ code: "FORBIDDEN", message: error.message });
          }
          throw error;
        }
        const row = {
          id: randomUUID(),
          clientId: input.clientId,
          period: input.period,
          targetKind: input.targetKind,
          targetId: input.targetId,
          value: input.value,
          author: input.actor.id,
          ...(input.reason ? { reason: input.reason } : {}),
        };
        await ctx.wiring.accountingDb.insert(accountingSchema.overrides).values(row);
        return row;
      }),
  }),
});
