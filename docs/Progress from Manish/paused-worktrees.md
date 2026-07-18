# Paused worktrees

All workers were stopped on 2026-07-18. Re-check every status before resuming because these are uncommitted snapshots, not immutable releases.

## Central baseline

- Checkout: `/Users/manishsbhoopalam/.copilot/repos/relationship-os`
- Branch: `main`
- HEAD and `origin/main`: `631aa9f79a90e151eb74a5c3d74ec4319898c8f7`
- Working tree: clean when recorded.
- Background agents and worktree processes: none.

## TASK-006 durability — READY FOR COORDINATOR MERGE 2026-07-19

- Session: `19b390c3-6551-4672-ae41-67735b71ff71`
- Worktree: `/Users/manishsbhoopalam/.copilot/repos/copilot-worktrees/relationship-os/manishsbhoopalam8498-fuzzy-meme`
- Branch: `manishsbhoopalam8498-persist-dealpilot-locally`
- Validated implementation/integration head: `2f85dc7` (normally merged `origin/main` `bab32ea`)
- Existing durability chain: `91a0462`, `7f93f03`, `b93d558`, `7652a43`, and `2f85dc7`
- Worktree: clean after the final evidence follow-up commit; branch is ready for coordinator review/merge.

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

- Coordinator review/merge only; do not merge this branch into `main` from the worktree.
- Live Google/BizBuySell credentials and verified OS/application Human re-authentication remain
  unavailable. Signing and physical-mobile certification remain unclaimed.
- Keep TASK-006 `in_progress`; do not infer those external gates from code or host-local evidence.
- No numbered migration was added.

## TASK-010 red-flag correction — MERGED 2026-07-18

TASK-010's round-7 post-RM4 work landed and merged into `main` as `e532b15` (fast-forward from `manishsbhoopalam8498-platform-red-flag-feedback`). This worktree is no longer paused/dirty. See `merge-history.md`'s `e532b15` row and `subagent-progress.md`'s TASK-010 row for the full account. `docs/TASKS.md` TASK-010 `Status` remains `in_progress` (no live desktop/375px browser evidence yet); `ledger`'s own RLS and any further live-evidence gathering are the only remaining open items, not a resumable dirty worktree state.

## TASK-011 culture research

- Session: `9ec89b18-83f1-4ce2-a825-ba5380537ad5`
- Worktree: `/Users/manishsbhoopalam/.copilot/repos/copilot-worktrees/relationship-os/manishsbhoopalam8498-shiny-adventure`
- Branch/head: `manishsbhoopalam8498-shiny-adventure` / local WIP `75bd595`
- Prior pushed head: `16af4dc`
- Dirty snapshot: `wiring.ts`, core Memory store, and DB Memory store, approximately +195/-3.

Completed branch scope includes governed public-evidence research, pinned DNS/manual redirects, bounded artifacts, rights registry, two-phase approval/fetch, cancellation, durable intent, grounding DAG, taint, expiry, live UI state, and restart durability.

Central review blockers:

1. Terminal child-Run status and outcome audit must reconcile durably after append failure and restart.
2. Artifact purge must remove raw bytes across the full superseded Memory lineage in in-memory and Drizzle modes.

Resume from the WIP commit and three dirty files; do not redo the prior twelve review rounds. No new migration is currently required.

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

## TASK-008 RM1-RM2 candidate A

- Session: `b6486e55-47b5-43f7-9a34-eb84ecc578ce`
- Worktree: `/Users/manishsbhoopalam/.copilot/repos/copilot-worktrees/relationship-os/manishsbhoopalam8498-symmetrical-spork`
- Branch/head: `manishsbhoopalam8498-complete-relationship-records` / `631aa9f`
- Dirty snapshot: 30 tracked and 2 untracked files, approximately +3801/-360.

Reported validation: typecheck 37/37, build 20/20, core/Google/local/DB pass; API 174/175 because one test expects retired `touchpoint` instead of canonical `event`; web did not run.

Known defect: stale/no-op auto Record updates and already-archived retries omit lifecycle Event receipts, allowing `listUnmaterializedAutoMutationIds` to select them forever.

## TASK-008 RM1-RM2 candidate B

- Session: `e859579b-a865-4ad3-b16c-e4d8cbccf17d`
- Worktree: `/Users/manishsbhoopalam/.copilot/repos/copilot-worktrees/relationship-os/manishsbhoopalam8498-upgraded-system`
- Branch/head: `manishsbhoopalam8498-implement-relationship-rm1-rm2` / `631aa9f`
- Dirty snapshot: 27 tracked files, approximately +4184/-354.

Large graph/API/UI/Google/local-store implementation exists. No completed handoff, security review, or final validation is recorded.

### RM1-RM2 selection rule

Compare both implementations against canonical RM1-RM2 scope and current RM4 contracts. Candidate A has a concrete validation/review handoff and known liveness defect; candidate B has a broader local-store delta but less evidence. Select one owner and archive the other only after preserving any uniquely correct tests or contracts.
