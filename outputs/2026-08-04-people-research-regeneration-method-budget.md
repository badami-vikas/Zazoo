# People-research regeneration test — does the pack reproduce Recon, and what was missing? (2026-08-04)

Second experiment in the ADR-172 series. User questions: (a) do generated plans align with the
**execution plan**, not just the architecture — e.g. does a research capability actually go look
for open-source repositories and follow a method? (b) can a Builder Agent, given the right inputs,
grow the people-research capability Recon was built to solve? (c) if not, what additional input or
structure is required? (d) what are we saving?

## Method

Two isolated agents, no repo access, same problem statement (pre-meeting brief on a person from a
thin seed; ambiguous names; ~zero marginal cost; non-consenting subject), same constitution,
kernel contracts, mandate, and harness (H1–H9 including misattribution and rights-basis gates).

- **D1** — the pack as it stood after ADR-173.
- **D2** — same pack **plus two candidate layers**: **Layer M (method obligations)** — reuse
  intake as a deliverable with a licensed candidate table, licensing verdicts, clean-room
  protocol, deliberate artifact-class justification, per-phase evidence, cheapest-source-first;
  and **Layer B (budget envelope)** — declared and enforced scope (storage), cost (tokens/money),
  and time (build/runtime), plus how each is metered and which test proves the bound.

Graded against `Tools/recon` as ground truth (37 files, 8,735 LOC; `lib/recon.ts` alone ~3,100).

## Answer to (a) and (c): the execution-plan gap was real, and Layer M closes it

Both packs contain constitution invariant 8, "reuse before build". **D1 read it, understood it,
and deferred it** — its open-items list says a reuse intake "must run before P1" and it assumed no
existing capability. A one-line principle carries no method, so the plan restated the rule instead
of executing it. This is exactly the failure the user predicted.

**D2 executed it.** Its reuse intake surveyed 9 installed platform capabilities and 22 external
candidates with license, maintenance, fit, and verdict, reaching the same standard this repo
applies by hand in its best moments (the WhatsApp intakes, ADR-158):

- **Adopt**: Wikidata/OpenAlex/Crossref/SEC EDGAR (CC0 or public domain), Mozilla Readability
  (MPL file-level copyleft — compatible when vendored unmodified behind a port), Presidio (MIT)
  for special-category screening, garak (Apache-2.0) to seed the injection corpus on day one.
- **Adapt**: Splink (MIT) for calibrated Fellegi–Sunter match probabilities — taking the scoring
  model, not the runtime.
- **Reject with reasons that are legal, not aesthetic**: Zingg (AGPL — cannot link into the
  kernel, and wrapping costs more than Splink's benefit); Common Crawl (bulk corpus launders
  per-origin terms, incompatible with the per-source rights basis H9 demands); LinkedIn scraping
  or headless sessions (**"reject — never"**: bypassing access controls is prohibited outright,
  "not a cost question"); commercial people-data APIs (their lawful-basis chain for a
  non-consenting subject is not auditable by us — adopting one imports a liability we cannot
  evidence).

**The scope consequence is the headline.** D2's build verdict narrows to exactly three net-new
components — the ambiguity refusal band, the claim↔citation↔rights ledger, and the promotion gate
— with everything else adopted, wrapped, or adapted. D1, having deferred the intake, planned to
build the pipeline itself.

## Answer to (b): yes — and the regenerated design beats Recon

Convergence with Recon's hard-won structure, from rules alone:

| Recon feature | D1 | D2 |
|---|---|---|
| Search-led / recall-first, zero-cost sources | ✓ | ✓ |
| Source registry with per-source rights basis + expiry | ✓ | ✓ (one Integration per *rights basis*, not per protocol) |
| Identity resolution before enrichment; candidates, never auto-pick | ✓ | ✓ |
| Match tiers (strong / moderate / flag) | ✓ strong/moderate/weak | ✓ calibrated `p≥0.97` / refusal band / discard |
| Claims attach to a *candidate* until binding accepted | ✓ | ✓ |
| Ambiguity → Signal, never auto-merge | ✓ | ✓ |
| Tiered fields with confidence, modeled ≠ fact | ✓ Tier 1/2/3 | ✓ Tier 1–4 + Unresolved |
| Draft-then-approve staging before shared knowledge | ✓ | ✓ deterministic PromotionGate |
| SSRF / polite identified crawler | ✓ | ✓ (polite-pool UA recorded as a terms obligation) |
| Multi-signal corroboration boost | ✓ | ✓ (≥2 independent sources) |

Beyond Recon, both add what Recon predates: taint labelling, structural quarantine, subject
erasure closure, and — in D2 — an explicit budget. Neither reproduces Recon's 3,100-line monolith.

**Three places the regenerated design is better than what we shipped:**

1. **Calibrated probability instead of trigram thresholds.** Recon and `@bridge/dedupe` use fixed
   similarity cutoffs (0.92 / 0.75). D2 adapts Splink's Fellegi–Sunter scoring and adds the rule
   that **auto-bind is never reachable from a model** — the adjudication Skill may only reorder or
   annotate candidates for a human, never move one above the band.
2. **Two Agents, not three, on a sharper test.** D1 created a third "Knowledge Steward" Agent for
   promotion. D2 refuses: promotion is deterministic policy, and *"making it an Agent would insert
   a model into the one path that writes shared state."* D2's two Agents split on an irreducible
   duty conflict — Scout is measured on coverage, Resolver on refusal under doubt, and one actor
   holding both incentives resolves ambiguity toward a fuller brief, which is the misattribution
   failure mode itself. That is a better application of our own Agent test than we made.
3. **Uncited facts made unrepresentable.** `NonEmpty<Citation>` as a type invariant plus a DB
   constraint, with unresolvable claims constructible only as `OpenQuestion`. H5 by construction
   rather than by review.

## Answer to (c) continued: Layer B produced the economics the user asked for

D1 has a qualitative "cost posture" and no numbers. D2 declares and enforces:

- **Scope** — ≤25 accepted claims, ≤60 citations, ≤256 KB durable per subject; transient evidence
  TTL 7 days; raw HTML never durable; decay to `stale` at 180 days. An explicit **not-stored**
  list: raw pages, media, home address, personal contact details, family, minors, special
  categories, any access-controlled source, any psychological or "influence" scoring.
- **Cost** — ≤6 model calls and ≤45k input / 6k output tokens per run; a named list of steps where
  a model call is a **test failure** (admission, rights checks, clustering, screening, citation
  resolution, promotion, rendering); cheap tier by default with exactly one conditional escalation
  whose trigger is recorded in the Run — *"an escalation without a recorded trigger is a
  governance violation, not a cost overrun."* Marginal cost ≈ **$0.13 first brief, $0.03 refresh**,
  hard ceiling $0.20.
- **Time** — ~29 engineer-days across 7 independently shippable phases; p95 runtime 90 s, hard kill
  180 s; interactive paths ≤400 ms and never model-backed.
- **Enforcement** — one `RunBudgetMeter` in the governance spine wrapping every port call, so an
  unmeterable call is unmakeable; child Runs get a subset of the parent's remainder; exhaustion is
  a bounded exit with an honestly-partial brief, and resume never refunds. Six named tests, one
  per bound, including a resume-no-refund test.
- **Declared overspend axis** — runtime time, reasoned: async at T−24h means seconds are cheap, and
  spending them buys down both money and storage *and* makes H5/H6 mechanically checkable, because
  per-document extraction keeps citations attributable where a fast bulk pass would blend sources.

## Answer to (d): what this saves

Honest accounting. **Cost of the method so far**: five generated plans, 256k subagent tokens,
about 13 minutes of wall-clock agent time, plus orchestration and triage.

**What it buys:**

1. **Scope collapse on new capabilities.** Recon is 8,735 LOC built standalone. D2's intake shows
   only three components are genuinely net-new for the same problem; the rest is adopted or
   wrapped. The saving is not typing speed — it is *not writing* the SSRF guard, the staging
   store, the match-tier model, and the record-linkage scorer that already exist in the platform
   or in MIT/CC0 libraries.
2. **Duplication already paid for, now visible.** `@bridge/dedupe` (134 LOC) carries the exact
   `strong | moderate | flag | none` vocabulary Recon implements separately, and Recon rebuilt its
   own SSRF guard alongside the platform's 989-line net-guard. Two implementations of one concept
   is the measurable form of the bloat this work targets.
3. **Convergence time.** The Learning Agent's architecture took **8 weeks and 54 commits**
   (2026-06-11 → 2026-08-04) to settle. The regeneration test reproduced that architecture in
   ~100 seconds from one page of rules. The weeks were spent *discovering the invariants*, not
   typing the code — which is precisely why writing them down converts a one-time discovery into a
   reusable asset.
4. **Governance re-litigation avoided.** 170 ADRs exist. Today each new capability re-negotiates
   authority, taint, residency, and approval placement. With pack + harness, conformance becomes a
   test run, and only genuinely novel questions reach an ADR.
5. **Legal exposure caught before code.** D2's intake rejected an AGPL dependency, a
   terms-laundering corpus, an access-control bypass, and an unauditable data broker — at plan
   time, for a few thousand tokens, rather than after integration.

**What it does not save:** the legal question. Both plans independently flagged the lawful basis
for researching a non-consenting subject as the single largest unresolved dependency, and D2 notes
it "can invalidate the capability regardless of the design." No amount of structure resolves that;
it needs counsel.

## Structural conclusion

The input pack becomes **six layers**, and the two new ones are not optional:

| Layer | Answers | Evidence it is needed |
|---|---|---|
| Constitution | why | ADR-172: harness-only missed authority/ledger/flags/vocabulary |
| Kernel contracts **+ installed-capability registry** | what to build against, and what already exists | D1 could not tell whether people-research already existed; `entity-disambiguation` is installed and it never saw it |
| Mandate (~150 words, names the risks) | what and what could go wrong | ADR-172: highest leverage per token |
| **Method (Layer M)** | how the work is executed | D1 deferred reuse intake; D2 executed it and cut scope to 3 components |
| **Budget (Layer B)** | scope · cost · time envelope | D1 produced no numbers; D2 produced enforceable ones with tests |
| Harness | conformance | ADR-172: recovered ~80% of safety architecture alone |

Recommended next: pin Layers M and B into the pack spec, add the installed-capability registry to
the contracts layer, then graduate to build-generation on one capability.
