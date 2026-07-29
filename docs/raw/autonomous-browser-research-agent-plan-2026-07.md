---
title: Autonomous Background Browser Research Agent — plan
type: raw
doc_kind: plan
status: draft
companions: [learning-agent-roadmap-2026-07.md, desktop-companion-agent-roadmap-2026-07.md]
related_wiki: desktop-companion.md
updated: 2026-07-29
tags: [desktop, agent, browser, research, automation, background]
---

# Autonomous background browser research agent

User directive (2026-07-29, after TASK-027 companion validation): *"Next task is to get control, open
browser and do some research in the backend. I need this to be a multiple step model in the
background doing complex tasks."*

The companion (TASK-027) can now see the screen and point at it. This plan is the next step:
Bridge **acts** — drives a real browser through a multi-step research objective on its own, in the
background, and comes back with cited findings.

## 1. What already exists (build on, do not rebuild)

| Asset | State | Reuse |
|---|---|---|
| `SearchProvider` port + anonymous Parallel Search MCP (TASK-023, done) | Tier-1 keyless web search with citations, quarantine + `untrusted_external` tainting | The RESEARCH lane's default. A browser is only needed when search cannot reach the content. |
| `@bridge/net-guard` | Egress allowlisting/validation | Every browser navigation goes through it |
| Agent / Skill / child-Run orchestration (TASK-007, done) | Agents own Skills, Automations start Agent Runs, Runs are inspectable | The agent loop IS a Run; steps are child Runs |
| Proposal → Decision → Run → Result (TASK-026) | Inline approval lifecycle | How a background agent asks before anything irreversible |
| `ModelProvider` router with tiering (TASK-022) | cheap/default/reasoning tiers, Local-Plane default | Step planning on cheap tier, synthesis on reasoning tier |
| Companion capture + annotate (TASK-027) | On-demand screenshot, typed marks, Set-of-Mark grid locator | The same grid locator resolves "which element" for browser clicks |
| `docs/raw/learning-agent-roadmap-2026-07.md` §3.3 | Injection defense, declared load-bearing | Mandatory: fetched page text is hostile input |

**Not adopted from the clicky family**: none of the four repos does autonomous control — clicky
points and narrates, the user always acts. This capability is Bridge's own, so its safety design
cannot be inherited and must be built deliberately.

## 2. Shape

A **Research Run**: one objective, decomposed into steps, executed in a dedicated browser context,
producing a cited brief. Every step is an inspectable child Run.

```
objective (user, explicit)
  └─ plan step list (cheap tier)            ← revisable between steps, not a fixed script
       └─ for each step, choose ONE tool:
            search(query)        → SearchProvider (Tier-1, keyless, cited)
            open(url)            → net-guard validated navigation
            read()               → extract page text (quarantined, untrusted_external)
            find(description)    → Set-of-Mark grid locator over a page screenshot
            click(ref) / type(ref, text)  → GATED: proposal required (see §3)
            note(finding, source)→ append to the Run's evidence ledger
       └─ observe → decide continue / replan / stop (bounded)
  └─ synthesis (reasoning tier) → Result with per-claim citations
```

Bounded by construction: max steps, max wall clock, max pages, max egress bytes. Exhausting a bound
ends the Run with partial findings and an honest `stopped_at_bound` reason — never a silent loop.

## 3. Authority model (the load-bearing part)

Reading the public web is not the same act as pressing a button on a logged-in page.

- **Green — autonomous**: search, open a public URL, read, screenshot the browser view, note.
- **Amber — proposal required** (authorized 2026-07-29, AP-088): any click, any typing, any form, any navigation to an origin
  carrying the user's session/cookies. Emits a Proposal; the Run parks until a Decision. This reuses
  the existing inline Proposal → Decision → Run → Result surface, so a background agent's request
  appears in the same place every other governed action does.
- **Red — never**: credentials, payment, purchases, account settings, posting/sending anything,
  CAPTCHA solving, and any page Privacy Guard flags. Refused with a typed error, not proposed.

The agent runs in its OWN browser profile with no imported cookies by default, so "logged-in page"
is an explicit, visible escalation rather than an accident.

**Injection defense** (learning-agent-roadmap §3.3, non-negotiable): page text is data. It is
quarantined, tagged `untrusted_external`, and never concatenated into the planner's instruction
channel — it enters as clearly-fenced observations. Instructions found inside a page are reported to
the user, never executed. A page that asks the agent to visit another site, reveal context, or take
an action is evidence of an injection attempt and ends the step.

## 4. Browser choice

Three candidates, in preference order:

1. **Headless Chromium via CDP, spawned as a managed sidecar** — same supervision pattern as
   `model_supervisor` (pinned revision, health probe, lease, graceful kill). Real pages, real JS,
   no dependency on the user's browser or their logged-in state. Heaviest artifact.
2. **A Tauri webview window** — zero new binaries, but a webview is a poor automation target
   (no CDP, awkward interception) and shares the app's process.
3. **The user's own browser via extension** — TASK-020's deferred Browser Companion. Best for
   "research inside my session", worst for autonomy and safety; needs the permission-bounded
   extension TASK-020 already scopes.

**Decision 2026-07-29 (AP-089 proposed): start with (2), defer (1).** A bundled engine costs
~150-200 MB on a ~349 MB bundle, makes every Chromium security release Bridge's patching duty, and
grows the signing/notarization surface that already blocks TASK-018 — for a benefit (byte-identical
engine everywhere) the prototype has not yet been shown to need. BR1 therefore reads pages through
the webview Bridge already embeds, with plain HTTP + HTML-to-text as the cheap path for static
pages. A bundled engine is revisited only against recorded evidence of pages the webview cannot
handle; (3) remains TASK-020's in-session lane.

## 5. Surfaces

- **Start**: the companion ask panel gains "Research this" — the same overlay the user already
  summons; a Research Run is a background sibling of a normal ask.
- **Watch**: a Run detail Page showing the step timeline, each step's tool, evidence, and taint.
- **Interrupt**: pause/stop/replan from that Page; the Avatar shows `working` and blinks per capture.
- **Result**: a brief with per-claim citations, plus the raw evidence ledger, retained as
  Module-associated Memory.

## 6. Phases

| Phase | Deliverable | Exit test |
|---|---|---|
| BR0 | Bounded step loop over the EXISTING SearchProvider only — no browser | An objective produces a cited brief through ≥3 planned steps, inspectable as child Runs, stopping at its bound |
| BR1 | `open`/`read` through the EXISTING Tauri webview (no bundled binary) + net-guard + quarantine, with plain HTTP + HTML-to-text for static pages | The agent reads a page search alone could not answer, evidence tagged `untrusted_external` |
| BR2 | `find` via the Set-of-Mark locator over page screenshots | The agent locates a named element on a real page and reports its position |
| BR3 | Amber gate: `click`/`type` behind Proposal → Decision (authority granted, AP-088) | A click executes ONLY after an approved Proposal; veto leaves no Event |
| BR4 | Background execution, interruption, restart recovery | A Run survives app restart and resumes or fails honestly |
| BR5 | Injection-defense regression suite | A page instructing the agent to exfiltrate or navigate away is reported, not obeyed |

BR0 delivers value with zero new binaries and no new authority — it is the honest first slice.

## 7. Risks

- **Autonomy without authority is the whole risk surface.** Every irreversible action must be a
  Proposal; if in doubt, propose.
- **Injection is expected, not hypothetical** — the agent reads adversarial text by design.
- **Cost/rate limits**: a multi-step Run multiplies model calls; step planning stays on the cheap
  tier and page text is summarised before it enters context.
- **Silent looping**: bounds are mandatory, and every stop reason is recorded.
- **Local Plane**: a Research Run reads the PUBLIC web. It must never send the user's private
  Memory, Records, or screen into a page or a cloud planner without the same explicit consent the
  companion ask requires.
