# Mock-data registry

Tracks every surface still using **mock / placeholder data** in the coded prototype, so it can be
replaced with real (CSV / Supabase / runtime) data later. Convention:

- **Strings** → prefixed `dummy_` (e.g. `dummy_Agent One`).
- **Numbers** → set to `9009` (or `9009`-embedded, e.g. `9009%`, `9009 MB`).
- **Per-field cap**: < 10 distinct mock values per field (total volume across the platform may be a few hundred — that's fine).

Real data is NOT mock and is never labeled: `data/network.ts` (CSV-derived people/companies/threads),
Supabase `people_canonical`, real product names (LinkedIn, Gmail, Google Calendar, Slack, GitHub, X, Supabase, Bridge), brand vocabulary (Person/Relationship/Memory/Community/Initiative/Ritual/Touchpoint/Signal), and the design tokens.

| Surface (file) | Mock fields | Status |
|---|---|---|
| `pages/IntelligencePage.tsx` | agentsData, skillsData (integrations = real product names; fake numbers → 9009) | ✅ labeled |
| `pages/ItemDetail.tsx` | Opinions (testimonials), Files, ToolsActionable — remaining `dummy_`. ALL fields now editable + persisted locally (`bridge.profileEdits.v1`); Initiatives/Rituals render as on-brand `MiniTable`s; Associations REAL; IntroConsentCard/Introductions section dropped | ✅ |
| `data/governance.ts` | pendingApprovals, ledgerHistory, delegations | ✅ now FALLBACK only — Approvals + Execution Ledger read the live Supabase `ledger` (A3); governance.ts is used only when Supabase is unreachable |
| `pages/SettingsPage.tsx` | teamMembers, apiKeys, sessions, workspace name/domain | ✅ labeled (sweep) |
| `components/SignalsView.tsx` | — | ✅ REAL (A1): derives from `data/signals.ts`; intro signal reframed (no consent gate, specific overlap); acting now INSERTs a pending row to the live `ledger` (A3b), local store = fallback |
| `data/associations.ts` + `components/AssociationsMap.tsx` | — | ✅ REAL: one global map from real people↔community membership, re-centered on the entity; degrees 1st/2nd/3rd+, initiatives overlay; graph + table views |
| `data/tools.ts` + `pages/ToolDetail.tsx` | — | ✅ REAL: single tools source (on-brand, signal-tied); `/tool/:id` detail; pin → Sidebar |
| `pages/RitualsPage.tsx` + `components/RitualCanvas.tsx` | — | ✅ REAL: clean `/rituals` index (signal-tied) + non-linear open canvas (steps). `RitualDetail` playbook seed (steps/triggers/analytics) still `dummy_`/`9009` |
| Communities (`DataEngine` via `data/db.ts`) | — | ✅ Supabase-derived (A2): communities aggregated from `people_canonical`; local fallback + source badge |
| `pages/HomePage.tsx` | home cards/feed | ✅ labeled (sweep) |
| `pages/WorkPage.tsx` | rituals/tools tabs still `dummy_` | ✅ Initiatives now REAL — user-created via `data/initiatives.ts` (localStorage, starts empty); create modal + table/card views + delete |
| `pages/ToolsPage.tsx` | — | ✅ REAL — reads `data/tools.ts` (single source); rows/cards open `/tool/:id`; pin → Sidebar nav |
| ~~`components/RitualsEngine.tsx`~~ | — | ❌ RETIRED (file deleted) — `/rituals` → `pages/RitualsPage.tsx` (real index); Agents/Skills/Integrations live under `/intelligence` |
| `pages/AgentDetail.tsx` | agent detail metrics/logs | ✅ labeled (sweep) |
| `pages/SkillDetail.tsx` | skill detail | ✅ labeled (sweep) |
| `pages/IntegrationDetail.tsx` | integration detail | ✅ labeled (sweep) |
| `pages/InitiativeDetail.tsx` | — | ✅ REAL: loads initiative by id; editable overview + cascaded-task touchpoints (any depth) + Knowledge-Base file upload; persisted per-id in localStorage |
| `pages/RitualDetail.tsx` | ritual detail | ✅ labeled (sweep) |

To find all remaining mock data at any time: `grep -rn "dummy_\|9009" "Design Bridge AI Interface (Copy)/src"`.

Replacement priority (when real backends land): governance (F2/F3 → live `ledger`/`decision_traces`),
SignalsView (→ `signals`), then the operational detail pages (Initiative/Ritual/Agent/Skill → their tables).
