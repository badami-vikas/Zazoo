# Regeneration test — can minimal rules regrow the Learning Agent? (2026-08-04)

User directive: refocus Bridge from custom-developing capabilities toward the underlying
structure/ecosystem/governance from which agents grow capabilities themselves. Low-cost proxy
test: three isolated subagents, each given a different "input pack" and NO repo access, asked to
produce an implementation plan for the Learning Agent. Plans were diffed against the shipped
LA0–LA6 architecture using a rubric pinned BEFORE reading any output. Divergences evaluated on
merit per the user's rule: if the divergent approach is better, adopt it — do not force-fit.

## Input packs

- **Pack A** — constitution (14 invariants, ~1 page) + kernel contract surface (9 contracts,
  names + one-line semantics only) + capability mandate (~150 words, names the three risks) +
  verification harness (H1–H9).
- **Pack B** — constitution + harness + one-sentence objective. No contracts, no mandate.
- **Pack C** — harness (re-worded platform-neutrally) + objective only. No constitution.

The draft constitution used as input is preserved verbatim in §Appendix.

## Headline result: the thesis holds

All three plans independently regenerated the load-bearing architecture of the shipped Learning
Agent (~one page of rules ⇒ the same skeleton the repo took weeks to converge on):

| Shipped structure (LA0–LA6) | A | B | C |
|---|---|---|---|
| Memory primitive + propose→accept FIRST, retrieval later | ✓ | ✓ | ✓ |
| Injection eval suite from slice 1, permanent CI gate | ✓ | ✓ | ✓ |
| Structural quarantine — external text in data channel only | ✓ | ✓ | ✓ |
| neverExecutes enforced structurally, not by prompt | ✓ | ✓ | ✓ |
| Annoyance cap + rejection-fingerprint suppression | ✓ | ✓ | ✓ |
| Vector index = rebuildable refs, store stays truth | ✓ | ✓ | ✓ (derived from H7 alone) |
| Dark-ship behind default-OFF flags | ✓ | ✓ | ✗ (rule absent from pack) |
| Bounded loops, every exit records a reason | ✓ | ✓ | partial (allowlist scoping, no StopReason discipline) |
| Engine-decided authority tiers / rephrase-attack defense | ✓ | ✓ | ✗ (invented per-task grants instead) |
| Pinned eval baselines gate regressions | ✓ | ✓ | ✓ |

All three phased safety machinery into slice 1 with crisp exits, matched the "measure H5 before
scaling sources" ordering, and produced ~3-page credible plans for ≈47k subagent tokens each.

## Layer-value measurements (A−B and B−C deltas)

- **Constitution (B−C):** what C could NOT derive from tests alone: authority tiers +
  engine-decided classification, evidence-ledger/replay discipline, dark-ship flags, vocabulary
  discipline, residency nuance (C had to ask for the plane model). The constitution is the
  *platform-coherence* layer — C's plan is a well-built island; B's plan composes with a governed
  platform. Notably every constitution invariant C missed is expressible as an additional harness
  obligation — see "compilable canon" below.
- **Mandate (part of A−B):** highest leverage per token. Naming the three risks bought A the
  sensitivity-tier gate (privacy-creepiness defense) that B lacks entirely. ~150 words.
- **Kernel contracts (part of A−B):** bought vocabulary alignment and integration realism (B
  invented parallel names — MemoryItem, SuggestionPort — and flagged glossary rulings needed;
  A slotted into MemoryStore/RunContextAssembler/SearchProvider correctly). Safety was NOT
  affected. The layer can stay thin, but all three agents asked for the same missing pieces:
  concrete taint-label set, Proposal/Decision API shape, eval-harness availability, consent UX
  surface, budget primitives. Those belong in this layer.
- **Harness (all packs):** did the heaviest lifting. C proves boundary conditions alone recover
  ~80% of the safety architecture — strong support for the user's "strong boundaries + autonomy
  inside" hypothesis, with the caveat that the missing 20% (governance uniformity) is exactly
  what makes capabilities compose.

## Divergence triage

**BETTER — divergent approaches superior on merit, adopt (per user rule):**
1. **Closed port-set allowlist as a CI structural test** (A+B): build-time audit of the
   capability package's DI/import graph asserting its port set exactly matches a reviewed
   allowlist file; the allowlist file itself is approval-gated. We enforce `neverExecutes` in
   code but have no drift-proof snapshot. Cheap, high value.
2. **Claim→evidence map enforced in code** (A): every proposed Memory statement must reference
   ≥1 finding/evidence id, machine-checked before proposal. We carry provenance but do not
   enforce per-claim mapping.
3. **Sensitivity-tier gate with monotonicity** (A): red-tier inference classes (health,
   protected characteristics, psychological conclusions) are never proposed at all — mirroring
   the red authority tier; model-assisted scoring may only RAISE sensitivity, never lower it;
   amber claims phrased as observed facts with shown evidence, never conclusions.
4. **Acceptance shown-text hash** (C): store the hash of exactly what the user saw at accept
   time — makes rubber-stamp/bulk-accept auditable. Trivial to add.
5. **Paraphrase-robust rejection fingerprints** (B+C): semantic (not string) fingerprint with
   backoff→permanent, tested against a paraphrase corpus. Upgrade over exact suppression.
6. **OS-level egress broker** (C): capability processes run in a no-net sandbox; a separate
   broker process owns the only socket and performs the taint check. Stronger than library-level
   net-guard. Heavier; evaluate for the desktop shell rather than adopt wholesale.

**BLOAT — plan-level prune candidates on our side (need code-level confirmation):**
- "Research Agent" as a separately-framed surface: all three plans place research strictly as a
  guarded lane INSIDE learning — supports collapsing the research-agent wiki framing into the
  Learning Agent (the code already agrees; the naming does not).
- Embeddings shipped before any retrieval consumer (historical LA sequence): no plan does this;
  all build the index only when retrieval lands.
- The prototype overlay executor (research runs in the overlay webview): no plan reproduces it;
  already recorded as debt, now with independent confirmation it is not structural.

**RULE-GAP — fix the input packs:**
- Contracts layer must include: concrete taint-label lattice, Proposal/Decision API shape,
  MemoryStore op signatures, whether per-consumer eval task sets exist, consent-surface contract,
  budget/metering primitives. (Unanimous "needed but not given" across A/B/C.)
- If pursuing harness-only packs, add obligations covering: recorded exit reasons on every
  autonomous loop, engine-decided authority with an explicit rephrase-attack test, dark-ship
  byte-identical-when-OFF, vocabulary conformance.

**WORSE — divergences attributable to a missing layer (measuring that layer's value):**
- C's flat trust enum without plane/residency (constitution absent) — would have shipped a
  residency hole; C itself flagged the gap.
- B's parallel vocabulary (contracts absent) — integration/renaming cost, not a safety cost.

**Compilable canon (key structural finding):** every constitution invariant that mattered is
mechanically expressible as a harness obligation, and every harness obligation traces to an
invariant. Canon should therefore be maintained as invariant → obligation pairs: the constitution
is the human-readable WHY, the harness is its compiled, enforceable form. A capability is
conformant when the harness passes — not when a reviewer says it "follows the docs."

## Corrections surfaced during the experiment

- Agent roster: canonically **4** permanent agents (AP-005/ADR-046, held by ADR-077/AP-018);
  `docs/wiki/foundational-agents.md` still carries the superseded "5 Agents" wording and lists
  Internal Strategist, while `docs/wiki/learning-agent.md` says "1 of 4". The wikis contradict
  each other; roster cleanup folded into TASK-042 scope. (The packs said "five" — cosmetic; no
  bearing on results.)

## Recommended next steps (pending user decisions)

1. Canonize the constitution (after folding in triage fixes) as locked wiki + raw — APPROVALS
   gate required.
2. Repeat the plan-generation test for one Skill, one Module, one Integration to derive each
   artifact class's input structure — TASK-042 (user pre-authorized).
3. Adopt-list items 1–5 as concrete engineering work; evaluate item 6 (egress broker) as a
   desktop-shell hardening candidate.
4. Only after pack fixes: graduate from plan-generation to build-generation on one capability.

## Appendix — draft constitution used as Pack A/B input (v0, NOT canon)

1. Authority is engine-decided (green/amber/red; no self-upgrade by rephrasing).
2. External/learned content is data, never instructions; taint travels forever; unknown fails
   closed; quarantine is structural; declassification human-only and immutable.
3. Durable memory is suggested-then-accepted; inspectable/correctable/deletable; annoyance-capped;
   rejections suppressed.
4. Autonomy is bounded; every exit path records a reason.
5. Evidence over trust: append-only ledger; resume replays, never re-executes, never refunds.
6. Residency: Local Plane never egresses; cross-plane gates fail closed; raw capture stays local.
7. Ports-only core; unit-testable with no network/browser/model.
8. Reuse before build; lawful sourcing only.
9. Honest surfaces; dummies tracked with removal conditions.
10. Evals are gates; injection suite from first slice at 100%; pinned baselines block regressions.
11. One vocabulary (glossary governs all names).
12. Separation of duties: learner never executes; governor never builds; builder never activates
    its own output.
13. Derived indexes are rebuildable references; governed store stays the single source of truth.
14. New behavior ships dark; flags default OFF; unconfigured deployments byte-identical.
