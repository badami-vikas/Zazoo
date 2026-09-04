import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { resolveActivationApproval, canonicalizeJson, parseModuleManifest, ModuleManifestValidationError, computeModuleRisk, maxRisk, evaluateSandboxRequirement, isUntrustedOrigin, trustGrantsForOrigin, advanceModuleState, promoteToAvailable, rollbackFromHistory, InvalidModuleTransitionError, type CapabilityManifest, type CapabilityManifestRow, type CapabilityOrigin, type TrustGrantView, type Proposal, type ModuleInstallationRow, type ModuleManifest } from "@bridge/core";
import { LEARNING_RECOMMENDATION_SKILL_ID, resolveModuleAgentRuntimeId, resolveModuleAutomationRuntimeId } from "@bridge/module-manifests";
import { assertCommonsEntryContentTrusted } from "../commons-client.js";
import { listModuleFiles, renameModuleFolder, MAX_MODULE_FILE_BYTES, ModuleFilesPathError, withOrganizationFileOperationLock, saveModuleFile } from "../module-files.js";
import { activateApprovedModuleInstallation, assertCurrentCommonsAttachment, assertMembership, assertPilotOrganization, authenticatedProcedure, currentSupportedRelationshipOwner, findPendingProposalById, isSupportedCitedRoleModelInstallation, isSupportedCitedRoleModelManifest, moduleFolderLabel, moduleIdInput, moduleInstallIdFromProposal, moduleInstallInput, moduleInstallationLedgerResourceId, modulePromoteInput, moduleRegisterInput, moduleRollbackInput, organizationGuard, paginatedInput, procedure, stableModuleInstallProposalId, t, verifiedCommonsDependencyInstallations } from "../router-shared.js";

/**
 * P2 Capability modules (docs/raw/capability-module-format.md, ADR-018) —
 * the shipping unit ABOVE one capability_manifests row. Mirrors the
 * `capability` router's shape one level up: `register` always creates a
 * `private`-state installation row (generation != activation, same
 * invariant); `install` is the governed step — computes risk over the FULL
 * bundled+dependency closure (computeModuleRisk), applies the lethal-
 * trifecta union check, then routes through the SAME pipeline
 * propose/decide semantics `capability.approve`/`organization.blueprint.activate`
 * use (external band = same non-removable hard floor). `promote`/`rollback`
 * enforce single-live-version-per-organization (packages/core/src/module/
 * lifecycle.ts) — promoting auto-demotes the prior available version;
 * rollback forks a NEW draft from history, never an in-place revert.
 */
export const modulesRouter = t.router({
  /** Real local-plane File inventory for one installed Module. */
  files: authenticatedProcedure
    .input(z.object({ organizationId: z.string().min(1), moduleName: z.string().min(1) }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const installation = await ctx.wiring.moduleStore.getAvailable(input.organizationId, input.moduleName);
      if (!installation || installation.status !== "installed") {
        throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.moduleName}" not found` });
      }
      try {
        const inventory = await ctx.wiring.organizationStore.withLockedOrganizationFiles(
          input.organizationId,
          (organization) => listModuleFiles(
            organization.name,
            moduleFolderLabel(installation),
            200,
            ctx.wiring.moduleFilesBridgeRoot,
          ),
        );
        await Promise.all(inventory.items.map((file) =>
          ctx.wiring.graphStore.indexModuleFile({
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            moduleId: installation.id,
            moduleName: installation.moduleName,
            ...file,
          }),
        ));
        return inventory;
      } catch (error) {
        if (error instanceof ModuleFilesPathError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  /**
   * Rename a Module for this Organization, and move its local Files folder
   * with it (TASK-081, the half AP-168 left unmet).
   *
   * The rail already renamed Modules, but only in this browser's
   * localStorage, so `~/Documents/Bridge/<Org>/<label>/` kept the old name
   * and the label the user reads and the folder they open disagreed. The
   * override is stored on EVERY version row of the Module, not on the
   * `available` one, so promote/rollback cannot lose what someone called it.
   *
   * Not routed through propose/decide: this is presentation plus a move of
   * the caller's own directory inside their own Organization, the same
   * authority `addFile` already writes files under. Membership is the gate.
   *
   * `null`, or the manifest's own display name, CLEARS the override rather
   * than storing a redundant copy — so "rename it back" leaves no trace, and
   * the folder moves back to the name the Module shipped with.
   */
  rename: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().min(1),
      moduleName: z.string().min(1),
      displayName: z.string().trim().min(1).max(120).nullable(),
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const installation = await ctx.wiring.moduleStore.getAvailable(input.organizationId, input.moduleName);
      if (!installation || installation.status !== "installed") {
        throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.moduleName}" not found` });
      }
      const previousLabel = moduleFolderLabel(installation);
      const manifestLabel = installation.manifest.module?.displayName ?? installation.moduleName;
      const nextOverride = input.displayName === null || input.displayName === manifestLabel
        ? null
        : input.displayName;
      const nextLabel = nextOverride ?? manifestLabel;
      try {
        const folder = await ctx.wiring.organizationStore.withLockedOrganizationFiles(
          input.organizationId,
          (organization) => withOrganizationFileOperationLock(
            input.organizationId,
            () => renameModuleFolder(
              organization.name,
              previousLabel,
              nextLabel,
              ctx.wiring.moduleFilesBridgeRoot,
            ),
          ),
        );
        await ctx.wiring.moduleStore.setDisplayNameOverride(
          input.organizationId,
          input.moduleName,
          nextOverride,
        );
        return { moduleName: input.moduleName, displayName: nextLabel, previousDisplayName: previousLabel, folder };
      } catch (error) {
        if (error instanceof ModuleFilesPathError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  addFile: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().min(1),
      moduleName: z.string().min(1),
      fileName: z.string().trim().min(1).max(255),
      contentBase64: z.string().max(Math.ceil(MAX_MODULE_FILE_BYTES * 4 / 3) + 4).regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        "File content must be valid base64",
      ),
    }))
    .use(organizationGuard).mutation(async ({ input, ctx }) => {
      const installation = await ctx.wiring.moduleStore.getAvailable(input.organizationId, input.moduleName);
      if (!installation || installation.status !== "installed") {
        throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.moduleName}" not found` });
      }
      const content = Buffer.from(input.contentBase64, "base64");
      if (content.byteLength > MAX_MODULE_FILE_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `File exceeds the ${MAX_MODULE_FILE_BYTES}-byte local File limit`,
        });
      }
      try {
        const file = await ctx.wiring.organizationStore.withLockedOrganizationFiles(
          input.organizationId,
          (organization) => saveModuleFile(
            organization.name,
            moduleFolderLabel(installation),
            input.fileName,
            content,
            ctx.wiring.moduleFilesBridgeRoot,
          ),
        );
        await ctx.wiring.graphStore.indexModuleFile({
          organizationId: input.organizationId,
          ownerUserId: ctx.identity.id,
          moduleId: installation.id,
          moduleName: installation.moduleName,
          ...file,
        });
        return file;
      } catch (error) {
        if (error instanceof ModuleFilesPathError || error instanceof RangeError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  /** Register a module manifest. Always creates state=private, status=
   * pending_review — no risk computed yet (that happens at `install`). */
  register: procedure.input(moduleRegisterInput).use(organizationGuard).mutation(async ({ input, ctx }) => {
    let manifest: ModuleManifest;
    try {
      manifest = parseModuleManifest(input.manifest);
    } catch (err) {
      if (err instanceof ModuleManifestValidationError) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
      }
      throw err;
    }
    const created = await ctx.wiring.moduleStore.create({
      organizationId: input.organizationId,
      moduleName: manifest.name,
      moduleVersion: manifest.version,
      manifest,
      computedRisk: "informational", // not yet computed — install() computes it
      state: "private",
      status: "pending_review",
      lineageManifestId: manifest.lineageManifestId,
    });
    return { installation: created };
  }),

  /**
   * Install = a governed proposal through the EXISTING pipeline, exactly
   * like `capability.approve` (docs/raw/capability-module-format.md §2).
   * Computes risk over the module's own capabilities AND every resolvable
   * module dependency's capabilities, applies the lethal-trifecta union
   * check (private-read + untrusted-ingest + egress ACROSS different bundled
   * capabilities still escalates to `external`), then defers to
   * requiredApproval/resolveActivationApproval via the same pipeline round
   * trip `capability.approve` uses — an agent can never resolve this, and
   * every attempt is audited whether auto-resolved or parked pending_review.
   */
  install: procedure.input(moduleInstallInput).use(organizationGuard).mutation(async ({ input, ctx }) => {
    const installation = await ctx.wiring.moduleStore.get(input.installationId);
    if (!installation || installation.organizationId !== input.organizationId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "unknown module installation" });
    }
    if (installation.state !== "private") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `module installation must be private before install, got ${installation.state}`,
      });
    }
    const currentCommonsEntry = await assertCurrentCommonsAttachment(ctx.wiring, installation);

    // PKG-1 sandbox floor (Month-6): an executable capability may only install
    // when its declared isolation satisfies the sandbox gate — no
    // `isolation: "none"`, and any capability whose sandbox grants network/
    // filesystem needs a real container/VM boundary (process isolation is not
    // a boundary). A half-declared executable is rejected here rather than
    // reaching Active unsandboxed. Declarative capabilities pass trivially.
    for (const cap of installation.manifest.capabilities) {
      const sandbox = evaluateSandboxRequirement(cap);
      if (!sandbox.satisfied) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `capability "${cap.name}" cannot be installed: ${sandbox.reason} (declared isolation "${sandbox.isolation}")`,
        });
      }
    }

    // Resolve capability dependencies (by manifestId, ignoring versionRange —
    // capability-level dependency resolution is unversioned in the existing
    // capability.register path too) via the organization's registered capability
    // manifests, and module dependencies via other installations of this
    // organization's module store (name+version exact match, per the no-ranges rule).
    const capDepRows = new Map<string, CapabilityManifestRow>();
    const bundledCapabilities = new Map<string, CapabilityManifest>();
    for (const capability of installation.manifest.capabilities) {
      bundledCapabilities.set(capability.id, capability);
      bundledCapabilities.set(capability.name, capability);
    }
    for (const cap of installation.manifest.capabilities) {
      for (const dep of cap.dependencies) {
        if (bundledCapabilities.has(dep.manifestId)) continue;
        if (!z.string().uuid().safeParse(dep.manifestId).success) continue;
        const row = await ctx.wiring.capabilityStore.getManifest(dep.manifestId);
        if (row) capDepRows.set(dep.manifestId, row);
      }
    }
    const resolveCapabilityDependency = (id: string): CapabilityManifest | undefined => {
      const bundled = bundledCapabilities.get(id);
      if (bundled) return bundled;
      const row = capDepRows.get(id);
      if (!row) return undefined;
      return {
        id: row.id,
        name: row.name,
        version: row.version,
        capabilityType: row.capabilityType,
        origin: row.origin,
        audience: row.audience,
        permissions: (row.manifest as { permissions?: CapabilityManifest["permissions"] } | null)?.permissions ?? [],
        connectors: (row.manifest as { connectors?: CapabilityManifest["connectors"] } | null)?.connectors ?? [],
        dependencies: row.dependencies,
      };
    };
    const { items: allInstallations } = await ctx.wiring.moduleStore.list(input.organizationId, { limit: 10000, offset: 0 });
    const verifiedCommonsDependencies = new Map<string, ModuleManifest>();
    const verifiedDependencyInstallations = new Map<string, ModuleInstallationRow>();
    if (installation.moduleAttachment) {
      const rootEntry = currentCommonsEntry!;
      const pins = new Map<string, string>(
        rootEntry.securityScan.dependencyPins
          ?.map((pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const) ?? [],
      );
      const visited = new Set<string>();
      const verifyDependencyClosure = async (manifest: ModuleManifest): Promise<void> => {
        for (const dependency of manifest.dependencies) {
          const key = `${dependency.manifestId}@${dependency.version}`;
          if (visited.has(key)) continue;
          visited.add(key);
          const expectedHash = pins.get(key);
          const entry = await ctx.wiring.commonsRegistry.getVersion(dependency.manifestId, dependency.version);
          if (!entry || !expectedHash || entry.integrity.value !== expectedHash) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Commons dependency "${key}" does not match its signed content-hash pin`,
            });
          }
          try {
            assertCommonsEntryContentTrusted(entry);
          } catch (err) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: err instanceof Error ? err.message : `Commons dependency "${key}" failed trust verification`,
            });
          }
          const local = allInstallations.find(
            (candidate) =>
              candidate.moduleName === dependency.manifestId &&
              candidate.moduleVersion === dependency.version &&
              candidate.moduleAttachment?.source === "commons" &&
              candidate.moduleAttachment.ownerModuleName === installation.moduleAttachment?.ownerModuleName &&
              candidate.moduleAttachment.agentId === installation.moduleAttachment?.agentId &&
              candidate.moduleAttachment.needId === installation.moduleAttachment?.needId &&
              candidate.moduleAttachment.contentHash === expectedHash,
          );
          if (!local) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Commons dependency "${key}" was not staged from its pinned result`,
            });
          }
          if (!["private", "promoted", "available"].includes(local.state)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Commons dependency "${key}" cannot activate from state "${local.state}"`,
            });
          }
          verifiedCommonsDependencies.set(key, entry.manifest);
          verifiedDependencyInstallations.set(key, local);
          for (const pin of entry.securityScan.dependencyPins ?? []) {
            pins.set(`${pin.name}@${pin.version}`, pin.contentHash);
          }
          await verifyDependencyClosure(entry.manifest);
        }
      };
      await verifyDependencyClosure(installation.manifest);
    }
    const installManifests = [installation.manifest, ...verifiedCommonsDependencies.values()];
    const installCapabilities = installManifests.flatMap((manifest) => manifest.capabilities);
    for (const capability of installCapabilities) {
      bundledCapabilities.set(capability.id, capability);
      bundledCapabilities.set(capability.name, capability);
      for (const dependency of capability.dependencies) {
        if (bundledCapabilities.has(dependency.manifestId)) continue;
        if (!z.string().uuid().safeParse(dependency.manifestId).success) continue;
        const row = await ctx.wiring.capabilityStore.getManifest(dependency.manifestId);
        if (row) capDepRows.set(dependency.manifestId, row);
      }
    }
    const resolveModuleDependency = (name: string, version: string) =>
      installation.moduleAttachment
        ? verifiedCommonsDependencies.get(`${name}@${version}`)
        : allInstallations.find((i) => i.moduleName === name && i.moduleVersion === version)?.manifest;

    const computedRisk = computeModuleRisk(
      installation.manifest,
      resolveCapabilityDependency,
      resolveModuleDependency,
    );
    const signedRiskFloor = installation.moduleAttachment
      ? installation.computedRisk
      : "informational";
    const risk = {
      ...computedRisk,
      compositeRisk: maxRisk(computedRisk.compositeRisk, signedRiskFloor),
      effectiveRisk: maxRisk(computedRisk.effectiveRisk, signedRiskFloor),
    };

    // Module-wide audience: the strictest (most-restrictive-raising) audience
    // across its own bundled capabilities — mirrors raiseForAudience's
    // "audience only ever raises, never lowers" contract at the module level.
    const audiences = installCapabilities.map((c) => c.audience);
    const audience = audiences.includes("external_visible")
      ? "external_visible"
      : audiences.includes("team")
        ? "team"
        : "private";

    // PKG-2 community-origin floor input: a module is treated at its
    // LEAST-trusted capability origin — if any bundled capability is
    // community/user_code (untrusted), the whole install is floored there.
    const resolvedTrustGrants: TrustGrantView[] = []; // store-layer follow-up (same gap capability.activate has)
    const floorOrigin: CapabilityOrigin = installCapabilities.some((c) => isUntrustedOrigin(c.origin))
      ? "community"
      : "built_in";

    const decision = await resolveActivationApproval({
      organizationId: input.organizationId,
      riskBand: risk.effectiveRisk,
      audience,
      // PKG-2 community-origin floor: an untrusted origin (community/user_code)
      // never receives trust-grant auto-activation — community is pinned to the
      // same tier as unreviewed local code, so it can never auto-trust above it.
      trustGrants: trustGrantsForOrigin(floorOrigin, resolvedTrustGrants),
      killSwitch: ctx.wiring.capabilityKillSwitch,
      budgets: ctx.wiring.capabilityBudgets,
      todayKey: input.todayKey,
    });

    // Every capability in the module is registered via the EXISTING
    // capability.register path's semantics (draft state, never active) —
    // registration != activation, same invariant capability.register itself
    // enforces. This happens regardless of the approval outcome, mirroring
    // "install_flow.1_propose" in the format doc (registration precedes the
    // approval decision).
    //
    // Idempotency (ADR-024): re-installing a module version whose bundled
    // capability keeps the SAME (name, version) must not collide with
    // `capability_manifests_uq`. Check-before-insert via
    // `getManifestByNameVersion` (the natural key the unique constraint
    // enforces) and reuse the existing manifest row instead of re-creating
    // it — a second install of the identical capability is a no-op
    // re-registration, not a new manifest.
    const registeredManifestIds: string[] = [];
    for (const cap of installCapabilities) {
      const existingManifest = await ctx.wiring.capabilityStore.getManifestByNameVersion(
        input.organizationId,
        cap.name,
        cap.version,
      );
      const capId = existingManifest?.id ?? ctx.run.ids.next();
      if (
        existingManifest &&
        canonicalizeJson({
          capabilityType: existingManifest.capabilityType,
          name: existingManifest.name,
          version: existingManifest.version,
          origin: existingManifest.origin,
          audience: existingManifest.audience,
          manifest: existingManifest.manifest,
          dependencies: existingManifest.dependencies,
        }) !== canonicalizeJson({
          capabilityType: cap.capabilityType,
          name: cap.name,
          version: cap.version,
          origin: cap.origin,
          audience: cap.audience,
          manifest: { permissions: cap.permissions, connectors: cap.connectors },
          dependencies: cap.dependencies,
        })
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `capability "${cap.name}" v${cap.version} already exists with different signed content`,
        });
      }
      if (!existingManifest) {
        await ctx.wiring.capabilityStore.createManifest({
          id: capId,
          organizationId: input.organizationId,
          capabilityType: cap.capabilityType,
          name: cap.name,
          version: cap.version,
          origin: cap.origin,
          audience: cap.audience,
          manifest: { permissions: cap.permissions, connectors: cap.connectors },
          computedRisk: risk.effectiveRisk,
          dependencies: cap.dependencies,
        });
      }
      const existingState = existingManifest
        ? await ctx.wiring.capabilityStore.getState(capId)
        : null;
      if (!existingState) {
        await ctx.wiring.capabilityStore.upsertState({
          manifestId: capId,
          organizationId: input.organizationId,
          state: "draft",
          suspended: false,
          evidence: {},
        });
      }
      registeredManifestIds.push(capId);
    }

    const rerisked = await ctx.wiring.moduleStore.setComputedRisk(installation.id, risk.effectiveRisk);

    if (decision.requirement !== "auto") {
      const proposalId = stableModuleInstallProposalId(input.organizationId, installation.id);
      const priorDecision = await ctx.wiring.ledger.decisionFor(proposalId);
      if (priorDecision) {
        if (priorDecision.userDecision === "approve" || priorDecision.userDecision === "edit") {
          const finalized = await activateApprovedModuleInstallation(
            ctx.wiring,
            input.organizationId,
            installation.id,
          );
          return {
            installed: true,
            decision,
            risk,
            installation: finalized,
            registeredManifestIds,
            reconciled: true as const,
          };
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: "module install proposal was vetoed; stage a new signed module version to retry",
        });
      }
      let proposal: Proposal | null = await findPendingProposalById(
        ctx.wiring,
        input.organizationId,
        proposalId,
      );
      if (!proposal) {
        try {
          proposal = await ctx.wiring.pipeline.propose(
            {
              organizationId: input.organizationId,
              actor: { type: ctx.identity.type, id: ctx.identity.id },
              action: "write",
              resourceType: "module_installation",
              resourceId: moduleInstallationLedgerResourceId(
                input.organizationId,
                installation.id,
              ),
              inputs: {
                operation: "module_install",
                installationId: installation.id,
                moduleName: installation.moduleName,
                effectiveRisk: risk.effectiveRisk,
              },
              skill: "stageMutation",
            },
            ctx.run,
            { proposalId, requireHumanReview: true },
          );
        } catch (cause) {
          proposal = await findPendingProposalById(ctx.wiring, input.organizationId, proposalId);
          if (!proposal) throw cause;
        }
      }
      if (proposal.status !== "pending_review") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: proposal.rejectionReason ?? "module install proposal did not reach Human review",
        });
      }
      return { installed: false, decision, risk, proposal, installation: rerisked, registeredManifestIds };
    }

    if (decision.budgeted && (risk.effectiveRisk === "informational" || risk.effectiveRisk === "advisory")) {
      await ctx.wiring.capabilityBudgets.recordAutoActivation(input.organizationId, risk.effectiveRisk, input.todayKey);
    }

    await assertCurrentCommonsAttachment(ctx.wiring, installation);
    const installed = await ctx.wiring.moduleStore.setStatus(installation.id, "installed");
    const installedWithRisk: ModuleInstallationRow = { ...installed, computedRisk: risk.effectiveRisk };
    for (const dependency of verifiedDependencyInstallations.values()) {
      await ctx.wiring.moduleStore.setComputedRisk(
        dependency.id,
        maxRisk(dependency.computedRisk, risk.effectiveRisk),
      );
      await ctx.wiring.moduleStore.setStatus(dependency.id, "installed");
      let promotable = dependency;
      if (promotable.state === "private") {
        promotable = await ctx.wiring.moduleStore.setState(promotable.id, "promoted");
      }
      if (promotable.state === "promoted") {
        const currentAvailable = await ctx.wiring.moduleStore.getAvailable(
          input.organizationId,
          promotable.moduleName,
          promotable.moduleAttachment,
        );
        const promotion = promoteToAvailable(promotable, currentAvailable);
        await ctx.wiring.moduleStore.setState(
          promotion.promoted.installationId,
          promotion.promoted.nextState,
        );
        if (promotion.demoted) {
          await ctx.wiring.moduleStore.setState(
            promotion.demoted.installationId,
            promotion.demoted.nextState,
          );
        }
      }
    }
    const advanced = await ctx.wiring.moduleStore.setState(installation.id, advanceModuleState(installation.state));
    return {
      installed: true,
      decision,
      risk,
      installation: { ...advanced, computedRisk: risk.effectiveRisk, status: installedWithRisk.status },
      registeredManifestIds,
    };
  }),

  reconcileApproved: authenticatedProcedure
    .input(z.object({ proposalId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const proposal = await ctx.wiring.ledger.get(input.proposalId);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
      assertPilotOrganization(proposal.organizationId);
      await assertMembership(ctx.wiring.organizationStore, proposal.organizationId, ctx.identity.id);
      const installationId = moduleInstallIdFromProposal(proposal);
      if (!installationId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "proposal is not a module install approval" });
      }
      const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
      if (decision?.userDecision !== "approve" && decision?.userDecision !== "edit") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "module install proposal is not approved" });
      }
      const installation = await activateApprovedModuleInstallation(
        ctx.wiring,
        proposal.organizationId,
        installationId,
      );
      return { installation, proposalId: input.proposalId };
    }),

  list: authenticatedProcedure.input(paginatedInput).use(organizationGuard).query(async ({ input, ctx }) => {
    const { items, total } = await ctx.wiring.moduleStore.list(input.organizationId, {
      limit: input.limit,
      offset: input.offset,
      ...(ctx.wiring.publicCloudOnly ? { installedRootsOnly: true } : {}),
    });
    const itemsWithRuntimeBindings = await Promise.all(
      items.map(async (installation) => {
        const runtimeAutomationIds: string[] = [];
        const runtimeSkillIds: string[] = [];
        const runtimeBindingIssues: string[] = [];
        for (const automation of installation.manifest.module?.automations ?? []) {
          if (!automation.automationId) continue;
          const automationId = resolveModuleAutomationRuntimeId(installation.moduleName, automation.automationId);
          const agentId = resolveModuleAgentRuntimeId(installation.moduleName, automation.agentId);
          const definition = automationId
            ? await ctx.wiring.automationRegistry.load(input.organizationId, automationId)
            : null;
          if (automationId && agentId && definition?.agentId === agentId) {
            runtimeAutomationIds.push(automation.id);
          }
        }
        const attachment = installation.moduleAttachment;
        if (
          attachment
          && isSupportedCitedRoleModelInstallation(installation)
        ) {
          try {
            const currentEntry = await assertCurrentCommonsAttachment(
              ctx.wiring,
              installation,
            );
            if (!currentEntry || !isSupportedCitedRoleModelManifest(currentEntry.manifest)) {
              runtimeBindingIssues.push(
                "The current signed Commons result no longer matches the supported runtime contract",
              );
            } else if (!await currentSupportedRelationshipOwner(ctx.wiring, installation)) {
              runtimeBindingIssues.push(
                "The owning Relationship Module no longer matches the supported runtime contract",
              );
            } else {
              runtimeSkillIds.push(
                LEARNING_RECOMMENDATION_SKILL_ID,
              );
            }
          } catch (error) {
            runtimeBindingIssues.push(
              error instanceof TRPCError
                ? error.message
                : "Commons registry is unavailable; the runtime binding could not be revalidated",
            );
          }
        }
        return {
          ...installation,
          runtimeAutomationIds,
          runtimeSkillIds,
          runtimeBindingIssues,
        };
      }),
    );
    return {
      items: itemsWithRuntimeBindings,
      total,
      hasMore: input.offset + itemsWithRuntimeBindings.length < total,
    };
  }),

  recentRuns: authenticatedProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      moduleName: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .use(organizationGuard).query(async ({ input, ctx }) => {
      const installation = await ctx.wiring.moduleStore.getAvailable(
        input.organizationId,
        input.moduleName,
      );
      if (
        !installation ||
        installation.status !== "installed" ||
        !installation.manifest.module ||
        installation.moduleAttachment
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "installed Module not found" });
      }
      const runtimeAutomations = new Map<string, {
        id: string;
        name: string;
      }>();
      for (const automation of installation.manifest.module.automations) {
        if (!automation.automationId) continue;
        const runtimeId = resolveModuleAutomationRuntimeId(
          installation.moduleName,
          automation.automationId,
        );
        if (runtimeId) {
          runtimeAutomations.set(runtimeId, {
            id: automation.id,
            name: automation.name,
          });
        }
      }
      const runs = await ctx.wiring.automationRunRecorder.list(
        input.organizationId,
        [...runtimeAutomations.keys()],
        { limit: input.limit },
      );
      return {
        items: runs.map((run) => ({
          ...run,
          manifestAutomationId: runtimeAutomations.get(run.automationId)?.id ?? run.automationId,
          automationName: runtimeAutomations.get(run.automationId)?.name ?? run.automationId,
        })),
      };
    }),

  get: authenticatedProcedure.input(moduleIdInput).query(async ({ input, ctx }) => {
    const installation = await ctx.wiring.moduleStore.get(input.installationId);
    if (!installation) throw new TRPCError({ code: "NOT_FOUND", message: "unknown module installation" });
    await assertMembership(ctx.wiring.organizationStore, installation.organizationId, ctx.identity.id);
    return { installation };
  }),

  /**
   * Promote a `promoted`-state installation to `available`, auto-demoting
   * whatever installation is currently `available` for the same module
   * name in this organization — never two live versions side by side
   * (packages/core/src/module/lifecycle.ts's promoteToAvailable).
   */
  promote: procedure.input(modulePromoteInput).use(organizationGuard).mutation(async ({ input, ctx }) => {
    const target = await ctx.wiring.moduleStore.get(input.installationId);
    if (!target || target.organizationId !== input.organizationId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "unknown module installation" });
    }
    const currentCommonsEntry = await assertCurrentCommonsAttachment(ctx.wiring, target);
    await verifiedCommonsDependencyInstallations(ctx.wiring, target, currentCommonsEntry);
    const currentlyAvailable = await ctx.wiring.moduleStore.getAvailable(
      input.organizationId,
      target.moduleName,
      target.moduleAttachment,
    );
    let result;
    try {
      result = promoteToAvailable(target, currentlyAvailable);
    } catch (err) {
      if (err instanceof InvalidModuleTransitionError || err instanceof Error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
      }
      throw err;
    }
    const promoted = await ctx.wiring.moduleStore.setState(result.promoted.installationId, result.promoted.nextState);
    if (result.demoted) {
      await ctx.wiring.moduleStore.setState(result.demoted.installationId, result.demoted.nextState);
    }
    return { installation: promoted };
  }),

  /**
   * Rollback = fork a NEW draft installation from a historical version,
   * never an in-place revert (append-only-ledger invariant, matches every
   * other Bridge mutation). The forked row still needs its own `install` to
   * go live — rollback alone does not activate it.
   */
  rollback: procedure.input(moduleRollbackInput).use(organizationGuard).mutation(async ({ input, ctx }) => {
    const rollbackTarget = await ctx.wiring.moduleStore.get(input.rollbackTargetId);
    if (!rollbackTarget || rollbackTarget.organizationId !== input.organizationId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "unknown rollback target installation" });
    }
    const currentAvailable = await ctx.wiring.moduleStore.getAvailable(
      input.organizationId,
      rollbackTarget.moduleName,
      rollbackTarget.moduleAttachment,
    );
    if (!currentAvailable) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `module "${rollbackTarget.moduleName}" has no currently-available version to roll back from` });
    }
    const forked = rollbackFromHistory({ currentAvailable, rollbackTarget });
    const created = await ctx.wiring.moduleStore.create(forked);
    return { installation: created };
  }),
});
