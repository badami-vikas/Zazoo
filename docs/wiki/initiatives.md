# Initiatives (wiki)

full: [../raw/initiatives-taskade-research.md](../raw/initiatives-taskade-research.md) · Initiative (display "Project") = an **ElementType**, not a separate primitive ([ontology](ontology.md)).

**Call: build THIN slice of Taskade, not platform.** ~30% of dump affirms locked choices; ~70% conflicts w/ Bridge identity.

**Core insight = "one hierarchy, many view renderers".** Bridge ALREADY owns hierarchy = **Touchpoint tree** (`parent_touchpoint_id, sort_order, depth, alignment_score`) — schema.md calls it "= Taskade tree". **Initiative = goal node that OWNS a Touchpoint hierarchy**, not the tree itself.

**Do:**
- List/Board/Table/Calendar/MindMap = stateless read-time PROJECTIONS over the ONE relational tree. Never stored per-view trees.
- Add Initiative schema gaps: `goal` (collected, not persisted today) · `timeline{start,target}` · `boundaries[]` · `visibility(private|team|workspace)` · `owner`.
- Agent goal→Touchpoint decomposition = Agent+Skill step INSIDE pipeline → draft subtree `pending_review` → human approve|veto|edit → commit+ledger. Plan-proposal review, NOT live write.
- Retrieval = graph(edges)+vector(768)+relational(pg_trgm), authority-scoped per hop. (dump's strongest claim, ADOPT.)
- Keep plane purity: Initiative/Touchpoint = Operational; reference Mirror via whitelisted cross-plane edges only. Enforce whitelist in write-path (today only comment).

**Reject** (conflict w/ governance + private-default + E2EE): CRDT/Yjs/Automerge core · autonomous live-editing agents · Hocuspocus · Universal-Entity table (kills typed RLS + vocab) · Neo4j (no row-level tenancy) · Mem0/Zep/LangMem as RUNTIME dep (borrow PATTERNS only) · "agents learn from raw event stream" (only Variance Adjuster off VETTED decisions) · **demoting Approvals from default nav**.

**Defer:** Temporal (behind RitualExecutor; Hatchet now) · BlockSuite/AFFiNE/AppFlowy (pre-1.0 / AGPL/MPL copyleft — borrow idea) · ltree/closure (adjacency+CTE fits; cache only if hot) · full event-sourcing (append-only sidecar already enough).

**Quick UI fixes:**
1. Ritual divergence: kill dead "New Ritual" in ToolsPage; RitualsPage = single factory; add "Add Ritual" to InitiativeDetail → `/rituals/new?initiative={id}`.
2. Goal → persist in store, surface top of Overview (not in description).
3. Inline add objective/touchpoint from tree view too.
4. Approvals: **pinned-only** (user's call, overrides research) — register as Tool → pin via `usePinnedTools`, REMOVE from default nav. Carry the pending-count badge ONTO the pinned tool so the trust signal survives.
5. Timeline + Boundaries = first-class sections (replace "Gantt coming soon").

**Phases:** P0 UX+schema gaps (ship first) → P1 many-views over tree (recursive CTE, LexoRank sort, dnd-kit, xyflow later) → P2 governed decomposition → P3 Memory entity + events→signals (defer).

**Sequencing:** AFTER the local-first gate priority track (see [decisions](decisions.md)).

**Resolved (2026-06-02):** Rituals = **GLOBAL** (can reference an Initiative). Approvals = **pinned-only** (badge moves to the pinned tool). Tier = **everything local**; internet-sourced facts dual-written cloud+local; local agents request, global agents source. **Touchpoint = the work node (= a to-do/task); Ritual = the automation** — vocab sweep kills "task"/"to-do"/"sub-task" (InitiativeDetail "Add task" → "Add Touchpoint"). **v1 views = List + Board** (Table/Calendar incremental; **MindMap deferred**, xyflow later). **No Hocuspocus/CRDT** (co-edit rare → Supabase Realtime + optimistic UI). **Memory table deferred** to P3. **Agent auto-mode** (Claude-Code-style auto-accept): workspace ∩ agent allowlist → trivial actions auto-commit; bounded by agent-floor + `require_approval` + never egress/send (see [decisions](decisions.md)).

**Still open (need user):** decomposition model (in-tenant via ModelProvider for private Initiatives?). Auto-mode composition (workspace ∩ agent = narrowest-wins) proposed — confirm.
