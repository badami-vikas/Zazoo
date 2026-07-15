# Actionable Modules, BRDs, Relationship Signals, and Second Brain

## Current-state answer

No display aliases are allowed by policy. Current prototype is not compliant: it still contains a deprecated generic-capability category, inert Module rows, a separate Skills toggle, asymmetric shell controls, and a global data-index surface. These are filed implementation defects, not accepted names.

## Decisions enforced

- Every installed Module appears in left navigation and opens manifest-driven Module Detail.
- Module Detail exposes Pages/Databases, Agents with nested Skills, Automations, Integrations, Files, Runs, settings, and real permitted Actions.
- Only an attributable allowed Agent invokes a Skill. Humans and Automations request an Agent; Automations start Agent Runs.
- Left Sidebar and right Chat Panel share expand/collapse/extend icons, state, width persistence, resize, keyboard, ARIA, and responsive behavior.
- Relationship primary toggles are Signals, People, Communities. Signal is a surfaced Event associated with ≥1 Person/Community, reason, and safe Action.
- Retained information stays associated with originating Module and contributes to Memory. No global data-index surface.
- Second Brain sits below Modules and renders a real permission-filtered cross-Module graph. Nodes/edges open source detail or governed Actions. Engine naming stays unchanged.
- UI actionability contract rejects dead cards, rows, counts, statuses, recommendations, nodes, and controls.

## Durable deliverables

- DealPilot BRD: `docs/raw/brd-dealpilot-2026-07.md`
- JobPilot BRD: `docs/raw/brd-jobpilot-2026-07.md`
- UI implementation contract: `docs/raw/ui-architecture-rules-2026-07.md`
- Relationship delivery plan: `docs/raw/relationship-module-plan-2026-07.md`
- Code migration: `docs/raw/vocabulary-code-migration-plan-2026-07-14.md` VOCAB0–VOCAB6
- Next-session interrupt: `docs/PROGRESS.md` items 1A–1I
- Bugs: `docs/BUGS.md` newest five OPEN entries
