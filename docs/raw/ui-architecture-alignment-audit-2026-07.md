---
title: UI Architecture Alignment Audit — apps/web
type: raw
doc_kind: audit
status: active
companions: [ui-architecture-rules-2026-07.md, egg-commons-feature-roadmap-2026-07.md]
related_wiki: ../wiki/ui-architecture.md
updated: 2026-07-14
tags: [ui, audit, pages, toggles, lists, sub-modules, forms, artifacts]
---

# UI Architecture Alignment Audit

Scope: `platform/apps/web`. This is the UI-RULES-1 inventory and target map. It records what the last two days built, what the current shell already covers, and what remains. It does not claim the parent task complete.

```yaml
covered:
  standard_toolbar:
    status: partial
    evidence:
      - List selector, view selector, search, filter, custom actions, 3-dots, and insights chevron exist.
      - The retired standalone Control Panel slot was removed on 2026-07-14.
  lists:
    status: partial
    evidence:
      - DealPilot, Work, and Resources have real saved-list stores.
      - Lists are row subsets rather than separate routes.
  views:
    status: partial
    evidence:
      - Table, gallery/card, kanban, calendar, map, and network renderers exist.
      - Eligibility is derived from table metadata.
  page_sections:
    status: partial
    evidence:
      - Initiative detail already stacks Goal, Brief, Boundaries, timeline, Touchpoints, and Knowledge Base.
      - CollapsibleInsights supplies a reusable related section on standard pages.
  honest_empty_states:
    status: partial
    evidence:
      - Several pages show real empty states instead of fixture rows.
      - Copy is still page-specific rather than metadata-generated.
  deep_links:
    status: partial
    evidence:
      - Top-level surfaces are routable.
      - Initiative pages and their Touchpoint views now encode page and view in query parameters.
  control_panel:
    status: partial
    evidence:
      - Initiative Control Panel is now reachable from the Initiative page 3-dots menu.
      - Its route remains direct-linkable.
  form_view:
    status: done
    evidence:
      - "form" added to ViewConfig["kind"] in @bridge/tables/src/types.ts.
      - FormView component created at apps/web/src/app/dataviews/views/FormView.tsx — renders all editable, non-locked, non-computed columns as typed inputs; calls onInsert(draft) on submit.
      - Registered as "form" in VIEW_COMPONENT_REGISTRY and REGISTERED_VIEW_KINDS (registry.ts).
      - computeEligibleKinds (eligibility.ts) always includes "form" for non-relationship specs — same always-eligible rule as table/kanban/gallery.
      - DataViewsProps extended with optional onInsert callback; forwarded to view components.
      - Process parity: onInsert is the caller's hook into action.propose — the same pipeline enrichment path every other DB write goes through.
  commons_registry:
    status: done
    evidence:
      - commonsRegistry: CommonsRegistry added to Wiring interface + buildWiring() return (HttpCommonsClient, COMMONS_URL env, loopback-HTTP allowed).
      - commons.list / commons.get / commons.getVersion / commons.installPropose / commons.publishBuiltins tRPC sub-router added to appRouter (router.ts).
      - installPropose = fetch+register (PKG-2 signature verified by HttpCommonsClient) returning installationId; caller calls packages.install for governed risk/approval flow — no logic duplication.
      - publishBuiltins = pushes BUILT_IN_PACKAGES to the running Commons registry; idempotent (skips duplicates).
      - Intelligence → Registry tab added to IntelligencePage (commons.list + publishBuiltins button).
      - 8 new focused tests in apps/api/test/commons.test.ts with in-memory CommonsRegistry mock; all 99 API tests pass.

target_map:
  knowledge:
    module: Knowledge
    toggle_pages: [People, Communities, Resources]
    lists: named row subsets inside each toggle page
    sub_modules: []
    current_gap: Knowledge Base still mixes its datasets without the canonical route-backed toggle model.
  intelligence:
    module: Intelligence
    toggle_pages: [Automations, Agents, Skills, Integrations]
    lists: named row subsets inside each capability dataset
    sub_modules: []
    current_gap: Existing Packages and Tools tabs need classification as administration or implementation detail before removal or relocation.
  dealpilot:
    module: DealPilot
    toggle_pages: [Deals, Sources, Thesis]
    lists: saved deal subsets
    sub_modules: []
    current_gap: One monolithic Deals surface; Sources and Thesis pages are absent.
  initiative:
    module: Initiative
    toggle_pages: [Overview, Touchpoints, Knowledge Base]
    lists: Touchpoint subsets when saved-list support lands
    sub_modules: []
    current_gap: Tabs are now deep-linked, but the standard toolbar, Form view, and artifact section are absent.
  helpdesk:
    module: Helpdesk
    toggle_pages: [Requests, Knowledge]
    lists: request queues with identical columns
    sub_modules: []
    current_gap: Requests and knowledge live on separate surfaces without one route-backed toggle shell.
  calendar:
    module: Calendar
    toggle_pages: [Calendar]
    lists: saved event subsets
    sub_modules: []
    current_gap: No additional data cluster currently justifies a toggle or sub-module.

remaining:
  - Route all canonical toggle pages and encode active list, view, and filters where useful.
  - ~~Add Form as a first-class registered view backed by field metadata and the existing post-insert process.~~ DONE 2026-07-15: FormView registered, onInsert hook contract implemented.
  - Introduce collapsible module children only when a loosely-related dataset actually needs a sub-module.
  - Standardize landing, related, and Artifacts sections across at least three pages.
  - Provision and index the Bridge Workspace Documents tree in the desktop shell.
  - Mirror cloud-visible personal data locally.
  - Add the artifact-count watcher and governed Chief-of-Staff grouping call.
  - Generate honest empty-state copy from page metadata.
  - Reclassify Control Panel record data into page sections; leave only administration in Control Panel.
  - ~~wire commons.* tRPC over CommonsRegistry port (CM0).~~ DONE 2026-07-15: commons sub-router + wiring + Registry Intelligence tab + 8 tests.

macos_or_infrastructure_flags:
  - Do not claim macOS Documents resolution, filesystem watching, rename tracking, entitlements, app bundle, signing, or notarization from this environment.
  - FSEvents behavior and Finder-originated move/rename conflicts require a local macOS session.
  - XP-2 signing remains certificate-secret-gated.
  - XP-3 remains blocked because no mobile app or simulator/device lane exists.
  - The three-OS desktop CI matrix still needs its first successful run.
```

## Decisions still needed

- Intelligence `Packages` and `Tools`: retain as user-facing toggle pages, move to Control Panel administration, or hide as implementation surfaces.
- Helpdesk `Knowledge`: strongly related toggle page or a reusable Knowledge sub-module shared with other modules.
- Initiative `Knowledge Base`: keep as a toggle because it is initiative-scoped, or make it a child sub-module when it needs its own lists, toolbar, and artifacts.
