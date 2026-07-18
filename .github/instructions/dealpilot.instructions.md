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
