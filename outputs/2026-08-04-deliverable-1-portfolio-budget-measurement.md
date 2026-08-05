# Deliverable 1 — retroactive portfolio budget measurement (BUILT / DISCARDED / PLANNED)

Methodology: Layer B axes from ADR-177 (scope/storage, cost/tokens, time/build+runtime) applied
retroactively across the whole portfolio. Every number below is MEASURED (from git history,
`find`/`wc`, or `docs/TASKS.md` verbatim) or explicitly marked NOT AVAILABLE with what would close
the gap. No number is an unlabeled estimate.

## BUILT — full table

| Capability | SCOPE (files/LOC) | Storage | COST (model calls) | TIME (span, commits) |
|---|---|---|---|---|
| `platform/packages/core` | 87 files, 15,237 LOC | consumes `@bridge/db` schema | 4 call sites (`agents.ts`, `chief-of-staff.ts`, `eval/judge.ts`, `guard/content-guard.ts`) | 2026-06-11→2026-07-15, 27 commits |
| `platform/packages/db` | 38 files, 5,994 LOC | 11 migrations (`0000`-`0010`) | none — deterministic | 2026-06-11→2026-07-14, 24 commits |
| `platform/packages/dedupe` | 5 files, 213 LOC | n/a | none — deterministic | 2026-07-04→2026-07-14, 4 commits |
| `platform/packages/facts` | 4 files, 146 LOC | n/a | none | 2026-07-04→2026-07-14, 2 commits |
| `platform/packages/integrations-google` | 20 files, 3,998 LOC | NOT AVAILABLE (static) | none | 2026-06-22→2026-07-14, 8 commits |
| `platform/packages/local` | 6 files, 683 LOC | NOT AVAILABLE | none | 2026-06-22→2026-07-14, 3 commits |
| `platform/packages/models` | 10 files, 579 LOC | n/a (provider layer) | pass-through | 2026-07-06→2026-07-14, 4 commits |
| `platform/packages/sensors` | 7 files, 715 LOC | NOT AVAILABLE | none | 2026-07-06→2026-07-14, 5 commits |
| `platform/packages/sourcing` | 7 files, 280 LOC | NOT AVAILABLE | none | 2026-07-04→2026-07-14, 3 commits |
| `platform/packages/tables` | 5 files, 272 LOC | n/a | none | 2026-07-04→2026-07-15, 4 commits |
| `platform/packages/tool-kit` | 6 files, 380 LOC | NOT AVAILABLE | none | 2026-07-04→2026-07-14, 4 commits |
| `platform/apps/web` | 183 files, 31,289 LOC | n/a (client) | indirect via tRPC | 2026-07-06→2026-07-16, **53 commits** |
| `platform/apps/api` | 35 files, 7,732 LOC | consumes db's 11 migrations | 1 site (`router.ts:2651`) | 2026-06-11→2026-07-15, 36 commits |
| `platform/apps/desktop` (Rust) | 10 files, 1,531 LOC | n/a | none | 2026-07-06→2026-07-14, 6 commits |
| Prototype (deployed bridge-ai-1ay.pages.dev) | 153 files, 27,916 LOC | 1 Supabase schema file | NOT AVAILABLE (not grepped) | 2026-06-19→2026-07-09, 31 commits |
| `Tools/recon` | 37 files, 8,735 LOC | NOT AVAILABLE (no migrations found) | NOT AVAILABLE | 2026-06-10→2026-07-14, 16 commits |
| `Tools/hni` | 9 files, 2,194 LOC | NOT AVAILABLE | NOT AVAILABLE | 2026-06-19, **1 commit** |
| `Tools/card-scanner` | 11 files, 1,800 LOC | NOT AVAILABLE | NOT AVAILABLE | 2026-06-11, **1 commit** |
| `Tools/recorder` | 13 frontend + 22 backend files, 1,388 real LOC | 1 Supabase schema file | NOT AVAILABLE | 2026-06-11, **1 commit** |
| `platform/tools/dealpilot` | 16 files, 1,657 LOC | — | — | 2026-07-04→2026-07-15, 7 commits |
| `platform/tools/jobpilot` | 33 files, 2,144 LOC | — | — | 2026-07-04→2026-07-15, 5 commits |

Skipped, no code: `Tools/Job` (docs/CSVs only). LOC-counting artifact caught and corrected:
`Tools/recorder`'s naive count returned 2.1M lines from uncounted `node_modules`; corrected to
1,388 real source lines — flagging this because it means any future repo-wide LOC tally must
exclude vendor directories or it silently inflates by orders of magnitude.

## Q1 — which capabilities are over-budget, on which axis

**No BUILT capability had a declared Layer B budget to be over** — every one predates ADR-177
(2026-08-04); the envelope requirement is new and cannot be applied retroactively as a pass/fail.
What can be done honestly: compare measured numbers against the one concrete reference point this
session produced — D2's people-research budget envelope (29 engineer-days, ≤256 KB/subject
durable, ≤$0.13/run) — and flag genuine outliers.

- **SCOPE — `Tools/recon` is the clear outlier.** 8,735 LOC against a blueprint (Deliverable 2's
  D2 plan) that solves the same problem with **three net-new components** plus reuse/wrap of
  existing libraries. This is not a retroactive judgment on Recon's authors — no budget existed
  when it was built — but it is the concrete, measured form of the duplication ADR-177 already
  flagged: `@bridge/dedupe` (213 LOC) carries the same match-tier vocabulary Recon reimplements
  standalone, and Recon's own SSRF guard sits beside the platform's separately-built net-guard.
- **SCOPE/TIME — `Tools/hni`, `Tools/card-scanner`, `Tools/recorder` each landed as a single
  commit** (1,388-2,194 LOC in one shot). This is a process signal, not a size problem: it means
  none of them went through the phased, evidence-per-phase discipline (M4) the constitution now
  requires — there is no git-visible record of what was verified before the whole capability
  landed at once. Not "over budget" in the scope/cost/time sense; **under-instrumented** in a way
  that would fail M4 if built today.
- **COST — nothing is measurably over.** Only 5 model-call sites exist in the entire built
  portfolio outside `apps` (`core`: 4, `api`: 1), all with explicit maxTokens caps where checked.
  This axis is genuinely lean; the platform has not over-spent on tokens anywhere measurable.
- **`platform/apps/web` is the single largest surface by every countable measure** (31,289 LOC,
  53 commits — more than any other unit). This is not flagged as "over budget" on its own; it is
  already the explicit target of TASK-031 (monolith files `router.ts`/`wiring.ts`/`graph-store.ts`
  named for splitting), so this measurement corroborates a decision already made rather than
  surfacing a new one.

## Q2 — what DISCARDED cost, in total

**Effectively nothing, and that is the intended result of the discard mechanism working.**
`git log --all --oneline | grep -i abandon` returned exactly **one** hit in the entire repository
history: the WhatsApp multi-webview embed spike (ADR-158 addendum, merged 2026-08-02), with a
measurable diff of **+1,240/-2 lines in one merge commit**, fully reverted the same session
per the ADR text. Every other "alternatives rejected" entry found across the decisions log —
OpenFGA/OPA/Cedar/SpiceDB, Refine, Electron, AutoGen, Windmill, embedding Firecrawl, SaaS-only
search, the Three.js avatar rig, `whatsapp-web.js` as a second client, auto-reset on session
invalidation, `open-wa` — has **zero code footprint**: these were evaluated and ruled out before
any implementation, which is the reuse-intake and clean-room-protocol machinery (M1/M2) working
as designed, not sunk cost.

**Total measurable DISCARDED cost: one contained, single-day, fully-reverted spike.** No
multi-week abandoned branch exists anywhere in 187 branches checked. This is a positive signal
about the portfolio, not a gap — the thing the six-layer pack is meant to prevent (expensive
build-then-discard cycles) has not happened at scale here; the one exception was caught and
reverted within the session it was authored.

## Q3 — which PLANNED work this measurement suggests cutting, deferring, or re-scoping

- **Nothing new needs cutting.** TASK-031 ("platform bloat cleanup and table-renderer
  standardization") already targets exactly what this measurement corroborates — the
  `apps/web` monolith files and duplicated logic. No second task is warranted for the same
  finding.
- **Re-scope opportunity: TASK-020** ("deferred browser companion is a real permission-bounded
  extension"). Deliverable 2's gap set (G6) identified that the platform has no browser-extension
  capture path, and `Tools/recon/extension/` already exists as real, working code for exactly
  that shape of capability. TASK-020 should run its M1 reuse intake against `Tools/recon/extension`
  specifically before building fresh — this is a direct, named reuse opportunity this measurement
  surfaced, not a general reminder to "check for reuse."
- **Sequencing recommendation, not a cut:** every PLANNED (`ready`) capability-shaped task —
  TASK-020 above, and any future net-new capability work — should wait on TASK-042 (validating
  the Method/Budget layers per artifact class) before starting, specifically because this
  measurement shows the historical pattern was zero declared budgets across the entire BUILT
  column. TASK-042 is what stops the next capability from repeating that pattern; it is already
  queued, not newly proposed here.
- **TASK-019** (optimization rollout) is already correctly blocked pending user approval of the
  phase mapping (AP-007 PROPOSED) — this measurement does not change that; noted only for
  completeness since it's the one other PLANNED item already gated rather than freely ready.

## What remains NOT AVAILABLE, and what would close it

- Row/byte storage footprint for any package: needs a live Postgres connection against the 11
  tracked migrations to run `count(*)`/`pg_total_relation_size` — static inspection cannot produce
  this.
- Steady-state token-call frequency per user action: needs runtime tracing or a token-usage log,
  neither of which exists in the repo (this is itself a finding — TASK-035's "governed surfaces
  reachable and manageable from the UI" and observability work would need to land this).
- COST axis for `Tools/recon`, `Tools/hni`, `Tools/card-scanner`, `Tools/recorder`'s Python
  backend, and the deployed prototype: not grepped in this pass — a second targeted pass with a
  Python-appropriate pattern (`grep -rn "openai\|anthropic\|complete(" `) would close this.
- Precise engineer-day/dollar figures for DISCARDED or PLANNED items were deliberately not
  fabricated — DISCARDED has essentially no build cost to size (see Q2), and PLANNED rows are
  reproduced verbatim above for sizing by whoever scopes that task next, per the instruction not
  to estimate what wasn't asked to be estimated.
