/**
 * Ports — the seams the pipeline depends on. In-memory implementations live in
 * `memory/stores.ts` (so core runs + tests with no database); the Drizzle/
 * Supabase implementations live in `@bridge/db` and bind the same interfaces.
 */
import type { Clock, IdGen, Rng } from "./determinism.js";
import type {
  Action,
  Actor,
  DomainEvent,
  GrantRule,
  LedgerEntry,
  PolicyResult,
  ResourceType,
  RunContext,
  SkillOutput,
  TrustOrigin,
} from "./types.js";
import type { TaintLabel } from "./taint.js";
import {
  UNKNOWN_LABEL,
  joinTaintLabels,
  taintFlowsTo,
} from "./taint.js";

/** Per-request execution context. Carries the determinism seams — nothing in
 * engine code reads the wall clock or a global RNG directly. */
export interface RunCtx {
  clock: Clock;
  rng: Rng;
  ids: IdGen;
  /** Optional caller cancellation propagated to networked Skills. */
  signal?: AbortSignal;
  /** Provenance of the most-tainted input threaded into this run (PI-1). Present
   * when the run's context includes ingested content; lets a downstream policy
   * (PI-2) see that the turn is tainted. PI-1 only surfaces it — no gating yet. */
  taintLabel?: TaintLabel;
  /** Legacy compatibility projection. */
  taint?: TrustOrigin;
}

export interface RoleQuery {
  /** Role ids the principal (user/team) holds in the organization. */
  rolesForPrincipal(organizationId: string, actor: Actor): Promise<string[]>;
  /** Grants attached to a role. */
  grantsForRole(roleId: string): Promise<GrantRule[]>;
  /** Direct (non-role) grants for an actor. */
  directGrants(organizationId: string, actor: Actor): Promise<GrantRule[]>;
}

export interface AgentQuery {
  /** Owning organization for this physical Agent identity, or null when unknown. */
  organizationId(agentId: string): Promise<string | null>;
  /** Only active Agents may resolve or invoke governed Skills. */
  isActive(agentId: string): Promise<boolean>;
  /** The role an agent inherits (assumes_role_id), if any. */
  assumedRole(agentId: string): Promise<string | null>;
  /**
   * The agent's capability ceiling: the set of "resourceType:action" tokens
   * (or "*" wildcards) it may EVER exercise. Authority = role ∩ this ∪ ephemeral − deny.
   */
  capabilityScope(agentId: string): Promise<string[]>;
  /**
   * The agent's data-tier ceiling (the access dropdown on the agent): all | public
   * | private. Effective scope = requested ∩ this ∩ granted. Default 'all'.
   */
  dataScope(agentId: string): Promise<import("./data-scope.js").DataScope>;
  /**
   * The agent's skill allow-list (agents.allowed_skills). An EMPTY list means
   * "not yet restricted" (unrestricted); a non-empty list is a closed set — the
   * agent may only run skills it names. Humans are never restricted here.
   */
  allowedSkills(agentId: string): Promise<string[]>;
}

export interface EphemeralQuery {
  /** Active (unexpired, unconsumed) ephemeral grants for an actor in a run context. */
  activeGrants(
    organizationId: string,
    actor: Actor,
    context: RunContext | undefined,
    nowISO: string,
  ): Promise<GrantRule[]>;
}

export interface PolicyEvalInput {
  organizationId: string;
  actor: Actor;
  action: Action;
  resourceType: ResourceType;
  resourceId: string | undefined;
  phase: "pre" | "runtime" | "post";
  inputs: unknown;
  proposedOutput?: unknown;
  /** The turn's effective provenance (PI-2), threaded by the pipeline from
   * `req.trustOrigin ?? ctx.taint`. Lets a data-flow policy see that this turn
   * carries untrusted_external content and gate egress accordingly. Absent =
   * no tagged/ingested content drove the turn (kernel/user-authored). */
  taint?: TrustOrigin;
  taintLabel?: TaintLabel;
}

export interface PolicyStore {
  evaluate(input: PolicyEvalInput): Promise<PolicyResult[]>;
}

export interface LedgerStore {
  /** Append-only. Returns the persisted entry (with id assigned). */
  append(entry: LedgerEntry): Promise<LedgerEntry>;
  get(id: string): Promise<LedgerEntry | null>;
  /**
   * The decision row that resolved a proposal (refLedgerId === proposalId), if any.
   * Append-only means the proposal row itself is never mutated, so resolution is
   * detected by the existence of a referencing decision row — not a status flip.
   */
  decisionFor(proposalId: string): Promise<LedgerEntry | null>;
  /**
   * Root proposals awaiting a human decision: `userDecision IS NULL`,
   * `refLedgerId IS NULL`, and no resolving row references the proposal. Null-decision
   * audit rows may also carry `refLedgerId`, so neither predicate alone is sufficient.
   * Ordered newest-first; paginated by the caller (offset/limit).
   */
  listPending(
    organizationId: string,
    opts: { limit: number; offset: number; privateOwnerUserId?: string },
  ): Promise<{ items: LedgerEntry[]; total: number }>;
  /** Bounded append-only history. Every private row remains visible only to its
   * effective owning user; non-private rows retain organization scope. */
  listHistory(
    organizationId: string,
    opts: { limit: number; offset: number; privateOwnerUserId?: string },
  ): Promise<{ items: LedgerEntry[]; total: number }>;
}

/** Media capture kind — photo or video. */
export type MediaKind = "photo" | "video";
/** Lifecycle of a local capture: quarantined → committed (via approved proposal) → archived. */
export type MediaStatus = "pending" | "committed" | "archived";

/**
 * A captured photo/video record. Private relationship data — lives in the LOCAL
 * plane ONLY (never Supabase/cloud). The blob is stored alongside via the store's
 * put/getBlob; the cloud canonical receives nothing about it.
 */
export interface MediaCaptureRecord {
  id: string;
  organizationId: string;
  kind: MediaKind;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  caption?: string;
  ocrText?: string;
  /** Small inline preview for browse/pending lists — local only. */
  thumbnailDataUrl?: string;
  status: MediaStatus;
  /** Set when an approved proposal commits the capture. */
  ledgerId?: string;
  linkedEntity?: { type: "person" | "memory" | "event"; id: string } | null;
  provenance: { skill: string; version: string; model?: string };
  capturedAt: string;
  archivedAt?: string | null;
}

/**
 * LOCAL-plane media store — the seam the camera capture Skill persists blobs through. The
 * in-memory adapter lives in `memory/stores.ts`; the pglite (bytea) adapter lives
 * in `@bridge/db`. Blobs NEVER cross the gate. Append-only: a row's blob + core
 * metadata are immutable after `put`; only status/ledgerId/linkedEntity/caption/
 * archivedAt mutate. No hard delete — `archive()` sets `archivedAt`.
 */
export interface LocalMediaStore {
  put(rec: MediaCaptureRecord, blob: Uint8Array): Promise<MediaCaptureRecord>;
  get(id: string): Promise<MediaCaptureRecord | null>;
  getBlob(id: string): Promise<Uint8Array | null>;
  list(filter?: { status?: MediaStatus; kind?: MediaKind; organizationId?: string }): Promise<MediaCaptureRecord[]>;
  update(id: string, patch: Partial<MediaCaptureRecord>): Promise<MediaCaptureRecord>;
  archive(id: string): Promise<void>;
}

export interface EventBus {
  emit(event: DomainEvent): Promise<void>;
}

export const MODEL_TIERS = ["cheap", "default", "reasoning"] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];
export const MODEL_PROVIDER_HEALTH = ["healthy", "unknown", "degraded", "unavailable"] as const;
export type ModelProviderHealth = (typeof MODEL_PROVIDER_HEALTH)[number];

export interface ModelPromptCache {
  strategy: "stable_system_prefix";
  /** The normalized receipt currently prices Anthropic's 5-minute write tier.
   * Add separate usage/rates before exposing the more expensive 1-hour tier. */
  ttl: "5m";
}

export interface ModelCompletionRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** Required at every call site so cost/capability intent is never inferred
   * from provider registration order. */
  tier: ModelTier;
  /** Provider-neutral cache intent. Providers without prefix caching may
   * ignore it; Anthropic binds it to the stable system block. */
  cache?: ModelPromptCache;
  /** Joined label for every system/user/context prompt segment. */
  taintLabel?: TaintLabel;
}

export const MAX_MODEL_PROMPT_CHARS = 1_000_000;
export const MAX_MODEL_OUTPUT_TOKENS = 32_768;

export function assertModelCompletionRequest(
  request: ModelCompletionRequest,
  label = "model completion",
): void {
  if (!MODEL_TIERS.includes(request.tier)) {
    throw new Error(`${label}: unsupported model tier`);
  }
  if (
    typeof request.prompt !== "string" ||
    (request.system !== undefined && typeof request.system !== "string") ||
    request.prompt.length + (request.system?.length ?? 0) > MAX_MODEL_PROMPT_CHARS
  ) {
    throw new Error(`${label}: prompt exceeds the bounded request size`);
  }
  if (
    request.maxTokens !== undefined &&
    (!Number.isSafeInteger(request.maxTokens) ||
      request.maxTokens <= 0 ||
      request.maxTokens > MAX_MODEL_OUTPUT_TOKENS)
  ) {
    throw new Error(`${label}: maxTokens exceeds the bounded output size`);
  }
  if (
    request.cache !== undefined &&
    (request.cache.strategy !== "stable_system_prefix" || request.cache.ttl !== "5m")
  ) {
    throw new Error(`${label}: unsupported cache policy`);
  }
}

export interface ModelUsage {
  /** Uncached input tokens as reported by the provider. */
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Real providers report authoritative counts; deterministic adapters may
   * only estimate them and must say so. */
  source: "provider" | "estimated";
}

export interface ModelCompletion {
  text: string;
  model: string;
  tier: ModelTier;
  usage: ModelUsage;
  /** Must be at least as restrictive as the complete request context. */
  taintLabel?: TaintLabel;
}

export function modelRequestTaint(
  request: ModelCompletionRequest,
  segmentLabels: readonly TaintLabel[] = [],
): TaintLabel {
  return joinTaintLabels(
    request.taintLabel ?? UNKNOWN_LABEL,
    ...segmentLabels,
  );
}

export function assertModelOutputTaint(
  request: ModelCompletionRequest,
  completion: ModelCompletion,
): TaintLabel {
  const requestLabel = modelRequestTaint(request);
  const outputLabel = completion.taintLabel ?? UNKNOWN_LABEL;
  if (!taintFlowsTo(requestLabel, outputLabel)) {
    throw new Error("model completion: output taint weakened prompt context");
  }
  return outputLabel;
}

export interface ModelTokenPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheCreationInputUsdPerMillion: number;
  cacheReadInputUsdPerMillion: number;
  source: string;
  asOf: string;
}

export interface ModelCallReceipt {
  providerId: string;
  plane: "local" | "cloud";
  model: string;
  tier: ModelTier;
  usage: ModelUsage;
  cost: {
    currency: "USD";
    estimatedUsd: number | null;
    status: "estimated" | "pricing_unavailable";
    pricingSource?: string;
    pricingAsOf?: string;
  };
}

/**
 * ModelProvider — the seam every model call in the kernel goes through (never
 * a direct SDK/fetch call inline in a Skill). `plane` mirrors the
 * two-plane gate (types.ts `Plane`): a `local` provider (e.g. Ollama) is safe
 * to bind for capture/sensor-plane work per CLAUDE.md ("capture/sensor plane =
 * local models default"); a `cloud` provider (e.g. Anthropic) is subject to
 * the same egress rules as any other cloud call — binding one does not itself
 * grant egress, the Authority resolver still gates the surrounding action.
 * `embed` is optional because not every provider/binding needs embeddings
 * (e.g. a pure-completion model). Kept here as TYPES ONLY — @bridge/core stays
 * zero-runtime-deps; the real HTTP-backed implementations live in
 * @bridge/models.
 */
export interface ModelProvider {
  id: string;
  plane: "local" | "cloud";
  /** Cost/capability tiers this configured provider can honestly satisfy. */
  tiers: readonly ModelTier[];
  /** Configured model identity by tier. Real adapters declare this so a
   * provider response cannot silently relabel the billed model. */
  models: Readonly<Partial<Record<ModelTier, string>>>;
  /** Synchronous routing snapshot. `unknown` is the honest default when no
   * active probe exists; `unavailable` is never selected. */
  routingHealth(): ModelProviderHealth;
  /** Optional price catalog by tier. Missing means receipts record usage while
   * explicitly reporting that a dollar estimate is unavailable. */
  pricing?: Readonly<Partial<Record<ModelTier, ModelTokenPricing>>>;
  complete(req: ModelCompletionRequest): Promise<ModelCompletion>;
  embed?(texts: string[]): Promise<number[][]>;
}

const MAX_MODEL_RECEIPT_ID_LENGTH = 256;
const MAX_MODEL_PRICING_SOURCE_LENGTH = 2_048;
const MAX_MODEL_PRICING_AS_OF_LENGTH = 64;
const MAX_MODEL_USAGE_TOKENS = 10_000_000;
const MAX_MODEL_PRICE_USD_PER_MILLION = 10_000;
const MAX_MODEL_CALL_COST_USD = 100_000;

export function createModelCallReceipt(
  provider: ModelProvider,
  completion: ModelCompletion,
  requestedTier: ModelTier,
): ModelCallReceipt {
  const providerId = provider.id.trim();
  const model = completion.model.trim();
  if (providerId.length === 0 || providerId.length > MAX_MODEL_RECEIPT_ID_LENGTH) {
    throw new Error("model receipt: provider returned an invalid provider id");
  }
  if (completion.tier !== requestedTier) {
    throw new Error(
      `model receipt: provider ${providerId} returned tier ${completion.tier} for ${requestedTier} request`,
    );
  }
  if (!provider.tiers.includes(completion.tier)) {
    throw new Error(
      `model receipt: provider ${providerId} returned unsupported tier ${completion.tier}`,
    );
  }
  if (model.length === 0 || model.length > MAX_MODEL_RECEIPT_ID_LENGTH) {
    throw new Error(`model receipt: provider ${providerId} returned an invalid model id`);
  }
  const declaredModel = provider.models[completion.tier]?.trim();
  if (!declaredModel || model !== declaredModel) {
    throw new Error(`model receipt: provider ${providerId} returned an undeclared model identity`);
  }
  const usageCounts = [
    completion.usage.inputTokens,
    completion.usage.outputTokens,
    completion.usage.cacheCreationInputTokens,
    completion.usage.cacheReadInputTokens,
  ];
  if (
    usageCounts.some(
      (count) => !Number.isSafeInteger(count) || count < 0 || count > MAX_MODEL_USAGE_TOKENS,
    )
  ) {
    throw new Error(`model receipt: provider ${providerId} returned invalid token usage`);
  }
  if (completion.usage.source !== "provider" && completion.usage.source !== "estimated") {
    throw new Error(`model receipt: provider ${providerId} returned an invalid usage source`);
  }
  const pricing = provider.pricing?.[completion.tier];
  if (
    pricing &&
    [
      pricing.inputUsdPerMillion,
      pricing.outputUsdPerMillion,
      pricing.cacheCreationInputUsdPerMillion,
      pricing.cacheReadInputUsdPerMillion,
    ].some(
      (rate) =>
        !Number.isFinite(rate) ||
        rate < 0 ||
        rate > MAX_MODEL_PRICE_USD_PER_MILLION,
    )
  ) {
    throw new Error(`model receipt: provider ${providerId} declares invalid pricing`);
  }
  const pricingSource = pricing?.source.trim() ?? "";
  const pricingAsOf = pricing?.asOf.trim() ?? "";
  if (
    pricing &&
    (
      !pricingSource ||
      pricingSource.length > MAX_MODEL_PRICING_SOURCE_LENGTH ||
      !/^\d{4}-\d{2}-\d{2}$/.test(pricingAsOf) ||
      pricingAsOf.length > MAX_MODEL_PRICING_AS_OF_LENGTH
    )
  ) {
    throw new Error(`model receipt: provider ${providerId} declares invalid pricing metadata`);
  }
  const estimatedUsd = pricing
    ? (
        completion.usage.inputTokens * pricing.inputUsdPerMillion +
        completion.usage.outputTokens * pricing.outputUsdPerMillion +
        completion.usage.cacheCreationInputTokens * pricing.cacheCreationInputUsdPerMillion +
        completion.usage.cacheReadInputTokens * pricing.cacheReadInputUsdPerMillion
      ) / 1_000_000
    : null;
  if (
    estimatedUsd !== null &&
    (!Number.isFinite(estimatedUsd) ||
      estimatedUsd < 0 ||
      estimatedUsd > MAX_MODEL_CALL_COST_USD)
  ) {
    throw new Error(`model receipt: provider ${providerId} produced an invalid cost estimate`);
  }

  return {
    providerId,
    plane: provider.plane,
    model,
    tier: completion.tier,
    usage: { ...completion.usage },
    cost: pricing
      ? {
          currency: "USD",
          estimatedUsd,
          status: "estimated",
          pricingSource,
          pricingAsOf,
        }
      : {
          currency: "USD",
          estimatedUsd: null,
          status: "pricing_unavailable",
        },
  };
}

/** A Skill is the atomic unit of work — produces a proposed output from inputs. */
export interface Skill {
  name: string;
  /** Pure-data Skills may carry inert typed data but cannot call models,
   * Integrations, credentials, filesystem, schema, or other authority sinks. */
  executionClass?: "pure_data" | "authority_bearing";
  run(inputs: unknown, ctx: RunCtx): Promise<SkillOutput>;
}

export interface SkillRegistry {
  get(name: string): Skill | undefined;
}

/**
 * Variance Adjuster — observes human decisions (esp. vetoes) and tunes policy
 * PARAMS, never code (invariant: "veto tunes params not code"). Slice keeps the
 * seam; learning logic lands with P5 pilot.
 */
export interface VarianceAdjuster {
  observe(entry: LedgerEntry, ctx: RunCtx): Promise<void>;
}

/** An Automation step stored in `automations.skill_pipeline`. */
export interface AutomationStepDef {
  skill: string;
  action: Action;
  resourceType: ResourceType;
  resourceId?: string;
  /** Static inputs from the config; merged with run-time params at execution. */
  inputs?: Record<string, unknown>;
  /** Data tier this step may touch (the per-step access dropdown). Absent = 'all'. */
  dataScope?: import("./data-scope.js").DataScope;
  /**
   * AGS1/TASK-007 — binds this step to the typed Goal/Task the Automation's
   * declared Agent is fulfilling, threaded unchanged into
   * `pipeline.propose`'s `goalTaskRef`. This is the SAME Goal/Task resolver
   * contract every other governed Skill invocation uses — an Automation does
   * not get a second, parallel actor-binding mechanism; a step whose `skill`
   * has a registered SkillManifest still resolves through
   * `resolveSkillForTask` exactly as a direct Agent call would, and still
   * fails closed without a valid `goalTaskRef` naming a Task assigned to the
   * Automation's declared Agent. Absent for steps that target an ungoverned
   * (no-manifest) skill — unaffected, same as any other caller.
   */
  goalTaskRef?: { goalId: string; taskId: string };
}

/** An Automation definition resolved from the canonical registry. */
export interface AutomationDefinition {
  id: string;
  name: string;
  organizationId: string;
  /** The sole actor for every Run started from this Automation. */
  agentId: string;
  /** Execution residency for the owning Agent. */
  agentPlane: import("./types.js").Plane;
  steps: AutomationStepDef[];
}

/** Loads Automation definitions from the canonical store. */
export interface AutomationRegistry {
  load(organizationId: string, automationId: string): Promise<AutomationDefinition | null>;
  save(definition: AutomationDefinition): Promise<void>;
}

/** Records attributable Automation Runs. */
export interface AutomationRunRecord {
  runId: string;
  automationId: string;
  organizationId: string;
  agentId: string;
  status: "running" | "completed" | "halted";
  startedAt: string;
  finishedAt?: string;
  taintLabel?: TaintLabel;
}

export interface AutomationRunRecorder {
  start(
    run: { runId: string; automationId: string; organizationId: string; agentId: string },
    ctx: RunCtx,
  ): Promise<void>;
  finish(
    run: { runId: string; organizationId: string; status: "completed" | "halted"; output: unknown },
    ctx: RunCtx,
  ): Promise<void>;
  list(
    organizationId: string,
    automationIds: string[],
    opts: { limit: number },
  ): Promise<AutomationRunRecord[]>;
}
