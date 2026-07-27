// Governance mock data — shapes mirror SCHEMA.sql v2 (ledger · decision_traces · delegations · policies).
// F2 (Approvals inbox) reads the PENDING slice (decision === null); F3 (Execution Ledger) reads the full
// append-only history. One source so the live queue and the archive stay coupled, exactly like the real
// `ledger` table would. NOTE: no naked relationship scores anywhere — warmth is phrased qualitatively.

export type ActorKind = 'agent' | 'human';
export type Decision = 'approved' | 'vetoed' | 'edited_approved' | 'auto_approved' | null;
export type PolicyPhase = 'pre' | 'runtime' | 'post';

export interface PolicyResult {
  phase: PolicyPhase;
  policy: string;        // policies.name
  result: 'pass' | 'flag' | 'block';
  note?: string;
}

export interface DecisionTrace {
  // decision_traces — the *why* behind a proposed action (1:1 with a ledger row)
  signals: string[];     // the Signals that fired
  context: string;       // qualitative context the agent used
  reasoning: string;     // the agent's rationale, in plain language
}

export interface LedgerEntry {
  id: string;
  sourceId?: string;       // originating Signal/capture id when proposal id differs
  proposalId?: string;     // remote proposal bound to a legacy/offline local draft
  ts: string;            // ISO-ish display timestamp
  age: string;           // humanized age for the queue
  actorKind: ActorKind;
  actor: string;         // who proposed it (agent or human name)
  // provenance: on-behalf-of + delegation + Automation Run
  onBehalfOfType?: 'user' | null;
  onBehalfOf?: string | null;
  delegationId?: string | null;
  runId?: string | null;
  chatThreadId?: string;
  chatTurnId?: string;
  action: string;        // verb, e.g. "Send intro email"
  resourceType: 'person' | 'record' | 'community' | 'relation' | 'automation' | 'signal' | 'event' | 'external' | 'memory' | 'help';
  resource: string;      // target label, e.g. "Priya Anand"
  policy: string;        // the policy that forced review (policies.name)
  decision: Decision;    // null === pending (awaiting review)
  // proposed output + optional prior version for the diff drawer
  proposed: string;
  proposalOutput?: unknown; // exact pipeline payload used for edit-then-approve
  prior?: string | null;
  trace: DecisionTrace;
  channel?: string;      // e.g. "Email", "Calendar"
  taintLabel?: {
    version: 1;
    trust: string;
    source: string;
    sensitivity: string;
    instructionRisk: string;
    originChain: Array<{
      source: string;
      ref: string;
      hash: string;
      transform: string;
    }>;
    provenanceHash: string;
  };
}

// ── PENDING (F2 Approvals inbox) — ledger rows where decision IS NULL ─────────────
// Empty by design: real pending approvals come from the authenticated Action Pipeline. This local
// fallback only appears when the API is unavailable, and an honest empty state beats fabricated rows.
export const pendingApprovals: LedgerEntry[] = [];

// ── HISTORY (F3 Execution Ledger) — append-only, decisions already made ───────────
// Same rule: empty local fallback, real history comes from loadLedger().
export const ledgerHistory: LedgerEntry[] = [];

export const allLedger: LedgerEntry[] = [...pendingApprovals, ...ledgerHistory];

// delegations — resolves the "on whose behalf" question (delegations table). Populated once real
// delegations are created; empty here since none are seeded.
export const delegations: Record<string, { from: string; to: string; scope: string }> = {};

export const pendingCount = pendingApprovals.length;

// Veto reason chips → feed the Variance Adjuster (policy_params), never code. Real, generic
// reasons (not fabricated per-scenario copy) — usable regardless of which action is vetoed.
export const vetoReasons = ['Too casual', 'Wrong recipient', 'Bad timing', 'Off-strategy', 'Tone'];

export function decisionLabel(d: Decision): string {
  switch (d) {
    case 'approved': return 'Approved';
    case 'vetoed': return 'Vetoed';
    case 'edited_approved': return 'Edited + approved';
    case 'auto_approved': return 'Auto-approved';
    default: return 'Pending';
  }
}

// token name for a decision's color (kept qualitative, no numeric scores)
export function decisionToken(d: Decision): string {
  switch (d) {
    case 'approved':
    case 'edited_approved': return 'var(--success)';
    case 'vetoed': return 'var(--danger)';
    case 'auto_approved': return 'var(--info)';
    default: return 'var(--warning)';
  }
}
