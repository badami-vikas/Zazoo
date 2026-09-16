import { TRPCError } from "@trpc/server";
import { join } from "node:path";
import { z } from "zod";
import { LEARNING_AGENT } from "../wiring.js";
import { canonicalizeManifest, canonicalizeJson, findOrganizationDataPaths, normalizeCommonsTags, parseModuleManifest, ModuleManifestValidationError, labelAtSource, type ModuleInstallationRow, type ModuleCapabilityNeed, type ModuleManifest, type CommonsModuleEntry, type CommonsListQuery, type CommonsModuleDetail } from "@bridge/core";
import { COMMONS_BUILT_IN_MODULES, LEARNING_RECOMMENDATION_SKILL_ID, resolveModuleAgentRuntimeId } from "@bridge/module-manifests";
import { assertCommonsEntryContentTrusted } from "../commons-client.js";
import { assertCurrentCommonsAttachment, currentSupportedRelationshipOwner, isSupportedCitedRoleModelInstallation, isSupportedCitedRoleModelManifest, latestApprovedRoleModelRecommendation, moduleManifestHash, organizationGuard, procedure, sha256Content, stageRoleModelRecommendation, t, withPilotOrganizationGuard } from "../router-shared.js";

// ---------------------------------------------------------------------------
// CM0 — Universal Commons registry tRPC surface (egg-commons-feature-roadmap
// §CM0). Wires the CommonsRegistry port (wiring.commonsRegistry, backed by
// HttpCommonsClient → services/commons :4780) as tRPC procedures so the web
// app can browse, fetch, and initiate governed installs from the registry
// without importing HTTP client code directly.
//
// Governance notes:
//  - list/get/getVersion are read queries, no auth guard needed (same policy
//    as every other .query in this router).
//  - installPropose is a mutation, so the authenticated procedure gate applies.
//    It fetches from the registry (PKG-2 verify-on-install via HttpCommonsClient),
//    registers the manifest in the organization module store (state=private), and
//    returns the installationId. The caller then calls `modules.install` for the
//    full governed proposal → pipeline → approval flow — no logic duplication.
//  - publishBuiltins is a mutation → same auth gate. Pushes curated built-in
//    modules to the running Commons service. Idempotent:
//    already-published versions are skipped, not failed.
//  - ALL protected procedures still go through the authentication middleware and
//    withPilotOrganizationGuard (error translation).
// ---------------------------------------------------------------------------
export const commonsRouter = t.router({
  /** Browse the registry — filterable by kind and/or tag, paginated. */
  list: procedure
    .input(
      z.object({
        kind: z.enum(["organization_definition", "skill", "automation", "agent", "module", "view", "integration_bundle"]).optional(),
        tag: z.string().optional(),
        search: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const query: CommonsListQuery = {};
      if (input.kind !== undefined) query.kind = input.kind;
      if (input.tag !== undefined) query.tag = input.tag;
      if (input.search !== undefined) query.search = input.search;
      if (input.limit !== undefined) query.limit = input.limit;
      if (input.offset !== undefined) query.offset = input.offset;
      return ctx.wiring.commonsRegistry.listAvailable(query);
    }),

  /** Module detail (latest + version history) for one module by name. */
  get: procedure
    .input(z.object({ name: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const detail: CommonsModuleDetail | null = await ctx.wiring.commonsRegistry.get(input.name);
      if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: `commons: module "${input.name}" not found` });
      return detail;
    }),

  /** One exact published version's full entry. */
  getVersion: procedure
    .input(z.object({ name: z.string().min(1), version: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const entry = await ctx.wiring.commonsRegistry.getVersion(input.name, input.version);
      if (!entry) {
        throw new TRPCError({ code: "NOT_FOUND", message: `commons: ${input.name}@${input.version} not found` });
      }
      return entry;
    }),

  /**
   * Install-from-Commons Step 1: fetch a module from the registry (PKG-2
   * verify-on-install happens inside HttpCommonsClient.get/getVersion), validate
   * its manifest, and register it in the organization module store as a private
   * installation. Returns the installationId so the caller can then drive the
   * governed install flow via `modules.install(installationId, todayKey)`.
   *
   * Separating fetch+register from install keeps the governed proposal logic
   * inside the existing `modules.install` handler — no duplication.
   */
  installPropose: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        name: z.string().min(1),
        /** Omit to install the latest version. */
        version: z.string().optional(),
        ownerModuleName: z.string().min(1).optional(),
        agentId: z.string().min(1).optional(),
        needId: z.string().min(1).optional(),
      }),
    )
    .use(organizationGuard).mutation(async ({ input, ctx }) => {

      // Fetch from registry — HttpCommonsClient verifies the publisher signature (PKG-2).
      const entry = input.version
        ? await ctx.wiring.commonsRegistry.getVersion(input.name, input.version)
        : await ctx.wiring.commonsRegistry.get(input.name).then((d) => d?.latest ?? null);

      if (!entry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: input.version
            ? `commons: ${input.name}@${input.version} not found`
            : `commons: module "${input.name}" not found`,
        });
      }
      try {
        assertCommonsEntryContentTrusted(entry);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Commons entry failed install-time trust verification",
        });
      }
      // Re-validate the manifest at this seam (same guard modules.register uses).
      let manifest: ModuleManifest;
      try {
        manifest = parseModuleManifest({ module: entry.manifest });
      } catch (err) {
        if (err instanceof ModuleManifestValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `commons manifest invalid: ${err.message}` });
        }
        throw err;
      }
      const privacyPaths = findOrganizationDataPaths(entry.manifest);
      if (privacyPaths.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Commons manifest contains Organization data (${privacyPaths.join(", ")})`,
        });
      }
      const rootModule = manifest.kind === "organization_definition";
      const attachmentFields = [input.ownerModuleName, input.agentId, input.needId];
      if (rootModule) {
        if (!manifest.module) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Organization-definition Module has no installable Module surface" });
        }
        if (attachmentFields.some((value) => value !== undefined)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Root Module installation cannot attach beneath another Module Agent" });
        }
      } else if (
        manifest.kind !== "skill" ||
        manifest.capabilities.length === 0 ||
        manifest.capabilities.some((capability) => capability.capabilityType !== "skill")
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Commons install supports only a signed Organization-definition root Module or a declared Skill need",
        });
      }
      let ownerModule: ModuleInstallationRow | undefined;
      let need: ModuleCapabilityNeed | undefined;
      if (!rootModule) {
        if (attachmentFields.some((value) => value === undefined)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Skill attachment requires ownerModuleName, agentId, and needId" });
        }
        ownerModule = (await ctx.wiring.moduleStore.getAvailable(input.organizationId, input.ownerModuleName!)) ?? undefined;
        if (!ownerModule || ownerModule.status !== "installed" || !ownerModule.manifest.module) {
          throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.ownerModuleName}" not found` });
        }
        need = ownerModule.manifest.module.commonsNeeds?.find((candidate) => candidate.id === input.needId);
        if (!need || need.agentId !== input.agentId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Commons capability need is not owned by the selected Module Agent" });
        }
        if (entry.kind !== need.kind || !need.tags.every((tag) => entry.tags.includes(tag))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Commons module does not satisfy the declared Module need" });
        }
      }
      const commonsTaintLabel = labelAtSource("signed_commons_import", {
        ref: `${entry.name}@${entry.version}`,
        valueHash: entry.integrity.value,
        sensitivity: "public",
        instructionRisk: "data",
      });
      const commonsSource = {
        contentHash: entry.integrity.value,
        manifestHash: sha256Content(canonicalizeManifest(manifest)),
        entry,
        taintLabel: commonsTaintLabel,
      };

      const verifiedDependencyPins = new Map<string, string>();
      const staged = new Set<string>();
      const stageDependencies = async (parentEntry: CommonsModuleEntry): Promise<void> => {
        const parentPins = new Map<string, string>(
          (parentEntry.securityScan.dependencyPins ?? []).map(
            (pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const,
          ),
        );
        for (const dependency of parentEntry.manifest.dependencies) {
          const key = `${dependency.manifestId}@${dependency.version}`;
          const expectedHash = parentPins.get(key);
          const priorHash = verifiedDependencyPins.get(key);
          if (priorHash && priorHash !== expectedHash) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Commons dependency "${key}" has conflicting signed content-hash pins`,
            });
          }
          if (staged.has(key)) continue;
          staged.add(key);
          const dependencyEntry = await ctx.wiring.commonsRegistry.getVersion(
            dependency.manifestId,
            dependency.version,
          );
          if (!dependencyEntry || !expectedHash || dependencyEntry.integrity.value !== expectedHash) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Commons dependency "${key}" does not match its signed content-hash pin`,
            });
          }
          verifiedDependencyPins.set(key, expectedHash);
          try {
            assertCommonsEntryContentTrusted(dependencyEntry);
          } catch (err) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: err instanceof Error ? err.message : `Commons dependency "${key}" failed trust verification`,
            });
          }
          const dependencyManifest = parseModuleManifest({ module: dependencyEntry.manifest });
          const dependencyTaintLabel = labelAtSource(
            "signed_commons_import",
            {
              ref: key,
              valueHash: dependencyEntry.integrity.value,
              sensitivity: "public",
              instructionRisk: "data",
            },
          );
          const dependencyPrivacyPaths = findOrganizationDataPaths(dependencyEntry.manifest);
          if (dependencyPrivacyPaths.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Commons dependency "${key}" contains Organization data`,
            });
          }
          await ctx.wiring.moduleStore.create({
            organizationId: input.organizationId,
            moduleName: dependencyManifest.name,
            moduleVersion: dependencyManifest.version,
            manifest: dependencyManifest,
            computedRisk: dependencyEntry.securityScan.riskBand,
            state: "private",
            status: "pending_review",
            lineageManifestId: dependencyManifest.lineageManifestId,
            ...(rootModule
              ? {
                  commonsSource: {
                    contentHash: dependencyEntry.integrity.value,
                    manifestHash: sha256Content(canonicalizeManifest(dependencyManifest)),
                    entry: dependencyEntry,
                    taintLabel: dependencyTaintLabel,
                  },
                }
              : {
                  moduleAttachment: {
                    source: "commons" as const,
                    ownerModuleName: ownerModule!.moduleName,
                    agentId: input.agentId!,
                    needId: input.needId!,
                    contentHash: dependencyEntry.integrity.value,
                    taintLabel: dependencyTaintLabel,
                  },
                }),
          });
          await stageDependencies(dependencyEntry);
        }
      };
      await stageDependencies(entry);

      if (rootModule) {
        const existing = (await ctx.wiring.moduleStore.listVersions(input.organizationId, manifest.name))
          .find((candidate) => candidate.moduleVersion === manifest.version && !candidate.moduleAttachment);
        if (existing) {
          if (canonicalizeManifest(existing.manifest) !== canonicalizeManifest(manifest)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Existing root Module version has different immutable normalized content",
            });
          }
          const reconciled = await ctx.wiring.moduleStore.setCommonsSource(existing.id, commonsSource);
          return { installation: reconciled };
        }
      }

      // Register as a private installation — same as modules.register, but the
      // manifest source is the verified Commons entry, not a user-supplied object.
      const created = await ctx.wiring.moduleStore.create({
        organizationId: input.organizationId,
        moduleName: manifest.name,
        moduleVersion: manifest.version,
        manifest,
        computedRisk: entry.securityScan.riskBand,
        state: "private",
        status: "pending_review",
        lineageManifestId: manifest.lineageManifestId,
        ...(rootModule
          ? { commonsSource }
          : {
              moduleAttachment: {
                source: "commons" as const,
                ownerModuleName: ownerModule!.moduleName,
                agentId: input.agentId!,
                needId: input.needId!,
                contentHash: entry.integrity.value,
                taintLabel: commonsTaintLabel,
              },
            }),
      });

      return { installation: created };
    }),

  runInstalledSkill: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        installationId: z.string().min(1),
      }),
    )
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const installation = await ctx.wiring.moduleStore.get(input.installationId);
      if (!installation || installation.organizationId !== input.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown Commons installation" });
      }
      if (installation.state !== "available" || installation.status !== "installed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Commons capability must be installed and available before it can run",
        });
      }
      const attachment = installation.moduleAttachment;
      const entry = await assertCurrentCommonsAttachment(ctx.wiring, installation);
      if (!attachment || !entry) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "capability is not attached from Commons to a Module Agent",
        });
      }
      if (
        !isSupportedCitedRoleModelInstallation(installation)
        || !isSupportedCitedRoleModelManifest(entry.manifest)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "installed Commons Skill does not match its supported signed runtime contract",
        });
      }
      const ownerModule = await currentSupportedRelationshipOwner(ctx.wiring, installation);
      if (!ownerModule) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "installed Commons Skill does not match its supported owning Module contract",
        });
      }
      const skillCapabilities = entry.manifest.capabilities.filter(
        (capability) => capability.capabilityType === "skill",
      );
      if (
        skillCapabilities.length !== 1 ||
        skillCapabilities[0]?.id !== LEARNING_RECOMMENDATION_SKILL_ID
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "installed Commons Skill has no supported runtime binding",
        });
      }
      const runtimeAgentId = resolveModuleAgentRuntimeId(
        attachment.ownerModuleName,
        attachment.agentId,
      );
      if (runtimeAgentId !== LEARNING_AGENT) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "installed Commons Skill is not bound to its attributable runtime Agent",
        });
      }
      const recommendation = await latestApprovedRoleModelRecommendation(
        ctx.wiring,
        input.organizationId,
        ctx.identity.id,
      );
      if (!recommendation) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Approve a cited role-model onboarding recommendation before running this Skill",
        });
      }
      return stageRoleModelRecommendation(
        ctx.wiring,
        ctx.run,
        ctx.identity.id,
        input.organizationId,
        recommendation,
        {
          source: "commons",
          installationId: installation.id,
          moduleName: entry.name,
          moduleVersion: entry.version,
          contentHash: attachment.contentHash,
          moduleInstallationId: ownerModule.id,
          ownerModuleName: attachment.ownerModuleName,
          ownerModuleVersion: ownerModule.moduleVersion,
          ownerModuleManifestHash: moduleManifestHash(ownerModule.manifest),
          ownerModuleAgentId: attachment.agentId,
          runtimeAgentId,
          capabilityId: LEARNING_RECOMMENDATION_SKILL_ID,
        },
      );
    }),

  /**
   * Publish curated built-in modules to the running
   * Commons service. Idempotent: already-published versions are skipped.
   * This is the runtime equivalent of `pnpm --filter @bridge/api publish-builtins`.
   * Requires authentication (mutation guard) to prevent arbitrary callers from
   * flooding the registry.
   */
  publishBuiltins: procedure.mutation(async ({ ctx }) => {
    const published: string[] = [];
    const skipped: string[] = [];
    const failed: { name: string; reason: string }[] = [];

    for (const { manifest: sourceManifest, commons } of COMMONS_BUILT_IN_MODULES) {
      const manifest = parseModuleManifest({ module: sourceManifest });
      try {
        await ctx.wiring.commonsRegistry.publish(manifest, {
          tags: commons.tags,
          provenance: commons.provenance,
        });
        published.push(`${manifest.name}@${manifest.version}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("already published")) {
          const existing = await ctx.wiring.commonsRegistry.getVersion(manifest.name, manifest.version);
          const expectedIdentity = canonicalizeJson({
            manifest,
            tags: normalizeCommonsTags(commons.tags),
            provenance: commons.provenance,
          });
          const existingIdentity = existing
            ? canonicalizeJson({
                manifest: existing.manifest,
                tags: normalizeCommonsTags(existing.tags),
                provenance: existing.provenance,
              })
            : null;
          if (existingIdentity === expectedIdentity) {
            skipped.push(`${manifest.name}@${manifest.version}`);
          } else {
            failed.push({
              name: manifest.name,
              reason: "published version has different immutable manifest, tags, or provenance",
            });
          }
        } else {
          failed.push({ name: manifest.name, reason: message });
        }
      }
    }

    if (failed.length > 0) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `commons.publishBuiltins: ${failed.length} failure(s) — ${failed.map((f) => `${f.name}: ${f.reason}`).join("; ")}`,
      });
    }

    return { published, skipped };
  }),
});
