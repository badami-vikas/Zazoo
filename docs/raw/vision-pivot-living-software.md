---
title: Vision Pivot — Living Software (adaptive workspace platform)
type: raw
doc_kind: design
status: adopted (user-confirmed 2026-07-06; supersedes GP-fund wedge framing; NOTHING from the prior decision set is locked — every item re-audited below)
companions: [helpdesk-plan.md, tool-standardization-plan.md, decisions-log.md, ROADMAP.md]
related_wiki: ../wiki/vision.md
updated: 2026-07-06
tags: [vision, brand, capability-trust-model, kernel, roadmap, desktop-first, ambient]
---

# Vision Pivot — Living Software

## 1. The new brand (verbatim intent, canonical)

**One-liner:** Software that builds itself around your work.

**Short description:** Bridge learns how you work, generates the workspace you need, and continuously evolves its workflows, skills, agents, and tools as your work changes. Instead of forcing you to adapt to software, Bridge adapts to you.

**Stands for:** (1) Adaptive by Design — software evolves to fit the user. (2) Intelligence That Earns Trust — every recommendation, action, automation is explainable, governed, under user control; trust through transparency, not hidden autonomy. (3) Built From Reality — Bridge understands work by observing real objects, relationships, conversations, documents, decisions — not manual configuration. (4) Continuous Evolution — Bridge never feels "finished"; discovers patterns, creates workflows, generalizes into skills, proposes capabilities, improves alongside the user. (5) Human-Led, AI-Augmented — people own goals and decisions; Bridge removes cognitive overhead, repetition, operational complexity.

**Promise:** Your software should become more personal, more capable, and more useful every day you use it.

**Mission:** Build software that continuously adapts to people instead of forcing people to adapt to software.

**Vision:** Every professional has an operating system that understands their work, evolves with their goals, and quietly builds the capabilities they need before they realize they need them.

**Principles:** Adapt before asking · Learn before acting · Explain before automating · Govern before executing · Build only what creates lasting value · Stay simple on the surface, powerful underneath.

**Positioning:** An adaptive workspace for professionals and teams that generates and continuously evolves personalized workflows, skills, agents, and tools from how people actually work.

**Core principle replacement (user-adopted):** "Everything is generated" is replaced by **"Everything is proposed, governed, and continuously evolved."** Bridge is a **Capability Lifecycle Platform**: every artifact — table, workflow, skill, agent, tool, integration, dashboard, report — follows one lifecycle (Need → Research → Proposal → Evidence → Risk Classification → Governance Decision → Activation → Evaluation → Promotion/Demotion/Retirement).

## 2. Competitive reframe — and one honest correction

User framing: "no longer competing against relationship intelligence but Microsoft Windows, Mac."

Correction accepted into the doc with a caveat: Bridge does not *compete with* desktop OSes; it builds the **adaptive work layer above them** and *depends on* their APIs (accessibility trees, screen-capture entitlements, notarization, permission dialogs). "OS for work" is the brand metaphor; the operational reality is platform dependency. Consequences: (a) the ambient sensor must degrade gracefully when OS permissions are denied or revoked — Bridge must remain fully useful as a workspace without capture; (b) macOS entitlement/notarization strategy is a Phase 0 engineering task, not an afterthought; (c) the real competitive set is: ambient desktop agents (Vida, Invoko, AirJelly), generated/flexible workspaces (Notion AI, Fibery, Noloco), agent-ops platforms (Retrace, AgentOS) — and, for the first compiled product only, Dialllog/Affinity.

## 3. Re-audit of ALL prior decisions (nothing locked)

Every item from the former `decisions.md` + CLAUDE.md rules, re-judged against the new brand. Verdicts: RETAIN (unchanged) · RETAIN-PROMOTED (more central than before) · MODIFIED · SUPERSEDED · REVERSED (explicit flip, flagged).

```yaml
re_audit:
  - item: "Bridge = private relationship-intelligence OS for VC/GP funds"
    verdict: SUPERSEDED
    now: "Bridge = living software — adaptive workspace platform (kernel + compiled workspaces) for professionals & teams. Relationship intelligence for funds = heritage of the FIRST compiled product (DealPilot), not the company."
  - item: "NOT a CRM / sales tool / task manager"
    verdict: RETAIN
    now: "Broadened: Bridge is not a static app of ANY category; it compiles category-shaped workspaces."
  - item: "Customer = VC fund (team, not solo)"
    verdict: SUPERSEDED
    now: "Customer = teams (any profession). DealPilot = first compiled product + thesis demo; fund domain = seed blueprint because data/heritage exist."
  - item: "Tenancy: workspace + teams day 0; workspace_id = tenant key + RLS; visibility layer"
    verdict: MODIFIED
    now: "Retained mechanically. Workspace concept upgraded: a workspace = a PROJECTION over the shared graph (C8 model). Tenant boundary (org) stays; in-org workspaces are projections, not silos."
  - item: "Governance: full loop day 0 (CBAC -> Policy -> Review -> Ledger -> Variance Adjuster)"
    verdict: RETAIN-PROMOTED
    now: "Extended with Capability Trust Model (section 4). Pipeline/ledger/adjuster unchanged; they gain manifest-aware risk classification."
  - item: "Human-only approvals (governance hardening, shipped 2026-06-22)"
    verdict: REVERSED
    now: "Trust-based approvals by risk class (Informational/Advisory auto; Transformational = user preference; Operational = governance; External = explicit approval). Agent auto-mode (ADR-007 effective-auto allowlist) was already the first step; trust model generalizes it. Hard floor retained: external egress + agent-floor resources never auto at launch; may earn relaxation per-class, per-workspace."
  - item: "Shape: platform-first; Rituals/Tools/Pages = config over shared engine"
    verdict: RETAIN-PROMOTED
    now: "Strengthened into Kernel framing: Kernel -> Compiler -> Runtime -> Generated Workspace."
  - item: "Two-tier data: canonical (global public facts) vs relationship (private per-(workspace,user))"
    verdict: RETAIN-PROMOTED
    now: "This IS the answer to 'if John exists, John exists': global identity + scoped facts/visibility. Workspaces see the projection their policies allow. Rename tiers later if needed; architecture survives the pivot intact."
  - item: "Residency: local-first gate, two agent planes, dual-write sourcing, pipeline = only internet gate"
    verdict: RETAIN-PROMOTED
    now: "Desktop-first + capture makes local-first the default reality. Capture data = local-only plane (S0/S1/S2 store); only derived Memories/Signals cross the gate, audited."
  - item: "E2EE relationship tier deferred to last phase"
    verdict: RETAIN
  - item: "Scale: ~30k canonical conns, <100 high-interaction"
    verdict: MODIFIED
    now: "No longer a platform assumption; retained as DealPilot sizing only."
  - item: "Runtime: BUILD thin agent runtime (Agno scope + LangGraph patterns); Hatchet; Temporal deferred behind RitualExecutor"
    verdict: RETAIN
    now: "Amended: adopt Mastra components (evals, workflow primitives) and Mem0 (memory layer) where they beat hand-rolls — see REVERSED item below."
  - item: "Initiatives decision: REJECT Mem0/Zep/LangMem as runtime dep (borrow patterns only)"
    verdict: REVERSED
    now: "User call 2026-07-06: adopt Mastra/Mem0 components now. Constraint: behind ports (MemoryEngine seam), local-plane compatible, no cloud-only dependency for private data."
  - item: "Initiatives: REJECT Universal-Entity table; views-over-one-tree"
    verdict: RETAIN
    now: "User chose compromise (b): node_types registry + plane tag (already in schema v2 punch-list) satisfies the Universal Object System intent. Typed schema + growable registry; no untyped universal table."
  - item: "Initiatives: REJECT CRDT/Yjs; REJECT Neo4j"
    verdict: RETAIN
    now: "Workspaces-as-projections need no CRDT either. Server-authoritative ordering + Supabase Realtime stands."
  - item: "Models: ModelProvider seam; dev=Ollama; prod configurable (Claude default); pinned embedding dim"
    verdict: RETAIN
    now: "Add: capture/sensor plane defaults to LOCAL models (already the Tools-decision rule); on-device latency budget for ambient."
  - item: "Vocabulary = brand; NEVER Lead/Deal/Pipeline/Contact; task IS a Touchpoint"
    verdict: MODIFIED
    now: "Two scopes. KERNEL scope (packages/, core, api, governance, docs): Bridge vocabulary retained as-is. WORKSPACE scope (compiled products, generated vocabularies): domain vocabulary allowed, generated aligned-to-Bridge-theme by default, USER override always wins (user call C10). DealPilot legitimately says 'Deal'. ESLint no-crm-vocab rule must be re-scoped to kernel paths (currently flags 40+ identifiers in tools/dealpilot — those become conformant, not violations)."
  - item: "dummy_ prefix rule for all mock/demo/seed data"
    verdict: RETAIN
  - item: "Docs protocol (wiki caveman / raw depth / log / ADR / BUGS / blast-radius)"
    verdict: RETAIN
  - item: "Agent auto-mode (effective-auto allowlist, hard ceiling)"
    verdict: MODIFIED
    now: "Subsumed by Capability Trust Model: allowlists become per-class trust grants; hard ceiling maps to External band. Mechanism (narrowest-wins, ledger userDecision='auto') retained."
  - item: "Helpdesk Tool decision (in-Bridge governed MVP; capability-match routing; Help Request entity)"
    verdict: RETAIN
    now: "User re-confirmed near-term goal = in-Bridge governed MVP. Reframed: Helpdesk = the FIRST installable capability package on the kernel (manifest + lifecycle states), proving the add-on model."
  - item: "Tools model (internalize repos; Tool manifest; gated intake; two run modes)"
    verdict: RETAIN-PROMOTED
    now: "Tool manifest generalizes into the Capability Manifest (section 4). Gated intake = the Proposal step of the universal lifecycle."
  - item: "Rituals engine (planner/executor split; L0-L3 approval levels; snapshots; versioning; masked logs)"
    verdict: RETAIN-PROMOTED
    now: "L0-L3 levels map 1:1 onto trust-model bands. Planner/executor split IS 'AI proposes, Bridge governs'. Versioning becomes capability versioning."
  - item: "Calendar Tool = time-axis projection over graph; adopt react-big-calendar/ical.js behind ports"
    verdict: RETAIN
    now: "Projection pattern = the template for workspaces-as-projections."
  - item: "Realtime: no CRDT; Supabase Realtime + optimistic UI; ledger = source of truth"
    verdict: RETAIN
  - item: "ADR-006 monorepo convergence; internal vs external tools; integrations platform-level only (tools never own OAuth); build order engine -> internal tools -> DealPilot -> JobPilot/Helpdesk -> absorb prototype"
    verdict: RETAIN-PROMOTED
    now: "Already congruent with the kernel-first roadmap (C5). 'Tools never own OAuth; grants via Authority resolver' = the credential broker of the trust model, pre-built."
  - item: "Approvals = pinned-only tool with badge"
    verdict: RETAIN
  - item: "v2 schema punch-list"
    verdict: RETAIN
    now: "Extended: + capability_manifests, capability_states (lifecycle), trust_grants (per class x workspace x user), sensor/memory tables (capture -> Memory entries), workspace_definitions (projections), blueprint registry."
  - item: "Web browser app as the product surface"
    verdict: SUPERSEDED
    now: "Desktop-first (Tauri) is the default form factor (user call C7). apps/web becomes the UI hosted inside the Tauri shell + dev surface. Browser access remains for reach, not the flagship."
  - item: "Data-residency rule (identity/contact global+local; everything else local-only)"
    verdict: RETAIN
  - item: "Ambiguous duplicates = Signals, never auto-merge"
    verdict: RETAIN
    now: "Applies unchanged to the global-identity rule: 'no duplicate Johns' is aspiration; uncertain identity merges stay human."
```

## 4. Capability Trust Model — adopted, with six amendments

The agent's C2 pushback is adopted wholesale as architecture: two axes (Risk: Informational → Advisory → Transformational → Operational → External; Origin: Built-in → Template → Community → AI-generated → User code), capability **manifests** (name, description, inputs, outputs, permissions, connectors, risk, owner, evidence, confidence, dependencies, rollback, evaluation), release-style **states** (Draft → Validated → Approved → Active → Trusted → Deprecated → Archived; "generated" just means Draft), the **credential broker** (capabilities request needs, governance resolves to temporary scoped access, never secrets), the **sandbox CI/CD** promotion path, and trust-based approvals per risk class. The Capability Builder only ever produces **Capability Drafts** — generation ≠ activation.

Amendments (critical review, adopted):

1. **Risk is COMPUTED, never declared.** Risk class derives deterministically from the manifest (declared permissions ∪ connectors ∪ effect types). If the generator could declare its own risk, "AI proposes + AI classifies + auto-activates" becomes a self-licensing loop. The classifier is kernel code, not model output.
2. **Third input: audience / blast radius.** Informational is only zero-risk when private. A generated dashboard shared team-wide or published externally can mislead or exfiltrate. Effective policy = f(risk, origin, audience). Informational × external-visible ≠ auto-activate.
3. **Composite risk = max over dependency closure.** A workflow embedding a Slack-posting step IS External, whatever its own steps look like. Manifest dependencies make this computable.
4. **Trusted decays.** Trusted state carries a TTL (default 90d re-evaluation) and resets to Validated on dependency change (connector API version bump, model swap, permission change). Trust earned on old evidence expires.
5. **Auto-activation budgets + kill switch.** Classes that auto-activate get volume caps (defaults: ≤20 Informational, ≤10 Advisory activations/day/workspace) and a per-class kill switch. Defends against prompt-injection-driven mass generation; caps live in policy_params (Variance-Adjuster-tunable).
6. **Trust is scoped per (class, workspace, user).** Approvals earned in one workspace do not auto-carry to another; blueprints publish capabilities at Draft, never at Trusted.

Q8 reconciliation (flagged contradiction, resolved): user answered "generated tools allowed to hold credentials and hit external APIs" while endorsing C2's "capabilities never own credentials." Resolution — generated tools may **use** external APIs from day 1 **via the credential broker** (temporary, scoped, audited grants resolved by the Authority resolver, which ADR-006 already mandates: "tools never own OAuth"). They never embed or store secrets. "Hold" = hold a *grant*, not a *credential*.

C4 amendment (safety inversion fixed): demotion of a capability whose creation required approval also requires approval — but **suspension does not**. On heartbeat failure / policy violation the capability auto-SUSPENDS immediately (safe state, stops executing); the *demotion decision* then goes to the user. A safety action must never wait in an approval queue while the failing thing keeps running.

C6 (adopted as stated + one guard): Communications Agent becomes a **skill library + policy gate** (not a long-lived agent). Learning Agent may execute (research/web/GitHub) but never build; its research is egress and rides the pipeline like all egress. Chief of Staff = default interlocutor; user may address any agent directly, bypassing Chief of Staff routing but never bypassing governance.

## 5. Promotion evidence defaults (Q7 — proposed constants, all in policy_params, Variance-Adjuster-tunable)

```yaml
promotion_rules:
  workflow_draft:      {repetitions_min: 5, window_days: 30, structural_similarity_min: 0.8}
  workflow_activate:   {approved_runs_min: 3, correction_rate_max: 0.2}
  skill:               {distinct_workflows_min: 2, contexts_min: 2, success_min: 0.85}
  agent:               {related_capabilities_min: 3, responsibility_age_weeks_min: 4, expected_use: weekly, owner: named}
  tool:                {success_min: 0.9, runs_min: 20, ambiguity_flags_last10: 0, io_schema_stable_days: 14}
  trusted_state:       {active_runs_min: 30, success_min: 0.95, violations: 0, age_days_min: 60, ttl_days: 90}
demotion_triggers:
  - "success < 0.7 over trailing 10 runs -> auto-suspend + demotion proposal"
  - "any policy violation -> auto-suspend immediately + demotion proposal"
  - "dependency change (connector/model/permission) -> state resets to Validated"
auto_activation_budgets: {informational_per_day: 20, advisory_per_day: 10}
success_metrics_note: >
  Proxies (approval rate, correction rate, time-to-first-action on signals,
  repeat-sequence->workflow conversion rate, capability retirement rate) are STARTING
  definitions, not hard-coded ceilings — per user call C9 they adapt from feedback.
```

## 6. Kernel / Products / Interaction separation (C5) — adopted, with four amendments

Adopted: the three-dimension split (Architecture = Bridge Kernel, never sold directly; Products = compiled workspaces — DealPilot, JobPilot, ResearchPilot; Interaction models = Workspace / Chat / Command Center / Ambient), "Bridge Kernel" naming (Kernel → Compiler → Runtime → Generated Workspace), hypothesis-per-phase roadmap framing, layers-of-irreversibility build ordering (kernel hardest-to-change first, domain blueprints easiest last).

Amendments:

1. **"Architecture never changes" overclaims.** Kernel APIs will churn until ≥2 products and ≥2 interaction models have stressed them. Treat kernel API as semver; expect breaking changes through Phase 2; freeze only after the second compiled product.
2. **"Your product isn't DealPilot, your demo is DealPilot" is commercially dangerous.** Buyers buy DealPilot — with support, onboarding, pricing. Internally kernel-first; externally product-first. Revenue for the first 12–18 months comes from compiled products. Do not let "it's just a demo of the compiler" license shipping something unsellable.
3. **Its own phase ordering contradicts the user's capture-day-1 requirement (C3).** Resolved by splitting Ambient into two halves: **SENSING** (desktop capture, system events, browser context → inspectable Memory entries) is a **Phase-0 kernel sensor** — it is data plumbing and must exist from day 1 per user call; **ACTING** (proactive suggestions, overlay actions, text insertion, quick replies) is a late **interaction model** (Phase 4). Sensing feeds learning; acting spends trust.
4. **"Interaction models are just UI" underestimates ambient.** Ambient acting has latency budgets, on-device model needs, and OS-permission surfaces that leak into architecture. Fortunately the local plane + ModelProvider seam absorb exactly this — but it must be planned as local-plane load, not "just another view."

## 7. Fork / Compose / Publish (C8) — adopted, with four amendments

Adopted: workspaces = **projections over shared knowledge**, never partitions of the graph. Operations renamed: Fork Workspace (new projection, optionally cloning workspace-local capabilities) · Compose Workspace (show multiple definitions together; capabilities coexist like VS Code extensions — never auto-merged; responsibility conflicts surfaced by Chief of Staff: "Both X and Y propose to own follow-ups — pick a default") · Publish Blueprint (workspace → reusable template) · Archive. Data taxonomy: global (people, companies, documents — one John, no duplication), workspace-local (columns, views, dashboards, filters, navigation), capability-local (workflows, agents, skills, tools — copyable). Audit never merges — immutable, referenced with provenance, like git history. Splitting data happens only for privacy and is really *publication* (selected objects into a shared scope). Egg-spawn UX = "create a new projection"; desktop icons = different entry points into one living system.

Amendments:

1. **"If John exists, John exists" needs the two-tier qualifier.** Global identity, yes — but facts about John carry scope/visibility (existing canonical-vs-relationship split + data-residency rule). A workspace sees the John *projection* its policies allow. And uncertain identity merges remain human (possible_duplicate Signals rule retained) — "no duplicate Johns" is the goal, never an auto-merge license.
2. **Policy composition is NOT CSS.** CSS resolves by specificity — confusing and permissive. Governance composition = **deny-wins / most-restrictive-wins** by default; user prompts may only *loosen* explicitly (logged), never silently tighten-or-loosen by cascade order.
3. **Capability copies track lineage.** A forked capability records (source capability, version); when upstream publishes a fix, downstream workspaces get an *offer* to update (never silent mutation). Required because user chose day-1 cross-workspace sharing.
4. **Sharing day-1 requires versioning + pinning day-1.** Shared capability = versioned manifest; each workspace pins a version. Without pinning, an edit in one workspace mutates every other — unacceptable under the trust model.

## 8. Desktop-first + capture-day-1 (C3, C7) — consequences accepted

User calls: desktop capture, system events, browser access from day 1; product ships as a desktop app (Tauri), not browser software; overlay avatar on the OS screen.

Engineering consequences, stated honestly:

- The **Rust capture core is on the Phase-0 critical path**: macOS first (NSWorkspace focus tracking, AXUIElement tree extraction, CGWindowListCreateImage on-demand capture), Windows later. S0/S1/S2 local store (SQLite WAL + WebP blobs + compaction daemon on a local model), PII scrubbing + app blocklists + resource governor — per the Vida-style breakdown, this is native-engineering scope; staff accordingly.
- **Capture contract (user-confirmed):** every capture produces an **inspectable Memory entry**; the avatar **blink is the tell** — capture never happens without a visible physical signal. Continuous sampling is off by default; on-demand (avatar click) first, opt-in cadence later.
- **Capture data is local-plane only.** Raw S0/S1 never crosses the gate; only derived Memories/Signals may, audited, under the existing egress rules.
- **Graceful degradation:** deny screen permissions → Bridge remains a fully functional adaptive workspace. Capture enriches; it is not load-bearing for core value. (This also de-risks the OS-vendor dependency named in section 2.)
- **Brand-principle alignment:** "Learn before acting / Explain before automating" — capture in Phase 0 is observation-only; nothing acts on captured context until Phase 4 (ambient acting).
- Avatar: egg onboarding (angels build egg; egg rolls through onboarding; spirit-animal question; hatches into avatar at completion — 5–12 adaptive questions, each with a declared blueprint outcome). Persistent overlay avatar meditates eyes-closed; click = awaken + read screen (one capture → one Memory entry + blink). Requesting an egg from the avatar spawns a new workspace projection (Fork), hatching into a new avatar of the same spirit animal.

## 9. View grammar (guardrail, canonical)

Default views: **table** (morphable: calendar, kanban, map, graph, card, …) · **chatbot** · **dashboard** · **canvas**. No other views generated unless the user explicitly asks (deferred to later phases). **Relationships always render as graph or table.** Generation targets a **closed view grammar + registered component set** — generated *configurations* of registered components, never generated components. The `<DataViews>` shell (deferred task #76) is the render target and enforcement point; it is now Phase-1 critical path, not a nice-to-have.

## 10. Roadmap (dependency-ordered, one hypothesis per phase)

```yaml
roadmap:
  phase_0:
    name: Bridge Kernel
    proves: "Bridge can represent work."
    ships:
      - graph + node_types registry + plane tags (schema v2 punch-list, extended with capability tables)
      - memory engine (Mem0-backed behind MemoryEngine port; episodic/semantic/procedural classes; local-plane compatible)
      - governance + Capability Trust Model (computed risk, manifests, lifecycle states, credential broker, trust grants, budgets) layered onto existing pipeline/L0-L3/ledger/Variance Adjuster
      - execution runtime (existing thin runtime + Hatchet; Mastra eval/workflow components behind ports)
      - Sensor SPI + day-1 sensors — desktop capture (Tauri/Rust, macOS), system events, browser context; capture -> inspectable Memory entries; blink tell; local S0/S1/S2 store
      - Tauri shell as default form factor (hosts apps/web)
    exit: "A team's real work (apps, docs, meetings, people, decisions) lands in the graph+memory as inspectable objects, governed end-to-end."
  phase_1:
    name: Workspace Generator
    proves: "Bridge can generate software."
    ships:
      - onboarding engine (5-12 adaptive questions, each mapping to a declared outcome; egg narrative + spirit-animal hatch)
      - blueprint engine -> view grammar (<DataViews> shell; tables/pages/dashboards as Informational auto-activate; workflow proposals as Advisory)
      - overlay avatar v1 (meditate/awake states, click-to-read via capture sensor, blink-on-capture)
      - Chief of Staff v1 (default agent; context-aware chat; approval cards); direct-address to other agents allowed
    exit: "Onboarding a new user generates a reviewable, activatable workspace they actually use."
  phase_2:
    name: First Compiled Product — DealPilot (+ Helpdesk capability package)
    proves: "Generated software outperforms static software."
    ships:
      - DealPilot as compiled workspace (ADR-006 build order already points here; fund heritage data seeds it)
      - Helpdesk migrated onto kernel as FIRST installable capability package (manifest, computed risk, lifecycle) — in-Bridge governed MVP scope
      - real team pilot; sell it as a product (support/onboarding/pricing), not a demo
    exit: "A paying team runs daily work in a compiled workspace and prefers it to the static incumbent."
  phase_3:
    name: Capability Evolution
    proves: "Generated software improves itself."
    ships:
      - pattern engine over sensors + app activity + in-workspace actions
      - promotion ladder as compiler rules (section 5 constants in policy_params)
      - sandbox CI/CD lane for Capability Builder (Pi-style minimal tool surface inside sandbox)
      - evaluation heartbeats + auto-suspend + governed demotion
    exit: "≥N workflows/skills promoted from observed behavior with approval-rate and correction-rate targets met."
  phase_4:
    name: Interaction Expansion
    proves: "Users interact naturally."
    ships:
      - Command Center (keyboard palette, voice, contextual commands, current-object awareness)
      - ambient ACTING (proactive suggestions from screen context, quick actions, text insertion) — spends the trust earned since Phase 0 sensing
      - Communications skill library + policy gate on all outbound drafting
    exit: "Meaningful share of actions initiated via command center / ambient suggestions, correction rate within target."
  phase_5:
    name: Fork / Compose / Publish
    proves: "Many softwares, one engine."
    ships:
      - egg-spawn (Fork Workspace), Compose, Publish Blueprint, Archive
      - shared capabilities with versioning + pinning + lineage offers
      - deny-wins policy composition
    exit: "A user runs 2+ compiled workspaces (own icons/avatars) over one graph; capabilities shared without cross-mutation."
  phase_6:
    name: Domain + Ecosystem Expansion
    proves: "The compiler generalizes."
    ships:
      - JobPilot, ResearchPilot, further blueprints; community blueprint/capability marketplace (community origin band of trust model)
      - Windows capture port; E2EE tier (former Phase 6) lands here
    exit: "A domain Bridge has never seen gets a usable compiled workspace from onboarding + research alone."
```

## 11. Flags raised to the user (contradictions found during re-audit)

1. **Human-only approvals REVERSED** — was shipped hardening (2026-06-22); now trust-based by class. Deliberate, recorded, with the External-band floor retained.
2. **Mem0-as-dependency REVERSED** — Initiatives decision explicitly rejected it; user now adopts. Constraint added: behind ports, local-plane compatible.
3. **Vocabulary rule re-scoped** — kernel keeps Bridge vocabulary; compiled workspaces may use domain vocabulary (DealPilot's 40+ "Deal" identifiers become conformant). ESLint `no-crm-vocab` needs path re-scoping.
4. **Q8 self-contradiction resolved broker-side** — tools use external APIs day 1 via brokered scoped grants; never embedded credentials (keeps both the user's intent and C2 + ADR-006).
5. **C4 demotion-approval safety inversion fixed** — auto-suspend immediate, demotion decision approved.
6. **"Competing with Windows/Mac"** — adopted as brand metaphor; operationally Bridge depends on OS vendors; graceful-degradation requirement added.
7. **Prototype/web-first surface SUPERSEDED** — Tauri desktop shell is the flagship; frontend-migration work (apps/web) remains the UI codebase, hosted in the shell.

## 12. Amendments (2026-07-06, second pass — user directives)

**No dummy data — REVERSAL of the `dummy_` convention.** User: "We're adding no dummy data. All data on this platform will be real data." The pre-pivot rule ("every mock/demo/seed value carries a `dummy_` prefix") is a product-surface pattern that no longer applies: the platform shows only real, connected data — no seeded demo state, no placeholder network. Scope of the reversal: **product/runtime data** (seed lists, demo networks, localStorage seeds, onboarding sample state) — none of that gets created going forward; existing instances are debt to remove, tracked via `docs/BUGS.md`, not fixed in this pass (large surface: prototype `network.ts`-era seeds, `dummy_pilot@bridge.local` structural default, ESLint `bridge/dummy-prefix` rule itself). **Distinct, retained**: unit-test fixtures (arbitrary literals asserting behavior) are a different category from product data and are unaffected by this call unless the user says otherwise — flagged as an open question, not decided unilaterally. Consequence: onboarding (Phase 1) must work from the user's actual connected accounts/documents from the first session — no fallback demo workspace to fall into if a connector isn't wired yet; a not-yet-connected capability must say so plainly rather than substitute seeded data.

**Recon = an add-on capability package**, same status as Helpdesk. `Tools/recon/` (search-led OSINT background-check, staged draft-then-approve DB — see memory `recon-tool`, `recon-match-governance`) becomes a second first-wave installable capability package on the kernel: its own manifest, computed risk (External — it fetches/verifies from external sources), draft-then-approve match tiers already match the Capability Trust Model's Operational/External bands natively. Phase 2 (First Compiled Product) is amended to ship **DealPilot + Helpdesk + Recon** as the initial capability-package set, not Helpdesk alone — all three prove the same "install a capability package on the kernel" model from different risk profiles (Recon = External/research, Helpdesk = Operational/routing, DealPilot = the compiled product itself).

**Multi-surface architecture (Notion model) — desktop-first in SEQUENCING, not in ARCHITECTURE.** User: web-app + desktop app + mobile app, all three, initially focus on desktop. This corrects an over-narrowing in §8/§10: "Tauri = flagship form factor" must not be read as "the only surface the kernel is built for." Architecture requirement: the kernel (graph, memory, governance, capability engine, execution runtime — all of Phase 0) is **surface-agnostic** and exposed via the existing tRPC/API layer; apps/web, a future Tauri desktop shell, and a future mobile client are three thin clients over the same kernel API, exactly as Notion runs one backend under web/desktop/mobile shells. Concretely: (a) the Sensor SPI (desktop capture, system events, browser) is desktop-only by nature and must be an **optional capability**, not a kernel dependency — mobile and web clients function fully without it, consistent with the graceful-degradation requirement already in §8; (b) view-grammar components (`<DataViews>` shell, §9) must render acceptably at mobile viewport widths from the start, even though mobile ships last, because retrofitting responsive layout onto a desktop-only-assumed component tree is expensive; (c) the overlay avatar's meditate/awake/blink behavior is a desktop-shell-specific interaction layer, not a kernel concept — web and mobile get a lighter avatar presence (in-page persona, no OS-level overlay). **Sequencing unchanged**: build desktop app first (Tauri shell + day-1 sensors, per C3/C7), web app second (largely already underway as `apps/web`, becomes the desktop shell's rendered content and remains independently reachable in-browser), mobile app third (new client, same API, no sensors).

**Competitive framing — drop OS-vendor competitor framing entirely; three-cluster set stands as the only competitive reference.** Removes the "competes with Windows/Mac (brand metaphor) / depends on their APIs (platform risk)" framing from §2 — that nuance is retained as an engineering risk note (graceful degradation, entitlements) but is no longer part of the competitive narrative anywhere (brand copy, onboarding, roadmap docs). Competitive set, stated plainly, no hedging: **ambient desktop agents** (Vida, Invoko, AirJelly) · **generated/flexible workspaces** (Notion AI, Fibery, Noloco) · **agent-ops platforms** (Retrace, AgentOS). Domain-specific competitors (e.g. Dialllog/Affinity for DealPilot) are handled by the next amendment, not listed statically here.

**Competitor discovery must be dynamic (Learning Agent), never hardcoded per compiled product.** Correction to §6/§10 Phase 2: earlier framing named "Dialllog/Affinity" as DealPilot's competitive set inside the platform's own strategy docs, written as if Bridge's onboarding/blueprint engine should ship that knowledge baked in. Rejected — this violates "Built From Reality" (brand principle 3) and the Learning Agent's own research capability (§3, §6: Learning Agent researches "competitors, best practices" as part of domain understanding). Correct model: when the onboarding/blueprint engine infers a domain (e.g., "this user does small-business M&A sourcing" → DealPilot-shaped blueprint), the **Learning Agent researches that domain's competitive landscape live** (web search, egress via pipeline like all Learning Agent research) and surfaces findings as evidence attached to the blueprint proposal — never a static lookup table maintained by Bridge engineers. Consequence for this doc: "Dialllog/Affinity" mentions elsewhere in this file and in `docs/wiki/vision.md` are historical/illustrative (what a human strategist found when asked), not a hardcoded product fact Bridge itself relies on at runtime. No code today implements this lookup, so there's nothing to rip out — this is a standing design constraint for when the Research Engine/blueprint engine is built (Phase 1–2): never ship a static competitor table as platform logic.
