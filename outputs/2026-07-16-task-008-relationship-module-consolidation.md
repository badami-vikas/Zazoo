# TASK-008 — Relationship Module consolidation

Date: 2026-07-17

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
- `platform/apps/api/src/router.ts`
- `platform/apps/api/test/graph-people-communities.test.ts`
- `platform/packages/db/src/graph-store.ts`
- `platform/packages/db/src/index.ts`
- `platform/packages/db/test/graph-store.test.ts`

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

- DB full suite: 64 passed with coverage gate.
- Focused final DB suite: 4 passed, including private Signal pruning and Event/participant resolution.
- API full suite passed.
- Focused final API suite: 3 passed, including the applied governed Signal Action.
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

## Coordinator integration hardening

TASK-008 was reconciled onto `main` and the browser/server trust boundary was tightened before completion:

- Approvals use authenticated Action Pipeline reads/decisions. Browser input cannot select an Agent.
- Outreach drafts bind the persistent server-owned Outreach Agent to the authenticated user.
- Server-derived stable proposal IDs make concurrent/retried drafts converge. Resolved retries return the real decision.
- Append-only pending projection excludes rejection and execution-audit rows. Decision-response loss reconciles through a resolution query.
- Post-decision effect failure is explicit and audited. Durable effect retry remains attached to TASK-017.
- Public Helpdesk uses bounded/rate-limited tRPC procedures, transactional ticket creation, hashed bearer credentials, internal token omission, deterministic retry IDs, and request-shape conflict detection.
- The browser persists ticket/reply operations before submission when possible. If reply-key persistence or Clipboard access fails, the key remains selectable.
- Capture adoption/dismissal verifies that persistence changed a row; failures remain visible instead of reporting success.

Affected core, DB, API, and web suites; platform build/typecheck; web production build; targeted lint; diff checks; and the final security/correctness review passed for the integrated slice. AP-030 records the user's task-by-task integration directive.

## Post-integration audit correction

After the hardened slice reached `main`, audit commit `db2b19c` proved that the branch-only RM4 Relation persistence/materialization contract had not been integrated. TASK-008 is therefore reopened until that schema/store/materializer/API/test slice lands without overwriting the hardened UI, Approvals, or public Helpdesk. TASK-009 still owns the cross-Module graph; TASK-017 owns durable retry of failed approved external effects.

## RM4 Relation persistence/materialization completion

The missing RM4 contract is implemented without replacing the hardened Relationship shell, public Helpdesk, Approvals surface, or TASK-007 orchestration:

- Relations now carry bounded evidence references, confidence, observed/valid time, confirmation, visibility, source, source Module, owner, and decision provenance.
- Person, Community, Signal, and source Event node types map to the Relationship Module.
- Semantic uniqueness is workspace- and owner-scoped. Materialization is atomic, retry-idempotent, and monotonic by database append sequence. Under a transaction-scoped Signal lock, the winning decision updates retained Relations and removes omitted older participant/source Relations. Applying newer-then-older or older-then-newer therefore converges on the same state. Superseded and exact same-decision retries return canonical state before revalidating mutable inputs, so recovery still succeeds after an obsolete source Event or participant Record is removed.
- Approved decisions have a durable `relation_materialization_effects` record with pending/applied/failed state, attempts, bounded automatic retry, separately bounded stale-lease recovery, errors, retry time, lease token/expiry, and applied Relation count. A file-backed Local Plane restart preserves both the decision and its effect. Token-guarded terminal writes make canonical database state win response-loss races.
- Server startup/periodic reconciliation discovers approved proposals oldest-first, cursor-pages every owner, and retries bounded work. Authenticated owners can explicitly retry exhausted effects without another approval. Approvals continues showing resolved pending/failed applications until applied, cursor-pages the complete retry set, and does not render pending work as failure.
- Repeated `action.decide` after response loss rereads the durable decision before mutable edit validation, returns the persisted decision ID/output/diff/classification, and reconciles that decision. Invalid replacement edit payloads and stale requested decisions cannot rewrite the recorded approval.
- `DrizzleGraphStore` exposes owner-scoped `upsertRelation`, approved Signal-evidence materialization, composite `(observedAt, createdAt, id)` keyset reads, bounded visibility/endpoint/evidence pruning, and node-type ownership. Evidence authorization targets and Signal participants/source Events are deduplicated and batch-authorized while distinct evidence-source provenance is preserved; the 100 Relations × 100 references regression keeps repeated source Events to one access check per request. Unknown or inherited object-property node types fail closed.
- The authenticated `relationship` API stages only the bounded Signal-evidence proposal shape, always forces Human review, hides private Relation proposals from other workspace members, persists sanitized edits, validates the exact append-only decision boundary, materializes approved/edited decisions, exposes owner-scoped status/retry/reconcile contracts, and cursor-pages outstanding effects.
- Generic public `action.propose` does not accept `resourceType: relation`. Browser database roles have no direct `edges`, `ledger`, or ledger-sequence privileges. Execution Ledger history now uses an authenticated, workspace-scoped API with a disclosed 500-row newest-first window that preserves private Relation owner isolation.
- Migration `0015_task008_relation_contract` follows post-release migration 0014, preserves legacy `created_at` as equal millisecond-truncated `observed_at`, safely suspends forced RLS only for its transactional legacy backfill, keeps legacy ownerless rows workspace-visible, and installs Relation/effect constraints, indexes, and RLS. Existing ledger rows receive unique monotonic append sequences ordered by `(created_at, id)` before the column becomes non-null; the sequence resumes above that watermark. Outstanding effects use a partial `(workspace_id, owner_user_id, id)` pending/failed cursor index. The generated snapshot and schema declaration match; Drizzle generation reports no drift.

Primary implementation files:

- `platform/packages/db/src/schema.ts`
- `platform/packages/db/src/graph-store.ts`
- `platform/packages/db/src/ledger-store.ts`
- `platform/packages/db/src/relation-materialization-store.ts`
- `platform/packages/db/migrations/0015_task008_relation_contract.sql`
- `platform/apps/api/src/relationship-materializer.ts`
- `platform/apps/api/src/router.ts`
- `platform/apps/api/src/server.ts`
- `platform/apps/api/src/wiring.ts`
- `platform/apps/web/src/app/data/ledger.ts`
- `platform/apps/web/src/app/pages/ApprovalsPage.tsx`

Verification:

- Core: 422 tests passed.
- DB: 123 tests passed, including forced-RLS migration, monotonic legacy sequence backfill, order-independent canonical materialization, 101-effect retry pagination, owner precedence, exact Event binding, evidence pruning, leases, restart, and atomic/idempotent materialization.
- API: 164 tests passed, including authenticated owner-filtered ledger history, pending/failed/applied effect contracts, lost-response decision replay, owner retry, multi-owner reconciliation, and Local Plane restart ordering.
- Web: 43 tests passed; typecheck and production build passed.
- Desktop: `cargo check` and 28 Rust tests passed.
- Migration 0015 fresh-apply compatibility and schema no-drift checks passed.
- Changed-file lint and the runtime dummy-data check passed.
- Independent review findings covering canonical application order, legacy sequence collisions, persisted-decision UI classification, unreachable retries beyond page one, immutable stale recovery, partial-index cursor shape, inherited node keys, provenance preservation, migration precision, and latest-decision confirmation replacement were corrected with focused regressions. The final read-only review's sole finding was the confirmation-order case; the winning decision now replaces rather than ORs `userConfirmed`, and both application orders converge.
- Final whitespace and conflict-marker checks passed.

The feature base has a pre-existing TASK-007 compile blocker: `AgentQuery` requires `workspaceId` and `isActive`, while `InMemoryAgentStore` lacks those methods/maps. Cross-package TypeScript gates and the full suites pass with that isolated compatibility shim, which is not included in this TASK-008 change. Full lint is also blocked by the pre-existing missing `react-hooks/exhaustive-deps` rule in `ZazooAvatar.tsx`; TASK-008 changed-file lint is separate.

`origin/main` was fetched at `b303a4f` before delivery; this branch is two commits ahead and 11 commits behind. Per the no-merge directive, main was not merged or rebased. A synthetic merge-tree check identifies content conflicts in `platform/apps/api/src/router.ts`, `platform/apps/api/src/wiring.ts`, `platform/packages/db/src/governance-stores.ts`, and `platform/packages/db/test/local-store.test.ts`; the other overlapping files auto-merge.

### Proposed shared-ledger updates

Coordinator should:

- attach this RM4 evidence to TASK-008 and mark the missing Relation contract resolved after merge;
- record the pre-existing TASK-007 `InMemoryAgentStore` compile blocker against its existing canonical task/evidence rather than creating a duplicate work row;
- append the schema/API/materialization summary to `docs/log.md`;
- record the monotonic decision-provenance rationale in `docs/raw/decisions-log.md`;
- regenerate structural CODEMAPS after integration.
