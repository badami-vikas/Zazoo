# Per-class regeneration test — do Skills, Modules, and Integrations need prescriptive packs, or do boundary conditions suffice? (2026-08-14, TASK-042)

Third experiment in the ADR-175 series, executing TASK-042 as pre-authorized by the user
2026-08-04 ("repeat this for skills, capabilities, modules, etc so we have clarity on
structure for each of these (if at all a structure is required, I believe a strong
boundary conditions with autonomy within it might be better approach)").

## Method

Eight isolated agents, two arms per artifact class plus two amendment reruns:

- **FULL arm** — the six-layer pack (canon constitution · contracts + installed-capability
  registry · risk-naming mandate · Layer M · Layer B · class harness).
- **HARNESS-ONLY arm** — the class harness reworded platform-neutrally + a one-sentence
  objective. No constitution, no contracts, no mandate, no M/B. This arm IS the user's
  boundary-conditions hypothesis, run per class.

Ground truths and rubrics: TM3 planning/decomposition Skills (ADR-196/197/198), the
WhatsApp Module (ADR-157/158/159 + K2), the Google Integration (ADR-119/215/222 + K5).
Rubrics were pinned before any output was generated; they are preserved verbatim below
(correcting the 2026-08-04 report's own noted gap, where the rubric lived only in a
scratchpad). Packs fixed the five gaps all three 2026-08-04 agents unanimously
requested: concrete taint lattice, Proposal/Decision shape, MemoryStore op signatures,
consent-surface contract, budget-primitive inventory — the last stated HONESTLY: no
general per-port budget meter exists (`RunBudgetMeter` is an ADR-177 aspiration, not
code), so packs require a capability to name its own enforcing seam.

**Isolation, disclosed exactly:** all eight runs finished with 0 tool calls — no repo
read, no web, no file access. However, subagents inherit the host session's project
instructions (CLAUDE.md) and auto-memory index (~10 one-line task-state entries), and
one run proved this visible by citing "the user's pending keystroke decision (K11)" —
absent from every prompt. Verified by inspection: neither inherited file contains any
design content about any ground-truth artifact, and no graded rubric row's answer
appears in them, so the grading stands. But the harness-only arms' neutrality is
honestly "no platform material IN THE PROMPT", not "no platform context at all"; the
FULL-vs-HARNESS deltas are unaffected since both arms carried identical background.
The 2026-08-04 runs executed under this same envelope.

Cost: 8 runs, ~379k subagent tokens, ~33 min aggregate generation time.

## Pinned rubrics (verbatim, written before generation)

### Skill (vs TM3 decomposition/planning Skills)
- S1 model/deterministic split drawn along "does this output decide structure/placement"
- S2 offline degrade = methodology's own real content, labeled — never filler, never bare-empty
- S3 plane-pinned binding FAILS rather than falling through; failure produces the honest degrade
- S4 model never authors queue identity/ordering/status; computed by code; collisions impossible
- S5 generated options pinned to candidate status; model cannot promote its own suggestion
- S6 missing structural anchor ⇒ refused, not guessed
- S7 provider resolution per call (late binding), never a boot/construction snapshot
- S8 model-calling Skill is authority-bearing, passes the execution taint sink, yields ledgerable receipts
- S9 methodology is versioned governed config; rosters derived, not restated
- S10 malformed output: invalid entries dropped; nothing survives ⇒ honest scaffold

### Module (vs WhatsApp Module)
- M1 exactly one authenticated client; a second (headless) client rejected
- M2 two-layer adapter: named-operations interface + privileged layer owning actual scripts
- M3 containment structural (process/origin/capability), not conventional
- M4 message bodies Local-Plane with local search index; no cloud copy
- M5 caps enforced in the privileged layer, durable, fail-closed; renderer caps recognized as bypassable
- M6 send discipline: recipient-wrote-first consent gate, daily cap, per-recipient cooldown, near-identical refusal, warm-up, kill switch never auto-resumes
- M7 reuse intake with license table; unlicensed/ambiguous/archived rejected on legal grounds; notices carried
- M8 makeshift UI in the platform's design system, NOT a visual replica (trade-dress named)
- M9 cross-plane identity link = key-space lookup joined at render; never an on-disk join
- M10 upstream pinned at build AND health-asserted at session start; drift = visible degraded state
- M11 capture consent default-OFF; captures inspectable/deletable; ToS/ban risk stated honestly

### Integration (vs Google integration)
- I1 PKCE + single-use state + serialized token finalization; vault-only custody
- I2 stage → pending review → human decision → materialize; veto total
- I3 learning/emission moment = post-approval materialization, not sync
- I4 capture envelopes metadata-first, structurally content-incapable (type level)
- I5 one account-shaped consent source, default OFF, fail-closed parse, human-only flips
- I6 deterministic per-source-record ids; replays converge, never duplicate
- I7 post-approval bookkeeping failure logged, never reverses the human decision
- I8 unconfigured fails closed honestly; no fake gateways in prod; fixture-gateway composition seam
- I9 emitted signals inherit the source entity's taint label
- I10 content capture deferred to a separately-gated rung, held out structurally

## Results

| Class | FULL round 1 | HARNESS-ONLY | FULL round 2 (amended) |
|---|---|---|---|
| Skill | 9✓ 1✗ (S7) | 8✓ 1p 1✗ (S6p, S7✗) | 10✓ — S7 closed with a dedicated late-provider test |
| Module | 8✓ 2p 1✗ (M6p, M9p, M8✗) | 8✓ 1p 2✗ (M6p, M8✗, M9✗) | 11✓ — all three closed |
| Integration | 10✓ | 9✓ 1p (I9p) | no amendment needed |

**The headline replicates ADR-175 per class: boundary conditions alone recover the
safety architecture everywhere.** All six round-1 arms independently produced: structural
(not conventional) containment, fail-closed durable caps in the privileged layer,
suggested-then-accepted staging with veto-totality, deterministic-id idempotency,
injection suites from slice 1, honest degraded states. Three harness-only inventions
converge exactly with shipped structural decisions the agents never saw: capability-
exclusion webview containment (ADR-158), apply-time staleness re-validation
(task-materialize.ts, ADR-199), and sensitive-class unrepresentability (K10-E3's "red
untypeable").

**What separates the arms is NOT safety — it is composition and purpose:**

1. **Composition (contracts/registry layer).** Every harness-only arm built a well-made
   island: parallel vocabulary (ProposalSet/TaskReader/Courier), rebuilt staging stores,
   audit logs, consent flags, methodology libraries — all of which exist. Every FULL arm
   slotted into installed capability and confined its build verdict to genuinely-new
   units. This is the ADR-175 B−C finding, now measured at all three class scales.
2. **Purpose (mandate layer).** The Integration harness-only arm produced the cleanest
   demonstration in the series: it quarantined ALL text including subject/counterparty/
   participants — satisfying every stated obligation while quietly deleting the product
   (rhythm mining consumes exactly those attributes; the shipped, user-approved AP-142
   choice). The FULL arm's mandate line "metadata is the product here" is the only
   difference, and it kept the product alive. **A harness can pin safety; it cannot pin
   purpose.**

## Divergence triage

**RULE-GAP (pack amendments made; each traced to ONE missing pack sentence):**
- Contracts layer: provider availability is dynamic (managed local model healthy ~30s
  post-boot); resolution must be per call — BOTH Skill arms shipped construction-time
  resolution, the exact defect ADR-197 fixed. Amended; rerun closed it (S7 ✓✓ with
  `test_late_local_provider_health`).
- Module harness HM4 said "consent-shaped gate" without saying WHOSE consent — both arms
  read it as owner-consent and missed recipient-wrote-first, near-identical refusal, and
  warm-up. Amended with the shipped rule spelled out; rerun closed it.
- Module mandate never named the trademark/trade-dress exposure — both arms missed the
  makeshift-not-replica posture. Amended; rerun regenerated ADR-158's exact stance.
- Module harness HM2 never stated the cross-plane identity principle — amended with
  ADR-159's key-space-lookup/render-time-join rule; rerun converged exactly, including
  "severing is a delete, not a migration".

One amendment round sufficed; Integration needed none. WORSE-attributable-to-pack is
ZERO for all three classes — the TASK-042 prototype-test exit is met by amendment, not
by acceptance.

**BETTER — adopt-candidates on merit (recorded, NOT enacted; each needs its own
pull-forward). Verified against the repo before listing:**
1. *SubstanceGate* (Skill FULL): deterministic generic-filler detection — versioned
   filler lexicon + grounding-ref requirement (≥1 span into task text or methodology
   section) + majority-filler ⇒ full degrade. Shipped ADR-197 drops INVALID entries but
   cannot demote plausible-vacuous filler. Cheap, testable, serves the mandate's
   fabricated-planning risk directly.
2. *Receipt-in-return-type* (Skill both arms): make an unreceipted model call
   unrepresentable at the ModelPort seam — closes the governance-seam residual ADR-197
   records honestly.
3. *Authority-strip logging* (Skill FULL): record `authority_field_stripped` when model
   output carries placement/status fields, instead of silently ignoring.
4. *Encrypted local message store, key in OS keychain* (Module harness-only): directly
   answers ADR-158's recorded accepted limitation ("encryption at rest is NOT solved…
   FileVault is the user's setting, not a guarantee Bridge makes"). Needs a pglite
   feasibility spike.
5. *Type-level taint in the shell* (Module harness-only): tainted-content newtypes with
   no Display, `Sanitized<T>` constructible only by the sanitizer, quoted-envelope as
   the only prompt render path, CI lint on escapes.
6. *Egress-path registry with completeness lint* (Module harness-only): every off-device
   API must register with the egress guard or CI fails — E1's allowlist idea applied to
   desktop egress.
7. *Transactional outbox for post-approval side effects* (Integration both arms):
   durable, observable retry with immutable decision rows — upgrades shipped
   catch-and-log + replay-self-heal.
8. *Opaque Secret type + canary-token sweep* (Integration both arms): token material
   unserializable/unloggable at the type level; CI canary scan over every sink.
9. *Metadata-only OAuth scopes* (Integration FULL): `gmail.metadata` +
   `calendar.events.readonly` make bodies unfetchable at the CREDENTIAL level, beneath
   the type-level ban. VERIFIED: shipped requests `gmail.readonly` +
   `gmail.drafts.create` + `calendar.events` (contracts.ts) — broader, but legitimately:
   the intake renders thread content at review and the write pipeline drafts. Scope
   reduction would change the product; a user decision, not a force-fit.
10. *No-exported-setter consent* (Integration harness-only): human-only flips enforced
    by API-surface absence.

**Already-shipped convergences (checked, not gaps):** apply-time staleness/version check
(task-materialize.ts:477, ADR-199); Gmail snippet exclusion (ADR-222's envelope types);
red-class untypeability (K10-E3); rejection-fingerprint suppression (K10-E5).

**BLOAT signals:** none against shipped code. Both Skill arms built ONE parameterized
decompose skill where TM3 shipped four — but the Playbook library already carries the
methodology parameterization, so this reads as convergent simplification already
available, not a defect. No plan reproduced anything the 2026-08-04 BLOAT list already
flagged.

## Per-class structure verdicts (the TASK-042 outcome)

- **Skill: the boundary-conditions hypothesis HOLDS, with one prescriptive addition.**
  Harness-only recovered effectively all class safety; what it cost was composition
  (island rebuild). Minimum viable pack for a Skill: **class harness + contracts/
  installed-capability registry**. Constitution and mandate add polish, not protection,
  at this scale; M and B remain cheap and worth carrying.
- **Module: prescriptive structure WARRANTED — specifically the risk-naming mandate and
  a complete domain harness.** The class carries legal/counterparty context (ToS
  exposure, trade-dress, whose-consent semantics) that no arm derived until a pack
  sentence named it — and once named, either arm carried it. The harness can hold
  anything, but only the mandate/harness author's ground-truth knowledge puts it there.
- **Integration: prescriptive structure WARRANTED — the mandate is load-bearing for
  PURPOSE.** Obligations alone produced a design that was safe and wrong (product
  deleted by over-quarantine). The mandate's one product-framing sentence was the
  difference between the two arms' fitness to ship.

**Series-level finding:** the harness pins safety at every class; the mandate's value
scales with how much non-derivable context (legal, counterparty, product-purpose) the
class carries — near-zero for Skills, decisive for Modules and Integrations. The
contracts/registry layer earns its place at every class by preventing island rebuilds.
Amendment converges fast: every round-1 WORSE traced to exactly one missing pack
sentence, and one rerun closed each class.

## Scope notes

- TASK-042's roster-cleanup line ("foundational-agents.md '5 Agents' vs canon 4") was
  already resolved the other way by ADR-176 (roster settled at FIVE; learning-agent.md
  fixed; foundational-agents.md was correct) — recorded here as satisfied-before-start,
  nothing redone.
- The Module rerun's open-items independently surfaced the send-side synthetic-input
  question ("if keystroke injection is disallowed, automation degrades to assist-only")
  — the same decision class as the user's pending K11 capture-side keystroke call.
  Recorded as context for that decision, not pressure on it.
- BETTER candidates above are recorded, not enacted: no TASK rows created, no code
  changed. Pulling any forward is an APPROVALS-gated user decision (ADR-176 precedent).

## What this unblocks

K9 rung 4 (structure synthesis "via the validated input-pack regeneration methodology",
TASK-053) was blocked on these packs existing and being validated. They now exist as
canon (`docs/raw/capability-input-packs-2026-08.md`) with per-class validation evidence.
