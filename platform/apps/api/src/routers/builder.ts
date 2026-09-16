import { TRPCError } from "@trpc/server";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { ModuleGovernanceDenied } from "@bridge/core";
import { BUILT_IN_MODULES } from "@bridge/module-manifests";
import { moduleFilesRoot } from "../module-files.js";
import { readModuleManifestFile, registerModuleManifest } from "../module-register.js";
import { commonsPriorArt, runModuleBuilder } from "../builder/run.js";

/** What happened to a Run's module.yaml afterwards (ADR 2026-09-04). */
export type BuilderRegistration =
  | { state: "existing" }
  | { state: "not-registered"; reason: string }
  | { state: "invalid"; reason: string }
  | { state: "registered"; installationId: string; status: string };
import { assertHumanIdentity, procedure, readResolvedModuleGovernance, requireOrganizationNameForFiles, resolveChatModel, t } from "../router-shared.js";

/** Same rule the manifest parser enforces for `module.name`. A Module the
 * Builder is about to CREATE has no manifest yet, so the name is all there is
 * to check — and it becomes the folder under the Organization's Bridge files. */
const MODULE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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
      // A Builder Run writes files and runs commands. Starting one is a
      // Human decision, like every other authority change in this router.
      assertHumanIdentity(ctx, "Starting a Builder Run");
      if (!MODULE_NAME.test(input.moduleName)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Module name must be kebab-case" });
      }

      // The Egg ships no Modules (ADR 2026-09-04): a name that is neither a
      // built-in nor an installed row is a Module the Run will CREATE, and
      // creating it is step 1 of the standard build process, not an error.
      const isNewModule =
        !BUILT_IN_MODULES.some((entry) => entry.manifest.name === input.moduleName) &&
        (await ctx.wiring.moduleStore.listVersions(input.organizationId, input.moduleName)).length === 0;

      // Commons is one of the Builder's sources of inspiration: what already
      // exists for this kind of Module, as data. An unreachable registry does
      // not stop the Run.
      const priorArt = await commonsPriorArt(
        ctx.wiring.commonsRegistry,
        input.moduleName,
        input.task,
      );

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
        const receipt = await runModuleBuilder({
          wiring: ctx.wiring,
          run: ctx.run,
          organizationId: input.organizationId,
          actorUserId: ctx.identity.id,
          moduleName: input.moduleName,
          governance: governance.resolved,
          workingDirectory,
          task: input.task,
          provider,
          isNewModule,
          priorArt: priorArt.items,
          priorArtUnavailable: priorArt.unavailable,
          ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
        });

        // A NEW Module whose Run produced module.yaml enters the governed
        // lifecycle right here as a private, pending-review installation —
        // the Builder built it, the human asked for it, and `modules.install`
        // remains the proposal that decides whether it may run. An invalid
        // manifest is reported on the receipt, never thrown away: the Run's
        // files and ledger rows are real whatever the manifest's state.
        let registration: BuilderRegistration = { state: "not-registered", reason: "module.yaml not written" };
        if (isNewModule) {
          try {
            const raw = await readModuleManifestFile(ctx.wiring, organizationName, input.moduleName);
            if (raw !== null) {
              const installation = await registerModuleManifest(ctx.wiring, input.organizationId, raw);
              registration = { state: "registered", installationId: installation.id, status: installation.status };
            }
          } catch (error) {
            registration = {
              state: "invalid",
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        } else {
          registration = { state: "existing" };
        }
        return { ...receipt, registration };
      } catch (error) {
        // Quote the user's own stated reason rather than a generic refusal.
        if (error instanceof ModuleGovernanceDenied) {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        throw error;
      }
    }),
});
