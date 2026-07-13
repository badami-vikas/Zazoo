# 2026-07-12 — Agent-roadmap strengthening pass (JobPilot · Calendar · Builder · Governance · Learning)

**Trigger**: user verdict — "I'm not happy with jobpilot, calendar, builder agent, governance agent, learning agent roadmap. Strengthen it."

**Diagnosis**: two distinct weaknesses. (1) JobPilot/Calendar/Builder had strong design/business/technical lenses but thin delivery sections — one-line slices sharing a generic exit gate, no dependencies, no success measures, no risks. Not executable, not falsifiable. (2) Governance Agent and Learning Agent had **no roadmap at all** — paragraph descriptions inside the foundational-agents doc, despite being 2 of the 4 permanent platform agents.

## Delivered

**Two NEW dedicated roadmaps** (grounded in a code audit of what actually exists, not assumptions):

- [Governance Agent roadmap](../docs/raw/governance-agent-roadmap-2026-07.md) (GA0–GA6). Audit finding: the trust-model *mechanisms* are built + tested (ADR-012 — computeRisk, lifecycle, approvals floors, authority, agent-floor, pipeline) but the agent *identity* is a prompt + one LLM call; trustGrants lookup hardcoded `[]`, budgets in-memory, no decider identity, org-health paper-only. Framing invariant: **the kernel decides, the agent explains** — an LLM never computes risk, never widens grants, never decides above MINOR. GA3 ships the MINOR auto-approve carve-out as a structural decider identity in `decide()` with zero model calls in the decision path; GA5 (import provenance/signatures) must land before Commons ingestion opens.
- [Learning Agent roadmap](../docs/raw/learning-agent-roadmap-2026-07.md) (LA0–LA6). Audit finding: nearly all greenfield — Memory/Knowledge primitive absent, Mem0 adapter unbuilt, PromptAssembler unbuilt, competitor-discovery "policy decided, no mechanism", and the security audit flags Learning as the platform's primary untrusted-input (injection) surface. Framing invariant: **taint-first** — provenance/taint tiers + a permanent injection eval suite ship in LA0, not retrofitted; suggested-then-accepted memories; SSRF-hardened fetch before any crawler; graph stays source of truth over vectors. PromptAssembler is one shared build with Builder BA0.

**Three STRENGTHENED delivery sections** ([jobpilot](../docs/raw/jobpilot-module-plan-2026-07.md) §6, [calendar](../docs/raw/calendar-module-plan-2026-07.md) §6, [builder](../docs/raw/builder-agent-roadmap-2026-07.md) §6): every slice now carries goal, depends_on, deliverables, testable exit_criteria (including negative tests for each governance bypass), plus new §6.1 success measures and §6.2 risk registers with monitored hard invariants (unapproved submissions/writes/activations == 0, wrong MINOR auto-approvals == 0, sandbox escapes == 0, cross-plane leaks == 0, RLS leaks == 0).

**Cross-roadmap dependency graph now explicit**: Builder BA4 ← Governance GA1 risk blocks · Builder BA1+ ← Learning LA3/LA4 research · PromptAssembler = LA1+BA0 one build · GA4 ← EVAL-1 scoring reducers (Batch 3) · GA5 provenance ← before Commons (same requirement as egg-commons supply-chain-trust, one implementation) · CAL4 hard-blocked on SEC-5/SEC-6 · JP6 ← CAL3+.

## Artifacts

- New: `docs/raw/governance-agent-roadmap-2026-07.md`, `docs/raw/learning-agent-roadmap-2026-07.md`, `docs/wiki/governance-agent.md`, `docs/wiki/learning-agent.md`
- Strengthened: `docs/raw/jobpilot-module-plan-2026-07.md`, `docs/raw/calendar-module-plan-2026-07.md`, `docs/raw/builder-agent-roadmap-2026-07.md` (§6/§6.1/§6.2)
- Updated: `docs/wiki/index.md`, `docs/wiki/foundational-agents.md`, `docs/wiki/builder-agent.md`, `docs/wiki/calendar.md`, `docs/PROGRESS.md` Plan Registry
- Decision record: ADR-054 in `docs/raw/decisions-log.md` (renumbered on merge; ADR-052 = terminology canon on main); ledger row in `docs/log.md`

All plans remain `status: proposed`; no H2 sequencer reorder; pull-forwards go through `docs/APPROVALS.md`. Docs only — no code changed.
