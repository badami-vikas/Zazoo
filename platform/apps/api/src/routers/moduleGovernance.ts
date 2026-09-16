import { z } from "zod";
import { MODULE_GOVERNANCE_NAMESPACE_PREFIX, assertHumanIdentity, assertKnownModule, moduleGovernanceRuleInput, procedure, readResolvedModuleGovernance, t } from "../router-shared.js";

export const moduleGovernanceRouter = t.router({
  get: procedure
    .input(z.object({ organizationId: z.string().min(1), moduleName: z.string().trim().min(1) }))
    .query(async ({ input, ctx }) => {
      return readResolvedModuleGovernance(ctx.wiring, input.organizationId, input.moduleName);
    }),

  set: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        moduleName: z.string().trim().min(1),
        allow: z.array(moduleGovernanceRuleInput).max(100),
        deny: z.array(moduleGovernanceRuleInput).max(100),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // A rule an Agent can rewrite is not a boundary. Editing what a Module
      // is allowed to do is a Human decision, like every other authority
      // change in this router.
      assertHumanIdentity(ctx, "Editing a Module's governance policy");
      assertKnownModule(input.moduleName);
      const updatedAt = ctx.run.clock.nowISO();
      await ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${MODULE_GOVERNANCE_NAMESPACE_PREFIX}${input.moduleName}`,
        null,
        () => ({
          state: { allow: input.allow, deny: input.deny, updatedAt },
          result: null,
        }),
      );
      // Re-read rather than echoing the input: the server has the last word on
      // what changed (ADR-247), and the caller sees what enforcement will use.
      return readResolvedModuleGovernance(ctx.wiring, input.organizationId, input.moduleName);
    }),

  reset: procedure
    .input(z.object({ organizationId: z.string().min(1), moduleName: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      assertHumanIdentity(ctx, "Resetting a Module's governance policy");
      await ctx.wiring.localPlane.state.update(
        input.organizationId,
        `${MODULE_GOVERNANCE_NAMESPACE_PREFIX}${input.moduleName}`,
        null,
        () => ({ state: null, result: null }),
      );
      return readResolvedModuleGovernance(ctx.wiring, input.organizationId, input.moduleName);
    }),
});
