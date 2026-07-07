# Vision — Living Software (wiki)

full: [../raw/vision-pivot-living-software.md](../raw/vision-pivot-living-software.md) · PIVOT adopted 2026-07-06 (+ 2026-07-06 second-pass amendments §12). NOTHING pre-pivot locked — all re-audited (verdict table in raw §3).

## Second-pass amendments (2026-07-06)
- **No dummy data — REVERSAL of `dummy_` rule.** Platform shows real, connected data only; no seeded demo state/network going forward. Existing dummy_ instances = tracked debt (docs/BUGS.md), not purged this pass. Unit-test fixtures = separate category, unaffected (open Q). Onboarding must work off real connected accounts from session 1 — no demo-workspace fallback; not-yet-wired connector says so plainly.
- **Recon = add-on capability package**, same tier as Helpdesk (External risk — fetches/verifies external sources; draft-then-approve match tiers already fit Trust Model natively). Phase 2 ships **DealPilot + Helpdesk + Recon**, not Helpdesk alone.
- **Multi-surface = Notion model.** Kernel is surface-agnostic (tRPC/API); web + desktop (Tauri) + mobile = three thin clients, same kernel. Desktop-first = SEQUENCING only (build desktop → web (mostly exists) → mobile), not architecture. Sensor SPI = optional capability (desktop-only), never a kernel dependency — other surfaces fully work without it. View grammar must render at mobile widths from day 1 (cheap now, expensive to retrofit). Overlay avatar = desktop-shell-specific; web/mobile get lighter in-page persona.
- **Competitors, no hedging**: ambient desktop agents (Vida, Invoko, AirJelly) · generated/flexible workspaces (Notion AI, Fibery, Noloco) · agent-ops platforms (Retrace, AgentOS). OS-vendor framing dropped from competitive narrative entirely (kept only as an engineering risk note: graceful degradation / entitlements).
- **Competitor discovery = dynamic, never hardcoded.** Learning Agent researches a compiled product's competitive landscape LIVE at onboarding/blueprint time (web search, egress via pipeline) — Bridge ships no static competitor lookup table. "Dialllog/Affinity for DealPilot" = illustrative history, not runtime logic.

**Bridge = software that builds itself around your work.** Learns how user works → generates workspace → continuously evolves workflows/skills/agents/tools. Adaptive workspace for professionals + teams. NOT static app of any category. Old GP-fund framing = SUPERSEDED; funds → heritage of first compiled product (DealPilot).

## Ontology (2026-07-07, ADR-026 — see [ontology](ontology.md))
Canonical primitive names for everything below: actors = Human/Agent/**Automation** (code `ritual`, UI "Workflow") · capabilities = Skill/**Integration** (Connection) · work = Request/Action/Incident/Artifact (Signal = derived Incident) · surface = **Workspace** (code `tool`/ToolManifest = implementation surface only)/Element/ElementType/View · context = Memory/Knowledge. Older "workflow/skill/agent/tool" phrasing below = same peers, old names. Chief of Staff = Agent archetype, not a primitive. **Promotion NEVER mutates category** — promotion mints a NEW governed object consuming the old.

## Core principle
~~Everything is generated~~ → **Everything is PROPOSED, governed, continuously evolved.** Bridge = **Capability Lifecycle Platform**. One lifecycle for every artifact (table/workflow/skill/agent/tool/integration/dashboard — ontology names: ElementType/Automation/Skill/Agent/Workspace/Integration/View): Need → Research → Proposal → Evidence → Risk class → Governance → Activation → Evaluation → Promote/Demote/Retire.

## Brand principles
Adapt before asking · Learn before acting · Explain before automating · Govern before executing · Build only lasting value · Simple surface, powerful underneath.

## Capability Trust Model (replaces human-only approvals — REVERSAL, flagged)
- **Risk axis** (COMPUTED from manifest, never declared by generator): Informational → Advisory → Transformational → Operational → External.
- **Origin axis**: Built-in → Template → Community → AI-generated → User code.
- **+ Audience** (private/team/external-visible) — Informational × shared ≠ auto.
- Composite risk = max over dependency closure. Trusted decays (90d TTL; dep change → back to Validated). Auto-activation budgets (20 info / 10 advisory per day) + kill switch. Trust scoped per (class, workspace, user).
- **States**: Draft → Validated → Approved → Active → Trusted → Deprecated → Archived. Generated = Draft. Capability Builder ONLY makes drafts. Generation ≠ activation.
- **Manifest** per capability (inputs/outputs/permissions/connectors/risk/evidence/rollback/eval). **Credential broker**: capability requests need → governance grants temp scoped access. NEVER owns secrets (resolves user Q8 contradiction).
- Approvals by band: Info/Advisory auto · Transformational user-pref · Operational governance · External explicit. External + agent-floor = hard floor at launch.
- Failure → **auto-SUSPEND immediate** (no approval needed); demotion *decision* needs approval if creation did. Safety never queues.

## Kernel / Products / Interactions (orthogonal — C5 adopted)
- **Kernel** (not sold): graph+node_types registry (universal-entity still REJECTED — registry = the compromise) · memory (Mem0 behind port — REVERSAL of Initiatives reject, flagged) · governance · capability engine · execution runtime (thin custom + Hatchet + Mastra components behind ports).
- **Products** = compiled workspaces: DealPilot first, JobPilot/ResearchPilot later. Sell as PRODUCTS (support/pricing), not demos.
- **Interactions**: workspace · chat · command center · ambient. Ambient SPLIT: **sensing = day-1 kernel sensor** (user call) vs **acting = Phase-4 interaction model**.
- Kernel API = semver, expect churn until 2 products stress it. "Never changes" = overclaim.

## Desktop-first, multi-surface (user calls C3/C7 + Notion-model amendment)
Kernel = surface-agnostic (tRPC/API). **3 clients over 1 kernel, Notion-style**: web + desktop (Tauri) + mobile. Desktop-first = build ORDER (desktop → web (mostly built) → mobile), not an architecture constraint. Tauri = first shell built; apps/web hosted inside it AND independently reachable in-browser. Rust capture core = Phase-0 critical path (macOS first: focus tracking, AX-tree, on-demand screenshot) — but Sensor SPI = OPTIONAL capability, desktop-only, never a kernel dependency; web/mobile fully functional without it. Capture contract: **every capture → inspectable Memory entry; avatar blink = tell**. Raw capture local-plane ONLY; only derived Memories/Signals cross gate. Deny OS permissions → Bridge still fully useful (graceful degradation). View grammar (`<DataViews>`) must render at mobile widths from day 1. Overlay avatar = desktop-shell-specific interaction; web/mobile = lighter in-page persona. Competitors (no hedging, no OS-vendor framing): Vida/Invoko/AirJelly (ambient) · Notion AI/Fibery/Noloco (workspace) · Retrace/AgentOS (agent-ops). Domain competitors (e.g. DealPilot's) = Learning Agent researches LIVE at onboarding, never a hardcoded lookup.

## Workspaces = projections (C8 adopted)
One engine, many workspaces, shared capabilities. Graph never partitioned. Verbs: **Fork** (egg-spawn = new projection + new avatar) · **Compose** (capabilities coexist like VS Code extensions, never auto-merge; responsibility conflict → Chief of Staff asks) · **Publish Blueprint** · **Archive**. Global data = one John BUT facts scoped (two-tier survives pivot — it IS this rule); no auto identity-merge (possible_duplicate Signals retained). Policy compose = **deny-wins**, NOT CSS. Audit immutable, referenced w/ provenance, never merged. Shared capabilities day-1 ⇒ versioning + pinning + lineage day-1.

## View grammar (guardrail)
Table (morphs: calendar/kanban/map/graph/card) · chatbot · dashboard · canvas. Nothing else unless user asks (later phases). Relationships = graph or table ONLY. Generation = configs of REGISTERED components, never new components. `<DataViews>` shell = enforcement point → Phase-1 critical path.

## Vocabulary (re-scoped)
Kernel scope: Bridge vocab stands (Person/Relationship/Memory/Community/Initiative/Ritual/Touchpoint/Signal). Workspace scope: domain vocab OK (DealPilot says "Deal" — conformant now), generated vocab aligns Bridge theme by default, user override wins. ESLint `no-crm-vocab` → re-scope to kernel paths.

## Agents
Chief of Staff = default interlocutor (user can address any agent directly; governance never bypassed). Communications = skill library + policy gate, NOT agent. Learning agent executes research (egress via pipeline) but never builds. Capability Builder builds drafts only.

## Promotion defaults (policy_params, Variance-Adjuster-tunable — full table raw §5)
Workflow draft ≥5 reps/30d, ≥0.8 similarity; activate ≥3 approved runs, corrections <20%. Skill ≥2 workflows ≥2 contexts ≥85%. Agent ≥3 caps + ≥4wk responsibility + weekly use + owner. Tool ≥90% over ≥20 runs, stable I/O 14d. Trusted ≥30 runs ≥95% 0 violations 60d. Metrics = starting proxies, adapt from feedback (user C9).

## Retained unchanged
Docs protocol · two-tier data + residency + local-first gate + two planes (all PROMOTED — capture makes local-first literal) · pipeline/ledger/Variance Adjuster · L0-L3 levels (map to trust bands) · planner/executor split · Tool manifest (→ generalizes to Capability Manifest) · Helpdesk in-Bridge MVP (= FIRST capability package on kernel, alongside Recon + DealPilot) · Calendar-as-projection · no-CRDT/no-Neo4j · ADR-006 monorepo + tools-never-own-OAuth (= credential broker) · E2EE deferred last.

## REVERSED 2026-07-06 (second pass)
~~dummy_ prefix rule~~ → **no dummy data**: platform = real connected data only, going forward. Existing dummy_ instances = tracked debt, not purged this pass. Test fixtures = separate, unaffected (open Q).
