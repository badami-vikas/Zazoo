# Merge and integration history

This file prevents a new session from re-merging historical branches or reusing allocated migration/decision numbers.

## Current central baseline

- Latest `main` baseline merged for this handoff:
  `5091dae3dee47a0fce57548136e0b83a3fbddca4`.
- TASK-006 code landed at `7f44186` under AP-045 after validating and normally merging base
  `bab32ea`.
- Working tree was clean when this package was created.

## Landed roadmap history

| Commit | Result |
|---|---|
| `1e0d652` | Historical broad integration containing early prototype and Relationship work; later audited and hardened. |
| `facb52f` | Relationship trust-boundary hardening. |
| `5dd0aa9` | Reopened TASK-008 after branch audit proved RM4 was missing. |
| `a0668eb` | TASK-004 Commons trust/install and bounded TASK-005 run glue. |
| `ddb71be` | TASK-007 Agent/Skill/child-Run orchestration and migration `0014`. |
| `60a68ca` | TASK-006 DealPilot core integration. |
| `f20f611` | Merged newer roadmap documentation after TASK-006. |
| `212e65f` | Fail-closed `InMemoryAgentStore` workspace/status follow-up. |
| `4dfc036` | ADR-110-aligned TASK-009 Graph/Second Brain handoff. |
| `590cca6` | TASK-008 RM4 Relation contract merge from source head `ff98c20`. |
| `71f19d5` | RM4 evidence/codemaps and Task Manager parser/projection repair. |
| `631aa9f` | Latest combined roadmap/provider documentation baseline. |
| `d75d26f` | TASK-003 human physical-input certification merge (unrelated to red-flag work). |
| `e532b15` | TASK-010 round-7 post-RM4 migration `0016_new_ink`: JobPilot flag backfill+constraint, owner-aware `memories` RLS, DB-backed `lineage_revision` wired end-to-end; merged fast-forward from `manishsbhoopalam8498-platform-red-flag-feedback` after two intermediate `origin/main` merges (RM4, then the TASK-003 recovery/cert chain) reconciled surgically. |
| `cbda8d6` | TASK-008 owner-safe Person/Community Records, unified Timeline/intake, and Relationship RM1–RM2 continuation. |
| `f409777` | TASK-008 context paths, Community composition, Memory/commitment/meeting flows, and double-consent Introduction snapshots through RM5. |
| `71368fe` | TASK-008 central authority, privacy, durability, replay, datetime, transition-serialization, and pagination hardening. |
| `905aee9` | Recorded AP-043 and the validated TASK-008 continuation integration; TASK-008 remains `in_progress` for Automations/RM6/evaluation. |
| `7f44186` | TASK-006 durable Local Plane, OS vault, OAuth, and desktop lifecycle integration under AP-045; final reviewed source was `adf6c95`. |
| `5091dae` | Recorded the landed TASK-006 integration and refreshed its canonical resume evidence. |

## Historical source branches

- TASK-004 source: `manishsbhoopalam8498-finish-task-001` at `644d163`; merged, do not merge again.
- TASK-006 core source: `manishsbhoopalam8498-implement-dealpilot-core` at `7ccf076`; merged, do not merge again.
- TASK-007 source: `manishsbhoopalam8498-task-007-agent-orchestration` at `c70a777`; merged, do not merge again.
- TASK-008 initial source/audit: `manishsbhoopalam8498-relationship-module-consolidation` at `db2b19c`; not safe to merge wholesale.
- TASK-008 RM4 source: `manishsbhoopalam8498-implement-rm4-relations` at `ff98c20`; merged, do not merge again.
- TASK-008 Relationship continuation source: `manishsbhoopalam8498-complete-relationship-records` at
  `905aee9`; merged, do not merge again.
- TASK-008 competing candidate B: `manishsbhoopalam8498-implement-relationship-rm1-rm2`; superseded
  historical dirty worktree, not safe to merge wholesale.
- TASK-009 planning source: `manishsbhoopalam8498-plan-second-brain-graph` at `3b51aaf`; handoff merged, no implementation branch.
- TASK-010 prior clean pushed milestone: `24e4eab`; final round-7 head merged into `main` as `e532b15` (branch `manishsbhoopalam8498-platform-red-flag-feedback` remains at the same commit, pushed).
- TASK-011 prior pushed milestone: `16af4dc`; current local WIP head is `75bd595`.
- TASK-006 durability source: `manishsbhoopalam8498-persist-dealpilot-locally`; validated
  implementation/integration head `2f85dc7` includes `91a0462`, `7f93f03`, `b93d558`, and
  `7652a43`, plus a normal merge of `origin/main` `bab32ea`; final reviewed source `adf6c95`.
  Merged into `main` at `7f44186` on 2026-07-19 under AP-045; do not merge again.

## Migration sequence

- `0011` and `0013`: TASK-004.
- `0014`: TASK-007.
- `0015_task008_relation_contract`: TASK-008 RM4.
- `0016_new_ink`: TASK-010, LANDED (backfill/constraint for JobPilot flags, owner-aware `memories` RLS, `lineage_revision` column) — merged into `main` as `e532b15`.
- TASK-006 durability: no numbered migration.
- TASK-011: no new migration currently required.

Next new migration allocates `0017`; do not reuse `0016`.

## Approval and ADR coordination

- AP-027: TASK-001.
- AP-028: TASK-002.
- AP-029: early roadmap fan-out.
- AP-030: task-by-task merge/integration authority and RM4 integration evidence.
- AP-031: TASK-004/TASK-005 glue.
- AP-032: TASK-007.
- AP-037: Graph scope/Second Brain convergence.
- AP-038: TASK-022.
- AP-039: TASK-023.
- AP-042: TASK-008 central-review hardening.
- AP-043: validated TASK-008 continuation integration.
- AP-044: TASK-006 durability and OS credential vault; DealPilot ADRs are ADR-117–ADR-120 after
  reconciling current `main`'s Relationship ADR-115/ADR-116.
- AP-045: TASK-006 validated main integration.

Known current branch-local collision:

- TASK-022 output claims ADR-113.
- TASK-023 candidate A output also claims ADR-113.
- Current `main` includes Relationship ADR-115/ADR-116. During later integration, assign distinct
  next-free ADRs and update every companion reference atomically; TASK-006 has already reserved
  ADR-117–ADR-120 on its ready branch.

## Central merge protocol

1. Fetch `origin/main`.
2. Verify the selected branch/worktree and preserve unrelated user changes.
3. Make current `main` an ancestor through a normal merge; never rebase or force-update.
4. Stage a no-commit merge and resolve shared router/wiring/store/docs/generated-file conflicts centrally.
5. Run independent review and affected-neighbour gates.
6. Update routine evidence without changing canonical status unless the exact prototype test is met.
7. Commit with the required Copilot co-author trailer and push.
8. Re-fetch before starting the next integration.
