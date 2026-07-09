---
title: Agent Quality & Evaluation Model — "what better means"
type: raw
doc_kind: design
status: draft
companions: [module-evolution-system-2026-07.md, capability-evolution.md, research-agent-skill-workflow-practices-2026.md]
related_wiki: module-evolution.md
updated: 2026-07-08
tags: [eval, agents, metrics, promotion, self-improvement]
---

# Agent Quality & Evaluation Model

> "I can't improve what I can't measure." This doc defines **what "better" means** for
> Bridge agents and capabilities, as a *buildable, computable* model — not prose adjectives.
> It closes the single biggest gap in the Living-Software thesis: the self-improvement loop
> (P3 "improves itself") has, until now, adopted eval *patterns* (two-gate, MUSE
> generalization, LangSmith-style compare) as aspirations without binding them to schemas,
> scorers, or numeric thresholds. `execution-plan-2026-07.md:265` even waves the phrase
> "better agents" away. This is the definition it was missing.

## 0. Design principles (inherited from Bridge, not invented here)

1. **Measurement is a pure function over the ledger, never a model call.** All threshold
   checks are pure fn / SQL (decisions-log, ADR-026 "ladder audit"). Scoring *may* call a
   model (LLM-as-judge), but *promotion/demotion decisions* read only recorded numbers.
2. **No new telemetry subsystem.** Every number below is derivable from the **execution
   snapshot** already specified (`ledger/trace += goal · memory_used[] · prompt ·
   tool_inputs · tool_outputs · policy_state · model_version`) plus the ledger's
   `userDecision` (approve|veto|edit|auto) and `capability_states.evidence`
   (`{activeRunCount, successRate, violationCount, ageDays}`). We are giving those fields a
   *scoring contract*, not adding sensors.
3. **Two independent gates** (research sweep, ADR): a capability must pass BOTH an
   **output-quality** gate AND a **trigger-precision/recall** gate. A skill that produces
   great output but fires at the wrong time is not "better" — it is a regression.
4. **"Better" is always relative and held-out.** Better = beats the current baseline on a
   held-out task set the capability did not author. Absolute scores overfit; deltas don't.
5. **Safety is a veto axis, not a weighted term.** A single governance/agent-floor violation
   caps the composite at "unpromotable" regardless of quality. You cannot buy back a leak
   with accuracy.
6. **Metrics are policy_params, Variance-Adjuster-tunable.** Every threshold in §5 is a
   starting proxy stored in `policy_params`, adjusted from real feedback, never a hard-coded
   constant in logic.

## 1. Units of evaluation (the ontology already fixes these)

"Agent" is not the only thing we grade, and the promotion literature Bridge adopted was
written for *skills*, not *agents*. We evaluate four primitive kinds, each with its own
quality vector because "better" means something different for each:

| Primitive | "Better" means | Eval unit |
|-----------|----------------|-----------|
| **Skill** (atomic capability) | correct output on its declared I/O contract, fires only when appropriate | task cases |
| **Automation** (code `ritual`/workflow) | reaches the goal DAG reliably, cheaply, replayably | run cases |
| **Agent** (goal + identity + capability_scope) | good *routing & decomposition* + trustworthy autonomy, over a standing responsibility | episode cases |
| **Workspace** (compiled projection) | the generated software fits the user's real work (fewer corrections, more adoption) | usage cohort |

The rest of this doc defines the **Agent Quality Vector** in full (§2) because it was the
undefined one, then shows how Skill/Automation reuse the same machinery with different axes
(§6).

## 2. The Agent Quality Vector (AQV)

An Agent's quality is a vector of seven axes. Each axis has: a **definition**, a **0–1
normalized scale**, and a **computation** from recorded data. Composite is deliberately *not*
a single blended number for gating (see §4) — the vector is kept, and gates read specific
axes.

### 2.1 Task Success (`success`)
- **Def:** fraction of episodes where the agent's routed/decomposed plan reached the user's
  intended outcome without the user having to redo it.
- **Signal:** ledger `userDecision`. `approve|auto` on the agent's proposal AND no
  compensating user action within the episode window ⇒ success=1; `veto` ⇒ 0; `edit` ⇒
  partial (see 2.2, edit is not a full success).
- **Compute:** `success = (approved_unedited + 0.5·edited) / total_episodes`, over a rolling
  window (default 30d, `policy_params.aqv.window_days`).
- **Why ledger-only:** no judge needed; the human already voted with approve/veto/edit.

### 2.2 Correction Rate (`correction`, inverse-good)
- **Def:** how much humans have to fix the agent's proposals. This is the **preference signal**
  the research sweep calls out and the number that best predicts real utility.
- **Signal:** `userDecision='edit'` frequency + edit *distance* (diff size between proposed
  and committed artifact, already stored because proposals + committed rows are both in the
  ledger).
- **Compute:** `correction = edited_episodes / total`, with a secondary
  `correction_depth = mean(normalized_diff_size | edited)`. Promotion gate uses
  `correction < 0.20` (matches vision.md promotion defaults "corrections <20%").

### 2.3 Routing Precision/Recall (`route_p`, `route_r`) — Gate B
- **Def:** the trigger gate for an Agent = did it take the *right* delegate/skill for the
  request (precision) and did it catch requests it should have handled (recall)? For the
  Chief-of-Staff this is `classifyIntent` correctness; for a delegate it is "should this
  have been mine?".
- **Signal:** requires a **held-out routing eval set** (§3): labeled `(request → correct
  route)` cases. Also mineable post-hoc from episodes the user re-routed (`@name` override =
  a recall miss on the auto-router).
- **Compute:** standard P/R against the labeled set; live estimate from `@name` overrides as
  a heartbeat. Gate: `route_p ≥ 0.85 AND route_r ≥ 0.80` (independent of output quality —
  the two-gate rule).

### 2.4 Output Quality (`quality`) — Gate A
- **Def:** for episodes that *did* execute, was the artifact/answer good on its own terms
  (accuracy, completeness, relevance)?
- **Signal:** LLM-as-judge over the execution snapshot (prompt + tool I/O + output), scored
  against a rubric; **calibrated** against the subset the human approved/vetoed so the judge
  isn't ungrounded. Judge model pinned + versioned in the snapshot for replay.
- **Compute:** `quality = mean(rubric_score)` on held-out cases. Gate: `quality ≥ 0.85`.
- **Anti-gaming:** judge eval set is **held-out and not authored by the capability**
  (MUSE-Autoskill / "don't grade your own homework"). Rubric stored in the eval dataset, not
  the capability.

### 2.5 Reliability (`reliability`)
- **Def:** does it complete without erroring, timing out, hitting best-so-far fallback, or
  breaching the chain-depth cap?
- **Signal:** snapshot terminal state + `assertChainDepth` events + executor error/fallback
  flags (all already emitted).
- **Compute:** `reliability = clean_completions / total_runs`.

### 2.6 Safety (`safety`) — VETO axis
- **Def:** zero governance violations, zero agent-floor breaches, zero egress of private data,
  zero policy-post failures.
- **Signal:** `violationCount` from `capability_states.evidence`; any planeGate reject
  attributed to this agent; any `require_approval` bypass attempt.
- **Compute:** `safety = 1 if violationCount==0 else 0` over the trust window. **A zero here
  hard-caps promotability** and, if it occurs on an Active capability, triggers the existing
  auto-SUSPEND. Safety never trades against other axes.

### 2.7 Cost/Latency Efficiency (`efficiency`)
- **Def:** tokens + wall-clock + tool calls per successful episode, normalized against the
  baseline for the same task class.
- **Signal:** snapshot `model_version` + token counts + timestamps + tool_inputs count.
- **Compute:** `efficiency = baseline_cost / agent_cost` (capped at 1.0 for gating; >1 means
  cheaper than baseline). Efficiency is a *tie-breaker and demotion pressure*, never a
  promotion blocker on its own (a slower-but-correct agent still promotes; a
  cheaper-but-wrong one does not).

### 2.8 The vector, not a scalar
Promotion/demotion reads **specific axes at specific gates** (§4). We *do* also compute a
displayable composite for dashboards:
`AQV_display = 0.30·success + 0.20·(1−correction) + 0.20·quality + 0.15·reliability + 0.15·efficiency`,
**gated to 0 if `safety==0` or either routing gate fails.** Weights live in
`policy_params.aqv.weights`. The composite is for humans; the gates decide.

## 3. The Eval Harness data model (buildable, behind a port)

Adopt the *pattern* (LangSmith/Braintrust/Mastra evals/OpenAI evals), host it ourselves in
Commons — same reasoning as the OPA/OpenFGA rejection (governance/eval = moat). Minimal typed
interfaces, ports-and-adapters, in-memory adapter first:

```ts
// packages/core/src/eval/ — pure types + a store port, no infra
interface EvalCase {
  id: string;
  input: unknown;                 // request / task
  reference?: unknown;            // gold output (may be absent → judge-only)
  labels?: Record<string, string>;// e.g. {correct_route: "learning-agent"}
  rubric?: string;                // for LLM-judge scoring
  origin: 'seed' | 'mined' | 'red-team';
  authored_by_capability?: string;// for held-out enforcement (§4.4)
}
interface EvalDataset { id; capability_type; version; cases: EvalCase[]; }

interface Scorer {                // pure OR model-backed; declared which
  id: string; kind: 'deterministic' | 'judge';
  score(caseInput: EvalCase, produced: unknown, snapshot: ExecSnapshot): Promise<AxisScores>;
}
interface AxisScores { success?; quality?; route_p?; route_r?; reliability?; safety?; efficiency?; }

interface EvalRun {               // one capability version × one dataset
  capability_id; capability_version; dataset_id;
  perCase: Array<{caseId; axes: AxisScores}>;
  aggregate: AxisScores;          // reduced per §2
  model_version; started_at; finished_at;
}
interface Comparison {            // baseline vs candidate — the "better" verdict
  baseline: EvalRun; candidate: EvalRun;
  deltas: AxisScores; verdict: 'promote' | 'reject' | 'coexist' | 'needs-human';
  significance: { n: number; ci95: Record<keyof AxisScores, [number,number]> };
}
```
- **Store port** `EvalStore` mirrors `PackageStore`/`CapabilityStore` shape; in-memory
  adapter boots with zero infra, Drizzle adapter later. Datasets live in Commons (knowledge,
  not user data — a red-team assertion pack or a routing-label set is generalizable).
- **Write-back:** `EvalRun.aggregate` populates `capability_states.evidence.successRate` etc.
  This is the missing join the undefined-elements audit flagged: manifest `evaluation` block
  → names the `dataset_id(s)`; harness runs them; results land in evidence; gates read
  evidence.

### 3.1 Manifest `evaluation` block schema (fills the untyped JSONB)
```yaml
evaluation:
  datasets: [ "commons://routing/chief-of-staff@1", "workspace://red-team/dealpilot" ]
  gates: { quality: 0.85, route_p: 0.85, route_r: 0.80, correction_max: 0.20 }
  scorers: [ "deterministic:route-match", "judge:rubric-v2" ]
  baseline: "auto"        # current Active version of same lineage, or named id
  min_cases: 20
```

## 4. What "better" *is* — the comparison rule

### 4.1 Draft → Validated (does it work at all)
Candidate runs its dataset. Pass if it meets **absolute gates** on *originating* tasks
(quality ≥ gate, safety==1, reliability ≥ 0.9) AND a **generalization test** on *novel* tasks
it did not author (MUSE-Autoskill): quality on held-out ≥ 0.75 (softer than originating).
Fails generalization ⇒ stays Draft (overfit).

### 4.2 Validated → Approved/Active (is it better than what we have)
**Baseline-vs-candidate parallel run** on the same held-out dataset (this is the default eval,
per research sweep). "Better" verdict:
- `promote` iff candidate ≥ baseline on BOTH gates (quality, routing) with no safety
  regression AND correction not worse, at n ≥ `min_cases` with non-overlapping 95% CI on the
  primary axis.
- `reject` if any gate regresses.
- `coexist` if better on some task clusters, worse on others (→ scope it to the clusters it
  wins; this is how two skills for the same need avoid a false either/or).
- `needs-human` if within noise (CIs overlap) — Governance Agent routes to a person.

### 4.3 Active → Trusted (earns autonomy — the Agent-specific bit)
This is where "better Agent" becomes "*more autonomous* Agent." Trust promotion reads a
**sustained** window, not a snapshot (matches vision.md "Trusted ≥30 runs ≥95% 0 violations
60d"):
`success ≥ 0.95 AND violationCount==0 AND activeRunCount ≥ 30 AND ageDays ≥ 60 AND correction < 0.10`.
Trusted decays on the existing 90d TTL / dependency-change rule. Autonomy is **earned per
(class, workspace, user)**, never global.

### 4.4 Anti-overfitting / anti-gaming (non-negotiable)
- Held-out selection: the harness picks eval cases where `authored_by_capability != candidate`
  (no grading own homework).
- **Description-tuning is its own subsystem** with a *separate* human-approved trigger eval
  set (a capability that rewrites its own description to fire more must re-pass Gate B on a
  set it can't see).
- **Red-team assertion pack** gates every External-band validation (prompt-injection /
  exfiltration probes; ties into the security work).
- Self-critique loop: post-run friction (vetoes, edits, best-so-far fallbacks) is logged and
  becomes *proposed* rewrites — governed, never silent.

## 5. Thresholds as policy_params (starting proxies)

```yaml
policy_params.aqv:
  window_days: 30
  weights: { success: .30, correction_inv: .20, quality: .20, reliability: .15, efficiency: .15 }
  gates:
    draft_to_validated:   { quality: .85, quality_holdout: .75, reliability: .90, safety: 1 }
    validated_to_active:  { require: "beats_baseline_both_gates", min_cases: 20, ci: .95 }
    active_to_trusted:    { success: .95, correction_max: .10, violations: 0, runs: 30, age_days: 60 }
  demotion:
    suspend_on: { safety_violation: 1 }                         # immediate, no approval
    propose_demote_on: { success_below: .80, correction_above: .30, eval_regression: .10 }
```
Every number is a Variance-Adjuster target. The **Variance Adjuster update rule** (itself an
undefined element) gets a concrete form here: on a `veto|edit` tagged to an axis, nudge the
relevant `policy_param` by `±δ` (default 0.02) bounded to `[floor, ceil]`, only off VETTED
decisions, with the tone example as the canonical instance
(`3× "too casual" veto → tone_threshold += δ toward formal`).

## 6. Skill / Automation / Workspace vectors (same machine, different axes)

- **Skill:** drop routing axes; Gate A = `quality` on its I/O contract, Gate B = **trigger
  precision/recall** of *when the skill is selected* (same P/R machinery, different labels).
  Promotion default: ≥2 workflows, ≥2 contexts, ≥85% (vision.md) → expressed as
  `quality ≥ .85 across ≥2 distinct workspace contexts`.
- **Automation (ritual/workflow):** axes = `reliability`, `efficiency`, goal-completion
  (`success`), replay-determinism (a hard check: same inputs+injected Clock/Rng/IdGen ⇒ same
  DAG). Promotion default: ≥5 reps/30d, ≥0.8 plan-similarity, ≥3 approved runs.
- **Workspace:** cohort metric, not per-run — adoption (does the user keep using the compiled
  views), correction rate on generated structure, time-to-first-value. This is the only axis
  set that needs light new instrumentation (view-usage counters), deferred to when workspaces
  are stress-tested.

## 7. Governance Agent metrics ("org health" — the other undefined phrase)

The Governance Agent's "monitors org health" becomes computable as a small rollup over the
same evidence, per workspace:
- **Autonomy pressure:** count of Active/Trusted capabilities with `success < .85` (candidates
  for demotion the human hasn't caught).
- **Trust debt:** capabilities whose trust window is about to decay / whose dependency changed
  and haven't re-Validated.
- **Approval load:** pending proposals by risk band + median time-to-decision (queue health).
- **Violation trend:** `violationCount` slope across capabilities (rising ⇒ tighten
  auto-activation budgets).
- **Minor/moderate/major mapping** (the undefined approval-routing bands): `minor` = the two
  lowest computed-risk bands (Informational, Advisory) AND origin ∈ {built-in, template};
  `moderate` = Transformational OR Community origin; `major` = Operational/External OR
  any safety-axis touch. Governance Agent auto-approves only `minor`.

## 8. Build order (fits P3 "improves itself", reuses P0/P1 substrate)

1. **Scoring contract over existing snapshots** (no new tables): implement the ledger-only
   axes (`success`, `correction`, `reliability`, `safety`, `efficiency`) as pure reducers over
   `capability_states.evidence` + ledger. *This alone makes agents measurable* — ship first.
2. **EvalStore port + in-memory adapter + `EvalDataset`/`EvalRun`/`Comparison` types.**
3. **Deterministic scorers** (route-match, contract-match, replay-determinism) before any
   judge — cheap, no tokens, no anti-gaming exposure.
4. **Baseline-vs-candidate comparison** wired into `capability.approve` (Validated→Active gate).
5. **LLM-judge scorer** (pinned model) for `quality`, calibrated against approve/veto labels;
   held-out enforcement + red-team pack.
6. **Governance org-health rollup** view for the Governance Agent.
7. Description-tuning subsystem + self-critique proposals (last — highest gaming surface).

Highest-leverage single step: **#1**. Bridge already records everything needed to score five
of seven axes; today nothing reads it as quality. Turning the execution snapshot + ledger into
a scoring reducer is the difference between "we hope agents improve" and "we can prove it."
