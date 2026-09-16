import { TRPCError } from "@trpc/server";
import { resolveAuthorizedAgentRoleTemplate } from "../agent-role-templates.js";
import type { DataScope, EgressTier } from "@bridge/core";
import { buildAgentCapability } from "@bridge/core";
import { agentCreateInput, agentUpdateInput, assertMembership, assertPilotOrganization, procedure, t } from "../router-shared.js";

/** Agent governance — create/update an agent from SERVER-OWNED role templates only.
 * Escalating capability (external:send, governance, full-graph, '*') is still
 * stripped at the seam as defense in depth; agents can never be created able to
 * send or approve, nor may callers name arbitrary capability or skill bundles. */
export const agentRouter = t.router({
  create: procedure.input(agentCreateInput).mutation(async ({ input, ctx }) => {
    // TASK-011 remediation (2026-07-18 coordinator final review, issue 5) —
    // membership/authority checks apply to agent creation like every other
    // organization-scoped mutation; a caller may not mint an Agent into a
    // organization they don't belong to.
    const mem = ctx.wiring.memory;
    if (!mem) throw new Error("agent.create: in-memory governance store required (persistent agent CRUD pending)");
    const template = resolveAuthorizedAgentRoleTemplate(input.organizationId, input.roleTemplateId);
    if (!template) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `unknown or unauthorized agent role template "${input.roleTemplateId}" for this organization`,
      });
    }
    const built = buildAgentCapability({
      capabilityScope: [...template.capabilityScope],
      egressTier: template.egressTier as EgressTier,
    });
    const agentId = ctx.run.ids.next();
    mem.roles.roleGrants.set(template.roleId, [...template.roleGrants]);
    mem.agents.scope.set(agentId, built.scope);
    mem.agents.tiers.set(agentId, template.dataScope as DataScope);
    mem.agents.skills.set(agentId, [...template.allowedSkills]);
    mem.agents.assumed.set(agentId, template.roleId);
    // TASK-011 remediation (2026-07-18 final review, issue 5) — `AgentQuery`
    // now requires `organizationId`/`isActive` (added alongside relationship-
    // module trust boundaries; `InMemoryAgentStore`'s own implementation is
    // fail-closed: unset = unknown organization / inactive). Before this fix,
    // an agent created here was PERMANENTLY unusable — it could never pass
    // the AGS1 organization-match check, nor any "must be active" gate — a
    // silent, total break of `agent.create`'s own contract. A freshly
    // created agent is bound to the organization it was created in and made
    // active immediately (this endpoint IS the explicit, governed creation
    // act — there is no separate "activate" step for API-created agents
    // elsewhere in this codebase); unknown/paused/retired agents remain
    // fail-closed exactly as before.
    mem.agents.organizations.set(agentId, input.organizationId);
    mem.agents.statuses.set(agentId, "active");
    return {
      agentId,
      name: input.name,
      roleTemplateId: template.id,
      scope: built.scope,
      allowedSkills: [...template.allowedSkills],
      dropped: built.dropped, // escalating tokens we refused to grant (shown in UI)
      dataScope: template.dataScope,
      egressTier: template.egressTier,
      // Non-removable, always-true facts about an in-platform agent:
      floor: { canSend: false, canApprove: false },
    };
  }),

  update: procedure.input(agentUpdateInput).mutation(async ({ input, ctx }) => {
    const mem = ctx.wiring.memory;
    if (!mem) throw new Error("agent.update: in-memory governance store required (persistent agent CRUD pending)");
    if (!mem.agents.scope.has(input.agentId)) throw new Error(`agent.update: unknown agent ${input.agentId}`);
    const organizationId = await ctx.wiring.agents.organizationId(input.agentId);
    if (!organizationId) throw new Error(`agent.update: agent ${input.agentId} has no organization binding`);
    assertPilotOrganization(organizationId);
    await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
    let dropped: string[] = [];
    let roleTemplateId: string | undefined;
    let allowedSkills = mem.agents.skills.get(input.agentId) ?? [];
    let egressTier: EgressTier | undefined;
    if (input.roleTemplateId !== undefined) {
      const template = resolveAuthorizedAgentRoleTemplate(organizationId, input.roleTemplateId);
      if (!template) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `unknown or unauthorized agent role template "${input.roleTemplateId}" for this organization`,
        });
      }
      const built = buildAgentCapability({
        capabilityScope: [...template.capabilityScope],
        egressTier: template.egressTier as EgressTier,
      });
      mem.roles.roleGrants.set(template.roleId, [...template.roleGrants]);
      mem.agents.assumed.set(input.agentId, template.roleId);
      mem.agents.scope.set(input.agentId, built.scope);
      mem.agents.tiers.set(input.agentId, template.dataScope as DataScope);
      mem.agents.skills.set(input.agentId, [...template.allowedSkills]);
      dropped = built.dropped;
      roleTemplateId = template.id;
      allowedSkills = [...template.allowedSkills];
      egressTier = template.egressTier as EgressTier;
    }
    return {
      agentId: input.agentId,
      ...(roleTemplateId ? { roleTemplateId } : {}),
      scope: mem.agents.scope.get(input.agentId) ?? [],
      allowedSkills,
      dropped,
      dataScope: mem.agents.tiers.get(input.agentId) ?? "all",
      ...(egressTier ? { egressTier } : {}),
      floor: { canSend: false, canApprove: false },
    };
  }),
});
