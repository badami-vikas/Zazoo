import { TRPCError } from "@trpc/server";
import { type Action, type DataScope, type ResourceType, validateAutomationWithinAgents } from "@bridge/core";
import { isModuleRuntimeAutomationId, resolveModuleAgentRuntimeId, resolveModuleAutomationRuntimeId } from "../built-in-modules.js";
import { t, procedure, resolveClientOnBehalfOf, automationRunByIdInput, automationCreateInput, withHumanInputTaint } from "../router-shared.js";

export const automationRouter = t.router({
  /** Create an Automation only when every Skill step fits its owning Agent. */
  create: procedure.input(automationCreateInput).mutation(async ({ input, ctx }) => {
    const [agentOrganizationId, agentActive, agentScope, agentDataScope] =
      await Promise.all([
        ctx.wiring.agents.organizationId(input.agentId),
        ctx.wiring.agents.isActive(input.agentId),
        ctx.wiring.agents.capabilityScope(input.agentId),
        ctx.wiring.agents.dataScope(input.agentId),
      ]);
    if (agentOrganizationId !== input.organizationId || !agentActive) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Automation owner must be an active Agent in the Organization",
      });
    }
    const agentView = {
      id: input.agentId,
      scope: agentScope,
      dataScope: agentDataScope,
    };
    const violations = validateAutomationWithinAgents(
      input.steps.map((s) => ({
        action: s.action as Action,
        resourceType: s.resourceType as ResourceType,
        ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
      })),
      [agentView],
    );
    if (violations.length > 0) {
      return { ok: false as const, violations, reason: "Automation exceeds its owning Agent's authority" };
    }
    const automationId = ctx.run.ids.next();
    await ctx.wiring.automationRegistry.save({
      id: automationId,
      name: input.name,
      organizationId: input.organizationId,
      agentId: input.agentId,
      agentPlane: "local",
      steps: input.steps.map((s) => ({
        skill: s.skill,
        action: s.action as Action,
        resourceType: s.resourceType as ResourceType,
        ...(s.resourceId ? { resourceId: s.resourceId } : {}),
        ...(s.inputs !== undefined ? { inputs: s.inputs as Record<string, unknown> } : {}),
        ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
        ...(s.goalTaskRef ? { goalTaskRef: s.goalTaskRef } : {}),
      })),
    });
    return { ok: true as const, automationId, agentId: input.agentId };
  }),

  /** Start the stored owning Agent's Run; callers cannot provide an actor or steps. */
  runById: procedure.input(automationRunByIdInput).mutation(async ({ input, ctx }) => {
    const onBehalfOf = resolveClientOnBehalfOf(ctx.identity, input.onBehalfOf);
    if (isModuleRuntimeAutomationId(input.automationId)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Module Automations must run through their manifest key and Module binding",
      });
    }
    let automationId = input.automationId;
    if (input.moduleName) {
      const moduleInstallation = await ctx.wiring.moduleStore.getAvailable(
        input.organizationId,
        input.moduleName,
      );
      const automation = moduleInstallation?.manifest.module?.automations.find(
        (candidate) => candidate.automationId === input.automationId,
      );
      const runtimeAgentId = automation
        ? resolveModuleAgentRuntimeId(input.moduleName, automation.agentId)
        : undefined;
      const runtimeAutomationId = resolveModuleAutomationRuntimeId(input.moduleName, input.automationId);
      const definition = runtimeAutomationId
        ? await ctx.wiring.automationRegistry.load(input.organizationId, runtimeAutomationId)
        : null;
      if (!automation || !runtimeAgentId || !runtimeAutomationId || definition?.agentId !== runtimeAgentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Module Automation has no verified runtime binding",
        });
      }
      automationId = runtimeAutomationId;
    }
    return ctx.wiring.automationExecutor.runById(
      {
        organizationId: input.organizationId,
        automationId,
        ...(onBehalfOf ? { onBehalfOf } : {}),
        ...(input.params ? { params: input.params } : {}),
        ...(input.seed ? { seed: input.seed } : {}),
      },
      withHumanInputTaint(
        ctx.run,
        `automation:${automationId}:${ctx.identity.id}`,
        input.params ?? {},
      ),
    );
  }),
});
