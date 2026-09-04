# Architecture (wiki)

full: [../raw/ARCHITECTURE.md](../raw/ARCHITECTURE.md) · **end-to-end Kernel→Compiler→Runtime→Generated-Workspace walkthrough (2026-07-09)**: [../raw/architecture-end-to-end-2026-07.md](../raw/architecture-end-to-end-2026-07.md)

Platform-first: substrate + governance spine + capability registries. Pages/Rituals/Tools = config instances, not bespoke code.

**Primitive mapping** ([ontology](ontology.md), 2026-07-07): code `ritual` = **Automation** · code `tool`/ToolManifest = implementation surface, user-facing primitive = **Workspace** · Connection = **Integration** · Signal = derived **Incident** (not a root primitive) · Chief of Staff = **Agent** archetype. This page keeps code names; primitives per ontology.

**3 shared interconnect mechanisms** (pages never call each other direct):
- Unified Graph = shared state.
- Event/Signal Bus = propagation.
- Universal Action Pipeline = governed execution.

**Two planes** (one graph, two governance zones):
- Mirror = Person/Community + relational edges. Pure. Exportable. Never polluted by ops/infra nodes.
- Operational = Initiative/Touchpoint/Ritual/Tool/Agent/Skill/File/Signal/Ledger. Reference Mirror, don't pollute.
- Obsidian "everything-node" reconcile: ONE `edges` fabric for traversal + AI-readiness; `plane` tag per node_type; cross-plane edges whitelisted only (PARTICIPATES_IN/ASSIGNED_TO/GENERATED_BY/DERIVED_FROM/REFERENCES/SUPPORTS/ALIGNS_TO). Refuse non-whitelisted Mirror↔Op edge at write.

**Universal Action Pipeline** (every mutation):
Request → Authority → Policy(pre) → Agent+Skill → Policy(runtime) → User Review(approve|veto|edit) → Ledger(append) → Policy(post) → Variance Adjuster → Output/Event.

**Authority** (who may act — 4 layers, deny-default):
- Role grants: principal holds `role`; agent `assumes_role_id` → INHERITS role grants.
- Capability ceiling: agent `capability_scope` = CEILING not grant. base = role ∩ scope.
- Ephemeral grants: minted per ritual/initiative run, `expires_at`, then lapse.
- Explicit deny wins. Seeded agent-floor DENY (no edit policy/skill/agent/role/ledger · no full-graph read · no external send) = non-removable.
- Formula: `(role ∩ capability_scope) ∪ active ephemeral − deny`. On-behalf-of → also ∩ principal authority; ledger writes `on_behalf_of`+`delegation_id`.
- RLS = tenancy + visibility (DB). Resolver = capability (in-tenant). Compose, don't replace.

**Local ↔ Gate ↔ Cloud (two-plane agents)** — PRIORITY TRACK (see decisions):
- **Local plane** = the customer-controlled relationship tier (private Person/Community/Memory/Touchpoint). Lives in a LOCAL store (machine/VPC — pglite/Postgres via ports/adapters). Never leaves.
- **The gate** = the Universal Action Pipeline. The ONLY path between local and any internet egress. Deny-default; data-scope `private` ∩ egress = `none` ⇒ reject (private structurally cannot cross); `external:send`/`network_graph:full` = agent-floor DENY; every crossing append-only audited.
- **Cloud plane** = canonical/public facts + enrichment + outbound send. Reachable only THROUGH the gate, only with public-scoped + human-approved requests.
- **LOCAL agents** REQUEST internet data (never touch the internet directly) + DRAFT actions on the local tier. **GLOBAL/EGRESS agents** SOURCE it — fetch/enrich/send. Same Pipeline governs both; the gate is where data-scope + agent-floor enforce the split.
- **Dual-write sourcing**: internet-sourced facts land BOTH in cloud canonical AND in the local store (both planes need them). Private relationship data = local ONLY, never crosses outward (`private` ∩ egress = `none`).
- **Status**: gate ✅. **plane gate ✅ — structural in core** (`Actor.plane local|cloud`; `planeGate()` Layer 0.5: local→egress DENY, cloud ceiling-clamped to public; `external:fetch` resource added; 38/38 tests incl. 3 gate invariants; enforced over HTTP). local store ✅ — `@bridge/db` `createLocalDb` (pglite, SAME Drizzle ports, pgvector loaded) binds the local plane; private content + OAuth tokens local-only, never Supabase. Media blobs land on the same local plane via **`LocalMediaStore`** (2026-06-20). Governance ledger/people still cloud Supabase by default in the running API (next slice). E2EE-at-rest = Phase 6.

**`LocalMediaStore`** (local-plane blob seam, 2026-06-20): new port = `put/get/getBlob/list/update/archive`. Camera photo/video blobs (private relationship data) live here ONLY — never Supabase Storage / cloud bucket. `private ∩ egress = none` ⇒ blob can't cross gate. Append-only put (dup id throws); blob + identity immutable on update; no hard delete (`archive` sets `archived_at`). Adapters: `PgliteMediaStore` (Postgres-in-process WASM, `bytea`, the documented "pglite/Postgres via ports/adapters", tested) + browser `idb`. Commit path: `media.v1` proposal (no blob, just `local_media_id` + facts) → pipeline → Touchpoint + ledger; media row flips `committed` w/ `ledger_id`. Mirrors existing in-memory+Drizzle "one port, two adapters". Fixes the residency contradiction for media.

**Enablement meta-model**: Skill (atomic/versioned), Agent (goal+identity+capability_scope), Ritual (trigger+pipeline+surface), Tool (composition+surface). All compile to same Pipeline, same Graph.

**Tools — internalize + two modes + gated intake** (full: [tools](tools.md)): adopt an external repo → an **internal modified copy** (versioned, not a live dep), front+back flexible — contract only at the edges. Two run modes one codebase: **standalone/shareable-link** (cloud plane, no account) + **account-bound**. **Gated intake**: standalone/friend captures **quarantine** → enter the graph ONLY via a Pipeline proposal on user approval (capture ≠ commit; external origin = forced review, in-app trivial = auto-mode eligible). Captures use **local models by default** (two-plane gate); cloud inference = egress grant. Net-new = a **Tool manifest** at the edges (run_modes · model_bindings{plane_default:local} · capabilities · typed **output_contract** Person/Memory/Touchpoint/Signal/Initiative · intake_policy{quarantine, commit_via:pipeline_proposal}). Internalize = rebind 3 edges — model→ModelProvider · persistence→quarantine store · output→contract. Reuses pipeline/ledger/versions/contracts/gate/broker; zero new subsystem.

**Ritual execution = planner/executor split** (resolves "swarms vs workflows"; full: [rituals](rituals.md)):
- `Goal/Trigger → PLAN(agentic Planner — swarm-like, may be non-deterministic; PROPOSES a DAG, no action) → REVIEW GATE(approval level L0–L3) → EXECUTE(governed deterministic DAG thru Pipeline; each node Authority→Policy→Skill→Policy→Review→Ledger→Policy; injected Clock/Rng/IdGen=replayable; emits snapshot/node) → Output/Events → Variance Adjuster(off VETTED only)`.
- **Swarm plans, DAG runs.** Per-node **plan\|execute toggle** = that boundary in UI. Egress + agent-floor nodes pinned to `execute` (no live re-plan of irreversible act).
- **Capability broker** = the Authority resolver + ResourceType grid; agent→Pipeline→tool, NEVER agent→tool direct. On-the-fly tools (OpenAPI/doc ingest) → a capability *definition* that must be registered + permissioned (+plane grant if egress) before any run; doc-fetch = cloud-plane sourcing.
- **Self-heal data contracts**: typed JSON-Schema contract per node boundary; drift → a *proposed* remap thru Pipeline (governed, versioned), never silent. Code nodes minimized — typed expr (JMESPath/Jexl) default; raw JS only in external-container isolated-vm, no network (plane gate).
- **Approval levels**: L0 auto-mode · L1 act+notify · L2 propose→approve · **L3 dual/quorum** (egress/agent-floor force ≥L2).
- **Execution snapshot** (replay): ledger/trace += goal · memory_used[] · prompt · tool_inputs · tool_outputs · policy_state · model_version.
- **Versioning**: agents/skills/rituals/policies = immutable versions, diffable, rollbackable (change-mgmt).
- **Memory classification** (deferred Memory table): public/workspace/team/private/restricted; agent reads authority-scoped (notes yes, comp no).
- **Data-masking**: PII/private-tier strings redacted/hashed at the ledger-write + visible-log boundary. DEFER tail: air-gap Docker/Helm · SIEM JSON export · AES-256 cred vault+KMS.

**Agent auto-mode** (user-authorized auto-accept): effective-auto = workspace allowlist ∩ per-agent allowlist (token grammar). An authorized agent action in effective-auto + not caught by `require_approval` → auto-commits (`userDecision='auto'`); else `pending_review`. NEVER auto: agent-floor resources, `external:send`, any egress. Default empty ⇒ agents never auto-commit.

**Invariants**: deny-default; all mutation via Pipeline; ledger/timeline/events append-only; no hard delete (archived_at); every Signal carries action; Mirror pure; AI sees filtered context; no naked scores; veto tunes params not code; vocabulary fixed; **agents draft → humans approve, EXCEPT actions in the user-set auto-mode allowlist** (bounded by agent-floor + require_approval).

**Implemented (Track B, `platform/` monorepo)**: Pipeline + Authority resolver + Policy engine + RitualExecutor seam live in `packages/core` (zero deps, 16/16 conformance tests). Formula `(role ∩ scope) ∪ ephemeral − deny` + non-removable agent-floor DENY enforced. Determinism via injected Clock/Rng/IdGen (replayable ULIDs). `packages/db` = Drizzle mirror of SCHEMA.sql + `DrizzleLedgerStore`. `apps/api` = Fastify+tRPC (`action.propose`/`decide`, `ritual.run`), zod = the validate chokepoint. In-memory adapters → boots with zero infra; Drizzle binds the same ports. **Prototype now routes Signal→propose / Approvals→decide THROUGH the pipeline** (`data/api.ts`, default-off via `VITE_API_URL`, falls back to direct-Supabase). Live-DB conformance run against real PG17 caught 2 mirror-drift bugs (ULID→uuid `UuidGen`; `capability_scope.resources` key); 35/35 core tests. **Gate = built; local store = built** — pglite `createLocalDb` (same ports, conformance-tested). **Social integrations (X/IG/FB/LinkedIn)**: `SocialProvider` framework + `dummy_` fixture seam + governed read (source→local quarantine→propose Touchpoint) / write (draft→approve→publish egress) + user-editable scopes (tRPC `integration` router, agent-floor guard refuses standing `external:send`). 42/42 tests. UI panel + live REST clients = next.
