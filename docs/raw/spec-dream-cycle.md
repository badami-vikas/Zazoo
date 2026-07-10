---
title: Spec — Dream Cycle (Nightly Ritual)
type: raw
doc_kind: design
status: draft
companions:
  - rituals-engine-research.md
related_wiki: ../wiki/rituals.md
updated: 2026-07-09
tags: [ritual, nightly, maintenance, memory, governance, hatchet]
---

# Dream Cycle — Nightly Ritual Spec

## Overview

The Dream Cycle is a named nightly system ritual. It is not exposed to users as a cron job or scheduler UI entry. From the user's perspective it is a named recurring event ("Bridge dreamed last night") surfaced only in the audit trail and in Chief of Staff's weekly reflection (see `spec-cos-board-meeting.md`).

---

## Scheduling

- Frequency: once per night, default window 2:00–4:00 local time (configurable via `policy_params`).
- Implemented as a **Ritual** in the Hatchet engine, following the `RitualExecutor` patterns.
- The ritual definition is a built-in (kernel-level), not a user-created workflow.
- It is non-deletable and non-pausable by default; users may defer it by up to 24 hours via a governed proposal.

---

## Operations

All operations below are executed as part of the nightly run. Where risk level demands it (Advisory or above per the Capability Trust Model), each operation produces a **governed proposal** rather than executing immediately. The user sees the result in Approvals the next morning.

### 1. Deduplicate

- Runs `@bridge/dedupe`'s `matchOne` against new Memory entries created since the last Dream Cycle.
- **Strong matches** (name + one corroborating data point): generates a merge proposal queued in Approvals.
- **Moderate matches**: generates a `possible_duplicate` Signal for the user to review.
- No auto-merge. Ambiguous duplicates are always Signals, never auto-resolved. (See `docs/MEMORY.md: Ambiguous duplicates as signals`.)

### 2. Link repair

- Traverses foreign-key references in the graph for entries modified since the last run.
- Finds broken or dangling edges (e.g. a Touchpoint whose `person_id` no longer resolves to a canonical person).
- Generates a repair proposal for each broken edge; does not mutate the graph directly.

### 3. Enrich

- For Memory entries that have been active for >= 7 days and have not been enriched recently, queues enrichment via the Learning Agent's egress-capable research path.
- Enrichment requests go through the `external:fetch` pipeline gate (governed proposal for each source).
- Enrichment results are proposed as Memory updates, not applied directly.

### 4. Merge-conflict resolve

- Detects Memory entries where two sources have written conflicting values for the same field (e.g. two integrations disagree on a person's job title).
- Produces a **conflict Signal** for each case, surfaced in Approvals.
- Does not pick a winner without human input (or explicit user-configured auto-resolution policy).

### 5. Summary refresh

- Regenerates cached summaries (e.g. relationship summaries, Initiative status blurbs) for entities that have received new Touchpoints or Memories since the last run.
- Summary refresh is Advisory risk; auto-activated within the daily Advisory budget.
- Stale summaries older than 30 days are flagged in the next Chief of Staff board meeting.

---

## Audit

Every Dream Cycle run produces a single `Ritual` audit entry in the ledger:
- `kind: "dream_cycle"`, `status: "completed" | "partial" | "failed"`
- Per-operation sub-entries with counts (dedupe candidates, repair proposals, enrichment queues, conflicts surfaced, summaries refreshed).
- Run duration.

The audit entry is inspectable via the Memory ledger and surfaced in the Chief of Staff weekly board meeting.

---

## Failure handling

- If a single operation fails, the ritual continues with the remaining operations and flags the failed step in the audit entry.
- A fully failed Dream Cycle (all operations error) suspends the ritual for the night and queues a `blocked_by_policy` / `error` state notification via the Chief of Staff.
- Three consecutive failed nights → the ritual auto-suspends and creates an Approval item for the user to review before re-enabling.
