# Module Evolution

full: [../raw/module-evolution-system-2026-07.md](../raw/module-evolution-system-2026-07.md)

ADR-032. Two user docs merged: v1 (Commons Module Creation & Evolution
System, form-heavy) superseded by v2 (AI-Led flow, conversational). v2 wins
on shape — AI infers, user validates only ambiguous bits. v1's substance
(Component Registry, evaluation, versioning, governance) stays, AI fills
forms instead of user.

Already built, don't rebuild: chiefOfStaff.converse, pipeline.propose,
PackageStore/packages.list, Commons registry v1, NewModuleDialog v1.

Net new (designed, not built): Component Registry, similarity detection,
eval harness, versioned Module updates + propagation governance, community
signals.

**Minimal egg** — kernel = actors (Human/Agent/Automation) + capability
execution engine + work pipeline (Request/Action/Incident/Artifact +
governance) + surface compiler (Workspace/Element/ElementType/View) +
Memory/Knowledge storage + CoS archetype + ModelProvider/PackageStore/
CommonsRegistry ports + Trust Model. Everything else = Commons content,
installed on demand (every compiled workspace_definition, every Skill/
Assistant/Automation/Workflow/prompt/template/policy outside kernel
governance, eval sets, non-default routing, connectors). Rule: chrome fixed,
content streams in. Permanent pressure, not one-time.

**Confidence-tiered flow**: high conf → do it, state what happened. Medium →
recommend one, ask confirm. Low → 2-3 labeled options + stated pick, never
more. Never surface agent/skill/workflow/routing/schema nouns mid-flow —
user sees Assistant/Tool/Automation/Knowledge/Connection/Module/Initiative.

**Learnings adopted**: ServiceNow (governance/audit INSIDE creation flow,
same ledger Approvals reads) · Dust Sidekick (builder agent introspects its
own artifact — config/usage/feedback → concrete diff, not just fresh-gen;
this becomes CoS's ongoing-optimization behavior) · LangSmith (eval-harness
PATTERN adopted, not the vendor — Commons hosts its own dataset+scoring
registry, same reasoning as prior OpenFGA/OPA rejections).

**Governance**: signals → candidate → small experiment → comparison →
recommend → user/admin accepts (unless auto-update on) → propagate. Local
Initiative customization never silently overwritten. Version updates carry
what/why/eval-results/affected-Initiatives/rollback, support auto/staged/
opt-out/pin/rollback.

**Day-1 bar (user, explicit priority over next-wave items above)**: onboarding
agent on Grok API + 5 agents inbuilt, so Module proposals get drafted in
real time during onboarding and land in Approvals (shipped-for-approval, not
shipped-live). **STATUS: not present** — no Grok provider behind
ModelProvider yet, only single CoS classifyIntent/converse exists.

**The 5 agents are already canon** (`docs/raw/roadmap-v2-universal-commons.md`
— "only five permanent agents exist"; an earlier draft of this page invented
a different mapping, corrected here): **Chief of Staff** (coordinates,
default interlocutor, owns the final proposal into Approvals) ·
**Learning Agent** (research/observation/feedback, NEVER executes — checks
Component Registry/installed Modules for overlap) · **Communications Agent**
(turns findings into the plain-language summary the user reads) ·
**Governance Agent** (permissions/policy/compliance/risk scoring before
anything reaches Approvals) · **Capability Builder** (drafts new capabilities
AFTER approval only — never ships live). Team feeds ONE governed draft per
turn, no independent write access. GrokProvider = new ModelProvider
implementation, config-selectable for onboarding path, needs xAI key (code
builds without one, fails closed).

**Sequencing ruling**: Day-1 slice (Grok provider + 5-agent onboarding team +
live Module-proposal drafting) ships BEFORE Component Registry/eval-harness/
versioning/community-signals wave.
