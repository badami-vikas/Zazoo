# TASK-008 Relationship continuity checkpoint

Date: 2026-07-18

## Outcome

Candidate A contains a validated, independently mergeable Relationship continuation through RM3, the Relationship-owned RM4 remainder, and RM5 Introductions. It builds on the already committed RM1-RM2 layer and does not duplicate RM4 persistence or the TASK-014/TASK-009 Graph renderer.

Implemented:

- owner/visibility-safe Person and Community CRUD, bounded search/detail, unified participant Timeline, Google/capture review, and an inspectable identity queue;
- Person Memory create/correct/forget through the existing MemoryStore, including append-only correction provenance and full-lineage forgetting;
- private commitment lifecycle snapshots in Events, with evidence-bearing Relations and bounded current-state projection;
- deterministic source-grounded meeting preparation plus governed follow-up logging;
- visibility-pruned bounded shortest paths over RM4 Relations;
- Community composition for related People, Signals, Events, and an honest empty Files state;
- private Introduction Event snapshots linked to both People through evidence-bearing Relations;
- explicit initiator and recipient consent state, terminal decline/cancel/introduced states, and completion blocked until both consents are recorded;
- private decline-reason storage with boolean-only list/detail disclosure;
- responsive Person/Community sections and actionable governed controls.

The Introduction surface never sends a message. It records consent and lifecycle state only.

Central-review hardening additionally:

- resolves browser actors and delegation from the authenticated user, forces browser proposals onto the Local Plane, and owner-filters private plus legacy Relationship ledger rows;
- keeps private Person/Community PII out of ownerless canonical rows and stores private Event detail, including Introduction decline text, only on owner-RLS Relations;
- binds Google OAuth, intake decisions, and effects to the configured integration owner; durable bounded reservations survive restart; approved identities converge on one private Person and the Local Graph;
- stages capture metadata in the server Local Plane, deduplicates pending review durably, materializes exactly one Event after approval, and reconciles device status after replay or another client decision;
- accepts RFC3339 offsets and all-day dates, preserves explicit nullable clears, serializes Introduction and Memory successor transitions, and queries pending meeting-prep commitments directly;
- resets and generation-guards Record UI state, preserves browser wall-clock defaults, and uses independent snapshot watermarks for bounded Memory, commitment, and Introduction pagination.

## Architecture

No numbered migration was required or allocated by TASK-008. The normal `origin/main` merge preserves TASK-010's migration `0016` unchanged.

The implementation reuses:

- `DrizzleGraphStore`;
- `MemoryStore`;
- the Universal Action Pipeline and durable Relationship reconciliation;
- existing Person, Community, Event, and Interaction storage;
- RM4 Relation evidence/access pruning;
- existing Module routes and shared UI grammar.

ADR-115 records why continuity state remains in existing Memory/Event/Relation stores instead of adding mutable parallel tables. ADR-116 records why sensitive private Event detail lives on existing owner-filtered Relations.

## Validation

- Core full suite: 430 passed.
- DB full suite (serial PGlite execution): 154 passed.
- Google integration full suite: 39 passed.
- API full suite: 218 passed.
- Web full suite: 69 passed.
- Affected total: 910 passed.
- Monorepo typecheck and build passed.
- Changed-file lint, runtime no-dummy, and diff integrity passed.
- Pre-merge correctness review found one stale DealPilot assertion after browser proposals became Local-Plane-only; the corrected assertion proves a client-selected Cloud Plane is ignored. Final post-merge correctness review found no blocker across the combined snapshot/keyset, Memory RLS/CAS, ledger-owner, and API-decision seams.
- Final independent security review found no vulnerability or merge blocker. It confirmed owner/workspace pruning, private Event Relation storage, Google/capture authority, OAuth state, replay boundaries, bounded reads, and preservation of TASK-010's unchanged owner-aware Memory RLS/direct-role revocation.

Headless Chrome exercised the live in-memory API and web app with no seeded Records. The Relationship People Page rendered its honest empty state, bounded intake/identity review, Files Section, governed create/source Actions, and responsive Module navigation at both viewports:

- desktop: `/Users/manishsbhoopalam/.copilot/session-state/84c5e1f2-a40f-4250-9981-692f1f0ca96f/files/browser-evidence/relationship-people-desktop.png`
- exact 375px: `/Users/manishsbhoopalam/.copilot/session-state/84c5e1f2-a40f-4250-9981-692f1f0ca96f/files/browser-evidence/relationship-people-375.png`

No runtime dummy data was introduced to manufacture populated detail evidence. The live honest-empty screenshots predate the review-only hardening; changed UI behavior is covered by responsive structural tests plus DB/API lifecycle, snapshot-pagination, and negative-authority tests.

## Remaining TASK-008 scope

- persistent user-defined Automation trigger/cadence, bounded scheduler behavior, and inspectable attributable Agent Runs;
- team permission/delegation persistence connected to runtime authority;
- Relationship export, source disconnect, and complete forget orchestration;
- held-out matching/path/reminder/introduction eval execution through the shared evaluation harness;
- TASK-014/TASK-009's cross-Module Graph renderer, which remains explicitly out of this branch.

TASK-008 remains `in_progress`.

## Main files

- [`platform/packages/db/src/graph-store.ts`](../platform/packages/db/src/graph-store.ts)
- [`platform/apps/api/src/relationship-record-materializer.ts`](../platform/apps/api/src/relationship-record-materializer.ts)
- [`platform/apps/api/src/relationship-materializer.ts`](../platform/apps/api/src/relationship-materializer.ts)
- [`platform/apps/api/src/router.ts`](../platform/apps/api/src/router.ts)
- [`platform/apps/web/src/app/pages/RelationshipPage.tsx`](../platform/apps/web/src/app/pages/RelationshipPage.tsx)
- [`platform/packages/db/test/graph-store.test.ts`](../platform/packages/db/test/graph-store.test.ts)
- [`platform/apps/api/test/graph-people-communities.test.ts`](../platform/apps/api/test/graph-people-communities.test.ts)
- [`platform/apps/web/test/relationship-module.test.mjs`](../platform/apps/web/test/relationship-module.test.mjs)
