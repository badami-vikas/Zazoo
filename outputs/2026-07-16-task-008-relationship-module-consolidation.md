# TASK-008 — Relationship Module consolidation

Date: 2026-07-16

## Outcome

Relationship is one installed standard Module. Module Detail exposes manifest-backed Pages, Agent-owned Skills, an Automation, Integrations, Files/Results, and settings. Its primary deep-linked Pages are:

- `/module/relationship/signals`
- `/module/relationship/people`
- `/module/relationship/communities`

Helpdesk is nested at `/module/relationship/helpdesk` and uses the workspace-scoped tRPC API. The standalone Helpdesk package/routes, standalone Signals route, and global Knowledge route/page were removed.

The exact prototype path works:

1. Open installed Relationship from desktop left navigation or the 375px Modules control.
2. Navigate Signals, People, and Communities.
3. Open a Signal.
4. Follow its permission-filtered participant Relations to Person and Community Record Detail.
5. Open its source Event and inspect provenance.
6. Take the recommended Action through a server-owned `graph.proposeSignalAction` procedure and the Universal Action Pipeline.

The server refuses the Action unless the Signal subject is accessible and both participant evidence and a source Event are available. Relationship reads prune another user's private Person, Community, and Signal rows before response construction.

## Main files

Backend and contracts:

- `platform/apps/api/src/built-in-packages.ts`
- `platform/apps/api/src/relationship-materializer.ts`
- `platform/apps/api/src/router.ts`
- `platform/apps/api/src/wiring.ts`
- `platform/apps/api/test/graph-people-communities.test.ts`
- `platform/packages/core/src/memory/stores.ts`
- `platform/packages/core/src/ports.ts`
- `platform/packages/core/src/types.ts`
- `platform/packages/db/migrations/0013_relationship_relations.sql`
- `platform/packages/db/migrations/meta/0013_snapshot.json`
- `platform/packages/db/migrations/meta/_journal.json`
- `platform/packages/db/src/graph-store.ts`
- `platform/packages/db/src/index.ts`
- `platform/packages/db/src/ledger-store.ts`
- `platform/packages/db/src/schema.ts`
- `platform/packages/db/test/graph-store.test.ts`
- `platform/packages/db/test/ledger-store.test.ts`
- `platform/packages/db/test/schema-hardening.test.ts`

Web and shell:

- `platform/apps/web/src/app/Layout.tsx`
- `platform/apps/web/src/app/pages/ModuleDetailPage.tsx`
- `platform/apps/web/src/app/pages/RelationshipPage.tsx`
- `platform/apps/web/src/app/pages/RelationshipHelpdeskPage.tsx`
- `platform/apps/web/src/app/pages/SignalsPage.tsx`
- `platform/apps/web/src/app/routes.tsx`
- `platform/apps/web/src/app/lib/moduleRoutes.ts`
- `platform/apps/web/src/app/lib/pins.ts`
- `platform/apps/web/src/app/avatar/AvatarOverlay.tsx`
- `platform/apps/web/src/app/pages/SettingsPage.tsx`
- `platform/apps/web/src/app/data/tools.ts`
- `platform/apps/web/test/relationship-module.test.mjs`
- `platform/apps/web/test/module-detail.test.mjs`

Removed legacy surfaces:

- `platform/apps/web/src/app/pages/KnowledgeBasePage.tsx`
- `platform/apps/web/src/app/pages/HelpdeskPage.tsx`
- `platform/apps/web/src/app/pages/HelpdeskThread.tsx`

## Verification evidence

- DB full suite: 66 passed with coverage gate.
- Focused final DB suites: 7 Relation/Signal tests, 3 ledger tests, and the migration-order regression passed.
- Core agent-floor/scope suite: 10 passed; `network_graph:full` remains denied.
- API full suite passed.
- Focused final API suite: 3 passed, including governed Relation write/read, approval materialization, reconciliation, and the applied Signal Action.
- Web typecheck passed.
- Web suite: 29 passed.
- Web production build passed.
- Desktop `cargo check` passed.
- Runtime dummy-data check passed.
- Final read-only code review found no remaining high-confidence issue.

Live temporary-db exercise returned:

```yaml
module:
  name: relationship
  status: installed
  pages: [Signals, People, Communities]
participants:
  - {type: person, name: Manish Bhoopalam, relation: participant}
  - {type: community, name: Bridge builders, relation: participant}
source_event: calendar.meeting_upcoming
proposal:
  status: applied
  resource_type: signal
  plane: local
  seed: source Event id
```

Browser evidence:

- Desktop: `/Users/manishsbhoopalam/.copilot/session-state/2bb784ba-6e57-42f0-9abf-5b302de0c31d/files/relationship-desktop.png`
- 375px Signal evidence: `/Users/manishsbhoopalam/.copilot/session-state/2bb784ba-6e57-42f0-9abf-5b302de0c31d/files/relationship-375.png`

## TASK-009 Relation dependency contract

TASK-008 owns the first durable Relation writer/reader. TASK-009 should consume these contracts and must not create a second edge store or a direct full-network query.

### Migration

`platform/packages/db/migrations/0013_relationship_relations.sql`

- `edges` adds `evidence_refs`, `confidence`, `observed_at`, `valid_from`, `valid_to`, `user_confirmed`, `visibility`, `source`, `source_module`, and `owner_user_id`.
- Relation identity is owner-scoped and unique on `(workspace_id, src_type, src_id, dst_type, dst_id, edge_type, owner_user_id)`.
- DB checks enforce confidence `0..1`, evidence as an array, valid date range, permitted visibility, and non-empty source Module.
- `node_types.owning_module` maps `person`, `community`, `signal`, and `event` to `relationship`; `event` is registered as an operational node type.
- Journal timestamp is strictly after `0010`; a regression test pins monotonically increasing migration timestamps.
- Numbering coordination: TASK-004 reserves `0011` and TASK-007 reserves `0012`. This branch originally generated a local `0011`, then moved the same migration/snapshot to `0013` before handoff. Central integration must retain `0013` and reconcile its journal position/timestamp after merging the reserved migrations.
- Existing RLS from `0008_rls_as_code.sql` still applies to `edges`; store/API pruning adds owner/visibility and endpoint-access checks.

### Store contracts

`platform/packages/db/src/graph-store.ts`

- `getNodeTypeOwner(nodeType)` returns `{ nodeType, plane, owningModule }`.
- `listRelations(workspaceId, viewerUserId, { nodeType, nodeId }, { limit, offset })` is bounded to one anchor and prunes inaccessible Relations and endpoints.
- `upsertRelation(input)` is an atomic owner-scoped semantic upsert that merges evidence.
- `materializeSignalEvidence(input)` atomically writes:
  - `signal --source_event--> event`
  - `event --participant--> person|community`
- Duplicate participants are rejected before the batch write.
- `getSignalDetail(...)` exposes participant Relation `confidence`, `evidenceRefs`, and `sourceModule` only when the Relation itself is visible to the viewer.

### API contracts

`platform/apps/api/src/router.ts`

- `relationship.nodeTypeOwner({ workspaceId, nodeType })`
- `relationship.listRelations({ workspaceId, nodeType, nodeId, limit, offset })`
- `relationship.linkSignalEvidence({ workspaceId, signalId, sourceEventId, visibility, userConfirmed, participants[] })`
- `relationship.reconcileApproved({ workspaceId, proposalId })`

`linkSignalEvidence` is the only wire-level Relation write path. Generic `action.propose` deliberately does not accept `resourceType: "relation"`. Writes use the pipeline internally, derive ownership from the server-resolved actor or authority-checked `onBehalfOf` principal, and return explicit materialized/pending/failed state. Failed approved side effects are retryable through `reconcileApproved`.

`action.decide` pre-validates edited Relationship evidence before resolving the ledger, materializes approved Relations, and returns a retry procedure on side-effect failure. Resolved proposals are excluded from both in-memory and Drizzle `listPending`.

### TASK-009 consumption boundary

- Use `relationship.listRelations` for bounded expansion from an already permitted node.
- Use `relationship.nodeTypeOwner` to route nodes back to their owning Module.
- Use returned `evidenceRefs`, `confidence`, `sourceModule`, visibility, and timestamps for provenance/explanation.
- Continue endpoint-specific permission pruning before rendering nodes or edges.
- Do not call `upsertRelation` from TASK-009 UI code.
- Do not add a `network_graph:full` API. The core agent-floor DENY and forbidden capability token remain unchanged and tested.

## Boundaries and integration notes

- TASK-009's full actionable cross-Module Second Brain graph is not implemented.
- Advanced RM1–RM6 capabilities that depend on production MemoryEngine, identity review, runtime taint, synced preferences, bounded whole-network authorization, introductions, and team delegation remain dependency-gated. This change provides the permission-filtered Relationship primitives and exact TASK-008 prototype path they build on.
- The coordinator checkout was not read because this session is constrained to its isolated worktree. Reconciliation risk is concentrated in `built-in-packages.ts`, `Layout.tsx`, `ModuleDetailPage.tsx`, and `routes.tsx`, which overlap TASK-001 shell/manifest work.
- `IntelligencePage.tsx` includes a one-line missing `Link` import required for the current integrated web build.

## Proposed shared-ledger updates

Coordinator should review and apply, without allocating new AP/ADR identifiers here:

- attach this output and the live/test evidence to TASK-008;
- resolve the Knowledge/Relationship IA and People/Communities-not-wired evidence rows;
- append the implementation summary to `docs/log.md`;
- regenerate backend/frontend/data CODEMAPS after integration;
- mark TASK-008 complete only after reconciling the overlapping TASK-001 shell files in the coordinator checkout.
