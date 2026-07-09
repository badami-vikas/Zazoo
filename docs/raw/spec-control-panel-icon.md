---
title: Spec — Control Panel Icon
type: raw
doc_kind: design
status: draft
companions: []
related_wiki: ../wiki/undefined-elements.md
updated: 2026-07-09
tags: [ui, control-panel, workspace, views, toolbars]
---

# Control Panel Icon — Feature Spec

## Summary

Every broad table view surfaces a control-panel icon in the toolbar. The icon gives the user a fast way to see and navigate what is associated with the current view — installed modules, running workflows, linked resources, assigned people, and active agents/skills.

## Placement

- Appears in the toolbar row of every broad table view (table, kanban, calendar, card, map, graph morphs).
- Position: between the filter icon and the 3-dots overflow menu.
- Icon: a grid/panel icon (exact asset TBD by design-system pass). Single icon, no label.

## Behaviour

Click opens a **popover** (not a modal, not a full-page route) anchored below the icon.

### Popover structure

The popover lists items grouped into sections. All sections are present; empty sections show an honest "None" placeholder — never hidden.

| Section | Content |
|---|---|
| Tools / Modules | Installed capability packages active in this view |
| Workflows | Automations (Rituals) associated with this view's entity type |
| Resources | Pinned resources linked to the view |
| People | Assigned people / collaborators on this view |
| Agents | Active agents with responsibility in this view's scope |
| Skills | Skills surfaced in this view's context |

Each row in the popover is a link that navigates to the item's detail page (governed by existing routing, no new routes needed).

## Scope

- The popover is read-only in v1. No creation or editing inside the popover — that is the control panel page's job (`/initiative/:id/control-panel`).
- Scoping: items are fetched at the view scope, not the organisation scope. Where the view is tied to an Initiative, items are Initiative-scoped. Where no initiative scoping exists yet (e.g. a top-level Workspace view), items fall back to organisation-wide — the same honest fallback `ControlPanelPage` currently uses (see BUGS.md: "No per-Initiative resource scoping in the API").

## States

- **Loading**: spinner inside popover.
- **Empty section**: "None" label.
- **Error**: inline error message, retry link.

## Implementation notes

- Reuses the same `packages.list` / `integration.list` / `google.list` calls already made by `ControlPanelPage.tsx`.
- Does NOT add new API surface in v1; queries are view-level filtered from existing endpoints.
- Design token for icon: pending design-system pass; use `PanelLeftOpen` (lucide) as placeholder.
