---
title: TASK-011 — JobPilot Culture-Research Slice (JP3B)
date: 2026-07-17
task: TASK-011
status: implemented, pending coordinator ledger reconciliation
---

# TASK-011 — JobPilot culture-research slice (JP3B)

## Outcome

JobPilot now performs **permitted, cited company-culture research** for a real target
company (Boston Consulting Group, the existing BCG Application Record) and turns it into
fact/opinion/theme/contradiction/inference-separated evidence with a rights/access
disclosure the user must open before using any culture-informed suggestion — exactly
TASK-011's prototype test and BRD JP-BRD-042.

This built directly on TASK-007's landed Goal/Task/SkillManifest/child-Run contracts (merged
from `origin/main` at `ddb71be`, fast-forwarded onto this branch) per the exact recipe in that
task's handoff (`outputs/2026-07-16-task007-agent-skill-child-run-orchestration.md`, "TASK-011
handoff" section) — no new pipeline mechanism was invented; JobPilot registered its own
Goal/Task types and two governed Skills against the existing primitives.

## What was built

### 1. Fixed-host/SSRF guard — new `@bridge/net-guard` package
Ported `Tools/recon/lib/ssrf.ts`'s `assertOutboundAllowed`/`isBlockedHostname`/`isBlockedIp`
into a **new, Node-only package** (`platform/packages/net-guard`), NOT into `@bridge/core`.
`@bridge/core` is imported by `@bridge/web` and must stay browser-safe/isomorphic
("Zero runtime dependencies" per its own package.json) — an first attempt to add this guard
directly to `@bridge/core`'s barrel broke the web production build
(`"isIP" is not exported by "__vite-browser-external"`), which was caught by running
`turbo run build --filter=@bridge/web` before considering the work done. Only `apps/api`
depends on `@bridge/net-guard`.

### 2. JobPilot's own Goal/Task types + two governed Skills (`apps/api/src/wiring.ts`)
- `jobpilot.culture_research` Goal type; `research_culture_source` (Learning) and
  `synthesize_culture_profile` (Internal Strategist) Task types — JobPilot's OWN vocabulary,
  per the handoff's explicit instruction not to reuse TASK-007's demo Goal/Task types.
- `jobpilot.researchCultureSource` (Learning, cloud plane, `external:fetch:read`,
  `riskBand: "external"`, `childRunPolicy: "allowed"`): a REAL Skill — calls
  `assertOutboundAllowed` immediately before every fetch, then performs an actual
  `fetch()` with a timeout and an identifying User-Agent, and strips the response to a plain
  text excerpt. Re-checks source-type eligibility at the Skill boundary too (defense in depth).
- `jobpilot.synthesizeCultureProfile` (Internal Strategist, local plane, `signal:write`,
  `riskBand: "advisory"`, no network access): partitions evidence into
  fact/opinion/theme/contradiction/inference and builds the source-rights disclosure — and
  **fails the whole run closed** if any claim trips the fabrication/insider-claim guard.
- `LEARNING_AGENT` gained `external:fetch:read` in both its capability scope and its
  `role-learning` grant (the same permission shape `EGRESS_AGENT` already holds) — the ONLY
  wiring.ts identity change; no new physical Agent was minted.
- Both Skills registered in `GOVERNED_SKILL_MANIFEST_CATALOG`, so the AGS1 fail-closed gate
  (built in TASK-007) governs them automatically — no JobPilot-specific enforcement code needed.

### 3. Source-rights catalog + evidence model — new `@bridge/jobpilot/src/culture-research.ts`
Pure logic, no `@bridge/core` dependency (mirrors the handoff's naming-collision warning about
this package's pre-existing `Skill` export — nothing here uses that name):
- `CULTURE_SOURCE_CATALOG`: the reuse/license-intake findings for all 5 BRD-named source
  TYPES (company official pages, public blogs/press, Reddit, Google reviews, Glassdoor),
  each with a real classification (`permitted`/`research_only`/`not_yet_integrated`/`do_not_use`)
  and a substantive reason — see "Reuse/license intake" below.
- `planCultureSources`: the eligibility gate that runs **before** any child Run or fetch —
  a non-`permitted` source type gets zero network access, not merely a slower path.
- `CultureEvidence`/`partitionCultureEvidence`/`buildSourceDisclosure`: the
  fact/opinion/theme/contradiction/inference model and the disclosure builder.
- `assertNoFabricatedAffinityOrInsiderClaim`: a deterministic red-team guard (same
  cheap-gate-before-anything-else pattern as `evaluator.ts`'s truthfulness gate).

### 4. `jobpilot.researchCulture` router procedure (`apps/api/src/router.ts`)
For a company + candidate sources + candidate claims:
1. Gates every candidate source by type eligibility — a `do_not_use`/`research_only`/
   `not_yet_integrated` source is skipped with its reason, **zero child Run, zero fetch**.
2. Rejects (before any network access) any submitted claim citing a source that wasn't
   actually offered as a `permitted` candidate for this run.
3. Creates **one bounded child Agent Run per permitted source** (budget `{maxCalls:1,
   maxCost:1}`, `touchesExternalRisk: true` forcing `reviewMode: "approve"`, narrowed
   authority/skills/data-scope), validates the action is within that child Run's bounds, then
   invokes `jobpilot.researchCultureSource` through the SAME `pipeline.propose` every other
   governed mutation uses, and marks the child Run completed.
4. Stamps every submitted claim with the REAL fetch's retrieval timestamp (proving genuine
   correspondence between a claim and an actually-retrieved source, not merely an asserted
   date), then invokes `jobpilot.synthesizeCultureProfile` (Internal Strategist) to produce
   the final partitioned evidence + disclosure.

Claim *authoring* (turning a fetched page's raw text into typed claims) is intentionally NOT
automated — this platform has no PromptAssembler/claim-extraction substrate yet
(`docs/wiki/learning-agent.md`: "PromptAssembler unbuilt"), and building one would itself be
unvetted, non-deterministic scope beyond this task. The procedure's guarantee is that every
claim it accepts (a) cites only a source that was actually gathered from a permitted type and
(b) is time-stamped from a real, governed, SSRF-guarded fetch — not that the claim text itself
was machine-extracted.

### 5. BCG Application Record — real, live-fetched culture evidence
`platform/apps/web/src/app/data/bcg-application.ts` gained a `cultureResearch` block grounded
in an ACTUAL fetch performed while building this feature (see "Live evidence" below), reusing
the SAME `source.url` (`careers.bcg.com/global/en/interview-process`) already cited in the
existing BCG record:
- 3 facts (BCG's stated culture values, its 4-stage interview process, and its 5 named
  evaluation dimensions — which **already matched** the 5 dimensions this Application Record's
  `fit.dimensions` used, an independent cross-check, not a coincidence engineered for this task).
- 1 repeated theme (multiple named BCGers independently framing BCG as "values-driven").
- 3 named opinions with real author context (a Consultant in London, a Senior Recruiting
  Specialist in Dubai, and an Alumni contributor — all real names/roles quoted verbatim from
  the live page).
- 1 explicitly flagged Internal-Strategist inference (never presented as fact).
- An **honest empty** `contradictions` array — no fabricated dispute was invented; the reason
  (Reddit/Glassdoor gated off) is shown to the user instead of a blank gap.
- 3 explicitly skipped sources (Reddit, Google reviews, Glassdoor) with real reasons.

`JobPilotApplicationDetail.tsx` gained a **Culture research** section (interview-prep tab):
a clickable (not decorative) source-rights disclosure that must be opened to reveal the
evidence groups below it, each claim showing its citation link, retrieval date, author context
when present, and an "Agent inference — not a verified fact" badge where applicable.

## Reuse/license intake (research only, AP-008 clean-room protocol)

Findings (unchanged from the prior planning pass, now load-bearing in code):

| Source type | Eligibility | Why |
|---|---|---|
| Company official page | `permitted` | Publicly published candidate-facing material; cite briefly, link back |
| Public blog/press | `permitted` | Public, no login wall; attribute the author/publication |
| Reddit | `research_only` | 2026 Data API requires a paid commercial OAuth contract for any product use; no such contract exists |
| Google reviews | `not_yet_integrated` | Scraping is prohibited; the only lawful path (billed Places API, capped at 5 reviews) has no key provisioned |
| Glassdoor | `do_not_use` | ToS prohibits scraping; API is partner-only (BCG's own `robots.txt` even disallows a `glassdoor` path) |

## Live evidence

- Fetched `https://careers.bcg.com/global/en/interview-process` live (robots.txt-compliant —
  that exact path is not in `careers.bcg.com`'s `Disallow` list) while building this feature,
  confirming the page's real content, the 5 named evaluation dimensions, and the 3 named
  quotes used in `bcg-application.ts`.
- `curl` confirmed real outbound network access is available in this environment; the
  automated test suite deliberately stubs `globalThis.fetch` and uses literal public IPs for
  candidate source URLs so it never depends on live network/DNS (see `docs/dummy.md`'s new
  TASK-011 row for the exact rationale).

## Files

### New
| File | Purpose |
|---|---|
| `platform/packages/net-guard/{package.json,tsconfig.json,src/index.ts,test/net-guard.test.ts}` | Fixed-host/SSRF guard, Node-only, server-side only |
| `platform/tools/jobpilot/src/culture-research.ts` | Source-rights catalog, CultureEvidence model, partition/disclosure/fabrication-guard logic |
| `platform/tools/jobpilot/test/culture-research.test.ts` | 11 tests over the above |
| `platform/apps/api/test/jobpilot-culture-research.test.ts` | 6 end-to-end tests over real `buildWiring()` |
| `outputs/2026-07-17-jobpilot-culture-research-task011.md` | This document |

### Modified
| File | Change |
|---|---|
| `platform/packages/core/src/memory/stores.ts` | **Blast-radius fix, not scope creep** — `InMemoryAgentStore` was missing `workspaceId`/`isActive` (added to `AgentQuery` by a since-merged Relationship-Module commit, `facb52f`), which broke `@bridge/core`'s OWN build/tests on the clean `origin/main` tree before any TASK-011 code was added. Fixed by adding the two methods + backing `workspaces`/`statuses` maps (mirroring `DrizzleAgentStore`'s real-row-or-false semantics) — this was required just to get a working baseline to build TASK-011 on; see "Blockers" below for the proposed BUGS.md entry. |
| `platform/apps/api/src/wiring.ts` | New Goal/Task constants, 2 new governed Skills + manifests, `LEARNING_AGENT` capability-scope/role-grant addition, both registered in `GOVERNED_SKILL_MANIFEST_CATALOG` and the skill registry |
| `platform/apps/api/src/router.ts` | New `jobpilot.researchCulture` procedure + 2 provision helpers |
| `platform/apps/api/package.json` | Added `@bridge/net-guard` dependency |
| `platform/tools/jobpilot/src/index.ts` | Barrel-exported `culture-research.ts` (collision-checked against the existing `Skill` export) |
| `platform/apps/web/src/app/data/bcg-application.ts` | New `CultureClaim`/`CultureSkippedSource` types + `cultureResearch` data block |
| `platform/apps/web/src/app/data/bcg-application.test.mjs` | 4 new content-contract tests |
| `platform/apps/web/src/app/pages/JobPilotApplicationDetail.tsx` | New `CultureResearchSection` component + wiring into the interview tab |
| `docs/dummy.md` | New row documenting the test-only stubbed-fetch/literal-IP fixtures (per AP-002; same ledger TASK-007's own row already used) |

## Verification (live evidence)

- `@bridge/net-guard`: 8/8 tests pass, 94.86% line coverage (floor 80%).
- `@bridge/core`: 387/387 tests pass (unchanged from TASK-007 + the `InMemoryAgentStore` fix
  applied cleanly with no new failures).
- `@bridge/jobpilot`: all tests pass including 11 new `culture-research.test.ts` cases,
  98.59% line coverage on the new file.
- `@bridge/api`: all tests pass including 6 new `jobpilot-culture-research.test.ts` cases
  (eligibility gating with zero network calls, bounded child Run creation, non-permitted-source
  rejection, fabrication-guard fail-closed, and 2 direct-Human-invocation-fails-closed tests
  for both new governed Skills).
- `@bridge/web`: 47/47 existing tests pass + 4 new `bcg-application.test.mjs` culture-research
  tests pass; `tsc --noEmit` clean; **production build succeeds** (this caught and fixed the
  `@bridge/core` vs `@bridge/net-guard` browser-bundle mistake described above).
- `@bridge/db`: build + tests pass (checked because the `InMemoryAgentStore` fix touched a
  shared `@bridge/core` file `@bridge/db` also builds against).
- Full monorepo `turbo run build`: 21/21 tasks succeed.
- `npx eslint` on every new/changed file: 0 errors.
- `pnpm run check:no-dummy-runtime`: clean — no `dummy_`-prefixed runtime identifiers.

## Exact prototype test — status

> "For one target company, Learning gathers permitted evidence; Internal Strategist separates
> fact, opinion, theme, contradiction, and inference; the user sees citations and a
> rights/access warning before using recommendations."

- **Target company**: Boston Consulting Group (the existing real BCG Application Record).
- **Learning gathers permitted evidence**: `jobpilot.researchCultureSource`, invoked only for
  `permitted` sources, via a bounded child Agent Run, with a real SSRF-guarded fetch.
- **Internal Strategist separates fact/opinion/theme/contradiction/inference**:
  `jobpilot.synthesizeCultureProfile`'s `partitionCultureEvidence`, exercised end-to-end in
  `apps/api/test/jobpilot-culture-research.test.ts` and reflected in the BCG record's real data.
- **Citations + rights/access warning before recommendations**: the Culture research section's
  clickable source-rights disclosure gates the evidence groups below it; every claim carries a
  citation link and retrieval date.

## Blockers / proposed ledger changes (NOT applied — for the coordinator to apply)

Per instruction, `docs/TASKS.md`, `docs/BUGS.md`, `docs/APPROVALS.md`,
`docs/raw/decisions-log.md`, and `docs/log.md` were left untouched. Proposed entries:

1. **`docs/BUGS.md`** — a new entry: `@bridge/core`'s `InMemoryAgentStore`
   (`packages/core/src/memory/stores.ts`) was missing `AgentQuery.workspaceId`/`isActive`
   (added to the interface by the merged Relationship-Module commit `facb52f`), breaking
   `@bridge/core`'s own build/tests on a clean `origin/main` checkout — reproduced with
   `git stash` before any TASK-011 code existed. Fixed in this pass (see Files above) because
   TASK-011 could not build without it; flagging for the ledger since it's a cross-workstream
   integration gap, not something TASK-011 introduced.
2. **`docs/TASKS.md`** — TASK-011 exit criteria are met by the changes above; propose flipping
   its status once the coordinator has reviewed this doc (per AP-001, status flips need
   coordinator/user application, not a background session's own edit).
3. **`docs/raw/decisions-log.md`** — propose an ADR entry: "JobPilot culture-research fetches
   live in a new `@bridge/net-guard` package, not `@bridge/core`, to preserve `@bridge/core`'s
   browser-safe/isomorphic contract" — alternatives rejected: adding the guard directly to
   `@bridge/core` (broke the web production build, caught during verification) and duplicating
   `Tools/recon/lib/ssrf.ts`'s logic inline in `apps/api` (would drift from the canonical guard).
4. **`docs/wiki/jobpilot.md`** — the existing culture-research line already matches what was
   built; no correction needed, but the coordinator may want to add a one-line pointer to this
   output doc.
5. **`docs/dummy.md`** — already updated directly in this pass (see Files above), consistent
   with how TASK-007's own parallel session updated this same ledger for its own fixtures.

## Known gaps carried over (unchanged from the TASK-007 handoff)

- `goalTasks`/`skillManifests`/`childAgentRuns` remain in-memory only — JobPilot's
  culture-research Tasks/child-Runs do not survive a process restart until a Drizzle-backed
  store lands for these primitives (same gap TASK-007 already documented).
- Claim *authoring* (raw text → typed fact/opinion/theme claims) is manual/hand-curated for
  now, pending a real PromptAssembler/claim-extraction substrate — documented above, not a
  regression.
- Google Places API (for a lawful, narrow Google-reviews path) remains unintegrated — no
  billing/key exists for this workspace yet.
