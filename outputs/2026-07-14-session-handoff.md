# 2026-07-14 — Session handoff (roadmap Batch 9 push · approvals AP-011–017 · AP-007/008 · Batch 8 honest partial)

> **Purpose**: a single orientation doc for a FUTURE FRESH SESSION. Read this + `docs/PROGRESS.md`
> first, then dive into the linked ADRs / outputs / log entries only as needed. Everything below is
> already committed + pushed to PR #11.

## Context
- **Repo / branch / PR**: `badami-vikas/relationship-os`, branch
  `manishsbhoopalam8498-month-4-self-improve`, **PR #11** (OPEN), stacked on base
  `manishsbhoopalam8498-security-p0-hardening` (PR #10). Commit directly to this branch — do NOT branch
  off `main`. Batches 1–9 live on this stack and are NOT yet merged to `main`.
- **Project**: Bridge AI "Living Software" TS monorepo under `platform/`. `@bridge/core` = zero-runtime-deps
  kernel; `@bridge/db` binds ports to Drizzle/Supabase (pglite in tests); `apps/api` hosts the
  DealPilot/Helpdesk/JobPilot Pi-extensions.

## What this session shipped (3 commits, newest first)
| Commit | What |
|---|---|
| `f725872` | Apply **AP-007** + **AP-008** (Codex proposals) + **Batch 8** XP-2 honest partial + XP-3 blocked |
| `3c2beb1` | Governance bookkeeping: **AP-011–017 APPLIED** (roadmap Batches 2–7 + 9 marked DONE) |
| `40306ca` | **Batch 9 / Month-6** code — packages (PKG-1/2), Commons supply-chain safety, BLUEPRINT-1, CONSOLIDATE |

### 1) Batch 9 (Month-6) pushed — `40306ca`
Was code-complete from a prior session; this session pushed it. PKG-1 (execution-presence sandbox floor),
PKG-2 (manifest signing + verify-on-install + TLS + community-origin trust floor), BLUEPRINT-1 (versioned
publishable `WorkspaceBlueprint` with a closed-key declarative parse gate), CONSOLIDATE (codified
`node --test` + coverage floors; two floors recalibrated for core-barrel dilution). ADR-076–079. Verified
**59/59** turbo tasks green. Detail: `docs/log.md` 2026-07-14 Batch 9 entry; `outputs/2026-07-14-roadmap-h2-batch9-month6.md`.

### 2) Roadmap approvals applied — `3c2beb1`
User directive "approve all the changes in the roadmap" → flipped `docs/APPROVALS.md`
**AP-011 (Batch 2) · AP-012 (Batch 3) · AP-013 (Batch 4) · AP-014 (Batch 5) · AP-015 (Batch 6) ·
AP-016 (Batch 7) · AP-017 (Batch 9)** from PROPOSED → **APPLIED (user · 2026-07-14)**. Ticked all matching
PROGRESS boxes, updated status notes + the NOW cursor, and flipped two plan-doc statuses
(`docs/raw/testing-strategy.md` and the sequencer `docs/raw/roadmap-6month-2026-h2.md`) to executed. No code
changed in this commit. Detail: `docs/log.md` "roadmap Batches 2–7 + 9 APPROVED" entry.

### 3) AP-007/008 + Batch 8 honest partial — `f725872`
- **AP-007 APPLIED** (ADR-080): ingested the optimizations / Memory-lifecycle / VM-isolation plan
  (`docs/raw/optimizations-memory-vm-dealpilot-plan-2026-07.md` §6) into `docs/wiki/roadmap.md` as
  **additive per-phase bullets** (O0 observability + Memory lifecycle + exec-target → P0; O1/O2 → P1;
  O3 → P2; O4 + container/microVM `SandboxProvider` → P3; Isolated-Computer package → P4; tenant/remote
  pools → P6) — **no batch reorder**.
- **AP-008 APPLIED**: added the **"license-limited capability research"** standing rule to CLAUDE.md
  `## Working rules`; flipped `docs/raw/clean-room-capability-research-protocol-2026-07.md` status
  proposed → adopted.
- **XP-2 (Batch 8) — HONEST PARTIAL** (ADR-081): the *unsigned* native-installer path is delivered AND
  proven. Authored a `desktop-bundle` 3-OS CI job in `.github/workflows/ci.yml` (macOS/Windows/Linux
  matrix; gated to tags `v*` + `workflow_dispatch`; builds web then `tauri build --bundles <per-OS>`;
  signing env vars gated on repo secrets so unsigned builds still succeed; uploads installer artifacts).
  Enabled `bundle.active` + targets/icon list in `tauri.conf.json`; generated a full icon set via
  `tauri icon`. **Verified end-to-end on macOS**: `cargo check` green + a real `Bridge.app` +
  `Bridge_0.1.0_aarch64.dmg` (3.2 MB) built by `tauri build`.
- **XP-3 (Batch 8) — CONFIRMED BLOCKED** (ADR-082): no mobile/Expo app exists on any of the ~20 remote
  refs (the stranded `claude/heuristic-booth-f8f5da` branch is not on the remote), and Expo/RN deps
  can't be installed here → deliberately NOT scaffolded. `docs/BUGS.md` row added.
- Detail: `outputs/2026-07-14-ap007-008-batch8-honest-partial.md`.

## Current roadmap status (Months 1–6)
| Batch | Month | Items | Status |
|---|---|---|---|
| 1 | M1 | Testing-P0 foundation | DONE + APPROVED (AP-010) |
| 2 | M1 | Testing-P0 | DONE + APPROVED (AP-011) |
| 3 | M2 | measurement + M2 security | DONE + APPROVED (AP-012) |
| 4 | M2 | PI-1 + MEM-1 | DONE + APPROVED (AP-013) |
| 5 | M3 | PI-2 + PI-3 | DONE + APPROVED (AP-014) |
| 6 | M4 | self-improvement loop (EVAL-3/4, REG-1, VAR-1, GOV-1) | DONE + APPROVED (AP-015) |
| 7 | M5 | AGENTS-1 + AGENTS-2 | DONE + APPROVED (AP-016) |
| **8** | **M5** | **XP-2 (installers) + XP-3 (mobile)** | **INCOMPLETE — infra-gated** (see below) |
| 9 | M6 | PKG-1/2, BLUEPRINT-1, CONSOLIDATE | DONE + APPROVED (AP-017) |

**Batch 8 is the ONLY incomplete batch.** Both boxes remain `- [ ]` in `docs/PROGRESS.md`:
- **XP-2** — unsigned installer path DONE + proven; **signed/notarized half is OPEN**, blocked only on
  code-signing certificates as repo secrets. **Unblock (no YAML change)**: add secrets `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`,
  `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`, `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` — the
  `desktop-bundle` job auto-signs when present. Then a signed installer proves the DONE-WHEN.
- **XP-3** — fully blocked; **unblock**: a mobile (Expo) app present on the working branch + devices/
  simulators + installable deps. Do NOT scaffold a fake app (fabrication; ADR-082).

## Governance state (for the next session)
- **Next ADR = ADR-083.** (ADR-080 = AP-007 ingest; ADR-081 = XP-2 partial; ADR-082 = XP-3 blocked; last
  Batch-9 ADR = ADR-079.)
- **Next approval = AP-018.** All of AP-007, AP-008, AP-010–017 are now **APPLIED**. No PROPOSED rows are
  outstanding for the roadmap. **Do not re-file or re-tick applied rows.**
- **Rule**: nothing marked DONE (PROGRESS boxes, plan `status` flips, Track/Phase DONE, ADR reversal,
  sequencer reorder, canon-doc edits) without a user-APPROVED `docs/APPROVALS.md` row. Routine work
  (code+tests, ADRs, log/BUGS/dummy rows, PROGRESS bookkeeping that isn't a DONE tick) is applied directly.
- **Tracking surfaces touched this session**: `docs/dummy.md` (placeholder desktop icon set — remove when
  a real ≥1024² brand icon is supplied), `docs/BUGS.md` (2 OPEN: the stranded mobile-app gap; the
  pre-existing `blueprintFieldSchema` missing-`"location"` enum from Batch 9).

## Environment + verify (MANDATORY facts — not inherited across shells)
- **PATH** (every fresh shell): `export PATH="$HOME/.nvm/versions/node/v24.13.0/bin:$PATH"` (node v24.13.0,
  pnpm 10.33.3). **Do NOT run `pnpm install`** (disallowed here; CI does it fine).
- **Rust** (for the desktop/tauri work): `source "$HOME/.cargo/env"` (cargo 1.97.0 via rustup at
  `~/.cargo/bin`, NOT on default PATH). `tauri-cli` 2.11.4 via `pnpm exec tauri`. `/usr/bin/sips` available.
- **Python**: `pip`/`pip3` absent — use `python3 -m pip install <pkg>` (installed `pyyaml` this session).
- **House test runner** = `node --test` on COMPILED `dist/test/*.test.js` (NOT vitest). After editing a
  package's `src`/`test` you MUST `pnpm build` it before `pnpm test`.
- **Full verify (run ALONE)**: `cd platform && pnpm turbo run typecheck test build --force --concurrency=1`
  → baseline **59/59 tasks green**. Serial (`--concurrency=1`) avoids the documented pglite/db
  parallel-resource-pressure flake. This session's edits (CLAUDE.md, docs, `ci.yml`, `tauri.conf.json`,
  icons) are OUTSIDE the turbo graph, so 59/59 is structurally unaffected; the `tauri.conf.json` change is
  exercised by the `desktop` CI job's `cargo check` (verified green on macOS) + a full local `tauri build`.
- **Deferred CI reds (don't chase)**: `@bridge/web` typecheck + `prototype` tsc (dangling gitignored
  PII-artifact imports) — pre-existing, unrelated, deferred by the user.
- **Commit gotcha**: use `git commit -F /tmp/msgfile` (heredoc breaks on `|`/quotes). Trailer:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`. Push continues PR #11.

## What is NOT done (honest boundaries)
- XP-2 signed/notarized installers — blocked on signing certs as repo secrets.
- XP-3 mobile rebase — blocked; no app on any accessible ref + no devices/simulators.
- Batch 8 is not marked complete; no roadmap DONE tick exists for it.
- Follow-ups noted in ADR-079: rewrite `docs/wiki/testing.md` (stale re: coverage-floor mechanics); a
  future repo-wide decision on own-code-only coverage.

## Where to look next
- `docs/PROGRESS.md` — the live cursor + all-plan registry (READ FIRST).
- `docs/raw/decisions-log.md` — ADR-076–082 for the rationale of everything above.
- `docs/log.md` — 2026-07-14 change entries (Batch 9, approvals, AP-007/008 + Batch 8).
- `outputs/2026-07-14-*.md` — per-topic user-facing outcome docs (batch4/5/6/7/9, security, and the
  ap007-008-batch8 detail + this handoff).
- The H2 roadmap contract: `docs/raw/roadmap-6month-2026-h2.md` + `docs/raw/roadmap-execution-prompts-2026-h2.md`.
