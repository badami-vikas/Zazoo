---
title: Initiatives as a Taskade-alternative — research, interrogation, and the call
type: raw
doc_kind: research
status: active
companions: []
related_wiki: ../wiki/initiatives.md
updated: 2026-06-22
tags: [initiatives, taskade, research]
---
# Initiatives as a Taskade-alternative — research, interrogation, and the call

**Date:** 2026-06-02. **Method:** 21-agent research workflow — 3 codebase-grounding + 7 web-research (Taskade, Affine/BlockSuite, AppFlowy, Yjs/CRDT, Tiptap/Lexical/xyflow, Mem0/Zep/LangMem, polymorphic-tree/event-sourcing) + 10 adversarial claim verdicts + synthesis. ~1.24M subagent tokens.

This is the depth source. Caveman summary → [../wiki/initiatives.md](../wiki/initiatives.md). Locked call → [../wiki/decisions.md](../wiki/decisions.md).

## The unbiased call

**Build the THIN slice of Taskade, not the platform.** The one genuinely transferable idea is *"one canonical hierarchy, many view renderers."* Bridge **already owns the hierarchy** — the relational **Touchpoint tree** (`parent_touchpoint_id, sort_order, depth, alignment_score`), annotated in `../wiki/schema.md` literally as "= Taskade tree." An **Initiative is the goal node that OWNS a Touchpoint hierarchy**; it is not itself the tree.

So the real work is:
1. Render **List / Board / Table / Calendar / MindMap** as **stateless read-time projections** over that existing tree (never separately stored trees).
2. Wire the Initiative schema gaps (**goal / timeline / boundaries / visibility / owner**).
3. Fix the ritual-creation UX divergence.
4. Make **agent goal→Touchpoint decomposition flow through the Universal Action Pipeline as draft-then-approve proposals**.

**Net: ~30% of the dump affirms choices already locked; ~70% pushes an architecture that conflicts with Bridge's identity.**

## Interrogation — what the dump got wrong / oversold / conflicting

- **"AI agents as first-class CRDT citizens autonomously editing live docs" — FALSE for Bridge.** CRDT merge = automatic acceptance into live state with no draft/review/veto gate. It structurally bypasses Request→Authority→Policy→User Review→Ledger and violates the non-removable agent-floor DENY. Agents emit DRAFT proposals; humans approve|veto|edit; nothing live-merges.
- **"Bridge NEEDS CRDTs + Hocuspocus" — overstated.** Bridge is single-principal + private-default; there is no concurrent multi-writer-on-same-doc problem CRDTs exist to solve. Team co-edit of a Touchpoint tree is cheaply served by Supabase Realtime + server-authoritative ordering + optimistic UI. Hocuspocus = a stateful WS fleet + Redis + tombstone GC for near-zero benefit.
- **CRDT collides with the E2EE relationship tier (Phase 6).** A server-side Yjs relay must see plaintext to merge/compact; encrypted-CRDT sync is an open research problem. Private-tier Initiative content cannot flow through a Bridge-hosted Yjs server.
- **"Build Initiatives as ONE JSON node tree" — wrong twice.** (a) the recursion lives on **Touchpoints**, not Initiatives; (b) a JSON blob cannot carry per-node RLS, per-node authority, or per-node audit, and bypasses the pipeline. Keep the relational adjacency-list tree; render many views over it.
- **"Universal Entity table (id/type/title/content/metadata)" — FALSE.** Erases the brand vocabulary and dissolves typed per-type RLS + deny-default authority (warmthScore, recommendedAction NOT NULL, capabilityScope can't be type-checked indexable columns in a jsonb blob). Bridge already has the right bounded polymorphism via `node_types(plane)` + the `edges` fabric.
- **"Use Neo4j / a graph DB" — misleading.** The graph insight is right; the prescription is wrong. Neo4j has no row-level multi-tenant security → abandons the Postgres RLS deny-default spine. Bridge already models the graph as one in-Postgres `edges` fabric.
- **"Use Temporal as an Execution Router for one-click micro-automations" — anti-governance.** Temporal is DEFERRED behind the RitualExecutor seam (Hatchet is today's engine); "one-click fire-and-forget" violates draft-then-approve. User-triggered packaged Rituals run through the Pipeline + RitualExecutor.
- **"Agents continuously learn from the event stream" — conflicts.** Bridge's only sanctioned loop is the Variance Adjuster tuning `policy_params` off VETTED human decisions, never online updates off a raw event firehose, never across the consent/local gate.
- **"Build our own memory service" — mostly true but mis-framed.** Bridge has ALREADY built ~90% (edges + embeddings(768) + append-only events/ledger). The decision is "don't bolt Mem0/Zep/LangMem on as a runtime dependency"; borrow their extraction/dedup/temporal PATTERNS. "Thin memory service" undersells the hard parts (extraction, reconciliation, bi-temporal validity).
- **"Make Approvals a pinned tool instead of default nav" — REJECTED AS STATED.** Approvals is the mandatory chokepoint + the moat; `../wiki/design.md` locks it default-visible with a pending badge. Demoting it weakens the persistent "N pending" trust signal. **Keep it default-nav AND additionally pinnable** via the existing `usePinnedTools` mechanism.
- **"Workspace DNA / strict-JSON frontier-LLM decomposer" (Taskade) — marketing, not a spec.** Taskade publishes no generation schema or model detail. Treat as positioning; design Bridge's own governed generation.
- **"BlockSuite/AFFiNE/AppFlowy give multi-view for free" — true but unusable here.** BlockSuite = pre-1.0 Lit web-components (React friction), MPL-2.0. AppFlowy = AGPL-3 + Rust/WASM (copyleft blocker for a closed product). Borrow the *pattern*, not the stack.

## How the GOOD ideas map onto Bridge (align, don't import)

- **Vocabulary:** the unit is **Touchpoint** (work node), **Ritual** (scheduled/event execution), **Initiative** (goal node owning the hierarchy). View names = List/Board/Table/Calendar/Map *renderers*, never new entities. Never "task block", "live doc", "card", "autonomous editor".
- **Tree model:** keep the relational adjacency-list Touchpoint tree. Views are stateless projections (GROUP BY status / ORDER BY sort key / filter).
- **Governance gate:** decomposition is the Agent+Skill step INSIDE the pipeline, halts at `pending_review`, human approves before any Touchpoint commits. A "plan-proposal review", not a live write.
- **Schema v2:** add `visibility(private|team|workspace)` + `owner` to `initiatives` and `touchpoints` (currently absent) so they inherit two-tier residency + RLS.
- **Edges/plane purity:** Initiatives/Touchpoints = Operational plane; REFERENCE Mirror Persons/Communities only via whitelisted cross-plane edges. Enforce the whitelist in the write-path (today only a comment).
- **Retrieval:** fuse graph(edges) + vector(embeddings 768) + relational(pg_trgm), authority-scoped per hop under RLS — never a privileged full-graph index (respects agent-floor "no full-graph read"). This claim is the dump's strongest — verdict **true / adopt**.
- **Memory:** a typed `memories` table (polymorphic edges + embeddings + RLS, visibility tiers); writes flow through the pipeline — not ungoverned auto-extraction.
- **Event/timeline:** keep plane separation (ledger=audit, timeline_entries=continuity, events=propagation, signals=read-only derived). Don't flatten into one generic event store.
- **Realtime:** Supabase Realtime for presence/notifications, NOT CRDT documents. Ledger stays authoritative; edits are proposals.

## Phased plan

**Phase 0 — UX consistency + schema gaps (ship first, low-risk).**
- Promote `goal` from the WorkPage creation modal into the Initiative store (collected but not persisted today).
- Add `timeline{startDate,targetDate}` + `boundaries(string[])` + `visibility` + `owner` to initiatives/touchpoints; wire Overview + a new Boundaries section.
- Resolve ritual divergence: remove the dead "New Ritual" button in `ToolsPage.tsx`; keep `RitualsPage` "+New Ritual" as the single factory; add an "Add Ritual" affordance to InitiativeDetail Touchpoints header → `/rituals/new?initiative={id}`.
- Inline add-objective / add-touchpoint in InitiativeDetail.
- Reuses: existing `initiatives.ts`, InitiativeDetail Overview, RitualsPage flow, touchpoints adjacency-list. Avoids: new editor lib, view renderers, agent gen, realtime.

**Phase 1 — Many views over the one Touchpoint tree.**
- Canonical recursive-CTE tree query, index on `parent_touchpoint_id`, cycle/depth guard.
- Switch `sort_order` to fractional/LexoRank for O(1) drag-reorder (dnd-kit already in stack).
- List/Outline · Board(group-by status/owner) · Table(typed cols) · Calendar(by date) as stateless view-configs. MindMap later via `@xyflow/react` (MIT).
- Avoids: BlockSuite/AFFiNE/AppFlowy, CRDT, ltree/closure (only as a read cache if a profiler proves CTE hot).

**Phase 2 — Governed goal→Touchpoint decomposition.**
- Intent-parse-before-decompose stage as a Skill (borrow Taskade's documented order).
- Decomposition = Agent+Skill step in the pipeline → draft Touchpoint subtree in `pending_review`.
- Render proposal in Approvals / inline review with approve|veto|edit; only approved nodes commit + append to ledger.
- `retrieveProjectContext` RAG tool over the fused authority-scoped retriever.
- Reuses: `packages/core` pipeline + authority + ledger, ModelProvider seam, embeddings+pg_trgm. Avoids: autonomous/auto-apply gen, live editing.

**Phase 3 — Memory entity + events→signals derivation (defer).**
- Typed `memories` table (edges + embeddings + RLS, visibility tiers); writes through the pipeline.
- Borrow Graphiti bi-temporal + Mem0 extract-then-reconcile PATTERNS; extraction LLM behind ModelProvider seam for the local tier.
- events→signals rules (every Initiative signal carries a recommended action: a proposed Touchpoint or Ritual trigger).
- Enforce cross-plane edge whitelist in the write-path.
- Avoids: Mem0/Zep/LangMem runtime dep, E2EE-blocking external processor, continuous online learning.

## Quick UI fixes (the concrete asks)

1. **Ritual consistency** — remove dead "New Ritual" in `ToolsPage.tsx:54-56`; keep RitualsPage as single factory; add "Add Ritual" to InitiativeDetail Touchpoints header (parallel to "Add task" ~line 189) → `/rituals/new?initiative={id}`.
2. **Goal in schema** — creation-modal `goal` (`WorkPage.tsx` ~540) collected but not persisted; promote into store + surface at top of Overview (not buried in description).
3. **Inline objectives** — keep the Target-icon add/edit/delete; ALSO allow adding objectives/touchpoints inline from the tree view.
4. **Approvals** — keep default + badge-bearing nav (it's the moat) AND register it as a Tool in `data/tools.ts` so it's pinnable via `usePinnedTools`. Do NOT remove from default nav.
5. **Timeline + Boundaries** — wire `Timeline{startDate,targetDate}` to replace the "Gantt coming soon" placeholder; add a first-class Boundaries section (what the Initiative explicitly will NOT do).

## Reject / defer (with why)

- REJECT: CRDT/Yjs/Automerge as core · autonomous live-editing agents · Hocuspocus fleet · Universal Entity table · Neo4j · Mem0/Zep/LangMem runtime dep · "agents continuously learn from event stream" · demoting Approvals from default nav.
- DEFER: Temporal (stays behind RitualExecutor; Hatchet today) · BlockSuite/AFFiNE/AppFlowy adoption (pre-1.0 / copyleft) · ltree/closure tables (adjacency+CTE fits; cache only if hot) · full event sourcing (current-state CRUD + append-only sidecar already suffices).

## Open questions (need the user)

1. **Ritual scope** — GLOBAL (reference an Initiative) or SCOPED (one per Initiative)? UI implies global; lock before building "Add Ritual".
2. **Touchpoint vs Ritual semantics** — Touchpoint = work node (Taskade leaf), Ritual = executable automation? Or do they overlap? Need the mapping before view renderers + decomposition.
3. **Data-tier split for Initiatives** — goal/timeline/boundaries canonical (cloud) while objectives/brief/memories local (private tier)? Affects what the decomposer reads + what crosses the gate.
4. **v1 views** — List + Board clearly worth it; Calendar/Table/MindMap incremental. Is MindMap (xyflow) in scope at all?
5. **Team co-edit reality** — how often do two analysts edit the same tree concurrently? If rare, optimistic-locking suffices, skip presence in v1.
6. **Memory entity timing** — introduce typed Memory table now or Phase 3? Plaintext+RLS until E2EE Phase 6 — confirm ops/legal for the pilot window.
7. **Decomposition model** — which model, and does it run in-tenant (local tier) via ModelProvider for private Initiatives?
