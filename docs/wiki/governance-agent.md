# Governance Agent

full: [../raw/governance-agent-roadmap-2026-07.md](../raw/governance-agent-roadmap-2026-07.md)

1 of 4 permanent agents (ADR-046). Sole audited exception to agent-floor
approve-DENY — scoped to auto-approve MINOR only (ADR-020 §5).

**Paradox roadmap fixes (audited 2026-07-12)**: mechanisms BUILT + tested
(ADR-012: computeRisk, lifecycle, approvals floors, authority resolver,
agent-floor, pipeline, kill switch) — but agent identity = prompt + one
512-token LLM call, touches zero kernel functions. trustGrants hardcoded
`[]` at both router call-sites (table exists, never read). Budgets
in-memory only, lost on restart. No decider identity. Org-health rollup
paper-only.

**Core invariant: kernel decides, agent explains.** Bands/floors/authority
= deterministic kernel functions. LLM never computes risk, never widens
grant, never decides above MINOR. Model narrates decisions kernel already
made.

**Failures:** Governance owns policy/control failures, not every error. Engine
handles retry/timeout/idempotency/compensation/safe-stop. Learning finds repeat
patterns + suggests improvements. Builder changes broken capabilities. Typed
Failure Event routes one owner; Governance can suspend/tighten/revalidate and
escalate, never invent runtime repair via LLM.

**Slices GA0–GA6**:
- GA0 DONE — trust-model substrate (ADR-012), gaps carried forward.
- GA1 grounded identity — @governance answers backed by real
  ledger/manifest/authority reads (hallucination probe gate); governance
  half of proposal card (band/origin/trifecta/closure/precedent); Builder
  BA4 boundary-validation handoff.
- GA2 grants + budgets live — kill hardcoded `[]`; grant lifecycle
  (lower-only, expiring, revocable); budgets → policy_params (survive
  restart). Loosening always human-approved proposal.
- GA3 MINOR carve-out ships — distinguished decider identity in decide():
  governance-agent + dual key (2 lowest bands AND origin
  built-in/template) + budget + kill-switch-off → ledgered auto-approve.
  Zero model calls in decision path (code-audit gate). Boundary suite =
  permanent CI. Wrong auto-approvals == 0 or no ship.
- GA4 org health — autonomy pressure / trust debt / approval load /
  violation trend (agent-quality-eval-model defs); remediation drafts
  never auto-applied. Blocked on EVAL-1 reducers (Batch 3).
- GA5 compliance + supply chain — audit reports reconcile 1:1 with
  ledger; provenance/signature verify on imports (security-audit F1 —
  MUST land before Commons ingestion opens); floor-integrity canary
  (continuous seeded DENY attempts).
- GA6 team scale — schema v2 punch-list closes: roles+inheritance,
  delegations on_behalf_of, ephemeral_grants persisted, role-routed
  audiences.

**Metrics**: wrong MINOR auto-approvals == 0, canary passes == 0,
unapproved loosening == 0 (hard invariants, monitored). Time-to-decision
by band. % auto-handled rises WITHOUT precision loss.

**Top risks**: carve-out widens by increments (dual key structural,
widening = major + APPROVALS) · LLM creeps into decision path (code-audit
exit criteria) · rubber-stamp drift · budget state loss (GA2 before GA3,
hard ordering) · self-governance paradox (proposer ≠ decider; agent never
approves own proposals).

No sequencer reorder. GA1–GA3 refine P0 trust-model track.
