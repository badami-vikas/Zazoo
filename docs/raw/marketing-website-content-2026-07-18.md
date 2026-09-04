---
title: Marketing website content — one page, one claim
type: raw
doc_kind: plan
status: draft
companions: [marketing-website-platform-brief-2026-07-18.md, design-system.md, DESIGN-SYSTEM.md]
related_wiki: [design-system, vision, competitive, dealpilot]
updated: 2026-07-18
tags: [marketing, website, copy, content, dealpilot]
---

# Marketing website content — one page, one claim

**Revision note (2026-07-18):** superseded the earlier 7-page draft. Too many pages diluted the one thing that actually differentiates Bridge. This version is a **single long-scroll page + a request-access page**, and every section attacks the same claim from a different angle instead of introducing new ones. If a sentence doesn't serve the core claim below, it's cut.

Companion: [marketing-website-platform-brief-2026-07-18.md](marketing-website-platform-brief-2026-07-18.md) for voice rules and visual tokens (unchanged).

## The one claim

> **Bridge adapts to how you work, and never acts without showing you why.**

Two halves, both required — most competitors have exactly one:
- Rigid software (Notion, generic CRMs) has neither: fixed shape, and no AI acting for you at all.
- AI copilots that act for you (silent enrichment, auto-send) have the second half missing: they act, but you don't see why until after.
- Bridge is the only one with both: it shapes itself to your work, **and** it stops and asks before anything consequential happens.

Every section below restates this same claim from a different angle — problem, mechanism, proof, comparison, ownership — on purpose. Repetition across angles is how the claim lands, not a bug to edit out.

## Page 1 — Home (`/`) — single scroll, six sections

### 1. Hero — state the claim whole

- **Eyebrow**: DealPilot is live for early funds
- **Headline**: Software that adapts to your work — and never acts without showing you why.
- **Subhead**: Bridge builds the workspace your work actually needs, and treats every AI action as a proposal you approve, not a decision it makes for you.
- **Primary CTA**: Request access
- **Visual**: one real screen doing both things at once — a generated workspace view (Deals table / relationship graph) with a proposal card open beside it (what it wants to do, why, approve/veto). One image, both halves of the claim visible together.

### 2. The two failure modes (angle: the problem)

- **Headline**: Every tool picks one failure. Bridge refuses both.
- **Two-column, tight**:
  - **Rigid tools** bend your work to fit them. Fixed fields, fixed pipelines, no memory of how you actually operate.
  - **"AI-powered" tools** act on your behalf and tell you after. Silent enrichment, auto-send, a black box you're supposed to trust.
- **Closing line**: Bridge learns your work well enough to build around it — and never moves without asking first.

### 3. How it adapts (angle: the mechanism, half one)

- **Headline**: It builds the workspace, you don't configure one.
- **Body**: A short setup — how you source, what you track, who matters — and Bridge generates the views and automations that match. Not a template. Not a settings page. As your work shifts, it proposes changes to keep up; you decide if they ship.

### 4. Draft-then-approve (angle: the mechanism, half two — the differentiator, give it the most space)

- **Headline**: Nothing happens without your yes.
- **Body**: Every consequential action — a message, a data change, a new automation — arrives as a proposal: what it wants to do, why, and the effect. You approve, edit, or veto. Routine actions can be pre-approved by you in advance; anything that reaches outside your data always waits. Every decision, yours and the system's, is logged permanently and can't be edited after the fact.
- **Visual**: the real proposal-card + append-only ledger pattern from the product. This should look like an actual screen, not an illustration — it's the section doing the most persuasive work on the page.

### 5. DealPilot (angle: proof this is real, not a pitch deck)

- **Eyebrow**: The first thing Bridge builds
- **Headline**: DealPilot: sourcing and diligence, shaped around your relationships.
- **Body**: Deals, Sources, and Theses, connected to the network that actually gets deals done — surfacing who around you can vouch for a deal, before you have to ask. Live today, not a concept.
- **CTA**: Request access

### 6. Ownership (angle: what "showing you why" is built on) + close

- **Headline**: Your data, your decisions — the same rule, one more time.
- **Body**: Private relationship data stays local, under your control. Nothing about your network is shared, enriched, or sent outward without a specific decision you made and can see in the log.
- **Closing CTA band**:
  - **Headline**: Bring Bridge to your fund.
  - **Body**: We're working with a small number of funds during the pilot.
  - **CTA**: Request access

## Page 2 — Request access (`/request-access`)

Only other page. No pricing table, no separate trust/platform/about pages for v1 — fold anything essential from those into the home sections above if it's truly load-bearing; otherwise cut it.

- **Headline**: Request access to Bridge.
- **Subhead**: Tell us about your fund and we'll follow up.
- **Form**: Name, work email, fund name, one short-text field — "What are you hoping Bridge helps with?"
- **Submit**: Request access
- No FAQ, no pricing, no team bios on this page — keep it a form, not a second sales pitch.

## Cut from the earlier draft, on purpose

- **`/dealpilot` as a separate page** — folded into home §5. DealPilot needs one tight proof section, not a second sales page repeating the same claim with more screenshots.
- **`/how-it-works`** — folded into home §3–4 (adapt + draft-then-approve). It was the same claim restated at greater length.
- **`/trust`** — folded into home §4 and §6. A dedicated trust page usually exists to compensate for the homepage not landing the trust claim — this version makes the homepage land it directly instead.
- **`/platform`** (JobPilot/ResearchPilot teaser) — cut entirely for v1. It's a claim about the future competing for attention with the claim about now. Reintroduce only once there's a second live product to point to.
- **`/about`** — cut for v1 unless the founder specifically wants a public voice/story page; nothing here converts a fund considering DealPilot.
- **Changelog/blog** — was already marked optional; still cut.

## What did not change

- Voice, banned-vocabulary list, visual tokens, and the avoid-list from [the brief](marketing-website-platform-brief-2026-07-18.md) §4–§6 — unchanged, still apply.
- Unverified-claim rule unchanged: don't fill a gap with a plausible number, logo, or quote. This draft has almost no such gaps left because it dropped the pages (security posture, integrations list, team bios, pricing FAQ) that needed them — the two pages that remain, home and request-access, don't make claims requiring `[NEEDS: ...]` markers.
