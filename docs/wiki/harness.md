# Harness (wiki)

full: [../harness/](../harness/README.md) — [comparative](../harness/comparative-analysis.md) ·
[primitives](../harness/primitives.md) · [learnings](../harness/learnings-and-next-steps.md).
2026-07-29. Status **draft** — recommendations are proposals until [APPROVALS](../APPROVALS.md) flips them.

**Harness** = everything that isn't the model. Bridge's is the **Engine** + Modules/Skills/Automations.
Compared vs 20 externals: Claude Code, Codex, Cursor, Devin, opencode, OpenClaw, Pi, CrewAI, AutoGen,
AG2, MAF, OpenAI Agents SDK, AgentKit, Google ADK, LangGraph, Temporal, Hatchet, Mastra, n8n,
Relay.app, Zapier Agents, Lindy.

## Headline
Harness ≈ as load-bearing as the model. Scaffold choice alone = **28 pts** on GAIA within one model
(arXiv 2606.08529). Harness-only edits = **+14–21 pts** held-out, zero weight change (Self-Harness
2606.09498). DGM 20%→50% SWE-bench under fixed model. **A model score without a stated harness is not
a model measurement.**

## AHEAD (ours, field mostly lacks)
Deterministic **Authority Decision** (everyone else prompt-asserts or hands it to a 2nd LLM) ·
**residency** (Local/Cloud/Plane Gate — field's best equivalents much narrower) · **runtime taint**
(nothing surveyed has one; CaMeL is a research prototype) · **Child Agent Run** = 7-way authority
intersection · **Trust Model w/ earned+decaying trust** (only AG2's 2-day-old "Resume" is comparable) ·
**Ledger + authority explainability**.
Plus one **unstated advantage**: propose→decide→commit runs the Skill ONCE and commits after the
Decision. LangGraph's `interrupt()` re-runs the node from the top — its own docs warn side effects
duplicate ("create ticket + email customer" → ticket twice). We're structurally immune. Write it down.

## BEHIND
No **compaction** at all (we *throw* at 24 segments / 64k chars — everyone else compacts) · no
**sandbox** at any rung (container adapter throws; zero `sandbox` hits in `wiring.ts`) · no **durable
Run resume/checkpoint** · **eval harness built but unfed** · no **retry/backoff/idempotency** in the
engine · no **cost ceiling** · no **cost attribution / OTel** · no **approval SLA** (who, by when,
escalate how).

## DIFFERENT BY DESIGN — defend these
No **LLM-as-approver** (Codex + Cursor both shipped one in 2026; Cursor's own docs disclaim theirs as
"not a security boundary") · no **free-text instruction file** (ETH SRI: `AGENTS.md`/`CLAUDE.md`
*reduced* success, **+20% cost**) · **Automations never invoke Skills directly** (CrewAI delegation
loops + Zapier activity cliffs = the counter-examples).

## CANON vs CODE — 3 claims currently untrue
- Run "replayable" → seam exists (injected Clock/Rng/IdGen), **no replay driver**.
- **Scheduled Automation** → **no scheduler anywhere** in `platform/`. `rituals.md:20` claims
  Hatchet+BullMQ; neither dependency exists.
- **Plan / Planner** → in glossary, **zero implementation**.
Also: `governance-agent.md:5-6` claims Governance is the "sole exception to agent-floor approve-DENY".
It isn't — `pipeline.decide` floor-denies ALL agents unconditionally. Carve-out is lifecycle-only,
outside the ledger. `rituals.md:20` "explainability = `decision_traces`" — table has **zero
readers/writers**; web's `data/governance.ts` declares the shape but ships **empty** arrays behind
real loaders, so it's a missing feature not a dummy violation (`dummy.md:253` covers it); its
"Governance mock data" header is stale. Full list → [primitives §I](../harness/primitives.md).

## EMPTY INPUTS (built machine, constant inputs)
`trustGrants` hardcoded `[]` at 3 sites (`router.ts:12951,13423,4213`) — `trust_grants` table exists,
never read ⇒ **Trusted Status inert**. Budgets + Kill Switch **in-memory both modes** (a kill switch
that forgets it was pulled is worse than none). EvalStore, PolicyParams, CredentialBroker,
SkillManifestRegistry — same. All flagged honestly in code, none durable.

## EVIDENCE THAT CHALLENGES US
More structure ≠ better, and **we've never measured our own governance overhead**. Independent
academic work is consistently *more skeptical of scaffolding* than vendor posts: instruction files
hurt · higher reasoning effort hurt in most of 21k rollouts · skills degrade to baseline once
retrieval is realistic over 34k skills (2604.04323 — which *vindicates* AGS1: we dispatch
deterministically by Goal/Task, not by model choice).

## MEASUREMENT RULES (adopt as standing discipline)
pass^k **not** pass^1 (tau-bench 61% → **<25%** at k=8) · grade **end-state** not output · read the
**trajectories** (HAL caught agents googling the benchmark + misusing credit cards) · instrument the
**failure distribution** via MAST's 14 categories · gate promotion on a **held-out split the proposer
never sees** · never A/B a model change without holding the harness constant.

## NEXT (tier 1)
1. **Feed the eval harness** — persist EvalStore + write execution snapshots. Best value/work ratio
   in the Engine; unblocks 2 AQV axes, promotion gate, replay driver, self-improve thesis.
2. **Wire one real sandbox.** Gates Commons community origins.
3. **Make Trust Model inputs real** — read `trust_grants`, persist budgets/kill-switch.
4. **Governed compaction** instead of the throw.
5. **Fix canon-vs-code** — build or delete scheduler / Planner; correct the governance doc.

## ONE OPEN DECISION
**Does an Agent get a tool loop?** C1-R1 + C6-R1 + F1-R3 are one question. Today every kernel model
call is one-shot; `AnthropicProvider` uses tool-calling only as a structured-output constraint. Canon
says "Planner proposes DAG → governed DAG executes" but the Planner is unbuilt — so current state is
*neither* design, by accident. If building: follow **CaMeL** (2503.18813) — extract control flow from
the trusted request so untrusted data can't alter it. 77% of AgentDojo *with provable security* vs 84%
undefended.

## FIELD HEALTH (2026 churn = adoption risk)
**Relay.app SHUTTING DOWN** 2026-08-15/09-14 (validates Local Plane + signed Commons) · OpenAI
**Agent Builder + Evals dead 2026-11-30** · AutoGen maintenance-mode; users migrated 0.2→0.4→MAF ·
AG2 v1.0 "not a drop-in" = 2nd forced migration · **Mastra ~145 npm packages compromised** Jun 2026
(DPRK Sapphire Sleet) — we ship Mastra · OpenClaw CVSS 8.8 + 40,214 exposed instances, 35.4%
vulnerable · LangGraph `langgraph-api` is **Elastic License 2.0** not MIT.
⇒ Everything behind a port. Commons entries content-addressed, signed, exportable, unambiguously
licensed (n8n's "fair-code" cost it years).

## Note
pi.dev = **Mario Zechner's Pi** (Earendil Inc.), *not* Parallel/pi Labs. OpenClaw runs on Pi.
