---
applyTo: "platform/tools/dealpilot/**,platform/apps/web/src/app/pages/DealPilot*.tsx,platform/apps/web/src/app/data/dealpilot.ts,platform/apps/api/**/*dealpilot*,platform/packages/db/**/*dealpilot*"
---

# DealPilot Module

- Read `CLAUDE.md`, `docs/wiki/dealpilot.md`, and TASK-006 in `docs/TASKS.md`; use the linked BRD/delivery plan only when the wiki is insufficient.
- Keep one installable DealPilot Module with exactly three default sibling DB-backed Pages: Deals, Sources, and Theses. Add depth to Record Detail Sections, not global nav or ad-hoc Pages.
- Extend `platform/tools/dealpilot`; do not fork it. Compose shared sourcing, dedupe, facts, recorder, tables, and Google Integration packages instead of reimplementing them.
- Discovery enters through a manifest Automation owned by a stored Egress Agent. Skills resolve from workspace Goals/Tasks; never trust a browser-selected Agent identity.
- Preserve source rights, spend, cursor, dedupe, and provenance checks. Credentials remain broker/keychain references; never return secrets through Agent, API, export, or crawler paths.
- Deal/Source/Thesis Relations are many-to-many and evidence-bearing. Approved Source↔Thesis changes must converge for existing and future linked Deals.
- Require real data or an honest empty state, standard Module/View grammar, and governed Human decisions for investment, rights, spend, and external Actions.

## Current implementation patterns

- Keep `deal.ts` as the single deterministic Deal-stage graph. `portfolio` and `passed` are terminal; invalid skips return the `TransitionResult` error union rather than mutating state or throwing from domain logic.
- Keep connector I/O behind shared `SourceConnector` and Google gateway ports. Parsers return `null` for unrelated/unusable input, omit absent fields, bound pagination, reject repeated page tokens, and advance cursors only after the caller acknowledges a staged fetch.
- Run discovery through `runWaterfall()`, append every captured field to `FactStore` with provenance/confidence, build the living profile, reuse `matchCompany()`, then score Thesis fit. Do not write a second sourcing, dedupe, or fact pipeline.
- Keep Thesis-fit scoring deterministic and explainable (`score`, `band`, `reasons`) before any model narration. Thesis-fit bands are domain evaluation, not platform Red Flag feedback.
- Build Summary/Profile/Documents/Activity as read-side projections over `FactStore`; preserve `isEmpty`, optional-field omission, immutable provenance-derived activity, and computed values only when source facts exist.
- Store Source credentials as vault references. Normal projection exposes masked availability only; raw reveal/copy is Human-only, requires recent cryptographically verified reauthentication scoped to actor+Source, emits an audit event, and returns a short-lived value.
- Scope every Deal/Source/Thesis lookup and caller-supplied ID by workspace. Relation writes carry kind, confidence, provenance, and evidence references.
- Reuse `@bridge/tables` specs for list/board/form rendering. Extend canonical columns/views instead of building a DealPilot-only table or Kanban implementation.

## Validation

- Keep package tests on the repository `node:test`/strict-assert pattern and the package's 70% line floor. Cover stage edges/terminals, empty projections, scoring boundaries, connector cursor acknowledgement, workspace isolation, evidence-bearing Relations, credential non-disclosure/reauth/audit, and composed pipeline behavior.
- Exercise affected API store/proposal procedures and web Pages in addition to `@bridge/dealpilot`; package-only green is insufficient.
