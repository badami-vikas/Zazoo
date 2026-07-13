# Foundational Agents + Onboarding

full: [../raw/bridge-foundational-agents-onboarding-2026-07.md](../raw/bridge-foundational-agents-onboarding-2026-07.md)

ADR-033. Corrects ADR-032 two ways.

**Groq not Grok** — user typo. `GroqProvider` already exists
(`platform/packages/models/src/groq-provider.ts`, wired in `wiring.ts` behind
`GROQ_API_KEY`), built 2026-07-06, BEFORE ADR-032. ADR-032's "not present"
claim was wrong — codebase wasn't checked first.

**No separate onboarding agent** — Chief of Staff runs onboarding itself,
becomes the chosen spirit animal at reveal. Learning/Comms/Governance/
Capability-Builder are its permanent delegate team, not an onboarding-only
crew.

**4 agents + 1 skill (ADR-046, 2026-07-10, corrects the ADR-032/033 roster of 5):**
Chief of Staff (only non-deletable, spirit-animal identity, default
interlocutor, `@name` bypasses it in chat) · Learning Agent
(research/observation/feedback, never executes) · Governance Agent
(permissions/risk/compliance/approvals — sole holder of the auto-approve-MINOR
exception to agent-floor) · Capability Builder (builds after approval only).
No agent tiers — every agent is a first-class primitive, CoS just can't be
deleted. Imported/marketplace agents get wrapped with full Bridge governance,
same as native. **Communications demoted to a skill** (`draftCommunication` —
drafts/summarizes/explains, **tone matches chosen spirit animal**, unchanged
requirement): no independent decision authority or capability-scope, so it
carries no agent identity — any agent invokes it (Chief of Staff for
proposal summaries, Capability Builder for Module descriptions). See
[module-evolution](module-evolution.md) and `docs/raw/decisions-log.md`
ADR-046 for the full authority-ceiling reasoning.

**Onboarding flow (14 steps, condensed):** account → phone OTP → pick spirit
animal → egg-creating-workspace animation → Gmail-or-manual personalize →
egg hatches, CoS greets + gets named → workspace ready → Browser Companion
install pitch → LinkedIn-or-OTP browser verify → Home (Knowledge/
Intelligence/Calendar visible but inactive) → Knowledge unlocks at 2+
connected sources → Calendar unlocks on connect → Intelligence unlocks on
screen/system/terminal permission. Layered acquisition: direct input →
connected systems → continuous behavioral learning, no more onboarding Qs
after that.

**Open, not designed here:** onboarding-profile schema + how it becomes
CoS's system prompt (Memory/Knowledge seam is the right primitive family,
schema itself doesn't exist yet); tone-to-animal mapping (current
`SPIRIT_ANIMALS` = 6 animals, visual only, spec lists 14, no tone param);
"use sub-agents where necessary" read as — the 3 non-CoS agents (+ the
Communications skill) need to become actually separate invocable
targets, not prompt fragments inside one CoS call (today's
`chief-of-staff.ts` is a single node, no peers). **Shipped 2026-07-10**:
`@mention` dispatch now real for all 3 agents + the skill (`agents.ts`,
router.ts `chiefOfStaff.converse`).

**Status: docs only, 2026-07-08.** Build deferred — session already flagged
cost (~$83+) and file-count (85+) warnings this pass; account/OTP/LinkedIn/
browser-extension/4-new-agents is a large multi-surface slice, needs an
explicit user go-ahead on scope/order before spawning build agents.

**Dedicated agent roadmaps (2026-07-12)**: each non-CoS agent now has full
three-lens roadmap w/ per-slice exit criteria + metrics + risks —
[builder-agent](builder-agent.md) (BA0–BA6) ·
[governance-agent](governance-agent.md) (GA0–GA6: wrap built kernel in
decider identity; kernel decides, agent explains) ·
[learning-agent](learning-agent.md) (LA0–LA6: greenfield Memory/Mem0/
PromptAssembler/research; taint-first injection defense). Cross-deps:
PromptAssembler = one shared build (LA1+BA0); Builder BA4 needs GA1 risk
blocks + LA3/LA4 research; GA5 provenance before Commons ingestion.
