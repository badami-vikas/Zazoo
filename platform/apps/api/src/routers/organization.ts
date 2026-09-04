import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { UnknownOrganizationError, OrganizationRenameRollbackError, databaseUuidSchema } from "@bridge/db";
import { PILOT_ORGANIZATION } from "../wiring.js";
import { compileBlueprint, BlueprintCompileError } from "@bridge/core";
import { ModuleFilesPathError, OrganizationFilesConflictError, OrganizationFilesRecoveryError } from "../module-files.js";
import { BLUEPRINT_NODE_TYPE_REGISTRY, BLUEPRINT_RELATIONSHIP_NODE_TYPES, assertPilotOrganization, authenticatedProcedure, organizationBlueprintInput, organizationGuard, procedure, t, toOrganizationBlueprint } from "../router-shared.js";

const blueprintGetByIdInput = z.object({
  organizationId: databaseUuidSchema,
  definitionId: databaseUuidSchema,
});

const blueprintGetInput = z.object({ organizationId: databaseUuidSchema });

const blueprintProposeInput = z.object({
  organizationId: databaseUuidSchema,
  blueprint: organizationBlueprintInput,
});

const blueprintActivateInput = z.object({
  organizationId: databaseUuidSchema,
  definitionId: databaseUuidSchema,
});

export const organizationRouter = t.router({
  activateSession: authenticatedProcedure.mutation(async ({ ctx }) => {
    if (ctx.identity.id !== ctx.wiring.pilotUserId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This Supabase account is not approved for the pilot Organization",
      });
    }
    await ctx.wiring.organizationStore.ensureMember({
      organizationId: PILOT_ORGANIZATION,
      userId: ctx.identity.id,
      userEmail: ctx.wiring.pilotUserEmail,
    });
    return {
      organizationId: PILOT_ORGANIZATION,
      userId: ctx.identity.id,
    };
  }),

  create: procedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      return ctx.wiring.organizationStore.createOrganization(input.name, ctx.identity.id);
    }),

  list: procedure.query(async ({ ctx }) => {
    return ctx.wiring.organizationStore.listOrganizations(ctx.identity.id);
  }),

  rename: procedure
    .input(z.object({ organizationId: z.string().min(1), name: z.string().trim().min(1).max(120) }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      try {
        return await ctx.wiring.organizationStore.renameOrganization(
          input.organizationId,
          input.name,
        );
      } catch (error) {
        if (error instanceof ModuleFilesPathError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        if (error instanceof OrganizationFilesConflictError) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Rename or merge the existing Organization Files directory first",
            cause: error,
          });
        }
        if (error instanceof OrganizationFilesRecoveryError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
        }
        if (error instanceof OrganizationRenameRollbackError) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Organization rename failed and its Files directory could not be restored",
            cause: error,
          });
        }
        if (error instanceof UnknownOrganizationError) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown Organization", cause: error });
        }
        throw error;
      }
    }),

  inviteMember: procedure
    .input(z.object({ organizationId: z.string().min(1), email: z.string().email() }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      return ctx.wiring.organizationStore.inviteMember(input.organizationId, input.email);
    }),

  listMembers: procedure
    .input(z.object({ organizationId: z.string().min(1) }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      return ctx.wiring.organizationStore.listMembers(input.organizationId);
    }),

  /**
   * P1 Organization Generator (docs/wiki/vision.md "View grammar" + roadmap.md
   * P1): the blueprint -> view grammar compiler's governed surface. `get`
   * returns the current active organization_definition (or null — no demo/dummy
   * fallback: an un-onboarded organization honestly has none yet). `propose`
   * always writes a DRAFT row (mirrors capability.register's "generation
   * only ever creates draft" — the Capability Lifecycle Platform's core
   * principle: everything is proposed, governed, continuously evolved).
   * `activate` is the governed step: it round-trips through the SAME
   * pipeline propose/decide semantics `capability.approve` uses, so a human
   * decision (never an agent, agent-floor applies unchanged) resolves it and
   * the attempt is audited either way; on approval it bumps the version and
   * archives the prior active row in the same operation (the one place
   * "only one active row" is enforced).
   */
  blueprint: t.router({
    get: procedure.input(blueprintGetInput).use(organizationGuard).query(async ({ input, ctx }) => {
      const active = await ctx.wiring.organizationDefinitionStore.getActive(input.organizationId);
      return { definition: active };
    }),

    /**
     * getById (ADR-023/ADR-024): returns a organization_definition by id
     * REGARDLESS of status (draft/active/archived) — `get` above only ever
     * returns the currently-active row, so a draft that hasn't been
     * activated yet (the common ApprovalsPage diff-preview case) was
     * previously unreachable. Identity-scoped like every sibling endpoint:
     * the row's own `organizationId` must match the caller-supplied
     * `organizationId`, so a definitionId from another organization 404s rather
     * than leaking cross-organization data.
     */
    getById: procedure.input(blueprintGetByIdInput).use(organizationGuard).query(async ({ input, ctx }) => {
      const definition = await ctx.wiring.organizationDefinitionStore.get(input.definitionId);
      if (!definition || definition.organizationId !== input.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown organization_definition" });
      }
      return { definition };
    }),

    /** Always creates a DRAFT organization_definition — never activates it. The
     * blueprint is validated against the grammar (compileBlueprint) BEFORE
     * being persisted, so an invalid draft is rejected here rather than
     * silently stored and only failing later at activation/render time. */
    propose: procedure.input(blueprintProposeInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const blueprint = toOrganizationBlueprint(input.blueprint);
      try {
        compileBlueprint(blueprint, BLUEPRINT_NODE_TYPE_REGISTRY, BLUEPRINT_RELATIONSHIP_NODE_TYPES);
      } catch (err) {
        if (err instanceof BlueprintCompileError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }

      const priorDrafts = await ctx.wiring.organizationDefinitionStore.listDrafts(input.organizationId);
      const active = await ctx.wiring.organizationDefinitionStore.getActive(input.organizationId);
      const nextVersion = 1 + Math.max(active?.version ?? 0, ...priorDrafts.map((d) => d.version), 0);

      const id = ctx.run.ids.next();
      const created = await ctx.wiring.organizationDefinitionStore.create({
        id,
        organizationId: input.organizationId,
        blueprint,
        version: nextVersion,
        status: "draft",
        createdBy: ctx.identity.type === "user" ? ctx.identity.id : null,
      });
      return { definition: created };
    }),

    /**
     * Activate a draft: proposes the activation through the governed
     * pipeline (same round trip capability.approve makes) so an agent can
     * never resolve it and every attempt is ledgered, whether it ends up
     * auto-resolved or parked pending_review. On resolution, flips the draft
     * to `active` and archives whatever was previously active — the only
     * place two rows are ever active for the same organization at once is
     * disallowed.
     */
    activate: procedure.input(blueprintActivateInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const draft = await ctx.wiring.organizationDefinitionStore.get(input.definitionId);
      if (!draft || draft.organizationId !== input.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown organization_definition draft" });
      }
      if (draft.status !== "draft") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `organization_definition ${draft.id} is "${draft.status}", not "draft"` });
      }

      const proposal = await ctx.wiring.pipeline.propose(
        {
          organizationId: input.organizationId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "approve",
          resourceType: "organization_definition",
          resourceId: input.definitionId,
          inputs: { definitionId: input.definitionId, fromStatus: draft.status },
          skill: "stageMutation",
        },
        ctx.run,
      );
      if (proposal.status === "pending_review") {
        return { activated: false, proposal, definition: draft };
      }
      // Hard-stop mirroring capability.approve above: only an authority-granted,
      // auto-applied decision may archive the prior active definition and
      // activate the draft. A `"rejected"` decision (authority denied, or the
      // agent-floor blocked it) must never reach the mutation below.
      if (proposal.status !== "applied") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: proposal.rejectionReason ?? "approval was not authorized",
        });
      }

      const priorActive = await ctx.wiring.organizationDefinitionStore.getActive(input.organizationId);
      if (priorActive) {
        await ctx.wiring.organizationDefinitionStore.setStatus(priorActive.id, "archived");
      }
      const activated = await ctx.wiring.organizationDefinitionStore.setStatus(draft.id, "active");
      return { activated: true, proposal, definition: activated };
    }),
  }),
});
