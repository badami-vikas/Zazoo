# Deliverable 2 — recon-capability planning from a mere problem statement plus bounding inputs

## How the earlier D1/D2 test differed from what was actually asked

The earlier test (this session, prior turn) gave one variant the full six-layer pack and graded
both against Recon-as-a-whole, using a problem statement I had already written to require
misattribution/rights/erasure handling — not a "mere" problem statement. It never isolated a
GAP SET specific to what the Learning Agent lacks, and no variant received *only* a problem
statement plus harness/budget with everything else withheld. This run fixes both: a fresh agent
(D3) got nothing but the problem statement, the H1–H9 harness, and the mandatory budget envelope
— no constitution, no kernel contracts, no method layer, no installed-capability inventory — and
is graded specifically against the seven-item gap set below, not against Recon in full.

## Step 1 — the gap set (evidence-based)

| ID | Gap | Evidence it's missing from the platform |
|---|---|---|
| G1 | Multi-source **enricher registry** (pluggable per-source units) | LA3's research lane has exactly one search vendor tier behind `SearchProvider`; no registry/orchestration code found anywhere under `platform/packages` |
| G2 | External **primary-record source adapters** (Wikidata/OpenAlex/EDGAR/Crossref-class) | Zero matches for `wikidata\|openalex\|edgar\|crossref` in `platform/packages` |
| G3 | **Draft-then-approve staging** tier distinct from accept/reject, with a merge threshold that scales with platform size | `MemoryStore` is single-step suggested-then-accepted; `platform/packages/db/src/schema.ts` carries `enrichmentSource`/`lastEnrichedAt`/`enrichmentConfidence` columns explicitly commented "Recon enrichment state" — the schema anticipated Recon integration and no pipeline was ever built to populate it |
| G4 | Person-identity **match-tier pipeline wired into research** | `@bridge/dedupe` has the right vocabulary (`strong\|moderate\|flag\|none`) but nothing in `research`/`core/learning` calls it |
| G5 | **Modeled estimators** with confidence tiers (revenue/salary Tier A/B/C) | Zero matches outside unrelated JobPilot fields |
| G6 | **Browser-extension capture** for content search can't reach | Platform's only "capture" (`sensors/capture-ledger.ts`) is *behavioral/screen* capture of the user's own activity — a different concept |
| G7 | **Self-pacing enrichment scheduler/daemon** (un-enriched-first, dry-run inspect, launchd) | Zero matches; LA3 Runs are triggered per-objective, not a background backlog sweep |

## Step 2 — the minimal-boundary test

A fresh, isolated agent received exactly: the problem statement, the H1–H9 harness, and the
mandatory budget-envelope requirement. Nothing else — explicitly told it had no constitution, no
interface list, no capability inventory, and to name what it wanted if it needed any of that.
Full output: subagent transcript (not separately filed; graded below).

## Step 3 — grading against the gap set

| Gap | Verdict | Basis |
|---|---|---|
| G1 enricher registry | **MISSED** | Its "Source Gateway" (C3) is a single generic egress choke point with no per-source pluggable registry or enrichment-key concept. |
| G2 primary-record adapters | **MISSED** | No source is named at all — "5 sources average" is a placeholder, not an adapter list. |
| G3 staging tier | **PARTIALLY COVERED** | Its ephemeral-claims-until-acceptance model is the same shape as staging, but there is no bulk promote/discard and no threshold that scales with platform size — a simpler, single-claim-at-a-time version. |
| G4 match-tier pipeline | **COVERED — arguably better** | Its Candidate Resolver (C2) uses a hard auto-bind threshold plus an "ambiguous band" that escalates to a stronger model tier only on that recorded trigger. This is architecturally equivalent to Recon's match tiers and structurally similar to the calibrated-probability refusal band from the earlier full-pack test — reached independently, with no access to either. |
| G5 modeled estimators | **NOT APPLICABLE** | The problem statement given (a person brief) never asked for revenue/salary estimation — this is Recon scope the stated problem doesn't cover, not a missed requirement. Excluding it from the verdict tally. |
| G6 browser-extension capture | **MISSED** | No mention; its only fetch path is server-side (C3). |
| G7 scheduler/daemon | **MISSED, largely N/A** | Not mentioned. The stated problem is an on-demand per-meeting brief, not a bulk backlog sweep — closer to not-applicable than to a true miss, but noted since Recon treats it as core. |

**Score against the six in-scope gaps: 1 covered, 1 partial, 4 missed.**

Per the standing rule (adopt divergence on merit, never force-fit): G4's design — hard threshold
plus a recorded-trigger escalation band, with auto-bind never reachable except through that
threshold — is adoptable as-is; it independently reproduces the best idea from the earlier
full-pack test without having seen it.

## Step 4 — what the minimal-boundary variant lost relative to the six-layer pack

**The decisive loss is the same failure mode as the very first test, now sharper.** Its own
closing section says almost verbatim what the constitution-only-invariant-8 plan said in the
first experiment: it assumed greenfield because it had no installed-capability inventory, and its
"needed but not given" list explicitly asks for one. Because it *also* lacked kernel contracts
this time, the effect compounds — it reinvented `MemoryStore`, the Proposal-acceptance pattern,
and taint-as-a-column from scratch under different names (`person_fact`, `C7 Acceptance Gate`,
`taint_label` column) rather than citing or reusing the platform's real ones. **This is the
concrete cost of G1/G2/G3/G6/G7 being missed**: none of the missing capabilities exist anywhere
for a no-context agent to discover on its own — a registry, a source adapter, a staging tier, or a
scheduler is not something a capable model invents unprompted when told nothing about what
already exists or should exist. The harness told it *how the output must behave*; it said nothing
about *what shape of system produces that behavior*, so multi-source orchestration — the actual
core of what Recon does — never appeared.

**Two things were retained despite the missing layers, and are worth separating from the above:**

1. **Self-imposed process hygiene.** Without Layer M (method) being given at all, the plan still
   produced per-phase exit evidence, a phased/shippable roadmap, and specific test mechanisms
   (a mutation test for taint-label loss, an end-to-end deletion-then-requery proof). A capable
   model supplies ordinary engineering discipline unprompted. What it does *not* supply unprompted
   is the one M-layer obligation that matters most: **it never ran a reuse intake and explicitly
   flagged that it couldn't.** That is the one obligation the earlier experiment showed must be
   stated explicitly rather than left implicit — confirmed again here.
2. **A genuinely strong H3 mechanism.** "A dependency/import scan in CI fails the build if any
   file in this capability imports a messaging/posting/payment client" is a more concrete,
   directly implementable version of the "structural port-set allowlist" idea adopted in ADR-176,
   arrived at from harness obligations alone. Worth folding into the TASK-043 E1 implementation
   as the literal mechanism (import-graph static analysis) rather than leaving it abstract.

**Bottom line on the user's boundary-conditions hypothesis:** strong boundary conditions
(harness + budget) alone reliably produce *safety-conformant* architecture — the same result the
earlier harness-only test (Pack C) showed for the Learning Agent. They do not reliably produce
*capability-complete* architecture when the missing capability is one the agent has no way to
know should exist. The kernel-contracts-plus-installed-capability-registry layer is not optional
scaffolding; it is the layer that turns "safe" into "actually does the job Recon does." Method
(M1, reuse intake specifically) is not optional either — both times it was absent, the plan
explicitly deferred exactly the step that would have closed most of these gaps.
