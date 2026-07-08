---
title: AI-Led Module Creation & Evolution System
type: raw
doc_kind: design
status: proposed
companions: [commons.md, primitive-specifications.md, capability-evolution.md]
related_wiki: ../wiki/module-evolution.md
updated: 2026-07-07
tags: [commons, module-lifecycle, chief-of-staff, evaluation, onboarding, minimal-egg]
---

# AI-Led Module Creation & Evolution System

Synthesizes two user specs (2026-07-07): "Commons Module Creation & Evolution
System" (structured, form-heavy v1) and its user-directed revision "AI-Led
Module Creation & Onboarding Flow" (conversational, confidence-based,
chunked-choice v2). **v2 supersedes v1's information-gathering shape; v1's
metadata/registry/evaluation SUBSTANCE stays** — the system still needs all
that structure, the AI just fills it in instead of asking the user to.

## Core principle (v2 override)

Do not make the user configure the platform. The user describes an outcome;
the system infers architecture; the user validates only where the system is
genuinely unsure. Every step answers: *does this reduce cognitive load, avoid
re-asking what's inferable, and reuse before creating?*

## What's already built vs what this designs

Already real (do not rebuild): `chiefOfStaff.converse` (classifyIntent + model
path + keyword fallback, star topology, chain-depth cap), draft-then-approve
pipeline (`pipeline.propose`), `packages.list`/`PackageStore` (install states),
Commons registry v1 (`platform/services/commons`, [wiki/commons.md](../wiki/commons.md)),
`NewModuleDialog` v1 (picks an installed Module → one CoS turn → confirm/override).

Net new, designed here: Component Registry, similarity/overlap detection,
lightweight evaluation harness, versioned Module updates with propagation
governance, community signal aggregation, confidence-tiered conversational
creation flow, and the Day-1 onboarding-agent slice (see final section).

## Minimal egg — what's kernel vs what migrates to Commons

**Kernel (ships with Bridge, never optional, never a Module):**
- Execution actors: Human / Agent / Automation runtime
- Capability primitives: Skill/Integration *execution* (the engine that runs
  one, not any specific one)
- Work primitives: Request / Action / Incident / Artifact + the governance
  pipeline (draft → propose → approve → execute → ledger)
- Surface primitives: Workspace / Element / ElementType / View compiler
  (`compileBlueprint`) + the DataViews shell
- Context primitives: Memory / Knowledge storage + retrieval seam
- The five permanent agent archetypes (Chief of Staff, Learning Agent,
  Communications Agent, Governance Agent, Capability Builder — below)
- `ModelProvider`, `PackageStore`, `CommonsRegistry` ports (seams, not content)
- Capability Trust Model (risk bands, trust grants, approval gates)

**Everything else is Commons content, installed on demand:**
- Every compiled workspace_definition (DealPilot, JobPilot, Helpdesk, …)
- Every Skill/Assistant/Automation/Workflow/prompt/template/policy that isn't
  part of the kernel's own governance or compiler
- Evaluation sets, routing rules beyond the star-topology default, integration
  connectors

This is the existing minimal-egg call (`docs/raw/decisions-log.md`, the
six-container ADR) **restated against the current IA** (ADR-029 nav: Home →
Initiatives → +New → Settings) rather than the superseded six-container shell.
The rule is unchanged: **chrome and primitives are fixed; content streams in
from Commons.** Pushing more into Commons keeps the egg light — that pressure
is permanent, not a one-time pass.

## Confidence-tiered conversational creation (v2 flow)

```
User: "I want a better contract review assistant."
        ↓
Chief of Staff infers: new vs. extend? which Module/Initiative? overlap with
existing components (Component Registry lookup)?
        ↓
High confidence  → proceed, then state what was done ("I'm adding this as a
                    skill improvement to Contract Review because it overlaps
                    with the existing clause-extraction skill.")
Medium confidence → recommend ONE option, ask to confirm ("I recommend
                    extending Contract Review. Continue?")
Low confidence    → present 2–3 labeled options, never more, with a stated
                    recommendation ("A. Extend Contract Review  B. New Legal
                    Risk Module  C. Add to current Initiative only —
                    I recommend A.")
        ↓
User confirms/overrides only the ambiguous step
        ↓
System creates/extends/merges, runs a lightweight evaluation if a similar
component exists, and summarizes what changed.
```

Never expose agents/skills/workflows/routing/schemas/policies during this
flow — user-facing nouns stay Assistant / Tool / Automation / Knowledge /
Connection / Module / Initiative. Advanced users can expand to primitives from
the Control Panel (progressive disclosure, already the nav's design rule).

## Component Registry (net new)

Platform-level registry of every reusable Intelligence component (agent,
skill, automation, workflow, prompt, evaluation set, routing rule, policy,
integration, template). Metadata per component: purpose, input/output
contract, supported domains, source Module, dependents, permissions, risk
level, evaluation history, usage history, version, owner, status. This is
what makes similarity detection and impact analysis possible — without it,
"is this a duplicate?" has no ground truth to check against.

Build order: schema + CRUD first (mirrors `PackageStore`'s shape, lives
alongside it in `@bridge/core`), similarity search second (start with
structural comparison — task type, I/O schema, required Knowledge — before
reaching for embeddings), evaluation wiring third.

## Lightweight evaluation (adopts LangSmith's *pattern*, not the vendor)

Commons hosts an eval harness + dataset registry so any two candidate
components (existing vs. proposed) get scored on the same axes every time:
task completion, quality/accuracy, reliability, safety, latency, cost, and
recorded user/admin preference. Outcomes: retain existing, replace, keep both
for different contexts, merge, reject, or mark experimental — **per Module**,
since the same component can win in one context and lose in another.

**Why not adopt LangSmith directly**: same reasoning as the prior OSS-map
ADR (OpenFGA/OPA rejected) — the eval *harness* is a commodity pattern
(dataset → scored run → comparison), Commons already owns the registry and
governance data model it needs to plug into, and a vendor dependency here
would put evaluation data outside the local-first/Commons-cloud swap story.
Build our own harness behind a port; revisit only if in-house eval quality
plateaus.

## Chief of Staff role expansion + ServiceNow/Dust learnings

**From ServiceNow (AI Agent Studio / Build Agent)**: governance, testing, and
audit trails belong *inside* the creation flow, not bolted on after — every
CoS creation/evaluation/promotion decision writes to the same ledger
Approvals already reads, not a side channel. **Adopt.**

**From Dust (Agent Builder "Sidekick")**: a builder agent that *introspects
its own artifact* — reads a Module/agent's current config, usage metrics, and
feedback, then proposes concrete diffs ("swap this tool," "this skill is
underused, retire it") rather than only generating from a blank state.
**Adopt** as the Chief of Staff's ongoing-optimization behavior (the
"Community Optimization" section below), not just its creation-time behavior.

**From LangSmith**: standardized eval-and-compare, covered above.

Net: Chief of Staff's job grows from "route one message" to also: review
proposed Modules, detect duplicates/overlap, run evaluations, recommend
merge/replace/experiment, explain reasoning in plain language, and protect
users from unnecessary complexity — governed the same way every other CoS
action is (draft → propose → approve).

## Community optimization + governance guardrails

Preference signals (installs, kept-active, removed, repeated skill
invocation, low-edit outputs, accepted suggestions) suggest candidates for
improvement — they never auto-promote. Flow stays: signal → CoS-identified
candidate → lightweight experiment on a small Initiative set → comparison →
recommendation → **user or admin accepts, unless auto-update is explicitly
enabled** → propagation. Local Initiative customization is never silently
overwritten. Version updates ship with: what changed, why, evaluation
results, affected Initiatives, rollback option, and a choice of
automatic/staged/opt-out/pin/rollback per Initiative. Governance axes
(privacy, security, compliance, bias, cost, reliability, explainability,
rollback, audit) gate promotion the same way the Capability Trust Model
already gates everything else — this is a new *evaluated input* to that
model, not a parallel governance system.

## Day-1 capability: onboarding agent, 5 agents, Grok, real-time module shipping

User's explicit Day-1 bar (2026-07-07): the onboarding agent runs on the
xAI Grok API and has all 5 agent archetypes built-in and ready, so that
**during onboarding**, in real time, new Module proposals get built and
shipped for approval (or mapped to existing Modules) — not deferred to a
later wave.

**Status: not present.** No Grok/xAI provider exists behind `ModelProvider`
today (seam is Ollama-dev / configurable-prod / Claude-default). No 5-agent
onboarding team exists — only the single Chief of Staff `classifyIntent` +
`converse` path. This gap is filed as the top-priority build item, ahead of
the Component Registry/evaluation/versioning system above (those remain
designed-not-built, sequenced after Day-1 per the user's explicit ordering).

**The 5 permanent agents are already canon** (`docs/raw/roadmap-v2-universal-commons.md`,
"Only five permanent agents exist" — this doc's earlier draft invented a
different 5-agent mapping; that was wrong and is corrected here to the
existing design):

1. **Chief of Staff** — coordinates the platform: planning, delegation,
   prioritization, explanations, capability recommendations. Default
   interlocutor; presents the confidence-tiered options/summary during
   onboarding and owns the final draft-then-approve proposal into Approvals.
2. **Learning Agent** — learns from observation, research, user feedback,
   connected systems; builds user/domain understanding and recommendations.
   **Never executes actions.** During onboarding this is the agent that
   researches the stated domain (Step 3 of Workspace Generation, below) and
   checks the Component Registry / installed Modules for what already covers
   the inferred intent — the similarity-detection role.
3. **Communications Agent** — drafting, summarization, explanation, reports,
   meeting prep, documentation. During onboarding this is the agent that
   turns the Learning Agent's findings + Chief of Staff's decision into the
   plain-language summary the user actually reads ("I found strong overlap
   with X, recommending Y because Z").
4. **Governance Agent** — evaluates permissions, policies, approvals,
   compliance, risk. Computes the risk/trust inputs for whatever the
   Capability Builder is about to draft, before it reaches Approvals — the
   same Capability Trust Model already gates everything else through.
5. **Capability Builder** — creates new capabilities **after approval** only
   (workflows, skills, agents, tools, integrations, UI extensions). This is
   the agent that drafts the new/extend/merge Module structure once the
   Learning Agent finds no sufficient match and Governance has scored it —
   but it drafts, it does not ship live; the draft still goes through
   Approvals like every other proposal.

No agent here executes without going through the existing governed
pipeline — this is a five-agent reasoning/build team feeding one proposal
per turn, not five independent actors with write access. The **Evaluator**
role from the earlier design section above (lightweight comparison when a
near-match exists) is Learning Agent + Governance Agent working together,
not a sixth agent — Learning Agent supplies the comparison data, Governance
Agent scores the risk/compliance side of the retain/replace/coexist call.

**Grok integration shape**: add `GrokProvider` implementing the existing
`ModelProvider` interface (mirrors however `ClaudeProvider`/`OllamaProvider`
are structured today), selectable via config for the onboarding path
specifically (does not have to become the platform-wide default). Needs an
xAI API key supplied by the user/ops — the code path can be built and wired
without one (fails closed with a clear "Grok not configured" error), but live
use is blocked until a key exists.

**Real-time module shipping during onboarding**: as onboarding extracts
intent, the Learning Agent checks it against installed Modules live; if no
sufficient match, the Governance Agent scores it and the Capability Builder
drafts a Module proposal that goes into Approvals the same turn
(draft-then-approve, never silent-install) — "shipped for approval,"
matching the user's phrasing exactly, not shipped-and-live.

## Sequencing (this ADR's ruling)

1. **Day-1 (this wave)**: `GrokProvider` behind `ModelProvider`; the five
   permanent agents wired into the existing onboarding flow; real-time
   Module-proposal drafting during onboarding, landing in Approvals.
2. **Next wave**: Component Registry (schema + CRUD + structural similarity),
   lightweight evaluation harness, versioned Module updates + propagation
   governance, community signal aggregation. All designed above; none built
   yet.
