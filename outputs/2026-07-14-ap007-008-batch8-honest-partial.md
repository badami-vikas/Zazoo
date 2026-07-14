# 2026-07-14 — AP-007 + AP-008 applied; Batch 8 XP-2 honest partial + XP-3 confirmed-blocked

## Task scope
Follow-up to the roadmap-approval pass, on branch `manishsbhoopalam8498-month-4-self-improve`
(PR #11, stacked on `…-security-p0-hardening`). The user asked to implement the "untouched parts",
disambiguated to **both**: (A) apply the two remaining Codex approval proposals AP-007 + AP-008
(doc-only), and (B) do the honest, non-fabricated parts of the infra-gated Batch 8 (XP-2/XP-3).
No roadmap batch is marked complete here; governance (no DONE without a user-approved APPROVALS row)
is preserved.

## User requests addressed
- "push all these changes and approve all the changes in the roadmap" → done earlier this session
  (Batch 9 code pushed `40306ca`; AP-011–017 APPLIED, bookkeeping `3c2beb1`).
- "implemented the untouched part now" → disambiguated via `ask_user`; user chose **"Both of the
  above"** (apply AP-007/008 **and** the honest Batch-8 parts).

## What was delivered

### AP-007 applied — long-term roadmap phase-mapping ingest (Codex proposal)
- Ingested `docs/raw/optimizations-memory-vm-dealpilot-plan-2026-07.md` §6 into `docs/wiki/roadmap.md`
  as **additive per-phase bullets**, with **no batch reorder** (honoring the approval's own constraint):
  - O0 observability + Memory lifecycle/security + execution-target → **P0**
  - O1/O2 lossless compression + retrieval-first context → **P1**
  - O3 → **P2**; O4 + container/microVM `SandboxProvider` → **P3**
  - optional visible Isolated-Computer package → **P4**; remote tenant pools → **P6**
- `docs/APPROVALS.md` AP-007 row flipped PROPOSED → APPLIED. Rationale: ADR-080.

### AP-008 applied — CLAUDE.md "license-limited capability research" standing rule (Codex draft)
- Added the standing rule to CLAUDE.md `## Working rules`: exhaustive lawful functional research +
  benchmark before building a custom alternative; reuse/interoperate when the license allows;
  clean-room separation + provenance when warranted; never copy protected expression/assets or bypass
  a license/contract/access control; counsel gate for ambiguity.
- Flipped `docs/raw/clean-room-capability-research-protocol-2026-07.md` status proposed → adopted.
- `docs/APPROVALS.md` AP-008 row flipped PROPOSED → APPLIED.

### XP-2 (Batch 8) — HONEST PARTIAL: the unsigned native-installer path, delivered and proven
- **`.github/workflows/ci.yml`**: new `desktop-bundle` job — a macOS/Windows/Linux matrix, gated to
  tags (`v*`) and `workflow_dispatch` (installer builds are too heavy for every PR). It builds the web
  frontend, then `pnpm exec tauri build --bundles <per-OS>` (macOS `app,dmg`; Linux `deb,appimage`;
  Windows `msi,nsis`). Signing env vars are gated behind repository secrets (an unsigned build still
  succeeds); installer artifacts are uploaded (`if-no-files-found: warn`). Added `workflow_dispatch` +
  `push.tags:['v*']` to the workflow triggers.
- **`platform/apps/desktop/src-tauri/tauri.conf.json`**: `bundle.active:true` + `targets:"all"` +
  category/descriptions + a real multi-resolution `icon` list.
- **Icon set**: generated a full set via `tauri icon` (`.icns`, `.ico`, `32/64/128/128@2x` PNGs +
  Windows Store logos). The source was a 32×32 placeholder upscaled to 1024 → a blurry placeholder,
  tracked in `docs/dummy.md` (removal = a real ≥1024² brand icon).
- **Verified end-to-end on macOS**: `cargo check` green with the icon set, and `tauri build` produced a
  real `Bridge.app` + `Bridge_0.1.0_aarch64.dmg` (3.2 MB). `target/` + `web/dist` are gitignored, so no
  build binaries enter the commit.
- **Still open (cert-gated)**: code-signing + notarization need signing certificates as repo secrets,
  which don't exist here. **XP-2 box stays UNTICKED** — the DONE-WHEN requires *signed* installers.
  Rationale: ADR-081.

### XP-3 (Batch 8) — CONFIRMED BLOCKED, deliberately not fabricated
- Scanned all ~20 remote refs: no mobile/Expo app anywhere (`platform/apps` = api/desktop/web only; no
  `app.json`/`eas.json`/react-native/expo; zero mobile commits); the stranded
  `claude/heuristic-booth-f8f5da` branch is not on the remote. Expo/RN deps can't be added (no
  `pnpm install`).
- Deliberately **not scaffolded** — a fake mobile app would be dummy code or break the build. Recorded
  in `docs/BUGS.md` + PROGRESS §Batch 8. **XP-3 box stays UNTICKED.** Rationale: ADR-082.

## Governance + verification
- APPROVALS: AP-007 + AP-008 flipped PROPOSED → APPLIED (user · 2026-07-14). No new approval row — the
  XP-2 partial is not a DONE claim, and Batch 8 is **not** marked complete (both boxes remain `- [ ]`).
- ADRs: **ADR-080** (AP-007 ingest), **ADR-081** (XP-2 honest partial), **ADR-082** (XP-3 blocked).
- Turbo-graph verify authority stays **59/59** — this session's edits are outside the turbo graph;
  the `tauri.conf.json` change is exercised by the `desktop` job's `cargo check`, verified green on
  macOS, plus a full local `tauri build`.
- Tracking: `docs/dummy.md` (placeholder icon set), `docs/BUGS.md` (stranded mobile app), `docs/log.md`
  entry, PROGRESS NOW-cursor + Batch-8 note updated.

## What is NOT done (honest boundaries)
- XP-2 signed/notarized installers — blocked on signing certs as repo secrets.
- XP-3 mobile rebase — blocked; no app on any accessible ref + devices/simulators absent.
- Batch 8 remains incomplete; no roadmap DONE tick was added for it.
