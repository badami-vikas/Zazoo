# 2026-07-15 — Roadmap execution: JobPilot, DealPilot, Egg + Commons

## Delivered

- JobPilot JP1 foundation: typed JSON Resume, deterministic multi-document master-profile compilation,
  explicit NeedsHuman conflicts, and a human-approval guard.
- DealPilot DP0 foundation: canonical Deal shell/stages, deterministic transitions, and
  Summary/Profile/Documents/Activity projections.
- Egg/UI foundation: Form registered as a metadata-driven standard DataView with an insert-hook seam.
- Commons CM0 foundation: registry client in API wiring; list/get/version/install-propose/publish-builtins
  tRPC procedures; Registry browsing surface.

## Validation evidence

- JobPilot builder: 93/93 package tests; typecheck and review clean.
- DealPilot builder: 57/57 package tests; typecheck and build clean.
- Egg/Commons builder: 99/99 API tests; web typecheck and full build clean.
- Dependency advisory: zod 3.24.1 — no known vulnerability.
- Clean pre-change baseline exposed existing `@bridge/sensors` coverage failure: 35.39% vs 39% floor.

## Still open

- JP1: raw resume/cover-letter ingestion, real-document accuracy eval, categories, persistence, review UI.
- DP0: persistent Deal store/API, stage-event recording, browser Deal shell.
- UI-RULES-1: bind Form direct insert + process parity; route toggles; sub-module nav; page sections;
  artifact tree/index/watcher/CoS grouping.
- CM0: browser install evidence, Learning Agent similarity reads, remaining universal exit gates.
- EG0/EG1 and CM1 remain queued. macOS-only validation was intentionally deferred.

## Artifacts

- Work cursor: `docs/PROGRESS.md`
- Decision: `docs/raw/decisions-log.md` ADR-086
- Known issue: `docs/BUGS.md`
