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
agent on Groq API (corrected from "Grok" — user typo, see ADR-033 /
[foundational-agents](foundational-agents.md)) + the 4-agent+1-skill team
inbuilt, so Module proposals get drafted in real time during onboarding and
land in Approvals (shipped-for-approval, not shipped-live). **STATUS:
GroqProvider already built** (predates this doc); `@mention` dispatch for
all 3 non-CoS agents + the Communications skill is now real (2026-07-10,
router.ts `chiefOfStaff.converse`) — full onboarding-flow wiring still open.

**The roster is canon, corrected 2026-07-10 (ADR-047)**: was "five permanent
agents" per `docs/raw/roadmap-v2-universal-commons.md`; Communications had no
independent decision authority or capability-scope (a stateless
context+tone→text transform), so it's now a skill, not an agent — see
[foundational-agents](foundational-agents.md) for the full reasoning.
**Chief of Staff** (coordinates, default interlocutor, owns the final
proposal into Approvals) · **Learning Agent** (research/observation/feedback,
NEVER executes — checks Component Registry/installed Modules for overlap) ·
**Governance Agent** (permissions/policy/compliance/risk scoring before
anything reaches Approvals; sole holder of the auto-approve-MINOR exception
to agent-floor) · **Capability Builder** (drafts new capabilities AFTER
approval only — never ships live), invoking the **Communications skill**
(`draftCommunication`) to turn findings into the plain-language summary the
user reads. Team feeds ONE governed draft per turn, no independent write
access. GroqProvider already exists
(`platform/packages/models/src/groq-provider.ts`), wired behind
`GROQ_API_KEY` — still open: wiring the 4-agent+skill team into onboarding
itself.

**Sequencing ruling**: Day-1 slice (4-agent+skill onboarding team + live
Module-proposal drafting, Groq provider already done) ships BEFORE Component
Registry/eval-harness/versioning/community-signals wave.
