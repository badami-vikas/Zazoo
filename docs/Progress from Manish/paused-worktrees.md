# Paused worktrees

All listed paused workers were stopped on 2026-07-18. TASK-005's later landing session is complete.
Re-check every status before resuming because remaining entries are uncommitted snapshots, not
immutable releases.

## Central baseline

- Checkout: `/Users/manishsbhoopalam/.copilot/repos/relationship-os`
- Branch: `main`
- Latest `main` baseline merged for this handoff:
  TASK-005 implementation/certification checkpoint `166a01b`.
- TASK-006 landed at `7f44186` under AP-045 after validating and normally merging base `bab32ea`.
- Working tree: clean when recorded.
- Background agents and worktree processes: none.

## TASK-005 combined demo certification — MERGED 2026-07-19

- Session: `18c7a8c6-49b0-4cd8-a964-ae47cdbd648a`
- Branch: `manishsbhoopalam8498-certify-task-005-demo`
- Implementation/certification checkpoint: `166a01b`
- Canon: TASK-005 `done`; AP-047; ADR-121/ADR-122
- Migration: `0017_task005_private_learning_recommendations`; next new migration is `0018`

Fresh isolated desktop `1440×913` and exact mobile `375×812` runs completed the entire
Onboarding→Owl→Relationship→Commons→Learning Agent→provenance→correction/veto/delete path on the
final post-review code. The package is signed `cited-role-model-practice@1.0.1`, declares private
Signal read/write with no runtime egress, and binds only while its current signed Skill and exact
owning Relationship Module contracts match. Distinct dual Files roots preserve rename intent and
stop. API 251, DB 159, web 81, Rust 44, typecheck 37/37, build 20/20, all 36 non-Sensor test tasks,
lint, no-runtime-dummy, release-native launch, and final independent review passed.

This worktree is historical after merge. Do not resume it, re-run its migration under another
number, or merge it again.

## TASK-006 durability — MERGED 2026-07-19

- Session: `19b390c3-6551-4672-ae41-67735b71ff71`
- Worktree: `/Users/manishsbhoopalam/.copilot/repos/copilot-worktrees/relationship-os/manishsbhoopalam8498-fuzzy-meme`
- Branch: `manishsbhoopalam8498-persist-dealpilot-locally`
- Validated implementation/integration head: `2f85dc7` (normally merged `origin/main` `bab32ea`)
- Final reviewed source head: `adf6c95`
- Landed `main` integration: `7f44186`
- Existing durability chain: `91a0462`, `7f93f03`, `b93d558`, `7652a43`, and `2f85dc7`
- Integration: user authorized AP-045; fast-forwarded into `main` at `7f44186`.

Implemented:

- Versioned Organization-scoped Local Plane DealPilot aggregate with restart/concurrency/isolation behavior.
- Persistent Gmail continuation, spend, dedupe, pending receipts, and two-phase acknowledgement.
- MIT `@napi-rs/keyring` adapter behind the vault port.
- Owner-scoped credential reveal/copy/revoke with value-free audit.
- Fail-closed runtime storage/vault wiring.
- Parent-retained desktop socket activation, authenticated readiness/shutdown, terminal child-loss
  handling, trusted-origin webviews, and panel-safe companion retirement.
- Hashed, single-use Google OAuth state, PKCE S256, serialized provisional-token finalization,
  refresh CAS, and system-browser consent.
- Crash-recoverable opaque keyring create/revoke journals and pre-Drizzle legacy Local Plane import.

Reported validation:

- Typecheck 37/37; build 20/20.
- API 239; DealPilot 90; Local 8; DB 155; Core 430; Sourcing 7; Company Sourcing 4;
  Google 39; Web 70.
- Desktop `cargo check`, 44 Rust tests, strict Clippy, and rustfmt.
- Changed-file ESLint, no-runtime-dummy, task parser, build/typecheck, migration-delta, and diff
  integrity checks passed.
- Final security review reported no vulnerabilities. The only correctness suggestion—release
  ownership after failed client close—was deliberately rejected and regression-tested because the
  embedded client may remain live.
- Live host evidence exists for a macOS keyring round-trip, release-sidecar readiness/child-loss
  recovery with retained-port protection, and Chrome `/dealpilot/sources` at 375x812 without
  horizontal overflow.

Remaining:

- Live Google/BizBuySell credentials and verified OS/application Human re-authentication remain
  unavailable. Signing and physical-mobile certification remain unclaimed.
- Keep TASK-006 `in_progress`; do not infer those external gates from code or host-local evidence.
- No numbered migration was added.

## TASK-010 red-flag correction — MERGED 2026-07-18

TASK-010's round-7 post-RM4 work landed and merged into `main` as `e532b15` (fast-forward from `manishsbhoopalam8498-platform-red-flag-feedback`). This worktree is no longer paused/dirty. See `merge-history.md`'s `e532b15` row and `subagent-progress.md`'s TASK-010 row for the full account. Authenticated desktop and 375px live certification closed the exact Prototype test on 2026-07-19 after fixing the missing JobPilot default-table cell controls; this historical worktree must not be resumed or merged again.

## TASK-011 culture research — MERGED 2026-07-19

TASK-011's central-merge review closure (durable child-Run terminal audit repair + full-lineage artifact purge/redaction) landed and merged into `main` via PR #22 (`manishsbhoopalam8498-shiny-adventure`, final head `5e826ad`). This worktree is no longer paused/dirty; see `merge-history.md`'s row and `subagent-progress.md`'s TASK-011 row for the full account. No new migration was required. This historical worktree must not be resumed or merged again.

## TASK-022 inference optimization

- Session: `87f7fbd1-a6a4-47fa-bc67-bb8a5a20bd1a`
- Worktree: `/Users/manishsbhoopalam/.copilot/repos/copilot-worktrees/relationship-os/manishsbhoopalam8498-turbo-carnival`
- Branch/head: `manishsbhoopalam8498-implement-task-022` / `631aa9f`
- Dirty snapshot: 31 staged/unstaged paths.

Implemented:

- Explicit `cheap/default/reasoning` provider tiers.
- Plane/tier/provider-hint routing.
- Stable Anthropic system-block caching.
- Normalized usage and cache receipt fields.
- Governed CoS model calls with prompt-free append-only receipts.
- Local Plane fail-closed routing and bounded cost/error handling.

Reported validation: core/models/API 623/623, changed-file ESLint, no-dummy, and whitespace checks.

Remaining: central diff review, reconcile staged versus unstaged changes, confirm no canonical status overclaim, resolve ADR number collision, then commit/push.

## TASK-023 candidate A

- Session: `874ca9fc-1570-4d17-bf06-172298b0abc3`
- Worktree: `/Users/manishsbhoopalam/.copilot/repos/copilot-worktrees/relationship-os/manishsbhoopalam8498-super-engine`
- Branch/head: `manishsbhoopalam8498-build-governed-web-research` / `631aa9f`
- Dirty snapshot: 21 tracked and 8 untracked files, approximately +614/-43.

Implemented:

- Core `SearchProvider`.
- Tier-1-only attributable provider router.
- DNS-pinned safe HTTP client.
- Parallel Search MCP adapter and policy-drift gate.
- Governed Learning Agent `web-research` Skill and taint/provenance.

Reported validation: full build/typecheck; core 425, models 34, DB 124, API 176; live bounded Parallel smoke; independent security review with no findings.

Rights verdict: Parallel anonymous MCP shipped; Jina keyless and DuckDuckGo Instant Answer blocked; no Tier-2/Tier-3/paid provider registered.

## TASK-023 candidate B

- Session: `b44e7514-4f2d-4e57-a4c7-e2b9b06be88d`
- Worktree: `/Users/manishsbhoopalam/.copilot/repos/copilot-worktrees/relationship-os/manishsbhoopalam8498-psychic-sniffle`
- Branch/head: `manishsbhoopalam8498-implement-web-research` / `631aa9f`
- Dirty snapshot: 13 tracked and 3 untracked paths, approximately +385/-85.

Implemented provider verification, core port/taint, a separate research package/net guard, TASK-007 authority wiring, API route, focused tests, and Onboarding role-model migration.

Reported validation before final migration: research 24/24 with 92.29% line / 80% branch / 92.31% function coverage; focused API 4/4.

Remaining: post-migration API/full gates, docs/evidence, independent security review, commit/push.

### TASK-023 selection rule

Compare candidate A and B feature-by-feature and choose one implementation. Candidate A has the stronger completed handoff; candidate B has a different package shape and the Onboarding migration. Do not merge both or cherry-pick overlapping security primitives without a deliberate reconciliation review.

## TASK-008 Relationship continuation — MERGED 2026-07-19

- Candidate A session: `b6486e55-47b5-43f7-9a34-eb84ecc578ce`
- Source branch: `manishsbhoopalam8498-complete-relationship-records`
- Integrated head: `905aee9`
- Implementation: `cbda8d6` and `f409777`
- Central hardening: `71368fe`

The validated continuation is on `main`: owner-safe Person/Community CRUD/search/detail, one participant
Timeline, bounded Google/capture and identity review, Memory/commitment/meeting flows, bounded paths and
Community composition, and double-consent Introduction snapshots. Its prior lifecycle-receipt and central
authority/privacy/durability findings were fixed before AP-043 integration.

Candidate B session `e859579b-a865-4ad3-b16c-e4d8cbccf17d` remains a superseded historical dirty
worktree. Do not merge either candidate again. TASK-008 is `done` for its exact prototype; persistent
user-defined Automations/Agent Runs, advanced RM6 team permission/delegation,
export/disconnect/forget, held-out evaluation, and TASK-014/TASK-009's shared Graph renderer remain
future scope rather than resume blockers.
