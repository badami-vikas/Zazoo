---
title: Platform Learning Architecture — Governed Capability Learning (v2)
type: raw
doc_kind: plan
status: proposed
companions: [learning-agent-roadmap-2026-07.md, governance-agent-roadmap-2026-07.md, builder-agent-roadmap-2026-07.md, roadmap-6month-2026-h2.md, roadmap-v2-universal-commons.md, agent-quality-eval-model-2026-07.md]
related_wiki: ../wiki/learning-agent.md
updated: 2026-07-14
tags: [learning, memory, evaluation, commons, egg, governance, capability-lifecycle, meta-learning]
---

# Platform Learning Architecture — Governed Capability Learning

**Provenance.** v1 of this plan (2026-07-14 research session) was memory-centric: three loops
around a memory substrate, FSRS-ported decay, a single-verifier thesis, GEPA as a weekly
production default. It was critiqued in
[outputs/2026-07-14-cos-learning-strategy-critique.md](../../outputs/2026-07-14-cos-learning-strategy-critique.md)
and this v2 adopts that critique wholesale. The underlying evidence base (three research sweeps:
memory-systems reality, self-improvement algorithms, production personalization operations) is
summarized in §8 so the claims stay auditable.

**Scope.** The whole platform and all agents — Learning, Chief of Staff, Builder, Governance,
Communications, plus Kernel / Compiler / Runtime / Egg / Commons. Not a CoS feature.

**Urgency.** LOW. Nothing here reorders the H2 sequencer. Most of the spine is already scheduled
(EVAL-1/2, MEM-1, LA0–LA2, EVAL-3/4, VAR-1); the genuinely-new items are post-H2 (§7).

---

## 1. Thesis

> Bridge improves because it builds an increasingly accurate model of the user's context,
> increasingly effective capabilities for their work, and increasingly reliable evidence about
> when those capabilities should act — while every change remains inspectable, reversible, and
> governed.

The base model improving is a tailwind, not the moat. The moat is **accumulated local context +
capability history + outcome evidence + governance history + a fast, safe evaluation loop**. The
decisive product proof is not "it remembered my email tone"; it is:

> Bridge understood how I do this work, proposed a better way to do it, demonstrated the change
> was better, requested the appropriate authority, and continued improving without losing my
> intent or privacy.

Corollary: "the agent remembers more" is explicitly NOT the compounding thesis. Memory is one
input to capability learning, not the center.

## 2. Evidence model — multi-signal, not single-verifier

The v1 claim "every mechanism that works needs one cheap, non-gameable verifier" is directionally
right for *autonomous optimization* (it is why self-judged loops collapse — §8) but too absolute
for personalization, where the outcomes that matter (trust, appropriateness, interruption cost,
long-term usefulness) are delayed, ambiguous, or partially observed.

Bridge uses a **multi-signal evidence model**; each signal keeps its provenance and ambiguity:

| Signal | Trust | Notes |
|---|---|---|
| Verified outcome (task-class outcome contract met) | highest | extends the AQV axes |
| Explicit user correction / confirmation | highest | immediate application, always |
| Retained user edit / edit distance | high | measure *retention*, not first acceptance |
| Task completion + downstream reversal | high | reversals are negative evidence |
| Repeated behavior across comparable contexts | medium | needs context-comparability check |
| Delayed satisfaction / regret signals | medium | windowed attribution |
| Safety / policy violation | veto | never averaged in — a veto, full stop |
| Absence of correction | weakest | aggregate-only; **absence is not approval** |

Acceptance-rate alone is a known trap (Copilot moved to accepted-and-retained characters + flow +
latency because acceptance favors short/easy suggestions). Bridge's north-star basket: **retained
value, downstream-reversal rate, correction rate, verified-outcome rate** — never a single scalar.

## 3. Speed policy — blast radius determines learning speed

"Faster feedback is always better" holds for high-volume recommenders (Monolith), not for an
executive-adjacent agent platform. Asymmetric speeds, by blast radius / reversibility:

| Change class | Speed | Gate |
|---|---|---|
| Personal, reversible correction or context update | seconds | none (logged) |
| Workflow / workspace adaptation | days + repeated evidence | Capability Lifecycle candidate |
| Autonomy or governance-policy change | slow | Governance bands, staged |
| Commons promotion | slowest | cohort validation + privacy + rollback |

**Exploration is tightly bounded**: only where the choice is low-risk, reversible, non-egress,
inside an explicit user grant, not materially worse under any arm, and recorded with propensity +
version. Never explore permissions, external sends, privacy boundaries, or safety policy.

## 4. The four loops + one evaluation plane

### Loop 1 — Interaction adaptation (seconds–minutes)
Assemble best current context (PromptAssembler), respond, apply explicit corrections in-session,
record decisions/edits/outcomes/context-used/uncertainty. No silent conversion of observation
into durable truth. *Owners: PromptAssembler/retrieval, Runtime, every agent.*

### Loop 2 — Personal model consolidation (hours–days)
Evidence → **typed** Context candidates: facts/current state, preferences (with applicable
contexts), relationships/concepts, goals/constraints, rhythms/recurring patterns, rejected
suggestions/exceptions. Reconcile contradictions, preserve provenance, request confirmation in
proportion to sensitivity × uncertainty. *Owner: Learning Agent (neverExecutes). This is LA0–LA2
territory — suggested-then-accepted, taint tiers, digest caps.*

**Memory scoring = utility + validity model, NOT FSRS.** HLR/FSRS evidence is about *human
recall*; agent memories don't forget — they go stale, get superseded, compete at retrieval, and
over-apply out of scope. Score memories on separate factors: temporal validity / supersession ·
source authority · contextual relevance · retrieval utility when used · harm/correction when used
· sensitivity + permitted scope · redundancy · confidence/corroboration. Time-decay only where the
fact class warrants it (a birthday, a project status, and a tone preference need different
validity rules). Start with deterministic rules per fact class + challenger scoring (LA2's
`memory-decay-and-dedupe` automation is the home for this — refined, not replaced).

**Storage stance.** Immutable *provenance events and tombstones*; source content itself follows
user-controlled retention/deletion/residency policy (raw transcripts are NOT universally
immutable — that conflicts with the local-plane and deletion promises). Extracted memories are
indexes/claims over source evidence, never replacements. Mem0 stays **behind MemoryPort and
replaceable**, forced to compete per task-class against: full recent context, simple hybrid
retrieval over source evidence, graph lookup, extracted semantic memory, combined. Benchmarks
don't settle this (LoCoMo/DMR are audited-broken and vendor-gamed — §8); Bridge's own held-out +
live evidence does.

### Loop 3 — Capability evolution (days–weeks) — **the distinctive loop**
Mine repeated successful work into candidate workspace changes, skills, automations, routing
rules, integration proposals. The **Compiler** turns stable learned patterns into proposed diffs;
the **Capability Lifecycle** validates, governs, activates, evaluates, rolls back. Most memory
assistants stop after Loop 2; this loop is Bridge's moat and the source of the decisive demo (§1).
*Owners: Learning (proposes) → Compiler (diffs) → Governance (approves) → Builder (implements) →
Runtime (executes, records outcomes).*

Prompt/policy optimization (GEPA-class) lives here as a **challenger generator only**: optimizers
may propose versioned prompt/policy candidates in offline evaluation; promotion still requires
held-out tests, safety vetoes, and staged release through the Capability Lifecycle. Never a
self-rewriting production default.

### Loop 4 — Commons learning (weeks–releases)
Only generalized, privacy-safe **capability knowledge** travels up: parameterized capability/
workspace blueprints, certified skills + adapters, eval datasets + failure signatures, generalized
routing/trigger priors, safety rules + compatibility knowledge, aggregate performance statistics.
Never personal context. See §6.

### Evaluation plane — deterministic infrastructure, not another learning agent
Versioned candidates, replay datasets, held-out cases, counterfactual comparison where valid,
safety vetoes, staged rollout, live outcome monitoring, rollback. Personalization system and
experimentation system stay **separate stacks** (Spotify's architecture lesson). Experiments are
judged on decision-grade information gained — credible regressions and credible neutrals count,
not only winners. *Home: EVAL-1…4 + EvalStore; this plane evaluates all four loops.*

## 5. The connective tissue — one shared learning contract

The missing piece across Memory, Context, prompts, routing, workspaces, skills, automations, and
Commons is one typed pipeline:

> **Learning Event → Candidate Change → Evaluation → Governed Promotion**

Every correction, observation, verified result, contradiction, and lesson enters a single typed,
scoped, provenance-carrying stream; every durable change to any surface exits through the same
evaluated, governed promotion path. One contract, eight consumers.

**Why / What / When / How live at four layers** (not a choice between them):
1. **Why** = constitution/objectives: user value, fidelity, safety, privacy, reversibility,
   lasting capability improvement.
2. **What** = typed learning objects: context claim, preference, exception, procedure, routing
   rule, capability diff, governance rule, Commons artifact.
3. **When** = deterministic trigger policy (below). Calendar schedules are backstops only.
4. **How** = versioned learning operators: extract, reconcile, validate, simulate, compare,
   propose, approve, activate, monitor, demote. A **deterministic policy router** selects the
   allowed operator from evidence × risk × reversibility × scope — agents may recommend an
   operator, never freely choose their own learning regime.

### Trigger priority (deterministic)

| Situation | Response |
|---|---|
| Safety violation, explicit correction, permission change | Immediate containment/invalidation; governed update created |
| Verified task result or substantial user edit | Post-task evidence update |
| Contradiction or material state change | Event-triggered reconciliation |
| Repeated pattern across comparable contexts | Threshold-triggered capability candidate |
| Retrieval crowding, duplicates, accumulated episodes | Idle/nightly consolidation |
| Stale time-sensitive fact or dormant capability | Validity-class-specific recheck |
| Cross-user generalization candidate | Slow cohort evaluation + privacy/governance gate |

## 6. Egg ↔ Commons

- **Commons supplies generalized priors.** (Cold-start value: a new Egg inherits the Commons
  immediately.)
- **Egg creates the personal instantiation** — local parameters, permissions, exceptions,
  evidence.
- **Local evidence improves Egg quickly** (fast loops 1–2).
- **Only validated, de-personalized capability knowledge travels back to Commons** (slow loop 4).

Egg contributes patterns, never personal content. Commons returns candidates, never mandatory
behavior. Local permissions, parameters, and exceptions always win; local overrides never mutate
the Commons artifact. Commons signals need the Waze triad: freshness decay, peer validation,
Sybil/adversary resistance — plus the supply-chain trust already planned in PKG-2/CM slices.

### Cross-agent lesson propagation
Product term: **verified cross-agent lesson propagation** (academically: blackboard-mediated /
shared-memory-mediated collective learning). The `.gov.tw` archetype is specifically
**downstream-error-driven policy propagation**: QA observes an outcome, attributes it to a
sourcing policy, proposes a versioned rule that changes Research behavior.

"One correction improves every agent" is NOT literal — it improves every **affected dependent
capability**, discovered through a dependency graph, after scope/causality/evidence checks
(otherwise one spurious correlation becomes a fleet-wide failure — the documented lesson-pollution
mode). Reads from the lesson board are immediate and free; **writes are proposed, tested, and
versioned**. Each lesson carries: observation + outcome · causal hypothesis (explicitly marked
hypothesis) · affected task/source/context scope · evidence count + counterexamples · proposing
agent + provenance · dependency targets · proposed policy diff · test + rollback · visibility
(local / organization / Commons).

## 7. Roadmap integration — no urgency, no H2 reorder

### 7a. Already scheduled (the plan rides existing slices — no new work items)

| Plan element | Existing home | When |
|---|---|---|
| Outcome signals before learning (AQV reducers, EvalStore) | **EVAL-1 / EVAL-2** | Month 2 (Aug) |
| Memory primitive, taint/provenance, suggested-then-accepted | **MEM-1 + LA0** | Month 3 (Sep) |
| PromptAssembler contextualization (Loop 1) | **LA1 / BA0** | P0–P1 track |
| Observation + correction loops, decay/dedupe automation | **LA2** | LA sequence |
| Baseline-vs-candidate promotion, LLM-judge, two-gate | **EVAL-3 / EVAL-4** | Month 4 (Oct) |
| Bounded parameter tuning as governed diff | **VAR-1** | Month 4 (Oct) |
| Governance bands, org-health rollup | **GOV-1** | Month 4 (Oct) |
| Commons supply-chain trust, blueprint freeze | **PKG-2 / BLUEPRINT-1** | Month 6 (Dec) |
| Retrieval quality evals, RAG layer | **LA5** | post-LA2 + EVAL-1/2 |

**Steering notes to carry into those slices (cheap, absorbed in-slice, no scope growth):**
- **EVAL-1/2**: extend the quality vector with task-class-specific *outcome contracts* and
  delayed reversal/retention signals (not acceptance-only). Design the `EvalRun` types so the
  same plane can later evaluate all four loops.
- **LA0/MEM-1**: candidates are **typed Context objects** (fact / preference / exception / goal /
  rhythm / rejected-suggestion), not a generic memory blob. Tombstones + provenance events
  immutable; content deletable. MemoryPort keeps Mem0 replaceable and benchmarkable against
  full-context and hybrid-retrieval baselines on Bridge's own evals.
- **LA2**: implement `memory-decay-and-dedupe` as the **utility+validity model** (per-fact-class
  validity rules, §4 Loop 2), not a uniform time-decay curve.
- **EVAL-3/4 + VAR-1**: these ARE the evaluation plane v1; keep the personalization path and the
  evaluation path in separate stacks from the start.

### 7b. New items — post-H2 (H1 2027), priority order

| ID | Item | Depends on | Note |
|---|---|---|---|
| **LRN-1** | Shared **Learning Event → Candidate Change → Evaluation → Governed Promotion** contract (typed stream + deterministic operator/policy router) | EVAL-2, LA0 | The connective tissue (§5). Define the types during H2 if convenient (paper-only), build post-H2 |
| **LRN-2** | **Learning→Compiler bridge**: repeated-pattern mining → proposed workspace/automation diffs → replay proof → approval → measured friction drop. The decisive demo | LRN-1, LA2, EVAL-3, Compiler | Loop 3 core; Bridge's distinctive capability |
| **LRN-3** | **Certified org lesson board** (verified cross-agent lesson propagation): dependency-aware reads immediate, writes proposed+tested+versioned | LRN-1, REG-1 (dependency graph) | Start local/org scope only |
| **LRN-4** | **Challenger-generation track**: GEPA-class optimizer proposing versioned prompt/policy candidates into the eval plane; staged promotion via Capability Lifecycle | EVAL-3/4, LRN-1 | Never auto-rewrites production |
| **LRN-5** | **Commons mining** (patterns up, priors down; cohort evaluation; de-personalization scrubber gate) | LRN-3, PKG-2, CM slices, privacy/rollback infra | Keep Commons curated until every gate exists |

### 7c. Explicitly deferred (reconsider only on demonstrated context-layer ceiling)
Per-user fine-tuning/LoRA · DPO/RLHF/RLAIF on own data · autonomous self-play/self-rewarding
loops · unrestricted online optimization. Preconditions to even reconsider: sufficient consented
data, stable evals, deletion semantics for weight artifacts, and evidence the context layer has
plateaued. (Evidence says none of these are shipped per-user by anyone, for structural reasons.)

## 8. Evidence appendix (what grounds each choice)

- **Verifier boundary**: Reflexion works only with external ground truth (HumanEval 91%, AlfWorld
  +22%); intrinsic self-correction *hurts* without it (Huang et al. 2310.01798). Self-judged
  loops plateau ≤3 iterations then reward-hack (Self-Rewarding LMs 2401.10020; SRT collapse);
  closed-loop retraining degrades without fresh external data (Shumailov, Nature 2024; mitigated
  by accumulation, 2410.12954). → §2 keeps verified outcomes at top trust but refuses a single
  scalar; §7c defers autonomous loops.
- **Memory reality**: full-context/RAG baselines beat memory vendors on accuracy 4+ independent
  times (Mem0's own paper 72.9 vs 68.4; Letta filesystem 74.0 on LoCoMo; Emergence SOTA on
  LongMemEval with RAG); LoCoMo ~6.4% broken ground truth, judge passes ~63% of wrong answers
  (Benchmark Theatre audit); memory systems earn cost/latency (90%+ token savings) and temporal
  invalidation (Zep bi-temporal), not accuracy. → MemoryPort replaceability, source-evidence
  preservation, per-task-class competition (§4 Loop 2).
- **Memory as attack surface**: MINJA >95% injection success via query-only interaction
  (2503.03704); SpAIware persistent exfiltration via ChatGPT memory. → LA0 taint-from-day-one and
  suggested-then-accepted are load-bearing, already in the LA roadmap.
- **Skill/workflow learning**: AWM +51% rel. WebArena, +24.6% Mind2Web; ExpeL insights transfer
  across models; autonomous skill *discovery* only ever worked in Minecraft-grade sandboxes;
  production versions are certified/curated. → Loop 3 goes through the Capability Lifecycle, not
  autonomous absorption.
- **Optimization**: GEPA beats GRPO by ~6pp avg (up to 19) at 35× fewer rollouts from ~10
  examples; MIPROv2/TextGrad +4–13pp where a metric exists; standard failure = overfitting small
  dev sets. → LRN-4 challenger-only, held-out gated.
- **Ops patterns**: Netflix interleaving ~100× sensitivity → two-stage funnel; Spotify separates
  personalization from experimentation stacks and scores experiments on information gained;
  Duolingo A/B's each scheduler generation against the last (HLR→Birdbrain v1→v2), and Birdbrain
  v2 was motivated by an observed logging blind spot (20% abandoned lessons). → evaluation plane
  design + "instrument the empty signal slots" practice.
- **Metrics**: Copilot acceptance-rate correlated with perceived productivity but favored
  short/easy suggestions; GitHub expanded to retained characters, flow, latency. → §2 basket.
- **Speed**: Monolith AUC improves monotonically with feedback freshness *in a recommender*;
  Cursor ships checkpoints daily off accept/reject. Valid for low-blast-radius loops only. →
  §3 asymmetric speeds; fast lane restricted to reversible personal corrections.
- **Commons**: Gboard FL works only with DP (FL-without-DP leaks text, 2210.16947); Swift fraud
  consortium ~2× detection sharing validated labels not raw data; Waze needs decay + peer
  validation + Sybil resistance. → §6 gates.
- **Human-recall algorithms**: FSRS beats SM-2 for 99.6% of users on 350–700M reviews; HLR −45%
  recall-prediction error, +12% engagement. Strong evidence — *for human recall scheduling*;
  transfer to agent-memory decay is a hypothesis, hence the utility+validity model instead
  (§4 Loop 2). If Bridge ever schedules *human* review (user-facing rehearsal of commitments),
  FSRS-style scheduling becomes directly applicable.
