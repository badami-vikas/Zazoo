# 2026-07-14 — Session handoff: H2-2026 security/capability roadmap (Batches 1–5 + Month-4 delegation)

Consolidated handoff for a **future fresh session**. This session executed the H2-2026 roadmap
batch-by-batch in autopilot and finished **Month-3**. Month-4 was delegated to a separate session
(see below). Everything a fresh session needs to resume is linked here.

- **Branch:** `manishsbhoopalam8498-security-p0-hardening`
- **PR:** #10 (OPEN) — all batches below land on this PR.
- **Roadmap sequencer:** `docs/raw/roadmap-6month-2026-h2.md`
- **Verbatim per-item specs:** `docs/raw/roadmap-execution-prompts-2026-h2.md`
- **Live tracker:** `docs/PROGRESS.md` (the cursor — read at session start)
- **Governance ledger:** `docs/APPROVALS.md` · **Decisions:** `docs/raw/decisions-log.md` · **Change ledger:** `docs/log.md`

## Start here (a fresh session inherits none of this session's private state)
A new session gets its own session-state folder, so it will NOT auto-read this session's `plan.md`
or checkpoints. The durable entry points are all in the repo:
1. `docs/PROGRESS.md` — current batch + next 3, done-criteria, plan registry.
2. `outputs/` — per-batch deliverable records (this file + the per-batch docs listed below).
3. `docs/APPROVALS.md` — what is approved vs. still PROPOSED (governs what may be marked DONE).
4. `docs/raw/roadmap-execution-prompts-2026-h2.md` — the verbatim contract for each roadmap item.

## Batch status (all on PR #10)

| Batch | Scope | Commit | Status |
|-------|-------|--------|--------|
| 1 — Security P0 | SEC-1 auth-on-mutation · SEC-2 fail-closed CORS + rate-limit · SEC-3 dep bumps + audit gate · XP-1 cross-OS compile | `d65dd48` | **DONE** (AP-010 APPROVED) |
| 2 — Testing P0 | OAuth token-refresh persist · router propose/decide tests · per-package coverage floors (3/6 items pre-existed) | `1f92a7a` | COMPLETE, **AP-011 PROPOSED** |
| 3 — Measurement + security M2 | EVAL-1/EVAL-2 (agent-quality eval + EvalStore) · SEC-5 RLS-as-code · SEC-6 workspace.* membership · SEC-7 Recon SSRF + log redaction | `089421f` | COMPLETE, **AP-012 PROPOSED** |
| 4 — Month-3 PI-1 + MEM-1 | PI-1 taint tagging (TrustOrigin → pipeline → ledger, migration 0009) · MEM-1 MemoryStore + memories table + capture→private episodic Memory | `2d79528` | COMPLETE, **AP-013 PROPOSED** — see `outputs/2026-07-14-roadmap-h2-batch4-pi1-mem1.md` |
| 5 — Month-3 finish PI-2 + PI-3 | PI-2 structural tainted-context egress gate · PI-3 dual-LLM quarantine (ContentGuard) + spotlighting · @bridge/models local guard | `1e500a2` | COMPLETE, **AP-014 PROPOSED** — see `outputs/2026-07-14-roadmap-h2-batch5-pi2-pi3.md` |

**Month-3 (§M3) is COMPLETE**: PI-1 + PI-2 + PI-3 + MEM-1 all shipped (Batches 4 + 5).

## What this session actually did last (Batch 5, then delegation)
- Shipped **PI-2** (structural, always-on egress gate in `pipeline.propose()` — `untrusted_external`
  context + `external:send`/`share` ⇒ `require_approval` ⇒ `pending_review`) and **PI-3** (tool-less
  `QuarantinedContentGuard` with typed-only fail-closed extraction + `spotlightUntrusted()` in
  `run-context.ts`; `@bridge/models` `createLocalContentGuard` refuses the cloud plane).
- Verified full `pnpm turbo run typecheck test build --force` → **59/59 green**; core 219→249, models 18/18.
- Governance closeout: ADR-063 (PI-2) + ADR-064 (PI-3); AP-014 PROPOSED; PROGRESS §Batch 5 (boxes NOT
  ticked pending approval); log + outputs doc. Committed `1e500a2`, pushed.

## Month-4 (§M4) — DELEGATED to a separate session
- **Session:** "Month 4 self-improve", id `7f072367-3674-41c9-b818-ff35727cbd97`
  — autopilot, **stacked on `manishsbhoopalam8498-security-p0-hardening`** (Month-4 depends on Batch-3
  EVAL-1/EVAL-2 + Batch-4 Memory, which live only on this branch), `coordinate_with_creator: false`
  (runs independently; does not report back).
- **Month-4 scope (5 items; verbatim specs in `roadmap-execution-prompts-2026-h2.md`, ~lines 209–254):**
  - **EVAL-3** — baseline-vs-candidate comparison in `capability.approve`.
  - **EVAL-4** — LLM-judge quality scorer.
  - **REG-1** — Component Registry + overlap detection (`capability_manifests` + `kind` discriminator;
    two-tier structural-SQL → pgvector similarity).
  - **VAR-1** — Variance Adjuster tuning (veto → bounded governed param nudge; tone canonical).
  - **GOV-1** — Governance org-health rollup (minor/moderate/major bands; auto-approve `minor` only).
- Next ADR for that work = **ADR-065**; next approval = **AP-015**.

## Standing flags for whoever resumes
- **Open approvals (block marking batches officially DONE / ticking PROGRESS boxes):** AP-011 (Batch 2),
  AP-012 (Batch 3), AP-013 (Batch 4), AP-014 (Batch 5). All PROPOSED, awaiting the user's APPROVED row.
- **Pre-existing CI reds (unrelated to these batches, user-deferred, tracked in `docs/BUGS.md`):**
  `@bridge/web` typecheck (un-narrowed `.route` discriminated union) and `prototype` tsc (dangling
  `../data/reconStaging` + `../data/dbSignals` imports for gitignored PII artifacts).
- **Deferred by design (PI-3):** a real local-classifier binding (Llama-Guard / Prompt-Guard class) and
  the first consuming ingest seam — the guard is exported and ready but intentionally not wired into
  apps/api (no consumer/MCP yet; dead-wiring avoided).

## Environment & build/test gotchas (a fresh session MUST know these)
- **PATH each new shell:** `export PATH="$HOME/.nvm/versions/node/v24.13.0/bin:$PATH"` (node v24.13.0, pnpm 10.33.3).
- **House test runner = `node --test` on compiled `dist/test/*.test.js`** (NOT vitest).
- **turbo `test` uses stale `dist`** — after editing `src/` or `test/`, `pnpm build` BEFORE `pnpm test`.
  - One package: `cd platform/packages/<p> && pnpm build && pnpm test`.
  - Full verify (run ALONE — the db suite flakes under parallel load):
    `cd platform && pnpm turbo run typecheck test build --force`.
- **Egress actions require `actor.plane: "cloud"`** — `authority.ts::planeGate` denies egress from the
  default local plane. Red-team/egress tests need a cloud-plane actor + explicit allow grant so the PI-2
  taint rule is the only gate under test.
- **Import depth:** modules in `src/policy/` and `src/guard/` are one level deep → import core siblings
  via `../ports.js`, `../types.js` (not `./`).
- **`exactOptionalPropertyTypes: true`** (`tsconfig.base.json`): optional props are `T | undefined`
  (never null); use spread-and-omit `...(x ? { k: x } : {})`.
- **Commits:** `git commit -m "$(cat <<'EOF')"` breaks on `|` / single quotes — use `git commit -F /tmp/file`.
  Always include the trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- **`TrustOrigin` = `"operator" | "user_content" | "untrusted_external"`** (in `core/types.ts`), untrusted-by-default.

## Governance protocol (non-negotiable)
Marking any Batch/Phase DONE or ticking a `docs/PROGRESS.md` box REQUIRES a user-**APPROVED** row in
`docs/APPROVALS.md`. Routine work (code+tests, ADRs, `docs/log.md`, `docs/BUGS.md`, PROGRESS bookkeeping
that doesn't flip status) is applied directly. Canon edits (vision/decisions one-liners, plan `status`
flips, roadmap reorders, ADR reversals) go through APPROVALS first.

## Related output docs
- `outputs/2026-07-14-roadmap-h2-security-execution.md` — Batches 1–3 security execution.
- `outputs/2026-07-14-roadmap-h2-batch4-pi1-mem1.md` — Batch 4 (PI-1 + MEM-1).
- `outputs/2026-07-14-roadmap-h2-batch5-pi2-pi3.md` — Batch 5 (PI-2 + PI-3).
