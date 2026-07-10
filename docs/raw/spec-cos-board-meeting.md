---
title: Spec — Chief of Staff Weekly Board Meeting Ritual (P3)
type: raw
doc_kind: design
status: draft
companions:
  - spec-dream-cycle.md
  - rituals-engine-research.md
related_wiki: ../wiki/rituals.md
updated: 2026-07-09
tags: [ritual, chief-of-staff, weekly, reflection, p3, governance]
---

# Chief of Staff Weekly "Board Meeting" — Ritual Spec

## Overview

A named weekly ritual run by the Chief of Staff agent. It synthesises the past week's system activity into a brief, actionable summary and proposes it for the user's review. The name "board meeting" is internal — it may surface in the UI as "Weekly review" or "Your weekly briefing" (copy TBD).

## Phase target

P3. Not a day-1 feature. Requires the Chief of Staff agent, the Hatchet ritual engine, and the governed-proposal pipeline to be in place.

---

## Schedule

- Frequency: once per week.
- Default window: Monday 07:00–09:00 local time (configurable via `policy_params`).
- Implemented as a Ritual in the Hatchet engine (same infrastructure as the Dream Cycle).

---

## What it reviews

The ritual pulls data from the ledger and capability state tables. It reviews four areas:

### 1. Completed capabilities vs. proposed ones

- Counts capabilities that were proposed during the week and reached `Active` or `Trusted` state.
- Counts capabilities that are still in `Draft` or `Validated` (proposed but not yet activated).
- Computes a completion ratio and flags any proposals that have been in `Draft` for > 14 days without progressing.

### 2. Capability evolution signals

- Lists capabilities that moved state (promoted, demoted, deprecated, archived) during the week.
- Notes auto-activation budget consumption (how many Informational / Advisory auto-activations fired vs. the daily budget limit).
- Flags any capability that fired `auto-SUSPEND` during the week.

### 3. Workflow friction points

- Reviews the ledger for workflows (Rituals / Automations) that errored, timed out, or were manually halted during the week.
- Groups by capability / workflow name.
- Surfaces top-3 friction points by frequency.

### 4. Open approvals past SLA

- Lists Approval items (proposals in `pending_review`) that have been open for more than the SLA threshold (default: 48 hours for Advisory, 24 hours for Operational/External — all configurable via `policy_params`).
- Groups by risk band.
- Flags any External-band items past SLA as P1 (requires immediate user attention).

---

## Output

The ritual produces a **summary proposal**: a structured document in Markdown, proposed as a Memory entry of kind `weekly_board_meeting`.

The proposal:
- Is created as a governed draft (Advisory risk band — it is a summary of system state, not an action).
- Shows up in Approvals as "Approve this week's board meeting summary."
- On approval → becomes a Memory entry in the user's knowledge graph, tagged by week number.
- On veto → discarded (no Memory entry created).
- If the user takes no action within 7 days → auto-archives (no re-proposal).

The summary proposal body contains:
1. One-paragraph narrative summary written by the Chief of Staff agent.
2. Three sections matching the four review areas above (capabilities, evolution signals, friction, SLA).
3. A "recommended actions" list (maximum 5 items, each as a proposed next step the user can accept or dismiss).

---

## Audit

Each run produces a `Ritual` ledger entry (`kind: "cos_board_meeting"`) with status and summary statistics. The entry is inspectable in the Memory ledger and linked from the summary proposal if approved.

---

## Failure handling

If the ritual errors mid-run, it logs the failure and re-attempts once (4 hours later). If the second attempt also fails, it skips the week and notifies the user via Chief of Staff's next chat turn.
