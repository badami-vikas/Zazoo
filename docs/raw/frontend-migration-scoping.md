---
title: Frontend migration scoping — prototype → platform/apps
type: raw
doc_kind: plan
status: executed
companions: []
related_wiki: docs/BUGS.md
updated: 2026-07-06
tags: [frontend, migration, platform, prototype]
---

Scoping pass for the 2026-07-05 decision (decisions-log.md) to port
`Design Bridge AI Interface (Copy)/` into a real `platform/apps` frontend routed through the
governed API, replacing direct-Supabase/localStorage reads. Phases 1-4 are now DONE
(`platform/apps/web`, 2026-07-05/06) — see docs/log.md for the session-by-session build log. The
prototype remains live in parallel; cutover (retiring the prototype in favor of `platform/apps/web`)
is a separate future decision, not part of this scoping doc.

## 1. Current tRPC surface (`platform/apps/api/src/router.ts`)

```yaml
routers:
  health: {query: ok}
  action:
    propose: {mutation, governed draft}
    decide: {mutation, approve/veto/edit}
  google:
    syncGmail: {mutation}
    syncCalendar: {mutation}
    listEvents: {query}
    proposeSend: {mutation}
  agent:
    create: {mutation}
    update: {mutation}
    list: {query, inferred}
  ritual:
    create: {mutation}
    run: {mutation}
    runById: {mutation}
    list: {query, inferred}
  dealpilot:
    source: {mutation}
    setThesis: {mutation}
    getThesis: {query, inferred}
    list: {query, paginated}
    captures: {query}
  tool:
    run: {mutation}
    list: {query, inferred}
  integration:
    list: {query, paginated}
    connect: {mutation}
    disconnect: {mutation}
    listScopes: {query}
    grantScope: {mutation}
    revokeScope: {mutation}
  workspace:
    create: {mutation}
    inviteMember: {mutation}
    listMembers: {query}
```

## 2. Prototype page inventory vs. backend coverage

```yaml
pages:
  HomePage: {backend: partial, note: "dashboard aggregation — no single tRPC procedure; needs a composed query or new endpoint"}
  WorkPage: {backend: none, note: "touchpoints/signals — no router surface exists yet (Signal/Touchpoint are core vocabulary but not yet exposed over tRPC)"}
  IntelligencePage: {backend: none, note: "same gap — signals surface not wired"}
  CalendarPage: {backend: yes, maps_to: "google.syncCalendar / google.listEvents"}
  ItemDetail: {backend: partial, note: "generic entity detail — depends what 'item' resolves to; likely needs a canonical-entity read endpoint, doesn't exist"}
  InitiativeDetail: {backend: none, note: "Initiative vocabulary entity — no router surface"}
  RitualsPage: {backend: yes, maps_to: "ritual.list (inferred, verify)"}
  RitualCreate: {backend: yes, maps_to: "ritual.create"}
  RitualDetail: {backend: yes, maps_to: "ritual.run / ritual.runById"}
  ApprovalsPage: {backend: yes, maps_to: "action.decide + a list of pending proposals (list endpoint doesn't exist yet — decide is wired, list isn't)"}
  ToolsPage: {backend: yes, maps_to: "tool.list (inferred, verify)"}
  ToolDetail: {backend: yes, maps_to: "tool.run"}
  SkillDetail: {backend: none, note: "skills are a config/registry concept inside services, not exposed as their own resource over tRPC"}
  AgentCreate: {backend: yes, maps_to: "agent.create"}
  AgentDetail: {backend: partial, maps_to: "agent.update — read-detail endpoint not confirmed"}
  DealPilotPage: {backend: yes, maps_to: "dealpilot.list / .source / .setThesis / .getThesis / .captures"}
  JobPilotPage: {backend: none, note: "BUGS.md: '@bridge/jobpilot backend exists but is not wired to the prototype at all' — this is the biggest single gap"}
  HelpdeskPage: {backend: none, note: "Supabase anon-RLS designed, not live — no tRPC router at all"}
  HelpdeskThread: {backend: none, note: "same gap"}
  PublicHelpdesk: {backend: none, note: "public/unauthenticated surface — different auth model than the rest, needs its own scoping"}
  ResourcesPage: {backend: none, note: "resources_canonical lives in Supabase directly per memory; no platform/packages/db table or router for it yet"}
  IntegrationDetail: {backend: yes, maps_to: "integration.list / .connect / .disconnect / .listScopes / .grantScope / .revokeScope"}
  GoogleIntegrationPanel: {backend: yes, maps_to: "google.* + integration.*"}
  SettingsPage: {backend: partial, maps_to: "workspace.inviteMember / .listMembers — API-key management and other settings tabs have no backend"}
```

## 3. Headline gaps this scoping surfaced

1. **Signal / Touchpoint / Initiative — Bridge's core vocabulary nouns — have zero tRPC
   surface today.** `WorkPage`, `IntelligencePage`, `InitiativeDetail` all depend on entities
   that only exist inside `packages/core`/`packages/db` schema, never exposed as a router. This
   is the largest single blocker to a real migration, independent of frontend work.
2. **No "list pending proposals" endpoint** — `action.decide` exists but nothing enumerates
   what's awaiting approval, which `ApprovalsPage` needs as its primary view.
3. **JobPilot and Helpdesk are fully unwired** — real backends/schemas may exist
   (`@bridge/jobpilot`) but have no router surface at all.
4. **Resources has no platform-side home** — lives directly in Supabase from the prototype's
   own client, bypassing the governed API entirely; migrating this page means designing its
   backend representation for the first time, not just porting a page.
5. **Public/unauthenticated surface** (`PublicHelpdesk`) needs a distinct auth story — the
   current tRPC context always resolves an identity; an anonymous path doesn't exist.

## 4. Phasing (executed 2026-07-05 → 2026-07-06)

```yaml
phase_1_no_new_backend_needed: # DONE 2026-07-05
  - CalendarPage
  - RitualsPage / RitualCreate / RitualDetail
  - ToolsPage / ToolDetail
  - AgentCreate / AgentDetail (partial)
  - DealPilotPage
  - IntegrationDetail / GoogleIntegrationPanel
  rationale: "router coverage already exists; port is UI-layer + wiring only"
  note: "RitualsPage/ToolsPage stubbed as link-outs — ritual.list/tool.list don't exist, see docs/BUGS.md"
phase_2_needs_small_backend_additions: # DONE 2026-07-05
  - ApprovalsPage: "action.listPending added; ApprovalsPage wired (approve/veto)"
  - SettingsPage: "deferred entirely — API-keys tab has no backend, not attempted"
phase_3_needs_new_core_surface: # backend DONE 2026-07-05, frontend NOT built
  - graph router (listInitiatives/getInitiative/listTouchpoints/listSignals/recordSignalAction)
  - WorkPage / IntelligencePage / InitiativeDetail / ItemDetail: "backend ready, pages not ported"
  rationale: "exposed Signal/Touchpoint/Initiative over tRPC (DrizzleGraphStore); frontend pages deferred"
phase_4_needs_new_backend_entirely: # DONE 2026-07-06
  - JobPilotPage: "jobpilot router (create/list/transition) + DrizzleJobPilotStore; wires @bridge/jobpilot's
    pure scoring/state-machine logic to real persistence for the first time"
  - HelpdeskPage / HelpdeskThread / PublicHelpdesk: "helpdesk router incl. helpdesk.public.* (anon,
    token-possession auth — see decisions-log.md 2026-07-06) + DrizzleHelpdeskStore"
  - ResourcesPage: "resources router + DrizzleResourcesStore, replacing the Supabase-direct read"
  verified: "live in-browser, all three end-to-end (create → list → read-back), zero console errors"
```

## 5. Parity test plan (sketch, not built)

For each ported page: (a) a tRPC-level test hitting the same procedure the page calls, asserting
shape matches what the component destructures; (b) a manual side-by-side screenshot diff against
the live prototype for the golden path; (c) confirm no direct Supabase/localStorage read remains
in the ported component (grep for `supabase`/`localStorage` imports as a completion gate).

## 6. Explicitly out of scope for this document

No migration code. No decision on build order across phases. No decision on whether prototype
pages are ported 1:1 or redesigned in the process — that's a product call, not an engineering
scoping one.
