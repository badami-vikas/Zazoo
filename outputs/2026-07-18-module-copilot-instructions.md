# Module Copilot instructions

Added and then elaborated path-scoped GitHub Copilot instruction adapters for the developed Modules so future sessions receive established local constraints and concrete current-code patterns while editing relevant files.

## Coverage

- Shared Module contract: `.github/instructions/module-development.instructions.md`
- DealPilot: `.github/instructions/dealpilot.instructions.md`
- JobPilot: `.github/instructions/jobpilot.instructions.md`
- Relationship: `.github/instructions/relationship.instructions.md`
- Task Manager: `.github/instructions/task-manager.instructions.md`
- Relationship Helpdesk: `.github/instructions/helpdesk.instructions.md`

The adapters keep `CLAUDE.md` canonical, point to the matching wiki and canonical task, capture load-bearing design/trust/reuse rules, and avoid copying full plans. Calendar is deliberately excluded as a Module because TASK-014/ADR-108 define Calendar as a View kind and Google Calendar as an Integration.

## Current-code patterns captured

- Shared Module contract: parser-enforced capability bindings, exact versions/dependencies, dependency-closure risk, lethal-trifecta escalation, built-in registration, single-live-version promotion, rollback-as-new-draft, and manifest-driven honest UI.
- DealPilot: deterministic stage graph and Thesis-fit gate, shared sourcing/dedupe/fact composition, acknowledgement-based connector cursors, FactStore projections, workspace/evidence-bearing Relations, and Human-only audited credential access.
- JobPilot: injected pure domain seams, evidence-reconciled and Human-approved Candidate Profiles, one application transition map with immutable events, fabrication and sensitive-question hard stops, apply-waterfall policy, and pacing.
- Relationship: authoritative proposal/decision binding, durable leased materialization effects, append-sequence discovery, bounded cursor reads, transactional workspace/owner RLS context, and bundled Relation provenance.
- Task Manager: current markdown parser grammar, explicit-order compatibility, one-way generated projection, local presentation-only edits, deterministic schedule reconciliation, and clear separation from unimplemented TASK-021 database/tree/routing work.
- Helpdesk: deterministic capability routing and honest empty results, pure offer proposal inputs, public-token versus authenticated trust paths, token hashing/migration, idempotent operation IDs, permission-pruned candidates, and server-attributed proposal staging.

## Verification

- Six instruction files passed `applyTo` frontmatter and canonical-pointer checks; shared coverage now includes installable `bridge.package.yaml` manifests and `ModuleDetailPage.tsx`.
- Task parser tests passed 3/3.
- Task Manager projection regenerated and matched all 24 canonical task IDs, ranks, source files, and source lines.
- `git diff --check` passed.
- The initial adapter delivery's `@bridge/web` result remains 49/49. Follow-up direct web-data tests could not start in this fresh clone because dependencies, including React, are not installed; no runtime code changed.

Tracked by TASK-024, AP-040, AP-041, and ADR-113.
