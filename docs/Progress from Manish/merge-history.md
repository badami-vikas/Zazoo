# Merge and integration history

This file prevents a new session from re-merging historical branches or reusing allocated migration/decision numbers.

## Current central baseline

- TASK-005 implementation/certification checkpoint `166a01b` landed through progress handoff
  commit `d4de355`. Both were verified in `origin/main@d153094` ancestry; the later commits through
  `d153094` belong to the unrelated Zazoo storyboard merge.
- TASK-006 code landed at `7f44186` under AP-045 after validating and normally merging base
  `bab32ea`.
- TASK-011 (JobPilot culture research) landed at final head `5e826ad` via PR #22 under AP-049 on
  2026-07-19, merged forward through `origin/main@d153094` plus its own subsequent `9030aa1` docs
  reconciliation commit.
- TASK-024 (Zazoo public website) landed via PR #23 under AP-052 on 2026-07-19. Implementation
  checkpoint `a4bf5fb` normally merged `origin/main@512cf35` at integration checkpoint `69ffbff`.
  External Pages publication `2306808` succeeded in run `29683315854`, then user-directed revert
  `6b76466` restored the older `https://zazoo.me` experience through successful run `29683837490`.
  The TASK-024 source remains merged. No migration was added.
- TASK-012 VOCAB0–VOCAB1 landed through PR #26 on 2026-07-19. Checkpoint `dd51797` carries the
  ratchet and Avatar/Onboarding migration; `bd7de18` reconciles TASK-024's later website source
  without growing the baseline.
- TASK-012 VOCAB2 landed through PR #27 from source `88be310`; merge commit `f6c4376`.
- Partial VOCAB3 checkpoint `58573ba` was pushed to `main` with migration
  `0021_vocab3_organization_module_record`. TASK-012 and VOCAB3 remain in progress.
- Stalled Supabase deployment session `0f3e2f14-7fd2-4d07-8f3e-9c86c7c5480a` shared the
  central checkout and had no independent branch. Its completed tree was preserved at
  `6590c71`; this merge normally reconciles `origin/main@5ab4568`, retains canonical VOCAB3
  conflicts, and ports the deployment-specific slice under AP-054/ADR-128.
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
| `905aee9` | Recorded AP-043 and the validated TASK-008 continuation integration. |
| `7f44186` | TASK-006 durable Local Plane, OS vault, OAuth, and desktop lifecycle integration under AP-045; final reviewed source was `adf6c95`. |
| `5091dae` | Recorded the landed TASK-006 integration and refreshed its canonical resume evidence. |
| `f78e47c` | Canonically closed the exact TASK-008 prototype after the validated RM4 and Relationship continuation evidence; advanced RM6/evaluation work remains future scope. |
| `3741a41` | Reconciled the historical RM4 worktree with the canonical TASK-008 closure, refreshed fresh-session guidance, and regenerated Task Manager data; no RM4 code was re-merged. |
| `5ca30ca` | TASK-010 live JobPilot Red Flag certification and closure; preserved migration `0016_new_ink`. |
| `166a01b` | TASK-005 final implementation/certification checkpoint: signed no-egress Commons Skill under Learning Agent, private recommendation migration `0017`, exact binding/provenance, crash-safe Organization Files rename, final desktop/mobile/native evidence, and AP-047/ADR-121/122 closure. |
| `5e826ad` | TASK-011 JobPilot culture-research final head, merged into `main` via PR #22 under AP-049: durable child-Run terminal-audit repair, full-lineage artifact purge/redaction, merged forward through TASK-010 and TASK-005; no new migration. |
| `d4de355` | TASK-005 progress handoff and fast-forward landing on `main`; updated AP-047, all four Progress-from-Manish files, and the final change log. |
| `d153094` | Verified later `main` baseline containing TASK-005 plus the unrelated Zazoo storyboard merge from PR #21. |
| `a4bf5fb` | TASK-024 standalone Zazoo cinematic public website: ten scenes, governed copy, accessible interactions, responsive/reduced-motion behavior, and contract tests. |
| `69ffbff` | TASK-024 normal integration of `origin/main@512cf35` before its AP-052 landing through PR #23. |
| `2306808` (Pages repository) | Published TASK-024 at `https://zazoo.me` while preserving the custom-domain `CNAME` plus Consulting/Training pages; Pages run `29683315854` passed. |
| `6b76466` (Pages repository) | Reverted publication `2306808` under AP-053, restoring the pre-TASK-024 homepage while preserving `CNAME`, `consulting.html`, and `training.html`; Pages run `29683837490` passed. |
| `dd51797` | TASK-012 VOCAB0–VOCAB1 integrated onto current `main`: syntax-aware vocabulary ratchet, canonical visual-only Avatar/Onboarding contracts, compatibility readers, and fail-closed desktop readiness. |
| `bd7de18` | Reconciled TASK-024's newer website identifiers and paired CSS selectors without increasing TASK-012's 7,515-occurrence baseline. |
| `88be310` | Completed TASK-012 VOCAB2 Automation/Engine migration on the source branch. |
| `f6c4376` | Merged TASK-012 VOCAB2 through PR #27. |
| `58573ba` | Partial TASK-012 VOCAB3 checkpoint: Organization/Module/Record runtime contracts, migration `0021`, Local Plane compatibility, and targeted regression fixes. Not a VOCAB3 completion claim. |
| `6590c71` | Preservation checkpoint for the recovered Supabase pilot deployment before reconciling newer `origin/main`; retained as a merge parent/audit source, not as the final vocabulary integration. |
| (this merge) | Recovered Supabase session integration: migration `0022`, least-privilege/RLS context, exact hosted Auth, encrypted headless vault, Local/Cloud ledger routing, container assets, and durable recovery records. Local `main` only; no push or cloud provisioning. |

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
- TASK-005 certification source: `manishsbhoopalam8498-certify-task-005-demo`; implementation
  checkpoint `166a01b`, progress handoff / `main` landing `d4de355`, then historical branch
  fast-forward through `d153094`. Merged and done; do not merge again.
- TASK-010 prior clean pushed milestone: `24e4eab`; final round-7 head merged into `main` as `e532b15` (branch `manishsbhoopalam8498-platform-red-flag-feedback` remains at the same commit, pushed).
- TASK-011 source: `manishsbhoopalam8498-shiny-adventure`; final head `5e826ad`. Merged into `main` via PR #22 under AP-049 on 2026-07-19; do not merge again.
- TASK-006 durability source: `manishsbhoopalam8498-persist-dealpilot-locally`; validated
  implementation/integration head `2f85dc7` includes `91a0462`, `7f93f03`, `b93d558`, and
  `7652a43`, plus a normal merge of `origin/main` `bab32ea`; final reviewed source `adf6c95`.
  Merged into `main` at `7f44186` on 2026-07-19 under AP-045; do not merge again.
- TASK-024 source: `task-024-zazoo-website`; implementation checkpoint `a4bf5fb`, integration
  checkpoint `69ffbff`, landed through PR #23 under AP-052. Merged and done; do not merge again.
- TASK-012 planning source: `manishsbhoopalam8498-fuzzy-adventure` at `5775e5b`; planning-only,
  do not merge or resume as implementation. VOCAB0–VOCAB1 integration source:
  `task-012-vocab01` at checkpoints `dd51797` and `bd7de18`, landed through PR #26. VOCAB2 source
  `task-012-vocab2` at `88be310` landed through PR #27 (`f6c4376`). Partial VOCAB3 source
  `task-012-vocab3` checkpoint `58573ba` is on `main`; continue the still-open task from `main`.

## Migration sequence

- `0011` and `0013`: TASK-004.
- `0014`: TASK-007.
- `0015_task008_relation_contract`: TASK-008 RM4.
- `0016_new_ink`: TASK-010, LANDED (backfill/constraint for JobPilot flags, owner-aware `memories` RLS, `lineage_revision` column) — merged into `main` as `e532b15`.
- `0017_task005_private_learning_recommendations`: TASK-005, LANDED (owner-scopes current/legacy
  Learning recommendation proposals and linked rows).
- `0018_tense_warbound`: TASK-009/TASK-014 Relationship location overrides, LANDED through
  integration baseline `512cf35`.
- `0019_repeat_private_learning_backfill`: idempotent TASK-005 privacy replay above migration
  `0018`'s timestamp, LANDED through `512cf35`.
- TASK-006 durability: no numbered migration.
- TASK-011: no new migration required (LANDED, application-logic only).
- TASK-024: no new migration required (LANDED, standalone public website only).
- TASK-012 VOCAB0–VOCAB1: no new migration required (LANDED; TASK remains in progress).
- `0020_vocab2_automation_engine`: TASK-012 VOCAB2, LANDED through PR #27.
- `0021_vocab3_organization_module_record`: TASK-012 partial VOCAB3 checkpoint `58573ba`, LANDED
  as an incomplete checkpoint.
- `0022_supabase_runtime_role`: recovered Supabase deployment, integrated under AP-054/ADR-128.

Next new migration allocates `0023`; do not reuse `0016` through `0022`.

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
- AP-046: TASK-010 live certification and closure.
- AP-047: TASK-005 exact combined demo certification and closure.
- AP-052: TASK-024 exact storyboard implementation, optional review skip, and `main` landing.
- AP-054: recovered Supabase deployment reconciliation and local `main` integration.
- ADR-121: exact private no-egress Commons Skill + owning-Module runtime binding.
- ADR-122: serialized Organization DB identity/local Files rename with durable fail-closed recovery.
- ADR-128: Supabase supplies Postgres/Auth while an external API/static host preserves
  least privilege and explicit Local/Cloud residency.

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
