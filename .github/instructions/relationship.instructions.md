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

## Current implementation patterns

- Preserve the proposal → decision → effect → materialization chain. Materialize only an approved/edited decision that authoritatively references its proposal; compare normalized payloads deterministically and never infer approval from caller JSON.
- Track each decision side effect in `relation_materialization_effects`. Acquire one expiring lease before applying, separate failed-attempt budget from interrupted-lease recovery, make application idempotent, and let owner-authorized retry/reconciliation recover durable failures.
- Discover approved work oldest-first by ledger `append_sequence`, then creation time and ID. Keep reads bounded with stable cursors and test multi-page completeness without duplicates or skips.
- Set workspace and owner context inside the DB transaction before touching Relation effects or edges. RLS is part of correctness, not an optional API filter; private edges are owner-scoped and broader visibility remains explicit.
- Keep semantic edges unique by workspace, endpoints, relation type, and owner. Confidence stays in `[0,1]`; evidence references remain attached; decision ledger ID, sequence, and timestamp are all present or all absent.
- A newer authoritative participant/source decision converges the canonical semantic edge set; it does not append an unbounded competing truth. Preserve the source Event and proposal/decision provenance used to explain the Signal.
- Permission-prune Signal participants and source Events before returning them. Disable the governed Action when required evidence/participants are unavailable or a proposal is already pending.
- Keep materialization and graph stores behind their current ports. Do not move retry, RLS, or provenance rules into React state.

## Validation

- Extend API tests for actor ownership, proposal/decision binding, payload mismatch, idempotent replay, retry, and reconciliation.
- Extend DB tests for concurrent lease claims, expiry/recovery budgets, append ordering, cursor completeness, semantic uniqueness/provenance constraints, and real RLS role isolation across workspaces and owners.
- Extend web tests for Signals/People/Communities navigation, permission-pruned evidence, safe-Action gating, honest empty states, and desktop plus 375px behavior.
