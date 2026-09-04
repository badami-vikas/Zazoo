# Raw — Source Registry

Every file under `docs/raw/` (58 total, 2026-07-09), one row each. This is the inventory nav file —
it does NOT replace [../wiki/index.md](../wiki/index.md) (that's the wiki map); this tracks raw
docs themselves: promoted-to-wiki or not, and why. Health-check trigger (`docs/wiki/index.md` §
Default behaviour) regenerates the orphan section by re-running the reference-frequency scan.

## Status legend
- **promoted** — cited by a `full:`/source line in ≥1 `docs/wiki/*.md` page (see that page for the
  exact mapping; not restated here to avoid drift between two sources of truth).
- **orphan** — never cited from any wiki page. Not automatically wiki-worthy (see promotion rule,
  index.md § Protocol) — candidate only once referenced 2+ times or re-asked-about.
- **historical** — deliberately superseded, kept for audit trail only, never promote.
- **requirement (verbatim)** — per CLAUDE.md docs protocol, `doc_kind: requirement` docs are
  user-text-verbatim and get frontmatter only, never a wiki summary — orphan status here is BY
  DESIGN, not a gap.

## Registry (2026-07-09 scan — see docs/output/ for the audit this was built from)

**Orphan (12, confirmed by 2026-07-09 reference-frequency scan)** — needs a decision, not silent
accumulation:
- `MOCK-DATA.md` — pre-pivot, likely historical; verify before deleting (no-dummy-data rule means
  this doc's *content* may now be actively wrong, not just unpromoted).
- `dealpilot-architecture-requirement.md`, `jobpilot-architecture-requirement.md`,
  `jobpilot-vision-requirement.md`, `eta-deal-sources-requirement.md`,
  `eta-dealflow-vision-requirement.md` — likely `doc_kind: requirement` (verbatim user text) →
  orphan BY DESIGN, no action needed. Verify frontmatter confirms `doc_kind: requirement` on next
  touch; if any is NOT actually a requirement doc, it's a real gap.
- `frontend-migration-scoping.md`, `onboarding-vs-dealpilot-simulation.md`,
  `risk-mechanism-auto-mode-practices.md`, `signals-approval-surface.md`,
  `spec-consolidation-2026-07.md`, `ui-parity-audit-2026-07.md` — genuine candidates for either
  promotion (if their content is still load-bearing) or archival (if superseded). Not triaged this
  session — flagged in [../wiki/QUESTIONS.md](../wiki/QUESTIONS.md) territory for next health-check.

**Historical (superseded, never promote):**
- `ROADMAP.md` — pre-pivot roadmap, explicitly marked historical in roadmap.md.

**Promoted (44 remaining files)** — cited from ≥1 wiki page. See [../wiki/index.md](../wiki/index.md)
Pages list for the exact raw→wiki mapping per topic; not duplicated here on purpose (one source of
truth for the mapping itself — this registry only tracks the promoted/orphan/historical STATUS).
Includes: ARCHITECTURE.md, AUTHZ-HARDENING.md, COMPETITIVE.md, DESIGN-AUDIT.md, DESIGN-FIX.md,
DESIGN-SYSTEM.md, OSS.md, RESILIENCE-PATTERNS.md, STACK.md, and all dated 2026-07 synthesis docs
(agent-quality-eval-model, architecture-end-to-end, authority-model, brd-bridge,
bridge-foundational-agents-onboarding, calendar-plan, capability-evolution,
capability-package-format, client-architecture-context-providers, config-vision-alignment-audit,
cross-platform-compatibility, day1-integrations-free-apis, decisions-log,
desktop-companion-agent-roadmap, execution-plan, helpdesk-plan, helpdesk-requirement,
initiatives-taskade-research, module-evolution-system, oss-commons-integration-plan,
primitive-specifications, productivity-app-research, research-agent-skill-workflow-practices,
rituals-engine-research, roadmap-6month-2026-h2, roadmap-execution-prompts-2026-h2,
roadmap-v2-universal-commons, runtime-pipeline, security-audit, testing-strategy,
token-efficient-development, tool-standardization-plan, tools-internalization,
undefined-elements-definitions, vision-pivot-living-software).

## Maintenance rule
New raw doc added → add one row here (orphan by default) in the same session, per
[../wiki/index.md](../wiki/index.md) Protocol "New/changed raw → update matching wiki + append log".
Health-check trigger re-runs the orphan scan; don't hand-maintain the promoted list's exact wiki
mapping here — that lives in index.md to avoid two sources of truth diverging.
