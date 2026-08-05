---
title: Bug-ledger pattern audit and corrective measures
type: raw
doc_kind: audit
status: draft
companions: [../wiki/resilience.md, capability-surface-taxonomy-2026-08.md]
related_wiki: resilience.md
updated: 2026-08-05
tags: [bugs, ci, deployment, governance, corrective-measures]
---

# Bug-ledger pattern audit — 2026-08-05

Full-ledger audit of `docs/BUGS.md` (242 entries, 2026-07-04 → 2026-08-04), plus
`docs/dummy.md` and the bug evidence cited from `docs/TASKS.md`.

## 1. Totals

| Metric | Count |
|---|---|
| Entries | 242 |
| Resolved with date | 181 (~75%) |
| Open | 56 (~23%) |
| In progress | 3 |

22 of the 56 open items are the 2026-07-04 → 07-09 security tail. `docs/dummy.md`
separately tracks 20 open fixture-debt entries.

## 2. Root-cause clusters

Ordered by whether they are still producing new entries.

### Still live

| Cluster | Count | Character |
|---|---|---|
| **Success-shaped failure** | ~26 | A layer returns a plausible success while doing nothing. A 500-message sync synced nothing and reported "up to date"; `list_contacts` returned `[]` on an 8,384-contact account; the desktop shell loaded a *different project's* app for a whole session. |
| **CI blind spots** | ~24 | Gates outside the shared task graph, stale compiled `dist`, coverage floors mis-calibrated, tests passing against unbuilt output. |
| **Deploy divergence** | ~22 | Fixed in main, not published. Both Render services are `autoDeploy: false`. |
| **Vocabulary drift** | ~17 | Retired names re-entering code faster than the gate is run. |
| **Docs asserting absent behaviour** | ~11 | Canon describes something the code does not implement. |

### Stopped (structurally closed)

Auth/IDOR (~21, none new since 07-22), TOCTOU/idempotency (~19), RLS scope leaks
(~16), in-memory stores losing state (~13). The mid-July governance work genuinely
ended these as *new-bug* sources — worth recording as evidence that structural fixes
work, versus process reminders, which did not.

## 3. Repeat offenders

| Class | Times |
|---|---|
| Hosted-prototype reliability (user-reported) | 4+ |
| Intelligence / capability-inventory surface | 4 |
| Retired-vocabulary gate red on main | 3+ |
| Coverage-floor false alarms | 3 |
| Same web typecheck union bug filed twice | 2 |
| JobPilot tsconfig project reference | 2 |

## 4. Detection source

| Source | Share |
|---|---|
| Internal review rounds | ~45% |
| Audits / code-absence greps | ~20% |
| CI / tests | ~14% |
| Live certification runs | ~12% |
| **The user, in the running product** | **~9%** |

The user's ~9% is concentrated in exactly the categories with no automated observer:
hosted reliability, navigation correctness, desktop physicality, and "what is actually
on screen". Nothing in `ci.yml` rendered a page, hit the deployed origin, or compared
deployed SHA to main.

## 5. Corrective measures — implemented 2026-08-05

| # | Measure | Where | Cluster closed |
|---|---|---|---|
| 1 | `pnpm verify` — one gate list, called by both CI and humans | `platform/package.json`, `.github/workflows/ci.yml` | CI blind spots |
| 2 | Total procedure classification: every tRPC procedure must be explicitly allowed or explicitly denied-with-reason; unclassified fails the build | `apps/api/src/deployment-boundary.ts`, `apps/api/test/procedure-classification.test.ts` | Deny-by-default silence (AP-082/AP-085) |
| 3 | Deploy-drift watchdog comparing each Render service's live commit to `origin/main` | `platform/scripts/check-deploy-drift.mjs` | Deploy divergence |
| 4 | Negative-control, prove-what-rendered, and verification-parity rules | `CLAUDE.md` | Success-shaped failure |
| 5 | Taxonomy decision rules, with canon-vs-code conflicts recorded rather than papered over | `capability-surface-taxonomy-2026-08.md` | Docs asserting absent behaviour |

### On measure 2 — the asymmetry that matters

Denial may be granted by namespace prefix; permission is **exact-path only**. A new
procedure in an already-closed namespace inherits the closure (safe, and nearly always
right). A new procedure in an already-open namespace matches nothing and lands as
`unclassified`, failing the build. The direction that could leak data cannot be
automatic.

Applying the gate immediately found **12 unclassified procedures**, including three
credential-bearing DealPilot surfaces (`accessCredential`, `clearCredential`,
`reauthenticateCredential`). All twelve were correctly closed — but none of them was
*stated* to be closed, which is precisely the condition that produced AP-082/AP-085.

## 6. Not yet done — deliberately

- **Post-deploy canary** (sign in, walk the left nav, assert no `PRECONDITION_FAILED`).
  The highest-value remaining item; needs a deploy credential and a decision about
  running authenticated checks against production.
- **Pre-commit vocabulary hook.** `pnpm verify` now runs the gate, but nothing forces it
  before a commit. A hook is a per-developer environment change and needs agreement.
- **Nav-contract test** (every left-nav entry resolves to a route that renders the
  entity kinds its subtitle claims). Closes the "its own subtitle lies" defect class.
- **Deleting the dead `prototype` CI job.** It has been failing since 2026-07-26 for
  environmental reasons; a permanently-red job teaches everyone to ignore red. Removal
  is a CI-surface decision, so it is proposed rather than taken.
