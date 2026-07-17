# TASK-009 — Actionable Second Brain graph: refreshed implementation handoff

Status: PLANNING REFRESH ONLY — no application code, schema, canon, or
`docs/TASKS.md` status/order changed in this pass. Read against authoritative
`origin/main` `212e65f`. Hard-blocked on TASK-008's RM4 slice (Relation
persistence/materialization), currently under final integration review
(`docs/BUGS.md` "OPEN 2026-07-17 — TASK-008 integration omitted the RM4
Relation persistence/materialization contract"). Supersedes the architecture in
this session's earlier plan (2026-07-16) wherever it conflicts with ADR-110 —
see §0.

## 0. What changed since the 2026-07-16 plan (read this first)

The prior plan proposed a **separate Second Brain surface**: its own
`SecondBrainPage`, its own `/second-brain` route/component, its own
`graph:traverse` authority scope, its own graph-viz library pick, wired
directly against a raw `edges` traversal query. **That architecture is now
superseded.** Since then:

- **ADR-108 → ADR-110 (2026-07-17, AP-036/AP-037 applied)**: Calendar and
  Graph are canon **View kinds** in one View Grammar
  (`docs/raw/brd-dataengine-views-2026-07.md`), not Modules/Tools/routes.
  ADR-108 first said Second Brain must stay a distinct surface from a Page's
  Graph view; **ADR-110 reverses that same day**: "Second Brain IS the Graph
  view at `scope: full`... one implementation." Graph view gains a
  **scope selector** (`single_database` / `multi_database` / `full`).
- **TASK-009 converged into TASK-014** (`docs/TASKS.md`, AP-037 applied):
  TASK-009's Outcome now reads "Building the real Graph renderer with
  scope-selector support (TASK-014) delivers this simultaneously; no separate
  build." TASK-009 keeps its own ID/prototype-test/evidence trail (so its
  exit criteria stay falsifiable and separately reportable) but has **no
  independent implementation task** — the work is 100% inside TASK-014's Graph
  renderer deliverable.
- **This makes my prior plan's proposed component/route/authority-scope
  architecture wrong**, not just outdated: there is no `SecondBrainPage`,
  no `/second-brain` route class, and no bespoke `graph:traverse` scope to
  design in isolation — the one Graph view component, the one eligibility
  rule, and (per §4 below) one authority contract cover single-Page graphs
  and Second Brain identically. Sections below replace the prior plan's data/
  authority/UI contracts with the current, correct ones.
- **TASK-008 itself progressed materially** since the prior plan: RM0–RM3
  (Relationship nav, Signal→participant/source-Event reads, governed Signal
  Actions, Helpdesk fold-in) are integrated on `main`; `graph-store.ts` now has
  a real, working bidirectional `edges` traversal for Signal/Event participant
  resolution (`getSignalDetail`, `platform/packages/db/src/graph-store.ts`
  lines ~402–456) — the first genuine consumer of the `edges` table. What
  remains open and blocking is **RM4** specifically: Relation schema
  evidence/provenance/visibility/validity/owner fields, owning-Module node
  types, owner-scoped uniqueness, `materializeSignalEvidence`/`upsertRelation`/
  bounded Relation reads, and approved-proposal materialization/reconciliation
  — implemented on the active, reviewed RM4 branch
  `manishsbhoopalam8498-implement-rm4-relations` (currently `488d1e4`, plus one
  final ledger-integrity fix in progress), as migration
  `0015_task008_relation_contract.sql`, pending central integration onto
  `main`.

## 1. Exact post-RM4 data contract

`edges` (`platform/packages/db/src/schema.ts:266`, unchanged on `main` as of
`212e65f`) remains the Relation table: `id, workspaceId, srcType, srcId,
dstType, dstId, edgeType, properties jsonb, createdAt`, indexed both
directions (`edges_src_idx`, `edges_dst_idx`), RLS-enabled
(`migrations/0008_rls_as_code.sql`). **RM4 — active, reviewed branch
`manishsbhoopalam8498-implement-rm4-relations`, currently `488d1e4` plus one
final ledger-integrity fix in progress, migration
`0015_task008_relation_contract.sql`, pending central integration onto
`main`** — adds exactly what Second Brain/Graph-view needs and must not
re-invent:

- Relation **evidence/provenance/visibility/validity/owner fields** on the
  `edges` table, confirmed by reading the active branch's `schema.ts`:
  `evidenceRefs` (jsonb array of typed evidence refs), `confidence` (numeric),
  `observedAt`/`validFrom`/`validTo` (timestamps), `userConfirmed` (boolean),
  `visibility`, `source`, `sourceModule` (text), `ownerUserId` (FK to
  `users`), and `decisionLedgerId`/`decisionSequence`/`decisionAt` (the
  approved-proposal↔ledger reconciliation fields). Named here for planning
  accuracy, but treat as **pending final integration** — the branch carries
  one more in-progress ledger-integrity fix, and the merged shape on `main`
  is the eventual source of truth, not this branch snapshot.
- **Owning-Module node types** — RM4 introduces the mapping from a
  `srcType`/`dstType` string to the Module that owns that Record type. This
  is precisely the "node-type → owning-Module registry" gap the prior plan
  flagged as missing; **RM4 is where it lands**, not a separate TASK-009
  invention. Graph view's "click node → Record Detail at the owning Module"
  and Second Brain's "every datum remains owned by its source Module" both
  consume this directly.
- **Owner-scoped uniqueness** on Relations (consistent with `people`/
  `communities` already being per-`(workspace, userId)`-owned rows, per
  `graph-store.ts`'s `viewerUserId`-scoped `getPerson`/`getCommunity` — see
  §2).
- **`upsertRelation`** — the governed write path a Record Detail's Relations
  section uses to create/edit a Relation (Graph view is explicitly
  **read-only rendering**, per the BRD: "creating/editing a Relation happens
  through the owning Record Detail's Relations section... never by
  drag-drawing an edge on the canvas"). Second Brain never gets its own write
  path; it reads what `upsertRelation` wrote.
- **`materializeSignalEvidence`** and **bounded Relation reads** — the query
  primitives Graph view's renderer calls for both single-Database and
  cross-Database (`multi_database`/`full`) traversal. "Bounded" here is the
  same concern the prior plan raised (depth/result ceiling) — RM4 is where
  that ceiling's mechanism is decided; this handoff does not re-litigate it,
  it names the dependency.
- **Approved-proposal materialization/reconciliation** — Relations created via
  a governed proposal (e.g., DealPilot's Deal↔Source, per ADR-109) must
  reconcile into `edges` the same way Signal participants already do, so
  Graph view's cross-Module scope has real DealPilot/JobPilot/Helpdesk nodes
  to traverse, not only Relationship-Domain ones.

**What Second Brain/TASK-014 must NOT do:** propose a second Relation-evidence
schema, a second write path, or a second node-type registry. Every one of
those is RM4's deliverable; TASK-014's Graph renderer is a pure consumer.

## 2. Permission pruning and inaccessible-node non-render

Confirmed unchanged and load-bearing:

- **RLS** is enabled tenant-wide (`app_private.same_workspace(workspace_id)`)
  on `edges`, `events`, `files`, `people`, `communities`, `signals`, etc.
  (`migrations/0008_rls_as_code.sql`). No Second Brain/Graph query may use a
  service-role/bypass client — same Drizzle client, same policies as every
  other read.
- **Relationship-Domain nouns carry a second, narrower privacy tier**:
  `people`/`communities` rows are scoped `(workspaceId, userId)`, and
  `graph-store.ts`'s existing reads (`getPerson`, `getCommunity`,
  `getSignalDetail`) already filter on `viewerUserId`, not just workspace
  membership (`graph-store.ts:222`, `:276`, `:295`, `:345`). **Any Graph-view
  traversal that touches a Person/Community node must reuse this exact
  per-viewer filter**, not just RLS — a workspace-mate's Person/Community rows
  are invisible to a viewer who doesn't own them, independent of RLS. This is
  a concrete, code-level pruning rule the prior plan didn't have (RM0's
  `viewerUserId` pattern didn't exist in code yet when it was written).
- **`network_graph:full` stays exactly what it is**: a `ResourceType`
  (`platform/packages/core/src/types.ts:40`) that is a **non-removable
  agent-floor DENY** for `read`
  (`platform/packages/core/src/agent-floor.ts:47`,
  `authority.ts:47`, tested at `agent-floor.test.ts:61`). **Nothing in the
  Graph-view-as-Second-Brain convergence changes this.** Graph view/Second
  Brain reads must not be implemented as a grant of `network_graph:full` —
  that resourceType's entire purpose is "agents may never bulk-read the full
  graph," and Second Brain's `scope:full` read is a **permission-filtered
  projection**, not a raw table dump, so it needs its own authority
  treatment (§ below), reusing the *pattern* `network_graph:full` establishes
  (deny-by-default, no override) without touching its wording or test.
- **Proposed authority primitive (still open, now scoped correctly)**: a
  bounded resourceType for Graph-view reads — e.g. `relation:read` scoped per
  node's own resourceType check as traversal expands, rather than one
  all-or-nothing scope. This is now explicitly **RM4/TASK-014 territory**
  (RM6's own dependency line already named "whole-network bounded-query
  authorization" as unmet) — not a TASK-009-specific invention as the prior
  plan framed it. **Flag for the RM4 merge reviewer and TASK-014 to settle
  jointly**; this handoff does not resolve it, to avoid diverging from
  whatever RM4 actually ships.
- **Non-render rule unchanged and still the load-bearing invariant**: a node
  the resolved authority denies (RLS, per-viewer privacy tier, or the
  bounded-read scope above) is **absent from the traversal response
  entirely** — never present-but-greyed-out, never client-side hidden after
  fetch. Applies identically at `single_database`, `multi_database`, and
  `full` scope; `full` scope simply has more candidate nodes to prune.
- **Plane pruning unchanged**: `planeGate` (`authority.ts`) still applies —
  a Cloud-plane actor's traversal still stops at any Local-only node exactly
  as it does for every other read today. No Graph-view-specific carve-out.

## 3. Source-Module ownership

- Confirmed by code audit (this BRD, §2): **no separate relationship-graph
  table exists or is proposed** — `edges` is the one Relation store for every
  Module's typed Relations, and RM4's owning-Module node-type mapping (§1) is
  what resolves a rendered node back to "click here to open its owning
  Module's Record Detail."
- **Second Brain's "every datum remains owned by its source Module"**
  (glossary) is now literally: Graph view never stores or duplicates a node's
  data — it queries the owning Database's row live, at whatever scope, and
  renders it. There is no Second-Brain-local cache/projection to keep in
  sync.
- Legacy/global Relationship-Domain nouns (`person`, `community`, `event`,
  `file`, `agent`) that aren't any one installed Module's private data still
  need the fallback-bucket treatment the prior plan proposed — RM4's registry
  should include them as "Relationship Domain" or "Platform" owners, not
  attribute them to whichever Module happens to reference them first.

## 4. Scope selector semantics (single_database / multi_database / full)

Per the BRD (§3) and ADR-110, exact contract:

- **`single_database`** (default): the Page's own rows as nodes, its typed
  Relations (via `edges`, filtered to that Database's node types on both
  ends) as edges. Eligibility: the Page's Database has ≥1 relation-kind
  column (`eligibility.ts`'s existing `hasRelationColumn` check — unchanged,
  already correct, gates the "network" kind, soon renamed "graph").
- **`multi_database`**: user explicitly selects additional Databases; their
  rows become nodes too; Relations whose `srcType`/`dstType` cross the
  selected Database set become edges. This is genuinely new query surface
  (today's `graph-store.ts` queries are anchored to one entity at a time —
  Signal, Person, Community — not an arbitrary user-selected Database set).
- **`full`** = **Second Brain**: all permitted Databases across every
  installed Module, filtered by permission (§2). Same renderer, same
  eligibility rule (a Page needs a relation column to unlock Graph view at
  all; the **Second Brain nav entry is a preset that skips the
  per-Page-eligibility gate entirely**, since it isn't scoped to any one
  Page — it opens Graph view directly at `scope:full`).
- **One component, one query interface, parameterized by scope** — not three
  code paths. The scope parameter determines the candidate Database/node-type
  set fed into the same bounded-traversal + permission-prune pipeline (§2).
  Progressive load/pagination (not a hard depth ceiling invented ad hoc) is
  the BRD's stated answer to `full`-scope performance (§4 of the BRD:
  "Performance concerns at full scope... solved by progressive load,
  pagination, and a sensible default filter — not by an architectural
  split").
- **Second Brain nav entry**: stays a named preset/shortcut in the left nav
  below the Module list (unchanged from prior plan's placement analysis —
  `Layout.tsx`'s `installedModules.map(...)` block, before the "+New"
  button) that opens Graph view pre-configured to `scope:full`. **Not a
  separate route class, not a separate component** — confirmed explicitly by
  the BRD (§4: "not a separate route class, and not a separate surface").

## 5. Provenance / backlinks

Unchanged in substance from the prior plan, now grounded in the real RM4
fields instead of a proposed schema:

- Every rendered edge shows its `edgeType` (the BRD's edge label, e.g.
  "introduced by," "reports to") plus whatever evidence/provenance/
  confidence/validity fields RM4 lands (§1) — clicking an edge opens
  "Relation detail/evidence" per the BRD (§3 graph kind: "click edge → Relation
  detail/evidence").
- **Backlinks**: both traversal directions already have covering indexes
  (`edges_src_idx`, `edges_dst_idx`) — "what points here" and "what this
  points to" from any node is a query-shape decision using existing indexes,
  not a schema change.
- **Node expansion**: clicking an already-rendered node re-runs bounded
  traversal from that node as the new root, within whatever progressive-load
  ceiling the renderer uses (§4) — not an unbounded "load everything."

## 6. Governed Action

- Confirmed by the BRD (§3, §5): **Graph view is read-only rendering.**
  Node click → Record Detail (that Module's real route); edge click →
  Relation detail/evidence. **Creating or editing a Relation is never done on
  the graph canvas** — it happens through the owning Record Detail's
  Relations section, which is an ordinary governed write (`upsertRelation`,
  §1), going through the same `action.propose`/pipeline path every other
  write uses.
- This resolves an open question in the prior plan (which proposed a generic
  "every node/edge opens... a governed Action" without specifying which
  actions) — the BRD is explicit that Graph view itself performs no
  mutations; the "governed Action" the TASK-009 prototype test names is
  reached by **navigating off the graph** to the Record Detail, not
  performed in-canvas.

## 7. Accessible list fallback

- Same query, same permission pruning, rendered as the Page's existing
  **table view** — the BRD does not introduce a bespoke "list fallback"
  component; `GraphView.tsx`'s current placeholder already does exactly this
  (renders `TableView` with a banner) for the "graph rendering isn't built
  yet" case, and the real implementation keeps table as the standing
  accessible/keyboard-navigable alternative, reusing the shared column-menu/
  toolbar/ARIA conventions every other table already has (§5a-equivalent
  contract) — not a new, separately-maintained list component as the prior
  plan proposed.
- Virtualization: still an open gap (no `react-window`/`@tanstack/react-virtual`
  in the repo as of `212e65f`) — TASK-014's Graph renderer inherits this as a
  shared concern with `TableView`'s own virtualization needs, not a
  Second-Brain-specific pick. Not resolved in this pass; flagged for TASK-014
  implementation.

## 8. Relationship Page Graph vs full-scope Second Brain: the distinction is gone

**Correcting the prior plan directly**: that plan treated "a Relationship
Page's own graph" and "Second Brain" as two different things needing two
different authority scopes, two different components, and two different nav
paths. **ADR-110 explicitly reverses this** (superseding ADR-108's "never
merge" stance, itself only hours old): they are **the same View kind at
different scope values**. The worked example in the BRD (§7) states it
plainly: the Relationship People Page's Graph view is eligible at
`single_database` scope by default, and "the user may extend to multi-DB...
or to full/Second Brain scope" — same canvas, same component, wider data.
**There is nothing left to design as "the distinction"** — the only
remaining design surface is the scope selector itself (§4) and the
permission-pruning that must scale correctly from one Database's nodes to
every permitted Database's nodes (§2).

## 9. Test / exit matrix

TASK-009's prototype test (`docs/TASKS.md`, current text): "From the Second
Brain nav entry (Graph view, `scope:full`), traverse a real cross-Module
Record/Relation/Event/File connection, filter by Relation type, inspect
provenance/source-module, navigate to the owning Record Detail, and perform a
governed Action; inaccessible nodes never render (permission-filtered); the
same node/edge canvas works at `scope:single-database` on a Page with a
relation column — confirming one renderer at all scopes."

This is now **one exit matrix shared with TASK-014's Graph-renderer
deliverable**, not a separate one:

| Check | Scope(s) | Notes |
|---|---|---|
| Real node/edge rendering (not table-with-banner) | single/multi/full | Replaces `GraphView.tsx` placeholder |
| `network`→`graph` `ViewConfig["kind"]` rename | all | Code-symbol rename, glossary already says "graph" |
| Cross-Module traversal with real seeded Relations across ≥2 installed Modules | multi/full | Cannot certify on fixtures (AP-002) — needs RM4 Relations materialized for DealPilot/JobPilot/Helpdesk data, not only Relationship-Domain data |
| Filter by Relation type | all | New filter UI over `edgeType` |
| Provenance/evidence + source-Module click-through | all | Depends on RM4 fields (§1) landing first |
| Inaccessible node never renders | all, esp. full | RLS + per-viewer privacy tier (§2) + Plane gate, all three, not just RLS |
| List-view fallback works, keyboard/ARIA parity | all | Reuses TableView, not a new component (§7) |
| Second Brain nav preset opens Graph view at `scope:full` | full | Nav placement per §4; no separate route |
| Regression: `network_graph:full` agent-floor DENY still holds | n/a | Must not be weakened by any new bounded-read scope (§2) — guard existing `agent-floor.test.ts:61` |
| Live desktop + 375px evidence | all | Per TASKS.md Completion standard — build-green alone is insufficient |

`docs/BUGS.md`'s "OPEN 2026-07-14 — USER REPORT: no actionable cross-Module
Second Brain graph" resolves only when this matrix passes for real — same
standing rule as before.

## 10. Expected overlap with TASK-014

Full overlap, by design (ADR-110, AP-037): TASK-014's Outcome/Prototype-test
already names every Graph-view deliverable this handoff describes (real
node/edge renderer, scope selector, `network`→`graph` rename, `tree` kind
addition, Calendar de-modularization — the last two are TASK-014 scope
unrelated to Second Brain specifically). **TASK-009 does not get a separate
implementation slice.** What TASK-009 retains, and why it still exists as a
distinct ID:

- Its own falsifiable prototype test focused specifically on the
  cross-Module/`scope:full` path (§9), so "Second Brain works" stays
  independently reportable even though the code lands as part of TASK-014.
- Its own evidence trail (`BUGS.md` 2026-07-14 entry, this handoff) so the
  original user-reported gap has a closeable record distinct from TASK-014's
  broader View Grammar rollout.
- Its own dependency line (`TASK-008; TASK-014`) — meaning even once TASK-014
  ships a real Graph renderer, TASK-009 cannot close until TASK-008's RM4
  Relations are materialized for enough cross-Module data to pass the
  `scope:full` prototype test with real (non-fixture) nodes.

**Practical sequencing implication**: whoever executes TASK-014's Graph
renderer should build the scope selector and the RM4-dependent traversal
query as one deliverable, then TASK-009 is closed by pointing at that same
implementation plus RM4-sourced cross-Module evidence — not scheduled as
separate engineering work afterward.

## 11. What can still be prepared independently (updated)

Given the convergence, "independent TASK-009 prep" mostly dissolves into
"TASK-014 prep." What remains genuinely separable and low-risk to start
before RM4/TASK-014 land:

1. AP-008 license-limited research on a graph-viz rendering approach for the
   real `GraphView.tsx` (still needed regardless of scope — single-Database
   graphs need real rendering too, independent of Second Brain).
2. Drafting the Relation-type filter UI/interaction design (works the same
   at any scope, doesn't need RM4's exact schema to sketch).
3. Reviewing the active RM4 branch
   (`manishsbhoopalam8498-implement-rm4-relations`, currently `488d1e4` plus
   one final ledger-integrity fix in progress) before/at its central
   integration onto `main`, specifically for whether its owning-Module
   node-type registry and bounded-read shape match what Graph view's scope
   selector needs — flag mismatches early rather than after TASK-014 starts
   building against it.

Everything else — the traversal query, the scope selector, the renderer, the
authority contract for bounded/full-scope reads — is TASK-014 execution,
gated on RM4.

## 12. Remaining ambiguity to flag to the coordinator

- **The bounded-read authority primitive (§2)** is named as a dependency by
  both RM6 ("whole-network bounded-query authorization") and this handoff,
  but no ADR/AP has actually specified its shape yet (unlike the scope
  selector and Second Brain convergence, which ADR-110/AP-037 nailed down
  precisely). This is the single largest open design gap blocking a clean
  TASK-014 Graph-renderer implementation at `multi_database`/`full` scope —
  recommend it gets its own ADR at or before RM4's merge, not discovered
  mid-implementation.
- **RM4's evidence/provenance/validity/owner column names** are now confirmed
  by reading the active branch (§1: `evidenceRefs`, `confidence`,
  `observedAt`/`validFrom`/`validTo`, `userConfirmed`, `visibility`, `source`,
  `sourceModule`, `ownerUserId`, `decisionLedgerId`/`decisionSequence`/
  `decisionAt`) — no longer an unresolved guess. What remains open is only
  whether central integration changes this shape: the branch has one more
  ledger-integrity fix in progress, so confirm the final merged column set
  against `main` once RM4 lands rather than assuming this branch snapshot is
  final.
- **Virtualization for `full`-scope large node sets** (§7) has no chosen
  library or approach yet, shared with `TableView`'s own gap — worth deciding
  once, not twice, when TASK-014 starts.
- Everything else in this handoff is grounded directly in ADR-108/110,
  AP-036/037, the BRD, `docs/TASKS.md`'s current TASK-009/014 text, and
  code read at `origin/main` `212e65f` — no other open ambiguity identified.

No code, schema, canonical docs, or `docs/TASKS.md` status/order were changed
to produce this handoff.
