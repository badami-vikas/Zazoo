---
title: Bridge Foundational Agents + Day-1 Onboarding Proposal
type: raw
doc_kind: design
status: proposed
companions: [module-evolution-system-2026-07.md, decisions-log.md]
related_wiki: ../wiki/foundational-agents.md
updated: 2026-07-15
tags: [agents, chief-of-staff, onboarding, groq, spirit-animal, day-1]
---

# Bridge Foundational Agents + Day-1 Onboarding Proposal

> **Current correction (2026-07-15, AP-023 / ADR-090):** the permanent roster is Chief of Staff, Learning, Internal Strategist, Governance, and Capability Builder. Communications is a Goal/Task-bound Skill family, not an Agent. Chief of Staff owns stakeholder management and coordination; Learning owns authorized research/evidence; Internal Strategist owns analytical synthesis and recommendations; Governance reviews and explains controls; Builder programs tested changes. The historical five-Agent and spirit-animal language below is retained as migration evidence only; Avatar does not set Agent identity, tone, or authority. Current execution plan: `agent-goal-skill-orchestration-plan-2026-07.md`.

Verbatim adoption of two user specs (2026-07-08): "Bridge Foundational Agents"
and "Bridge Onboarding Proposal (Day 1)". This doc **corrects two errors** in
ADR-032 and records the full architecture as canon.

## Corrections to ADR-032

**1. Groq, not Grok.** User: *"I meant groq, not grok, sorry."* The xAI Grok
API was never the intended provider — Bridge already has a `GroqProvider`
(`platform/packages/models/src/groq-provider.ts`, Groq's OpenAI-compatible
endpoint, `llama-3.3-70b-versatile`), wired in `apps/api/src/wiring.ts` behind
`GROQ_API_KEY`, **built 2026-07-06 — before ADR-032 was even written.**
ADR-032's "not present" claim was wrong because the codebase wasn't checked
before writing it (the same mistake class as inventing the 5-agent mapping —
check first, don't assume absence).

**2. No separate "onboarding agent."** User: *"I remember stopping you mid
way in past execution to course correct on this onboarding agent being
dropped and chief of staff handling that part."* There is no parallel
onboarding bot. The **Chief of Staff itself** conducts onboarding, adopts the
user's chosen spirit animal as its identity at the reveal moment, and remains
the single interlocutor from then on. Learning Agent / Communications Agent /
Governance Agent / Capability Builder are the specialized team CoS
increasingly delegates to as the organization grows — not a separate
onboarding-time construct, and not a one-time setup crew that disappears
after day 1.

## The five foundational agents

Every workspace begins with this same five-agent set. None are agent
*classes* with permanent/temporary tiers — every agent, including these five,
is a first-class Bridge primitive. **Chief of Staff is the only one that
cannot be deleted.**

**Chief of Staff** — the user's one non-deletable, persistent partner.
Adopts the user's chosen spirit animal as its name/face/identity (no generic
name). Lives in the right-hand chat panel, omnipresent. Users can address the
other four agents directly with `@agent-name` in chat, bypassing Chief of
Staff for that turn. Responsible for: understanding goals/priorities/context,
coordinating work across agents, executing directly when appropriate,
delegating to specialists, planning/prioritizing, explaining Bridge,
recommending new capabilities/automations/org changes, staying aware of
active work, representing the user across the platform. Runs onboarding
directly (goals, profession, tools, workflows, work style, desired autonomy,
privacy expectations, success criteria, spirit animal choice), then
provisions the initial workspace and recommends an initial org shape.

**Learning Agent** — learns from conversations, behavior, corrections,
connected systems, documents; runs external research; builds org knowledge,
user models, domain knowledge, relationship graphs, suggested memories,
recommendations for other agents. **Never executes actions.** (Matches
ADR-032's mapping exactly — no change.)

**Communications Agent** — drafts, edits/rewrites, summarizes, explains,
preps meetings, produces reports/documentation/presentations, translates,
adapts tone/audience, organizes knowledge. Outputs: emails, reports, meeting
briefs, docs, presentations, knowledge articles, chat responses, exec
summaries. **New requirement (this doc): tone must match the user's chosen
spirit animal** — a Fox reads clever/playful, an Owl reads wise/calm, a Lion
reads bold/confident, a Turtle reads steady/patient, etc. This is the
emotional-connection mechanism the whole design leans on ("spirit animal
emotional connect people usually have").

**Governance Agent** — evaluates permissions, interprets policy, assesses
risk, routes approvals, maintains compliance/audit history, validates
capability boundaries, monitors org health. Outputs: risk assessments,
approval recommendations, audit records, compliance reports, governance
guidance. (Matches ADR-032 — no change.)

**Capability Builder** — creates agents, workflows, skills, tools,
integrations, automations, dashboards, UIs, templates, reusable packages;
evolves existing capabilities. Inputs: user requests, CoS requests, Learning
Agent insights, existing primitives, external ecosystems, Marketplace
packages, open-source projects. Always **after approval** — never ships live
without going through the existing governed pipeline. (Matches ADR-032 — no
change.)

## Organizational evolution

No permanent/temporary agent classes — every agent (Chief of Staff included)
is a first-class Bridge primitive; CoS is simply the one that can't be
deleted. As the org grows, Chief of Staff may recommend: creating specialized
agents, splitting an overloaded agent, merging overlapping agents, retiring
obsolete ones, replacing an agent with a better implementation, installing
external agents/packages, or expanding an existing capability — informed by
Learning Agent insight and Governance Agent guidance, always **presented to
the user by Chief of Staff**, built by Capability Builder only after
approval. Imported agents (Bridge Marketplace, open-source, third-party
frameworks) get wrapped with Bridge's own identity/permissions/lifecycle/
governance/observability/capability model so they participate exactly like
native agents — no second-class agent tier.

## Day-1 onboarding flow (condensed from the full spec)

Design principles: earn context (infer over ask), lead with value before
permissions, progressive (productive fast, unlock more over time), emotional
connection first (companion, not chatbot), no dead ends (every skipped step
has an alternative).

1. **Create account** — name, email, password.
2. **Verify you're human** — mobile number + OTP; success creates the account.
3. **Choose your Chief of Staff** — single-select spirit animal (Lion, Fox,
   Dog, Cat, Panda, Butterfly, Dolphin, Owl, Turtle, Peacock, Elephant,
   Eagle, Horse, Beaver). No naming yet.
4. **Creating workspace** — egg-in-nest animation, rocks throughout
   ("Creating your workspace…", "Preparing your Chief of Staff…", "Learning
   about your work…").
5. **Personalize your workspace** — primary path: connect Gmail ("let me
   understand your work so I can build your workspace automatically" —
   projects, people, priorities, communication style, continuous learning).
   Secondary: "Skip — I'll answer a few questions instead."
6. **Manual onboarding** (if Gmail skipped) — profession + hobbies; up to 3
   "what fills your workday" picks (profession-templated options); one
   adaptive contextual question keyed to profession; "where does most of your
   work live" (profession-customized digital/non-digital list); "where would
   you like me to begin" (multi-select outcomes).
7. **Chief of Staff arrives** — egg cracks, chosen companion emerges, looks
   at the user, smiles, greets by name, asks "What would you like to call
   me?" (suggestions optional, user names it), companion responds in kind.
8. **Workspace created** — "here's what we can unlock next."
9. **Browser Companion** — install pitch with profession-personalized
   benefits (e.g. teacher: Google Classroom, research capture, repetitive
   browser tasks; founder: company research, CRM updates, competitive intel,
   meeting briefs).
10. **Browser verification** — OTP or LinkedIn (`linkedin.com/in/me` scrape
    of name/headline/company/profile URL via the extension); name match →
    verified + profile saved; mismatch → "verification failed," fall back to
    OTP, profile still saved.
11. **First Home** — nav: Home, Calendar, Knowledge, Intelligence, Settings.
    Calendar/Knowledge/Intelligence visible but inactive.
12. **Knowledge** — "build your organizational memory," connect any 2 of
    Gmail/Notion/Drive/Slack/Teams/Asana/ClickUp/Monday/Trello/Linear/
    HubSpot/Salesforce/Pipedrive; else "insufficient information... to unlock
    magic."
13. **Calendar** — inactive until Google/Outlook/Apple Calendar connected;
    unlocks daily briefings, meeting prep, scheduling, follow-ups, conflict
    detection, time insights.
14. **Intelligence** — inactive until Screen Recording / system-events /
    terminal-access permissions granted, framed entirely in outcome terms
    (understand current work, help at the right moment, reduce interruption,
    resume where left off, automate, learn routines, cross-app coordination).

**Information acquisition, layered:** Layer 1 direct input (name/email/phone/
spirit-animal/profession-if-Gmail-skipped/the 5 manual questions) → Layer 2
connected systems (Gmail/Calendar/Docs/messaging/tasks/CRM/browser/LinkedIn —
primary understanding source) → Layer 3 continuous learning from behavior, no
further onboarding questions required.

**Progressive capability model:** Home (personalized workspace) → Knowledge
("what I know," built from email/docs/conversations/tasks/business systems)
→ Intelligence ("what I can perceive and act on," browser+system+real-time
context) → Calendar ("how I coordinate your time"). Each starts limited,
expands as access is granted — onboarding is ongoing, not one-time. Ask for
more access at contextually relevant moments, framed as value delivered.

## Open architecture questions (not yet designed — flagged, not answered here)

**Data storage + prompt construction.** The onboarding-collected profile
(profession, hobbies, work-fills, tools, goals, autonomy/privacy prefs,
Gmail-derived signals, LinkedIn profile) needs a concrete schema and a place
to live. The kernel's Memory/Knowledge storage seam (ADR-032's minimal egg)
is the right primitive family for this, but no onboarding-profile schema
exists yet, and no code path turns that stored profile into Chief of Staff's
system prompt / persona construction. This is a build item, not solved by
this doc.

**Tone-to-animal mapping.** `SPIRIT_ANIMALS` today
(`platform/apps/web/src/app/avatar/avatar-store.ts`) has 6 animals
(owl/fox/turtle/crane/wolf/cat) — a visual/naming set only, no tone/persona
mapping. The spec's 14-animal list and the "match emotional tone to spirit
animal" requirement are both new asks against current code; reconcile the
animal list and design the tone parameter as part of the same build item.

**Sub-agents.** User: "use sub-agents where necessary." Read as: Learning /
Communications / Governance / Capability Builder must become actually
distinct, independently invocable agents (each addressable via `@name`), not
prompt fragments folded into one Chief-of-Staff call — the current
`chief-of-staff.ts` star router is a single node with no peers at all.

## Implementation status (checked against code, 2026-07-08 — not assumed)

| Piece | Status |
|---|---|
| `GroqProvider` behind `ModelProvider`, wired in `wiring.ts` | ✅ built (2026-07-06, predates ADR-032) |
| Star-topology single Chief-of-Staff router | ✅ built (`chief-of-staff.ts`) |
| Spirit-animal concept + egg-hatch animation | ✅ built (`avatar-store.ts`, `OnboardingDialog.tsx`) — 6 animals, not the spec's 14 |
| Adaptive onboarding question flow | ✅ built (`onboarding/questions.ts`, questions→preview→submitted) |
| Account creation / phone OTP / password | ❌ not present |
| Gmail-vs-manual personalization branch as a distinct step | ❌ not present in current flow shape |
| LinkedIn verification / Browser Companion extension | ❌ not present |
| Learning / Communications / Governance / Capability Builder as separate invocable agents | ❌ not present — single CoS only |
| Progressive Knowledge/Intelligence/Calendar nav-gating (inactive-until-connected) | ❌ not present |
| Onboarding-profile schema + tone-mapped prompt construction | ❌ not designed |

## Sequencing

This doc supersedes ADR-032's Day-1 bullet with the corrected, fuller spec.
**No code changes in this pass** — given this session's already-flagged cost
(~$83+) and file-count (85+) warnings, and because the account/OTP/LinkedIn/
browser-extension/four-new-agents slice is a genuinely large, multi-surface
feature, actual build is deferred pending the user's explicit go-ahead on
scope/order — not started automatically.
