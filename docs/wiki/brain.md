# Brain/Engine — cognitive core design

full: [../raw/brain-engine-architecture-2026-07.md](../raw/brain-engine-architecture-2026-07.md) · 2026-07-09.
Related: [architecture](architecture.md), [clients](clients.md), [desktop-companion](desktop-companion.md), [undefined-elements](undefined-elements.md), [day1-integrations](day1-integrations.md).

**Brain ≠ new monolith.** Brain = 6 engines composed over EXISTING seams (graph · event bus ·
Pipeline · Sensor SPI · ModelProvider router · manifests · Mem0-port Memory). Every Brain output
= Signal or governed proposal. No side-channel, ever.

**Coverage audit verdict**: Bridge already own governance chassis + seams. Missing = 6 engines
(raw doc §0 has full yaml audit):

1. **Compression Cascade** (OS/visual ingest): salience filter (T0) → event compaction →
   ActivitySpans → AX-first, pixels-last → pHash frame dedup → T2 on-device VLM captions →
   hourly/daily/weekly digests → retention aging (`archived_at`, governed compaction ritual).
   Prompts NEVER see raw spans/frames — digest tier only, drill-down via tool. Blink tell +
   CaptureLedger unchanged: compress content, never accountability.
2. **Sync Scheduler + Comms-Graph Builder** (connectors): per-connector cursors/deltas/backoff,
   adaptive cadence (pure fn). Entity resolution reuse Recon match tiers (never auto-merge
   ambiguous). Fetch = cloud-plane sourcing thru gate; dual-write per residency rule.
3. **Routing Policy Engine** (over `createModelRouter`): strict order plane → modality →
   capability floor → score(quality/cost/latency, weights in `policy_params`) → budget.
   Local T1 task classifier + keyword fallback (chief-of-staff pattern). v1 static matrix,
   v2 ε-greedy bandit INSIDE allowed set only (bandit never override plane/floor/budget).
   Approval/veto/edit = free outcome labels → `routing_metrics`. Model names = config not code.
4. **MCP Capability Engine**: MCP server = just another capability origin, same governance.
   New `@bridge/mcp-host` (stdio+HTTP, introspect → DERIVED manifest, human-reviewed —
   self-description untrusted). Loop: Gap Detector (Learning Agent, DomainProfile drift +
   task failures) → registry search (Commons FIRST → official MCP registry → GitHub) →
   static vet (license gate, pinned checksum) → sandbox trial (no creds, no egress) →
   governed adoption ≥L2, trifecta ⇒ External. NOTHING auto-installs — autonomy = find+vet.
   Fills gap #7: creds NEVER reach server; broker proxy injects at egress edge, per-capability
   scope-subset ephemeral grants, RFC 8693 exchange for enterprise IdP, every use ledgered.
5. **Memory hierarchy + Domain Profiler + Buddy**: 4 tiers (working=assembled per turn ·
   episodic=timeline+episode rollups · semantic=thin `memories` table per gap-#3 verdict ·
   procedural=existing registries). Dream cycle NOW CONCRETE: nightly L1 local-only ritual —
   cluster → extract → reconcile (corroborate↑ / supersede-never-delete / candidate) →
   promote on threshold → decay = retrieval-rank not deletion. PromptAssembler layering
   (fills gap #6): L0 persona → L1 governance → L2 task ≤20 tools → L3 semantic top-k hybrid →
   L4 digests → L5 domain slice; L0–L2 never truncate; `memory_used[]` into snapshot.
   **UserDomainProfile** = evidence-backed concept map (nodes w/ confidence + complexity_stage,
   edges, rhythms) — profession EMERGES from evidence, nothing hardcoded; diffs governed;
   local-plane only, NEVER Commons-minable. Buddy = Learning Agent curation: relevance ×
   novelty × actionability, budgeted N/week, every insight Signal carries action. Co-evolution:
   complexity_stage gates suggestion depth; stage+trust relax together, never independently.
6. **Automation Miner**: canonical token alphabet `verb(app_class,object_type)` →
   PrefixSpan closed-sequence mining + periodicity — PURE ALGORITHM, zero model tokens
   (ladder-audit invariant). Score = support × regularity × duration × automatability − risk.
   Synthesis via existing ritual Planner, nodes = registered capabilities ONLY (unmappable
   step → capability_gap Signal, not screen-script hack). Adoption rides trust ladder,
   two-gate promotion (wrong-trigger fails gate 2 even w/ perfect output). Rejection remembered.

**Schemas** (raw §8): UserDomainProfile · episode rollup · routing_metrics · mcp_integration.

**Roadmap** (raw §9, maps onto P0–P3): Ph1 Ingest&Remember → Ph2 Route&Compress →
Ph3 Understand&Curate → Ph4 Expand (MCP) → Ph5 Automate&Co-evolve. Each = one hypothesis +
exit criterion; ports get conformance suites; thresholds get replayable fixture streams.

**Blockers/open**: embedding-dim pin (schema-v2 punch-list) blocks embed pass · runtime-taint
gap (security audit) = prerequisite for high-autonomy MCP · `episodes` table-vs-view = schema-v2
call · onboarding-profile→CoS prompt = build as PromptAssembler L0, not bespoke path.

**Execution plan**: [../raw/brain-engine-execution-plan-2026-07.md](../raw/brain-engine-execution-plan-2026-07.md)
(2026-07-09) — 25 steps, real repo paths, per-step test + done-when. Stage 0 unblockers FIRST
(0.1 embed-dim pin rec=768 nomic-embed · 0.2 `episodes` rollup table · 0.3 provenance/origin field).
Then Ph1–Ph5 steps. Critical path: 0.1→0.2→1.1→1.3→3.1→3.2→4.3→4.5→5.4. 5 parallel lanes
(sensors/connectors/routing/mcp/memory) — routing lane only 0.x-independent one. External deps:
desktop-companion AX provider (2.4) · agent-eval scoring reducer (5.5) · taint track (gates Ph4).
Sizing 3S/14M/8L ≈ 2 eng-months serial, ~5-6 wk laned. First 3 sessions: Stage 0 → 1.1+1.2 →
1.6 PromptAssembler (first user-visible win: CoS answers from memory).
