/**
 * @bridge/core — the platform spine. Zero runtime dependencies.
 *
 * Universal Action Pipeline · Authority resolver · Policy engine · RitualExecutor
 * seam · determinism primitives. In-memory adapters ship here; @bridge/db binds
 * the same ports to Drizzle/Supabase.
 */
export * from "./types.js";
export * from "./data-scope.js";
export * from "./determinism.js";
export * from "./ports.js";
export { resolveAuthority, agentFloorDeny, planeGate, type ResolveArgs, type AuthorityDeps } from "./authority.js";
export {
  buildAgentCapability,
  egressTierTokens,
  isForbiddenAgentToken,
  scopePermits,
  validateRitualWithinAgents,
  type EgressTier,
  type BuiltAgentCapability,
  type AgentScopeView,
  type RitualStepView,
  type RitualScopeViolation,
} from "./agent-scope.js";
export {
  AGENT_FLOOR_PROTECTED_RESOURCES,
  AGENT_FLOOR_MUTATIONS,
  AGENT_FLOOR_ALWAYS_DENIED_SCOPES,
  ALWAYS_APPROVAL_SCOPES,
  isAgentFloorProtectedResourceToken,
  isAgentFloorDenied,
} from "./agent-floor.js";
export {
  UniversalActionPipeline,
  AlreadyResolvedError,
  AgentFloorDeniedError,
  type PipelineDeps,
} from "./pipeline.js";
export {
  InProcessRitualExecutor,
  type RitualExecutor,
  type RitualExecutorOpts,
  type RitualStep,
  type RitualRunRequest,
  type RitualRunByIdRequest,
  type RitualRunResult,
} from "./ritual-executor.js";
export * from "./memory/stores.js";
export * from "./skills.js";

// Capability Trust Model (docs/wiki/vision.md "Capability Trust Model" +
// "Promotion defaults") — additive to the pipeline; agent-floor/human-decide
// guarantees are untouched.
export * from "./capability/types.js";
export { computeRisk, maxRisk, baseRiskForManifest } from "./capability/risk.js";
export {
  PROMOTION_DEFAULTS,
  InvalidTransitionError,
  EvidenceThresholdError,
  newDraftState,
  trustedThresholdFailure,
  advance,
  demoteOnDependencyChange,
  suspendOnFailure,
  resumeFromSuspension,
  type TransitionResult,
  type SuspendResult,
} from "./capability/lifecycle.js";
export {
  requiredApproval,
  resolveActivationApproval,
  AUTO_ACTIVATION_BUDGETS,
  isBudgetedBand,
  InMemoryAutoActivationBudgetStore,
  InMemoryKillSwitch,
  type ApprovalRequirement,
  type TrustGrantView,
  type BudgetedRiskBand,
  type AutoActivationBudgetStore,
  type KillSwitchPort,
  type ActivationDecision,
} from "./capability/approvals.js";
export {
  InMemoryCredentialBroker,
  type CredentialBroker,
  type CredentialGrantRef,
} from "./capability/credential-broker.js";
export {
  InMemoryCapabilityStore,
  type CapabilityStore,
  type CapabilityManifestRow,
  type CapabilityStateRow,
} from "./capability/ports.js";
export type {
  ForeignCapabilitySource,
  ForeignImportSandboxPolicy,
  ForeignCapabilityImport,
} from "./capability/foreign-import.js";
export {
  translateForeignCapability,
  ForeignImportSandboxRequiredError,
  ForeignImportValidationError,
  type ForeignCapabilityDescriptorInput,
  type ForeignImportResult,
} from "./capability/importer.js";

// Builder toolbelt (execution-plan-2026-07.md Track F2) -- governed
// Read/Write/Edit/Bash-equivalent primitives + the SandboxProvider port
// shell:execute must route through (ADR-027 sandbox doctrine).
export {
  classifyToolbeltRisk,
  checkGrantScope,
  checkCommandAllowed,
  runShellExecute,
  type ToolbeltResourceToken,
  type ToolbeltRiskClassification,
  type ToolbeltGrant,
  type ToolbeltDenialReason,
  type ToolbeltScopeCheckResult,
  type ToolbeltRequest,
  type ToolbeltResult,
} from "./capability/toolbelt.js";
export {
  InProcessJsSandboxProvider,
  NotImplementedContainerSandboxProvider,
  UnsupportedSandboxRequestError,
  type SandboxIsolationTier,
  type SandboxRunRequest,
  type SandboxRunResult,
  type SandboxProvider,
} from "./capability/sandbox-provider.js";

// Context Provider contract (docs/wiki/clients.md, Sensor SPI) — desktop-only,
// optional capability; screen capture is one provider among nine, never the
// kernel's dependency.
export type {
  ContextProviderName,
  ContextDataScope,
  ContextRetention,
  ContextItem,
  ContextProvider,
} from "./context-provider.js";

// Capability packages (docs/raw/capability-package-format.md, ADR-018) — the
// shipping unit ABOVE one capability_manifests row. Builds on capability/*
// above; never redefines its trust-model types.
export * from "./package/types.js";
export { parsePackageManifest, PackageManifestValidationError } from "./package/manifest.js";
export { computePackageRisk, packageHasLethalTrifecta, type PackageRiskResult } from "./package/risk.js";
export {
  InvalidPackageTransitionError,
  advancePackageState,
  promoteToAvailable,
  rollbackFromHistory,
  type PromoteResult,
} from "./package/lifecycle.js";
export { InMemoryPackageStore, type PackageStore } from "./package/ports.js";
// Universal Commons — client port + wire types. Local service (services/
// commons) today, Bridge Cloud later; same contract, swap is config-only.
export {
  CommonsPublishRejectedError,
  type CommonsRegistry,
  type CommonsPackageEntry,
  type CommonsPackageSummary,
  type CommonsPackageDetail,
  type CommonsListQuery,
  type CommonsListResult,
} from "./package/commons.js";

// Blueprint -> view grammar compiler (docs/wiki/vision.md "View grammar",
// P1 "Workspace Generator") — pure, zero-deps, additive to the pipeline.
export {
  compileBlueprint,
  BlueprintCompileError,
  type BlueprintColumnKind,
  type BlueprintColumnSpec,
  type BlueprintTableSpec,
  type BlueprintSortSpec,
  type BlueprintFilterOp,
  type BlueprintRowFilter,
  type DataViewKind,
  type BlueprintViewKind,
  type BlueprintFieldSpec,
  type BlueprintEntitySpec,
  type BlueprintViewSpec,
  type WorkspaceBlueprint,
  type NavigationEntry,
  type CompiledWorkspace,
  type CompiledViewConfig,
} from "./blueprint.js";
export {
  InMemoryWorkspaceDefinitionStore,
  type WorkspaceDefinitionStatus,
  type WorkspaceDefinitionRow,
  type WorkspaceDefinitionStore,
} from "./workspace-definition.js";

// Chief of Staff v1 (docs/wiki/roadmap.md P1 "Chief of Staff v1") — pure intent
// classification + star-topology routing types. No I/O; apps/api's
// chiefOfStaff.converse is the only place a RoutingDecision becomes a
// pipeline.propose call.
export {
  classifyIntent,
  assertChainDepth,
  ChainDepthExceededError,
  MAX_CHAIN_DEPTH,
  type RoutableCapability,
  type RoutingDecision,
  type ClassifyIntentArgs,
} from "./chief-of-staff.js";

// The four non-Chief-of-Staff foundational agents (ADR-033) — @mention
// dispatch + system-prompt construction. Chief of Staff itself stays
// modeled by chief-of-staff.ts (it IS the router, not a routable target).
export {
  FOUNDATIONAL_AGENTS,
  ANIMAL_TONE,
  parseMention,
  findFoundationalAgent,
  buildAgentSystemPrompt,
  type FoundationalAgentId,
  type FoundationalAgent,
} from "./agents.js";

// RunContextAssembler (ADR-027, execution-plan-2026-07.md Track F5/Wave 3) --
// supersedes the earlier "PromptAssembler" idea. Assembles everything a model
// run needs; projectToPrompt is explicitly ONE projection of it, not the thing
// itself.
export {
  assembleRunContext,
  projectToPrompt,
  type RunPersona,
  type RunSurfaceReference,
  type DisclosedCapability,
  type RunGovernanceState,
  type RetrievedMemorySnippet,
  type RunOutputContract,
  type RunTraceMetadata,
  type ModelRunContext,
  type AssembleRunContextInput,
} from "./run-context.js";

// Onboarding profile store (ADR-033/R-029/R-030) — narrow, onboarding-scoped
// personalization store. NOT the general Memory/Knowledge kernel primitive
// (still absent); see onboarding-profile.ts's header comment.
export {
  InMemoryOnboardingProfileStore,
  type OnboardingProfileRow,
  type OnboardingProfileStore,
} from "./onboarding-profile.js";
