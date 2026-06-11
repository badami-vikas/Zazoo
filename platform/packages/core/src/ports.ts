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
} from "./types.js";

/** Per-request execution context. Carries the determinism seams — nothing in
 * engine code reads the wall clock or a global RNG directly. */
export interface RunCtx {
  clock: Clock;
  rng: Rng;
  ids: IdGen;
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
}

export interface EventBus {
  emit(event: DomainEvent): Promise<void>;
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
  steps: RitualStepDef[];
}

/** Loads ritual definitions — the `rituals` table (Drizzle) or in-memory in dev. */
export interface RitualRegistry {
  load(workspaceId: string, ritualId: string): Promise<RitualDefinition | null>;
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
