/**
 * Core domain types for the Universal Action Pipeline.
 *
 * Vocabulary is the brand: Person / Community / Initiative / Ritual / Touchpoint
 * / Signal. Never Lead / Deal / Pipeline / Contact.
 */

/** Actions a request can take against a resource (mirrors SCHEMA permissions.action). */
export type Action = "read" | "write" | "execute" | "share" | "archive";

/** Who is acting. */
export type ActorType = "user" | "team" | "agent";

/**
 * Resource types the governance spine can authorize against.
 * Mirror + Operational + Infra planes (see node_types in SCHEMA.sql).
 */
export type ResourceType =
  | "person"
  | "community"
  | "initiative"
  | "touchpoint"
  | "ritual"
  | "tool"
  | "file"
  | "signal"
  | "policy"
  | "policy_param"
  | "skill"
  | "agent"
  | "role"
  | "permission"
  | "ledger"
  | "delegation"
  | "integration"
  // Special read targets (not table rows):
  | "network_graph:full"
  // Internet egress (the API gate): outbound send + inbound sourcing of internet data.
  | "external:send"
  | "external:fetch";

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

/** Context for ephemeral grants — minted per ritual/initiative run, expiring. */
export interface RunContext {
  type: "initiative" | "community" | "ritual";
  id: string;
  runId?: string;
}

/** A mutation request entering the pipeline. */
export interface ActionRequest {
  workspaceId: string;
  actor: Actor;
  onBehalfOf?: OnBehalfOf;
  action: Action;
  resourceType: ResourceType;
  resourceId?: string;
  /** The proposed change payload, handed to the Skill that produces the output. */
  inputs: unknown;
  /** Names the Skill/handler that produces the proposed output. */
  skill: string;
  /** Data tier this request asks to touch (the access dropdown). Absent = 'all'. */
  dataScope?: import("./data-scope.js").DataScope;
  context?: RunContext;
  /** Trace seed: ties a request to its originating event/signal. */
  seed?: string;
}

export type PolicyPhase = "pre" | "runtime" | "post";
export type PolicyEffect = "allow" | "block" | "require_approval";

export interface PolicyResult {
  policyId: string;
  phase: PolicyPhase;
  effect: PolicyEffect;
  reason: string;
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
  /** Structured before/after, surfaced in the Review inbox. */
  diff?: unknown;
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
  workspaceId: string;
  actorType: ActorType;
  actorId: string;
  onBehalfOfType?: "user" | "team";
  onBehalfOfId?: string;
  delegationId?: string;
  action: Action;
  resourceType: ResourceType;
  resourceId?: string;
  inputs: unknown;
  proposedOutput?: unknown;
  /** null until a human decides; then approve|veto|edit|auto. */
  userDecision: Decision | "auto" | null;
  diff?: unknown;
  policyResults: PolicyResult[];
  /** Links a decision row back to the proposal it resolves. */
  refLedgerId?: string;
  seed?: string;
  createdAt: string;
}

/** Bus event emitted after a committed action (drives signals downstream). */
export interface DomainEvent {
  id: string;
  workspaceId: string;
  type: string;
  entityType: ResourceType;
  entityId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
