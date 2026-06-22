---
title: Development Roadmap (v0)
type: raw
doc_kind: plan
status: Sequenced around platform capability layers, not features
companions: [ARCHITECTURE.md, SCHEMA.sql]
related_wiki: ../wiki/roadmap.md
updated: 2026-06-22
tags: [roadmap, phases, sequencing]
---

# Bridge AI — Development Roadmap (v0)

> Sequenced around **platform capability layers**, not features.
> Principle: build the *enablement layers* (substrate → spine → registries) before the *surfaces*,
> so pages, rituals, and tools all plug into one platform rather than being bolted together.

## Locked decisions (from strategy session, 2026-05-30)
```yaml
locked_decisions:
  wedge_customer: "GP / VC fund (a team, not a solo investor)."
  tenancy: "full Workspace + Teams from day 0."
  governance: "full loop from day 0 (Permission → Policy → Review → Ledger → Variance Adjuster)."
  shape: "platform-first. Rituals/Tools/Pages are many instances over a shared engine; the product is not built around any one of them."
  runtime: "thin custom orchestration (cron + queue + Postgres state). Defer Temporal/LangGraph."
  data: "Postgres/Supabase; edges table + pgvector. No graph DB."
  two_tier_model: "*_canonical (AI-enriched public facts, shared/deduped) vs *_relationship (private context: warmth/notes/interactions). The two never pollute each other."
  data_residency_and_privacy:
    dated: "2026-05-31"
    detail: "canonical → platform (cloud); relationship → local / customer-controlled, zero-knowledge (E2EE), fund holds keys, Bridge stores ciphertext only, team-shareable. Encryption deferred to Phase 6 (last) — but the relationship tier is built behind an encryptable seam from Phase 0."
```

---

```yaml
phases:
  - phase: 0
    theme: "Substrate & Tenancy"
    goal: "a multi-tenant, RLS-protected data substrate."
    items:
      - "Workspaces, Users, Teams, members; auth."
      - "Mirror tables — split per the two-tier model: *_canonical (platform, shared/deduped) vs *_relationship (proprietary, per-user) — plus communities, edges, timeline + Operational stubs."
      - "Events table. pgvector enabled (canonical/public content only; see seam note)."
      - "RLS deny-by-default on every workspace-scoped table."
      - "Encryptable seam: the relationship (proprietary) tier sits behind a data-access boundary + scoped AI-context release from day 0, so the deferred E2EE layer (Phase 6) slots in without a rewrite. Relationship-tier search/embeddings designed to run client-side — no server-side dependency on reading private content."
    exit: "two isolated workspaces; a user in one cannot read the other's rows (verified)."
  - phase: 1
    theme: "Governance Spine"
    goal: "every mutation flows through one governed pipeline."
    items:
      - "permissions (CBAC), policies (pre/runtime/post), ledger (append-only, UPDATE/DELETE revoked), decision_traces, policy_params."
      - "The Universal Action Pipeline middleware (execute()), used by all later layers."
      - "Variance Adjuster job (reads ledger vetoes/edits → nudges policy_params)."
    exit: "a scripted action is denied by a policy, approved on review, written immutably to the ledger, and a veto measurably shifts a policy param."
    note: "Sequenced before ingestion on purpose — retrofitting the pipeline later is the painful path, and you chose full governance."
  - phase: 2
    theme: "Capability Registries & Runtime"
    goal: "Rituals & Tools become configuration over primitives."
    items:
      - "Registries: skills, agents, rituals, tools."
      - "Thin agent runtime (planner → skill execution → tool/MCP access), all calls routed through the Pipeline (§1)."
      - "Ritual engine (cron + event triggers → skill pipeline → output surface)."
      - "Tool composition model (declarative composition → actions)."
    exit: "a new ritual and a new tool can each be added as a row (no new code) and execute end-to-end through governance."
  - phase: 3
    theme: "Ingestion & Knowledge"
    goal: "the Mirror fills itself; agents have real context."
    items:
      - "Integrations: Gmail + Google Calendar first (OAuth, scoped secrets)."
      - "Idempotent ingestion on (workspace, source, source_record_id) → persons, timeline, files."
      - "Community inference from interaction clusters (with confidence) — user-confirmable."
      - "Files as knowledge layer + retrieval (pgvector); manual voice / quick-add capture."
    exit: "connecting Gmail populates a real network with timelines; a duplicate sync creates zero duplicate rows."
  - phase: 4
    theme: "Intelligence & Surfaces"
    goal: "the integrated, interactive product."
    items:
      - "events → signals derivation; every signal carries an action (enforced)."
      - "Network Action card contract (Signal → Context → Insight → Action; no dead-ends)."
      - "Page surfaces as thin views: Network · Work · Intelligence · Settings."
      - "Signature visual: Orbit / map view + Initiative narrative timeline."
      - "Seed the first library of rituals (Weekly Review, Post-meeting Capture) and tools (Digital Card via sanitized projection, HelpDesk) — all as config."
    exit: "the cross-page flow in ARCHITECTURE §6 runs live; pages interconnect only via graph/bus/pipeline."
  - phase: 5
    theme: "Pilot & Learn"
    goal: "prove retention and the governance loop with real funds."
    items:
      - "1–2 friendly GP funds; watch the Variance Adjuster learn from real vetoes."
      - "Widen the ritual/tool library based on usage. Hardening, observability, audit review."
    exit: "a fund returns weekly because recall + governed reconnection earns trust."
  - phase: 6
    theme: "Zero-Knowledge Proprietary Tier (pre-GA) — DEFERRED, last"
    goal: "make the proprietary (relationship) tier customer-controlled and unreadable by the platform."
    items:
      - "E2EE for the relationship tier: fund holds keys, Bridge stores ciphertext only; team-shareable via key wrapping (envelope encryption / group key management)."
      - "Move relationship-tier embeddings/search client-side (or encrypted indexes); AI reads proprietary data only via scoped client-side decryption — server-side AI stays on canonical/public data."
      - "Pilot funds (Phase 5) run plaintext-but-RLS-isolated under contractual confidentiality until this lands."
    exit: "Bridge operators cannot read a fund's relationship notes; the fund's team can; AI still functions via scoped release."
```

---

## Cross-cutting workstreams (run through all phases)
- **Security/trust:** RLS, secret management, append-only enforcement, projection isolation for external surfaces.
- **Vocabulary discipline:** Person/Relationship/Memory/Community/Initiative/Ritual/Touchpoint — never CRM terms.
- **Observability:** ledger + decision traces are the product's audit story; build the viewer early.

## Open decisions to refine (next sessions)
- [ ] Person identity across a workspace: shared org-wide vs. per-user views of the same Person?
- [ ] Relationship signal math (warmth/dormancy) — formula + user override model.
- [ ] Outbound channels in v1 (draft-only vs. send via Gmail) and the consent UX for both-party intros.
- [ ] Voice-clone threshold for intro drafting (how much user-voice signal before drafting "in their voice").
- [ ] Memory privacy granularity: per-fragment / per-relationship / never-shareable.
- [ ] Mobile capture surface (home-screen widget) — v1 or fast-follow.
