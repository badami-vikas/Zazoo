# K3 Knowledge Substrate — pre-build design review and revised plan (2026-08-09)

Status: PROPOSED (plan only — K3 has not started; "After K2 stop" stands)
Scope reviewed: `docs/raw/ai-harness-plan-2026-08-09.md` K3 section + TASK-047 + the KG
technology decision (ADR-210), against the repo as of `main` 96e56f3 and current external
practice.

## Verdict

The canon K3 shape survives review: Postgres substrate, bi-temporal claims with
invalidation-not-deletion, consolidation as suggestions behind the human gate, no big-bang
migration. External 2026 practice (Zep/Graphiti's bi-temporal model; the consolidation-lever
consensus of importance/merge/decay/eviction; "human review gates memory commit" as the
production pattern) independently converges on exactly this design — Bridge's
suggested-then-accepted identity is not a constraint to work around, it is the current best
practice.

Nine changes/decisions are needed before build. Four are canon-touching and need an
APPROVALS row at K3 start; five are engineering decisions recorded here so the build doesn't
rediscover them.

## Canon-touching (need AP row at start)

### 1. "Claim" vs the existing canonical "Fact" — vocabulary collision the plan missed
`docs/glossary.md` already defines **Fact** ("one claimed attribute of a Record with
provenance, confidence, validity, and correction history") and `@bridge/facts` implements it:
in-memory store with `supersede()` lineage and a provenance-ranked `livingProfile()` — used by
people-sourcing, company-sourcing, recorder, capability-kit intake, and the DealPilot pipeline.
K3's Claim is the same concept, persisted + governed + bi-temporal + sensitivity-tiered.

**Recommendation**: canonize **Claim** as the kernel knowledge primitive (ADR-176 already
speaks of "claim→evidence"; the K-plan and TASK-047 already say Claims). Glossary gains a
Claim entry; the Fact entry gets a note that Fact is the tool-plane precursor with a
time-boxed migration (vocabulary rules require deletion criteria). `@bridge/facts` semantics
(supersedence, provenance rank, living profile) are absorbed into the Claim design; migrating
its five consumers is explicitly OUT of K3 scope — follow-up task row.

### 2. A fourth flight: `BRIDGE_KNOWLEDGE_SUBSTRATE`
K3 writes new tables and runs a new consolidation loop — it needs its own kill switch,
independent of `BRIDGE_LEARNING_OBSERVATION`. Same double-entry discipline as ADR-211
(render.yaml + desktop sidecar + a test that fails if either drops it). The flags-on durable
boot IS the exit test (three-data-point discipline from K0/K1/K2).

### 3. Hosted rollout is gated on the CI/vocabulary decision — acknowledge it
K3 ships migrations via `platform/packages/db/migrations/*.sql`. The hosted `supabase-migrate`
job currently never runs (CI `platform` job red at the 90 tracked WhatsApp retired-"Tool"
findings; deliberate open canon decision, TASK-036/AP-127). Local Plane (pglite) applies
migrations at boot, so K3 can be built and live-proven Local-first — but the hosted pilot
will not get the tables until TASK-036 is decided. K3 should not silently depend on that;
the AP row records: K3 live-proof is Local Plane; hosted follows the TASK-036 resolution.

### 4. The red-class list is closed and needs the user's sign-off
Health, protected characteristics, psychological conclusions (canon). Encode as a closed
union in core where red classes are *not members of the proposable claim-class type* — the
K2 structural-privacy trick (make the bad state inexpressible, don't filter it). Adding a
class later = code change + AP row, which is the point.

## Engineering decisions (recorded now, no approval needed)

### 5. Bi-temporal fields, concretely (borrowed from Graphiti, behind our port)
Every claim carries four timestamps: `validFrom`/`validTo` (when true in the world) and
`recordedAt`/`invalidatedAt` (when learned/invalidated by Bridge). Contradiction = new claim
+ `validTo`/`invalidatedAt` + `supersededBy` lineage on the old one. Nothing is ever
deleted by consolidation; user deletion (the K2 `forgetMemory` path generalized) remains the
only true delete. This answers "what was believed and when" and never serves a stale claim
as current.

### 6. Consolidation is deterministic — no embeddings in merge decisions (ADR-213 lesson)
`@bridge/dedupe` today is trigram + exact-business-key with strong/moderate/flag tiers —
there is no separate "calibrated refusal band" artifact; the band is DEFINED as: exact-key
equality may auto-merge (deterministic, model-unreachable, same rationale as ADR-177's
"auto-bind unreachable from a model"); everything else at/above `moderate` becomes a merge
*suggestion*; below moderate, silence. Embedding similarity is excluded from merge decisions
in v1: ADR-213 proved the semantic space can silently degrade to lexical — a merge decision
must never depend on which embedding space happened to be reachable. Dedupe gains per-
entity-type blocking keys (domain for orgs, normalized name+org for people already exists).

### 7. Claims carry evidence spans and inherit taint at source
Evidence refs point at Memory/ledger ids **with span offsets** when distilled from prose
(ADR-176 item iv — the distiller must emit spans; memory-poisoning defense). Claims inherit
`taintLabel` from their evidence (mechanism exists since K2: `core/src/taint.ts`,
`ObservedSignal.taintLabel`) and carry a `sensitivity` tier that is raise-only (invariant 15).
A claim whose evidence is untrusted-tainted can never be laundered into a clean claim.

### 8. Residency: claims follow Memory rules; the new namespace is classified explicitly
Distilled claims may leave the Local Plane only under the same rules as distilled Memory;
private-sensitivity claims stay local. `deployment-boundary.ts` `LOCAL_ONLY_PREFIXES` has
`"learning."` but would NOT catch a `knowledge.*` namespace — either name the procedures
`learning.knowledge.*` (inherits local-only fail-closed, recommended) or add an explicit
prefix rule in the same commit that adds the first procedure. Never rely on the default.

### 9. Reuse, don't rebuild
GraphStore already has commitments (status lifecycle), interactions, timeline, relationship
paths, and `DecisionProvenance` threaded through every write input. The entities table
references existing person/community rows as one region (`entity.kind = "person"` → ref to
the existing row; no copying). Consolidation runs on the K1 scheduled-digest cadence — no
new scheduler. Contradiction/duplicate suggestions flow through the existing
suggested-then-accepted machinery and its annoyance cap. Decay = staleness score + `archived`
state (excluded from default retrieval-fusion lanes), never a hard delete.

## The minimal cut — second brain v1 (user directive 2026-08-09)

User framing: "Basically we need a second brain here, with the most minimalistic way."

The payoff surface already exists — Second Brain is the cross-Module graph UI (TM5), and
`@bridge/facts` already defines the minimal claim semantics (supersedence, provenance rank,
living profile). **The minimal K3 is: persist those semantics, govern them, and render them
in the Second Brain UI.** Vocabulary note: "Second Brain" stays UI-only per canon; the
engine vocabulary is Entity/Claim.

What stays even in the minimal cut (one-time STRUCTURAL costs, not ongoing complexity —
each is a type/field/guard, not a loop): governed-pipeline-only writes; red classes
unproposable by construction; sensitivity tier + taint inheritance; evidence refs;
supersedence-not-deletion; the four bi-temporal timestamps (cheap at write time, impossible
to retrofit); the fourth flight default-off.

### One substrate, two projections — spine alignment (user directive 2026-08-09)

User framing: "We need both second brain and knowledge graph to match with the AI Harness
spine." Resolution: there is ONE store — the entities/claims knowledge graph — and two
projections of it. The machine projection is the harness spine's store rung; the human
projection is the Second Brain UI. Neither is an afterthought; they are the same rows.

Spine mapping (observe → distill → store → retrieve → recommend → promote):

```yaml
- stage: observe
  writes: K1 ledger signals; K2 chat/WhatsApp; K5 email/calendar (later)
  second_brain_shows: nothing (signals are Memory, inspectable in Settings)
- stage: distill
  writes: digest → claim suggestions (v1 user-confirmed; distiller later)
  second_brain_shows: pending claim suggestions on the affected entity
- stage: store
  writes: K3 entities + claims via governed pipeline, on acceptance only
  second_brain_shows: the entity node; live claims; supersedence history;
    per-claim evidence refs (click-through to source Memory/ledger row);
    sensitivity tier; delete (forget path) — the capture invariants
    "inspectable, deletable" are DISCHARGED BY this surface
- stage: retrieve
  reads: K4 fusion graph lane fills agent-run context from live claims
  second_brain_shows: same claims the model sees — no hidden second store
- stage: recommend
  reads: K6 brief + next-action suggestions read claims/commitments
  second_brain_shows: commitments as graph nodes (already exist, TM5)
- stage: promote
  reads: K9 rung 4 Builder proposes structure from entities/claims
  second_brain_shows: accepted structures appear as new graph regions
```

The trust property this buys: what the user sees in the Second Brain is exactly what the
model retrieves — one substrate means the human gate and the machine context can never
diverge. That is the spine's identity ("explain before automating") made structural.

What the minimal cut DEFERS (pulled in later only when their absence hurts):
- the model-backed episodic→semantic distiller with evidence spans (old K3b) — v1 claims
  enter only from user-confirmed flows, so every claim is born human-approved;
- the trigram dedupe pass — v1 auto-merges on exact business key only; no fuzzy pass, no
  refusal-band queue to tune;
- decay/archive automation — the `archived` flag exists in schema from day one; no job
  flips it in v1;
- new entity kinds beyond what Modules already surface — v1 regions: existing people/
  communities/tasks plus `topic` as the single new kind.

## Slice plan (minimal)

- **K3a — skeleton: schema + port + flight** (unblocks K4, unchanged). `entities` +
  `claims` tables (bi-temporal, sensitivity, evidence refs, supersedence, archived flag),
  `KnowledgePort` in core (zero-runtime-deps; red classes structurally unproposable),
  migrations for both planes, fourth flight double-entered, ALL writes through the governed
  pipeline — direct-write attempt fails closed. Exit: tests seen RED first + flags-on
  durable Local-Plane boot.
- **K3b-min — one write path, two read projections.** Write: a claim stated or confirmed
  in chat becomes a suggestion; acceptance materializes it (reuses the existing suggested-
  then-accepted machinery; contradiction with a live same-entity+field claim supersedes by
  lineage on accept — the @bridge/facts semantics, persisted). Machine read: claims feed
  the retrieval-fusion graph lane. Human read: the Second Brain UI renders the entity node
  with live claims, supersedence history, per-claim evidence click-through, sensitivity
  tier, and delete via the forget path — this surface is what discharges the "inspectable,
  deletable" capture invariants for the knowledge layer, and it shows exactly the rows the
  fusion lane retrieves (one substrate; the projections cannot diverge).
- **K3c-min — verify + live walk + ledgers**: `pnpm verify` (vocabulary stays at exactly
  90), live HTTP walk on a durable boot (claim suggested → accepted → visible in Second
  Brain + fusion; contradicting claim → supersedence lineage visible, old claim never
  deleted; forget path deletes; flight off → silent), ADR + TASKS/log/wiki, push.

Deferred loops (distiller with spans, fuzzy dedupe with refusal band, decay pass) become
explicit follow-up rows rather than K3 scope — same pattern as the Kùzu escape hatch:
pre-agreed, pulled in on evidence of need, never speculatively.

## External corroboration (read 2026-08-09)

- Zep/Graphiti bi-temporal model: four timestamps, edge invalidation instead of deletion,
  conflict handling via temporal metadata — the design K3 borrows behind its own port.
- 2026 consolidation consensus: four levers (importance/merge/decay/eviction); systems
  without explicit forgetting "degrade into noise within weeks" — K3c's decay/archive pass.
- Production cross-session learning pattern: extraction → **human review gate** → memory
  write. Bridge's suggested-then-accepted IS this pattern, at kernel level.
- Retrieval best practice: multi-strategy (semantic+keyword+graph) with no LLM calls at
  retrieval time — Bridge's three-lane fusion already matches; K3 adds the graph lane's
  substrate.

Sources: Zep/Graphiti overview (help.getzep.com), Neo4j Graphiti write-up, Zep temporal-KG
paper (blog.getzep.com), Atlan/vectorize/datapace 2026 framework comparisons, Hindsight
"Consolidation Problem" (vectorize.io), Zylos memory-consolidation research notes.

## What this changes in canon docs at K3 start

One AP row covering items 1–4 PLUS the minimal-cut scope narrowing (TASK scope change =
canon change): TASK-047 scope line gains the Fact/Claim disposition, the Local-first
live-proof note, and the deferred-loops list as named follow-up rows; glossary Claim entry;
`docs/raw/ai-harness-plan-2026-08-09.md` K3 section gets a dated addendum pointing at this
doc (requirement bodies stay verbatim).
