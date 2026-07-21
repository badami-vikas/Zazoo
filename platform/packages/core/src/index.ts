/**
 * @bridge/core — the platform spine. Zero runtime dependencies.
 *
 * Universal Action Pipeline · Authority resolver · Policy engine · AutomationExecutor
 * seam · determinism primitives. In-memory adapters ship here; @bridge/db binds
 * the same ports to Drizzle/Supabase.
 */
export * from "./types.js";
export * from "./data-scope.js";
export * from "./determinism.js";
export * from "./ports.js";
export * from "./geocoding.js";
export { resolveAuthority, agentFloorDeny, planeGate, type ResolveArgs, type AuthorityDeps } from "./authority.js";
export {
  buildAgentCapability,
  egressTierTokens,
  isForbiddenAgentToken,
  scopePermits,
  validateAutomationWithinAgents,
  type EgressTier,
  type BuiltAgentCapability,
  type AgentScopeView,
  type AutomationStepView,
  type AutomationScopeViolation,
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
  NotPendingProposalError,
  type ProposeOptions,
  KERNEL_PASSTHROUGH_SKILL,
  type PipelineDeps,
} from "./pipeline.js";
export {
  InProcessAutomationExecutor,
  type AutomationExecutor,
  type AutomationExecutorOpts,
  type AutomationStep,
  type AutomationRunByIdRequest,
  type AutomationRunResult,
} from "./automation-executor.js";
export * from "./memory/stores.js";
export * from "./memory/memory-store.js";
export * from "./skills.js";
export * from "./goal-task.js";
export * from "./task-manager.js";
export * from "./skill-manifest.js";
export * from "./child-agent-run.js";

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
  isUntrustedOrigin,
  trustGrantsForOrigin,
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

// Builder primitives (execution-plan-2026-07.md Track F2) -- governed
// Read/Write/Edit/Bash-equivalent primitives + the SandboxProvider port
// shell:execute must route through (ADR-027 sandbox doctrine).
export {
  classifyBuilderPrimitiveRisk,
  checkGrantScope,
  checkCommandAllowed,
  runShellExecute,
  type BuilderPrimitiveToken,
  type BuilderPrimitiveRiskClassification,
  type BuilderPrimitiveGrant,
  type BuilderPrimitiveDenialReason,
  type BuilderPrimitiveScopeCheckResult,
  type BuilderPrimitiveRequest,
  type BuilderPrimitiveResult,
} from "./capability/builder-primitives.js";
export {
  InProcessJsSandboxProvider,
  NotImplementedContainerSandboxProvider,
  UnsupportedSandboxRequestError,
  type SandboxIsolationTier,
  type SandboxRunRequest,
  type SandboxRunResult,
  type SandboxProvider,
} from "./capability/sandbox-provider.js";
// PKG-1 (Month-6) — pre-Active sandbox floor gate + sandbox-cap trifecta legs
// for executable capabilities (CapabilityManifest.execution).
export {
  evaluateSandboxRequirement,
  sandboxTrifectaLegs,
  type SandboxGateResult,
  type SandboxGateDenialReason,
  type SandboxTrifectaLegs,
} from "./capability/sandbox-policy.js";

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

// Capability modules (docs/raw/capability-module-format.md, ADR-018) — the
// shipping unit ABOVE one capability_manifests row. Builds on capability/*
// above; never redefines its trust-model types.
export * from "./module/types.js";
export { parseModuleManifest, ModuleManifestValidationError } from "./module/manifest.js";
export { computeModuleRisk, moduleHasLethalTrifecta, type ModuleRiskResult } from "./module/risk.js";
export {
  InvalidModuleTransitionError,
  advanceModuleState,
  promoteToAvailable,
  rollbackFromHistory,
  type PromoteResult,
} from "./module/lifecycle.js";
export {
  InMemoryModuleStore,
  type ModuleAttachmentTarget,
  type ModuleStore,
} from "./module/ports.js";
// PKG-2 (Month-6) Commons supply-chain trust — pure signing/verification policy
// + canonicalization + TLS-by-default (crypto itself is bound at the seam).
export {
  canonicalizeManifest,
  canonicalizeJson,
  verifyManifestSignature,
  toSignedEnvelope,
  assertCommonsUrlTls,
  CommonsInsecureTransportError,
  type ManifestSignatureAlgorithm,
  type ManifestSignature,
  type SignedManifestEnvelope,
  type SignatureVerifier,
  type ManifestVerificationFailure,
  type ManifestVerificationResult,
  type VerifyManifestOptions,
} from "./module/signing.js";
export {
  canonicalizeCommonsContent,
  canonicalizeCommonsSignedPayload,
  commonsModuleContent,
  computeCommonsContentHash,
  normalizeCommonsTags,
  verifyCommonsEntry,
  verifyCommonsEntryContent,
  type CommonsModuleContent,
  type CommonsEntryVerificationFailure,
  type CommonsEntryVerificationResult,
  type ContentHasher,
} from "./module/commons-trust.js";

// PI-2 tainted-context egress gate + PI-3 dual-LLM quarantine / spotlighting (Month-3
// prompt-injection defenses; ADR-066/067). The pipeline enforces the egress gate
// STRUCTURALLY (always-on); these exports make the primitives reusable + testable, and
// @bridge/models binds a local-plane ContentGuard adapter to the port.
export {
  TAINTED_EGRESS_POLICY_ID,
  TAINTED_EGRESS_RESOURCES,
  evaluateTaintedEgress,
  taintedEgressPolicy,
} from "./policy/taint-egress.js";
export {
  SPOTLIGHT_OPEN,
  SPOTLIGHT_CLOSE,
  spotlightUntrusted,
  QuarantinedContentGuard,
  type ContentGuard,
  type ContentGuardVerdict,
} from "./guard/content-guard.js";

// Agent Quality Vector + eval harness (deterministic substrate, no model calls).
export {
  computeAqv,
  computeCorrection,
  computeCorrectionDepth,
  computeEfficiency,
  computeReliability,
  computeSafety,
  computeSuccess,
  recordsInWindow,
  resolvedEpisodes,
  scoreCapability,
  type AQV,
  type AqvEvidence,
  type AqvRecord,
  type AqvSource,
  type AqvWindow,
} from "./eval/aqv.js";
export type { AxisScores, Comparison, EvalCase, EvalDataset, EvalRun, Scorer } from "./eval/types.js";
export {
  InMemoryEvalStore,
  runEvalDataset,
  writeEvalRunEvidence,
  type EvalProducedCase,
  type EvalStore,
  type RunDatasetInput,
} from "./eval/store.js";
export { contractMatchScorer, deterministicScorers, replayDeterminismScorer, routeMatchScorer } from "./eval/scorers.js";
// Universal Commons — client port + wire types. Local service (services/
// commons) today, Bridge Cloud later; same contract, swap is config-only.
export {
  CommonsPublishRejectedError,
  type CommonsRegistry,
  type CommonsModuleEntry,
  type CommonsModuleSummary,
  type CommonsModuleDetail,
  type CommonsListQuery,
  type CommonsListResult,
  type CommonsProvenance,
  type CommonsSecurityCheck,
  type CommonsDependencyPin,
  type CommonsSecurityScan,
  type CommonsContentHash,
  type CommonsSignedSource,
} from "./module/commons.js";
export {
  adaptLegacyLicenseEntry,
  adaptLegacyVocabularyEntry,
  isLegacyLicenseEntry,
  isLegacyVocabularyEntry,
  readLegacySignedContent,
} from "./module/signed-legacy-entry.js";

// Blueprint -> view grammar compiler (docs/wiki/vision.md "View grammar",
// P1 "Organization Generator") — pure, zero-deps, additive to the pipeline.
export {
  compileBlueprint,
  BlueprintCompileError,
  BLUEPRINT_SCHEMA_VERSION,
  parseOrganizationBlueprint,
  BlueprintValidationError,
  organizationBlueprintToModuleManifest,
  organizationBlueprintFromModuleManifest,
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
  type OrganizationBlueprint,
  type OrganizationBlueprintPublishOptions,
  type NavigationEntry,
  type CompiledOrganization,
  type CompiledViewConfig,
} from "./blueprint.js";
export {
  InMemoryOrganizationDefinitionStore,
  type OrganizationDefinitionStatus,
  type OrganizationDefinitionRow,
  type OrganizationDefinitionStore,
} from "./organization-definition.js";

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

// The three non-Chief-of-Staff foundational agents (ADR-033, corrected to
// three by ADR-046) — @mention dispatch + system-prompt construction. Chief
// of Staff itself stays modeled by chief-of-staff.ts (it IS the router, not
// a routable target). Communications is no longer an agent — it's a skill
// (COMMUNICATIONS_SKILL + parseSkillMention + buildCommunicationsSystemPrompt).
export {
  FOUNDATIONAL_AGENTS,
  parseMention,
  findFoundationalAgent,
  buildAgentPersona,
  buildAgentSystemPrompt,
  invokeAgent,
  COMMUNICATIONS_SKILL,
  parseSkillMention,
  buildCommunicationsSystemPrompt,
  CAPABILITY_BUILDER_DESIGN_CONSTRAINTS,
  checkDesignConstraintViolations,
  type FoundationalAgentId,
  type FoundationalAgent,
  type AgentInvocationResult,
  type InvokeAgentArgs,
} from "./agents.js";

// RunContextAssembler (ADR-027, execution-plan-2026-07.md Track F5/Wave 3) --
// supersedes the earlier "PromptAssembler" idea. Assembles everything a model
// run needs; projectToPrompt is explicitly ONE projection of it, not the thing
// itself.
export {
  assembleRunContext,
  projectToPrompt,
  projectToSystemPrompt,
  renderPersonaSystemPreamble,
  KERNEL_INVARIANTS,
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
  profileFromRow,
  buildChiefOfStaffPersona,
  type OnboardingProfileRow,
  type OnboardingProfileStore,
  type OnboardingProfile,
} from "./onboarding-profile.js";

// ---------------------------------------------------------------------------
// Month 4 / Batch 6 — "the self-improvement loop closes" (P3 core).
// EVAL-3 comparison + EVAL-4 judge (eval/), policy_params + VAR-1 adjuster
// (policy/), REG-1 registry (capability/), GOV-1 org-health (governance/).
// ---------------------------------------------------------------------------

// EVAL-3 — baseline-vs-candidate comparison + the governed "why better" card
// the capability.approve Validated->Active gate surfaces (Comparison type is
// exported above with the other eval/types).
export {
  compareRuns,
  buildWhyBetterCard,
  type WhyBetterCard,
  type WhyBetterGateLine,
} from "./eval/comparison.js";

// EVAL-4 — LLM-judge quality scorer (pinned model), held-out selection,
// approve/veto calibration, and the red-team pack that gates the External band.
export {
  JudgeScorer,
  selectHeldOut,
  calibrateJudge,
  evaluateRedTeamPack,
  requireRedTeamForExternal,
  type JudgeCalibration,
  type RedTeamAssertion,
  type RedTeamResult,
} from "./eval/judge.js";

// policy_params — the typed tunable space EVAL-3 gates and VAR-1 nudges read
// (hard ceilings deliberately not representable here).
export {
  DEFAULT_POLICY_PARAMS,
  cloneDefaultPolicyParams,
  mergePolicyParams,
  resolveGates,
  getTunable,
  clampToBounds,
  InMemoryPolicyParamStore,
  type TunableParam,
  type AqvGates,
  type PolicyParams,
  type PolicyParamsOverride,
  type PolicyParamStore,
} from "./policy/params.js";

// VAR-1 — Variance Adjuster: a veto reason-chip -> a bounded, governed
// single-parameter nudge proposal (never silent, never crosses a ceiling).
export {
  CHIP_PARAM_MAP,
  proposeVarianceAdjustment,
  type ChipTarget,
  type VettedVeto,
  type VarianceProposal,
  type ProposeOpts,
} from "./policy/variance-adjuster.js";

// REG-1 — Component Registry overlap detection (structural Tier 1 -> semantic
// Tier 2), the "does this already exist?" check the Learning Agent runs first.
export {
  structuralSimilarity,
  findOverlaps,
  cosineSimilarity,
  type OverlapCandidate,
  type OverlapMatch,
  type FindOverlapsOpts,
} from "./capability/registry.js";

// GOV-1 — Governance Agent org-health rollup + the minor/moderate/major
// approval-band classifier (Governance auto-approves only `minor`).
export {
  classifyApprovalBand,
  canGovernanceAutoApprove,
  rollupOrgHealth,
  type ApprovalBand,
  type CapabilityHealthRecord,
  type PendingProposalRecord,
  type ViolationPoint,
  type OrgHealthInput,
  type ApprovalLoad,
  type OrgHealthRollup,
} from "./governance/org-health.js";
