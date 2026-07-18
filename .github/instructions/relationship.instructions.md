---
applyTo: "platform/apps/web/src/app/pages/Relationship*.tsx,platform/apps/web/src/app/data/relationship*,platform/apps/api/**/*relationship*,platform/packages/db/**/*relation*,platform/packages/db/migrations/*relation*"
---

# Relationship Module

- Read `CLAUDE.md`, `docs/wiki/relationships.md`, and TASK-008 in `docs/TASKS.md`; use the linked plan only when needed.
- Keep one installed Relationship Module over shared Record, Relation, and Event contracts. Primary Pages remain Signals, People, and Communities; Helpdesk remains nested.
- A Signal is a surfaced source Event tied to at least one permitted Person or Community, with reason/evidence and a safe governed Action. Do not add a global Knowledge or data-index surface.
- Keep private data owner/workspace scoped. Agent identity is server-owned; approvals are authenticated and append-only; proposal linkage uses authoritative ledger references, never caller-controlled JSON inference.
- Relations are typed, evidence-bearing, deterministic, and permission-pruned. Newer authoritative decisions replace the canonical participant/source set through durable retryable materialization.
- Build action-first surfaces: explain why now, show evidence, offer a safe Action, and support dismiss/snooze/correct/tune. Introductions require both-party consent before send.
- Reuse the standard Module/View/Record Detail/Files grammar and shared graph renderer; do not create a Relationship-only UI architecture or graph store.
