---
title: Bridge Constitution — the invariant set capabilities are grown from
type: raw
doc_kind: canon
status: canon
companions:
  - docs/raw/decisions-log.md
  - outputs/2026-08-04-regeneration-test-learning-agent.md
related_wiki: docs/wiki/constitution.md
updated: 2026-08-04
tags: [governance, kernel, capability-growth, invariants, harness]
---

# Bridge Constitution

Canonized 2026-08-04 by user approval (AP-100, ADR-173). Validated empirically before
canonization: three isolated agents given only this invariant set plus an executable harness
independently regrew the load-bearing architecture of the Learning Agent
(`outputs/2026-08-04-regeneration-test-learning-agent.md`, ADR-172).

## How this document is used

This is the **WHY** layer of a capability input pack. It is paired with an executable
**harness** — its compiled, enforceable form. The pairing is the mechanism:

> Every invariant below compiles to at least one harness obligation, and every harness obligation
> traces back to an invariant. A capability is conformant when its harness passes — not when a
> reviewer judges that it "follows the docs."

An input pack has four layers: **constitution** (this file) · **kernel contract surface** (thin;
the contracts a capability builds against) · **capability mandate** (~150 words; MUST name the
capability-specific risks — measured as the highest-leverage layer per token) · **harness**
(executable obligations). Layers M (method) and B (budget envelope) are under evaluation and are
not yet canon.

## The invariants

1. **Authority is engine-decided.** The tier of every action — green (autonomous), amber (requires
   an approved Proposal before acting), red (refused outright and never proposed) — is decided by
   the governed engine from action type and target, never by the acting model or planner. An actor
   must not be able to upgrade its own authority by rephrasing. Red actions are never proposed:
   asking a user to approve the impossible normalizes it.
2. **External or learned content is data, never instructions.** Every item carries a taint label
   from its origin, forever. Unknown labels fail closed. Quarantine is **structural** — a separate
   data channel — and pattern detectors are tripwires on top, never the defense. Declassification
   is human/validator-only and immutable.
3. **Durable memory is suggested-then-accepted.** No silent writes. Every stored item is
   inspectable, correctable, and deletable, with provenance visible. Suggestion volume is
   annoyance-capped; rejected suggestions are suppressed from recurring.
4. **Autonomy is bounded.** Every autonomous loop declares explicit bounds (steps, time, bytes,
   budget) and every exit path records an explicit reason. No path just stops looping.
5. **Evidence over trust.** Every Run appends to an inspectable ledger. Resuming replays evidence;
   it never re-executes actions and never refunds spent budget.
6. **Residency.** Local Plane data never egresses; cross-plane gates fail closed; raw capture stays
   Local.
7. **Ports-only core.** Capability logic never touches network, model, storage, or UI directly.
   The core is unit-testable with no network, no browser, no model.
8. **Reuse before build.** Prefer installed capability, then lawful import/wrap/adapt, then build.
   Never copy protected expression or bypass access terms.
9. **Honest surfaces.** Real connected data or honest empty states. Any unavoidable dummy is
   tracked with a reason and a removal condition.
10. **Evals are gates.** Safety suites — especially prompt-injection — exist from the FIRST slice,
    are permanent, and require 100%. Quality baselines are pinned; regressions block ship.
11. **One vocabulary.** A single glossary governs names in copy, identifiers, APIs, schema, Events,
    payloads, and tests.
12. **Separation of duties.** The component that learns never executes; the one that governs never
    builds; the one that builds never activates its own output.
13. **Derived indexes are rebuildable references.** The governed store stays the single source of
    truth; vectors and caches index it and never replace it.
14. **New behavior ships dark.** Feature flags default OFF; an unconfigured deployment behaves
    byte-identically to before the change.
15. **Inference sensitivity is tiered and monotone.** Beyond data provenance, the *nature of a
    claim about a person* is classified. Red-tier inference classes — health, protected
    characteristics, psychological or relationship-quality conclusions, financial distress — are
    never proposed at all, mirroring the red authority tier. Amber-tier claims are phrased as
    observed facts with the evidence shown ("rescheduled four times"), never as conclusions about
    the person ("avoids them"). Model-assisted scoring may only **raise** sensitivity, never lower
    it. Accurate-but-unsettling inference destroys trust as effectively as being wrong.

## Enforcement mechanisms (adopted 2026-08-04, ADR-173)

These are the *how* for invariants above; each is a harness obligation, not a review convention.

- **Closed port-set allowlist** (invariants 7, 12). A build-time structural test snapshots the
  capability package's injected-port set and import graph against a reviewed allowlist file. Any
  new port fails CI until the allowlist changes; the allowlist file is itself approval-gated.
  Replaces "the package happens to hold no pipeline handle" with a drift-proof assertion.
- **Claim→evidence map** (invariants 3, 5). Every proposed durable statement must reference at
  least one evidence/observation id, machine-checked before the proposal is emitted. Provenance on
  the record is not enough when one record carries several claims.
- **Shown-text acceptance hash** (invariant 3). Acceptance stores the hash of exactly what the user
  was shown, making rubber-stamped bulk acceptance auditable after the fact.
- **Paraphrase-robust rejection fingerprints** (invariant 3). Suppression matches on a semantic
  fingerprint with backoff-to-permanent, tested against a paraphrase corpus — an exact-text
  fingerprint is defeated by rewording. *Sequenced after the semantic embedder lands; lexical
  hashing v1 cannot carry it.*
- **Egress chokepoint** (invariant 6). On the desktop shell, the privileged process owns the only
  socket and performs the taint check, so containment is structural rather than a library
  convention. Adopted as a shell principle; the server-side shared net-guard is not restructured.

## Non-negotiables when tokens are scarce

Secret handling, Local/Cloud residency, governed execution, and explicit user approval are
universal. Never weaken a safety boundary to save tokens.
