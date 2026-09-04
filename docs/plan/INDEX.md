# Plans — Index

Every plan doc, past/present/future, pointed to from one place — so plan docs don't scatter across
docs/raw and get confused with each other. This index does NOT move files (companions/related_wiki
frontmatter links stay valid); it categorizes what already exists in `docs/raw/`. Only ONE plan is
"in progress" at a time in [PROGRESS.md](PROGRESS.md) — this index just tells you where to find the
rest.

## Active (tracked live in PROGRESS.md)
See [PROGRESS.md](PROGRESS.md) for what's actually being worked right now.

## Present — decided, not fully executed
- [../raw/oss-commons-integration-plan-2026-07.md](../raw/oss-commons-integration-plan-2026-07.md) —
  status: draft. 3 OSS ingestion pipelines (skills/agents/modules). §0 supply-chain trust foundation
  not built yet — blocks everything after it.
- [../raw/capability-evolution.md](../raw/capability-evolution.md) — status: designed, not built
  (ADR-032). Component Registry + two-gate promotion, targets P3.
- [../raw/execution-plan-2026-07.md](../raw/execution-plan-2026-07.md) — Consolidation sprint
  (ADR-026), tracks A-G, 4-week sequence. Check PROGRESS.md for which tracks are done.
- [../raw/roadmap-6month-2026-h2.md](../raw/roadmap-6month-2026-h2.md) — month-by-month sequencing,
  H2 2026. Per-pointer execution prompts:
  [../raw/roadmap-execution-prompts-2026-h2.md](../raw/roadmap-execution-prompts-2026-h2.md).
- [../raw/token-efficient-development-2026-07.md](../raw/token-efficient-development-2026-07.md) —
  codemap/diagram/nav-index additions, not fully applied.

## Present — the master roadmap
- [../wiki/roadmap.md](../wiki/roadmap.md) — P0-P6 phases, current source of truth. Full pivot
  rationale: [../raw/vision-pivot-living-software.md](../raw/vision-pivot-living-software.md).
- [../raw/roadmap-v2-universal-commons.md](../raw/roadmap-v2-universal-commons.md) — ADD-ON layer
  (5 platform agents, RAG, Commons, control-plane) folded into the phases above, not a separate track.

## Past — superseded, kept for history only
- [../raw/ROADMAP.md](../raw/ROADMAP.md) — pre-pivot roadmap. Historical, do not execute against.

## Future — proposed, not yet decided to start
- Anything logged in [../wiki/QUESTIONS.md](../wiki/QUESTIONS.md) that would need a plan doc before
  it can move to "present."

## Rule for adding a new plan doc
1. Write it in `docs/raw/` with full frontmatter (`doc_kind: plan`).
2. Add one line here under Present/Future.
3. If you start executing it this session, move the line (not the file) into PROGRESS.md's active
   section and remove it from "present — not fully executed" here once truly active.
