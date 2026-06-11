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
export { UniversalActionPipeline, type PipelineDeps } from "./pipeline.js";
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
