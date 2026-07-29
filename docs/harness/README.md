---
title: Harness research folder — index
type: raw
doc_kind: index
status: draft
companions: [comparative-analysis.md, primitives.md, learnings-and-next-steps.md]
related_wiki: harness.md
updated: 2026-07-29
tags: [harness, engine, index]
---

# docs/harness/

Harness architecture research: the **Bridge Engine** measured against 20 external agent harnesses
and orchestrators, plus the academic and practitioner literature on harness design.

Research date **2026-07-29**. Status is `draft` — the recommendations are proposals, not canon,
until the matching [APPROVALS](../APPROVALS.md) row is flipped.

| Document | What it answers |
|---|---|
| [comparative-analysis.md](comparative-analysis.md) | How does the Bridge Engine compare to pi.dev, Claude Code, Codex, Cursor, Devin, opencode, OpenClaw, CrewAI, AutoGen, AG2, Microsoft Agent Framework, OpenAI Agents SDK, AgentKit, Google ADK, LangGraph, Temporal, Hatchet, Mastra, n8n, Relay.app, Zapier Agents, and Lindy? |
| [primitives.md](primitives.md) | For every Engine primitive: what is it, where does it live, what actually exists today, and what should change? Includes a consolidated priority roadmap and the doc-versus-code corrections found while verifying. |
| [learnings-and-next-steps.md](learnings-and-next-steps.md) | What does the evidence establish, where does it confirm or challenge Bridge's canon, and what should we do next? |

## Read in this order

1. **learnings-and-next-steps.md** if you want the conclusions and the recommended work.
2. **primitives.md** if you want the state of our own Engine, with `file:line` evidence.
3. **comparative-analysis.md** if you want the external landscape and vocabulary discipline.

## Scope

These documents cover the **Bridge Engine as a product harness** — the runtime that lets Agents
plan, decide, execute, and be governed. The repository's own `.claude/` development harness is a
separate artifact and is out of scope; see [config-alignment](../wiki/config-alignment.md) for that.

## Conventions

- Bridge terms follow [glossary.md](../glossary.md) exactly. Where code and canon disagree, the
  divergence is recorded rather than silently resolved — see [primitives.md §I](primitives.md).
- External terms are quoted in each platform's own vocabulary. Vocabulary collision is a finding, not
  an inconvenience — see [comparative-analysis.md §6](comparative-analysis.md).
- Evidence is tagged `[empirical]` (a measurement in a cited source) or `[opinion]` (practitioner
  assertion). Where vendor and independent evidence conflict, the independent result is weighted
  higher and the conflict is named.
- Anything marked `UNVERIFIED` was not confirmed against a primary source and must not be treated as
  canon.

## The five things worth knowing if you read nothing else

1. **The harness is a first-order determinant of measured capability** — scaffold choice alone moves
   benchmark accuracy by up to 28 points within a single model, and harness-only changes have
   produced 14–30 point gains with no weight changes.
2. **Bridge's eval harness is built and unfed.** The store is in-memory in both modes and two of
   seven quality axes read an execution snapshot that nothing writes. This is the highest ratio of
   value to remaining work in the Engine.
3. **Bridge has no sandbox at any rung of the isolation ladder**, and no `SandboxProvider` is wired
   into the API at all. This is the largest safety gap, and it gates opening Commons to community
   origins.
4. **Three canon claims are currently untrue**: Runs are documented as replayable (no replay driver),
   Scheduled Automation is defined (no scheduler exists), and `Plan`/`Planner` are in the glossary
   with no implementation.
5. **Bridge's propose→decide→commit split is a real, unstated advantage.** LangGraph's `interrupt()`
   re-runs a node from the top and its own docs warn that side effects duplicate; Bridge runs the
   Skill once, holds the output, and commits only after the Decision.
