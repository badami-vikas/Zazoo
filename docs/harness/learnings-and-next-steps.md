---
title: Harness Research — learnings, evidence base, and recommended next steps
type: raw
doc_kind: research
status: draft
companions: [comparative-analysis.md, primitives.md]
related_wiki: harness.md
updated: 2026-07-29
tags: [harness, research, evidence, evals, roadmap, recommendations]
---

# Harness Research: Learnings and Next Steps

What the literature and the field actually establish, what it means for Bridge, and what to do next.

Every substantive claim is tagged **[empirical]** (backed by a measurement in a cited source) or
**[opinion]** (practitioner assertion, plausible, unmeasured). Where vendor and independent evidence
conflict, the independent result is weighted higher and the conflict is named.

Research date **2026-07-29**. §7 records what could not be verified.

---

# 1. The headline finding

**The harness is a first-order determinant of measured capability, comparable in magnitude to the
model itself.** [empirical]

The evidence is unusually consistent across independent sources:

```yaml
harness_effect_sizes:
  - source: "Starace, Scaffold Effects on GAIA, arXiv 2606.08529 (2026)"
    finding: scaffold choice alone moves accuracy by up to 28 percentage points within a single model
    note: >
      The prediction that stronger models would be LESS scaffold-sensitive was contradicted — the
      most capable model tested gained MOST from structured scaffolds at hard difficulty.
      Conclusion: published capability scores are "scaffold-conditional estimates".
  - source: "SWE-bench Verified (OpenAI)"
    finding: GPT-4o 16% -> 33.2% after evaluation-harness fixes plus scaffold choice
  - source: "Anthropic, Demystifying evals for AI agents (2026-01-09)"
    finding: Opus 4.5 42% -> 95% on CORE-Bench after grading fixes and a less constrained scaffold
  - source: "Self-Harness, arXiv 2606.09498 (Shanghai AI Lab, 2026)"
    finding: >
      +14 to +21 points held-out on Terminal-Bench-2.0 across three models with NO weight changes
      (MiniMax M2.5 40.5->61.9; Qwen3.5-35B-A3B 23.8->38.1; GLM-5 42.9->57.1)
  - source: "LangChain, The Anatomy of an Agent Harness (2026-05-21)"
    finding: Top-30 -> Top-5 on Terminal-Bench 2.0 by changing ONLY the harness
    caveat: vendor-reported
```

Two corollaries that matter for how Bridge plans and measures:

- **A model score without a specified harness is not a model measurement.** METR builds its entire
  elicitation protocol around this. Any Bridge benchmark, model-selection decision, or provider
  comparison must hold the harness constant, and vice versa. [empirical]
- **Better models move the harness; they do not remove it.** Harness-*benefit* capability is
  non-monotonic in model strength, peaking in the middle tier (arXiv 2605.30621). [empirical] The
  practitioner overlay — every harness component "encodes an assumption about what the model can't
  do on its own", so components must be actively *deleted* when the assumption expires — is
  [opinion], but it is the right maintenance discipline.

**The harness is also model-specific and does not port across model swaps.** Self-Harness's central
result: three models converged on *different* harness edits from the same minimal start, because
they differ in tool-use habits, error modes, and prompt sensitivities. [empirical] For Bridge's
`ModelProvider` seam this means the routing abstraction is right, but prompt and tool tuning cannot
be assumed portable across the Ollama / llama.cpp / Anthropic / Groq adapters.

---

# 2. The source you named: the Freeman substack piece

Mark Freeman, "Agent & Harness & Micro-Orchestrator, Oh My!", *Scaling DataOps*, 2026-05-22.

**Its thesis is not primarily about harnesses.** The harness is Part I scene-setting. The
load-bearing argument is that **there is a missing abstraction layer between heavy orchestration
frameworks and fragile Markdown "agentic skills", and it should be built with classical
distributed-data-engineering patterns — state machines plus event sourcing over an append-only
immutable log.** His framing: agentic engineering "is essentially data engineering", where the data
being prepared for the end user (the agent) is *context*.

His definitions, for the record:

- **Agentic harness** — the layer running an *Observe → Plan → Generate → Verify* loop so a model
  can work untethered from a chat window, giving the operator "a mental buffer against the deluge of
  decisions". Note this is an **attention-economics** definition, materially different from the
  compositional one (LangChain, Böckeler) that the rest of the field uses.
- **Micro-orchestrator** (his coinage) — the proposed missing layer: lighter than an orchestration
  framework, more reliable than Markdown skills.

His five derived requirements: decompose to keep context task-scoped; assume tasks are independent;
make agent **deployment** idempotent (explicitly deployment, not output); handle failure and retry;
append every task state to an **append-only log edited programmatically, not by agents**.

**Why this matters for Bridge specifically.** Freeman independently reasons his way to the
architecture Bridge already has: an append-only event log as the source of truth, written by code
rather than by agents, with replay for a fresh agent after failure. Bridge's Ledger and Event
partitioning are that design, built earlier and with governance semantics he does not have.

**Where the piece is weak, and how to cite it.** The harness definition is the least developed part
of the article despite being in the title. There is no evaluation, ablation, or baseline. The
central claim — that his three-level hierarchy "rarely has a context window exceeding 100k tokens,
no context rot or compactions" — is **uninstrumented, n=1**. The state-machine-predictability
argument is asserted by analogy. Cite it as a well-reasoned practitioner design note, not as
evidence. [opinion]

His one citation that *does* check out is arXiv 2604.04323 on skill fragility (§3.4 below).

**The better conceptual sources**, if the goal is a taxonomy rather than a design story:

- **Böckeler (Thoughtworks/Fowler), "Harness engineering for coding agent users"** — the most
  rigorous decomposition available: **inner vs. outer harness**; **Guides (feedforward) vs. Sensors
  (feedback)**, with the sharp claim that feedback-only gives an agent that repeats its mistakes and
  feedforward-only gives an agent that encodes rules without learning whether they worked; and
  **Computational vs. Inferential** (deterministic/CPU/reliable vs. semantic/LLM-judge). Also:
  "a good harness should not aim to eliminate human input but to direct it where it matters most."
- **Guo et al., arXiv 2606.20683** — the six coupled runtime responsibilities a harness must cover:
  **Observation, Context, Control, Action, State, Verification.** The best available architecture
  checklist, and the frame used in [`comparative-analysis.md`](comparative-analysis.md).

---

# 3. What the evidence says a good harness must do

## 3.1 Context and state

**Compaction alone is insufficient for multi-context-window work.** [empirical] Anthropic's finding:
Opus 4.5 on the Agent SDK, looped, still fails to build a production web app — typically running out
of context mid-implementation and leaving the next session a half-built undocumented feature. Their
fix is not better compaction; it is an **initializer agent** that writes a structured JSON progress
artifact, and then a **full reset** every subsequent session that reads the artifact, picks one
feature, self-verifies, and commits. They chose JSON over Markdown **because the model tampers with
it less**.

*For Bridge:* the durable artifact doing the real work in Anthropic's design is exactly what Bridge
already has in Memory plus the Ledger. Bridge's gap is the compaction half, not the artifact half —
and it is a hard gap, because `boundedConversationHistory` currently **throws** rather than degrading
([primitives.md](primitives.md) A2).

**More context is not better; instruction files can actively hurt.** [empirical] The ETH Zürich SRI
study (arXiv 2602.11988) found that `AGENTS.md` / `CLAUDE.md` files tended to **reduce** task success
while raising inference cost **over 20%**, by encouraging broader exploration and more testing
without improving outcomes. Recommendation: keep them minimal. Independently, higher reasoning effort
**reduced** accuracy in the majority of 21,000+ rollouts (HAL, arXiv 2510.11977).

*For Bridge:* this is the strongest evidence that a governance-heavy design must justify every
always-loaded token rather than assume more structure is better. It also validates
`CLAUDE.md`'s own budget discipline in this repository.

**Long trajectories are superlinearly expensive, independent of quality.** [empirical] On OSWorld,
each successive step can take ~3× longer than early ones; planning, reflection, and judging model
calls dominate end-to-end latency; the best agents take 1.4–2.7× more steps than human gold
trajectories (arXiv 2506.16042). This is a second, independent argument for bounded episodes with
clean handoff artifacts — beyond context rot.

## 3.2 Verification is the highest-leverage area

- **Separate the generator from the evaluator.** Agents grading their own work skew positive.
  [empirical]
- **Grade on verifiable end-state, not plausible output.** tau-bench compares final database state
  to an annotated goal; SWE-bench runs hidden tests; GAIA uses unique factual answers. All three
  chose state or execution grading deliberately. [empirical]
- **Measure reliability as pass^k, not pass^1.** tau-bench retail: pass^1 ≈ 61% but **pass^8 < 25%**.
  [empirical] That gap is the difference between a demo and a product.
- **Enforce constraints mechanically, not by prompting.** A policy document in the context window is
  **not** an enforcement mechanism — tau-bench agents scored under 50% with one. OpenAI enforces its
  architectural layering with custom linters and structural tests rather than instructions.
  [empirical]
- **Environment setup reliability IS measured capability.** SWE-bench Verified's third identified
  defect was environments that were hard to set up reliably, causing valid solutions to be graded
  incorrect. [empirical]
- **Read the trajectories.** HAL's log analysis across 21,000 rollouts caught agents searching for
  the benchmark on HuggingFace instead of solving the task, and misusing credit cards in
  flight-booking tasks. Aggregate scores conceal reward hacking. [empirical]
- **Instrument the failure distribution, not just the success rate.** [empirical] MAST
  (arXiv 2503.13657, NeurIPS 2025) built a 14-category taxonomy from 150 traces at inter-annotator
  κ = 0.88, scaled to 1,642 traces across 7 frameworks:

```yaml
mast_failure_frequencies:
  step_repetition: 15.7%
  reasoning_action_mismatch: 13.2%
  fail_to_recognize_task_completion: 12.4%
  fail_to_follow_task_specification: 11.8%
  task_derailment: 7.4%
  proceeding_on_wrong_assumptions_instead_of_asking: 6.8%
  context_loss: 2.8%
  conversation_reset: 2.2%
  ignoring_other_agents_input: 1.9%
  disobey_agent_role: 1.5%
headline: >
  Failures often stem from SYSTEM DESIGN issues, not LLM limitations, and require structural
  redesign rather than superficial prompt fixes. Categories show low mutual correlation (0.17-0.32),
  so they capture genuinely distinct aspects.
```

MAST maps almost one-to-one onto harness components, which is why it is worth adopting as a
requirements checklist rather than just a diagnostic: step repetition → a deduplicating action log;
reasoning–action mismatch → post-hoc verification of the action against the stated intent; failure
to recognize completion → externally-owned completion criteria; failure to follow spec →
computational guides rather than prose; wrong assumptions → a first-class "ask the human" action.

## 3.3 Orchestration

**Fan out on reading and reasoning; keep writes single-threaded.** This is the single most important
design constraint in the practitioner literature, and it comes with a genuine reversal: Cognition's
2025 "Don't Build Multi-Agents" was partially reversed in April 2026 — what works is "multiple agents
contribute intelligence to a task while writes stay single-threaded"; parallel-writer swarms still
do not.

**Treat Anthropic's multi-agent number with care.** Their result — a lead plus subagents beating a
single agent by 90.2% on an internal research eval — used **~15× more tokens**, and token usage alone
explained ~80% of performance variance. There was **no equal-token-budget control**. A 2026 preprint
(arXiv 2604.02460, unverified) claims single agents match multi-agent systems under equal thinking
token budgets. Until that is checked, do not cite the 90.2% as evidence for multi-agent
*architecture* — it may largely be a compute-spend effect. [empirical, contested]

*For Bridge:* Chief of Staff's `RoutingDecision` type structurally permits **at most one route** and
has no field to hold a peer link. That is the recommended architecture enforced by the type system
rather than by guidance, and it is worth defending as such.

## 3.4 Skills and dispatch

**Deterministic dispatch beats model-discretionary skill invocation.** [empirical] arXiv 2604.04323
(UCSB/MIT) made agents retrieve from **34,000 real-world skills** under progressively more realistic
conditions. Finding: "the benefits of skills are fragile" — gains degrade consistently toward the
no-skill baseline as realism increases. Skill *retrieval and selection* is the bottleneck, not skill
*authoring*.

*For Bridge:* this is a direct vindication of the AGS1 design. Bridge does not let the model select a
Skill; the Goal/Task assignment does, through six deny-by-default gates
([primitives.md](primitives.md) C2). Bridge built the paper's recommended mitigation before the paper
existed. This should be stated publicly.

## 3.5 Safety

**Untrusted data must never influence control flow.** [empirical] CaMeL (Google DeepMind, arXiv
2503.18813) extracts control and data flow from the *trusted* query into an explicit program, so
untrusted retrieved data cannot alter program flow, plus a capability system preventing
exfiltration. Result: **77% of AgentDojo tasks solved with provable security versus 84% undefended**
— a ~7-point capability cost for a provable guarantee. If tool *output* can decide which tool runs
next, there is no injection defense at all.

*For Bridge:* satisfied for **authority** — no tool output can change an Authority Decision. **Not
yet resolved for planning**, because there is no Planner. Whichever way that question is settled,
this constraint belongs in the design before the code.

**The tool-dispatch/MCP layer is the primary attack surface.** [empirical taxonomy] 16 threat
scenarios across 4 attacker types spanning the MCP lifecycle (arXiv 2503.23278). Recommended
controls: trusted registries, **install-time signature verification**, per-session sandboxing.

**Sandboxes are also a scaling mechanism, not only a safety one.** HAL's parallel-VM harness is what
made 21,000 rollouts tractable at all. [empirical]

## 3.6 The harness as a searchable, declarative artifact

**Harness configuration is a searchable optimization space, and automated search beats hand-tuning.**
[empirical] Self-Harness +14–21 points held-out; Darwin Gödel Machine 20%→50% on SWE-bench Verified
and 14.2%→30.7% on Polyglot **under a fixed model**; AHE's evolved harness transfers *frozen* to
SWE-bench-Verified, meaning it encoded engineering experience rather than benchmark overfit.

All three report the same three preconditions, and they are a direct blueprint for what Bridge's
self-improvement thesis actually requires:

```yaml
preconditions_for_harness_self_improvement:
  a: every component is a FILE — diffable, revertible, attributable
  b: edits are MINIMAL and singly attributable
  c: promotion is gated by regression testing on a HELD-OUT split the proposer never sees
```

Bridge's Capability Builder, Capability Manifest, two-gate promotion, and held-out rule in
`docs/wiki/agent-eval.md` are the same design. The difference is that the external work has run the
loop and Bridge has not, because the eval harness is built but unfed.

**Harness policy can be externalized as a portable declarative document at no measured performance
cost.** [empirical] NLAH/IHR (arXiv 2603.25723) match code and prompted realizations across coding,
terminal-use, and computer-use benchmarks. Note the boundary against §3.1: externalizing *control
policy* is free; adding *task prose* is not.

**There is no measure of harness coverage or quality analogous to code coverage or mutation
testing.** [opinion — open problem, named by Böckeler and by the Guo survey] Anyone building a
harness today, Bridge included, is doing so without a completeness metric.

---

# 4. What this means for Bridge

## 4.1 Where the evidence confirms Bridge's canon

These are not self-congratulation; each is a case where an independent measurement supports a
decision already made.

```yaml
confirmed:
  - canon: "kernel decides, agent explains" — deterministic authority, never prompt-asserted
    evidence: >
      tau-bench: a policy document in context yields under 50% success and pass^8 below 25%.
      OpenAI enforces architecture with linters, not instructions. Cursor's own docs disclaim its
      LLM approval classifier as "not a security boundary".
    verdict: strongly supported. Bridge should state the LLM-as-approver rejection as a deliberate position.
  - canon: Goal/Task assignment selects the Skill, not the model
    evidence: arXiv 2604.04323 — skill benefits degrade to baseline once retrieval is realistic over 34k skills
    verdict: Bridge implements the paper's recommended mitigation
  - canon: at most one route; no peer handoffs (Chief of Staff)
    evidence: Cognition's 2026 reversal (fan out on reading, serialize writes); MAST's inter-agent misalignment cluster
    verdict: correct, and enforced by the type system rather than by guidance
  - canon: append-only Ledger, written by code, never by Agents
    evidence: Freeman's event-sourcing argument; AHE's component-observability requirement
    verdict: Bridge arrived here first and with governance semantics the others lack
  - canon: Local Plane and deny-default Plane Gate
    evidence: Relay.app's shutdown (2026-08-15 / 2026-09-14) is the live demonstration of cloud-only control-plane risk
    verdict: validated by events, not just argument
  - canon: propose -> decide -> commit, with the Skill run held before the Decision
    evidence: >
      LangGraph's interrupt re-runs the node from the top; its own docs warn side effects duplicate
      ("create ticket + email customer" creates the ticket twice). Bridge is structurally immune.
    verdict: an unstated competitive advantage — write it down
```

## 4.2 Where the evidence challenges Bridge

This section matters more than the previous one.

**1. More governance structure is not automatically better, and Bridge has never measured its own
overhead.** [empirical] Instruction files measurably hurt; higher reasoning effort hurt in most of
21,000 rollouts; skills degrade toward baseline. The independent academic results are *consistently
more skeptical of added scaffolding complexity* than the vendor posts. Bridge's Engine adds
authority resolution, policy evaluation, taint joins, manifest gates, and review computation to every
Action. That is very likely worth it for a governed product — but it is currently an article of
faith. **Nothing in the repository measures the cost or benefit of the governance layer itself.**

**2. The self-improvement thesis is blocked on measurement, and always was.**
`docs/wiki/undefined-elements.md` already identified the measurement layer as "the least-defined and
most load-bearing" part of the system, and ranked the eval harness #1 by leverage. That was 2026-07-08.
The harness has since been *built* — types, store, scorers, judge, comparison, AQV reducers, and the
`writeEvalRunEvidence` join into `capability_states.evidence` all exist. It is unfed: the store is
in-memory in both modes, and two of seven axes read an `executionSnapshot` that nothing writes. The
external work (Self-Harness, DGM, AHE) shows what the loop produces once it runs. Bridge is one small
piece of plumbing away from being able to run it.

**3. "Replayable" and "Scheduled Automation" are canon claims that are currently untrue.** The
glossary defines a Run as "deterministic, attributable, replayable"; there is no replay driver.
It defines Scheduled Automation; there is no scheduler anywhere in `platform/`. Vocabulary is meant
to name durable distinctions, and a distinction with no referent weakens the whole glossary. The
honest options are build or remove — not leave.

**4. Bridge has no isolation at any rung of the ladder.** The field ranks isolation as process → OS
sandbox → container → worktree → VM. Bridge is at zero: the container adapter throws, and no
`SandboxProvider` is wired into the API at all. This sits directly under the ambition to accept
community and AI-generated capabilities. OpenClaw is the cautionary case — a resident personal agent
with real host access whose architecture was defensible and whose **defaults** were not: sandboxing
off by default, 40,214 internet-exposed instances, 35.4% flagged vulnerable.

**5. Runaway cost is the field's most consistent production failure, and Bridge has no ceiling.**
CrewAI delegation loops burning tokens before anyone notices; Lindy credit burn with caps enforced
only *after* execution; Zapier's hard activity cliffs; Devin's ACU shock. AG2 v1.0 is the only
framework putting loop and cost containment in the framework itself. Bridge computes receipts and
reserves child-run budgets, but has no organization-wide spend ceiling that halts execution, and
`SkillBudget.maxCostPerDay` is declared and never read.

## 4.3 Ideas worth taking from specific platforms

```yaml
adopt:
  - from: Codex CLI
    idea: two-phase execution — setup has network and secrets; both removed before the agent phase
    why: cheap structural answer to the Lethal Trifecta, complements taint rather than duplicating it
  - from: Temporal
    idea: Codec Server — payloads encrypted, decoded only on customer-controlled hosts
    why: an almost exact fit for keeping the Plane Gate auditable without egressing content
  - from: Temporal
    idea: Worker Versioning — pin each execution to the code version it started on
    why: Bridge has no answer for in-flight Runs when a Module Version changes
  - from: Relay.app
    idea: approval object with assignee, due date, reminders, and skip/end/reassign escalation
    why: Review Mode computes WHETHER approval is needed and nothing about accountability
  - from: Lindy
    idea: side-effect-free eval Run mode, and listening channels that wake with thread context
    why: both are cheaper for Bridge than they were for Lindy, because propose/commit is already split
  - from: opencode
    idea: compaction modelled as an Agent, not a hidden subroutine; "deny hides the capability"
    why: fits Bridge's ontology exactly; hiding is stronger than refusing
  - from: OpenClaw / ClawHub
    idea: registry checks a skill's DECLARED env vars, binaries, and install specs against behaviour
    why: an implementable design for the supply-chain half of the Commons Privacy Gate
  - from: n8n
    idea: cluster node — root node with attached model/memory/tool sub-nodes
    why: the cleanest reconciliation of graph and agent; a candidate for Module manifest structure
  - from: LangGraph
    idea: short-term thread checkpointer versus long-term cross-thread Store
    why: cleaner than Bridge's single Memory umbrella
    caution: >
      Take the split, not the implementation. LangGraph's checkpointing produces documented write
      amplification (~100 rows per graph trip; 56 MB across 18,000 records in one week of staging;
      "85% storage bloat with no opt-out path"). Any Bridge checkpoint design must specify
      retention, pruning, and a serializer UP FRONT.
reject:
  - idea: LLM-as-approver (Codex auto_review, Cursor Auto-review)
    why: >
      Both shipped in 2026 within months of each other; Cursor's own docs disclaim theirs as not a
      security boundary; safety properties are unsettled. "Kernel decides, agent explains" is the
      better position.
  - idea: free-text instruction files as the primary steering mechanism
    why: measurably reduce success and raise cost over 20% (arXiv 2602.11988)
  - idea: letting an Automation or trigger invoke a capability directly
    why: every prosumer platform permits it, and CrewAI delegation loops plus Zapier activity cliffs are the results
```

---

# 5. Recommended next steps

Ordered by expected value. Each carries the evidence it rests on. Full item-level detail is in
[`primitives.md` §G](primitives.md).

## Tier 1 — do these first

**N1. Feed the eval harness.** Persist `EvalStore` to Drizzle and write the execution snapshot the
pipeline already holds. *(primitives F2-R1, A1-R1)*

> Highest ratio of value to remaining work anywhere in the Engine. The harness is built; it is
> unfed. This unblocks two of seven AQV axes, the promotion gate, the replay driver, and the entire
> self-improvement thesis. The external evidence (Self-Harness, DGM, AHE) shows the loop produces
> 14–30 point gains under a fixed model once it can run. [empirical]

**N2. Bind and wire one real sandbox adapter.** *(D5-R1)*

> Largest safety gap. Every other safety primitive assumes code runs where it is told. Do not open
> Commons to community or AI-generated origins until this lands — the trust tiers already pin
> community equal to `user_code`, which is the correct posture and is only meaningful if untrusted
> code has somewhere isolated to run. Codex's choice of OS-kernel sandboxing over containers is the
> cheapest strong option to evaluate first. [empirical: arXiv 2503.23278; OpenClaw CVE record]

**N3. Make the Capability Trust Model's inputs real.** Read `trust_grants` at the three call sites;
persist activation budgets and the kill switch. *(B5-R1, A4-R1)*

> A well-built machine wired to constants. Trusted Status, earned autonomy, and Auto Mode are all
> inert until this lands, and a Kill Switch that forgets it was pulled is worse than none because
> the operator believes it holds. Small change — the table, types, and filter all exist.

**N4. Replace the context-overflow throw with governed compaction.** *(A2-R1)*

> Bridge is the only harness surveyed that *fails* the conversation rather than compacting it. Model
> compaction as an Agent (opencode's pattern) so it stays attributable, and pair it with the durable
> artifact — which Bridge already has in Memory plus the Ledger, and which Anthropic's work shows is
> the half that actually carries long-horizon work. [empirical: Anthropic long-running harnesses]

**N5. Resolve the canon-versus-code divergences.** Ship a scheduler or remove "Scheduled Automation";
build `Plan`/`Planner` or remove them; correct the six documentation claims in
[`primitives.md` §I](primitives.md). *(C3-R1, C6-R1, B2-R1)*

> Three canonical primitives currently have no referent, and one wiki page claims a security
> carve-out that the code does not implement. Both are governance defects in a project whose thesis
> is that vocabulary and governance are the product.

## Tier 2 — high value, sequenced after Tier 1

**N6. Add an organization-level spend ceiling that halts execution.** *(F1-R1)* — runaway cost is
the field's most consistent production failure and AG2 is the only framework that contains it
structurally.

**N7. Complete the approval object** with assignee, due date, reminders, and skip/end/reassign
escalation, and define the crash-survival contract for pending approvals. *(B7-R1, B7-R3)* — an
approval nobody owns and that never escalates is a silent stall.

**N8. Write `decision_traces`** from data `resolveAuthority` already returns and the pipeline
currently discards. *(B8-R1)*

**N9. Build the replay driver.** *(A3-R1, depends on N1)* — the determinism seam is already paid for.

**N10. Measure pass^k and adopt MAST's failure taxonomy.** *(F2-R3, F2-R4)* — pass^1 is a vanity
metric; tau-bench's 61% → under-25% gap is the difference between a demo and a product. [empirical]

## Tier 3 — worth doing, not urgent

Per-step Automation persistence and bounded retry/timeout/compensation *(C3-R2, C3-R3)*; the Codec
Server pattern for Plane Gate audit *(B3-R1)*; two-phase credential stripping *(B3-R2)*; Worker
Versioning for in-flight Runs across Module Versions *(E3-R1)*; listening channels *(C3-R4)*;
short-term/long-term memory separation *(E1-R1)*; streaming on `ModelProvider` *(F1-R2)*.

## The one decision that should be made deliberately

**Does a Bridge Agent get a tool loop?** Three roadmap items are really one question — C1-R1 (Agent
tool loop), C6-R1 (Planner), F1-R3 (`ModelProvider` loop support). Today every kernel model call is
one-shot, and `AnthropicProvider` uses tool-calling *only* as a structured-output constraint with
parallel use disabled. The canon says "Planner proposes a DAG, governed deterministic DAG executes" —
but the Planner is unbuilt, so the current state is neither design, by accident rather than choice.

If a Planner is built, **CaMeL is the design to follow**: extract control flow from the *trusted*
request into an explicit program so untrusted data can never alter it. That is the separation Bridge
already draws between the Planner (no authority) and the Run, and it comes with a measured cost —
77% of AgentDojo tasks solved *with provable security* versus 84% undefended. [empirical]

## What not to do

- **Do not add an LLM approver.** Two vendors shipped it; one disclaims its own as not a security
  boundary.
- **Do not add a free-text instruction file** as a primary steering mechanism. [empirical: it hurts]
- **Do not build multi-agent fan-out with parallel writes.** Fan out on reading; serialize writes.
- **Do not open Commons to untrusted origins before N2.**
- **Do not adopt LangGraph-style checkpointing without specifying retention, pruning, and a
  serializer first.** Its users are paying for that omission now.

---

# 6. A standing measurement discipline

Adopt these as rules, not as a project. Each follows directly from §3.

```yaml
rules:
  - rule: Never A/B a model change without holding the harness constant, and vice versa
    source: arXiv 2606.08529 (28-point scaffold effect)
  - rule: Treat every always-loaded instruction token as a recurring cost requiring A/B justification
    source: arXiv 2602.11988 (instruction files reduced success, +20% cost)
  - rule: Report pass^k, never pass^1 alone
    source: arXiv 2406.12045 (61% -> under 25% at k=8)
  - rule: Grade on verifiable end-state, not on plausible output
    source: tau-bench, SWE-bench, GAIA all chose this independently
  - rule: Read the trajectories; aggregate scores conceal reward hacking
    source: arXiv 2510.11977 (21,000 rollouts)
  - rule: Instrument the failure DISTRIBUTION using MAST's categories, not just the success rate
    source: arXiv 2503.13657
  - rule: Gate promotion on a held-out split the proposer never sees
    source: Self-Harness, DGM, AHE all report this as a precondition
  - rule: Every harness component must be a file — diffable, revertible, attributable
    source: same three
  - rule: When a model improves at X, delete the component that existed to compensate for X
    source: Anthropic via Osmani [opinion, but the right maintenance discipline]
```

---

# 7. Verification status and gaps

Honesty about what this research does and does not establish.

```yaml
verified_primary:
  - the Freeman substack piece (full text)
  - Anthropic: effective-harnesses, context-engineering, writing-tools, demystifying-evals
  - LangChain "Anatomy of an Agent Harness"; Böckeler; Osmani; OpenAI harness engineering
  - Cognition (both posts); Willison; METR elicitation pages
  - arXiv 2210.03629, 2303.11366, 2302.04761, 2310.06770, 2406.12045, 2506.07982, 2311.12983,
    2307.13854, 2506.16042, 2503.13657, 2503.23278, 2503.18813, 2505.02077, 2602.11988, 2604.04323,
    2606.08529, 2510.11977, 2510.04618, 2408.08435, 2410.10762, 2603.28052, 2604.25850, 2605.30621,
    2605.27276, 2606.09498, 2603.25723, 2606.14249, 2606.20683
  - all Bridge-side claims in primitives.md were verified against code at file:line, not inferred

unverified_ids_do_not_cite_without_checking:
  - Voyager 2305.16291; Generative Agents 2304.03442; MemGPT 2310.08560; Mem0 2504.19413
  - OSWorld 2404.07972; AgentDojo 2406.13352; Darwin Gödel Machine 2505.22954

flagged_for_follow_up:
  - arXiv 2604.02460 — single vs multi-agent under EQUAL thinking-token budgets. A direct control on
    Anthropic's 90.2% multi-agent claim. Read before citing that number as architectural evidence.
  - SagaLLM 2503.11951 — transaction guarantees for multi-agent planning; the closest academic
    analogue to the event-sourcing thesis and directly relevant to C3-R3.
  - TapeAgents — structured replayable log; relevant to A3-R1.

bias_note: >
  The strongest quantitative claims FOR multi-agent benefit (Anthropic) and for harness-only
  leaderboard gains (LangChain, OpenAI) are all vendor-reported on internal or self-selected evals.
  The independent academic results are consistently MORE skeptical of added scaffolding complexity.
  Where they conflict, this document weights the independent work.

research_limitations:
  - The Parallel Search MCP hit its free-tier rate limit partway through (no x-api-key configured);
    later queries fell back to WebSearch/WebFetch. Some platform sections are thinner as a result and
    say so inline.
  - Platform facts are current as of 2026-07-29 and this category churns fast — see
    comparative-analysis.md §7 for the 2026 vendor-churn record, which is itself a finding.
  - A premise correction worth recording: pi.dev is Mario Zechner's Pi harness (Earendil Inc.,
    github.com/earendil-works/pi), NOT Parallel Web Systems or "pi Labs". OpenClaw's agent runtime
    is Pi in RPC mode, so those two platforms are layered rather than independent.
