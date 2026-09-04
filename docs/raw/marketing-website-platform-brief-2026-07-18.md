---
title: Marketing website platform brief
type: raw
doc_kind: plan
status: draft
companions: [design-system.md, DESIGN-SYSTEM.md, vision-pivot-living-software.md, COMPETITIVE.md]
related_wiki: [design-system, vision, competitive, dealpilot, roadmap]
updated: 2026-07-18
tags: [marketing, website, brand, design-brief, dealpilot]
---

# Marketing website platform brief

Handoff doc for an external designer building Bridge's marketing website. Written to stand alone — no glossary knowledge assumed. Pulls positioning from [vision.md](../wiki/vision.md), visual system from [design-system.md](../wiki/design-system.md), and competitive framing from [competitive.md](../wiki/competitive.md).

## 1. What Bridge is (plain English)

Bridge is **Living Software** — software that learns how a person or team actually works and builds the tools, views, and automations around that work, instead of forcing work into a fixed app. One governed core ("the Engine") adapts installed capability packages ("Modules") across web, desktop, and mobile.

The first shipped product is **DealPilot**, a relationship/deal-flow workspace for investors (VC funds first) — sourcing, diligence, and network intelligence over your own private relationship graph. JobPilot (job search) and ResearchPilot follow the same pattern later. So the site needs to communicate two layers at once: **the platform idea** (Living Software, adapts to you, governed) and **the flagship product** (DealPilot, concrete and sellable today).

Avoid describing Bridge as a CRM, a workflow builder, or a generic "AI assistant." It's closer to: *an operating layer that grows the exact tool you need, with a visible audit trail for everything it does on your behalf.*

## 2. Audience

- **Primary (buy DealPilot today)**: VC/PE investors and fund operators — sourcing, tracking deals/theses, relationship-driven diligence. Sophisticated, skeptical of AI hype, care about data control and auditability.
- **Secondary (interested in the platform story)**: builders/operators evaluating Bridge as an adaptive workspace platform beyond DealPilot — early design partners, technical evaluators.
- **Tertiary**: future JobPilot/ResearchPilot users — not a launch priority, but the site's platform framing should make it obvious more verticals are coming.

## 3. Positioning & messaging pillars

One-liner options (pick one, keep consistent site-wide):
- "Software that builds itself around your work."
- "The workspace that adapts to how you actually work — and shows its work."

Pillars, in priority order:

1. **Adapts to you, not the other way around.** Generated views/workflows/automations from real usage, not a rigid template you configure.
2. **Governed by design — the moat.** Every AI action is proposed, explained, and approved before it does anything consequential. Draft-then-approve, not silent automation. This is the single biggest differentiator from AI-copilot competitors and should appear near the top of the homepage, not buried in a "security" subpage.
3. **You own your data.** Local-first for private relationship data; nothing leaves without an explicit, logged decision. No silent enrichment, no firmwide surveillance ingest.
4. **Consent-native relationship intelligence.** Rivals build team graphs by silently scraping everyone's inbox. Bridge's graph is built from data the user explicitly owns and controls, with logged consent for anything shared.
5. **DealPilot today, a platform underneath.** DealPilot is real and usable now; the underlying Engine is what makes the next vertical (JobPilot, etc.) cheap to build — a legitimate "why trust the roadmap" argument for technical buyers.

## 4. Voice & tone

- Calm, precise, editorial — not hypey SaaS ("revolutionize," "supercharge," "10x"). Confident understatement.
- Say exactly what the software does and does not do yet. No implied capabilities.
- Governance and trust language should sound like a feature, not a disclaimer — write it with the same energy as the AI features, not smaller/grayer.
- Never use CRM vocabulary in copy: no "leads," "pipeline stages" (as a sales-funnel metaphor), "contacts" as a noun for people, "prospects." Use Deals/Theses/Sources/People/Relationships/Signals.

## 5. Visual system (hand to designer as-is)

Source of truth in code: prototype `src/styles/theme.css` (Design Bridge AI Interface). Mood: **warm paper + editorial serif + restrained steel — calm, premium, trust-first, NOT loud SaaS.**

```yaml
color_tokens:
  bg_paper: "#FAF9F5"
  surface: "#F0EEE8"
  ink_navy: "#1A2B3C"
  body_navy_mid: "#2E4057"
  primary_steel: "#4D7EA8"
  accent_steel_light: "#7FA5C5"
  warm_gray: "#B8B4A8"
  border: "#E2DED5"
  trust_sage: "#6B7C65"
  dormant_amber: "#C4955A"
typography:
  ui_data_body_font: "Geist"
  heading_font: "Source Serif 4"   # headings AND person names — brand signature
  scale_px:
    h1: 32
    h2: 24
    h3: 18
    h4_serif: 16
    body: 15
    button: 14
    input: 14
    label: 12
  weight_range: "300-600 only"
  min_size_px: 12
spacing_px: [4, 8, 16, 24, 40, 64]
radius_px:
  card: 12
  button: 8
  pill: 20
motion_ms: [200, 400, 2000]
motion_easing: "ease-out"
```

Reference the live product surface for interior-page visual language: the deployed prototype at `bridge-ai-1ay.pages.dev` (private, credentials in project memory — request access rather than treating any public link as current). It shows how the product itself looks; the marketing site should feel like the same family (same tokens, same serif-for-names signature) but with more editorial breathing room than a dense app UI needs.

## 6. What to avoid (visually and in messaging)

From competitive positioning — these break the brand if they leak into marketing copy or design:

- Generic "AI hero gradient" SaaS look (purple/cyan glow, floating 3D shapes, stock-photo people). Bridge's mood is warm-paper editorial, not sci-fi.
- Dashboard screenshots implying bulk outreach, mail-merge, a sales pipeline/Kanban, or lead-scoring — Bridge explicitly avoids that category.
- Any claim of silent/automatic enrichment or "we scan your inbox for you" — the entire pitch is *consent-first*, opposite of Affinity/Mesh/ZoomInfo-style silent ingest.
- Fabricated or placeholder metrics/logos/testimonials. If real numbers/logos aren't cleared for public use yet, use qualitative claims or leave the section out — don't mock it up as if real.
- Meeting-bot / gamification / leaderboard visual metaphors (explicitly rejected product directions).

## 7. Site map — revised 2026-07-18 (was 7 pages, cut to 2)

**Superseded by [marketing-website-content-2026-07-18.md](marketing-website-content-2026-07-18.md).** The original 7-page map spread one differentiating claim across too many pages. Current map:

```yaml
pages:
  - path: /
    purpose: "Single long-scroll page. Six sections, all restating one claim from different angles: adapts to your work + never acts without showing you why."
  - path: /request-access
    purpose: "Form only. No pricing, no FAQ, no second pitch."
```

`/dealpilot`, `/how-it-works`, `/trust`, `/platform`, `/about`, and changelog/blog are cut for v1 — see the content doc's "Cut from the earlier draft" section for why each one specifically was folded or dropped rather than kept thin.

## 8. Homepage section brief — see content doc

Full section-by-section copy now lives in [marketing-website-content-2026-07-18.md](marketing-website-content-2026-07-18.md) §"Page 1 — Home". Six sections: hero (states the claim whole) → the two failure modes (problem angle) → how it adapts (mechanism, half one) → draft-then-approve (mechanism, half two — most visual weight on the page) → DealPilot (proof) → ownership + close.

## 9. CTA / conversion strategy — needs a decision

Bridge is pre-launch / pilot-stage (per [decisions.md](../wiki/decisions.md), team pilot is the current milestone, not general availability). Recommended default: **"Request access" / "Book a demo"** rather than self-serve signup or a public pricing table, until GA is closer. Confirm with the founder before the designer builds a live pricing page — flagging this as an open question rather than assuming.

## 10. Assets to hand the designer

- This brief.
- `theme.css` tokens (§5 above) — designer should build the palette/type system as design tokens, not hardcoded hex, matching how the product itself is supposed to work.
- Read-only walkthrough or screenshots of the deployed prototype (`bridge-ai-1ay.pages.dev`) for interior-product visual reference — request current login from the project owner rather than reusing old credentials, since prototype UI evolves.
- This doc's §3 messaging pillars and §6 avoid-list as non-negotiable creative constraints, not suggestions.

## Open questions for the product owner (not the designer)

- Final one-liner (§3) — pick one before design starts, changing it mid-design is expensive.
- CTA model (§9): request-access vs. paid self-serve at launch.
- Whether `/platform` (multi-vertical story) ships in v1 or DealPilot-only v1 is cleaner and faster.
- Any real customer names/logos/quotes cleared for public use — if none yet, the homepage should not imply otherwise.
