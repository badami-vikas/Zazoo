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
