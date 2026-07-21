---
title: ETA searcher onboarding simulation vs. DealPilot — gap analysis
type: raw
doc_kind: audit
status: complete
companions:
  - dealpilot-architecture-requirement.md
  - capability-module-format.md
  - tool-standardization-plan.md
related_wiki: ../wiki/roadmap.md
updated: 2026-07-06
tags: [onboarding, dealpilot, blueprint, simulation, audit, gap-analysis]
---

# ETA searcher onboarding simulation vs. DealPilot

Simulates a real ETA (entrepreneurship-through-acquisition) searcher going through Bridge's
actual onboarding code (`platform/apps/web/src/app/onboarding/questions.ts` +
`platform/packages/core/src/blueprint.ts`), then compares the resulting blueprint against what
DealPilot (`platform/tools/dealpilot/`) actually is. Read-only simulation — no code executed,
traced by hand against the real `nextQuestion`/`buildBlueprintFromAnswers`/`compileBlueprint`
source.

## 1. Persona

Solo, self-funded searcher. Sources small businesses via broker listings (BizBuySell,
BusinessBroker.net) and direct outreach, screens against an investment thesis, moves green
deals through IOI/LOI/diligence, sends investor updates. One person, no team, no analysts.

## 2. Question-by-question trace

Real branching per `nextQuestion(answers)` (questions.ts:119-128), in the exact order the
function returns them:

1. **Q_MODE** — "Are you working solo, or with a team?" → **persona answers: "Just me" (`solo`)**
2. **Q_DOMAIN** — "What's the main kind of work you want Bridge to organize?" (options: Deals/sales
   pipeline, Job search, Customer support/helpdesk, General relationships & networking) →
   **persona answers: "Deals / sales pipeline" (`sales_deals`)** — closest available option; there
   is no "acquisition search" or "M&A" option in the code, "sales pipeline" is the only
   deal-shaped one.
3. Team-size question is **skipped** — `answers.mode === "team"` is false, so `Q_TEAM_SIZE` never
   fires (questions.ts:122).
4. **Q_WATCH_FIRST** — "What should Bridge watch or do first?" (multi-select: track stage/status
   changes, surface signals that need a response, log meetings/calls/emails as touchpoints, keep
   an eye on my calendar) → **persona answers: all four** — a searcher genuinely wants stage
   tracking (sourced→green→LOI→diligence), signals (broker replies, price drops), touchpoint
   logging (broker calls, seller meetings), and calendar (closing dates, call scheduling).
5. **Q_VOCAB** — "What do you call the thing you're tracking? (e.g. 'Deal', 'Candidate', 'Case')"
   (only asked because `domain !== "relationships"`) → **persona answers: "Deal"**
6. **Q_VIEW_STYLE** — "How do you like to see your work — a list, or a board?" →
   **persona answers: "Board (kanban)"** — a searcher wants a triage-stage kanban, not a flat list.
7. **Q_NAME** — "Last thing — what should we call this workspace?" →
   **persona answers: "My Deal Search"**

Total: **6 questions asked** (team_size skipped) — inside the 5-12 band, at the "solo + a domain
needing a vocab override" branch (questions.ts:117 predicts 7 for team+vocab; solo+vocab is 6).

## 3. Blueprint produced (hand-traced through `buildBlueprintFromAnswers`)

```yaml
vocabulary:
  Initiative: "Deal"          # entityDef.label ("Initiative") -> vocab_name ("Deal")
entities:
  - nodeType: initiative        # DOMAIN_ENTITY.sales_deals -> { nodeType: "initiative", label: "Initiative" }
    label: "Initiative"          # (compiled label becomes "Deal" via vocabulary lookup)
    fields:
      - { id: name, label: Name, kind: text }
      - { id: stage, label: Stage, kind: select, options: [new, active, closed] }
        # ^ only present because watch_first includes "track_stage"
views:
  - { entity: initiative, kind: kanban }                # view_style = kanban
  - { entity: signal, kind: table }                     # watch_first includes "surface_signals"
  - { entity: touchpoint, kind: table }                 # watch_first includes "log_touchpoints"
    # (entityDef.nodeType "initiative" !== "touchpoint", so this view is added, not skipped)
capabilities: []                # onboarding never populates capabilities
```

Note: `watch_first` including `"calendar"` has **no effect at all** — `buildBlueprintFromAnswers`
(questions.ts:148-177) never reads that value; it is collected and silently dropped. This is a
real bug/gap, not a design choice — see §5.

### What `compileBlueprint` enforces on this

- `initiative` and `touchpoint` and `signal` must all be in the caller's `registeredNodeTypes`
  list or compilation throws `BlueprintCompileError` (blueprint.ts:201-205). Onboarding assumes
  they're registered; this is an external dependency the onboarding module trusts blindly.
- `initiative`'s view kind `kanban` is allowed (it's not in `relationshipNodeTypes`, so the
  graph/table-only restriction (blueprint.ts:241-245) doesn't apply).
- Compiles to: `tableSpecs` = one `BlueprintTableSpec` for `initiative` with columns
  [name, stage("Stage")], vocabulary-relabeled name unaffected (vocabulary only overrides entity
  **labels**, i.e. "Initiative"→"Deal" on the entity/nav label — field labels like "Stage" pass
  through unchanged since `applyVocabulary` is an exact-match label lookup, not templated).
- `viewConfigs`: 3 entries — `initiative.kanban.0`, `signal.table.0`, `touchpoint.table.0`.
- `navigation`: 3 nav entries — Deal (labelled via vocabulary), Signal, Touchpoint — each carrying
  its `viewIds`.

That's the entire generated workspace: **one entity (Deal/Initiative) with a Name+Stage kanban,
plus generic Signal and Touchpoint list views.** No sourcing, no dedupe, no thesis scoring, no
broker connectors, no documents, no analysis, no investor updates, no credits.

## 4. What DealPilot actually is

Real code in `platform/tools/dealpilot/src/`:

- **Entities/fields** (`table.ts`): `dealsTableSpec` — Deal, Industry (select), Geo (text), SDE
  (number), Revenue (number), Triage (select: green/yellow/red), Thesis Fit (number,
  non-editable, computed).
- **Triage stages**: not a generic `stage` select — a domain-specific `TriageState` = green/
  yellow/red (RYG), computed by `scoreThesisFit` (scoring.ts), not user-set.
- **Views**: `dealsKanbanView()` groups by `triage` (RYG columns), plus (per `dealPilotManifest`)
  the `/dealpilot` route surfaced under nav group "Work".
- **Sourcing/connectors** (`connectors.ts`): real BizBuySell email-alert parser (regex-based,
  parses subject/body for money/location fields, warns on template drift) composed over the
  governed Google Gmail gateway (no tool-owned OAuth); a BusinessBroker.net normalizer (field
  aliasing) with `fetcher` as an injected seam — no live fetch (robots.txt blocks it, tracked in
  known-issues).
- **Pipeline** (`pipeline.ts`): `processDealCandidate` — real waterfall sourcing → per-field
  fact appends with provenance/confidence → `facts.livingProfile()` read-back → dedupe via
  `matchCompany` (company-sourcing package, strong-tier auto-merge) → `scoreThesisFit` against a
  `ThesisProfile` (industries/geo/SDE range/revenue range).
- **Scoring** (`scoring.ts`): deterministic rule score (industry match + geo match + SDE-in-range
  + revenue-in-range, weighted equally) → 0..1 score → green ≥0.75, yellow ≥0.4, else red.
- **Manifest** (`manifest.ts`): external tool, `composes: ["company-sourcing", "people-sourcing",
  "recorder"]`, one capability (`external:fetch` read, public scope, egress:true),
  `intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", accountBoundOnly: true }`.
- **API surface** (`router.ts` `dealpilot` router): `source` (propose an external:fetch capture
  through the governed pipeline), `commit` (materialize a quarantined capture into facts+
  candidates — capture ≠ commit), `captures` (list pending), `getThesis`/`setThesis`, `list`
  (paginated candidates with computed fit).
- **Architecture doc** (`dealpilot-architecture-requirement.md`, aspirational/未-built beyond the
  above): full spine `sources→listings→deals→deal_facts→analyses`, S1-S12 subsystems including
  enrichment waterfall tiers, document pipeline (Docling+Claude extraction with page citations),
  deep-dive analysis engine with add-backs, outreach sequences, Cal.com scheduling, call
  recording, credits/billing, investor-update artifacts, funnel dashboard. **None of this is
  implemented in `platform/tools/dealpilot/` today** — only sourcing (2 connectors), dedupe
  composition, fact-based living profile, and thesis-fit RYG scoring exist as real code.

## 5. Differences table

| # | Onboarding would generate | DealPilot has | Classification | Note |
|---|---|---|---|---|
| 1 | Generic `stage` select (new/active/closed) | Domain `triage` (green/yellow/red), **computed** not user-set | (c) DealPilot feature, correctly out of scope | Onboarding's grammar has no concept of a *derived* field — `fields` are all plain user-editable columns. This is a real blueprint-grammar gap (see #8) as well as package-specific, so it's (b)+(c) combined. |
| 2 | Kanban grouped by nothing in particular (no `groupBy` in onboarding's view spec) | Kanban explicitly `groupBy: "triage"` | (b) blueprint-vocabulary gap | `BlueprintViewSpec.config.groupBy` exists in the grammar (blueprint.ts:112) but `buildBlueprintFromAnswers` never sets it — onboarding doesn't ask "group by what?" and never wires the field it collects (`stage`) into the view's `groupBy`. Easy, high-value onboarding fix. |
| 3 | No Industry/Geo/SDE/Revenue fields | Real typed fields (select/text/number/number) for these | (a) onboarding-agent gap | Onboarding's field list is a hardcoded 1-2 fields (`name`, optionally `stage`) regardless of domain — there is no question that lets a `sales_deals` answerer declare "I track SDE, revenue, industry, geo." This is the single biggest miss: a "deals" domain answer produces a workspace with literally one meaningful column. |
| 4 | No Thesis Fit field/score | `thesisFit` computed number column | (a)+(c) — partly onboarding gap, partly package logic | The *column* is a generic onboarding gap (fields are hardcoded); the *scoring logic itself* (industry/geo/SDE/revenue rule engine) is legitimately DealPilot-specific and should never be onboarding-generated. |
| 5 | No sourcing/connectors | BizBuySell + BusinessBroker.net connectors, waterfall pipeline | (c) DealPilot feature, correctly out of scope | Onboarding's `capabilities: []` is always empty — it never proposes any capability. Connector wiring is inherently package-specific (source URLs, parsers, licensing/robots constraints) and should never be a generic onboarding output. Correct scope boundary. |
| 6 | `watch_first: "calendar"` answer collected but **silently dropped** | N/A — DealPilot doesn't claim a calendar feature either | (a) onboarding-agent bug, not a DealPilot gap | This is a real bug independent of DealPilot: `buildBlueprintFromAnswers` reads `track_stage`, `surface_signals`, `log_touchpoints` but never reads `"calendar"`. The user answers a question whose answer has zero effect on the generated workspace. Should be filed to docs/BUGS.md. |
| 7 | Touchpoint table view (generic) | No touchpoint-shaped view in DealPilot at all (emails/calls live implicitly in the future S6 Email Hub, not built) | (d) onboarding produced something DealPilot lacks | Logging seller calls/broker emails as Touchpoints is a legitimate ETA workflow need onboarding already models generically (kernel Touchpoint entity) that DealPilot's real implementation hasn't caught up to. Potential DealPilot improvement: wire deal-related emails/calls into kernel Touchpoints rather than (eventually) a bespoke `messages`/`calls` table per the architecture doc. |
| 8 | No dedupe-aware discard / "permanent RYG memory" | `matchCompany` dedupe + a `dealsCanonical`-style merge (strong tier auto-merges); architecture doc's `deal_states` embeds "red stays hidden even if relisted" | (b) blueprint-vocabulary gap (partially) | The kernel blueprint grammar has no concept of a node-level "sticky discard state that survives re-ingestion" — this is a real gap if Bridge ever wants a *generic* dedupe-aware discard primitive across domains (e.g. Recon's `possible_duplicate` signals is the closest kernel analog). Currently this is DealPilot-owned logic (fine), but if Helpdesk/Recon need the same pattern it should graduate to the blueprint/dedupe package, not be reinvented per package. |
| 9 | Vocabulary override only affects entity/nav labels, not field labels | N/A (DealPilot hardcodes "Deal"/"Industry"/"SDE" etc. directly in its own TableSpec, no vocabulary layer needed) | (b) blueprint-vocabulary gap | `applyVocabulary` (blueprint.ts:280-282) is an exact-match lookup keyed on the **entity label string** ("Initiative"→"Deal"); it is never applied to field labels. If a searcher's `vocab_name` answer was meant to rename "Stage" to "Triage" too, the grammar has no mechanism for that. Minor but real: the vocabulary override is coarser than it looks. |
| 10 | No investor-update / funnel-dashboard surface | Roadmapped (S9/S12 in architecture doc) but **not implemented** in `tools/dealpilot/` today | (c) DealPilot feature, correctly out of scope (and not even built in DealPilot yet) | Neither side has this; not a gap between onboarding and DealPilot, it's a gap between DealPilot's architecture doc and DealPilot's actual code. Flagging for completeness only. |
| 11 | Onboarding's `sales_deals` domain option conflates "sales pipeline" and "ETA/acquisition search" under one label | DealPilot is unambiguously ETA/acquisition-search-shaped | (a) onboarding-agent gap | The question text itself ("Deals / sales pipeline") doesn't semantically distinguish a sales rep's CRM-shaped pipeline from a searcher's acquisition pipeline — both would pick the same option and get an identical generic blueprint (one Initiative entity, kanban, Stage field). This is fine as a *starting point* (both need Initiative-shaped tracking) but means onboarding cannot itself distinguish "this workspace should later suggest installing DealPilot" from "suggest a generic sales CRM package" — that discrimination has to happen elsewhere (Learning Agent, package recommendation), not in the question set. |

## 6. Verdicts

**Fundamental gaps (worth fixing in the onboarding agent):**
- **#3 (no domain-specific fields)** is the real problem. Onboarding's field list is essentially
  hardcoded to `name` + optional `stage` no matter what domain is picked. A "Deals/sales pipeline"
  answer and a "Job search" answer produce structurally identical blueprints (per
  `DOMAIN_ENTITY`, both map to `nodeType: "initiative"`) differing only in label. For onboarding
  to be worth calling "adaptive," it needs at least one more question per domain that collects
  2-4 domain-relevant fields (or infers them from a short free-text description via the Learning
  Agent, per CLAUDE.md's "learn before acting" principle) — otherwise every non-trivial domain
  ends up needing a manual blueprint edit or a package install immediately after onboarding
  finishes, making the onboarding output close to a placeholder.
- **#6 (dropped `calendar` answer)** is a straightforward bug — file to docs/BUGS.md, trivial fix
  (either wire a calendar-surfacing view/capability, or remove the option until it does
  something).
- **#2 (groupBy never set)** is a cheap, high-value fix: when `watch_first` includes
  `track_stage`, set the initiative view's `config.groupBy = "stage"` automatically (kanban
  without a groupBy is barely a kanban).

**Blueprint-grammar gaps (worth extending, but not urgent):**
- **#1/#4 (no derived/computed field kind)** — the grammar's `BlueprintColumnKind` has `formula`
  already listed (blueprint.ts:52) but onboarding never emits one and nothing here confirms the
  compiler or `@bridge/tables` engine actually executes formulas end-to-end. If `formula` is real
  and wired, onboarding should use it for anything scoring-like; if it's a placeholder, that's a
  separate gap to verify (out of this simulation's scope — flagging, not fixing).
- **#9 (field-label vocabulary)** — minor, cosmetic; only matters if a future domain's fields
  need renaming too. Low priority.
- **#8 (sticky discard-state pattern)** — worth watching, not worth building until a second
  package (Helpdesk/Recon) independently needs the same "hide but remember" semantics. Premature
  to generalize on one data point.

**Correctly out of scope (leave in the DealPilot package, do not push into the generic
generator):**
- #5 (sourcing/connectors/waterfall), #4's scoring logic itself, #10 (investor updates/funnel
  dashboard). These are exactly the kind of package-specific behavior CLAUDE.md's package model
  says belongs in `platform/tools/dealpilot/` (or its future `package.yaml` repackaging per
  `capability-module-format.md` §4), not in `buildBlueprintFromAnswers`. Onboarding correctly
  produces `capabilities: []` and leaves connector wiring alone — this boundary is healthy and
  should be defended, not eroded, as onboarding gets richer.

**Onboarding-produced-but-DealPilot-lacks (potential DealPilot improvement):**
- #7 (Touchpoint logging for seller/broker communication) is a real, currently-generic capability
  onboarding already offers that DealPilot's real implementation hasn't adopted — its own
  architecture doc's S6 Email Hub is unimplemented. When DealPilot's email/call handling is
  eventually built, it should compose the kernel Touchpoint entity rather than invent parallel
  `messages`/`calls` tables, so a DealPilot-generated workspace and an onboarding-generated one
  converge on the same vocabulary instead of diverging further.

**Bottom line:** the onboarding agent currently produces a nearly-empty shell for a domain as
data-rich as ETA deal sourcing — one text field and an optional status select. It's not wrong,
just thin: it correctly declines to build DealPilot's sourcing/scoring/dedupe machinery (correct
boundary), but it also doesn't capture the handful of screening fields (industry/geo/SDE/revenue)
a searcher would obviously want typed into their table from question one. That's the one gap
worth prioritizing; the rest are either small bugs (#6), quick wins (#2), or genuinely
package-specific and should stay that way.
