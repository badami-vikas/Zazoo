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
