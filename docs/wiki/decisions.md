# Decisions

Canonical. Mirror of memory `bridge-strategy-decisions`.

> **Reading rule (AP-020, 2026-07-14):** this page preserves historical decisions, including their original vocabulary. For current names and meanings, [glossary.md](../glossary.md) wins. Retired names are migration inputs, not accepted aliases.

## 2026-07-28 — DealPilot Records are a Cloud-Plane store served in the web app; secrets stay Local (ADR-151, AP-083)
- New `dealpilot_*` Supabase tables + `DrizzleDealPilotStore` + public-cloud composite that serves Deal/Source/Thesis **Records** and refuses every capture/credential op (desktop-only).
- Modules made editable via the `DataViews` edit surface (DealPilot Deal/Source, JobPilot stage moves). Boot-time idempotent demo seed for the pilot Org (DealPilot + JobPilot), gated to the deployed cloud.
- Canon preserved: Source credentials + raw capture stay Local Plane; "everything in the cloud" is deferred to a separately-governed Phase E.

## 2026-07-28 — Serve Cloud-Plane Modules in the cloud; Local Plane stays closed (ADR-150, AP-082)
- Public-cloud API also serves Task Manager, Relationship, JobPilot (Supabase; auth + Org guard + `bridge_app` RLS).
- DealPilot, Module Files, OAuth, Local-Plane Chat stay closed. DealPilot is desktop-only (Local store + Source credentials + raw capture).
- Residency model unchanged: only already-Cloud-Plane data is served in the cloud; Local Plane stays private.
- `DataViews` view switcher is a dropdown (metadata-driven eligibility; `DataViews` remains the only renderer).

## 2026-07-25 — Wake before bearer capture (ADR-145, AP-075)
- Remote wake first. Supabase session second. Bearer last.
- Same Auth subject activates Organization once.
- Token refresh updates session. No duplicate activation mutation.
- Sign-out/subject switch invalidates pending activation.
- Query replay rule unchanged. Mutation never replays.
- Desktop loopback remains wake-free. Sidecar token stays.

## 2026-07-24 — Reliability boundaries fail closed (ADR-144, AP-073)
- Remote wake: bounded, single-flight liveness.
- Query may replay once. Mutation never.
- Release owns Node + built API. No repo/system fallback.
- API bundle allowlist + secret scan.
- macOS native addon = signed Framework. Node gets JIT entitlements.
- Windows installer blocked until safe listener handoff. Compile check stays.
- Onboarding profile = private Local Plane Memory. Browser Avatar hydrates from it.

## 2026-07-21 — Web research rights gate (ADR-141, AP-068)
- Phase 1 = Parallel anonymous MCP only.
- Jina keyless + DuckDuckGo blocked. Reachable is not permitted.
- Free-direct/public only. Rights stale or headers change = stop.
- No paid fallback. Ever without approval.

## 2026-07-21 — Render = public cloud boundary only (ADR-137, AP-063)
- Free API + free static site. Virginia. Sleep/wake accepted.
- Supabase = Postgres/Auth.
- Render: public scope only. Private operation → desktop required.
- No disk. No vault. No credential key. Empty ephemeral scratch only.
- Exact pilot + `bridge_app` RLS stay mandatory.
- TASK-006 Google/Source-credential block unchanged.

## 2026-07-20 — ModuleStore composes shell + Graph identity (ADR-132, AP-058)
- Nav + Module Detail read active installations.
- Full Graph = permission-pruned graph + installed Modules + manifest Agents. Compose at authenticated API boundary.
- Source edge opens real Module/Record path. No guessed route.
- Module Runs reuse attributable Automation recorder. Same Run clock in memory + DB.
- Panels share collapsed/expanded/extended state. Organization-scoped persistence. Escape steps back one state.
- Knowledge runtime = zero. Two old Tool strings = inspected-source paths only; delete with final directory rename.

## 2026-07-20 — Supabase policyless tables stay server-only (ADR-134)
- Auto-RLS without policy = deny-all runtime break, not safety.
- Policyless catalog/junction table: revoke `PUBLIC`/`anon`/`authenticated`; server role only.
- Policy-backed table: RLS stays on. Membership stays forced-RLS.
- Never grant runtime BYPASSRLS. Never run as owner/service role.

## 2026-07-19 — Hosted Supabase pilot boundary (ADR-128, AP-052)
- Migration owner separate. Runtime only `bridge_app`. No owner. No BYPASSRLS.
- RLS identity transaction-local. Pool reuse cannot carry old Human/Organization.
- Production accepts one exact Supabase subject. Web shell waits for Auth + activation.
- Source credentials encrypted. Keys from host secret manager.
- Explicitly public roots → Supabase. Everything else → durable Local Plane.
- Browser hosting requires explicit encrypted-volume residency. Otherwise boot fails.
- One API replica until Local Plane ownership is shared.

## 2026-07-18 — Exact private Commons Runs (ADR-121, AP-047)
- Stored + current signed contract must match exactly. Drift = no binding, no Run.
- Skill reads one approved private Signal. Writes one private Signal. No runtime egress.
- Onboarding research owns the external fetch. Skill reuses its approved local citation.
- Owning Relationship Module must match exact built-in version + manifest.
- Shared private-row classifier. Never replace with a narrow Skill predicate.
- Legacy proposal + linked rows migrate private.
- Human correction cannot replace Commons hash/Module/Agent provenance.

## 2026-07-18 — Organization rename moves local Files safely (ADR-122, AP-047)
- Validate name. Rename before Blueprint.
- DB row lock = cross-process authority.
- Fsynced generation intent before move. Sync Files before DB commit.
- Failure/crash = re-lock + reconcile to committed DB name.
- Cleanup re-locks. Own generation only.
- Two different roots = preserve intent + stop.
- Conflict/symlink = stop. Case-only = exact casing.
- Legacy startup uses same recovery path.
- DB name + `Documents/Bridge/<Organization>` stay one state.

## 2026-07-18 — Privileged webview boundary (ADR-120)
- Tauri webviews stay on trusted Tauri origins. External top-level navigation denied.
- Sidecar token only immutable main-webview global. Companion webviews get none.
- Google consent opens in validated system browser. Helper reaped. Callback uses actual sidecar port.

## 2026-07-18 — Google OAuth state (ADR-119)
- Connect mints state + PKCE verifier after auth + membership.
- URL gets raw state + S256 challenge. Local Plane gets hash + verifier + binding + expiry.
- Callback consumes once. Token stays invisible until second membership check.
- One Integration lock. Failure restores exact prior token. Refresh uses ordered CAS.

## 2026-07-18 — Desktop sidecar launch capability (ADR-118)
- Loopback not auth. Rust owns random port + fresh 256-bit capability.
- Node inherits same listener. Rust keeps copy. Child crash cannot donate port.
- Tokenless bootstrap first. Privileged webview only after authenticated health.
- Child loss kills capture/topology, hides privileged windows, shows unavailable.
- Auth shutdown drains active requests. Hard deadline catches hung orphan.
- Header only. Never URL/storage/log. Non-Unix release without safe activation fails.
- Typed + legacy Google clients share injected URL + bearer/sidecar headers.
- Sidecar proves trusted client. Never proves Human re-auth.

## 2026-07-18 — DealPilot local durability (ADR-117)
- One Local Plane DB. One owning process. Drizzle + runtime state share client.
- Client close fails = keep ownership. Never admit second live opener.
- Organization aggregate updates atomic. Restart keeps Records, Relations, captures, Gmail recovery, spend, audit.
- Old adapter Record table imports before Drizzle. Exact verify. No migration number.
- Source secret only OS keyring. Opaque ref bound to Organization + Source.
- Opaque create/revoke journal repairs crashes. Secret value never DB/file/log.
- Server without durable storage + approved vault: fail boot. Memory adapters: tests only.
- Adapter owns its tables. No numbered migration. RM4/TASK-010 numbers untouched.
- macOS keychain + Tauri + 375px Chrome proven. Live Google + OS re-auth still missing.
- No physical-mobile/signing claim. No fake DONE.

## 2026-07-18 — Relationship continuity storage (ADR-115)
- Memory stays Memory. Corrections append. Forget removes lineage.
- Commitments + Introductions = private Event snapshots + evidence Relations.
- Intro completes only after two recorded consents. No send.
- Paths reuse pruned Relations. Bounded. No second Graph.
- No migration. Automation/delegation/evals still open.

## 2026-07-18 — Private Event detail stays on Relations (ADR-116, AP-042)
- Shared Event row = safe lifecycle envelope.
- Private detail = owner-filtered participant Relations.
- Timeline rehydrates only after owner pruning.

## 2026-07-18 — Durable Relationship effects (ADR-112)
- Decision first. Effect second. Never ask twice.
- `ref_ledger_id` is truth. Caller JSON is not.
- DB sequence picks winner. New decision replaces old Relation set.
- Pending/failed effect survives restart. Bounded retry. Owner only.

## 2026-07-16 — Roadmap fan-out (ADR-098, AP-029)
- Start TASK-006–015 now.
- Build 006/007/008 parallel. Plan rest now. Dependencies still hard.
- No fake DONE. Prototype proof still required.

## 2026-07-16 — File + desktop boot safety (ADR-097)
- Module Files stay strict child of `~/Documents/Bridge`. Dot paths fail.
- Desktop window starts now. API health check runs background. No 20-second frozen setup.

## 2026-07-16 — Avatar desktop movement + native chrome (ADR-094, ADR-096, AP-026)
- OS drag. Atomic position save. Runtime display watcher repairs hot-plug topology.
- macOS Avatar = pinned non-activating NSPanel. Joins all Spaces. Fullscreen auxiliary.
- Sidebar gets real AppKit traffic lights. No duplicate web controls. Other OSes keep native chrome.
- Physical external-display + full interaction proof still gates TASK-003 closure.

## 2026-07-09 — OSS adoption decisions: providers + reference-only + rejects (ADR-035–ADR-041)
- Docling = `DocumentProvider` primary (ADR-035); Tika = fallback for legacy formats.
- `SandboxProvider` doctrine split (ADR-036): isolated-vm for narrow no-network JS only; E2B for `shell:execute`/`code:exec`; Daytona retired (unmaintained).
- Nango = `ConnectorProvider` conditional on Elastic License 2.0 review (ADR-037); MinimalOAuthAdapter is the unconditional fallback; Activepieces pieces enter via Pi-import path only.
- Langfuse = `ObservabilityProvider` P2 (ADR-038); DeepEval vs Mastra evals bake-off at P3 — keep one, retire the other.
- Firecrawl = API-only (AGPL server not embedded); Stagehand = `BrowserActionProvider` P4; Playwright = fallback (ADR-040).
- Reference-only (ADR-039): Graphiti (trigger: Mem0 temporal failures), Letta, screenpipe (trigger: Rust capture burden), CrewAI/Agno/Haystack, Baserow/NocoDB/Appsmith.
- PARK (ADR-041): OpenFGA/OPA/Cedar/SpiceDB — re-evaluate only on P6+ enterprise ReBAC trigger with hard evidence. REJECT: Refine-as-dep, Electron, AutoGen, Windmill-embed. DEFER: Temporal (behind RitualExecutor port, unchanged).

## 2026-07-07 — Primitive ontology adopted (ADR-028, [ontology](ontology.md))
Canonical taxonomy: actors Human/Agent/Automation · capabilities Skill/Integration · work Request/Action/Incident/Artifact · surface Workspace/Element/ElementType/View · context Memory/Knowledge. Mappings (code names unchanged): `ritual`/"Workflow"=Automation · `tool`/ToolManifest=implementation surface, user-facing primitive=Workspace · Connection=Integration · Intent=raw Human Request · Chief of Staff=Agent archetype · Signal=derived Incident · Project=ElementType. **Promotion never mutates primitive category** — mints a new governed object consuming the old. Docs-only alignment; older entries below keep historical vocab.

## ⚠️ 2026-07-06 VISION PIVOT — nothing below is "locked"; ALL items re-audited
User call: no locked decisions. Full re-audit verdicts (RETAIN / MODIFIED / SUPERSEDED / REVERSED per item) → [vision](vision.md) + [../raw/vision-pivot-living-software.md](../raw/vision-pivot-living-software.md) §3 + ADR-011 (§12 + ADR-012 = second-pass amendments same day: no dummy data, Recon add-on, multi-surface Notion model, competitor framing).
- **Bridge = Living Software** — adaptive workspace platform (Kernel → Compiler → Runtime → Generated Workspace) for professionals + teams. "Everything is proposed, governed, continuously evolved." Capability Lifecycle Platform.
- **SUPERSEDED**: GP-fund customer (→ teams, any profession; DealPilot = first compiled product) · web-first surface (→ Tauri desktop flagship) · human-only approvals (→ Capability Trust Model, trust-based by risk class; External band keeps explicit human approval).
- **REVERSED (flagged)**: Mem0-reject → adopt Mem0 + Mastra components behind ports, local-plane compatible.
- **MODIFIED**: vocabulary rule re-scoped (kernel = Bridge vocab; compiled workspaces = domain vocab OK, user override wins; re-scope ESLint `no-crm-vocab`) · agent auto-mode subsumed by trust grants · workspaces = projections over shared graph (Fork/Compose/Publish/Archive).
- **Day-1 user calls**: desktop capture + system events + browser sensors (capture → inspectable Memory entry; avatar blink = tell; raw capture local-only) · cross-workspace capability sharing (⇒ versioning+pinning day-1) · brokered external-API access for generated tools (never embedded credentials).
- **Second-pass amendments (same day)**: ~~dummy_ rule~~ **REVERSED → no dummy data**, real connected data only going forward (existing instances = debt, not purged this pass; test fixtures = separate open Q) · **Recon = add-on capability package** alongside Helpdesk (External risk) · **multi-surface Notion model** — kernel surface-agnostic, web+desktop(Tauri)+mobile = 3 thin clients; desktop-first = build SEQUENCING only, Sensor SPI = optional desktop-only capability never a kernel dependency · **competitors stated without OS-vendor hedging**: Vida/Invoko/AirJelly · Notion AI/Fibery/Noloco · Retrace/AgentOS · **domain-competitor discovery = dynamic** (Learning Agent researches live at blueprint time; Bridge ships no hardcoded competitor table, e.g. no static "DealPilot vs Dialllog/Affinity" lookup).
- **Third-pass user calls (2026-07-06 session 2, ADR-026 — full plan: [../raw/execution-plan-2026-07.md](../raw/execution-plan-2026-07.md))**: **both-party consent REVERSED** (data owner controls own data; intro = sender-approved governed proposal; design.md F4c struck) · **platform UI must match prototype** (bridge-ai-1ay.pages.dev skin over ADR-023 IA — two codebases, migration = Track C) · **avatar = Day 1, un-deferred** (personality pillar; web persona first, Tauri overlay next) · **dummy purge NOW** (all product-state; test doubles kept pending ruling P-1) · **LinkedIn login REJECTED** (privacy positioning; enrichment-source-after-login only) · **Pi primitives adopted** (Extensions/Skills/Capability Packages/Blueprints/Workspaces; tiny kernel, everything a package; Capability Registry not App Store; progressive disclosure of package contents) · **Pi package import = first-class** (manifest translator → governed Community-origin capability, sandboxed, pinned) · **ladder audit**: only genuinely-sequential state machines stay ladders (capability lifecycle, pipeline); promotion = peer trust thresholds; ALL threshold checks = pure fn/SQL, zero LLM tokens · **Builder toolbelt** (fs:read/fs:write/code:exec governed primitives + SandboxProvider port — Bridge currently has NO Read/Write/Edit/Bash equivalent) · **PromptAssembler** kernel subsystem (layered system-prompt uplift à la Claude Code/pi.dev) · **OSS map ruled**: adopt-behind-port Docling/Nango/Activepieces-import/E2B-or-Daytona-later/Langfuse/Firecrawl/Stagehand; reference-only Graphiti/screenpipe/Letta/Refine-patterns; REJECT OpenFGA/OPA/Cedar (own governance = built moat), Refine-as-dep, Electron, Windmill-embed.
- Items below stand where the re-audit says RETAIN; superseded items kept for history with strikethrough-in-spirit (see verdicts).

## Pre-pivot decision set (historical baseline — check re-audit verdicts before relying on any line)

- **Customer** = ~~VC fund~~ **SUPERSEDED → teams (any profession)**; VC fund = seed domain for DealPilot. Full workspace + governance justification stands.
- **Tenancy**: workspace + teams day 0. `workspace_id` = tenant key + RLS. Per-user = VISIBILITY layer (`private|team|workspace`), NOT tenancy.
- **Governance**: full loop day 0. Permission(CBAC) → Policy(pre/runtime/post) → User Review → append-only Ledger → Variance Adjuster (veto → policy_params, never code). → full rationale: ADR-009 (docs/raw/decisions-log.md)
- **Shape**: platform-first. Rituals/Tools/Pages = config instances over shared engine. Do NOT build platform around one feature.
- **Two-tier data**: canonical (AI public facts; platform; GLOBAL-deduped; no tenant linkage) vs relationship (private notes/warmth; per-(workspace,user)). No pollution. Override via COALESCE. → full rationale: ADR-008 (docs/raw/decisions-log.md)
- **Residency**: canonical = platform cloud. relationship = local / customer-controlled ZERO-KNOWLEDGE E2EE (fund holds keys, Bridge stores ciphertext, team-shareable). E2EE-at-rest DEFERRED → Phase 6. Build encryptable seam day 0. Relationship search client-side.
- **Local-first gate (PRIORITY TRACK — re-sequenced AHEAD of Taskade-style Initiatives)**: **EVERYTHING is local by default** — the whole platform (relationship tier AND a local copy of canonical facts) lives in a LOCAL store (machine/VPC — pglite/Postgres via ports/adapters seam). API pipeline = the ONLY gate to the internet. **Two agent planes + request/source flow**: LOCAL agents **REQUEST** internet data (never touch the internet directly); GLOBAL/EGRESS agents **SOURCE** it (fetch/enrich/send). **Internet-sourced facts are DUAL-WRITTEN** — stored BOTH globally (cloud canonical) AND locally, because both planes need them. Private relationship data = **local ONLY**, never crosses outward. Enforce: data-scope `private` ∩ egress = `none` ⇒ reject; `external:send`/`network_graph:full` agent-floor DENY; every crossing append-only audited. **Status**: gate (pipeline) ✅ built · local store ✅ (pglite `createLocalDb`, same Drizzle ports — private content/tokens local-only, never Supabase) · two planes 🟡 seams only. Local store + gate + two-plane + dual-write sourcing = NOW; E2EE-at-rest stays Phase 6. → full rationale: ADR-010 (docs/raw/decisions-log.md)
- **Scale**: ~30k canonical conns, <100 high-interaction. Validates two-tier. E2EE cheap (<100 rows).
- **Runtime**: BUILD thin agent runtime (moat). Model on Agno scope + LangGraph interrupt/checkpoint. Hatchet (Postgres) ritual-engine candidate. Temporal deferred behind `RitualExecutor`.
- **Models**: `ModelProvider` seam. dev=Ollama. prod=user-configurable multi-provider (Claude default). Embedding model NOT swappable (fixed vector dim) → pin one, decouple from chat model.
- **Vocabulary** = brand — **MODIFIED 2026-07-06, two scopes**: KERNEL (packages/core/api/governance/docs) keeps Person/Relationship/Memory/Community/Initiative/Ritual/Touchpoint/Signal, never Lead/Pipeline/Contact; WORKSPACE scope (compiled products, generated vocabularies) may use domain vocab (DealPilot says "Deal"), generated vocab aligns to Bridge theme by default, user override wins. **A to-do / task / sub-task IS a Touchpoint** (the work node — Taskade leaf). **Ritual = the executable automation.** Kill "task"/"to-do"/"sub-task" from UI + code (vocab sweep).
- **Agent auto-mode (2026-06-02, like Claude-Code auto-accept)**: a user-authorized relaxation of "agents draft, humans approve" — trivial agent actions may **auto-commit** without review. **Two levels, narrowest wins**: workspace allowlist (the ceiling of what's auto-able at all) ∩ per-agent allowlist → **effective-auto** (token grammar, same as capability_scope, e.g. `touchpoint:write`). Pipeline: agent action that is authorized AND in effective-auto AND NOT caught by a `require_approval` policy → auto-commit (ledger `userDecision='auto'`, basis=auto-mode); else `pending_review`. **Hard ceiling (never auto, regardless of allowlist)**: agent-floor resources (governance writes, `network_graph:full`), `external:send` (outbound = always human), and any egress crossing the gate. Default = EMPTY allowlist ⇒ agents never auto-commit (the original invariant holds until the user opts in). Auditable + revocable. Amends conformance: "no agent auto-commit" → "no agent auto-commit OUTSIDE the effective-auto allowlist". → full rationale: ADR-007 (docs/raw/decisions-log.md)
- **Realtime**: Hocuspocus/Yjs/CRDT NOT required (team co-edit is rare; workspace+members = authorization, not concurrency). Use Supabase Realtime (presence/notifications) + server-authoritative ordering + optimistic UI. Ledger = source of truth; edits = governed proposals.
- **Helpdesk Tool (2026-06-03, full: [helpdesk](helpdesk.md))**: AI-mediated assistance network — route a need to people who CAN help (**capability, not topic**), propose actionable ways to contribute, kill feed noise. Native Bridge Tool; fits the "who can help whom"/reciprocity thesis. Routing = **capability-match over the relationship graph** → governed proposals (**draft-then-approve** in Approvals); **invisible-by-default** (no match = not shown, = Signals rule). Maps to existing primitives (capability broker on people · local-plane per-recipient eval · RLS multi-tenant · shared-link public mode · two-tier visibility/consent · Policy-pre moderation). **User scope calls**: THIS build = **In-Bridge governed MVP** (defer standalone public app + anon posting + CAPTCHA/rate-limit/AI-moderation); vocabulary = **new Help Request entity**, helping → **Touchpoint**, **Helpdesk Workspace** = own entity (public help community, NOT a tenant workspace, NOT a Community). Prototype routing = **deterministic capability-match** over `network.ts` (real model later, same proposal seam). MVP = Supabase schema+RLS (helpdesk_workspaces/help_requests/help_routes/help_offers/helpdesk_members) · local store `data/helpdesk.ts` + routing engine · `/helpdesk` UI (My Helpdesks dashboard · workspace · New Request [AI-assisted default | Broadcast+auto-filter] · "Requests you may help with" inbox · request detail) · routes → proposeToLedger → Approvals · Offer Help → Touchpoint. Phases P1 public read-only page+slug → P2 standalone public app+anon+session → P3 security(CAPTCHA/rate-limit/moderation)+admin disputes → P4 future-enhancements (auto-filter tuning, capability learning, cross-workspace).
- **Tools model (2026-06-03, full: [tools](tools.md))**: triggered by 2 reference repos (`Tools/card-scanner`, `Tools/recorder`). **Internalize external repos** = plug-and-play: adopt GitHub repo → **internal MODIFIED COPY** (not live dep), front+back pathway kept **broad/flexible** (contract at edges only). **Two run modes, one codebase**: standalone/**shareable-link** (friends use, no account) + account-bound (signed-in → output → graph). **Gated intake**: standalone/friend captures **quarantined** → enter platform ONLY on **user approval** (capture ≠ commit). **Recorder = single-party self-capture**; **capture plane = local models default** (Ollama vision + local Whisper), cloud = explicit egress grant. **Reuses EXISTING primitives, zero new subsystem**: internal copy = versioning lineage · gated intake = Universal Action Pipeline at the ingestion edge (capture = pending_review proposal) · shared-link runtime = cloud plane, pulling captures home = inbound sourcing thru the gate · output→entity = typed output contract (same self-heal mechanism) · model/API calls = capability broker · local-default = two-plane gate. **Net-new = a Tool manifest** (edges: run_modes · surfaces · model_bindings · capabilities · output_contract · intake_policy{quarantine,commit_via:pipeline_proposal}). Mappings: card-scanner → Person + Touchpoint("met"); recorder → Memory + Touchpoints(next_steps shape matches) + Initiative. **card-scanner link-version intake UX (confirmed 2026-06-03)**: captures = **download** OR **"Add to Bridge"** → lands in Bridge **Tools section** as a pending list → per-item **Add** = the Pipeline proposal → review → commit+ledger (generalizes to any link-tool). **Open**: sequencing (build card-scanner as pilot Tool now vs Initiatives first) = user call.
- **Rituals engine (2026-06-03, full: [rituals](rituals.md))**: user dump = mostly Bridge-ALREADY-HAS (broker/policy/ledger/explainability/RLS/exec-engine) + net-new + 3 conflicts. **Conflict reconciles**: (1) **"swarms not workflows" → rejected as stated**; adopt **planner/executor split** — agentic Planner (swarm, may be non-deterministic) PROPOSES a DAG → governed **deterministic DAG executes** thru Pipeline (replayable/snapshotted/audited). Per-node **plan\|execute toggle = that boundary**; egress/agent-floor pinned to `execute`. (2) **on-the-fly API gen**: generate ≠ execute — ingest → capability *definition* → must register in broker + permission (+plane grant if egress) → only then run; doc-fetch = cloud-plane sourcing. (3) **custom JS nodes minimized** — typed expr (JMESPath/Jexl) default; code only external-container isolated-vm, no network, brokered (n8n RCE CVE evidence). **ADD net-new**: Ritual = 4 tabs (Overview side-scroll analytics / Canvas / Timeline / Boundaries) · approval **levels L0 auto / L1 notify / L2 approve / L3 dual-quorum** (egress/agent-floor ≥L2) · **memory classification** public/workspace/team/private/restricted (deferred Memory table; policy gates per-agent read) · **execution snapshots** (ledger += goal/memory_used/prompt/tool in+out/policy_state/model_version → replay) · **versioning** agents+skills+rituals (+diff+rollback) · **self-heal contracts** = governed mapping-suggester over typed contracts (never silent) · ritual flow global+local (global = optimization cache, exec local) · **data-masking** PII before visible log. **DEFER tail**: air-gap Docker/Helm · SIEM stream · AES-256 cred vault. **Sequencing**: plan/architecture update only — NOT an immediate build (Initiatives biz-process inbound); engine lands w/ ritual runtime.
- **Initiatives = THIN-slice Taskade, NOT a clone** (full: [initiatives](initiatives.md)). Insight = "one hierarchy, many view renderers". Hierarchy ALREADY exists = relational **Touchpoint tree**; **Initiative = goal node owning a Touchpoint hierarchy**. Build List/Board/Table/Calendar/MindMap as stateless PROJECTIONS over that ONE tree. Agent goal→Touchpoint decomposition = pipeline draft-then-approve, never live write. **REJECT**: CRDT/Yjs + autonomous live-editing agents (violate draft-then-approve + agent-floor + E2EE) · Universal-Entity table (kills typed RLS + vocab) · Neo4j (no row-level tenancy) · Mem0/Zep/LangMem as runtime dep (borrow patterns only) . **Approvals = pinned-only** (user's call 2026-06-02; pending-count badge moves ONTO the pinned tool to keep the trust signal). **Rituals = GLOBAL** (can reference an Initiative). **DEFER**: Temporal (behind RitualExecutor), BlockSuite/AFFiNE/AppFlowy (copyleft/pre-1.0), full event-sourcing. ~70% of the "Taskade dump" conflicts w/ Bridge identity.

- **Calendar Tool (2026-06-24, full: [calendar](calendar.md) / [../raw/calendar-plan.md](../raw/calendar-plan.md))**: in-app Calendar = a **time-axis PROJECTION over the Unified Graph**, packaged as a pinnable **Tool** — NOT a calendar product/server. **3 layers, 3 owners**: render → ADOPT OSS behind a `CalendarView` port; RFC-5545 math (recurrence/tz/ICS) → ADOPT small libs behind `RecurrenceEngine`/`IcsCodec`; system-of-record + governance → **BUILD on existing platform** (projection · `integrations`/`external_records` sync · Pipeline egress write-back · RLS-scoped team/shared · the moat). **Picks** (free + forkable, user won't pay + will heavily customize): **react-big-calendar** (MIT) · **ical.js** (MPL-2.0) · **ical-generator** (MIT) · **Luxon**. **REJECT embed**: Cal.com (AGPLv3) · Radicale/Baïkal (GPL-3.0) · Nextcloud (AGPLv3) · FullCalendar/Schedule-X premium (paid). `CalendarEvent` typed output_contract unifies GCal (already synced, local plane) + Touchpoints + ritual_runs + Initiative timelines + FUTURE conference/ICS adapters. **New source = new adapter, surface never changes** (future-proof). Team calendars = RLS visibility filter, not a new ACL. Scheduling (Calendly-like) = build on projection, deferred (P6+; revisit cal.diy MIT, verify license). Phases P0 contract+projection → P1 read-only surface → P2 governed write-back+.ics feed → P3 rituals/initiatives overlay → P4 team/shared → P5 conference adapters → P6+ scheduling. Sequences after local-gate slice + Initiatives P1.

## v2 schema punch-list (pending — EXTENDED by pivot)
roles+inheritance · delegations + ledger on_behalf_of/delegation_id · ephemeral_grants · agent-floor DENY + deny-default + expand resource_type · touchpoint hierarchy + Planner + plan-proposal review · signal read-only + signal_actions + 'saved' · node_types registry + plane tag + whitelisted cross-plane edges · ritual_runs · pin embedding dim.
**Pivot additions**: ~~capability_manifests · capability lifecycle states (Draft→…→Archived) · trust_grants (class × workspace × user) + auto-activation budgets in policy_params~~ **DONE 2026-07-06** (ADR-012: `packages/core/src/capability/` risk/lifecycle/approvals/credential-broker + `DrizzleCapabilityStore` + `capability.*` tRPC router; auto-activation budgets currently in-memory, not yet in `policy_params`) · sensor/memory tables (capture → Memory entries) · ~~workspace_definitions (projections) + blueprint registry~~ **table created 2026-07-06** (write path is still P1 onboarding work) · capability versioning/pinning/lineage (columns exist — `version`/`lineage_manifest_id` — enforcement logic still open).
- **ADR-157** (2026-08-01) — WhatsApp Module: owner's own Web session in a contained webview with wa-js injected; read-only behind a Rust op allowlist; capture confined to the Local Plane as a roster list, not the graph. LIDs are opaque handles, never phone numbers. Withheld from Commons.
- **ADR-158** (2026-08-02, supersedes ADR-157's engine/read-only/residency) — WhatsApp: the VISIBLE session is the single engine AND execution layer. **One account, one browser profile, one wa-js runtime, many surfaces.** No second authenticated client — `whatsapp-web.js` as a headless backend rejected (duplicate session/sync, client races, bigger behavioural footprint; device capacity ≠ behavioural risk). Message bodies now STORED + searchable on Local Plane (`tsvector`/GIN + `pg_trgm`, already in pglite) — reverses ADR-157's no-bodies promise; encryption at rest is an accepted documented gap. UI is **makeshift**, on `@tanstack/react-virtual`, deliberately NOT a WhatsApp replica. WRITE ENABLED v1: `decideSend` decides, **Rust enforces the cap** (renderer caps are bypassable). Ban protection is behavioural (consent gate, cooldowns, no near-identical bodies, kill switch), not the engine choice. No adoptable frontend exists that is virtualized AND permissive AND maintained; `open-bsp-ui` is Unlicense and real but unvirtualized and Supabase-typed. `open-wa` is **NOT MIT** (Hippocratic 1.1).
- **ADR-158 addendum** (2026-08-02) — Rust ceiling now EXISTS (`whatsapp_send.rs`); before this the cap was renderer-only, i.e. the thing ADR-158 rejected. State is DURABLE (`{app_data_dir}/bridge/whatsapp-send-ledger.json`, temp→rename) — a cap a restart resets is not a cap. Corrupt ledger ⇒ HALT, not empty. Send counted BEFORE attempt; uncountable ⇒ not sent. Ledger holds `sha256(recipient)` only, no bodies, no numbers. Write op is NOT in `script_for_op` (read path still refuses `send_message`); it lives behind `script_for_write_op`, reachable only from `whatsapp_send_start`. Send WPP path kept out of the health tripwire so health keeps its no-write guarantee — cost: send drift surfaces on first send. Deleting the ledger file still resets to warm-up day one; not defensible and not claimed.
- **ADR-158 addendum 2** (2026-08-02) — WhatsApp session window is now **INVISIBLE**. Runs as engine (linked, synced, executing), parked off-screen + hidden; **Bridge renders chats itself** from Local Plane store. Kills the "two overlapping apps" look WITHOUT touching the capability exclusion. Only exception: device linking (human must scan QR), hidden again on connect. Measured, not assumed: never-ordered-in WKWebView delivered **91% of server pushes over 10 min, stream open, host `eval` fine**. Page timers throttled ~1/15s — but SAME when ordered-in, so occlusion drives it, not hiding. Offscreen-but-visible rejected: identical to hidden, buys nothing. Open: WhatsApp's own keepalive runs on throttled page timers — needs live run.
- **ADR-158 addendum 3** (2026-08-02) — **unknown activity schedules a READ, never a success message.** Live: 500-chat session synced nothing and said "Everything is already up to date". Cause was two compounding honesty defects, NOT the data store: (1) `list_chats` read last-activity via `c.lastReceivedKey ? c.t : c.t` — identical ternary arms, one field, absent live ⇒ all 500 undated; (2) the scheduler DROPPED undated chats ⇒ empty queue rendered as success. Fix: extraction consults `c.t`/`c.lastMsgTimestamp`/`c.msgs.last().t` and reports **null not 0**; an undated chat is due for exactly ONE read, gated on the store cursor so it converges (unbounded re-reads = enforcement risk). Reporting split `nothing-readable` vs `completed`. Status bar now LABELS planes (`N on WhatsApp · M stored in Bridge`) — two true facts were reading as a contradiction. **`data_store_identifier` REFUTED as cause** — identified store holds the live `web.whatsapp.com` IndexedDB, default store empty since 07-07, `data_directory` never used ⇒ nothing was orphaned, no re-link needed, isolation stands. An existing test asserted the DEFECT (undated ⇒ never due); rescoped to dated chats. Health tripwire now merges `MESSAGE_WPP_DEPENDENCIES` (deduped) so `WPP.chat.getMessages` is checked at link time, existence-only — never invoked. Not yet demonstrated live.
- **ADR-158 addendum 3** (2026-08-02) — WhatsApp automation Tools (rules / scheduled actions / agent assignment). **Rules may only TIGHTEN the send discipline**: `tightenLimits` takes the stricter of EVERY field vs `SEND_POLICY_LIMITS` (direction is per-field — lower `similarityThreshold` = stricter, later `businessHourStart` = stricter). Zod bounds are usability, not protection — they can't bind stored state. **A refusal NEVER becomes a scheduled action** (deferral queues, refusal doesn't touch the ledger); a permanent no must not become a pending yes. **Automation starts a Run only of the Agent the OWNER assigned** — no fallback Agent; new `conversation-steward` Module Agent, separate from `contact-steward`. Consent gate checked in the planner too, and BEFORE the trigger, so an unfireable rule says so rather than "not due". All three ledgers share ONE `LocalStateStore` namespace `whatsapp:automation` (delete-rule must also cancel its queued actions — one write, not two). Scheduler imports nothing that can send; `performAutomatedSend` untouched. **No runner yet** — nothing dequeues a due action, and the user-clicked sweep can only fire `thread_quiet` rules (no arriving message to hand an `inbound_message` rule). Both gaps named in the surface: queue doesn't claim execution, inbound rules report `waiting` + the missing hook, not "not due".
