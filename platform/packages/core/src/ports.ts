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

/** Per-request execution context. Carries the determinism seams — nothing in
 * engine code reads the wall clock or a global RNG directly. */
export interface RunCtx {
  clock: Clock;
  rng: Rng;
  ids: IdGen;
  /** Provenance of the most-tainted input threaded into this run (PI-1). Present
   * when the run's context includes ingested content; lets a downstream policy
   * (PI-2) see that the turn is tainted. PI-1 only surfaces it — no gating yet. */
  taint?: TrustOrigin;
}

export interface RoleQuery {
  /** Role ids the principal (user/team) holds in the workspace. */
  rolesForPrincipal(workspaceId: string, actor: Actor): Promise<string[]>;
  /** Grants attached to a role. */
  grantsForRole(roleId: string): Promise<GrantRule[]>;
  /** Direct (non-role) grants for an actor. */
  directGrants(workspaceId: string, actor: Actor): Promise<GrantRule[]>;
}

export interface AgentQuery {
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
    workspaceId: string,
    actor: Actor,
    context: RunContext | undefined,
    nowISO: string,
  ): Promise<GrantRule[]>;
}

export interface PolicyEvalInput {
  workspaceId: string;
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
   * Pending proposals awaiting a human decision (`userDecision IS NULL`) — a decision
   * row always has `userDecision` set (approve/veto/edit/auto), so this predicate alone
   * distinguishes proposals from the decisions that resolve them, no separate `status`
   * column needed. Ordered newest-first; paginated by the caller (offset/limit).
   */
  listPending(workspaceId: string, opts: { limit: number; offset: number }): Promise<{ items: LedgerEntry[]; total: number }>;
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
  workspaceId: string;
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
  linkedEntity?: { type: "person" | "memory" | "touchpoint"; id: string } | null;
  provenance: { tool: string; version: string; model?: string };
  capturedAt: string;
  archivedAt?: string | null;
}

/**
 * LOCAL-plane media store — the seam the camera Tool persists blobs through. The
 * in-memory adapter lives in `memory/stores.ts`; the pglite (bytea) adapter lives
 * in `@bridge/db`. Blobs NEVER cross the gate. Append-only: a row's blob + core
 * metadata are immutable after `put`; only status/ledgerId/linkedEntity/caption/
 * archivedAt mutate. No hard delete — `archive()` sets `archivedAt`.
 */
export interface LocalMediaStore {
  put(rec: MediaCaptureRecord, blob: Uint8Array): Promise<MediaCaptureRecord>;
  get(id: string): Promise<MediaCaptureRecord | null>;
  getBlob(id: string): Promise<Uint8Array | null>;
  list(filter?: { status?: MediaStatus; kind?: MediaKind; workspaceId?: string }): Promise<MediaCaptureRecord[]>;
  update(id: string, patch: Partial<MediaCaptureRecord>): Promise<MediaCaptureRecord>;
  archive(id: string): Promise<void>;
}

export interface EventBus {
  emit(event: DomainEvent): Promise<void>;
}

/**
 * ModelProvider — the seam every model call in the kernel goes through (never
 * a direct SDK/fetch call inline in a skill/tool). `plane` mirrors the
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
  complete(req: { system?: string; prompt: string; maxTokens?: number }): Promise<{ text: string }>;
  embed?(texts: string[]): Promise<number[][]>;
}

/** A Skill is the atomic unit of work — produces a proposed output from inputs. */
export interface Skill {
  name: string;
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

/** A ritual step as stored in the registry (rituals.skill_pipeline jsonb). */
export interface RitualStepDef {
  skill: string;
  action: Action;
  resourceType: ResourceType;
  resourceId?: string;
  /** Static inputs from the config; merged with run-time params at execution. */
  inputs?: Record<string, unknown>;
  /** Data tier this step may touch (the per-step access dropdown). Absent = 'all'. */
  dataScope?: import("./data-scope.js").DataScope;
}

/** A ritual definition resolved from the registry (P2: rituals are config rows). */
export interface RitualDefinition {
  id: string;
  name: string;
  workspaceId: string;
  /** Owning Agent. Optional only so legacy/unbound rows can be loaded and rejected explicitly at execution. */
  agentId?: string;
  /** Execution residency for the owning Agent. Absent preserves the local-first default. */
  agentPlane?: import("./types.js").Plane;
  steps: RitualStepDef[];
}

/** Loads ritual definitions — the `rituals` table (Drizzle) or in-memory in dev. */
export interface RitualRegistry {
  load(workspaceId: string, ritualId: string): Promise<RitualDefinition | null>;
  save(definition: RitualDefinition): Promise<void>;
}

/**
 * Loads tool definitions — the `tools` table (`composition` jsonb). A Tool is a
 * composition of skills bound to a surface; invoking one runs its steps through
 * the SAME governed pipeline (config → pipeline, like rituals). Reuses the ritual
 * definition shape.
 */
export interface ToolRegistry {
  load(workspaceId: string, toolId: string): Promise<RitualDefinition | null>;
}

/** Records ritual_runs (start/finish) — feeds the ledger linkage. */
export interface RitualRunRecorder {
  start(
    run: { runId: string; ritualId: string; workspaceId: string; actorId: string },
    ctx: RunCtx,
  ): Promise<void>;
  finish(
    run: { runId: string; status: "completed" | "halted"; output: unknown },
    ctx: RunCtx,
  ): Promise<void>;
}
