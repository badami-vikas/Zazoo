# APPROVALS — internal canon-change ledger

Bridge governs its product with draft-then-approve. This repo governs **its own canon** the same way. Changes to canonical/plan docs are **proposed here first** and only become authoritative once the user (the sole approver today) flips them to APPROVED. This is the doc-layer analogue of the platform's `propose → decide → commit` pipeline.

## What requires an approval row (canon + plan changes)
- Editing a **locked/canonical doc**: `docs/wiki/vision.md`, `docs/wiki/decisions.md` (strategic one-liners), any `requirement` doc (verbatim user text — also never-edit).
- **Flipping a plan's `status`** (e.g. `draft` → `active`/`approved`, or marking a Track/Phase **DONE**) or changing the roadmap **sequencer order** (`roadmap-6month-2026-h2.md`).
- **Reversing or superseding a decision** already recorded in an ADR.
- Marking any consolidation-plan track as executed.

## What does NOT (routine — just do it, then log to `docs/log.md`)
- New `docs/raw/` drafts; wiki summaries of existing raw; `docs/log.md` / `docs/BUGS.md` / `docs/dummy.md` rows; `docs/PROGRESS.md` batch bookkeeping; CODEMAPS regen; code changes with passing tests.

## Protocol
1. Agent appends a **PROPOSED** row below (+ the concrete diff/patch as a proposal — do NOT apply it to the canon doc yet, and do NOT mark anything DONE).
2. User reviews, sets status **APPROVED** or **REJECTED** (may edit the proposal first).
3. On APPROVED: agent applies the change, sets status **APPLIED**, fills the commit SHA. Never treat a proposal as canon before it is APPROVED.
4. Append-only. Superseded rows stay for history.

`Never mark a plan/track DONE unless the repo actually contains the edits AND this ledger shows it APPROVED.` (Critique conflict #1 resolution, ADR-044.)

## Ledger

| ID | Date | Proposer | Scope (canon doc / decision) | Change summary | Status | Decided-by · date | Applied-commit |
|----|------|----------|------------------------------|----------------|--------|-------------------|----------------|
| AP-001 | 2026-07-09 | session (opus) | mechanism bootstrap | Create this approval mechanism itself | APPLIED | user · 2026-07-09 | (this commit) |
| AP-002 | 2026-07-09 | session (opus) | dummy-data policy (CLAUDE.md + dummy.md) | Ratify: no dummies unless unavoidable; when unavoidable → track in `docs/dummy.md`. Resolves the previously-open "test fixture" question. | APPLIED | user · 2026-07-09 | (this commit) |
| AP-003 | 2026-07-09 | session (opus) | consolidation trio reconciliation (ADR-044) | Handoff = stable brief; Execution Plan tracks execute only behind discovery+safety gates; discovery gate now PASSES (paths exist as of 2026-07-09). | APPLIED | user · 2026-07-09 | (this commit) |
