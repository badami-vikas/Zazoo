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

**5 agents (unchanged roster from ADR-032, fuller detail here):** Chief of
Staff (only non-deletable, spirit-animal identity, default interlocutor,
`@name` bypasses it in chat) · Learning Agent (research/observation/feedback,
never executes) · Communications Agent (drafts/summarizes/explains — **tone
must match chosen spirit animal**, new requirement) · Governance Agent
(permissions/risk/compliance/approvals) · Capability Builder (builds after
approval only). No agent tiers — every agent is a first-class primitive,
CoS just can't be deleted. Imported/marketplace agents get wrapped with full
Bridge governance, same as native.

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
"use sub-agents where necessary" read as — the 4 non-CoS agents need to
become actually separate invocable agents, not prompt fragments inside one
CoS call (today's `chief-of-staff.ts` is a single node, no peers).

**Status: docs only, 2026-07-08.** Build deferred — session already flagged
cost (~$83+) and file-count (85+) warnings this pass; account/OTP/LinkedIn/
browser-extension/4-new-agents is a large multi-surface slice, needs an
explicit user go-ahead on scope/order before spawning build agents.
