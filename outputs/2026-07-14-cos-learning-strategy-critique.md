# CoS Learning Strategy — Critical Evaluation and Recommendation

Date: 2026-07-14

## Verdict

Claude's plan has the right spine—outcome signals, provenance-aware memory, governed promotion, and continuous evaluation—but it is still too memory-centric, too confident in several research transfers, and not sufficiently shaped around Bridge's actual advantage.

Bridge should not define its compounding thesis as “the agent remembers more.” It should define it as:

> Bridge gets better because it builds an increasingly accurate model of the user's context, increasingly effective capabilities for their work, and increasingly reliable evidence about when those capabilities should act—while every change remains inspectable, reversible, and governed.

The base model getting better is a tailwind, not the moat. The moat is accumulated local context + capability history + outcome evidence + governance history + a fast, safe evaluation loop.

## What the proposed plan gets right

1. **Signals before sophisticated adaptation.** A system cannot improve reliably if “better” is undefined. Bridge's existing Agent Quality Vector and execution ledger are the correct foundation.
2. **Contextual personalization before per-user model weights.** Current assistants primarily personalize through retrieved context and instructions. ChatGPT, for example, separates saved memories from chat-history reference and makes them inspectable and removable. [OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)
3. **Raw/source evidence must survive lossy summaries.** Extracted memories should be indexes or claims over source material, not replacements for it.
4. **Fast correction handling.** An explicit correction should affect the current interaction immediately and create a high-priority candidate update.
5. **Capability/workflow learning is more valuable than fact accumulation.** Reusable, certified procedures create durable leverage.
6. **Commons writes require a stronger gate than personal learning.** Generalized artifacts need provenance, privacy checks, cohort evidence, adversarial tests, versioning, rollback, and staged propagation.
7. **The learning mechanism itself needs evaluation.** Spotify explicitly separates the personalization system from the experimentation system: the former chooses experiences; the latter evaluates whether the chooser is beneficial. [Spotify engineering](https://engineering.atspotify.com/2026/1/why-we-use-separate-tech-stacks-for-personalization-and-experimentation)

## What needs correction

### 1. The plan overstates the verifier thesis

“Every mechanism that works requires a cheap, non-gameable verifier” is directionally useful for autonomous optimization, but too absolute for personalization. Many important outcomes—trust, appropriateness, interruption cost, long-term usefulness—are delayed, ambiguous, or partially observed.

Recommendation: use a **multi-signal evidence model**, not one reward:

- verified outcome;
- explicit user correction or confirmation;
- retained user edit / edit distance;
- task completion and downstream reversal;
- repeated behavior across comparable contexts;
- delayed satisfaction or regret;
- safety and policy violations as vetoes.

Signals must retain their provenance and ambiguity. Absence of a correction is not approval.

### 2. “Faster feedback is always better” is wrong at system level

ByteDance's Monolith supports the value of fresh feedback in a high-volume recommender, but it does not prove that every kind of agent learning should update rapidly. [Monolith paper](https://arxiv.org/abs/2209.07663)

Bridge needs asymmetric speeds:

- **Fast:** reversible, user-local corrections and context updates.
- **Medium:** workflow candidates and workspace adaptations after repeated evidence.
- **Slow:** autonomy changes, governance policy, and Commons promotion.

The greater the blast radius, ambiguity, or irreversibility, the slower and more strongly validated the update.

### 3. FSRS/HLR should not be copied into agent-memory decay

Duolingo's HLR evidence is strong for predicting *human recall*: it reduced recall-prediction error by more than 45% and improved engagement by 12% in its study. That does not validate an FSRS-style model for deciding whether an agent memory is useful. [Duolingo HLR paper](https://research.duolingo.com/papers/settles.acl16.pdf)

Agent memory does not “forget” like a person. It faces staleness, contradiction, retrieval competition, scope mismatch, and harmful over-application.

Recommendation: build a **memory utility and validity model**, with separate factors:

- temporal validity / supersession;
- source authority;
- contextual relevance;
- retrieval utility when used;
- harm or correction when used;
- sensitivity and permitted scope;
- redundancy;
- confidence and corroboration.

Use time decay only where the fact class warrants it. A birthday, a current project status, and a tone preference need different validity rules.

### 4. “Raw transcripts immutable” conflicts with Bridge privacy and deletion principles

Audit evidence can be append-only, but personal content cannot be universally immutable. Bridge already promises inspectable and deletable learned content and local-plane protection.

Recommendation: keep **immutable provenance events and tombstones**, while source content follows explicit retention, deletion, legal, and local-residency policies. Preserve traceability without making private content undeletable.

### 5. Retrieval benchmarks do not settle architecture choices

The Mem0 paper reports large latency and token-cost savings and claims advantages over other memory systems, but benchmark outcomes depend heavily on models, judges, question mix, and context strategy. [Mem0 paper](https://arxiv.org/abs/2504.19413)

Recommendation: keep Mem0 behind `MemoryPort`, as Bridge already plans, and force it to compete against:

- full recent context;
- simple hybrid retrieval over source evidence;
- structured graph lookup;
- extracted semantic memory;
- combined strategies.

Choose per task class on Bridge's own held-out and live evidence; do not canonize a memory vendor or a single benchmark.

### 6. GEPA is promising, not a weekly production default

GEPA's published results are genuinely encouraging: across six tasks it beat GRPO by 6% on average and used up to 35× fewer rollouts. This validates it as a challenger-generation method, not as authority to rewrite live system prompts automatically. [GEPA paper](https://arxiv.org/abs/2507.19457)

Recommendation: GEPA or similar optimizers may propose versioned prompt/policy candidates in offline evaluation. Promotion still requires held-out tests, safety vetoes, and staged release through Bridge's Capability Lifecycle.

### 7. Acceptance rate cannot be the north star by itself

GitHub found acceptance rate correlated strongly with perceived Copilot productivity, but later expanded its objectives to accepted-and-retained characters, code flow, latency, and other measures because acceptance alone favors short/easy suggestions. [GitHub acceptance research](https://github.blog/news-insights/research/research-how-github-copilot-helps-improve-developer-productivity/) [GitHub model evaluation update](https://github.blog/ai-and-ml/github-copilot/the-road-to-better-completions-building-a-faster-smarter-github-copilot-with-a-new-custom-model/)

Recommendation: Bridge should measure retained value and downstream reversals, not merely initial approval.

### 8. Deliberate exploration must be tightly bounded

Randomized exploration is useful for unbiased comparison, but an executive assistant cannot casually vary consequential behavior for experimental purity.

Allow exploration only when the choice is:

- low risk;
- reversible;
- non-egress;
- within an explicit user grant;
- not materially worse under any arm;
- recorded with propensity and version.

Never explore permissions, external sends, privacy boundaries, or safety policy.

## Recommended Bridge learning model

Use four product loops plus one evaluation plane.

### Loop 1 — Interaction adaptation (seconds to minutes)

Assemble the best current context and respond. Apply explicit corrections in-session. Record decisions, edits, outcomes, context used, and uncertainty. Do not silently turn every observation into durable truth.

### Loop 2 — Personal model consolidation (hours to days)

Convert evidence into typed candidate context:

- facts and current state;
- preferences with applicable contexts;
- relationships and concepts;
- goals and constraints;
- rhythms and recurring patterns;
- rejected suggestions and exceptions.

Reconcile contradictions, preserve provenance, and request confirmation in proportion to sensitivity and uncertainty.

### Loop 3 — Capability evolution (days to weeks)

Mine repeated successful work into candidate workspace changes, skills, automations, routing rules, and integration proposals. The Compiler turns learned patterns into diffs; the Capability Lifecycle validates, governs, activates, evaluates, and rolls them back.

This is Bridge's distinctive loop. Most memory assistants stop after Loop 2.

### Loop 4 — Commons learning (weeks to releases)

Promote only generalized capability knowledge—not personal context. Candidate Commons artifacts include:

- parameterized capability and workspace blueprints;
- certified skills and adapters;
- eval datasets and failure signatures;
- generalized routing and trigger priors;
- safety rules and compatibility knowledge;
- aggregate, privacy-safe performance statistics.

Commons items flow back down as priors and candidates. Egg instantiates them with local parameters, permissions, exceptions, and evidence. Local overrides never mutate the Commons artifact.

### Evaluation plane — evaluates all four loops

This is not another learning agent. It is deterministic infrastructure: versioned candidates, replay datasets, held-out cases, counterfactual comparison where valid, safety vetoes, staged rollout, live outcome monitoring, and rollback.

Spotify's useful lesson is that experiments should generate decision-grade information, including credible regressions and credible neutral results—not only winners. [Spotify Experiments with Learning](https://engineering.atspotify.com/2025/9/spotifys-experiments-with-learning-framework)

## How Bridge's architecture supports the thesis

| Bridge layer | Learning responsibility |
|---|---|
| Kernel | Typed context, provenance, evidence, versioning, trust, identity, permissions, outcome contracts, ledger |
| Learning Agent | Observes, researches, reconciles, and proposes Context/lesson candidates; never executes |
| PromptAssembler / retrieval | Contextualizes the general model for the user and task at interaction time |
| Compiler | Converts stable patterns into proposed workspace/capability diffs |
| Runtime | Executes the currently approved versions and records outcomes |
| Governance | Deterministically decides what may change or act; the agent explains the decision |
| Capability Builder | Produces draft implementations from approved proposals |
| Egg | Holds the local, personal instantiation: context, preferences, permissions, exceptions, learned capability parameters |
| Commons | Holds generalized, privacy-safe, versioned capability knowledge and evaluation assets |

This architecture is already closer to the correct answer than Claude's generic three-loop proposal. The missing connective tissue is a typed **Learning Event → Candidate Change → Evaluation → Governed Promotion** contract shared by Memory, Context, prompts, routing, workspaces, skills, automations, and Commons.

## What to call cross-agent propagation

The broad academic/organizational term is **blackboard-mediated organizational learning** or **shared-memory-mediated collective learning**.

For Bridge product language, use:

> **Verified cross-agent lesson propagation**

The `.gov.tw` example is more specifically **downstream-error-driven policy propagation**: QA observes an outcome, attributes it to a sourcing policy, and proposes a versioned rule that changes Research behavior.

Do not make “one correction improves every agent” literal. A lesson should propagate to every **affected dependent capability**, discovered through a dependency graph, only after scope and evidence checks. Otherwise one spurious correlation becomes a fleet-wide failure.

Each lesson needs:

- observation and outcome;
- causal hypothesis, explicitly marked as hypothesis;
- affected task/source/context scope;
- evidence count and counterexamples;
- proposing agent and provenance;
- dependency targets;
- proposed policy diff;
- test and rollback;
- local, organization, or Commons visibility.

## Why, what, when, and how

Do not choose between defining “why” and defining “how.” Define all four at different layers:

1. **Why = constitution/objectives.** User value, fidelity, safety, privacy, reversibility, and lasting capability improvement.
2. **What = typed learning objects.** Context claim, preference, exception, procedure, routing rule, capability diff, governance rule, Commons artifact.
3. **When = deterministic trigger policy.** Event-, evidence-, risk-, staleness-, and volume-based triggers; calendar schedules only as backstops.
4. **How = versioned learning operators.** Extract, reconcile, validate, simulate, compare, propose, approve, activate, monitor, demote.

The agent may recommend an operator, but it should not freely decide its own learning regime. A deterministic policy router should select the allowed operator from evidence × risk × reversibility × scope.

### Trigger priority

| Situation | Response |
|---|---|
| Safety violation, explicit correction, permission change | Immediate containment/invalidation; create governed update |
| Verified task result or substantial user edit | Post-task evidence update |
| Contradiction or material state change | Event-triggered reconciliation |
| Repeated pattern across comparable contexts | Threshold-triggered capability candidate |
| Retrieval crowding, duplicate claims, accumulated episodes | Idle/nightly consolidation |
| Stale time-sensitive fact or dormant capability | Validity-specific recheck |
| Cross-user generalization candidate | Slow cohort evaluation + privacy/governance gate |

## Recommended implementation sequence for Bridge

1. **Ship EVAL-1/EVAL-2 and outcome contracts first.** Extend the existing quality vector with task-class-specific outcome schemas and delayed reversal/retention signals.
2. **Build LA0/LA1 as already planned, but define typed Context candidates rather than a generic memory blob.** Preserve source evidence; Mem0 stays replaceable.
3. **Add the shared Learning Event contract.** Every correction, observation, result, contradiction, and lesson enters one typed, scoped, provenance-carrying stream.
4. **Build personal consolidation with validity rules, not FSRS.** Start with deterministic rules plus challenger scoring.
5. **Connect learning to the Compiler.** The first decisive demo should be: Bridge notices a repeated work pattern, proposes a workspace/automation improvement, proves it in replay, gets approval, and shows lower correction/friction afterward.
6. **Create a certified organizational lesson board.** Start with local/org scope; dependency-aware reads are immediate, writes are proposed and tested.
7. **Open Commons mining only after provenance, privacy, supply-chain trust, cohort evaluation, and staged rollback exist.** Keep Commons curated until then.
8. **Defer per-user fine-tuning, DPO/RLHF, autonomous self-play, and unrestricted online optimization.** Reconsider only when Bridge has sufficient consented data, stable evals, deletion semantics, and a demonstrated context-layer ceiling.

## Final recommendation

Adopt the plan's signal/evaluation/governance spine, but replace its “memory system plus meta-loop” center with a **governed capability-learning architecture**.

The clearest product proof is not “Bridge remembered that I prefer concise emails.” It is:

> “Bridge understood how I do this work, proposed a better way of doing it, proved the change was better, asked for the right level of permission, and continued improving it without losing my intent or privacy.”

That is both more defensible and more faithful to Living Software.
