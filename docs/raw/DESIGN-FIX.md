# Bridge AI — Design-Fix Spec (v0)

> Turns the [DESIGN-AUDIT.md](./DESIGN-AUDIT.md) gaps into concrete UI work against the coded prototype `/Design Bridge AI Interface (Copy)/` (React+Vite+Tailwind+shadcn, 70 `.tsx`, 12 pages).
> Principle from the audit: **additive + vocab scrub, NOT a redesign.** The mirror/orbit shell stays; we add governance + consent surfaces and rename.
> Grounded in [SCHEMA.sql](./SCHEMA.sql) (v2) and [ARCHITECTURE.md](./ARCHITECTURE.md) (v1). Each fix names the tables it reads/writes so design and data stay coupled.
> Scope note: this is an **architecture/vocabulary** fix spec. The visual-quality pass (layout, hierarchy, color, the `Inspiration_v2*.pdf` set) is **still pending** — not covered here.

---

## 0. Work at a glance

| # | Fix | Priority | New routes/pages | Primary tables |
|---|---|---|---|---|
| F0 | Design-system alignment (tokens/type/color) | **P1** | — (styling layer) | — (see [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)) |
| F1 | Vocabulary scrub | **P1** | rename `WorkflowDetail`/`PlaybookDetail` → `RitualDetail` | (none — copy/identifiers) |
| F2 | Approvals / Review inbox | **P1** | `/approvals` + Intelligence widget | `ledger`, `policies`, `decision_traces` |
| F3 | Execution Ledger / Decision-Trace | **P1** | `/settings/governance/ledger` | `ledger`, `decision_traces`, `delegations` |
| F4 | Consent + Visibility | **P1** | Person-view panels + intro flow | `people`, `people_canonical`, `edges`(INTRODUCED) |
| F5 | Orbit honesty (rings + no naked scores) | **P2** | — (existing Orbit) | `people`, `signals` |

Sequencing: **F1 first** (cheap, unblocks copy everywhere), then F2+F3 together (share the `ledger`), then F4 (deepest — needs the two-tier Person view), F5 last.

---

## F1 — Vocabulary scrub (P1)

**Rule violated:** #1 brand rule — never Lead/Deal/Pipeline/Contact; canonical execution primitive is **Ritual** (Workflow + Playbook were **dropped**).
**Audit counts to drive to ~0 (user-facing):** Lead 21 · Contact 17 · Deal 13 · Pipeline 4 · Workflow 53 · Playbook 27.

### Rename map (noun usage)
| Found | → Replace with | Notes |
|---|---|---|
| Lead | Person / Relationship | "Person" for the entity; "Relationship" when it's the *tie* |
| Contact (noun) | Person | the record |
| Deal | Initiative | a goal-bearing effort |
| Pipeline | *(drop)* | no funnel metaphor; use Initiative + its Touchpoint tree |
| Workflow | Ritual | user-facing primitive |
| Playbook | Ritual **template** | a `rituals.is_template = true` row |

### Identifier / route renames
- `WorkflowDetail.tsx` → `RitualDetail.tsx`; `PlaybookDetail.tsx` → fold into `RitualDetail` (template mode via `?template=1` or an `isTemplate` prop).
- Route `/workflows/:id` → `/rituals/:id`; `/playbooks/:id` → `/rituals/:id?template=1`.
- Nav/menu labels, breadcrumbs, empty-states, toasts, tooltips.

### Do NOT blind-`sed`
- **"Contact" as a verb/CTA** ("Contact", "Get in touch") is *action*, not the banned noun. Replace the CTA with **"Reach out"** / **"Send touchpoint"** — don't leave a button reading "Person."
- Code-level type names not shown to users (e.g. an internal `Lead` type) still get renamed for hygiene, but they're not the gate — the gate is **user-visible** strings.
- Keep semantic correctness: a "sales pipeline" widget isn't a Pipeline-rename, it's a **delete** — Bridge has no pipeline. Replace with Initiative progress (Touchpoint tree completion).

### Acceptance
- `grep -rioE 'lead|deal|pipeline|playbook' --include='*.tsx'` over user-facing strings → 0 (allow code-comment/legacy-data exceptions, flagged).
- `Workflow` → only appears (if at all) as a migration alias note, never in nav/labels.
- `Ritual` becomes the dominant execution noun.

---

## F2 — Approvals / Review inbox (P1) — *the governance moat, made visible*

**Why:** the Universal Action Pipeline's **User Review (approve | veto | edit + diff)** gate is the differentiator. Audit found it nearly absent (Review/veto/approval ≈ 1–2 refs). Every outbound/sensitive agent action pauses here.

### Placement
- New top-level **Approvals** surface (badge with pending count in nav) **and** an Intelligence-page widget ("N actions awaiting your review").
- This is the human side of `policies.requiresReview = true` and LangGraph `interrupt()`.

### Data
- Reads pending entries from `ledger` where `decision IS NULL` (proposed-but-undecided) joined to `decision_traces` (the *why*) and `policies` (which rule forced review).
- `on_behalf_of_type/id` + `delegation_id` shown as a provenance line ("Drafted by *Outreach Agent* on behalf of *Priya*").
- Writes the decision back to `ledger` (append a decision; never mutate the proposal row — append-only).

### Component spec — `ApprovalsInbox`
- **List**: rows = pending ActionRequests. Each row: actor (agent/user, with identity chip), action verb, target (Person/Initiative), policy that triggered review, age.
- **Detail / diff drawer**: 
  - **Proposed output** (e.g. the draft intro email) with an inline **diff** vs. any prior version (red/green).
  - **Why** panel from `decision_traces`: the signals + context + reasoning that produced it.
  - **Provenance**: actor → on-behalf-of → ritual run id.
- **Actions**: `Approve` · `Veto` · `Edit-then-approve` (opens the proposal in an editor; the edit is itself recorded). 
  - On Veto: optional reason chip ("too casual", "wrong recipient") — these feed the **Variance Adjuster** (`policy_params`). Surface a subtle "this will tune future drafts" hint.
- **Empty state**: "Nothing awaiting review. Agents are operating within policy." (reinforces governed-by-default, not idle).
- **No naked scores**: if a proposal cites relationship warmth, show it as a qualitative phrase ("long-dormant LP"), never "0.31".

### States
`pending → approved | vetoed | edited+approved`. All terminal states append to `ledger`; approved/edited emit the downstream `event`.

---

## F3 — Execution Ledger / Decision-Trace view (P1)

**Why:** audit found ledger/audit ≈ 1–2 refs. For a fund to adopt, "what did the AI do, on whose behalf, and why" must be a **browsable, exportable** record. This is read-only history (F2 is the live queue; F3 is the archive).

### Placement
- `Settings → Governance → Execution Ledger`. (Settings is the governance/tenancy home per ARCHITECTURE §5.)

### Data
- `ledger` (append-only) + `decision_traces` (1:1 *why*) + `delegations` (resolve on-behalf-of names).
- Strictly read-only in UI; DB has `UPDATE`/`DELETE` revoked. UI must visibly communicate immutability ("Append-only · tamper-evident").

### Component spec — `ExecutionLedger`
- **Filterable table**: columns = timestamp, actor, on-behalf-of, action, resource, decision (approved/vetoed/auto), policy results. Filters: actor, agent vs human, resource type, decision, date range.
- **Trace drawer** (per row): inputs → proposed → decision → diff → policy results (pre/runtime/post) → emitted event. The full §3 pipeline for that one action.
- **Export**: CSV/JSON for audit/SOC 2 evidence. (Ties to the "SOC 2 Type I readiness now" decision.)
- **Delegation lens**: a toggle to group by "on whose behalf" — answers the question the schema's `on_behalf_of` columns exist to answer.

---

## F4 — Consent + Visibility (P1) — *highest strategic gap*

**Why:** audit found `consent` 0 · `canonical` 0 · `visibility` 2. Three distinct missing pieces, all on the **Person view**:

### F4a — Two-tier Person view (canonical vs private)
Split the Person profile into two clearly-labelled zones:
- **Public / Canonical facts** — from `people_canonical` (platform-stored, AI-enriched from public sources, deduped, **no tenant linkage**). Read-only here; "researched, not yours." Source-tagged.
- **Your private relationship** — from `people` (per-(workspace,user): warmth/ring/dormancy, private notes, overrides). Marked **private**, and flagged as the tier bound for **client-side / E2EE** (Phase 6). Visually distinct (e.g. a lock/"private" affordance).
- **Override mechanic**: where `people` overrides a canonical field (COALESCE), show "you've overridden the public value" with both visible. The two tiers must read as **separate**, never blended into one ambiguous field.

### F4b — Per-relationship visibility control
- A control on each Person (and note) setting `people.visibility ∈ {private, team, workspace}`.
- Default comes from `workspace_settings.default_visibility` (workspace admin decides — locked decision). Show the inherited default and let the user override per-relationship.
- Copy makes the blast radius concrete: "Team can see this relationship" vs "Only you."

### F4c — Both-party-consent intro flow
- The **moat/whitespace** feature. An intro is an `edges` row of type `INTRODUCED` with a **consent state machine**, not a fire-and-forget action.
- States: `requested → awaiting_both → (both_approved) active | declined`. Neither side is "connected" until **both** approve.
- UI: an **intro request card** (in Approvals/Network) showing both parties' consent status; the requester sees "waiting on Sarah", each party sees a clear approve/decline with what will be shared.
- Hard rule: **no silent enrichment, no auto-send** — consent gates the edge. (Matches COMPETITIVE.md "deliberately avoid".)

### Acceptance
- Person view renders two labelled tiers; `canonical` and `visibility` now present in the UI vocabulary.
- An intro cannot reach `active` without two approvals (state-machine enforced).

---

## F5 — Orbit honesty (P2)

- Confirm the Orbit/ring view shows **inner rings = <100 high-interaction** relationships, with the ~30k canonical network as searchable **background** (matches the scale assumption + two-tier).
- **No naked scores**: warmth/reciprocity drive *ordering and ring placement*, never a printed number. Replace any numeric badge with qualitative state (hot/warm/dormant) or position. (Invariant #8.)

---

## Cross-cutting UI invariants (apply to every screen)

1. **Governance is visible, not buried** — Approvals badge + Ledger are first-class, not hidden in admin.
2. **No naked relationship scores** — qualitative phrasing / placement only.
3. **Consent gates intros** — two-party approval is structural, not a courtesy.
4. **Two tiers never blend** — canonical (public, researched) and private (yours) are always visually separable.
5. **Provenance on every AI action** — "drafted by *Agent* on behalf of *User*, because *signal*."
6. **Vocabulary is the brand** — Person/Relationship/Memory/Community/Initiative/Ritual/Touchpoint/Signal only.

---

## Roadmap mapping
- **F1** — anytime (no backend dep).
- **F2 + F3** — land with **P1 Governance Spine** (ledger/policies/decision_traces exist there).
- **F4b** (visibility) — **P0/P1** (rides RLS + `people.visibility`). **F4a** (two-tier view) — **P3 Ingestion/Knowledge** (needs `people_canonical` populated by enrichment). **F4c** (consent intro) — **P4 Intelligence/Surfaces**.
- **F5** — **P4** (surfaces).
- Private-tier **E2EE** affordances (the lock on F4a) are real in UI from the start, but the crypto lands in **P6** behind the encryptable seam.
