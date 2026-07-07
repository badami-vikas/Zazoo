// Governance local fallback — shapes mirror SCHEMA.sql v2 (ledger · decision_traces · delegations ·
// policies). The live path is data/ledger.ts (loadLedger), which reads the real append-only `ledger`
// table in Supabase. F2 (Approvals inbox) reads the PENDING slice (decision === null); F3 (Execution
// Ledger) reads the full history. This module is only the LOCAL FALLBACK used when Supabase is
// unreachable — it intentionally ships EMPTY (no placeholder ledger rows) so an offline/disconnected
// session shows an honest empty state rather than fake approvals/history.
// NOTE: no naked relationship scores anywhere — warmth is phrased qualitatively.

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
  ts: string;            // ISO-ish display timestamp
  age: string;           // humanized age for the queue
  actorKind: ActorKind;
  actor: string;         // who proposed it (agent or human name)
  // provenance: on-behalf-of + delegation + ritual run (ledger.on_behalf_of_*, delegation_id, run_id)
  onBehalfOfType?: 'user' | null;
  onBehalfOf?: string | null;
  delegationId?: string | null;
  runId?: string | null;
  action: string;        // verb, e.g. "Send intro email"
  resourceType: 'person' | 'initiative' | 'community' | 'ritual' | 'external' | 'memory' | 'help';
  resource: string;      // target label, e.g. "Priya Anand"
  policy: string;        // the policy that forced review (policies.name)
  decision: Decision;    // null === pending (awaiting review)
  // proposed output + optional prior version for the diff drawer
  proposed: string;
  prior?: string | null;
  trace: DecisionTrace;
  channel?: string;      // e.g. "Email", "Calendar"
}

// ── PENDING (F2 Approvals inbox) — ledger rows where decision IS NULL ─────────────
// Empty: real pending approvals come from Supabase via data/ledger.ts (loadLedger).
export const pendingApprovals: LedgerEntry[] = [];

// ── HISTORY (F3 Execution Ledger) — append-only, decisions already made ───────────
// Empty: real history comes from Supabase via data/ledger.ts (loadLedger).
export const ledgerHistory: LedgerEntry[] = [];

export const allLedger: LedgerEntry[] = [...pendingApprovals, ...ledgerHistory];

// delegations — resolves the "on whose behalf" question (delegations table). Empty local fallback;
// real delegations resolve server-side once wired to the live delegations table.
export const delegations: Record<string, { from: string; to: string; scope: string }> = {};

export const pendingCount = pendingApprovals.length;

// Veto reason chips → feed the Variance Adjuster (policy_params), never code.
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
