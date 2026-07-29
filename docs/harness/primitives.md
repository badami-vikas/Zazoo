---
title: Bridge Engine Primitives — definition, current state, and improvement roadmap
type: raw
doc_kind: reference
status: draft
companions: [comparative-analysis.md, learnings-and-next-steps.md]
related_wiki: harness.md
updated: 2026-07-29
tags: [harness, engine, primitives, architecture, governance, roadmap]
---

# Bridge Engine Primitives

One entry per harness primitive: its canonical definition, where it lives, **what exists today**,
**what is stubbed or absent**, and a **roadmap**. Every status claim carries a `file:line` citation
and was verified against the code on **2026-07-29**, not inferred from documentation.

Canonical names come from [`docs/glossary.md`](../glossary.md). Where code and canon disagree, §14
records the correction rather than silently picking a side.

Paths are relative to the worktree root; `platform/` prefixes are omitted inside citations where
unambiguous.

## Reading the status labels

```yaml
labels:
  SHIPPED: implemented, wired into the API, and exercised by at least one surface or test
  PARTIAL: implemented but with a named gap that changes its guarantees
  CONTRACT-ONLY: types and ports exist; no production adapter is bound
  ABSENT: named in canon, no implementation
  EPHEMERAL: implemented but in-memory in BOTH deployment modes — lost on restart
```

`EPHEMERAL` is called out separately because it is the single most common failure pattern in the
current Engine, and in every case the code says so honestly rather than faking durability.

---

# A. Execution core

## A1. Action Pipeline — propose → decide → commit

**Canon.** *Run* — "deterministic, attributable, replayable execution of an approved Plan";
*Action* — "atomic governed operation within a Run"; *Decision* — "recorded governance verdict"
(glossary 36–38).

**Defined.** `packages/core/src/pipeline.ts:256` — `UniversalActionPipeline`. Port bundle
`PipelineDeps` at `pipeline.ts:48`: `{authority, policies, skills, ledger, events, variance,
skillManifests?, goalTasks?, taintAudit?}`.

**Status: SHIPPED.** This is Bridge's strongest primitive and the one with the clearest advantage
over the field.

Ten ordered phases in `propose`, all verified:

```yaml
propose_phases:
  1: turn taint join                       # pipeline.ts:270-286
  2: resolveAuthority                      # pipeline.ts:288-303
  3: policies.evaluate(phase "pre")        # pipeline.ts:306-318
  4: skill lookup + agent allowedSkills    # pipeline.ts:321-331
  5: AGS1 governed-skill gate (fails closed) # pipeline.ts:343-420
  6: taint sink pre-check                  # pipeline.ts:422-455
  7: skill.run() -> proposedOutput         # pipeline.ts:456  (NOT committed)
  8: policies.evaluate(phase "runtime")    # pipeline.ts:476-499
  9: PI-2 structural tainted-egress gate   # pipeline.ts:507-531
  10: review gate -> pending, or auto-commit # pipeline.ts:536-570
```

Three properties are worth naming explicitly because the comparative analysis shows they are rare:

- **Agents always draft.** `requiresApproval()` at `pipeline.ts:214` ends with
  `return actorType === "agent"` — unconditional. No prompt can relax it.
- **Approval never re-executes.** The Skill runs once at phase 7 producing `proposedOutput`, which
  is held and committed only after the Decision. LangGraph's `interrupt()` re-runs the node from
  the top and its own docs warn that side effects duplicate; Bridge is structurally immune to that
  entire bug class. This is an advantage nobody has written down before.
- **Append-only decisions.** `decide` never mutates; it appends a new row with `refLedgerId`
  (`pipeline.ts:687-722`), guarded by the partial unique index `ledger_ref_ledger_id_resolved_uq`
  and typed `AlreadyResolvedError` (`pipeline.ts:179` → HTTP 409).

Honest design choices already in the code: post-commit policy is *provably* advisory —
`toPostCommitResults` (`pipeline.ts:240`) drops `block`/`require_approval` with a warning, and the
type `PostCommitEffect` (`types.ts:156`) makes it unrepresentable. One permanent escape hatch,
`KERNEL_PASSTHROUGH_SKILL = "stageMutation"` (`pipeline.ts:169`), is exempt from AGS1 **only for
non-agent actors** (`pipeline.ts:347`).

**Gap.** `LedgerEntry.executionSnapshot` (`types.ts:246`) has **no writer anywhere** and **no
database column** — there is no `execution_snapshot` in `packages/db/src/schema.ts`. Only
`eval/aqv.ts:75-97` reads it. Two of the seven Agent Quality Vector axes therefore have no data
source in production.

```yaml
roadmap_A1:
  - id: A1-R1
    priority: P1
    change: Write the execution snapshot the pipeline already has in hand
    why: >
      Unblocks the reliability and efficiency AQV axes, and is the prerequisite for any replay
      driver. The pipeline already holds every field at commit time.
    scope: add an execution_snapshot column, write it in #commit, keep it taint-labelled and prompt-free
    evidence: types.ts:246 declared; zero writers; no schema column
  - id: A1-R2
    priority: P2
    change: Register a deterministic pre/post-Action hook surface for Module authors
    why: >
      Every mature harness converged on hooks running OUTSIDE the model context as the way to
      express deterministic policy. Bridge's guard/ and policy/ layers already run there, but a
      Module author cannot register one.
    caution: hooks must not become a second authority path — they extend guard, never grant
  - id: A1-R3
    priority: P3
    change: Document the no-re-execution property as a stated invariant with a pinning test
    why: it is a real differentiator against LangGraph and is currently only implicit in the code
```

## A2. Run Context / Prompt Assembler

**Canon.** *Context* — "authorized subset of Memory assembled for an actor and Request… temporary
and does not become a second durable data model" (glossary 111); *Prompt Assembler* (glossary 120).
ADR-027 supersedes the name "PromptAssembler" (`run-context.ts:1-6`).

**Defined.** `packages/core/src/run-context.ts` — `ModelRunContext` (`:220`),
`assembleRunContext` (`:272`, pure, uses injected `runCtx.ids`/`runCtx.clock`), `projectToPrompt`
(`:305`), `KERNEL_INVARIANTS` (`:394`, injected into every system prompt, includes the no-dummy-data
rule).

**Status: PARTIAL.** Assembly works. Bounding does not degrade gracefully.

`boundedConversationHistory` (`run-context.ts:172-207`) enforces `MAX_CONVERSATION_SEGMENTS = 24`,
`MAX_CONVERSATION_SEGMENT_CHARS = 16_000`, `MAX_CONVERSATION_HISTORY_CHARS = 64_000` — and
**throws** on overflow (`:184`, `:200`). It does not summarize, truncate, or compact. A long
conversation is a hard error, not a managed condition.

Naming hazard: `types.ts:88 RunContext` is a *different, smaller* type — the ephemeral-grant context.
`run-context.ts:16-23` documents the deliberate avoidance; keep it.

```yaml
roadmap_A2:
  - id: A2-R1
    priority: P0
    change: Replace the throw with a governed compaction path
    why: >
      Every surveyed harness compacts. Bridge is the only one that fails the conversation instead.
      This is the most user-visible harness gap.
    design_constraint: >
      Compaction must be a governed Action producing an inspectable Memory artifact, not a hidden
      subroutine. opencode models compaction as an AGENT, which fits Bridge's ontology exactly:
      an Engine compression family invoked through an attributable Agent Run.
    caution: >
      Compaction is lossy everywhere and nobody has solved it. Anthropic's finding is that
      compaction ALONE is insufficient for long work — the durable artifact (structured progress
      file) does the real work. Bridge's equivalent artifact is Memory plus the Ledger, which it
      already has.
  - id: A2-R2
    priority: P2
    change: Quantify the context budget the way Codex does
    why: >
      Codex caps its skills index at 2% of the model context or 8,000 chars and truncates
      descriptions first. Bridge has stated context discipline as a principle and never given it a
      number.
  - id: A2-R3
    priority: P2
    change: Add taint-aware context eviction ordering
    why: >
      When the budget is exceeded, the safest thing to drop first is the most tainted, least
      provenance-bearing content. Bridge is the only harness with the labels to do this.
```

## A3. Determinism seam

**Defined.** `packages/core/src/determinism.ts` — `Clock` (`:10`), `Rng` (`:17`), `IdGen` (`:27`),
`FixedClock` (`:32`), `SystemClock` (`:51` — "The ONLY place `Date.now` is allowed"), `SeededRng`
(`:61`, mulberry32), `UlidGen` (`:84`), `UuidGen` (`:116`), `uuidv7()` (`:171`, the intentionally
non-deterministic Postgres column default).

**Status: SHIPPED as a seam, ABSENT as a capability.**

Replay is *possible by construction* — every id and timestamp is injected via `RunCtx`
(`ports.ts:28`). But **nothing in `platform/` re-executes a ledger row against a `FixedClock` +
`SeededRng`.** `eval/scorers.ts:23 replayDeterminismScorer` only compares outputs that were already
produced; it does not replay.

```yaml
roadmap_A3:
  - id: A3-R1
    priority: P1
    change: Build the replay driver
    why: >
      The glossary defines a Run as "replayable". Today that is an aspiration. The seam is already
      paid for — this is the cheapest large capability gain available.
    depends_on: A1-R1 (execution snapshot)
    scope: >
      Re-execute a ledger entry against FixedClock + SeededRng + recorded inputs, diff the output,
      and record a replay Result. Start read-only; never re-commit.
  - id: A3-R2
    priority: P3
    change: Add a replay regression gate in CI over a held-out set of recorded Runs
    why: >
      Temporal's replay tests are the standard guard before deploy. Bridge has no equivalent
      protection against a Skill change silently breaking historical reproducibility.
```

## A4. Ports and Adapters

**Canon.** *Ports and Adapters* (glossary 107).

**Defined.** `packages/core/src/ports.ts` (583 lines) — `RunCtx` (`:28`), `RoleQuery` (`:42`),
`AgentQuery` (`:51`), `EphemeralQuery` (`:76`), `PolicyStore` (`:103`), `LedgerStore` (`:107`),
`LocalMediaStore` (`:174`), `EventBus` (`:183`), `ModelProvider` (`:353`), `Skill`/`SkillRegistry`
(`:491`/`:499`), `VarianceAdjuster` (`:508`), `AutomationRegistry` (`:550`), `AutomationRunRecorder`
(`:568`). In-memory adapters in `memory/stores.ts`; Drizzle adapters in `@bridge/db`; Local-Plane
adapters in `@bridge/local`.

**Status: SHIPPED.** This is the primitive that makes everything else replaceable, and the
comparative analysis validates it: AutoGen's headline property — the same agent code running
standalone or distributed — is what ports buy, and the 2026 vendor-churn record (§7 of the
comparative analysis) makes port discipline a survival trait rather than an aesthetic one.

**Gap.** Six ports are bound to in-memory adapters in **both** deployment modes. Every one is
flagged honestly in the code:

```yaml
ephemeral_bindings:
  - port: AutoActivationBudgetStore + KillSwitch
    site: wiring.ts:4326-4327 (declared wiring.ts:393-396)
    consequence: activation budgets and the kill switch reset on restart
  - port: EvalStore
    site: wiring.ts:4707 (declared wiring.ts:405-409)
    consequence: no eval history survives a deploy
  - port: PolicyParamStore
    site: wiring.ts:4708 (declared wiring.ts:410-413)
    consequence: every governed parameter nudge is lost; defaults-only in practice
  - port: CredentialBroker
    site: wiring.ts:4328
    consequence: grants do not survive restart
  - port: SkillManifestRegistry
    site: wiring.ts:3600
    consequence: manifests are re-seeded rather than read from skill_manifests
  - port: OnboardingProfile (cloud/ephemeral modes)
    site: wiring.ts:4331-4334
```

```yaml
roadmap_A4:
  - id: A4-R1
    priority: P1
    change: Bind Drizzle adapters for PolicyParamStore, EvalStore, and the budget/kill-switch stores
    why: >
      Three separate governance capabilities are silently defaults-only because their state does not
      survive a restart. A Kill Switch that forgets it was pulled is worse than none, because the
      operator believes it holds.
    note: the tables largely exist; this is a binding gap, not a schema gap
```

---

# B. Authority and governance

## B1. Authority resolver

**Canon.** *Authority Decision*, *Capability-Based Access Control (CBAC)*, *Explicit Deny*,
*Ephemeral Grant*, *Delegation* (glossary 81–88).

**Defined.** `packages/core/src/authority.ts:380` — `resolveAuthority(args, deps)`.

**Status: SHIPPED.** Five ordered layers, verified:

```yaml
layers:
  L0:   agentFloorDeny            # authority.ts:388 — non-removable
  L0.5: planeGate + cloud clamp   # authority.ts:393-397 — requested ∩ "public"
  L1:   evaluateAgentRoleScope    # authority.ts:179 — capability_scope ∩ role grants; role deny wins
  L2:   evaluateEphemeralGrant    # authority.ts:222 — base ∪ active ephemeral; deny wins
  L3:   computeAgentDataScope     # authority.ts:266 — requested ∩ agent ceiling ∩ granted
  L4:   evaluateDelegation        # authority.ts:292 — ∩ principal's authority
human_path: role ∪ direct grants − deny, ceiling "all"   # authority.ts:403-419
```

The clock is injected (`nowISO`, `authority.ts:120`), so ephemeral-grant expiry is deterministic and
testable. Scope tokens support exact, `type:*`, `*:action`, and `*` (`authority.ts:80-92`).

**Gap.** `grantsForRole` is flat — **no role inheritance**. `RoleQuery`/`AgentQuery`
(`ports.ts:42-74`) are read-only. GA6 items in `docs/wiki/governance-agent.md:49` (role inheritance,
persisted `ephemeral_grants`, role-routed audiences) remain unbuilt.

```yaml
roadmap_B1:
  - id: B1-R1
    priority: P2
    change: Role inheritance in the resolver
  - id: B1-R2
    priority: P2
    change: Persist ephemeral_grants
    why: an Ephemeral Grant that survives restart is either a durable grant or a bug; today it is neither by accident
```

## B2. Agent Floor Deny

**Canon.** *Agent Floor Deny* — "non-removable minimum restrictions applied to every Agent"
(glossary 86).

**Defined.** `packages/core/src/agent-floor.ts` — the single source of truth.
`AGENT_FLOOR_PROTECTED_RESOURCES` (`:23-34`), `AGENT_FLOOR_MUTATIONS` (`:37-45`),
`AGENT_FLOOR_ALWAYS_DENIED_SCOPES` (`:52-56`: `external:send`, `network_graph:full`),
`isAgentFloorDenied` (`:84`), `isForbiddenAgentToken` (`:73`, also denies `"*"`).

**Status: SHIPPED, and better than the docs say.** Four enforcement sites, all *derived* from the
one module rather than copied: the runtime layer-0 check (`authority.ts:39`), construction-time
stripping (`agent-scope.ts:67`, which reports into `dropped[]`), the standing-grant refusal in
`packages/db/src/integration-store.ts`, and the AGS1 structural exemption
(`pipeline.ts:346`, which *reuses* floor membership as the definition of "Human-only"). The module
header (`:1-14`) documents the prior three-way drift that this consolidation fixed.

**Correction.** `docs/wiki/governance-agent.md:5-6` claims Governance is the "sole audited exception
to agent-floor approve-DENY". **It is not.** `pipeline.decide` floor-denies *every* agent
unconditionally with no decider-identity carve-out (`pipeline.ts:643-667`), and even appends an
audit row before throwing (`:645-667`). The real carve-out lives entirely outside the ledger:
`trpc.capability.governanceAutoApprove` (`apps/api/src/router.ts:13032`) advances a capability's
*lifecycle state* for the `minor` band only, and its own comment states it "does NOT make an agent
the ledger decider" (`router.ts:13021-13030`). **GA3 as specified is not shipped**, and the current
state is the safer one.

```yaml
roadmap_B2:
  - id: B2-R1
    priority: P1
    change: Correct docs/wiki/governance-agent.md to match the code
    why: a doc claiming a security carve-out exists when it does not is a governance defect in itself
  - id: B2-R2
    priority: P3
    change: If GA3 is still wanted, specify it as dual-keyed and budgeted before building
    note: the field's LLM-as-approver experiments are unsettled; Cursor disclaims its own as not a security boundary
```

## B3. Plane Gate and residency

**Canon.** *Local Plane*, *Cloud Plane*, *Plane Gate*, *Event Partitioning* (glossary 96–98, 106).

**Defined.** `planeGate(actor, resourceType)` at `authority.ts:72-78`;
`EGRESS_RESOURCES = {external:send, external:fetch}` (`:57`); default plane `local` (`:73`); cloud
clamp `intersectDataScope(requested, "public")` (`:396`). Egress tiers at agent construction:
`agent-scope.ts:26-45` — `none | read-graph | draft-graph | source-internet`, with `external:send`
**in no tier** (`:30-32`). Local storage: `packages/local/src/ports.ts` plus `stores/pglite.ts`
(833 lines) — `SecretStore`, `BodyStore`, `LocalGraphStore`. Model-plane routing in
`packages/models/src/router.ts:1-19`: a `local` binding **fails loud** rather than falling through
to cloud; `cloud` may fall back to local, because "falling toward MORE privacy is always safe."

**Status: SHIPPED.** This is a genuine differentiator. The comparative analysis found only two
narrower equivalents in the entire field (Microsoft Foundry's customer-subscription state, Temporal's
Codec Server), and Relay.app's 2026 shutdown is the live demonstration of what a cloud-only control
plane costs the customer.

```yaml
roadmap_B3:
  - id: B3-R1
    priority: P2
    change: Adopt Temporal's Codec Server pattern for Plane Gate audit
    why: >
      Temporal encrypts payloads client-side and runs a customer-hosted codec server so the UI can
      display plaintext WITHOUT the payload leaving the customer boundary. That is precisely the
      Local Plane's problem — remaining auditable without egressing — and it is a solved design.
  - id: B3-R2
    priority: P2
    change: Adopt Codex's two-phase credential-stripping execution
    why: >
      Setup phase has network and secrets; both are removed before the agent phase runs. It is a
      cheap, strong structural answer to the Lethal Trifecta that complements taint labelling
      instead of duplicating it.
```

## B4. Data Scope

**Canon.** *Data Scope* (glossary 88).

**Defined.** `packages/core/src/data-scope.ts` — `DataScope = "all" | "public" | "private"` (`:16`),
`EffectiveDataScope` adds `"none"` (`:19`), `intersectDataScope` (`:22`, where
`public ∩ private = none` ⇒ deny), `unionDataScope` (`:34`), `tiersFor` (`:49`).

**Status: SHIPPED.** Consumed at `authority.ts:275,349,396,410`, `agent-scope.ts:126`,
`skill-manifest.ts:290-300`, and in `child-agent-run.ts` narrowing. Every ledger row carries its
`dataScope`.

Together with Review Mode this is Bridge's version of the capability × approval split that Codex
states most cleanly — arrived at independently, from governance rather than from OS sandboxing.

## B5. Capability Trust Model

**Canon.** *Capability Trust Model*, *Risk Band*, *Origin*, *Audience*, *Composite Risk*,
*Lethal Trifecta*, *Capability State*, *Trusted Status*, *Auto Mode*, *Activation Budget*,
*Kill Switch* (glossary 70–80).

**Defined.** `packages/core/src/capability/` — `types.ts` (bands, origins, audiences, states,
manifests), `risk.ts:99 computeRisk` (composite = max over a cycle-safe dependency closure),
`module/risk.ts:53 moduleHasLethalTrifecta` (escalates on the **union** across bundled capabilities,
"even if no SINGLE capability carries all three legs"), `approvals.ts:92 requiredApproval` (External
hard floor checked first and returns unconditionally, `:98`), `lifecycle.ts` (`advance` `:136`,
`demoteOnDependencyChange` `:165`, `suspendOnFailure` `:188` with no approval because "safety never
queues", `resumeFromSuspension` `:195` requiring approval).

Two design details worth preserving: `ORIGIN_TRUST_TIER` pins `community: 0` **equal to**
`user_code: 0` (`approvals.ts:26-32`, PKG-2), and audience can only *raise* the requirement
(`raiseForAudience`, `:79`) — "Informational × shared ≠ auto".

**Status: PARTIAL — the mechanisms are built and the inputs are empty.** This is the single largest
gap between Bridge's documented governance and its running governance.

```yaml
verified_gaps_B5:
  - gap: trustGrants is hardcoded [] at BOTH live call sites
    sites:
      - router.ts:12951  # "trust_grants lookup is a store-layer follow-up; none in force yet"
      - router.ts:13423  # "store-layer follow-up (same gap capability.activate has)"
      - router.ts:4213   # trustGrants: [] passed into assembleRunContext for chat
    note: >
      The trust_grants table exists (packages/db/src/schema.ts:1329) and is never read. The PKG-2
      origin floor is structurally correct but currently a no-op, because it filters an empty list.
    consequence: Trusted Status — the entire earned-autonomy mechanism — cannot take effect
  - gap: budgets and kill switch are in-memory in BOTH modes
    site: wiring.ts:4326-4327, declared wiring.ts:393-396
    consequence: >
      Activation Budget resets on restart, and a pulled Kill Switch is forgotten. GA2's
      "budgets -> policy_params (survive restart)" is not done.
  - gap: trust decay is entirely undefined
    note: docs/wiki/undefined-elements.md ranks this #10; lifecycle.ts:1-22 states a 90-day TTL in a header comment
  - gap: no web or desktop surface
    evidence: grep for trpc.capability in apps/web/src returns nothing
```

```yaml
roadmap_B5:
  - id: B5-R1
    priority: P0
    change: Read trust_grants at the three call sites and persist budgets and the kill switch
    why: >
      Until this lands, the Capability Trust Model is a well-built machine with its inputs wired to
      constants. Everything downstream — Trusted Status, earned autonomy, Auto Mode — is inert.
    size: small; the table, the types, and the filter function all already exist
  - id: B5-R2
    priority: P1
    change: Specify and implement trust decay
    why: >
      "Time-limited property... decays or resets after material change or violation" (glossary 77)
      has no implementation. AG2's independently-invented "Resume" — capability claims plus observed
      track record — is the closest external analogue and is worth reading before designing.
  - id: B5-R3
    priority: P2
    change: Surface capability state in the product
    why: an inspectable trust model the user cannot see is not inspectable
```

## B6. Policy layer and Variance Adjustment

**Canon.** *Variance Adjustment* — "governed proposal to tune bounded policy parameters from
observed outcomes. It cannot alter hard limits or code silently" (glossary 92).

**Defined.** `PolicyStore.evaluate` (`ports.ts:86`), phases `pre|runtime|post` (`types.ts:134`),
effects `allow|block|require_approval` (`:135`). `policy/variance-adjuster.ts:39
proposeVarianceAdjustment` requires `minVetoes = 3` (`:61`) and always returns
`{governed: true, applied: false}` (`:29-30`). `policy/params.ts` — `TunableParam {value, floor,
ceil}` (`:29`), `AqvGates` (`:41`), with a header (`:13-19`) stating that hard ceilings are
**deliberately not representable**: the agent-floor DENY, the External-band human floor, and the
lethal-trifecta escalation "the adjuster physically cannot relax."

**Status: PARTIAL.** The default `VarianceAdjuster` binding is `RecordingVarianceAdjuster`
(`memory/stores.ts:496`) — **it records, it does not learn**. `CHIP_PARAM_MAP`
(`variance-adjuster.ts:9-12`) currently maps exactly **two** feedback chips
(`too_casual`/`too_formal` → `tone_threshold`). `InMemoryPolicyParamStore` (`wiring.ts:4708`) is
defaults-only in both modes.

Approval levels L0–L3 from `docs/wiki/rituals.md:24` are only partly real: L0/L1/L2 map onto
`ReviewMode` `auto|notify|approve`, but **L3 quorum has no counting mechanism** (see B7).

```yaml
roadmap_B6:
  - id: B6-R1
    priority: P2
    change: Persist PolicyParamStore, then expand CHIP_PARAM_MAP beyond two chips
    order_matters: expanding the map before persisting produces proposals that vanish on restart
  - id: B6-R2
    priority: P3
    change: Keep the unrepresentable-ceiling design and add a test that pins it
```

## B7. Review Mode

**Canon.** *Review Mode* — "computed handling requirement: `auto`, `notify`, `approve`, or `quorum`
… resolved from risk, authority, trust, audience, data scope, side effects, and Organization policy,
then recorded with its reasons" (glossary 35).

**Defined.** `child-agent-run.ts:34` with monotone `stricterReviewMode` (`:40`).

**Status: PARTIAL — two named gaps.**

- **`quorum` is representable but unimplemented.** `pipeline.decide` resolves on the *first*
  decision row and throws `AlreadyResolvedError` on a second (`pipeline.ts:679-682`). Nothing counts
  approvers. L3 dual-key/quorum is a type value only.
- **No approval SLA semantics.** Review Mode computes *whether* approval is needed. It does not say
  by whom, by when, with what reminders, or what happens on expiry.

The second gap is the clearest lesson from the now-shutting-down Relay.app, whose approval step
carried assignee (workspace member, arbitrary email, or Slack channel), due date, reminders,
run-owner notification, and an explicit escalation choice of skip / end / reassign. An approval that
nobody owns and that never escalates is a silent stall — precisely the condition Bridge's Failure
Event model exists to route.

```yaml
roadmap_B7:
  - id: B7-R1
    priority: P1
    change: Add assignee, due date, reminders, and escalation behaviour to the approval object
    why: >
      Review Mode is incomplete without accountability. This is a small, high-value addition and the
      external design to copy is fully documented.
    escalation_options: skip | end | reassign   # Relay.app's set; all three are defensible
  - id: B7-R2
    priority: P2
    change: Implement quorum counting, or remove "quorum" from the type
    why: >
      A representable-but-unimplemented governance mode is worse than an absent one, because callers
      may set it believing it holds. Either build the counter or make it unrepresentable.
  - id: B7-R3
    priority: P1
    change: Define the crash-survival contract for pending approvals
    why: >
      MAF saves pending requests IN the checkpoint and re-emits them on restore. Bridge's pending
      proposals live in the ledger, which is durable — but the contract is undocumented and untested.
```

## B8. Ledger and Decision Trace

**Canon.** *Ledger* — "append-only audit record"; *Decision Trace* — "inspectable explanation of the
inputs, policy version, reasons, and evidence" (glossary 89–90).

**Defined.** `LedgerEntry` (`types.ts:225`), `LedgerStore` (`ports.ts:107-133`). Resolution is the
*existence of a referencing decision row*, never a status flip (`ports.ts:111-116`) —
`ledger ||--o{ ledger : "ref_ledger_id"`.

**Status: Ledger SHIPPED. Decision Trace ABSENT.**

The `decision_traces` table exists — `packages/db/src/schema.ts:1091-1098`
(`{id, ledgerId, signals, context, reasoning, outcome}`) — and is **never written or read by any
runtime code**. `grep -rn "decisionTraces"` across `platform/apps` and `platform/packages` returns
only the schema definition. `docs/wiki/rituals.md:20`'s claim that "explainability =
`decision_traces`" is aspirational.

The web client declares a matching `DecisionTrace` interface in
`apps/web/src/app/data/governance.ts:17`, whose file header still reads "Governance mock data" —
but the header is stale, not a violation: every exported array is **empty**
(`pendingApprovals: LedgerEntry[] = []` at `:69`, `ledgerHistory` at `:73`, `delegations` at `:79`),
and `ApprovalsPage`/`ExecutionLedger` load real data through `loadPendingApprovals` and `loadLedger`.
`docs/dummy.md:253` already records these as typed API/empty-state adapters rather than seeded
product data. The only defect is the misleading header comment.

The real explainability surface today is `LedgerEntry.policyResults` plus `AuthorityDecision.reason`
— which is genuinely good, and better than any external trace at explaining *authority*. It is just
not the Decision Trace the docs describe.

```yaml
roadmap_B8:
  - id: B8-R1
    priority: P1
    change: Write decision_traces from the data resolveAuthority already returns
    why: >
      "Trust first" and "explain before automating" are stated principles. The table is designed and
      the inputs already exist — resolveAuthority returns them and the pipeline discards them.
    also: fix the stale "Governance mock data" header in apps/web/src/app/data/governance.ts:1 — the arrays are empty and the file is an empty-state adapter
```

## B9. Governance layer and org health

**Defined.** `packages/core/src/governance/org-health.ts` — `ApprovalBand` (`:3`),
`classifyApprovalBand` (`:46`, dual-keyed on the two lowest risk bands **and** built-in/template
origin), `canGovernanceAutoApprove` (`:58`), `rollupOrgHealth` (`:62`) →
`{autonomyPressure, trustDebt, approvalLoad, violationTrend}`.

**Status: PARTIAL, honestly.** `router.ts:13103` passes `violationSeries: []` with the comment
"honest empty until a violation-history view lands (no fabricated data — see CLAUDE.md's
no-dummy-data rule)" (`:13070-13073`). So `violationTrend` is always flat. GA4 was blocked on the
EVAL-1 reducers; those now exist (`eval/aqv.ts`), so only the violation-history view is missing.

```yaml
roadmap_B9:
  - id: B9-R1
    priority: P2
    change: Build the violation-history view and unblock violationTrend
    note: the honest-empty handling is correct and should be preserved as the pattern
```

---

# C. Actors and capabilities

## C1. Agent

**Canon.** *Agent* — "bounded reasoning actor with a mandate, capability scope, attributable
activity, and explicit Skill set. Only Agents consume Skills" (glossary 48).

**Defined.** `packages/core/src/agents.ts:64 FOUNDATIONAL_AGENTS` — four ids (`:39`): `learning`,
`internal_strategist`, `governance`, `capability_builder`. Chief of Staff is deliberately **not** in
the registry — "it IS the router, not a routable target" (`agents.ts:5-7`).

**Status: PARTIAL — the governance around Agents is real; the Agent itself is thin.**

`invokeAgent` (`agents.ts:260`) is a **one-shot, 512-token model call**, tier `reasoning`, with a
stable-system-prefix cache (`:265-274`) and an honest offline fallback (`:275`). Its own comment:
"This function performs NO write and holds NO pipeline handle" (`:255-259`). This confirms
`docs/wiki/governance-agent.md:10-11` verbatim — agent identity is a prompt plus one model call,
touching zero kernel functions.

`CAPABILITY_BUILDER_DESIGN_CONSTRAINTS` (`:158`) with `checkDesignConstraintViolations` (`:295`) is
a **textual regex check surfaced to the approver, never a gate** (`:283-292`) — correctly labelled.

Surfaces: `trpc.agent.{create,update}` (`router.ts:8085,8139`) — **API-only, no web caller**.

```yaml
roadmap_C1:
  - id: C1-R1
    priority: P2
    change: Decide explicitly whether Agents get a tool loop, and write the decision down
    why: >
      Today there is no agentic tool-calling loop anywhere in the kernel (see F1). That is
      defensible — docs/wiki/rituals.md:34 says the Planner proposes a DAG and a governed DAG
      executes — but the Planner half is also unbuilt (C6), so the current state is neither design.
      This is the biggest unresolved architectural question in the Engine.
  - id: C1-R2
    priority: P3
    change: Give Agents a product surface
    why: ten Agents exist in manifests and none is reachable from the web client
```

## C2. Skill

**Canon.** *Skill* — "governed, versioned, callable capability that performs one bounded Goal/Task
job for an eligible Agent… a Human or Automation never invokes it directly, and it never schedules
itself" (glossary 54).

**Two distinct things are named "skill" in the code, and both are correct:**

**(a) The executable unit.** `ports.ts:491` — `{name, executionClass?, run(inputs, ctx)}`.
`executionClass` (`pure_data | authority_bearing`) is consumed at `pipeline.ts:439`, where a
non-`pure_data` Skill triggers a `skill_execution` taint-sink evaluation.

**(b) The governance contract (AGS1).** `skill-manifest.ts:42-67` — `SkillManifest` carrying
`goalTypes`, `taskTypes`, schemas, `permissions` (a **requirement, never a grant**, `:32-34`),
`plane`, `dataScopes`, `riskBand`, `budget`, `evalVersion`, `defaultAgents` (**UI preference only**,
`:42-44`), `requiredIntegrations`, and `childRunPolicy` (absent = forbidden, `:10-12`).

**Status: SHIPPED, and materially stricter than the field's `SKILL.md`.** The resolver
`resolveSkillForTask` (`skill-manifest.ts:209`) runs six ordered deny-by-default gates and returns a
typed failure reason plus a full `alternativesRejected[]`:

```yaml
skill_resolution_gates:
  1: org/goal/task/agent coherence, task active, agent active   # :236-256
  2: goalType and taskType match                                # :258-262
  3: task.assignedAgentId === agent.id                          # :267-273 "default Agent access never overrides assignment"
  4: agent.capabilityScope ⊇ manifest.permissions               # :276-280
  5: plane, data scope, daily call budget                       # :283-310
  6: highest eligible version wins                              # :315-325
```

This directly answers the strongest negative finding in the literature. arXiv 2604.04323 measured
skill benefits degrading toward the no-skill baseline as retrieval became realistic over 34,000
skills — because model-discretionary skill *selection* is the bottleneck. Bridge does not let the
model select: the Goal/Task assignment does, deterministically. That is the recommended mitigation,
built before the paper existed.

**Gap.** `InMemorySkillManifestRegistry` is wired in both modes (`wiring.ts:3600`) even though a
`skill_manifests` table exists. `SkillBudget.maxCostPerDay` (`skill-manifest.ts:27`) is **declared
but never read** — only `maxCallsPerDay` is checked (`:303-310`).

```yaml
roadmap_C2:
  - id: C2-R1
    priority: P1
    change: Bind the Drizzle SkillManifestRegistry
  - id: C2-R2
    priority: P1
    change: Enforce maxCostPerDay, or delete the field
    why: a declared budget that is never read is a false safety assurance
  - id: C2-R3
    priority: P3
    change: Publish the deterministic-dispatch property as a competitive claim
    why: it is empirically the right design and no competitor has it
```

## C3. Automation

**Canon.** *Automation* — "trigger- or schedule-driven coordinator that starts a governed Agent Run…
an Automation never invokes a Skill directly or contains hidden authority" (glossary 41).
Legacy alias **Ritual**, retired 2026-07-12; the code rename is **complete**.

**Defined.** `packages/core/src/automation-executor.ts:67 InProcessAutomationExecutor`;
types in `ports.ts:174-244`.

**Status: PARTIAL — the governance boundary is exemplary; the execution engine is minimal.**

What is right: steps run through `pipeline.propose` (`:139`) with the **stored owning Agent as the
only actor** (`:64-66`, `:142`) — a caller cannot supply replacement authority. Run taint accumulates
monotonically across steps (`:170`). `validateAutomationWithinAgents` (`agent-scope.ts:114`) enforces
Automation ⊆ Agent with typed violation reasons.

What is missing:

```yaml
automation_gaps:
  execution: strictly sequential for-loop (automation-executor.ts:132); no parallelism, no DAG
  shape: AutomationDefinition.steps is a linear list (ports.ts:207), not a graph
  failure: on a rejected step -> status "halted" with haltedAtStep (:177-196); NO rollback of already-committed prior steps, NO retry
  scheduling: >
    There is NO scheduler. No cron, no queue, no Hatchet, no BullMQ, no Temporal anywhere in
    platform/ — despite docs/wiki/rituals.md:20 claiming "exec engine = Hatchet+BullMQ". The three
    setInterval calls in the API (wiring.ts:2188, server.ts:556/612/662) do relation reconciliation,
    idle-connection sweep, and parent-watch. "Scheduled Automation" (glossary 42) has NO RUNTIME.
  resumption: >
    AutomationRunRecorder (ports.ts:568) has only start/finish/get/list — no per-step persistence and
    no step cursor. #execute holds proposals[] in local memory (automation-executor.ts:113); a crash
    mid-run loses it. AutomationRunRecord.status is running|completed|halted — there is no
    "suspended" or "resumable" state.
```

```yaml
roadmap_C3:
  - id: C3-R1
    priority: P0
    change: Ship a scheduler, or remove "Scheduled Automation" from canon until one exists
    why: >
      A canonical primitive with no runtime is the most serious doc-versus-code divergence in the
      Engine. OpenClaw's heartbeat/cron is what makes it resident rather than request/response; the
      same is true of Bridge's ambient promise.
  - id: C3-R2
    priority: P1
    change: Per-step run persistence and a "suspended" status
    why: >
      Prerequisite for resumption, for durable approvals inside multi-step Automations, and for the
      listening-channel pattern below.
    design_note: >
      MAF's superstep-boundary checkpoint is the reference. Its warning applies: a checkpoint is a
      TRUST BOUNDARY — Bridge's must be taint-labelled and never loaded unverified.
  - id: C3-R3
    priority: P1
    change: Bounded retry, timeout, and compensation in the executor
    why: >
      docs/wiki/ontology.md:43 already claims the Engine does "bounded retry, timeout, idempotency,
      rollback/compensation, circuit-break, or safe-stop". None of it exists in pipeline.ts or
      automation-executor.ts. Bounded retry exists only in two non-engine places:
      packages/db/src/relation-materialization-store.ts:178-239 and EgressExecutor (wiring.ts:4689).
      Those two are the working patterns to generalize.
  - id: C3-R4
    priority: P2
    change: Adopt a listening-channel primitive
    why: >
      Lindy's channels — "after reply received" suspends the run and wakes it with full thread
      context — are a better fit for Bridge's Signal model than a wait timer, and Bridge already has
      the Event log to key them on.
  - id: C3-R5
    priority: P2
    change: Decide whether Automations become a graph
    why: >
      LangGraph's reducer-channel model is the reference if fan-out is wanted. If it is not wanted,
      say so — Bridge's sequential list is a defensible choice, but only as a choice.
```

## C4. Child Agent Run

**Canon.** *Child Agent Run* — "Authority, Skills, data scope, budget, review requirement, runtime
taint, and delegation depth cannot exceed the parent Run; parent remains accountable" (glossary 55).

**Defined.** `packages/core/src/child-agent-run.ts` (920 lines). `ParentRunEnvelope` (`:142`),
`ChildAgentRunRequest` (`:165`), `deriveChildAgentRun` (`:229`) — **intersection only, never union**
(`:167-171`), with requested-but-unheld tokens landing in `droppedScope` (`:195-197`).
`MAX_CHILD_RUN_DEPTH = 3` (`:63`). Atomic budget reservation (`:843`). Five typed error classes.

**Status: SHIPPED.** This is stronger than any external equivalent. Devin's Managed Devins bound
child work *physically* with per-child VMs; Bridge bounds it *logically* across seven dimensions
simultaneously, which is cheaper and more precise — but has no physical backstop if a Skill
misbehaves in-process (see D5).

Surfaces: `trpc.agentOrchestration.childRun.{get,listByParentRun,cancel}` — inspect, list, and
cancel only; **creation is server-only**, matching canon. No web caller.

```yaml
roadmap_C4:
  - id: C4-R1
    priority: P2
    change: Pair the logical bound with an isolation tier for high-risk child runs
    depends_on: D5 (sandbox)
```

## C5. Chief of Staff

**Canon.** *Chief of Staff* — "default coordinating Agent and interlocutor. Its routing role is a
product composition, not an architectural requirement" (glossary 49).

**Defined.** `packages/core/src/chief-of-staff.ts` — **pure classification, no I/O, no pipeline
call** (`:4-9`). `MAX_CHAIN_DEPTH = 3` (`:66`). `classifyIntent` (`:213`) uses `maxTokens: 32`, tier
`cheap`, then `assertModelOutputTaint` (`:227`) and `createModelCallReceipt` (`:229`); without a
provider it falls back to deterministic keyword matching (`:214`) — "the kernel runs with ZERO
providers".

**Status: SHIPPED.** Two structural properties deserve preservation:

- **At most one route.** `RoutingDecision` (`:90-112`) is `route | clarify | direct_reply` and
  **the type has no array field** (`:85-89`). The star topology is enforced by the type system.
- **No peer handoffs.** There is no `handoff` or `peers` field anywhere — the rule is enforced by
  the absence of a place to put a peer link (`:20-23`).

A hallucinated route id falls back to `clarify`, never an invented route (`:28-30`).

This is Cognition's 2026 conclusion — fan out on reading and reasoning, keep writes single-threaded —
implemented as a type constraint rather than a guideline, and MAST's inter-agent misalignment
failures (13.2% reasoning–action mismatch, 7.4% task derailment) are what it prevents.

## C6. Goal and Task — and the missing Planner

**Canon.** *Goal* (glossary 30), *Task* (31), *Planner* (32), *Plan* (33).

**Defined.** `packages/core/src/goal-task.ts` — `Goal` (`:29`), `Task` (`:37`), `GoalTaskStore`
(`:81`), with `Task.assignedAgentId` described as "the ONLY thing that authorizes an eligible Agent
to invoke a matching governed Skill" (`:42-50`). Wired to Drizzle when durable (`wiring.ts:3597`).

Distinct from this is the **Task Manager** (`packages/core/src/task-manager.ts`, 1,033 lines) — a
richer product-facing Task Database with transition guards, restructure operations, change banding,
markdown projection with drift reconciliation, guards, sweeps, and Playbooks. It is **fully
exercised by the web client** and is the most complete product surface in the Engine.

**Status: Goal/Task SHIPPED (no web caller). Planner ABSENT.**

There is **no `Plan` type and no planner module** in `packages/core/src` — grep for
`interface Plan` / `Planner` returns nothing. `Proposal` (`types.ts:211`) is a single-action
artifact, not a multi-step plan. So both halves of the canonical execution model
("Planner proposes a DAG → governed deterministic DAG executes", `docs/wiki/rituals.md:34`) are
unbuilt: there is no planner, and Automations are a linear list rather than a DAG.

```yaml
roadmap_C6:
  - id: C6-R1
    priority: P1
    change: Either build Plan/Planner or remove them from the glossary
    why: >
      Two canonical primitives with zero implementation is the second-largest doc-versus-code
      divergence after the scheduler. The glossary is meant to name durable distinctions; a
      distinction with no referent weakens the whole vocabulary.
    if_building: >
      CaMeL (arXiv 2503.18813) is the design to follow — extract control flow from the TRUSTED
      request into an explicit program so untrusted data can never alter it. That is the same
      separation Bridge already draws between the Planner (no authority) and the Run, and it comes
      with a measured result: 77% of AgentDojo tasks solved WITH PROVABLE SECURITY versus 84%
      undefended. A seven-point capability cost for a provable guarantee.
```

---

# D. Safety

## D1. Runtime taint tracking

**Canon.** *Runtime Taint Tracking*, *Declassification*, *Quarantine*, *Prompt Injection*
(glossary 130–135).

**Defined.** `packages/core/src/taint.ts` (997 lines). Marked DONE (TASK-015, RT0–RT4, migration
`0029`).

**Status: SHIPPED — and it has no equivalent anywhere in the surveyed field.**

```yaml
taint_v1:
  label: {version, trust, source, sensitivity, instructionRisk, originChain, originsTruncated, provenanceHash}  # :56-65
  trust:  verified_system | authenticated_human | verified_signed | untrusted | unknown   # :4-11
  sensitivity: public | organization | private | restricted | unknown                     # :32-38
  instruction_risk: none | data | instruction_like | unknown                               # :41-47
  max_origins: 16 with an originsTruncated flag                                            # :2
  sources: 11 ids, closed registry   # :562-574 — mcp_result and web_search are untrusted; signed_commons_import is verified_signed
  sinks: 9 ids, closed registry      # :549-590 — network_egress, external_send, file_write, credential_access, schema_mutation, skill_execution, model_capability_context, cache_storage, queue_storage
  inventory_assertion: assertTaintInventory() fails on any unclassified id   # :592
```

Enforcement is **structural, not policy-dependent**: `sinkForRequest` (`pipeline.ts:98`), pre-sink
block (`:422-455`), runtime-sink block (`:507-531`), and a **prompt-free** audit `#recordSinkTrace`
(`:852-873`). The PI-2 gate (`policy/taint-egress.ts`) is enforced by the kernel regardless of
PolicyStore wiring (`:67-71`), uses `require_approval` rather than `block` deliberately (`:8-11`),
and deliberately excludes `external:fetch` (`:13-15`).

The trace store is **real**: `DrizzleTaintAuditStore` wired at `wiring.ts:3356,3568,4243`, read at
`router.ts:6959,6963`, backed by `taint_sink_traces` and `taint_declassifications`.

The PI-3 content guard (`guard/content-guard.ts`) implements dual-LLM/CaMeL-style spotlighting, and
a private-content guard **must** bind a local-plane provider — enforced by `createLocalContentGuard`
/ `CloudContentGuardError` in `packages/models/src/local-content-guard.ts`.

**Note.** Because the taint trace is deliberately prompt-free, it cannot double as a replay or debug
trace. That is the correct privacy choice and it means A1-R1 and B8-R1 are genuinely separate work.

```yaml
roadmap_D1:
  - id: D1-R1
    priority: P3
    change: Publish the taint model
    why: >
      This is Bridge's most defensible technical asset and the field has nothing comparable. CaMeL
      is a research prototype; Bridge has a shipped, migrated, enforced implementation.
  - id: D1-R2
    priority: P2
    change: Use taint labels to order context eviction once compaction exists
    depends_on: A2-R1
```

## D2. Gated Intake and Quarantine

**Canon.** *Intake Policy*, *Gated Intake*, *Quarantine* (glossary 130–132).

**Defined.** `packages/capability-kit/src/intake.ts` — `ModuleCaptureStore` (`:14`),
`createModuleSourceSkill` (`:41`), `ModuleIntakeMaterializer` (`:84`).

**Status: PARTIAL.** PI-1 default-untrusted is enforced at the one seam:
`trustOrigin: envelope.trustOrigin ?? "untrusted_external"` (`:61`). **Only DealPilot is wired**
(`trpc.dealpilot.{captures,commit}`, exercised by web).

```yaml
roadmap_D2:
  - id: D2-R1
    priority: P2
    change: Wire gated intake for every Module that ingests external content
    why: JobPilot and Relationship both ingest external data through paths that do not pass this seam
```

## D3. Credential Broker

**Canon.** *Credential Broker* — "Agents, Skills, and Modules never receive raw secrets"
(glossary 129).

**Defined.** `capability/credential-broker.ts` — `CredentialGrantRef` (`:15`, opaque and time-boxed),
`CredentialBroker` (`:23`), `InMemoryCredentialBroker` (`:53`). Wired at `wiring.ts:4328` —
**in-memory**.

**Status: PARTIAL / EPHEMERAL.** The contract is right and matches what Zapier MCP delivers at
9,000-app scale. The implementation does not survive restart, and rotation, scoping, and revocation
are undefined (`docs/wiki/undefined-elements.md` ranks this #7).

```yaml
roadmap_D3:
  - id: D3-R1
    priority: P1
    change: Persist the broker and define rotation, scoping, and revocation
    why: MCP research (arXiv 2503.23278) puts credential theft among 16 threat scenarios on the tool-dispatch path
```

## D4. Content guard and prompt injection

Covered under D1. The one architectural point worth restating: **CaMeL's finding is that untrusted
data must never influence control flow.** Bridge satisfies this for *authority* — no tool output can
change an Authority Decision. It does **not** yet satisfy it for *planning*, because there is no
planner (C6). Whichever way C6-R1 is resolved, this constraint should be written into the design
before code.

## D5. Sandbox

**Canon.** Not in the glossary. `docs/wiki/optimizations.md:14-16` describes the intended
least-isolated-target ladder.

**Defined.** `capability/sandbox-provider.ts` — `SandboxProvider` (`:94`),
`SandboxIsolationTier = "in-process-js" | "container" | "microvm"` (`:47`).
`capability/sandbox-policy.ts:101 evaluateSandboxRequirement` plus `sandboxTrifectaLegs` (`:54`).
Builder primitives in `capability/builder-primitives.ts` — token set (`:48`), risk classification
(`:72`), `checkCommandAllowed` (`:167`), `runShellExecute` (`:210`).

**Status: CONTRACT-ONLY — and this is the largest safety gap in the Engine.**

```yaml
sandbox_reality:
  container_adapter: >
    NotImplementedContainerSandboxProvider (sandbox-provider.ts:129) THROWS, with the comment
    "This stub exists only to type-satisfy the SandboxProvider port; it must never be..."
  only_real_adapter: >
    InProcessJsSandboxProvider (packages/core/src/server.ts:42) dynamically imports node:vm and is
    deliberately NOT re-exported from the core barrel (index.ts:136)
  wiring: >
    grep -n "sandbox" platform/apps/api/src/wiring.ts returns NOTHING. No SandboxProvider is wired
    into the API at all.
  open_bug: docs/BUGS.md:1843 — Node-only SandboxProvider leaks into the browser bundle
  consequence: >
    capability/foreign-import.ts can translate a foreign manifest (pi-module, mcp-server,
    activepieces-piece, oss-integration) into a governed capability at origin "community", but the
    sandbox TRIAL step of the documented adoption pipeline does not exist. There is nowhere safe to
    run untrusted code.
```

This gap sits directly under the ambition to accept community and AI-generated capabilities via
Commons. The whole field ranks isolation as process → OS sandbox → container → worktree → VM;
Bridge is at rung zero. Codex chose OS-kernel sandboxing (Seatbelt, bwrap+seccomp) explicitly *over*
containers as the cheapest strong option, and OpenClaw's CVE record is what happens when the sandbox
exists but defaults to off.

```yaml
roadmap_D5:
  - id: D5-R1
    priority: P0
    change: Bind one real sandbox adapter and wire it
    why: >
      Every other safety primitive assumes code runs where it is told. Without isolation, a
      misbehaving Skill sits inside the same process as the Plane Gate and the credential broker.
      OpenClaw's trust-boundary statement is the honest framing to copy: a sandbox isolates TOOL
      EXECUTION ONLY; the control plane shares the host's boundary.
    sequencing: >
      Do not open Commons to community or AI-generated origins until this lands. The trust tiers
      already pin community equal to user_code, which is the right posture and only meaningful if
      untrusted code has somewhere to run.
  - id: D5-R2
    priority: P2
    change: Adopt install-time signature verification for foreign capabilities
    why: MCP threat research names trusted registries and install-time signature checks as the primary controls; Bridge's Commons signing already provides the machinery
```

---

# E. Knowledge and structure

## E1. Memory

**Canon.** *Memory*, *Context Tier* (glossary 112–113).

**Defined.** `packages/core/src/memory/memory-store.ts` — `MemoryType` (`:36`),
`MemoryClassification` (`:46`), `MemoryStore` (`:241`), `InMemoryMemoryStore` (`:382`),
`memoryVisible` (`:366`), `MemoryConflictError` (`:234`).

**Status: SHIPPED, with one property worth highlighting.** Retrieval is **authority-scoped at the
store boundary, not post-filtered** (`:16-22`), mirroring `app_private.visible_relationship_row`.
That is the correct construction and most external memory layers do not do it.

Surfaces: `trpc.relationship.memories`, `trpc.onboarding.{correctMemory,forgetMemory}` — all
exercised by web.

```yaml
roadmap_E1:
  - id: E1-R1
    priority: P2
    change: Separate short-term run state from long-term Memory explicitly
    why: >
      LangGraph's thread-checkpointer versus cross-thread Store split, and ADK's app:/user:/temp:
      state prefixes, are both cleaner than Bridge's single umbrella. Bridge's Context Tier
      (working/episodic/semantic/procedural) is a retention CLASS with no runtime enforcement; ADK's
      prefixes are a persistence SCOPE with enforced lifetime. Adopt the enforcement, keep the canon.
  - id: E1-R2
    priority: P3
    change: Define memory write conflict resolution
    why: >
      Mem0's ADD/UPDATE/DELETE/NOOP operation set is the reference. Bridge has MemoryConflictError
      but no resolution policy, and unbounded memory accumulation is measurably expensive.
```

## E2. Context Provider and Sensor SPI

**Canon.** *Context Provider*, *Sensor SPI*, *Raw Capture*, *Context Observation*, *Capture Tell*
(glossary 114–118).

**Defined.** `packages/core/src/context-provider.ts` — nine provider names (`:22-31`),
`ContextItem<TPayload>` (`:48`), `ContextProvider` (`:87`).

**Status: CONTRACT-ONLY in the kernel, by design.** "The actual OS-level capture implementations
live in the desktop shell (Tauri/Rust capture core), never in `@bridge/core`" (`:6-8`). Real capture
is `apps/desktop/src-tauri/src/sensor_bridge.rs`; `docs/INDEX.md:32` flags CSP and capture stubs
against BUGS.

This separation is correct and matches the field's conclusion that the kernel must stay
surface-agnostic.

## E3. Module, Module Version, and lifecycle

**Canon.** *Module*, *Module Installation*, *Module Version*, *Rollback*, *Capability Manifest*
(glossary 11–13, 60–63).

**Defined.** `packages/core/src/module/` — `types.ts` (ModuleKind `:21`, dependencies **exact-pinned
only, never a range** `:22-26`, manifest `:107`, version state `:136`), `manifest.ts:337
parseModuleManifest`, `lifecycle.ts` (`promoteToAvailable` `:57` auto-demotes the prior `available`
to `legacy` in the same transaction; `rollbackFromHistory` `:91` **forks a new draft, never an
in-place revert**), `risk.ts`, `privacy.ts:36 findOrganizationDataPaths` (key denylist, suffix
denylist, and ~20 value regexes covering emails, UUIDs, Bearer tokens, `sk_`/`ghp_`/`github_pat_`,
AWS AKIA/ASIA, `AIza`, Slack `xox*`, `GOCSPX-`, Azure `AccountKey=`, PEM private keys).

**Status: SHIPPED.** All six `trpc.modules.*` procedures are used by web. Built-in manifests in
`platform/modules/manifests/src/index.ts` (800 lines) with "no frontend inventory is hardcoded"
(`:1-4`).

```yaml
roadmap_E3:
  - id: E3-R1
    priority: P1
    change: Define what happens to in-flight Runs when a Module Version changes
    why: >
      Rollback is defined as a governed forward change and says nothing about Runs already
      executing. Temporal's Worker Versioning — pin each execution to the code version it started
      on, ramp traffic, roll back instantly — is the reference solution to a problem Bridge has and
      has not named.
```

## E4. Blueprint

**Canon.** *Blueprint* — "versioned definition of an Organization's installed Modules, default
Pages, Views, Automations, and Home composition. A Blueprint proposes configuration; it does not
bypass activation governance" (glossary 13).

**Defined.** `packages/core/src/blueprint.ts` — `BLUEPRINT_SCHEMA_VERSION = 2` (`:45`),
`compileBlueprint` (`:322`, pure, no I/O), `parseOrganizationBlueprint` (`:677`), round-trip to and
from a `ModuleManifest` (`:765`, `:793`).

**Status: SHIPPED.** `organization_definition` is agent-floor-protected. Surface:
`trpc.organization.blueprint`, used by web.

The AgentKit shutdown is the argument for keeping this a portable, versioned, exportable manifest
rather than a proprietary canvas format — OpenAI sunset an entire visual-authoring stack thirteen
months after launch and the migration path was "download the code."

## E5. Commons

**Canon.** *Commons*, *Commons Registry*, *Registry Entry*, *Publisher Signature*, *Content Hash*,
*Privacy Gate*, *Convergence Threshold* (glossary 101, 157–164).

**Defined.** `module/commons.ts` (wire types), `module/signing.ts`
(`ManifestSignatureAlgorithm = "ed25519"` — "the only signature algorithm v1 accepts" `:25`,
canonicalization `:66`, injected `SignatureVerifier` `:85`, `assertCommonsUrlTls` `:160`),
`module/commons-trust.ts` (content hashing and verification), `module/signed-legacy-entry.ts`.
`@bridge/core` **never imports `node:crypto`** (`signing.ts:4-6`) — real crypto binds at the
`apps/api` / `services/commons` seam. Service at `platform/services/commons` (port 4780), wired with
"Signature verification fails closed unless the publisher key is explicitly pinned."

**Status: SHIPPED.** All four `trpc.commons.*` procedures are used by web.

```yaml
roadmap_E5:
  - id: E5-R1
    priority: P1
    change: Do not open Commons to community or AI-generated origins before D5-R1
    why: >
      The trust tiers correctly pin community equal to user_code, which is only meaningful if
      untrusted code has an isolated place to run. Today it does not.
  - id: E5-R2
    priority: P2
    change: Adopt ClawHub-style declaration-versus-behaviour verification
    why: >
      OpenClaw's registry requires skills to declare required env vars, binaries, and install specs
      in frontmatter, then checks the declaration against actual behaviour. That is a concrete,
      implementable design for the Privacy Gate's supply-chain half.
  - id: E5-R3
    priority: P1
    change: Make Commons entry licensing unambiguous before publication opens
    why: >
      n8n's "fair-code" ambiguity cost it years of trust disputes, and LangGraph's MIT-library /
      Elastic-License-2.0-server split is a live trap for anyone who self-hosts. Bridge should not
      reproduce either.
```

---

# F. Models and measurement

## F1. ModelProvider

**Canon.** *Local Inference*, *Cloud Inference* (glossary 103–104).

**Defined.** `ports.ts:353` — `{id, plane, tiers, models, routingHealth(), pricing?, complete(),
embed?}`. Guardrails: `MAX_MODEL_PROMPT_CHARS = 1_000_000` (`:228`),
`MAX_MODEL_OUTPUT_TOKENS = 32_768` (`:229`), `modelRequestTaint` (`:294`),
`assertModelOutputTaint` (`:304`).

**Receipts are unusually rigorous.** `createModelCallReceipt` (`ports.ts:378`) requires the returned
model to equal the provider's **declared** model for the requested tier — "a provider response
cannot silently relabel the billed model" (`:358-359`) — validates token counts as safe integers
≤ 10M, requires a valid `YYYY-MM-DD` pricing date and source, and on missing pricing returns
`status: "pricing_unavailable"` with `estimatedUsd: null` rather than a fabricated number.

Router (`packages/models/src/router.ts:37`) applies an asymmetric plane rule (`:6-13`): a `local`
default **never** falls through to cloud; a `cloud` default **may** fall back to local.

**Status: SHIPPED, with two deliberate absences and one blocker.**

```yaml
model_gaps:
  streaming: >
    ABSENT. No stream/onToken/SSE method on ModelProvider or any adapter. Every prosumer competitor
    streams; Bridge cannot.
  tool_loop: >
    ABSENT. Every kernel model call is one-shot — chief-of-staff.ts:224 (maxTokens 32),
    agents.ts:265-274 (maxTokens 512), guard/content-guard.ts. AnthropicProvider uses tools and
    tool_choice ONLY as a structured-output constraint (anthropic-provider.ts:154-168, :191-206)
    with disable_parallel_tool_use: true. There is no path feeding tool results back to the model.
  live_gate: >
    docs/BUGS.md:2006 OPEN 2026-07-28 — Chat Panel reports no authorized cloud model provider
    configured; blocked on a secret only the user can set.
  cost_ceiling: >
    Receipts are computed and child runs reserve {calls, cost}, but there is NO organization-wide or
    per-run spend ceiling that halts execution.
```

```yaml
roadmap_F1:
  - id: F1-R1
    priority: P1
    change: Add an organization-level spend ceiling that halts execution
    why: >
      Runaway cost is the most consistently reported production failure across the entire surveyed
      field — CrewAI delegation loops, Lindy credit burn, Zapier activity cliffs, Devin ACU shock.
      AG2 v1.0 is the ONLY framework that puts loop and cost containment in the framework itself
      (Hub-enforced rate limits and inbox caps), and everyone else's developer-set caps have
      documented expensive failures.
  - id: F1-R2
    priority: P2
    change: Add streaming to the ModelProvider port
    why: required for any credible chat surface; note Temporal's finding that streaming and durability are in genuine tension
  - id: F1-R3
    priority: P2
    change: Resolve the tool-loop question together with C1-R1 and C6-R1
    why: these three are one decision, not three
```

## F2. Eval harness

**Canon.** No glossary term. Spec is `docs/wiki/agent-eval.md`.

**Defined.** `packages/core/src/eval/` — `types.ts` (`EvalCase` `:5`, `EvalDataset` `:15`,
`AxisScores` `:22`, `Scorer` `:33`, `EvalRun` `:39`, `Comparison` `:51` with verdicts
`promote|reject|coexist|needs-human`), `store.ts` (`runEvalDataset` `:88`, `writeEvalRunEvidence`
`:116` — the "missing join" into `capability_states.evidence`, which **exists**; aggregation uses
**min for `safety`** and mean elsewhere `:150`, making the veto axis structural),
`scorers.ts`, `judge.ts`, `comparison.ts:90 compareRuns` (two-gate rule read from `policy_params`,
never hardcoded `:5-19`) with `buildWhyBetterCard` (`:241`), and `aqv.ts` (the seven reducers).

Consumed at `router.ts:12891` inside `capability.approve`'s validated → active gate.

**Status: PARTIAL — the machinery is built and cannot yet run for real.**

```yaml
eval_gaps:
  - InMemoryEvalStore in BOTH modes (wiring.ts:4707, declared :405-409) — no eval history survives a deploy
  - computeReliability and computeEfficiency read record.executionSnapshot (aqv.ts:72-105), which nothing writes — two of seven axes are unfeedable
  - exactly ONE seeded dataset exists in core (INTERNAL_STRATEGIST_EVAL_DATASET, agents.ts:395)
```

```yaml
roadmap_F2:
  - id: F2-R1
    priority: P0
    change: Persist EvalStore and write execution snapshots
    depends_on: A1-R1
    why: >
      docs/wiki/undefined-elements.md ranks the eval harness #1 by leverage — "the promotion gate;
      nothing evolves safely without it" — and the self-improvement layer is named there as the
      least-defined and most load-bearing part of the system. It is now BUILT and merely unfed.
      This is the highest ratio of value to remaining work in the Engine.
  - id: F2-R2
    priority: P1
    change: Adopt a side-effect-free eval Run mode
    why: >
      Lindy is the only surveyed platform documenting one ("eval runs consume credits but don't
      execute real actions"), and it is CHEAPER for Bridge than for Lindy: the Action Pipeline
      already separates propose from commit, so a no-commit eval Run is a small change.
  - id: F2-R3
    priority: P1
    change: Measure pass^k, not pass^1
    why: >
      tau-bench measured pass^1 around 61% against pass^8 below 25% on the same task set. That gap
      is the difference between a demo and a product, and Bridge's AQV currently has no repetition
      axis at all.
  - id: F2-R4
    priority: P2
    change: Instrument the failure DISTRIBUTION using MAST's taxonomy
    why: >
      Aggregate success rates hide which failure mode an intervention actually moved. MAST ships as
      a library with a validated 14-category vocabulary; adopting it is cheaper than inventing one.
```

---

# G. Consolidated roadmap

Ordered by priority, then by dependency. `P0` means a stated canon promise is currently untrue or a
safety boundary is missing.

```yaml
P0:
  - D5-R1: bind and wire one real sandbox adapter                       # largest safety gap
  - F2-R1: persist EvalStore + write execution snapshots                # highest value-to-work ratio
  - B5-R1: read trust_grants; persist budgets and kill switch           # governance inputs are constants
  - A2-R1: replace the context-overflow throw with governed compaction  # only harness that fails instead of compacting
  - C3-R1: ship a scheduler or remove "Scheduled Automation" from canon # canonical primitive with no runtime

P1:
  - A1-R1: write execution snapshots                                    # unblocks A3-R1, F2-R1
  - A3-R1: build the replay driver                                      # "replayable" is currently aspirational
  - A4-R1: bind Drizzle adapters for the three ephemeral governance stores
  - B2-R1: correct the governance-agent doc to match the code
  - B7-R1: add assignee/due-date/reminders/escalation to approvals
  - B7-R3: define the crash-survival contract for pending approvals
  - B8-R1: write decision_traces (and file the web mock in docs/dummy.md)
  - C2-R1: bind the Drizzle SkillManifestRegistry
  - C2-R2: enforce maxCostPerDay or delete the field
  - C3-R2: per-step run persistence and a "suspended" status
  - C3-R3: bounded retry, timeout, and compensation in the executor
  - C6-R1: build Plan/Planner or remove them from the glossary
  - D3-R1: persist the Credential Broker; define rotation/scoping/revocation
  - E3-R1: define in-flight Run behaviour across Module Version changes
  - E5-R1: gate Commons community origins behind D5-R1
  - E5-R3: make Commons licensing unambiguous
  - F1-R1: organization-level spend ceiling
  - F2-R2: side-effect-free eval Run mode
  - F2-R3: measure pass^k

P2:
  - A1-R2, A2-R2, A2-R3, B1-R1, B1-R2, B3-R1, B3-R2, B5-R3, B6-R1, B9-R1
  - C1-R1, C3-R4, C3-R5, C4-R1, D1-R2, D2-R1, D5-R2, E1-R1, E5-R2
  - F1-R2, F1-R3, F2-R4

P3:
  - A1-R3, A3-R2, B2-R2, B6-R2, B5 trust-decay surfacing, C1-R2, C2-R3
  - D1-R1, E1-R2
```

Three P1 items are one decision, not three: **C1-R1 (does an Agent get a tool loop), C6-R1 (does a
Planner exist), and F1-R3 (does ModelProvider support a loop)**. Resolving them together is the
biggest open architectural question in the Engine.

---

# H. Surface coverage

The harness is largely unexercised by the product. Verified: `trpc.agentOrchestration.*`
(goal, task, skill, childRun), `trpc.capability.*`, `trpc.agent.{create,update}`,
`trpc.resources.*`, and `trpc.capture.*` have **zero callers in `apps/web/src`**.

Shipped product surfaces are Task Manager, Relationship, DealPilot, JobPilot, Modules, Commons,
Approvals, Chat, Graph, Onboarding, and Organization. The Engine's governance machinery is exercised
only by tests and the API itself.

This is not necessarily wrong — a kernel should be usable before it is visible — but it means the
harness has never been validated against real user behaviour, and several gaps above (EPHEMERAL
stores in particular) would surface immediately under real use.

---

# I. Doc-versus-code corrections

Each verified during this inventory. These should be fixed in the referenced docs.

```yaml
corrections:
  - doc: docs/INDEX.md:14
    claims: "Ritual executor | src/ritual-executor.ts"
    reality: file does not exist; the real file is packages/core/src/automation-executor.ts:67
  - doc: docs/INDEX.md:33
    claims: "Mobile (Expo/RN) | platform/apps/mobile"
    reality: directory absent; docs/BUGS.md:813 records this OPEN as an XP-3 blocker
  - doc: docs/INDEX.md:11
    claims: agent-floor DENY has "+2 copies"
    reality: they are DERIVATIONS, not copies (agent-floor.ts:1-14, :98) — the drift was fixed
  - doc: docs/CODEMAPS/flows.md:124-141
    claims: InProcessRitualExecutor / RitualRunRecorder / ritual_runs
    reality: fully renamed; automationRuns = pgTable("automation_runs") at packages/db/src/schema.ts:805-806
  - doc: docs/wiki/rituals.md:6
    claims: "ritual_runs -> automation_runs (migration pending)"
    reality: the migration has landed
  - doc: docs/wiki/rituals.md:20
    claims: "exec engine = Hatchet+BullMQ+RitualExecutor"
    reality: neither Hatchet nor BullMQ exists anywhere in platform/
  - doc: docs/wiki/rituals.md:20
    claims: "explainability = decision_traces"
    reality: >
      the table has zero readers and zero writers. The web declares a matching interface in
      data/governance.ts but ships EMPTY arrays behind real loaders, so this is a missing feature,
      not a dummy-data violation (docs/dummy.md:253 already covers the file). The file's
      "Governance mock data" header is stale and should be corrected.
  - doc: docs/wiki/governance-agent.md:5-6
    claims: Governance is the "sole audited exception to agent-floor approve-DENY"
    reality: >
      pipeline.decide floor-denies ALL agents unconditionally (pipeline.ts:643-667). The carve-out is
      lifecycle-only and outside the ledger (router.ts:13021-13030). GA3 as specified is not shipped.
  - doc: docs/wiki/ontology.md:43
    claims: Engine performs "bounded retry, timeout, idempotency, rollback/compensation, circuit-break, or safe-stop"
    reality: >
      None of this exists in pipeline.ts or automation-executor.ts. Bounded retry exists only in
      packages/db/src/relation-materialization-store.ts:178-239 and EgressExecutor (wiring.ts:4689).
  - doc: docs/wiki/governance-agent.md:11-13
    claims: GA2 gaps — hardcoded trustGrants, in-memory budgets
    reality: still exactly true (router.ts:12951, router.ts:13423, wiring.ts:4326-4327)
```
