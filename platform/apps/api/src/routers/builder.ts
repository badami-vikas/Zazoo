import { TRPCError } from "@trpc/server";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { ModuleGovernanceDenied } from "@bridge/core";
import { moduleFilesRoot } from "../module-files.js";
import { runModuleBuilder } from "../builder/run.js";
import { assertHumanIdentity, assertKnownModule, assertMembership, assertPilotOrganization, procedure, readResolvedModuleGovernance, requireOrganizationNameForFiles, resolveChatModel, t } from "../router-shared.js";

/**
 * Module governance overlay (TASK-088) — the write half of ADR-248.
 *
 * `get` returns what the manifest declared, what the user saved, and the
 * resolved policy the engine actually enforces. `set` writes the overlay (and
 * is the only thing in the repo that makes `userEdited` true). `reset` drops
 * it so the declared default comes back — without that, a first edit would be
 * a one-way door out of the Module author's own policy.
 *
 * There is no dummy path: with no overlay stored these return the declared
 * policy, and `null` for a Module that declares none — which the Governance
 * Section renders as an honest empty state. An empty policy is not a
 * default-deny (`governanceVerdict`), and nothing here makes it one.
 */
// ── Builder Runs (TASK-092, BA0) ──────────────────────────────────────────
//
// The seam that makes `runBuilderLoop` + `HostPrimitiveExecutor` reachable.
// Local Plane by residency: the Run reads and writes the user's own Bridge
// folder, so `deployment-boundary` closes the whole `builder.` namespace to
// the public cloud shell.
export const builderRouter = t.router({
  run: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        moduleName: z.string().trim().min(1),
        task: z.string().trim().min(1).max(4_000),
        maxSteps: z.number().int().min(1).max(60).optional(),
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      // A Builder Run writes files and runs commands. Starting one is a
      // Human decision, like every other authority change in this router.
      assertHumanIdentity(ctx, "Starting a Builder Run");
      assertKnownModule(input.moduleName);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);

      const provider =
        resolveChatModel(ctx.wiring, "local") ?? resolveChatModel(ctx.wiring, "cloud");
      if (!provider) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No model provider is configured for the Builder",
        });
      }

      const organizationName = await requireOrganizationNameForFiles(
        ctx.wiring,
        input.organizationId,
        ctx.identity.id,
      );
      const workingDirectory = moduleFilesRoot(
        organizationName,
        input.moduleName,
        ctx.wiring.moduleFilesBridgeRoot,
      );
      await mkdir(workingDirectory, { recursive: true });

      const governance = await readResolvedModuleGovernance(
        ctx.wiring,
        input.organizationId,
        input.moduleName,
      );

      try {
        return await runModuleBuilder({
          wiring: ctx.wiring,
          run: ctx.run,
          organizationId: input.organizationId,
          actorUserId: ctx.identity.id,
          moduleName: input.moduleName,
          governance: governance.resolved,
          workingDirectory,
          task: input.task,
          provider,
          ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
        });
      } catch (error) {
        // Quote the user's own stated reason rather than a generic refusal.
        if (error instanceof ModuleGovernanceDenied) {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        throw error;
      }
    }),
});
