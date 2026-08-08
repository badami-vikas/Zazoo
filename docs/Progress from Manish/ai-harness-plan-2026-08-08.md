# AI Harness Plan

**Date:** 2026-08-08
**Status:** Agreed in session, NOT yet canonized — no `docs/raw/` plan doc, no APPROVALS row, no TASK rows beyond those noted as existing. Development was paused for this architecture review; this document records the plan as discussed.

## The goal

One minimal harness that **observes → distills → stores (knowledge graph + memory + vectors) → retrieves (continuous context) → recommends → promotes** repeated patterns up a capability ladder — preference → automation → skill → **module** — with a human gate at every rung.

**North-star acceptance test:** DealPilot stops being hand-built canon and becomes the test. Given only observation data from someone doing ETA-style work, the harness (Builder rung 4) should propose a Deals/Sources/Theses-shaped module on its own, without being told about DealPilot.

## The core loop

```
        ┌─────────────────────────────────────────────────────┐
        │  OBSERVE → DISTILL → STORE → RETRIEVE → RECOMMEND   │
        │     ▲                (graph +              │        │
        │     │                 memory +             ▼        │
        │  ACT (governed) ◄── vectors)  ◄──── PROMOTE ladder  │
        └───────────────────────┬─────────────────────────────┘
                    OPTIMIZE (consolidation, background)
                    EVALS gate every arrow (growth needs evidence)
```

## The sequence

| # | Phase | Content | Status |
|---|-------|---------|--------|
| K0 | **Spine** | Turn the three built flights ON for the pilot (`BRIDGE_LEARNING_OBSERVATION`, `BRIDGE_RETRIEVAL_FUSION`, `BRIDGE_COMMONS_ARCHETYPES`); close the CoS bypass so `RunContextAssembler` is the only context door | Built, never run live |
| K1 | **Capture: ledger spine** | Generic ledger→signal miner — every governed in-app action becomes learning input; delete the per-module (DealPilot) mapping forever. The append-only ledger already records ALL in-app activity as a byproduct of the governed pipeline; nothing mines it for learning yet | NEW, cheap |
| K2 | **Capture: local stores emit** | Chat threads + WhatsApp store → learning signals, per-source toggles (data already held locally; new *use* = new consent surface, default off) | NEW |
| K3 | **Knowledge substrate** | The "graph that appends *and optimizes*": Entities beyond people (deals, projects, orgs, topics — typed by Module vocabulary), Claims with per-claim evidence refs + sensitivity tiers + supersedence lineage, and the consolidation loop (entity dedupe via `@bridge/dedupe` + calibrated refusal band per ADR-177, contradiction surfacing as suggestions — never silent overwrite, episodic→semantic distillation with provenance, decay/archive). **Extends** GraphStore (new `entities`/`claims` tables alongside), no big-bang migration; the relationship graph becomes one region of the whole. All writes through the governed pipeline. Red-tier claim classes (health, protected characteristics, psychological conclusions) never proposed — by construction | NEW — biggest build |
| K4 | **Continuous context** | Retrieval fusion feeds *every* agent run under an enforced context budget (Layer B), not just chat; semantic embedder (local Ollama) becomes the Local-Plane default, hashing embedder stays as deterministic fallback | PARTIAL (LA5 built, chat-only, flighted) |
| K5 | **Capture: email + calendar** | Google integration starts emitting learning signals (metadata-first: sender/subject/time, calendar events + attendees; content summarization later, separately gated), per-account toggle. This rung makes commitments + the brief genuinely good | NEW |
| K6 | **Recommendation rhythm** | Morning brief (overdue/due/upcoming commitments, pending suggestions, recent activity) + commitment detection mined from real prose, materializing into the graph substrate on acceptance (= TASK-040, fully designed, paused) + approvals nudges + next-action suggestions. All suggested-then-accepted, annoyance-capped. The visible daily payoff that makes the loop legible | DESIGNED (TASK-040) |
| K7 | **Capture: app-focus** | First ambient sensor — real frontmost-app/window-title provider in the `@bridge/sensors` SensorHub (currently fake-provider + unwired), hub wired into the API, Avatar blink-tell live, pause/kill switch. Hard dependency: signed `.app` bundle (TCC grants aren't durable on the unbundled dev binary — ADR-184) | NEW |
| K8 | **Capture: browser** | Extension capturing domain/title-level activity first (page content later, separately gated), allowlist/denylist, private windows structurally excluded | NEW |
| K9 | **Builder ladder** | Rung 3: Capability Builder drafts automation *steps* — given a promotion pattern + its ledger episodes, propose concrete steps constrained to the existing skill registry + canonical step schema (constrained generation, not codegen; existing activation gates apply — buildable right after K1). Rung 4: structure synthesis — Builder proposes Databases/Views/Pages/blueprints from K3's entities and claims via the validated input-pack regeneration methodology (constitution + contracts + mandate-from-substrate + budget + harness; ADR-175/176/177, TASK-042 defines per-class packs). Safe because the View/Page schema is structurally incapable of holding code (ADR-194). Rung 5 (code-bearing skills via BA0 sandbox) is later, gated on rung 4 proving out | NEW — the "builds modules" half; Builder is a stub today |
| K10 | **Hardening gate** | TASK-043: the five constitution mechanisms become executable harness obligations, not review conventions — port-set allowlist as CI, acceptance shown-text hash, sensitivity tiers, claim→evidence enforcement, paraphrase-robust rejection fingerprints (unblocked by K4's semantic embedder). Budget meters (`RunBudgetMeter`) wrap every port. **Nothing below this line turns on until these are enforced** | READY (TASK-043 queued) |
| K11 | **EG4 sensor tier — three senses** | (a) **Continuous input capture** — every click + its AX-tree target + typing, as semantic events ("clicked Send in Mail"), not a raw keylog. NOT covered by any prior plan — net-new scope, but rides ~80% on EG4's planned machinery (capture-core crates, Accessibility/Input-Monitoring permission model, AX-tree walker already scheduled for pointing, T0–T2 local tiers, capture→Memory+blink contract). (b) **Continuous screen** on T0–T2 local tiers (xcap; post-meeting action drafts). (c) **System audio → ambient voice** (cidre/wasapi/libpulse; EG5). All: raw processed on-device, only distilled Memory persists, raw never leaves the Local Plane | NEW; behind K10 gate |

## The input-capture boundary (K11a) — defense in depth, fail-closed

"Never captures sensitive data" is **not** structurally achievable and is not claimed. What IS promised:

1. **OS secure-input is structural**: when a password field has focus, macOS `EnableSecureEventInput` blocks the event tap from seeing keystrokes at all — enforced below us, not by us.
2. **Field-role gate, fail-closed**: AX-tree focused-element role secure/password — or **undeterminable** — ⇒ keystroke content suppressed (at most "typed in an unknown field", never characters). Unknown = sensitive.
3. **App + domain denylist**: password managers, banking apps, user-editable list — never captured at all, not even clicks. Private browser windows structurally excluded.
4. **Never persist raw; distill on-device**: raw stream processed in-memory into semantic events; only distilled, inspectable Memory persists. Raw keystrokes never hit disk, never leave Local Plane.
5. **Pattern redaction on the distilled layer**: card numbers, SSNs, long digit runs, high-entropy tokens redacted before storage, as backstop.
6. **Universal sensor invariants** (below) apply.

## Invariants on every capture rung

Per-source consent toggle, default off · pause/kill switch · every capture creates an inspectable, deletable Memory · raw capture never leaves the Local Plane · taint-labeled at source · Avatar blink whenever a sensor fires · derived claims inherit sensitivity tiers (red classes never proposed).

## Overlaps / parallelism

- K9 rung 3 can start as soon as K1 lands (needs only ledger episodes).
- K3 and K2 run in parallel; K4 needs only K3's skeleton.
- K7/K8 block nothing downstream.
- Capture rungs C3+ deliberately FOLLOW the brief (K6): ambient sensors only earn their privacy cost once a visible daily surface makes the data useful.
- The two most invasive senses (input, screen, audio) sit BEHIND the K10 hardening gate — guarantees must be executable tests before raw capture flows. This ordering is the trust story of the product.

## Knowledge-graph technology decision (settled this session)

- **LangGraph: no — wrong category.** It's agent orchestration (nodes/edges/checkpoints/interrupts), not a knowledge graph; it competes with Bridge's pipeline/runtime, not GraphStore. The repo's rejection stands for that role: `interrupt()` re-runs nodes and duplicates side effects (Bridge's ledger pipeline is structurally immune — a governed action never re-executes), server runtime is Elastic-licensed, real CVEs.
- **KG substrate: stay on Postgres** for K3. Reasons: RLS/multi-tenancy security model is Postgres-native and load-bearing; transactional atomicity of materialization with ledger rows; Local Plane runs embedded pglite (no JVM/second store on desktop); personal/small-org scale (recursive CTEs suffice); co-location with pgvector + memories + ledger is what makes three-lane retrieval fusion cheap; "no-Neo4j" is existing vision canon and its reasons hold.
- **Borrow ideas, not dependencies**: Graphiti's (Apache-2.0) temporal-KG model — bi-temporal edges (when true vs. when learned), contradiction handling by edge invalidation rather than deletion — absorbed into the K3 claims/supersedence design behind our own port. Not adopted wholesale (drags Neo4j/FalkorDB + an extraction pipeline that bypasses the governed pipeline and taint model).
- **Revisit trigger (pre-agreed escape hatch)**: if consolidation needs real graph algorithms (community detection, deep multi-hop) or measured CTE performance becomes the bottleneck ⇒ add Kùzu (embeddable, permissive) as a **derived, rebuildable index** — same pattern as VectorIndex (refs only, truth stays in Postgres, droppable + rebuildable). The truth and the security boundary never move.

## Deliberately excluded

- LangGraph / Mem0 adoption (seams exist; adopt only if K3 consolidation proves painful — reuse-intake rule).
- Autonomous activation of anything — the human gate at every rung is the product's identity.
- Big-bang graph migration — GraphStore keeps working; K3 grows around it.

## Existing work slotted in

- TASK-040 (morning brief + commitments) = K6, design complete, paused.
- TASK-042 (per-class input packs) = feeds K9 rung 4. Status: ready.
- TASK-043 (constitution enforcement) = K10. Status: ready.
- LA2/LA5/archetypes (TASK-032/033) = the built-but-flighted substance of K0.
- EG4/EG5 roadmap slices = K11 (b)/(c); K11(a) input capture is net-new scope folded into that tier.
- `@bridge/sensors` SensorHub + CaptureLedger = K7's substrate (needs real provider + wiring).

## Open decisions (user's)

1. **Keystroke content vs. events** (K11a): capture actual characters (subject to the boundary), or only "typed N chars into 〈field〉 in 〈app〉"? Event-only is dramatically safer and likely sufficient for pattern-learning — recommended, but a product call.
2. **Unified-learning spec reconciliation**: `docs/superpowers/specs/2026-08-03-unified-learning-capability-design.md` (drafted, awaiting approval) overlaps K1–K3 — fold in or explicitly supersede; do not leave parallel.

## Next step when development resumes

Canonize: write the full `docs/raw/` plan with task mapping, add the APPROVALS row (reorders roadmap priorities — needs explicit user gate), open TASK rows for the new phases.
