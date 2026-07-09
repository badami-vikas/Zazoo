---
title: Spec — Fork / "Request Egg from Spirit Animal" Metaphor
type: raw
doc_kind: design
status: draft
companions:
  - spec-avatar.md
related_wiki: ../wiki/vision.md
updated: 2026-07-09
tags: [fork, workspace, spirit-animal, avatar, p5, metaphor]
---

# Fork Metaphor — "Request Egg from Spirit Animal"

## Concept

When a user wants to fork their workspace (create a new projection of the graph with a different compiled workspace / blueprint), the UI metaphor is:

> "Request an egg from your spirit animal."

The spirit animal (the user's avatar) produces a new egg. The egg goes through its own hatch ceremony (same onboarding flow, lighter variant) and becomes a separate avatar for the forked workspace.

## User trigger

- Accessible from the avatar click menu (long-press or secondary action on the avatar).
- Label: "Request an egg" or equivalent. Not exposed as "Fork workspace" in v1 UI (the underlying concept, not the metaphor, is for documentation and architecture).

## What happens

1. User clicks avatar → "Request an egg" option.
2. A forked workspace shell is created (see `docs/wiki/vision.md` — Fork verb: "egg-spawn = new projection + new avatar").
3. The new workspace gets its own avatar (egg stage), its own blueprint compilation flow, and inherits the graph (no partitioning — one graph, multiple projections).
4. The forked workspace name is derived by the workspace naming rule (see `spec-workspace-naming.md`) unless the user supplies a name during the fork flow.
5. The fork is a governed proposal (Transformational risk band): it creates a new workspace object, which requires user confirmation.

## Phase target

P5 Fork / Compose / Publish phase. The metaphor vocabulary may be introduced in the UI earlier (P3/P4) as a placeholder affordance; the underlying fork capability ships at P5.

## Compose

Multiple workspaces coexist like VS Code extensions — capabilities compose without auto-merge. If a responsibility conflict arises between two workspaces, Chief of Staff surfaces it as an explicit question.

## Design note

The egg metaphor is intentional personalisation. It should feel earned, not whimsical: the user already has a mature spirit animal by the time they can fork (requires stage = Mature, i.e. >= 100 Memory entries and >= 3 installed capabilities per `spec-avatar.md` thresholds).
