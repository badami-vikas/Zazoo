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

An input pack has **six layers** (extended 2026-08-04 by ADR-174 after the people-research test):

1. **Constitution** — this file. Why the rules exist.
2. **Kernel contract surface + installed-capability registry** — the contracts a capability builds
   against, AND an enumeration of what is already installed. Thin, but the registry is mandatory:
   without it a capability plan cannot execute invariant 8 and will rebuild what exists.
3. **Capability mandate** — ~150 words. MUST name the capability-specific risks; measured as the
   highest-leverage layer per token.
4. **Method (Layer M)** — how the work is executed, not only what is built. See below.
5. **Budget envelope (Layer B)** — the scope · cost · time contract. See below.
6. **Harness** — the executable obligations. Conformance is defined here.

### Layer M — method obligations

- **M1. Reuse intake is a deliverable, not a preamble.** Before designing components, survey
  open-source repositories, installed platform capabilities, and the capability registry. The plan
  carries a candidate table: candidate · what it does · license · maintenance signal · fit ·
  verdict (adopt/wrap/adapt/reject-and-build) · rationale. A *build* verdict is valid only when the
  table shows why no lawful option was adequate. Stating invariant 8 without executing it does not
  satisfy M1 — this obligation exists because a plan given only the invariant deferred the intake.
- **M2. Licensing and terms decide the verdict, not convenience.** Permissive licenses may be
  imported or wrapped. Copyleft/AGPL may be used behind a port as a service, never linked into the
  core. Restricted terms, contracts, or access controls invoke the
  [clean-room protocol](clean-room-capability-research-protocol-2026-07.md): preserve terms and
  provenance, benchmark observable behavior only, author requirements independently, and the
  analyst who studied the restricted source does not implement the alternative. Never copy,
  paraphrase, or translate protected expression; never bypass access controls or rate limits.
- **M3. Artifact class is justified deliberately.** For every unit, state its class (Module /
  Agent / Skill / Integration / Automation) and the test that justifies it. Prefer the smallest
  class that works. A new Agent requires durable identity, a distinct authority/data boundary, an
  independent eval lifecycle, or an irreducible duty conflict — a workflow, method, report, or
  source is a Skill.
- **M4. Every phase carries its own evidence.** Name the test, fixture, or artifact that proves the
  exit criterion — which test asserts what, not "tests pass".
- **M5. Cheapest source that answers the question.** Escalate to credentialed or paid sources only
  on recorded evidence, and record the trigger. An escalation without a recorded trigger is a
  governance violation, not a cost overrun.

### Layer B — budget envelope

A capability that cannot state its envelope is not approvable. Three axes, with numbers:

- **Scope (storage and memory)** — what persists per subject/entity versus what is discarded after
  the Run; caps on durable rows and bytes; retention and decay; and an explicit list of what is
  deliberately **not** stored.
- **Cost (tokens and money)** — model calls and token budget per Run; the named steps where a model
  call is a test failure; tier routing (cheap by default, escalation only on a recorded trigger);
  marginal cost per unit of work at steady state.
- **Time (build and runtime)** — build effort per phase, each phase shippable standalone in days;
  runtime wall-clock bound; interactive latency target.

Each budget names the component that owns its meter, what happens at exhaustion (a bounded exit
with a recorded reason and an honestly-partial result — never a silently smaller one), and the test
that proves the bound. Bounds are enforced at the port layer, so an unmeterable call is unmakeable.
Every capability declares which single axis it deliberately overspends, and why the trade is right.

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
