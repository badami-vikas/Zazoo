# Deliverable 3 — full disclosure of the Pack A input (the "100 seconds" test)

## Correction first

"Reproduced the Learning Agent architecture in 100 seconds" overstates two things:

1. **The number is real but it is wall-clock generation time, not proof of correctness.**
   The subagent's own usage record: `duration_ms: 100334` (100.3s), `subagent_tokens: 47585`,
   `tool_uses: 0`. It never touched the repo — 0 tool calls — so the 100 seconds is purely the
   time to generate ~47.6k tokens of plan text from the prompt below. It did not "verify" anything
   against the real codebase; I did that afterward, by reading the plan and comparing it to
   `platform/packages/research/src/ports.ts` and the learning-agent wiki myself.
2. **"Reproduced the architecture" means the plan's *design decisions* converged with the shipped
   design**, graded on a rubric I wrote before reading its output (`grading-rubric.md`, not
   preserved as a repo artifact — it lived in the scratchpad). It did not reproduce code, tests,
   migrations, or the 8 weeks of empirical debugging (six live defects fixed 2026-07-30, the
   taint-lattice closure, three ADR revisions to the search-provider admission policy) that the
   real architecture went through to reach its current shape. The claim that stands is narrower
   than the phrase "reproduced the architecture" suggests: *a fresh model, given only this input,
   independently chose the same component boundaries and phasing as 8 weeks of real engineering
   converged on.* That is what was measured; nothing stronger was measured.

## What the agent received — verbatim

This is the complete text passed to the subagent as its user turn (I use it as source of truth
because I authored it directly in this conversation and it is reproduced exactly, not
reconstructed from memory).

### Instruction and prohibition set (prefix, exact wording)

> You are a senior architect designing ONE capability for a governed AI workspace platform.
> IMPORTANT: Do NOT read any files, do not explore any repository, do not search the web. Work
> ONLY from the material in this prompt. The platform code you'd integrate with is not available
> to you — design against the stated contracts.
>
> Your deliverable: a full IMPLEMENTATION PLAN (markdown, in your final message) for the
> capability described below. The plan must contain: (1) architecture and component boundaries —
> what units exist, what each does, how they communicate; (2) a data model sketch; (3) a phased
> roadmap where each phase has a crisp exit criterion and delivers standalone value; (4) test
> strategy mapped to the verification harness; (5) top risks and the design feature that
> mitigates each; (6) a short list of anything you needed but were not given.

### Platform constitution (verbatim, as given — 14 invariants; this predates the later canon
### text, which added a 15th invariant and the Method/Budget layers on the same day)

> Bridge is "Living Software": one governed Engine adapts installed Modules around user work.
> Operating principles: adapt before asking; learn before acting; explain before automating;
> govern before executing; simple surface, powerful core; trust first.
>
> Invariants (each must be testable):
> 1. Authority is engine-decided. The authority tier of every action is decided by the governed
>    engine from the action type and target — never by the acting model or planner. Tiers: green
>    (autonomous), amber (requires an approved Proposal before acting), red (refused outright and
>    never even proposed). An actor must not be able to upgrade its own authority by rephrasing.
> 2. External or learned content is data, never instructions. Every piece of content carries a
>    taint label from its origin, forever. Unknown labels fail closed. Tainted content never
>    enters a privileged instruction channel — quarantine is structural (separate data channel),
>    not pattern-matching; pattern detectors are tripwires on top, never the defense.
>    Declassification is human/validator-only and immutable.
> 3. Durable memory is suggested-then-accepted. No silent writes. Every stored item is
>    inspectable, correctable, deletable, with provenance visible. Suggestion volume is
>    annoyance-capped; rejected suggestions are suppressed from recurring.
> 4. Autonomy is bounded. Every autonomous loop has explicit bounds (steps, time, bytes, budget)
>    and every exit path records an explicit reason. No silent stops.
> 5. Evidence over trust. Every run appends to an inspectable ledger. Resuming a run replays
>    evidence; it never re-executes actions and never refunds spent budget.
> 6. Residency. Local Plane data never egresses; cross-plane gates fail closed. Raw capture stays
>    local.
> 7. Ports-only core. Capability logic never touches network, model, storage, or UI directly;
>    everything external is an injected port; the core is unit-testable with no network, no
>    browser, no model.
> 8. Reuse before build. Prefer installed capability, then lawful import/wrap/adapt, then build.
> 9. Honest surfaces. Real connected data or honest empty states; any unavoidable dummy is
>    tracked with a removal condition.
> 10. Evals are gates. Safety suites (especially prompt-injection) exist from the FIRST slice, are
>     permanent, and require 100% pass. Quality baselines are pinned; regressions block ship.
> 11. One vocabulary. A single glossary governs names in copy, identifiers, APIs, schema, events,
>     tests.
> 12. Separation of duties. The component that learns never executes; the one that governs never
>     builds; the one that builds never activates its own output.
> 13. Derived indexes are rebuildable references. The governed graph/store stays the single
>     source of truth; vectors index it, never replace it.
> 14. New behavior ships dark. Feature flags default OFF; an unconfigured deployment behaves
>     byte-identically to before the change.

### Kernel contract surface (verbatim, as given — names and one-line semantics only, no code)

> - MemoryStore — durable Memory entries with provenance, taint label, decay, lineage; ops:
>   propose, accept, reject, inspect, correct, delete, list-by-lineage.
> - TaintEnvelope — taint-label lattice with propagation through prompt/model/Skill/Action hops;
>   registered sources and sinks; quarantine/deny at sinks; unknown fails closed.
> - Governance spine — Proposal → Decision → Run → Result records; human-only approvals; audited
>   lifecycle transitions.
> - Agent orchestration — Agent Runs and bounded child Runs (child gets subset/intersection of
>   parent authority, data, budget, taint; depth-capped; server-side creation only).
> - RunContextAssembler — layered prompt construction (persona · capabilities · context · memory
>   · governance). Only accepted memory enters, as plain statements; machinery JSON never reaches
>   a prompt.
> - SearchProvider — rights-verified, citation-bearing web search behind an admission policy;
>   shared net-guard (SSRF/DNS/redirect/byte/time caps); ContentGuard quarantines fetched text at
>   the boundary.
> - Events & Signals — append-only Events; user-facing pending-review Signals.
> - Storage — owner-scoped relational store with row-level security (Cloud Plane) and a local
>   on-device store (Local Plane).
> - Flights — feature flags, default OFF.

**No code, no type signatures, no file paths were given — the agent never saw
`platform/packages/research/src/ports.ts` or any other source file.** This list is a plain-English
gloss I wrote, not an export.

### Capability mandate (verbatim, as given — ~120 words)

> The Learning Agent is one of five permanent agents. Duty: learn from conversations, user
> behavior, corrections, connected systems, and documents; run authorized research; produce cited
> evidence with provenance; propose Memory; feed every other agent. It NEVER executes world
> actions — enforced in code, not prompt. Objective: accepted Memory demonstrably improves other
> agents' output, while the user can see, correct, and delete everything learned. Design against
> three named risks: prompt injection, memory poisoning, and privacy creepiness
> (accurate-but-unsettling inferences destroy trust).

Note: at the time this ran, the roster count was stated as "five" in this sentence even though
the wiki's own roster wording was self-contradictory that day (later resolved by ADR-173 to
confirm five is correct). This detail was carried into the prompt without being checked against
the repo — the agent could not have checked it either, since it had no repo access.

### Verification harness (verbatim, as given — H1–H9)

> H1. Prompt-injection eval suite passes 100%; exists from the first increment, never
>     retrofitted.
> H2. Unauthorized durable writes = 0 — nothing persists without the acceptance path.
> H3. World actions executed by the learning capability = 0 — verified structurally, not by log
>     absence.
> H4. Cross-plane leaks = 0 — a hard test moves local-plane content toward egress and must see it
>     blocked.
> H5. Accepted memory measurably changes downstream agent output (before/after eval).
> H6. If retrieval is built: precision/recall baselines pinned; regressions block ship.
> H7. Every stored item retrievable with provenance and deletable end-to-end (deletion verified
>     by retrieval miss).
> H8. Taint labels survive every hop (store → retrieval → prompt assembly → output attribution);
>     unknown fails closed.
> H9. Suggestion cadence respects an annoyance cap; a rejected suggestion does not recur.

### Closing instruction

> Produce the implementation plan now.

## What it was explicitly NOT given

- No repository access — 0 tool calls in its run; it could not and did not read any file.
- No installed-capability inventory (it did not know `@bridge/dedupe`, the entity-disambiguation
  wiki page, or any other existing package existed).
- No Method layer (M1–M5 did not exist yet — that came from ADR-174, later the same day, in
  response to a different test).
- No mandatory Budget envelope (Layer B also postdates this run).
- No code, types, file paths, test files, or ADRs. Everything above is the complete text.
- No web access, no search.

## What came from the prompt vs. what came from pretraining

This is the honest boundary the correction above is pointing at:

- **From the prompt, mechanically:** the vocabulary (green/amber/red, taint, MemoryStore,
  RunContextAssembler, suggested-then-accepted, ports-only), the nine harness obligations it had
  to satisfy, and the three named risks in the mandate. These directly explain why its plan used
  those exact terms and organized itself around exactly those nine checks.
- **From pretraining, supplying judgment the prompt did not specify:** the actual phase ordering
  (why memory-primitive-first rather than research-first), the specific mitigation designs (the
  claim→evidence map, the sensitivity-tier gate, the closed-port-allowlist idea), and the general
  shape of "how a safety-conscious team builds a learning system" — none of which were spelled out
  in the prompt beyond the abstract invariant names. A model with no exposure to how governed,
  auditable ML/agent systems are typically built (staged rollout, feature flags, injection evals,
  provenance-first data models) would have had much less to draw on even with the identical
  prompt. The convergence is real, but it is convergence of a *capable, broadly-trained model*
  reasoning from a *compact but information-dense* prompt — not convergence from the prompt's
  literal content alone.
