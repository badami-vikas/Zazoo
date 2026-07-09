---
title: Spec — Virtual Office (Brief)
type: raw
doc_kind: design
status: draft
companions: []
related_wiki: ../wiki/roadmap.md
updated: 2026-07-09
tags: [virtual-office, capability-package, p5, p6, ambient]
---

# Virtual Office — Brief Spec

## What it is

An optional capability package providing a Termi-like persistent virtual presence experience — a shared ambient space for co-working, status visibility, and brief async check-ins.

The Virtual Office is a compiled workspace surface, not a kernel primitive. It is packaged and installed like any other capability package.

## Phase target

P5 / P6. Not blocking any work before then. Do not design around it in earlier phases.

## Rough shape

- Persistent "room" view: shows who on the team is present / active.
- Ambient audio/video presence (optional, user-controlled, never on by default).
- Integrates with the Knowledge graph: presence events become Touchpoints where relevant.
- Governed: joining / leaving is a captured event, inspectable in the Memory ledger.

## Decision pending

Full design is deferred. This entry exists to capture the intent and prevent re-invention. Revisit at P4 planning.
