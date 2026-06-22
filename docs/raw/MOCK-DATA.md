---
title: Mock-data registry
type: raw
doc_kind: reference
status: active
companions: []
related_wiki: null
updated: 2026-06-22
tags: [mock-data, prototype, registry]
---

# Mock-data registry

Tracks every surface still using **mock / placeholder data** in the coded prototype, so it can be
replaced with real (CSV / Supabase / runtime) data later. Convention:

- **Strings** → prefixed `dummy_` (e.g. `dummy_Agent One`).
- **Numbers** → set to `9009` (or `9009`-embedded, e.g. `9009%`, `9009 MB`).
- **Per-field cap**: < 10 distinct mock values per field (total volume across the platform may be a few hundred — that's fine).

```yaml
conventions:
  strings: prefixed `dummy_` (e.g. dummy_Agent One)
  numbers: set to 9009 (or 9009-embedded, e.g. 9009%, 9009 MB)
  per_field_cap: < 10 distinct mock values per field (total volume across the platform may be a few hundred — that's fine)
```

Real data is NOT mock and is never labeled: `data/network.ts` (CSV-derived people/companies/threads),
Supabase `people_canonical`, real product names (LinkedIn, Gmail, Google Calendar, Slack, GitHub, X, Supabase, Bridge), brand vocabulary (Person/Relationship/Memory/Community/Initiative/Ritual/Touchpoint/Signal), and the design tokens.

```yaml
registry:
  - surface: pages/IntelligencePage.tsx
    mock_fields: agentsData, skillsData (integrations = real product names; fake numbers → 9009)
    status: ✅ labeled
  - surface: pages/ItemDetail.tsx
    mock_fields: Opinions (testimonials), Files, ToolsActionable — remaining `dummy_`. ALL fields now editable + persisted locally (`bridge.profileEdits.v1`); Initiatives/Rituals render as on-brand `MiniTable`s; Associations REAL; IntroConsentCard/Introductions section dropped
    status: ✅
  - surface: data/governance.ts
    mock_fields: pendingApprovals, ledgerHistory, delegations
    status: ✅ now FALLBACK only — Approvals + Execution Ledger read the live Supabase `ledger` (A3); governance.ts is used only when Supabase is unreachable
  - surface: pages/SettingsPage.tsx
    mock_fields: teamMembers, apiKeys, sessions, workspace name/domain
    status: ✅ labeled (sweep)
  - surface: components/SignalsView.tsx
    mock_fields: —
    status: "✅ REAL (A1): derives from `data/signals.ts`; intro signal reframed (no consent gate, specific overlap); acting now INSERTs a pending row to the live `ledger` (A3b), local store = fallback"
  - surface: data/associations.ts + components/AssociationsMap.tsx
    mock_fields: —
    status: "✅ REAL: one global map from real people↔community membership, re-centered on the entity; degrees 1st/2nd/3rd+, initiatives overlay; graph + table views"
  - surface: data/tools.ts + pages/ToolDetail.tsx
    mock_fields: —
    status: "✅ REAL: single tools source (on-brand, signal-tied); `/tool/:id` detail; pin → Sidebar"
  - surface: pages/RitualsPage.tsx + components/RitualCanvas.tsx
    mock_fields: —
    status: "✅ REAL: clean `/rituals` index (signal-tied) + non-linear open canvas (steps). `RitualDetail` playbook seed (steps/triggers/analytics) still `dummy_`/`9009`"
  - surface: Communities (DataEngine via data/db.ts)
    mock_fields: —
    status: "✅ Supabase-derived (A2): communities aggregated from `people_canonical`; local fallback + source badge"
  - surface: pages/HomePage.tsx
    mock_fields: home cards/feed
    status: ✅ labeled (sweep)
  - surface: pages/WorkPage.tsx
    mock_fields: rituals/tools tabs still `dummy_`
    status: ✅ Initiatives now REAL — user-created via `data/initiatives.ts` (localStorage, starts empty); create modal + table/card views + delete
  - surface: pages/ToolsPage.tsx
    mock_fields: —
    status: "✅ REAL — reads `data/tools.ts` (single source); rows/cards open `/tool/:id`; pin → Sidebar nav"
  - surface: ~~components/RitualsEngine.tsx~~
    mock_fields: —
    status: "❌ RETIRED (file deleted) — `/rituals` → `pages/RitualsPage.tsx` (real index); Agents/Skills/Integrations live under `/intelligence`"
  - surface: pages/AgentDetail.tsx
    mock_fields: agent detail metrics/logs
    status: ✅ labeled (sweep)
  - surface: pages/SkillDetail.tsx
    mock_fields: skill detail
    status: ✅ labeled (sweep)
  - surface: pages/IntegrationDetail.tsx
    mock_fields: integration detail
    status: ✅ labeled (sweep)
  - surface: pages/InitiativeDetail.tsx
    mock_fields: —
    status: "✅ REAL: loads initiative by id; editable overview + cascaded-task touchpoints (any depth) + Knowledge-Base file upload; persisted per-id in localStorage"
  - surface: pages/RitualDetail.tsx
    mock_fields: ritual detail
    status: ✅ labeled (sweep)
```

To find all remaining mock data at any time: `grep -rn "dummy_\|9009" "Design Bridge AI Interface (Copy)/src"`.

Replacement priority (when real backends land): governance (F2/F3 → live `ledger`/`decision_traces`),
SignalsView (→ `signals`), then the operational detail pages (Initiative/Ritual/Agent/Skill → their tables).
