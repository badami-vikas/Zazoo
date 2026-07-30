/**
 * Ports the Research Run engine depends on (TASK-028).
 *
 * Everything that touches the outside world is an injected port, so the
 * engine's load-bearing parts — the authority model, the bounds, the
 * evidence ledger, and the injection defense — are exercised in unit tests
 * with no network, no browser, and no model.
 */

/** Which tool a planned step wants to use. */
export type ResearchToolName =
  | "search"
  | "read"
  | "find"
  | "click"
  | "type"
  | "note";

/**
 * Authority tier of an action (plan §3).
 *  - `green`  runs autonomously
 *  - `amber`  requires an approved Proposal first
 *  - `red`    is refused outright and never proposed
 */
export type AuthorityTier = "green" | "amber" | "red";

export interface PlannedStep {
  tool: ResearchToolName;
  /** Search query, URL to read, element description, or note text. */
  argument: string;
  /** Text to type — `type` steps only. */
  text?: string;
  /** The planner's one-line reason, shown in the Run timeline. */
  rationale: string;
}

/** A page fetched by the reader port. Text is ALWAYS untrusted. */
export interface PageRead {
  url: string;
  title: string | null;
  /** Visible text, already truncated by the reader to its own bound. */
  text: string;
  retrievedAt: string;
  contentHash: string;
  bytes: number;
}

export interface LocatedElement {
  /** Opaque handle the actuator understands — never a raw selector from a page. */
  ref: string;
  description: string;
  /** Logical-pixel box within the page viewport. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchHit {
  url: string;
  title: string | null;
  excerpt: string;
  providerId: string;
  retrievedAt: string;
}

/** Search, narrowed from the kernel's SearchProvider to what the loop needs. */
export interface ResearchSearch {
  search(objective: string, query: string): Promise<readonly SearchHit[]>;
}

/** BR1: turn a URL into visible text. Webview- or HTTP-backed. */
export interface ResearchPageReader {
  read(url: string): Promise<PageRead>;
}

/** BR2: locate a described element on the current page. */
export interface ResearchLocator {
  find(description: string): Promise<LocatedElement | null>;
}

/** BR3: actuate the current page. Only ever called after an approved Proposal. */
export interface ResearchActuator {
  click(ref: string): Promise<void>;
  type(ref: string, text: string): Promise<void>;
}

export interface ProposalRequest {
  runId: string;
  stepIndex: number;
  tool: ResearchToolName;
  /** Human-readable summary of exactly what will happen if approved. */
  summary: string;
  url: string | null;
}

export type ProposalDecision = "approved" | "rejected";

/** BR3: the existing Proposal → Decision surface, narrowed. */
export interface ResearchProposalGate {
  request(proposal: ProposalRequest): Promise<ProposalDecision>;
}

export interface PlannerContext {
  objective: string;
  /** Prior steps and their outcomes, as trusted engine-authored summaries. */
  history: readonly string[];
  /**
   * Untrusted page/search text gathered so far. The planner implementation
   * MUST place this in a data channel, never in its instruction channel.
   */
  observations: readonly QuarantinedText[];
  stepsRemaining: number;
}

/** External text, structurally marked so it cannot be mistaken for instructions. */
export interface QuarantinedText {
  trustOrigin: "untrusted_external";
  taintLabel: "untrusted_external";
  sourceUrl: string;
  text: string;
}

export interface ResearchPlanner {
  /** Choose the next step, or null to finish early. */
  next(context: PlannerContext): Promise<PlannedStep | null>;
  /** Compose the final brief from the evidence ledger. */
  synthesize(objective: string, evidence: readonly EvidenceEntry[]): Promise<string>;
}

export interface EvidenceEntry {
  stepIndex: number;
  tool: ResearchToolName;
  /** Engine-authored, trusted. */
  summary: string;
  sourceUrl: string | null;
  /** Present whenever the entry carries external content. */
  quarantined?: QuarantinedText;
}

/** BR4: durable step log so a Run survives a restart. */
export interface ResearchLedger {
  append(runId: string, entry: EvidenceEntry): Promise<void>;
  load(runId: string): Promise<readonly EvidenceEntry[]>;
}

export interface ResearchBounds {
  maxSteps: number;
  maxPages: number;
  maxWallClockMs: number;
  maxTotalBytes: number;
}

export const DEFAULT_RESEARCH_BOUNDS: ResearchBounds = {
  maxSteps: 12,
  maxPages: 8,
  maxWallClockMs: 5 * 60 * 1_000,
  maxTotalBytes: 4 * 1024 * 1024,
};

export type StopReason =
  | "planner_finished"
  | "bound_steps"
  | "bound_pages"
  | "bound_wall_clock"
  | "bound_bytes"
  | "cancelled"
  | "refused_red_action"
  | "injection_detected"
  | "planner_failed";

export interface ResearchOutcome {
  runId: string;
  objective: string;
  brief: string;
  evidence: readonly EvidenceEntry[];
  citations: readonly string[];
  stopReason: StopReason;
  stepsTaken: number;
  /** Amber actions that were proposed and rejected, or red actions refused. */
  blockedActions: readonly string[];
  /** Injection attempts observed, reported to the user rather than obeyed. */
  injectionReports: readonly string[];
}

export interface ResearchDeps {
  search: ResearchSearch;
  reader?: ResearchPageReader;
  locator?: ResearchLocator;
  actuator?: ResearchActuator;
  proposals?: ResearchProposalGate;
  planner: ResearchPlanner;
  ledger?: ResearchLedger;
  /** Injected for determinism in tests. */
  now?: () => number;
  /** Cooperative cancellation (BR4 stop button). */
  signal?: { aborted: boolean };
}
