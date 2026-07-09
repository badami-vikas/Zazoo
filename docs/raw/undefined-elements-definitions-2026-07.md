---
title: Bridge undefined-elements definitions (competitive-grounded)
type: raw
doc_kind: design
status: draft
companions: []
related_wiki: index.md
updated: 2026-07-08
tags: [design, gaps, competitive]
---

# Bridge undefined / underspecified elements — grounded definitions

This document enumerates the elements of the Bridge platform that are **named
but not specified in depth** (or explicitly marked TBD / open / deferred), then
defines each one: what it is, current repo state, how comparable platforms
solve it, and a concrete Bridge-native definition consistent with
ports-and-adapters + governed pipeline + local-first + two-plane constraints.

Ranking is by *leverage* — how much of the platform thesis ("software that
builds itself, governed and continuously evolved") is blocked or hand-waved
until the element is defined. Elements 1–13 are defined in full; §14 lists the
long tail.

Terminology note: this doc uses the ontology primitives (Agent / Automation /
Skill / Workspace / Element / Memory / Knowledge) from
`primitive-specifications.md`, and the code names (`ritual`, `tool`, package)
where load-bearing.

---

## Leverage ranking (summary)

1. **Eval harness + "what better means" metric set** — the promotion/evolution gate. Nothing evolves safely without it.
2. **Component Registry + similarity/overlap detection** — ground truth for "does this already exist?"; blocks Commons convergence, dedupe of capabilities, impact analysis.
3. **Memory subsystem (schema + classification + retrieval + Mem0 port)** — deferred table; the whole "learns how you work" promise sits on it.
4. **Variance Adjuster tuning algorithm** — the "veto tunes params not code" invariant has no defined parameter space or update rule.
5. **Blueprint format + compiler contract** — the literal mechanism of "Bridge generates software"; partially built, format under-specified.
6. **PromptAssembler** — kernel subsystem named in ADR-026, no schema/layering defined.
7. **Credential broker internals** — opaque-grant contract stated; rotation/scoping/storage/revocation unspecified.
8. **Competitor-discovery mechanism (Learning Agent)** — "dynamic, live at blueprint time"; no query grammar, caching, or trust model.
9. **Commons convergence + mining** — thresholds set; the mining/generalization/privacy-scrub pipeline undefined.
10. **Capability Trust Model: risk computation + trust-decay** — risk bands named, decay parameters and recompute cadence undefined.
11. **Spirit-animal / avatar personality system + onboarding-profile schema** — tone-to-animal mapping and profile→system-prompt seam explicitly "not designed yet".
12. **Knowledge / RAG layer** — retrieval, chunking, index, freshness undefined; unlock gate exists, engine doesn't.
13. **SandboxProvider port + Builder toolbelt** — port named (E2B/Daytona-later), interface/isolation policy undefined.

Long tail (§14): dream/reflection cycle · self-heal contract remap algorithm · description-tuning subsystem · package-owned migrations · per-human approval RBAC · mobile/desktop interaction models · workspace_definitions write path · entity-disambiguation tie-break.

---

## 1. Eval harness + "what better means" metric set

**(1) What it is / why it exists.** Bridge's core promise is *continuous
evolution*: a proposed Skill/Agent/Automation/Module must be able to *beat* the
incumbent on a repeatable, explainable basis before it is recommended or
promoted. The eval harness is the subsystem that scores two candidates on the
same axes every time and produces a governed verdict (retain / replace / keep-
both / merge / reject / experimental). "Better" must be *defined as data*, not
vibes, or the whole evolution loop is un-auditable.

**(2) Current repo state.** Named, not built.
`docs/raw/module-evolution-system-2026-07.md` §"Lightweight evaluation" specifies
the intent: Commons hosts an eval harness + dataset registry; axes = task
completion, quality/accuracy, reliability, safety, latency, cost, recorded
user/admin preference. ADR-013 adds the *promotion* semantics: **two-gate
promotion** (output-quality pass rate AND trigger precision/recall scored
independently), generalization-on-novel-tasks test, held-out eval selection,
baseline-vs-with-capability parallel runs. `PROMOTION_DEFAULTS` is slated to
gain trigger-accuracy + generalization fields (P3). No harness code, no dataset
schema, no scorer interface exists. Explicitly "build our own behind a port".

**(3) How comparable platforms solve it.**
- **Braintrust** — dataset + task + scorers; scorers are code or LLM-as-judge; runs produce experiment diffs with per-row scores; CI/CD gating (block deploy on regression). Pro: most complete single platform, self-host tier. Con: proprietary core, its scoring data model is external to Bridge. License: proprietary (hybrid self-host).
- **Langfuse** — MIT, fully self-hostable; eval harness with LLM-as-judge + custom scorers, dataset runs, OTel-native tracing. Pro: license fits, self-host has every feature. Con: observability-first; its "dataset run" is thinner than a promotion gate.
- **Arize Phoenix / OpenInference** — mature LLM-as-judge template library, notebook-friendly, OTel semantic conventions. Pro: reference templates for judges. Con: research/notebook posture, not a governance gate.
- **Anthropic skill-creator + MUSE-Autoskill** — the *pattern* Bridge already cites: pass-rate on held-out tasks + trigger precision/recall + generalization to novel tasks. This is the closest conceptual match to Bridge's two-gate model.

**(4) Bridge-native definition.**
Port `EvalHarness` in `@bridge/core`, adapters `InProcessEvalHarness` (default)
and later a Commons-hosted runner. Data model:

```yaml
EvalDataset:      { id, name, domain, cases: EvalCase[], owner, version, scope }   # scope: private cases never leave local plane
EvalCase:         { id, input, expected?, rubric?, tags[], origin }                # origin: seeded | veto-derived | user-supplied
Scorer:           { id, kind: deterministic|llm_judge|preference, weight, fn|prompt }
EvalRun:          { id, subjectRef, datasetId, scores: AxisScore[], cost, latency, seed, modelVersion }
AxisScore:        { axis, value 0..1, n, ci? }                                     # axes below
PromotionVerdict: { subjectRef, incumbentRef?, gates: {quality, trigger, generalization}, outcome, rationale }
```

Fixed axis set (the definition of "better"): **task_completion · quality ·
reliability · safety · trigger_precision · trigger_recall · generalization ·
latency · cost · user_preference**. Two independent gates (ADR-013): a
capability promotes only if it passes the **quality gate** (task_completion +
quality + safety above per-domain thresholds on a held-out set) AND the
**trigger gate** (precision/recall on a human-approved trigger eval set), AND
does not regress reliability/safety vs incumbent. Generalization is a third
scored-but-advisory signal at P3. Every run is deterministic (injected
Clock/Rng/IdGen, seed recorded — same replay discipline as the pipeline) and
writes to the **same ledger Approvals reads** (ServiceNow learning, per
module-evolution doc): a promotion is a governed proposal, never auto-live.
Local-first: private-scope datasets/cases are evaluated on the local plane and
structurally cannot cross the gate; only *generalized* scores (no case content)
may inform Commons. LLM-judge scorers run through `ModelProvider` (local model
default on capture plane).

**(5) Open decisions.** Per-domain threshold defaults (who sets them; are they
Variance-Adjuster-tunable?). Whether user_preference is an axis or a tiebreak.
How held-out sets are constructed for a workspace with almost no history
(cold-start eval). Whether the harness lives in `@bridge/core` or a new
`@bridge/eval` package.

---

## 2. Component Registry + similarity / overlap detection

**(1) What it is / why.** A platform-level registry of every reusable
Intelligence component (agent, skill, automation, workflow, prompt, eval set,
routing rule, policy, integration, template) so the system can answer "does this
already exist?" before generating a duplicate — the precondition for the
Learning Agent's "check overlap before building" mandate and for Commons
convergence.

**(2) Current repo state.** Net-new, designed not built
(`module-evolution-system-2026-07.md` §"Component Registry"). Metadata per
component specified: purpose, I/O contract, supported domains, source Module,
dependents, permissions, risk level, eval history, usage history, version,
owner, status. Build order stated: schema + CRUD (mirror `PackageStore`, live in
`@bridge/core`) → structural similarity → eval wiring. `PackageStore` and
`CommonsRegistry` exist; the Component Registry does not.

**(3) How comparable platforms solve it.**
- **LangChain Hub / Dust / n8n template libraries** — human-curated registries keyed by name/tag; no automatic overlap detection. Pro: simple. Con: duplicates proliferate.
- **Backstage (Spotify) software catalog** — typed entities + relations + owners + lifecycle in a graph; "who depends on what" impact analysis. Closest structural analogue to what Bridge wants.
- **Vector dedup (Pinecone/pgvector + embeddings)** — cosine similarity over descriptions to flag near-duplicates. The obvious "reach for embeddings" step Bridge explicitly wants to *defer* behind structural comparison.

**(4) Bridge-native definition.**
`ComponentRegistry` port + `DrizzleComponentStore`, schema mirroring
`capability_manifests` (reuse, don't fork). Entry:

```yaml
Component: { id, kind, name, purpose, io_contract, domains[], source_module,
             dependents[], permissions[], risk_band, eval_history[], usage_stats,
             version, lineage_id, owner, status }
```

Similarity in **two tiers** (per the doc's "structural first, embeddings
later"): **Tier 1 structural** = exact-ish match on (kind, task_type, input
schema, output schema, required Knowledge/permissions) — pure function, zero
tokens, deterministic, matches Bridge's "all threshold checks = pure fn/SQL"
rule. **Tier 2 semantic** = pgvector cosine over `purpose` + I/O description,
run only when structural is inconclusive, embeddings via `ModelProvider.embed`
(local default). Output is a ranked overlap list feeding the eval harness (§1)
which decides retain/replace/merge. Impact analysis = `dependents[]` graph
traversal over the same `edges` fabric as the Unified Graph.

**(5) Open decisions.** Whether Component Registry is distinct from
`capability_manifests` or a view over it (recommend: same table, `kind`
discriminator, to avoid a second source of truth). Embedding dimension pin
(already a v2 punch-list item). Cross-workspace visibility rules for the
registry (private components must not be globally searchable).

---

## 3. Memory subsystem (schema + classification + retrieval + Mem0 port)

**(1) What it is / why.** Memory is Bridge's learned, updateable context —
preferences, decisions, work history, approved summaries — that makes the
platform *personal*. It is distinct from Knowledge (curated reference) and
Incidents (raw history). Every capture is contracted to become an inspectable
Memory entry; the avatar blink is the tell.

**(2) Current repo state.** **Memory table deferred to P3** (Initiatives
decision, repeated in architecture/rituals wikis). Classification tiers *named*:
public / workspace / team / private / restricted, with per-agent authority-
scoped reads ("Relationship Agent reads notes NOT comp"). Capture path already
lands observations in `timeline_entries` (ADR-014) — which is *called* the
inspectable-Memory-entry shape — so the schema debt is partly absorbed. ADR-006
(f) reverses the earlier Mem0 rejection: **adopt Mem0 behind a port**, local-
plane compatible. `primitive-specifications.md` §Memory gives the full ontology
(recency, confidence, supersession, retrieval policy) but no storage/retrieval
mechanism. No `MemoryStore`, no Mem0 adapter, no retrieval seam exists.

**(3) How comparable platforms solve it** (fresh, 2025–26):
- **Mem0** — vector + graph + KV hybrid; automatic extraction from turns; multi-signal retrieval (semantic + BM25 + entity linking + temporal). Open-source self-host, bring-your-own store. Best general fit; the one Bridge chose to port. Apache-2.0.
- **Zep / Graphiti** — temporal knowledge graph; every fact time-anchored with provenance episodes; hybrid semantic+keyword+graph retrieval. Graphiti requires Neo4j — which Bridge **rejects** (no row-level tenancy). Borrow the temporal-invalidation idea, not the store.
- **Letta (MemGPT)** — OS-tiered memory (core / recall / archival) the agent self-manages with tools. Good model for *what to keep hot*; heavier runtime than Bridge wants as a dep.
- **OMEGA** — fully local, SQLite + ONNX local embeddings, AES-256 at rest, zero external deps. This is the *posture* Bridge's local plane wants (pglite + pgvector + local ModelProvider), validating the build-behind-port choice.

**(4) Bridge-native definition.**
Do **not** adopt a new table shape that competes with `timeline_entries`.
Define Memory as a **derived, classified layer** over captures plus an
explicit `memories` table for confirmed/superseded learned facts:

```yaml
Memory: { id, type: episodic|semantic|procedural|preference,
          subject_element_id?, scope: public|workspace|team|private|restricted,
          content, source_ref (timeline_entry|ledger|feedback), confidence 0..1,
          supersedes_id?, created_at, plane }
```

Port `MemoryStore` with `write(proposed) / supersede / retrieve(query, authScope)`.
`retrieve` is **authority-scoped at the store boundary** (not post-filtered):
scope × per-agent data_scope decides visibility, so "reads notes not comp" is
structural. Retrieval = Mem0-style multi-signal (pgvector semantic + pg_trgm
keyword + recency + confidence), embeddings via `ModelProvider.embed` local.
**Private/restricted Memory is local-plane only** and `private ∩ egress = none`
— cannot cross the gate, same as media blobs. Writes are **proposals through the
pipeline** (never silent): capture → derived Memory candidate → `pending_review`
→ approve → committed Memory + ledger. Adopt **Mem0 behind `MemoryStore`** as an
optional adapter for extraction/retrieval, but the default adapter is
pglite-native so the kernel has zero Mem0 dependency.

**(5) Open decisions.** Whether `memories` is a real table now or stays a view
over `timeline_entries` until P3 (recommend: thin table for confirmed/superseded
facts, captures stay in `timeline_entries`). Supersession policy (auto on
contradiction, or proposal). Whether procedural Memory auto-suggests
Automations. Embedding dimension pin (shared with §2).

---

## 4. Variance Adjuster tuning algorithm

**(1) What it is / why.** The last pipeline stage. Invariant across the repo:
**"veto tunes params, not code."** When a human rejects/edits a proposal, the
system must learn — but only by adjusting *tunable policy parameters*, never by
patching pipeline logic. This is how Bridge stays governable while adapting.

**(2) Current repo state.** Named everywhere (architecture pipeline diagram,
ADR-007, decisions-log ~L966–1007), runs "off VETTED only". `policy_params`
exists as the target of adjustment. But: **no parameter space is enumerated, no
update rule defined.** decisions-log says a veto "changes future policy
evaluation, not the pipeline's control flow" and is "adjustable by the fund's own
reviewers" — i.e. the *mechanism* is a policy-parameter store, but the
*algorithm* that maps a veto/edit into a parameter delta is undefined.

**(3) How comparable platforms solve it.**
- **Bandit / online-learning policy tuning** (e.g. contextual bandits) — map feedback to weight updates on features. Overkill and opaque for a governance surface.
- **Rules engines with human-tuned thresholds (OPA/Cedar data, Drools)** — parameters are data, humans edit them; no auto-learning. This matches Bridge's "reviewers adjust" posture but leaves the *suggestion* step manual.
- **RLHF / preference models** — learn a reward from accept/reject. Bridge explicitly does *not* want an opaque learned model gating governance.
- **Recommendation "thumbs" → feature weighting** — transparent, small, per-signal weights. Closest fit.

**(4) Bridge-native definition.**
Define the **tunable parameter space** as a typed, per-workspace
`policy_params` document — every number the pipeline reads that is *not* a hard
invariant:

```yaml
policy_params (per workspace, versioned):
  risk_band_thresholds: { informational, advisory, external }   # cut points
  auto_mode_budgets: { <resource>: count/window }
  require_approval_rules: [ {match, reason} ]
  confidence_floors: { <skill|domain>: 0..1 }
  signal_suppression: { <signal_type>: weight }
  variance_weights: { <feature>: number }        # what the adjuster nudges
```

Algorithm (deterministic, explainable, token-free): a veto/edit is written to
the ledger with a **structured reason chip** (design.md already routes "veto
reason → Variance Adjuster"). The adjuster maps the chip to a **bounded delta**
on exactly one parameter (e.g. "too risky" on an advisory-band action → nudge
that action-class threshold toward External by a fixed small step, clamped),
and **proposes** the change as a governed diff the reviewer approves — never
auto-applies. Edits (not vetoes) feed the eval harness as new `veto-derived`
eval cases (§1). Invariants preserved: agent-floor DENY, trifecta escalation,
and hard ceilings are **not** in the tunable space — the adjuster physically
cannot relax them. This keeps "veto tunes params not code" literal and auditable
(every nudge is a ledger row with before/after).

**(5) Open decisions.** Step size / clamp per parameter class. Whether nudges
auto-apply above a trust threshold or always require approval (recommend: always
propose; auto-apply only inside the same auto-mode allowlist). Whether the
reason-chip taxonomy is fixed or workspace-extensible.

---

## 5. Blueprint format + compiler contract

**(1) What it is / why.** The literal artifact that proves "Bridge can generate
software": onboarding answers → a `WorkspaceBlueprint` → `compileBlueprint()` →
a `CompiledWorkspace` (ElementTypes + Views + installed capabilities) rendered
through the `<DataViews>` grammar. It is the compiler in Kernel → Compiler →
Runtime → Generated Workspace.

**(2) Current repo state.** **Partially built** (ADR-017/019, P1 DONE).
`packages/core/src/blueprint.ts` has a pure `compileBlueprint()` (validated
`WorkspaceBlueprint` → `CompiledWorkspace`); `<DataViews>` shell enforces the
view grammar, mobile-safe; onboarding = 5–12 adaptive Qs via a pure step fn;
blueprint submitted as a governed proposal via `workspace.blueprint.propose`.
`workspace_definitions` table created; **write path still P1 work**. Gaps
(BUGS.md): no `getById` endpoint, diff-preview only works when referenced draft
== active definition, `buildBlueprintFromAnswers` has no model provider wired
(deterministic only). The **format itself is under-specified** as a durable,
versioned, package-publishable contract (it must round-trip through Commons as a
`workspace-definition` manifest).

**(3) How comparable platforms solve it.**
- **Notion AI / Fibery** — generate databases + views from a prompt; schema is proprietary internal, not a portable versioned artifact; no governance gate before activation.
- **Retool / Refine / Appsmith** — app = JSON/DSL config compiled to a UI; portable, versionable. Refine's headless "resource + data-provider" pattern is a cited reference (borrow, don't dep).
- **Airtable / Baserow schema-as-JSON** — typed field defs + view configs, exportable. Close to Bridge's ElementType + View model.
- **Backstage software templates (scaffolder)** — parameterized templates → generated catalog entities with owners; governance/ownership baked in.

**(4) Bridge-native definition.**
Freeze `WorkspaceBlueprint` as a **versioned, publishable manifest** distinct
from the compiled runtime object:

```yaml
WorkspaceBlueprint (authored/generated, portable, Commons-publishable):
  id, name, version, domain, origin: generated|package|user
  element_types: [ {name, fields[], relationships[], lifecycle[], default_views[]} ]
  views:         [ {type, element_type, filters, sorts, grouping} ]   # <DataViews> grammar
  capabilities:  [ {ref, pin_version} ]        # skills/agents/automations to install
  policies:      [ ... ]                        # workspace-scoped policy seeds
  onboarding_answers_ref                        # provenance
CompiledWorkspace (runtime, not published): compileBlueprint(blueprint) -> routes/views/typed stores
```

Rules: `compileBlueprint` stays a **pure function** (deterministic, testable,
already true). Generation adds a model-backed `buildBlueprintFromAnswers`
(currently missing) that emits a *blueprint*, which is then compiled — LLM never
emits runtime code, only the validated declarative manifest (self-heal +
governance apply at the manifest boundary). Blueprint publish to Commons goes
through the **knowledge-only privacy gate** (no workspaceId/personId/values —
already enforced in `privacy-gate.ts`), so a blueprint is generalized capability
knowledge, never an install. Activation is a governed proposal (draft-then-
approve), diffable against the active definition (fix the `getById` gap).

**(5) Open decisions.** Package-owned migrations vs shared kernel schema when a
blueprint adds ElementTypes (open in packages.md — blast radius unresolved).
Whether view grammar is closed (fixed `<DataViews>` set) or extensible per
package. How generated blueprints are eval'd before recommend (ties to §1).

---

## 6. PromptAssembler

**(1) What it is / why.** A kernel subsystem (adopted in ADR-026, "layered
system-prompt uplift à la Claude Code / pi.dev") that assembles an agent's
system prompt from layered, governed fragments — identity/persona, authority
scope, available capabilities, retrieved Memory/Knowledge, workspace context —
so prompts are composed, auditable, and reproducible rather than hand-written
strings.

**(2) Current repo state.** Named in ADR-026 as a "PromptAssembler kernel
subsystem"; **no schema, no layering model, no code.** Today `chief-of-staff.ts`
is a single node with an inline prompt; the 4 non-CoS agents are "prompt
fragments inside one CoS call" (foundational-agents wiki) — the exact anti-
pattern PromptAssembler should replace. The onboarding-profile → CoS-system-
prompt seam is explicitly "doesn't exist yet".

**(3) How comparable platforms solve it.**
- **Claude Code** — layered system prompt: tool defs + environment + project CLAUDE.md + memory + skills, assembled deterministically each turn. The cited model.
- **pi.dev** — progressive-disclosure capability injection (≤N tools active, deferred registry lookup). Bridge already adopted the ≤20-tools rule (ADR-013) — PromptAssembler is where it lives.
- **DSPy** — prompts as *compiled* modules from signatures + optimizers; the prompt is generated, not written. Most rigorous; heavier than Bridge needs at v1 but the "signature → assembled prompt" idea fits.
- **LangChain hub / PromptLayer** — versioned prompt templates with variables. Thin; no layering/governance.

**(4) Bridge-native definition.**
`PromptAssembler` in `@bridge/core`, pure function
`assemble(context) -> AssembledPrompt` composed of ordered, typed **layers**:

```yaml
layers (ordered, each provenance-tagged):
  1 kernel_invariants     # never-omit governance rules (agent-floor, trifecta)
  2 agent_identity        # persona/tone (spirit-animal for CoS), archetype, responsibilities
  3 authority_envelope    # effective scope this turn (role ∩ scope ∪ ephemeral − deny)
  4 capability_manifest    # ≤20 active tools (ADR-013), rest deferred-lookup
  5 retrieved_memory      # authority-scoped Memory (§3), provenance-linked
  6 retrieved_knowledge   # cited Knowledge passages (§12)
  7 workspace_context     # element/view state
  8 task_request          # the normalized Request
AssembledPrompt: { text, layer_provenance[], token_count, model_target }
```

The assembled prompt and its `layer_provenance` are recorded in the **execution
snapshot** (the pipeline already logs `prompt` for replay — PromptAssembler
makes that field structured, not opaque). Layer 1 is non-omittable (physically
prepended, matching agent-floor's non-removable posture). Persona layer for CoS
pulls tone from the spirit-animal system (§11). Determinism: same context →
byte-identical prompt (replayable). This also resolves the foundational-agents
gap: the 4 delegate agents become **separate assemble() calls with their own
layer-2/3/4**, not fragments in one CoS string.

**(5) Open decisions.** Token-budget arbitration when layers overflow (drop
order? summarize Memory?). Whether persona affects only layer 2 or also output
post-processing. Where the onboarding profile injects (recommend: seeds layer 2
+ workspace defaults, stored as Memory scope=workspace).

---

## 7. Credential broker internals

**(1) What it is / why.** "Tools never own OAuth" (ADR-006) — a generated Tool
that needs an external API gets a **brokered, opaque grant reference**, never an
embedded secret. The broker is how the two-plane gate stays enforceable for
third-party APIs.

**(2) Current repo state.** Contract stated (ADR-012/ADR ~L1627): "Credential
broker returns only an opaque grant reference, never a secret —
`CredentialBroker` ...". Capability module (`packages/core/src/capability/`)
includes a credential-broker file. But **rotation, scoping granularity, storage
plane, revocation, and the resolve-at-call-time mechanism are unspecified.** DEFER
tail mentions "AES-256 cred vault + KMS" as enterprise follow-up. OAuth tokens
are stated to live local-plane only (never Supabase).

**(3) How comparable platforms solve it.**
- **HashiCorp Vault** — secrets stored centrally, short-lived dynamic secrets, lease + revoke; app gets a lease, not the secret at rest. The canonical model for opaque-grant + rotation.
- **Nango** (cited adopt-behind-port in decisions) — managed OAuth: stores tokens, refreshes, exposes a `getToken(connectionId)` — the app references a connection, not a token. Closest product fit.
- **AWS STS / workload identity** — mint short-lived scoped credentials on demand; never long-lived keys in code.
- **OAuth token-exchange (RFC 8693)** — exchange a subject token for a scoped-down token per call.

**(4) Bridge-native definition.**
`CredentialBroker` port: `mint(grantSpec) -> GrantRef`,
`resolve(GrantRef, callerContext) -> ScopedHandle`, `rotate`, `revoke`.

```yaml
GrantRef: opaque string (ULID) — safe to store in manifests/ledger
Grant:    { id, provider, scopes[], workspace, actor_ceiling, plane: local,
            expires_at, rotation_policy, status }
ScopedHandle: live, in-memory, never persisted; issued only at Action call time
              after Authority + planeGate pass; carries provider client bound to scopes
```

Rules: the **secret/token never leaves the local plane** and is never returned
to an Agent/Skill — a Skill holds a `GrantRef` and asks an **Action** (governed
caller) to perform the provider call; the Action calls
`broker.resolve(ref, ctx)` which mints a `ScopedHandle` only if the caller's
effective authority ⊇ grant scopes and the plane gate permits egress. This keeps
"agent → Pipeline → tool, never agent → tool direct" true for credentials too.
Rotation = refresh-token flow behind the port (Nango adapter cloud, pglite-vault
adapter local); revocation flips `status` and any live handle fails closed.
Storage: encrypted at rest on the local plane (AES-256 seam day 0, KMS enterprise
tail). Every mint/resolve/rotate/revoke is a ledger Incident.

**(5) Open decisions.** Scope granularity (per-provider vs per-endpoint).
Whether `ScopedHandle` is per-call or per-run cached. Shared-link/standalone tool
mode (cloud plane, no account) credential story — currently these run cloud-plane
with public scope only; a friend-mode tool needing an API key is unresolved.

---

## 8. Competitor-discovery mechanism (Learning Agent)

**(1) What it is / why.** Bridge ships **no hardcoded competitor table**
(ADR-012 e). When a compiled product (DealPilot, etc.) is blueprinted, the
Learning Agent researches that product's competitive landscape **live** via web
search (egress through the pipeline), so positioning is always current and
domain-specific.

**(2) Current repo state.** Policy decided (ADR-012, decisions-log ~L1565), no
mechanism. It's "the Learning Agent researches live at blueprint time" — but the
Learning Agent itself is docs-only (foundational-agents), and there is no query
grammar, source-trust model, caching, or output schema. Firecrawl + Stagehand
are adopt-behind-port for the fetch layer (OSS map).

**(3) How comparable platforms solve it.**
- **Perplexity / GPT "deep research"** — iterative search → fetch → synthesize with citations. The interaction pattern.
- **Clay / Clearbit-style enrichment** — structured provider waterfalls; Bridge's Recon tool already does staged draft-then-approve OSINT — the same governance pattern applies.
- **Firecrawl / Exa / Stagehand** — search + scrape + structured extraction behind an API; Firecrawl is already Bridge's chosen adapter.

**(4) Bridge-native definition.**
A `competitor-discovery` **Skill** (not a bespoke subsystem), invoked by the
Learning Agent at blueprint time, running entirely through the governed pipeline
as an **egress research action**:

```yaml
input:  { domain, product_archetype, blueprint_ref }
steps:  query synthesis -> Firecrawl/Exa search (external:fetch via gate)
        -> Stagehand structured extract -> dedupe (@bridge/dedupe)
        -> synthesize CompetitorBrief (ModelProvider, cloud plane)
output: CompetitorBrief { competitors:[{name, positioning, evidence_urls[], captured_at}],
                          confidence, sources[] }  -> lands as reviewable Artifact/Knowledge
```

Governance: it is **External band by definition** (untrusted-content ingest +
egress = trifecta → forced human review). Results are **Knowledge, time-stamped
and cited**, never silently promoted; stale briefs (> freshness window) trigger a
re-run Signal. Caching: per-domain briefs cached as Knowledge with `captured_at`;
a new blueprint in the same domain reuses if fresh, re-runs if stale. Bridge
still ships zero static competitor data — the *cache* is user-workspace Knowledge,
not a shipped table.

**(5) Open decisions.** Freshness window per domain. Whether briefs are shareable
to Commons (must be generalized/scrubbed first — likely no, they reference named
third parties). Source-trust weighting (how to rank a competitor's own site vs a
review aggregator).

---

## 9. Commons convergence + mining

**(1) What it is / why.** Commons v1 is a curated human-published registry. The
*evolution* promise is that widely-repeated local patterns eventually
**converge** into generalized Commons capabilities (the "software learns across
users" flywheel) — but **only generalized knowledge, never user data**.

**(2) Current repo state.** Thresholds set (roadmap): convergence N = **10% of
users ≤100 · 5% ≤500 · 1% ≤2000 · 0.1% after** (user call). Contribution is
External band by definition (trifecta) → human reviews the exact artifact. Commons
= curated registry today; **"Mining later"** — the mechanism that detects a
convergent pattern, generalizes it (strips all PII/workspace specifics), and
proposes it for publish is undefined. The privacy gate (`privacy-gate.ts`) already
blocks user-data keys at publish.

**(3) How comparable platforms solve it.**
- **VS Code / npm / Homebrew registries** — pure human publish; no mining. Bridge v1 = this.
- **Federated learning / differential privacy aggregation** — learn cross-user patterns without centralizing raw data. The rigorous version of "converge without leaking"; likely heavier than v1 needs.
- **GitHub "used by" / dependency insights** — count adoption to surface popular components. The counting half of convergence.
- **Wikidata / community-vote curation** — the entity-disambiguation crowd-merge model Bridge already uses (threshold votes) is the same shape as convergence thresholds.

**(4) Bridge-native definition.**
Mining runs **locally-first and count-only**: each surface reports, through the
Bridge Cloud control plane (NOT Commons), an **anonymous structural fingerprint**
of a locally-created capability (kind + I/O schema hash + domain — the Tier-1
structural signature from §2, containing zero content/PII). The control plane
counts fingerprints; when a fingerprint's adoption crosses `getThreshold(userCount)`
(same shape as the entity-merge threshold formula), it raises a **convergence
Signal**. A human (or CoS) then authors a *generalized* capability from the
pattern — the artifact is built fresh from the schema signature, never lifted from
any user's instance — and publishes it through the existing knowledge-only privacy
gate (External band, human-reviewed). Convergence never moves data: it moves a
*count* and triggers a *from-scratch generalization*. Commons and the counting
control plane stay strictly separate (roadmap invariant: Commons never holds
per-user data).

**(5) Open decisions.** Where fingerprints are counted (Bridge Cloud control
plane — needs a minimal counting service; not built). Whether fingerprints leak
anything (schema hashes of a niche domain could be identifying — needs review).
Whether generalization is CoS-drafted or always human. Opt-out (a workspace must
be able to not contribute fingerprints).

---

## 10. Capability Trust Model: risk computation + trust-decay

**(1) What it is / why.** P0 kernel. Risk is **computed from manifests** (not
hand-assigned), approvals are trust-based, the External band is always human at
launch. Trust is *earned* (a capability ramps from full-review toward auto) and
must *decay* (unused/misbehaving capabilities lose autonomy) — otherwise trust is
a ratchet, which is unsafe.

**(2) Current repo state.** **Risk computation partly built**: capability module
computes risk bands (informational/advisory/external) from manifest permissions;
ADR-014 shows sensors computing their own band. Trifecta auto-escalation is a
seeded non-removable policy (P0). **But**: auto-activation budgets are in-memory,
not in `policy_params` (v2 punch-list). Honest gap (BUGS.md): "no real computed
risk for a generic `Proposal` today — `computeRisk` labeled '(estimated)'". And
**trust-decay is entirely undefined** — there are trust bands and a promotion
ladder but no decay parameters or recompute cadence.

**(3) How comparable platforms solve it.**
- **OPA / Cedar / OpenFGA** — policy-as-data authorization; Bridge **rejects them as deps** (own governance = moat) but borrows the "risk/authz = evaluable data" stance.
- **Zapier/Make** — no trust decay; static permission grant. ADR-013 notes nobody ships promotion gates — this is Bridge's differentiation.
- **SRE error budgets** — a budget that depletes on incidents and refills over time. The right analogue for trust-decay: autonomy is a budget, misbehavior/disuse depletes it.
- **Credit-scoring / reputation decay** — time-decayed reputation with recency weighting.

**(4) Bridge-native definition.**
Risk = pure function of manifest (already the direction): `computeRisk(manifest)`
→ band from (permissions × data_scope × egress × trifecta-union). Make it *real*
for generic proposals (close the "estimated" gap) by giving every proposal a
minimal manifest (resource types touched + egress flag). **Trust as a decaying
budget** in `policy_params`:

```yaml
capability_trust: { subject_ref, band, autonomy_budget 0..1,
                    earned_from: eval_pass_rate + clean_run_count,
                    decay: { half_life_days, incident_penalty, disuse_penalty },
                    last_recompute }
```

Trust *earns* via eval-harness passes (§1) + clean governed runs; **decays** by a
half-life (disuse) and by step penalties on incidents/vetoes. Recompute is
**event-driven, token-free, pure SQL** (on each run outcome + a periodic
reflection ritual), matching "all threshold checks = pure fn/SQL". When
autonomy_budget drops below the auto-mode floor, the capability silently reverts
to `pending_review` (auto-mode allowlist ∩ budget). Hard ceilings (agent-floor,
External-always-human) are **outside** the budget — decay can only remove earned
autonomy, never breach a floor.

**(5) Open decisions.** Half-life defaults per band. Whether decay auto-applies
or proposes (recommend: auto for *reducing* autonomy, propose for restoring).
Interaction with Variance Adjuster (§4) — both touch `policy_params`; need one
writer discipline.

---

## 11. Spirit-animal / avatar personality system + onboarding-profile schema

**(1) What it is / why.** Personality is the "Pi 4th pillar", shipped day 1
(roadmap, un-deferred). The user picks a spirit animal; the Chief of Staff *is*
that animal at reveal; the avatar meditates/awakens/blinks on `sensor.capture`
(the capture tell) and click → inspectable Memory entry. Tone of the
Communications Agent must **match the chosen animal**.

**(2) Current repo state.** Avatar visuals partly built (web persona v1 tracked;
overlay state machine collapsed→hover→expanded→working). Onboarding flow specced
(14 steps, ADR-033). **Explicitly not designed** (foundational-agents wiki):
(a) tone-to-animal mapping — current `SPIRIT_ANIMALS` = 6 animals visual-only,
spec lists 14, no tone param; (b) onboarding-profile schema + how it becomes
CoS's system prompt (Memory/Knowledge seam is right, schema doesn't exist).

**(3) How comparable platforms solve it.**
- **Pi (Inflection)** — a single fixed warm persona; tone is a product constant, not user-selected. Bridge extends this to *chosen* identity.
- **Character.ai / Replika** — persona = a prompt card (name, tone, backstory, example lines) injected into the system prompt. The mechanism Bridge should copy for the animal→tone map.
- **Claude/GPT custom instructions / "personality"** — a small structured profile (tone, verbosity, values) prepended to the system prompt.
- **Slack/Notion onboarding profiles** — role/goals/tools captured as structured fields that seed defaults.

**(4) Bridge-native definition.**
Two artifacts. A **SpiritAnimal tone card** (static Commons-shippable Knowledge,
14 entries):

```yaml
SpiritAnimal: { id, name, visual_ref, tone: {warmth, directness, playfulness, formality},
                voice_examples[], blink_style }
```

The card feeds PromptAssembler layer 2 (§6) for CoS and the Communications Agent
(so "tone matches animal" is structural, not a convention). An **OnboardingProfile**
stored as **Memory scope=workspace** (the right primitive family, per the wiki):

```yaml
OnboardingProfile: { user_id, workspace_id, role, goals[], domains[],
                     connected_sources[], chosen_animal_id, working_style_notes,
                     source: onboarding }  # seeds CoS system prompt via PromptAssembler
```

CoS's system prompt = PromptAssembler(assemble) with layer 2 = animal tone card +
OnboardingProfile identity/goals. Avatar state machine stays desktop-shell
concern; the `sensor.capture` DomainEvent (ADR-014) is the blink trigger — already
the defined seam. Personality never touches authority (persona = tone only, per
primitive spec).

**(5) Open decisions.** The 14-animal tone parameterization (who authors the
cards). Whether animal is changeable post-onboarding (CoS is non-deletable but is
its identity mutable?). How much of OnboardingProfile is inferred (Gmail scan) vs
asked.

---

## 12. Knowledge / RAG layer

**(1) What it is / why.** Knowledge = curated reference (docs, playbooks,
resources, validated external info), distinct from learned Memory. It is
retrieved as scoped, cited context by Agents/Skills. The Home surface gates a
"Knowledge" section that unlocks at 2+ connected sources — implying a real
ingestion + retrieval engine.

**(2) Current repo state.** Ontology fully specced (`primitive-specifications.md`
§Knowledge: provenance, freshness, citation, indexing). Unlock gate specced
(foundational-agents). Docling adopted-behind-port for parsing (OSS map). pgvector
+ pg_trgm available. **But the retrieval engine — chunking, indexing strategy,
freshness checks, citation surfacing — is undefined**, and no `KnowledgeStore` /
retrieval seam exists.

**(3) How comparable platforms solve it.**
- **LlamaIndex / LangChain RAG** — load → chunk → embed → vector store → retrieve → cite. The commodity pipeline; Bridge builds behind a port.
- **Notion AI / Glean** — index connected sources, hybrid retrieval, inline citations, permission-aware retrieval. The permission-aware part matches Bridge's authority-scoped read requirement.
- **Docling (IBM)** — document → structured representation (Bridge's chosen parser adapter).
- **Graphiti/Zep** — temporal + provenance for knowledge freshness; borrow freshness/provenance ideas.

**(4) Bridge-native definition.**
`KnowledgeStore` port over pglite + pgvector: `ingest(source) / retrieve(query,
authScope) / refresh`.

```yaml
KnowledgeItem: { id, source, source_type, version, scope, chunks: [{text, embedding, span}],
                 citation_meta, freshness: {ingested_at, ttl, stale}, plane }
```

Pipeline: Docling parse (behind port) → semantic chunking → `ModelProvider.embed`
(local default) → pgvector index (hnsw). Retrieval = **hybrid** (pgvector semantic
+ pg_trgm keyword) + rerank, **authority + data-scope filtered at the store
boundary** (permission-aware, like Memory §3). Every retrieved passage carries
`citation_meta` so the "no naked claims / cite sources" invariant holds and the
execution snapshot records Knowledge used. Freshness = TTL per source_type; stale
items raise a re-ingest Signal. Private-scope Knowledge stays local-plane. Shares
the embedding-dimension pin with §2/§3.

**(5) Open decisions.** Chunking strategy per source_type. Rerank model (local vs
cloud). Whether Knowledge and Memory share one retrieval seam or two (recommend:
two ports, one hybrid-search util). Index cost/refresh cadence on the local plane.

---

## 13. SandboxProvider port + Builder toolbelt

**(1) What it is / why.** The Capability Builder generates new capabilities;
executing generated/untrusted code needs isolation. ADR-026 adds a **Builder
toolbelt** (`fs:read` / `fs:write` / `code:exec` governed primitives) + a
**SandboxProvider port** (Bridge currently has *no* Read/Write/Edit/Bash
equivalent). n8n RCE CVE is cited as the reason code nodes must be isolated,
no-network, brokered.

**(2) Current repo state.** Named (ADR-026, rituals wiki: "raw JS only in
external-container isolated-vm, no network, brokered"). OSS map: **E2B or Daytona
later**. **No port interface, no adapter, no toolbelt code.** Ritual code nodes
default to typed expressions (JMESPath/Jexl); raw code is the escape hatch that
needs the sandbox.

**(3) How comparable platforms solve it** (fresh, 2025–26):
- **E2B** — Firecracker microVM per sandbox, dedicated kernel (strongest isolation), ~150ms cold start, open-source, purpose-built for agents. Best isolation fit.
- **Daytona** — OCI containers, sub-90ms cold start, K8s self-host, Computer-Use focus. Faster but shared-kernel (weaker boundary).
- **Modal** — sub-second, scales to millions/day, GPU. Overkill for Bridge's per-node code eval.
- **isolated-vm / gVisor / Kata** — in-process or syscall-filtered isolation; `isolated-vm` is what the rituals doc already names for the no-network JS case. Cheapest, weakest (fine for pure expression eval).

**(4) Bridge-native definition.**
`SandboxProvider` port: `run(spec) -> SandboxResult`.

```yaml
SandboxSpec:  { code|command, runtime, files_in[], timeout, network: none,
                resource_limits, egress_grants: [] }   # network default none
SandboxResult:{ stdout, stderr, files_out[], exit_code, cost, duration }
```

Two adapters matching the two risk tiers: **`IsolatedVmSandbox`** (in-process,
no network, for typed-expression / trivial JS — the default, matches rituals
doc) and **`E2bSandbox`** (Firecracker microVM, for real code:exec — strongest
boundary, recommended over Daytona because Bridge's threat model is running
*generated/untrusted* code, where a dedicated kernel per run matters more than
cold-start ms). Governance: `code:exec` is a **brokered primitive** — an Agent
never calls the sandbox directly; it proposes an Action through the pipeline;
network is **default-none** and any egress must come as explicit `egress_grants`
resolved through the credential broker (§7) + plane gate. Builder toolbelt
(`fs:read/fs:write/code:exec`) = governed Actions with their own risk bands
(code:exec = External band by default). Files in/out are the only channel; no
ambient host access.

**(5) Open decisions.** Local-plane sandbox posture (E2B is cloud — a local-first
user may need a local Firecracker/Kata option, or accept that code:exec is a
cloud-plane egress by nature). Self-host vs managed E2B. Whether the Tauri
desktop shell offers a native local sandbox.

---

## 14. Long tail (briefly defined)

- **Dream / reflection cycle.** No spec. Define as a scheduled Automation
  (Hatchet) that runs token-cheap maintenance off VETTED data only:
  trust-decay recompute (§10), stale-Knowledge freshness Signals (§12), Memory
  supersession review (§3), convergence-fingerprint counting (§9). Not an
  autonomous rewrite loop — every output is a Signal/proposal, never a silent
  change. Open: cadence, cost ceiling.

- **Self-heal contract remap algorithm.** Seam exists (typed JSON-Schema per
  node boundary; drift → *proposed* remap through pipeline, never silent). The
  *matcher* (how a changed field is mapped to the old contract — name/type
  similarity + LLM suggestion) is undefined. Define as structural match first
  (name/type/format), LLM fallback, always a governed diff.

- **Description-tuning subsystem** (ADR-013 item 8). Named as "its own subsystem
  with human-approved trigger eval sets" — i.e. a loop that tunes a capability's
  *trigger description* against a trigger eval set (precision/recall from §1).
  Undefined beyond the pointer. Reuses §1 harness + §4 propose-then-approve.

- **Package-owned migrations vs shared kernel schema** (packages.md open Q).
  Unresolved blast radius when a package/blueprint adds ElementTypes. Recommend:
  packages declare ElementTypes as *namespaced* additions validated at install
  by a governed migration proposal; no package touches kernel tables.

- **Per-human approval RBAC** (BUGS.md, OPEN). Agent-floor blocks agents from
  approving, but *any* human can approve anything. Define approval authority as
  a role grant (`approve:<resource>` scope) resolved by the same Authority model;
  External band may require a specific role.

- **Mobile / desktop interaction models.** Desktop overlay state machine v1
  exists (collapsed→hover→expanded→working); mobile interaction model is
  unspecified beyond "thin client". Notion-model: same kernel, thin surface —
  define per-surface capability subsets (already true for sensors,
  `SURFACE_PROVIDER_KINDS`); extend the pattern to interaction affordances.

- **`workspace_definitions` write path.** Table created, read path partial,
  write path still P1 (§5 covers the blueprint side). Needs `getById` +
  active-vs-draft diff endpoints (BUGS.md).

- **Entity-disambiguation tie-break** (testing.md: dedupe misses the equal-score
  case — no test exists). Define an explicit deterministic tie-break (source
  priority order, then lower `eid`) and add the equal-score test.

- **Rate limiting / caching layer** (BUGS.md, OPEN). No rate limiting anywhere in
  `apps/api`; CORS open; `action.propose` lets client pick any agent/workspace.
  Define per-workspace + per-actor token buckets at the tRPC boundary + a
  membership check on `workspaceId`.

---

## Cross-cutting invariants every definition above respects

- Ports-and-adapters: every new subsystem is a port in `@bridge/core` with an
  in-memory/pglite default adapter, so the kernel boots with zero infra and stays
  surface-agnostic.
- Governed pipeline: nothing auto-mutates; every change is a proposal to the same
  ledger Approvals reads. Threshold checks are pure fn/SQL, zero LLM tokens.
- Two planes: private/restricted data (Memory, credentials, private Knowledge,
  raw captures) is local-plane only and structurally cannot cross the gate.
- No hardcoded external knowledge: competitor data, Commons content, and
  generalized patterns are researched/curated, never shipped as static tables.
- Trust is earned *and* decays; hard ceilings (agent-floor DENY, trifecta,
  External-always-human) are outside every tunable space.
