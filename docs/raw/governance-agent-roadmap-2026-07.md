---
title: Governance Agent Roadmap — Design, Business, and Technical
type: raw
doc_kind: plan
status: proposed
companions: [builder-agent-roadmap-2026-07.md, learning-agent-roadmap-2026-07.md, bridge-foundational-agents-onboarding-2026-07.md, agent-quality-eval-model-2026-07.md, module-evolution-system-2026-07.md, security-audit-2026-07.md]
related_wiki: ../wiki/governance-agent.md
updated: 2026-07-12
tags: [governance-agent, trust-model, risk, approvals, authority, agent-floor, org-health, audit]
---

# 0. Product decision

The Governance Agent is one of Bridge's four permanent platform Agents (ADR-046). It evaluates permissions, interprets policy, assesses risk, routes approvals, maintains compliance/audit history, validates capability boundaries, and monitors org health. It carries the roster's two distinguishing properties: it is the **sole, audited exception** to the agent-floor's non-removable `approve`-on-governance-resources DENY — and that exception is scoped to **auto-approve MINOR only** (ADR-020 §5, ADR-046).

**Ground truth (audited 2026-07-12).** The paradox this roadmap resolves: the *mechanisms* the Governance Agent will wield are built and tested (ADR-012) — but the agent identity that wields them is a prompt + one LLM call:

```yaml
current_state:
  built_and_tested_kernel:
    - computeRisk: packages/core/src/capability/risk.ts — risk computed from manifests, never declared; 5 bands; composite = max over dependency closure
    - lifecycle: capability/lifecycle.ts — draft→validated→approved→active→trusted→deprecated→archived; failure auto-suspends ("safety never queues"); resume needs approval; trusted = evidence + 90-day TTL
    - approvals: capability/approvals.ts — requiredApproval by band; External = non-removable human floor; audience raises never lowers; kill switch → explicit_human
    - authority: authority.ts resolveAuthority — deny-by-default, (role ∩ capability_scope) ∪ ephemeral − deny, delegation-intersected
    - agent_floor: agent-floor.ts — protected governance resources + external:send / network_graph:full always-denied; checked as Layer 0
    - pipeline: pipeline.ts propose/decide — agents always require approval; decide is append-only ledger; agents floor-denied from approving (audited rejection)
  unbuilt_agent_identity:
    - "@governance" dispatch (packages/core/src/agents.ts + router.ts converse) = static prompt + 512-token model call; proposal: null; touches NO kernel function
    - no decider identity: nothing lets a governance agent identity auto-approve anything; the MINOR carve-out exists only in ADRs
    - trustGrants hardcoded [] at both router call-sites — the trust_grants table exists but is never read; grant-based auto-approve is inert
    - AUTO_ACTIVATION_BUDGETS in-memory only (20 info / 10 advisory per day) — not in policy_params, lost on restart
    - org-health rollup (agent-quality-eval-model §org-health) unbuilt; minor/moderate/major routing defined on paper only
    - schema v2 governance punch-list still open: roles+inheritance, delegations on_behalf_of, ephemeral_grants persistence, budgets-as-policy
```

**Load-bearing invariant — the kernel decides, the agent explains.** Risk bands, approval floors, and authority resolution stay deterministic kernel functions. The Governance Agent identity *wraps* them: it routes, explains, recommends, monitors, and holds the one audited MINOR auto-approve. An LLM never computes risk, never widens a grant, and never decides above MINOR. This is what separates Bridge from "AI safety officer" theater — the model narrates decisions the kernel already made deterministically.

Competitive frame: agent-ops platforms (Retrace, AgentOS) and the builder platforms' shared finding (builder-agent roadmap §4: governance is universally the paywall) confirm governance-as-kernel is the moat. OpenFGA/OPA/Cedar/SpiceDB stay PARKED (decisions-log): custom CBAC + policy + ledger + trust model IS the differentiation; revisit only at enterprise-ReBAC scale (P6+).

# 1. Design lens — governance surfaces

## 1.1 No governance console

Like the Builder, the Governance Agent is invisible infrastructure. Its surfaces are embedded: the Approvals queue (its primary "screen"), risk chips on proposal cards, the org-health panel, `@governance` chat answers, and the audit trail. Users never configure policy in YAML; they answer confidence-tiered questions ("should Tools like this one auto-activate for you from now on?") that materialize as trust grants and policy_params — themselves governed resources.

## 1.2 The approval card, governance half

Every proposal card carries the Governance Agent's computed contribution: risk band + origin axis, lethal-trifecta verdict, dependency closure, what-this-can-touch scope summary, precedent ("you approved 4 similar"), and a recommendation with rationale. For MINOR items it shows the *auto-approved* receipt instead — band, origin, budget consumed, undo affordance — auto-approve is visible, never silent.

## 1.3 Explanations on demand

`@governance` answers "why was this blocked / auto-approved / escalated," "what can this agent touch," "who approved X," "what would happen if I granted Y" — each answer grounded in real ledger/authority/manifest reads (LA-style retrieval over governance data), never from prompt memory.

## 1.4 Org health

A rollup panel (agent-quality-eval-model §org-health): autonomy pressure (Active/Trusted capabilities with success < .85), trust debt (decaying trust windows, un-re-validated dependencies), approval load (pending by band, median time-to-decision), violation trend (violationCount slope). Each signal links to a governed remediation proposal (tighten budgets, demote, re-validate) — action over analytics.

## 1.5 Kill switch and undo

The kill switch (built: forces explicit_human everywhere) gets a surface: one control, per-workspace, with visible state. Every auto-approved MINOR is individually revertible (deactivate + fork-from-history), and revoking a trust grant is one click from any receipt.

# 2. Business lens

## 2.1 Processes covered

```yaml
covered_processes:
  risk_assessment:
    - computed risk on every capability draft/change (manifest-derived, dependency-closed)
    - origin axis (built-in/template/community/AI-generated) + lethal-trifecta escalation
  approval_routing:
    - minor/moderate/major routing (agent-quality-eval-model): minor = 2 lowest bands AND origin ∈ {built-in, template}; moderate = Transformational OR community origin; major = Operational/External OR any safety touch
    - MINOR auto-approve under budget, ledgered with rationale; everything else routed to the right human audience
  policy_interpretation:
    - plain-language answers grounded in authority/ledger/manifest reads
    - confidence-tiered policy elicitation → trust grants / policy_params (governed writes)
  compliance_and_audit:
    - append-only ledger queries; audit reports; provenance verification on imports
  boundary_validation:
    - capability-boundary checks pre-Approvals (Builder handoff); agent-floor integrity monitoring
  org_health:
    - autonomy pressure / trust debt / approval load / violation trend → remediation proposals
```

## 2.2 Explicitly not covered

```yaml
not_covered_or_not_authoritative:
  - deciding above MINOR — moderate/major are human-only, always; External band human-approved at launch, non-removable floor
  - computing risk with an LLM — bands/floors/authority are deterministic kernel functions; the model only explains
  - widening any grant, scope, or budget autonomously — every loosening is a governed proposal a human approves
  - modifying the agent-floor, kill switch, or its own carve-out (self-modification of governance = major, human-only, and structurally denied)
  - approving anything the Governance Agent itself proposed (separation of proposer and decider)
  - suppressing, editing, or reordering ledger history (append-only; rejections are audited rows)
  - acting as a legal/compliance authority — reports inform, they are not certifications
  - a standalone policy console or YAML policy surface for end users
```

# 3. Technical lens

## 3.1 Skills

```yaml
governance_skills:
  - risk-explanation                    # narrate computeRisk output + dependency closure, grounded reads only
  - approval-routing                    # minor/moderate/major classification → audience; MINOR → decider path
  - minor-auto-approve                  # THE carve-out: dual-key (band AND origin) + budget + ledger receipt
  - trust-grant-lifecycle               # elicit → propose grant; expiry/revocation; grants only LOWER toward auto
  - policy-question-answering           # grounded in authority/ledger/manifest reads
  - audit-report-generation
  - provenance-and-signature-verification  # imports/Commons packages (security audit F1)
  - boundary-validation                 # pre-Approvals capability-boundary check (Builder BA4 handoff)
  - org-health-rollup                   # the four computable signals → panel + remediation candidates
  - budget-tuning-proposal              # violation trend → tighten-budgets draft (never auto-applied)
```

## 3.2 Automations

```yaml
governance_automations:
  - risk-recompute-on-manifest-or-dependency-change   # incl. trusted→validated demotion (built, gains an owner)
  - trust-window-expiry-sweep                          # 90-day TTL re-validation prompts
  - approval-queue-aging-alert                         # stale pending items escalate visibility, not authority
  - violation-trend-monitor                            # slope → budget-tightening proposal
  - auto-approve-budget-reset-and-receipt-digest       # daily; digest of every MINOR auto-approval
  - floor-integrity-canary                             # continuously proves agent-floor DENY holds (seeded attempts)
  - import-provenance-check-on-install
```

Every Automation carries trigger, idempotency key, budget, retry/backoff, owner, stop condition, risk band, immutable run record. None of them widen anything; tightening can be automatic-with-receipt, loosening is always a proposal.

## 3.3 Decider identity architecture

The MINOR carve-out is implemented as a **distinguished decider identity in the pipeline**, not a prompt behavior:

- `decide()` gains one narrow, structural path: caller identity = governance-agent AND classification = MINOR (band ∈ 2 lowest AND origin ∈ {built-in, template}) AND budget available AND kill switch off → approve with `decided_by: governance-agent`, rationale, and budget receipt in the ledger row. Every other agent-caller path keeps the existing audited floor-DENY.
- The classification inputs come from `computeRisk` + manifest origin — the LLM is not in this code path at all. Dual-axis (impact × reversibility, ADR-020 §5) layers on as a *further restriction* once `risk-mechanism-auto-mode-practices.md` lands; until then MINOR = the band+origin dual key only.
- Budgets move from in-memory constants into `policy_params` (governed resource, user-tunable through elicitation, survives restart).
- trust_grants store lookup replaces the hardcoded `[]` at both router call-sites; grants can only lower audience toward auto, never raise scope.

# 4. Reuse-first source map

```yaml
reuse_policy:
  order:
    - wrap_existing_kernel_primitives   # the roadmap IS mostly this
    - adapt_existing_patterns_with_attribution
    - build_minimal_native_gap_only_after_documented_review
  gates: [pinned_commit, license, transitive_dependencies, security_and_prompt_injection, provenance, contract_and_eval_conformance]
sources:
  bridge_kernel:
    use: risk.ts / lifecycle.ts / approvals.ts / authority.ts / agent-floor.ts / pipeline.ts — the substrate; the agent adds identity, surfaces, and the carve-out
    mode: internal reuse; no rewrites
  openfga_opa_cedar_spicedb:
    use: enterprise ReBAC patterns for P6+ team-scale delegation ONLY
    mode: PARKED (decisions-log) — custom CBAC+policy+ledger+trust-model is the moat; revisit at enterprise scale
  agent_quality_eval_model:
    use: org-health rollup definitions + minor/moderate/major routing (docs/raw/agent-quality-eval-model-2026-07.md) — adopt as spec
    mode: internal; GA4 depends on its scoring reducers (EVAL-1)
```

# 5. Data and capability model

```yaml
GovernanceDecision:
  relates_to:
    - Proposal              # pipeline propose/decide round-trip
    - RiskComputation       # band, origin, closure, trifecta verdict (deterministic)
    - Classification        # minor | moderate | major (deterministic dual key)
    - TrustGrant            # store-read, expiring, revocable, lower-only
    - BudgetReceipt         # policy_params-backed daily budgets
    - LedgerEntry           # append-only; decided_by + rationale; rejections audited
    - OrgHealthSignal       # autonomy pressure / trust debt / approval load / violation trend
    - RemediationProposal   # tighten/demote/re-validate drafts
```

Invariants:

- deterministic kernel functions are the only source of bands, floors, and authority — the model explains, never computes;
- the MINOR carve-out is dual-keyed (band AND origin), budgeted, kill-switchable, per-decision ledgered, and individually revertible;
- loosening (grants, budgets, scopes) is always a human-approved proposal; tightening may be automatic with receipt;
- proposer ≠ decider: the Governance Agent never approves its own proposals; the Builder's drafts are scored by Governance and decided by humans (or the MINOR path);
- ledger is append-only; floor-integrity is continuously proven (canary), not assumed.

# 6. Delivery sequence

Universal exit gate (every slice): source/license record, manifest risk computed, tests, held-out eval, browser evidence for changed surfaces, provenance audit, security scan, cost/latency baseline, no dummy runtime data.

```yaml
slices:
  GA0:
    status: DONE (ADR-012, shipped substrate)
    scope: computeRisk, lifecycle state machine, approvals floors, authority resolver, agent-floor DENY, pipeline propose/decide, kill switch — built + tested
    known_gaps_carried_forward: [trustGrants read = hardcoded [], budgets in-memory, no decider identity, org-health unbuilt]
  GA1:
    goal: the agent identity becomes real — grounded answers, computed contributions on every card
    depends_on: [GA0]
    deliverables:
      - "@governance dispatch upgraded from prompt-only to grounded skills: risk-explanation, policy-question-answering, audit queries — every answer backed by real authority/ledger/manifest reads"
      - governance half of the proposal card: band, origin, trifecta verdict, closure, scope summary, precedent, recommendation
      - boundary-validation handoff for Builder drafts (BA4 consumes this)
    exit_criteria:
      - grounded-answer eval: a question set about real workspace state answered with citations into ledger/manifests; zero answers from prompt memory (hallucination probe set)
      - every proposal card renders the computed governance block from kernel outputs (no LLM-computed risk anywhere — code audit)
      - "@governance still cannot approve/deny anything (floor holds — negative test)"
  GA2:
    goal: trust grants and budgets go live as persistent, governed policy
    depends_on: [GA1]
    deliverables:
      - trust_grants store lookup wired (kill both hardcoded []); grant lifecycle — elicit → propose → approve → active → expire/revoke
      - AUTO_ACTIVATION_BUDGETS moved to policy_params (governed writes, survives restart)
      - confidence-tiered policy elicitation: user answers materialize as grant/budget proposals
    exit_criteria:
      - a grant lowers an audience toward auto ONLY (raise attempt is structurally rejected — negative test); expiry + revocation round-trip proven
      - budgets persist across restart; exhausting a budget routes the next item to a human (boundary test)
      - every grant/budget change is itself a ledgered, human-approved proposal
  GA3:
    goal: the MINOR carve-out ships — the only agent-made approval in Bridge, safe by construction
    depends_on: [GA2]
    deliverables:
      - distinguished decider identity in decide(): governance-agent + MINOR (band+origin dual key) + budget + kill-switch-off → approve, ledgered with rationale
      - minor/moderate/major routing live per agent-quality-eval-model; moderate/major always human
      - auto-approve receipts surface: visible digest, per-item undo, one-click grant revocation
      - dual-axis (impact × reversibility) restriction layered on when risk-mechanism-auto-mode-practices.md lands
    exit_criteria:
      - carve-out boundary suite green — every adjacent case blocked: wrong band, community/AI origin, budget exhausted, kill switch on, non-governance agent caller, self-proposed item
      - wrong-auto-approvals == 0 on a seeded classification set (precision gate; any miss blocks ship)
      - kill switch flips mid-stream and the in-flight MINOR item reroutes to human (timing test); every auto-decision individually revertible
  GA4:
    goal: org health becomes computable and actionable
    depends_on: [GA3, EVAL-1 scoring reducers (Batch 3 — hard prerequisite)]
    deliverables:
      - org-health rollup: autonomy pressure, trust debt, approval load, violation trend (agent-quality-eval-model definitions)
      - trust-window expiry sweep (90-day TTL re-validation prompts); approval-queue aging alerts
      - remediation proposals: tighten budgets / demote / re-validate — drafts, never auto-applied
    exit_criteria:
      - all four signals compute from real capability_states.evidence + ledger data (no synthetic inputs)
      - a seeded violation trend produces a tighten-budgets proposal; applying it goes through human approval (loosening-vs-tightening asymmetry proven)
      - median time-to-decision and pending-by-band render live in the panel
  GA5:
    goal: compliance, audit, and supply-chain trust
    depends_on: [GA1]
    deliverables:
      - audit report generation over the append-only ledger (who/what/when/why, exportable)
      - provenance + signature verification on package/capability imports (security-audit Finding F1 — HIGH before Commons opens)
      - floor-integrity canary automation (continuously seeded floor-DENY attempts, alert on any pass)
    exit_criteria:
      - unsigned/tampered import is blocked with a human-readable verdict (seeded tamper set)
      - audit report for a real week of activity reconciles 1:1 with ledger rows (no gaps, no extras)
      - canary has run continuously through the slice with zero passes (and an intentionally broken build proves the canary itself works)
  GA6:
    goal: team-scale governance — the schema v2 punch-list closes
    depends_on: [GA3, schema v2 pass (decisions.md punch-list)]
    deliverables:
      - roles + inheritance; delegations with on_behalf_of/delegation_id in the ledger; ephemeral_grants persisted (currently in-memory)
      - multi-user approval audiences (role-routed); delegation-aware authority resolution surfaces
      - External-band posture review checkpoint — human-always stands unless explicitly revisited through APPROVALS
    exit_criteria:
      - two-user delegation test: delegated action ledgered with on_behalf_of; revoking delegation kills authority immediately
      - ephemeral grants survive restart and still TTL-expire correctly
      - RLS + membership checks (SEC-5/SEC-6) verified against governance tables specifically
```

## 6.1 Success measures

```yaml
metrics:
  safety: wrong MINOR auto-approvals == 0; floor-canary passes == 0; unapproved loosening == 0 (hard invariants, monitored)
  load: median time-to-decision by band; pending-queue depth; % of decisions auto-handled as MINOR (should rise WITHOUT precision loss)
  health: autonomy pressure / trust debt / violation trend curves; remediation proposals accepted rate
  trust_ux: approval-card completeness (all governance fields present); explanation groundedness eval pass rate
```

## 6.2 Risk register

```yaml
risks:
  carve_out_becomes_a_hole:
    risk: the MINOR exception widens by increments (new bands, new origins, "just this once") until it's a bypass
    mitigation: dual key is structural; widening the key itself = major + APPROVALS; boundary suite is a permanent CI gate; receipts keep it visible
  llm_in_the_decision_path:
    risk: convenience refactors let the model influence band/classification
    mitigation: decider path contains zero model calls by construction (code-audit exit criterion, GA1/GA3); model output is display-only
  rubber_stamp_drift:
    risk: good auto-approve precision trains users to reflexively approve the human-routed rest
    mitigation: card quality (diffs, evidence, precedent) makes review cheap; approval-load metric watched; digest batches MINOR noise away from real decisions
  budget_state_loss:
    risk: in-memory budgets reset on restart → unmetered window
    mitigation: GA2 moves budgets to policy_params before GA3 enables any auto-decide (hard ordering)
  self_governance_paradox:
    risk: the Governance Agent's own capabilities/prompts evolve under rules it administers
    mitigation: proposer ≠ decider invariant; changes to governance skills are always major/human; floor canary is independent of the agent
  eval_dependency:
    risk: GA4 org-health is blocked if EVAL-1/2 slip
    mitigation: approval-load + trust-debt signals need only ledger + states (no scorer) — ship those first; autonomy pressure waits for reducers
```

Sequencing note: GA1–GA3 refine the P0 Capability Trust Model track (kernel already shipped); GA4 depends on Batch-3 EVAL-1; GA5's provenance gate must land **before** Universal Commons ingestion opens (egg-commons roadmap CM-supply-chain-trust — same requirement, one implementation). No H2 sequencer reorder; pull-forwards via `docs/APPROVALS.md`. Cross-roadmap: Builder BA4 consumes GA1 boundary-validation + risk blocks; Learning Agent research egress (LA3) is gated by the same pipeline this agent explains.
