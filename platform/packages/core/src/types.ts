/**
 * Core domain types for the Universal Action Pipeline.
 *
 * Vocabulary is the brand: Person / Community / Event / Signal. Never Lead /
 * Contact. Canonical Record/Event identifiers are used throughout
 * their approved vocabulary migrations are incomplete.
 */

/** Actions a request can take against a resource (mirrors SCHEMA permissions.action).
 * `approve` is the control-plane action of resolving a pending proposal — it is NOT
 * a proposable mutation (clients never `propose` it; the wire enum stays narrower).
 * It exists so the authority spine can gate WHO may approve (agents never can). */
export type Action = "read" | "write" | "execute" | "share" | "archive" | "approve";

/** Who is acting. */
export type ActorType = "user" | "team" | "agent";

/**
 * Resource types the governance spine can authorize against.
 * Mirror + Operational + Infra planes (see node_types in SCHEMA.sql).
 *
 * A RUNTIME array, with `ResourceType` derived from it, because a
 * compile-time-only union cannot be consumed by the validators that must agree
 * with it. `automation-stores.ts` kept a hand-written zod mirror of this list
 * and drifted five members behind it (2026-09-08); the symptom was an
 * Automation step over a Relation or a Module installation failing as
 * `invalid_enum_value`, which reads like a corrupt database row rather than a
 * list nobody updated. Adding a member here now reaches every consumer at
 * once — there is no second list to forget.
 */
export const RESOURCE_TYPES = [
  "person",
  "community",
  "relation",
  "event",
  "record",
  "automation",
  "module",
  "module_installation",
  "organization_definition",
  "file",
  "signal",
  "policy",
  "policy_param",
  "skill",
  "capability",
  "agent",
  "role",
  "permission",
  "ledger",
  "delegation",
  "integration",
  // K3 (TASK-047): a knowledge-substrate claim — materialized only through a
  // governed proposal on this resource type (decisionRef on every row).
  "claim",
  // Special read targets (not table rows):
  "network_graph:full",
  // Internet egress (the API gate): outbound send + inbound sourcing of internet data.
  "external:send",
  "external:fetch",
] as const;

export type ResourceType = typeof RESOURCE_TYPES[number];

/**
 * The plane an actor runs on (local-first gate). `local` = the customer-controlled
 * tier on the machine/VPC: drafts actions, REQUESTS internet data, never touches the
 * internet directly, and may read the private relationship tier. `cloud` (egress) =
 * SOURCES internet data + canonical, reachable only through the gate, and may NEVER
 * read the private/local tier. Default = local (private-first). See wiki/architecture.md.
 */
export type Plane = "local" | "cloud";

export interface Actor {
  type: ActorType;
  id: string;
  /** Which plane this actor runs on. Absent = 'local' (private-first default). */
  plane?: Plane;
}

export interface OnBehalfOf {
  type: "user" | "team";
  id: string;
  delegationId?: string;
}

/** A single permission rule. `null` resourceId => type-wide grant. */
export interface GrantRule {
  resourceType: ResourceType;
  resourceId: string | null;
  action: Action;
  effect: "allow" | "deny";
  /** Tier this grant admits (the access dropdown). Absent = 'all'. */
  dataScope?: import("./data-scope.js").DataScope;
}

/** Context for ephemeral grants — minted per Automation/Record run, expiring.
 * `child_agent_run` (AGS2) is a bounded delegated Run created by a parent
 * Agent — see child-agent-run.ts. It reuses this same context shape (id =
 * the child run id, runId = the parent run id) purely for ledger/audit
 * attribution; a child run's authority is bounded by construction
 * (`deriveChildAgentRun`'s intersection), not by an ephemeral-grant lookup. */
export interface RunContext {
  type: "record" | "community" | "automation" | "child_agent_run";
  id: string;
  runId?: string;
}

/** Legacy v0 compatibility only. Canonical runtime tracking uses `TaintLabel`. */
export type TrustOrigin = import("./taint.js").LegacyTrustOrigin;

/** A mutation request entering the pipeline. */
export interface ActionRequest {
  organizationId: string;
  actor: Actor;
  onBehalfOf?: OnBehalfOf;
  action: Action;
  resourceType: ResourceType;
  resourceId?: string;
  /** The proposed change payload, handed to the Skill that produces the output. */
  inputs: unknown;
  /** Canonical server-derived label for `inputs`. Client payloads never supply it. */
  /** Required for new runtime boundaries. Optional only for explicit v0 compatibility;
   * the pipeline maps absence to UNKNOWN_LABEL, never trusted. */
  taintLabel?: import("./taint.js").TaintLabel;
  /** Names the Skill/handler that produces the proposed output. */
  skill: string;
  /** Data tier this request asks to touch (the access dropdown). Absent = 'all'. */
  dataScope?: import("./data-scope.js").DataScope;
  context?: RunContext;
  /** Trace seed: ties a request to its originating event/signal. */
  seed?: string;
  /** Provenance of the input driving this request (PI-1). Threaded onto the
   * ledger row so a proposal ingested from untrusted content is auditable as
   * such. Absent = not ingested from a tagged source (kernel-authored). */
  trustOrigin?: TrustOrigin;
  /**
   * AGS1 — binds this request to the typed Goal/Task pair the invoking Agent
   * was assigned, so `pipeline.propose` can resolve Skill eligibility from
   * the Goal/Task contract rather than the Agent's identity alone (see
   * skill-manifest.ts's `resolveSkillForTask`). Required only for skills that
   * have a registered `SkillManifest`; omitted for the existing ungoverned/
   * interim skill catalog, so this is purely additive — no existing caller's
   * behavior changes by this field's presence.
   */
  goalTaskRef?: { goalId: string; taskId: string };
}

export type PolicyPhase = "pre" | "runtime" | "post";
export type PolicyEffect = "allow" | "block" | "require_approval";

export interface PolicyResult {
  policyId: string;
  phase: PolicyPhase;
  effect: PolicyEffect;
  reason: string;
}

/**
 * The subset of `PolicyEffect` that is actually actionable in the POST-commit
 * phase. By the time `pipeline.ts`'s `#commit` runs post-policy, the ledger row
 * is already appended and (for approve/edit/auto) already committed — there is
 * no runtime hook left that a `block` effect could act on. `block` is therefore
 * deliberately excluded here: it is not "an effect we ignore", it is an effect
 * that cannot be represented in this phase's type at all, so a post-commit
 * policy can never even type-check as blocking. Only advisory/logging effects
 * survive commit — `require_approval` also makes no sense post-commit (the
 * review gate has already been passed), so the set narrows to `allow` (no-op)
 * plus room for future advisory-only signals.
 */
export type PostCommitEffect = Exclude<PolicyEffect, "block" | "require_approval">;

/** A `PolicyResult` restricted to the phase="post" call site, whose `effect`
 * cannot be `block` (see `PostCommitEffect`). Used to type `#commit`'s discarded
 * (but now explicitly audited/logged) post-policy evaluation in `pipeline.ts`. */
export interface PostCommitPolicyResult extends Omit<PolicyResult, "phase" | "effect"> {
  phase: "post";
  effect: PostCommitEffect;
}

export interface AuthorityDecision {
  allowed: boolean;
  /** Human-readable basis for the decision (audited). */
  reason: string;
  /** Which layer settled it: 'deny' | 'ephemeral' | 'role' | 'principal' | 'default'. */
  basis: "deny" | "ephemeral" | "role" | "principal" | "default";
  /** Effective data tier the actor may touch — the data layer filters reads to this. */
  dataScope: import("./data-scope.js").EffectiveDataScope;
}

/** The Skill's output before it is committed (draft-then-approve). */
export interface SkillOutput {
  proposedOutput: unknown;
  /** Output label joined by the pipeline with every input/context label. */
  taintLabel?: import("./taint.js").TaintLabel;
  /** Structured before/after, surfaced in the Review inbox. */
  diff?: unknown;
  /** Provenance introduced by the Skill's output. External provider/tool output
   * sets `untrusted_external` here at the ingestion edge; the pipeline combines
   * it with input/context taint and persists the most restrictive origin. */
  trustOrigin?: TrustOrigin;
}

/** Minimal execution snapshot fields the eval reducers read. */
export interface ExecutionSnapshot {
  terminalState?: "completed" | "error" | "timeout" | "fallback" | "chain_depth_exceeded";
  error?: boolean;
  timedOut?: boolean;
  fallbackUsed?: boolean;
  chainDepthExceeded?: boolean;
  violationCount?: number;
  planeGateRejected?: boolean;
  approvalBypassAttempted?: boolean;
  modelVersion?: string;
  tokenCount?: number;
  actionInputCount?: number;
  startedAt?: string;
  finishedAt?: string;
  cost?: number;
  baselineCost?: number;
}

export type ProposalStatus = "pending_review" | "applied" | "rejected";

/** What the pipeline returns from `propose`. The id IS the ledger entry id. */
export interface Proposal {
  id: string;
  status: ProposalStatus;
  request: ActionRequest;
  authority: AuthorityDecision;
  policyResults: PolicyResult[];
  output?: SkillOutput;
  /** Set when status='rejected'. */
  rejectionReason?: string;
}

export type Decision = "approve" | "veto" | "edit";

/** Append-only audit row (mirrors SCHEMA.ledger). */
export interface LedgerEntry {
  id: string;
  /** Store-assigned append order; database-generated for the persistent ledger. */
  appendSequence?: number;
  organizationId: string;
  actorType: ActorType;
  actorId: string;
  onBehalfOfType?: "user" | "team";
  onBehalfOfId?: string;
  delegationId?: string;
  action: Action;
  /** The Skill that produced this row's output — `ActionRequest.skill`, persisted.
   * This is the capability-attribution key: for a Skill capability the Skill id and
   * the manifest id are the same string (see packages/module-manifests), so grouping ledger
   * rows by `skill` is what lets the Agent Quality Vector score a capability from
   * real production episodes instead of from a synthetic dataset. Optional only for
   * rows appended before migration 0037; never omitted by the pipeline. */
  skill?: string;
  resourceType: ResourceType;
  resourceId?: string;
  inputs: unknown;
  proposedOutput?: unknown;
  /** null until a human decides; then approve|veto|edit|auto. */
  /** `superseded`: withdrawn by the machine because a newer identical proposal
   * from the same Automation replaced it (never a Human decision, never
   * executed) — ADR 2026-09-04 "Approvals belong to Tasks". */
  userDecision: Decision | "auto" | "superseded" | null;
  diff?: unknown;
  policyResults: PolicyResult[];
  /** Links a decision row back to the proposal it resolves. */
  refLedgerId?: string;
  executionSnapshot?: ExecutionSnapshot;
  seed?: string;
  /** Data tier this action touched (the access dropdown) — audit completeness;
   * threaded through unchanged when decide() replays this entry as a Proposal's
   * request instead of being silently dropped. */
  dataScope?: import("./data-scope.js").DataScope;
  /** Original run context (Record/Community/Automation + runId) this action ran
   * under — audit completeness; threaded through unchanged on replay. */
  context?: RunContext;
  /** Effective provenance of the input and Skill output (PI-1) — threaded
   * unchanged on replay so the audit spine records whether a committed row
   * carries untrusted external content. */
  trustOrigin?: TrustOrigin;
  /** Canonical versioned runtime taint. Never nullable; old rows backfill UNKNOWN. */
  taintLabel?: import("./taint.js").TaintLabel;
  createdAt: string;
}

/** Bus event emitted after a committed action (drives signals downstream). */
export interface DomainEvent {
  id: string;
  organizationId: string;
  type: string;
  entityType: ResourceType;
  entityId?: string;
  payload: Record<string, unknown>;
  taintLabel?: import("./taint.js").TaintLabel;
  createdAt: string;
}
