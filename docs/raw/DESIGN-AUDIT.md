---
title: Design Prototype Audit (v0)
type: raw
doc_kind: audit
status: active
companions: []
related_wiki: wiki/design.md
updated: 2026-06-22
tags: [design, audit, ui]
---
# Bridge AI — Design Prototype Audit (v0)

> Subject: `/Design Bridge AI Interface (Copy)/` — a **coded** React + Vite + Tailwind + shadcn prototype (70 `.tsx`, 12 pages), not static mockups. Ships its own `DESIGN_CRITIQUE.md` (design-quality) + `AGENTS.md` + `guidelines/`. This audit = **architecture / vocabulary alignment** (complements, doesn't replace, the design-quality critique).
> Method: structural + vocabulary + checklist grep. A full per-screen read is still pending.

## Verdict
**~75–80% aligned.** Structure, nav, and relationship-mirror vibe are on-model. **4 real gaps; 2 are strategic** (governance + consent — the moat). The prototype looks built *early* — before governance/consent/two-tier/multi-tenant crystallized. Fix is **additive + a vocab scrub, not a redesign.**

## Aligned ✓
- **Nav**: Home / Network / Work / Intelligence / Help / Settings — matches canonical Network/Work/Intelligence/Settings (+ Home dashboard, + Help = HelpDesk).
- **Orbit/Circle/Ring view**: heavily built (~150 `ring`, ~10 `circle` refs). The solar-system relationship view exists.
- **Network Action cards**: Reconnect · Memory Search · Community Pulse · Milestones · Career Moves · Open Threads — action-first, on-model.
- **Core vocabulary** present & dominant: Network (25) · Initiative (24) · Signal (27) · Community (15) · Touchpoint (11) · Memory (6) · warmth (9) · Dormant (9) · Enrichment (10).
- **Stack** matches [STACK.md](STACK.md): React + Vite + Tailwind + shadcn.

## Misaligned ⚠️ (fix list)
1. **CRM vocabulary leakage** — `Lead` 21 · `Contact` 17 · `Deal` 13 · `Pipeline` 4 (≈55 hits). Violates the #1 brand rule (never Lead/Deal/Pipeline/Contact). **Scrub + rename**: Lead→Person/Relationship · Deal→Initiative · Contact→Person · drop Pipeline.
2. **Workflow/Playbook >> Ritual** — `Workflow` 53 + `Playbook` 27 vs `Ritual` 13. Bridge is explicitly *"not a workflow builder"*; the canonical execution primitive is **Ritual**. Rename user-facing Workflow→Ritual; resolve Playbook (recommend: a Ritual/Initiative **template**).
3. **Governance barely surfaced** — Review/approval/veto/ledger/audit/policy ≈ 1–2 refs each. The **User Review (approve/veto/edit + diff)** surface, the **Execution Ledger / Decision Trace** view, and policy controls are nearly absent. Governance is the differentiator — it must be a *visible* product surface.
4. **Consent + two-tier absent** — `consent` 0 · `canonical` 0 · `visibility` 2. The **both-party-consent intro** model (the moat/whitespace) and the **canonical-vs-relationship two-tier** with per-relationship visibility (private/team/workspace) are not represented. Highest-strategic gap.

## Recommended fixes (priority)
- **P1 vocab scrub** — strip Lead/Deal/Pipeline/Contact; user-facing Workflow→Ritual.
- **P1 governance surface** — a visible **Approvals/Review inbox** (approve/veto/edit + diff) + an **Execution Ledger / Decision-Trace** view.
- **P1 consent + visibility** — per-relationship **visibility** control (private/team/workspace) + **both-party-consent** intro flow + a **canonical-facts vs your-private-notes** distinction on the Person view.
- **P2** — confirm Orbit shows inner rings (<100 hot) with the 30k searchable as background; no naked scores.

## Pending
Full per-screen read of the 12 pages + `DESIGN_CRITIQUE.md` + `guidelines/Guidelines.md` not yet done — this is the structural/vocab pass. Deeper audit available on request.
