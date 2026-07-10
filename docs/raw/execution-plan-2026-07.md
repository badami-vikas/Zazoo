---
title: Execution Plan — post-pivot consolidation sprint
type: raw
doc_kind: plan
status: reconciled 2026-07-09 (ADR-037) — GATED lanes over BRIDGE_PLATFORM_RESET_HANDOFF.md (the stable brief). Each Track executes only behind discovery gate (PASSED 07-09) + safety gate (sandboxing/package-import/test-strategy, still required), recorded in docs/APPROVALS.md. Do NOT execute as-is or mark tracks DONE without an approved row.
companions: [vision-pivot-living-software.md, roadmap-v2-universal-commons.md, capability-package-format.md, research-agent-skill-workflow-practices-2026.md, ../../BRIDGE_PLATFORM_RESET_HANDOFF.md, ../../BRIDGE_PLAN_CRITIQUE_AND_EXTENDED_PLAN.md]
related_wiki: ../wiki/roadmap.md
updated: 2026-07-09
tags: [execution, subagents, avatar, ui-migration, dummy-purge, pi-packages, oss, onboarding]
---

# Execution Plan — 2026-07 consolidation sprint

Drafted per user direction 2026-07-06 (second session same day). Decisions it encodes: ADR-026.
Designed for **sonnet/haiku subagent execution** — each task is scoped to one lane, write-capable
parallel agents get `isolation: "worktree"` (hard rule after the 2026-07-05 shared-tree wipe).

## New user calls encoded here (2026-07-06, session 2)

```yaml
decisions:
  - both_party_consent: REVERSED — not required; data owner controls own data (design.md F4c struck)
  - platform_ui_target: apps/web MUST match https://bridge-ai-1ay.pages.dev prototype design,
      PLUS all explicit IA changes from chat history (Shell IA ADR-023: KnowledgeBase, Projects,
      bottom bar, control-panel icon, tab ordering, Approvals+Signals tabs)
  - avatar: DAY 1, not deferred — un-defer from ADR-019; it is the personality pillar (Pi's 4th element)
  - dummy_data: PURGE ALL product-state dummy data now (not just "tracked debt");
      unit-test doubles that never enter the running software = flagged exception, see pushback P-1
  - linkedin_login: REJECTED (privacy positioning); email/password auth + LinkedIn as optional
      post-login enrichment source only
  - taste_skill: separate user-space task, NOT a UI generator; Commons UI = its own design task
  - ladders: audit every "ladder" — peers vs genuinely-sequential; only sequential ones stay ladders;
      deterministic transitions become engine code (compiler rules), not per-turn LLM reasoning (token saving)
  - pi_primitives: adopt Pi philosophy "tiny kernel, everything else a package";
      Bridge primitives = Extensions · Skills · Capability Packages · Blueprints · Workspaces
  - pi_package_import: YES, first-class — foreign capabilities via manifest translator,
      wrapped in Bridge governance/sandbox/version-pinning, never trusted blindly
  - capability_registry_not_app_store: agents (onboarding/Learning/Builder) search registry and
      PROPOSE packages; user rarely browses manually
  - progressive_disclosure: skills/capabilities load only when relevant (extends existing
      "≤20 active tools per turn" rule to package contents — 40-workflow package loads 1)
```

## Ladder audit (user question answered)

| Named "ladder" | Verdict | Action |
|---|---|---|
| Capability lifecycle (Draft→Validated→Approved→Active→Trusted→Deprecated→Archived) | **Sequential** (state machine) | Keep. Already engine code (`capability/lifecycle.ts`). No LLM in transitions. |
| Need→Research→Proposal→Evidence→Risk→Governance→Activation→Evaluation | **Sequential** (pipeline) | Keep. Transitions deterministic; LLM only inside Research + Evidence steps. |
| Action→Workflow→Skill→Responsibility→Agent→Tool promotion | **PEERS** (already ruled 2026-07-06) | NOT a ladder. Promotion = trust/evidence thresholds in `policy_params` (compiler rules) — deterministic checks, zero LLM tokens per evaluation. Only *proposal text* generation uses a model. |
| Risk axis Informational→External | **Ordered scale, not sequence** | Keep as classification enum. Computed, never traversed. |
| Governance L0→L3 approval levels | **Ordered scale** | Keep as enum. |
| Trust bands auto→user-pref→governance→explicit | **Lookup table** | Keep as mapping, not ladder. |

**Token-saving rule (adopt):** any transition that can be a pure function or SQL check MUST be —
models only generate proposals/explanations, never evaluate thresholds. This is already the P3
"promotion ladder as compiler rules" direction; this audit makes it a platform-wide invariant.

## Does Bridge have Read/Write/Edit/Bash? (user question answered)

Honest answer: **no — not as governed capability primitives.**
- Graph object create/update/link/search skills: YES (kernel skills).
- Filesystem context provider: registered kind, **unimplemented** (sensor_bridge stub).
- File Read/Write/Edit as governed tool primitives: NO.
- Sandboxed exec (Bash/PTY equivalent): NO — rituals research picked isolated-vm/external-container
  for custom JS nodes, but no general exec primitive exists.
This blocks the Capability Builder from actually *building* anything beyond manifests.
→ Track F2 "Builder toolbelt" below: `fs:read` / `fs:write` / `code:exec` capability primitives,
risk-classified (fs:read=Operational-local, fs:write=Operational, code:exec=Operational+sandbox
mandatory), routed through pipeline, sandbox behind a `SandboxProvider` port (local isolated-vm now,
E2B/Daytona adapter later).

## System-prompt uplift (user question answered)

Partially exists (Chief of Staff `classifyIntent` + star topology + chain-depth cap), but there is
NO layered prompt-assembly architecture documented. Claude Code / pi.dev quality comes from a
harness that assembles: persona + capability registry (progressively disclosed) + current context
(workspace/page/selected object) + memory + governance state + output contracts. → Track F5
"Prompt architecture" builds this as an explicit kernel subsystem (`PromptAssembler`), with the
context-provider registry feeding the "current context" block.

## Pi-primitive mapping (adopted)

```yaml
bridge_primitives:
  extensions:   low-level platform changes (connector, UI widget, runtime hook, parser)
  skills:       reusable reasoning, progressively disclosed (load-on-relevance)
  capability_packages: ADR-018 format — objects/relationships/vocab/views/signals/workflows/
                skills/agents/tools/governance/UI/integrations; Commons = the registry
  blueprints:   generated workspace definitions (workspace_definitions — exists); packages
                contribute blueprint FRAGMENTS; Learning Agent modifies; compiler compiles
  workspaces:   instantiated blueprints (projections — exists)
onboarding_flow: understand domain → research → generate workspace → SEARCH REGISTRY for candidate
  packages → propose ("found 3: ETA Search / Independent Sponsor / Search Fund — start from which?")
  → adapt → personalize. Packages = ingredients, not products.
pi_import: manifest translator (pi extension→tool/UI-ext/connector · skill→skill ·
  prompt→prompt asset · theme→UI theme) → wrapped as Community-origin capability →
  computed risk → sandbox if executable → explicit perms if external → version-pinned →
  rewrite as native Bridge capability when pattern repeats.
  rule: UI/prompts-only = light import · executable = sandbox · external systems = explicit review.
```

## OSS provider map (evaluated without bias — adopt / reference / reject)

Existing ports/adapters doctrine stands: never expose third-party repo to user; wrap as governed
capability behind a port. Verdicts:

```yaml
adopt_behind_port:
  DocumentProvider: Docling primary (P1 — RAG layer needs it) · Tika fallback · Unstructured if ETL
  SandboxProvider: local isolated-vm NOW (rituals decision stands) → E2B or Daytona adapter P3
    (Capability Builder sandbox CI/CD); never build own microVM
  ConnectorProvider: Nango (OAuth/token mgmt — replaces per-integration OAuth code) +
    Activepieces pieces imported AS capability packages via the Pi-import path (same translator
    pattern) — serves integration-over-custom-development principle directly
  ObservabilityProvider: Langfuse (traces/prompt versions) P2-P3 · DeepEval vs Mastra evals =
    run ONE bake-off in P3, keep one (both = duplication)
  WebResearch: Firecrawl (Learning Agent egress sourcing, through pipeline) P2 ·
    Stagehand for governed browser actions P4 (ambient acting) · Playwright already implied
reference_only:
  Graphiti: temporal-graph PATTERNS for memory (Mem0-behind-port decision stands; Graphiti =
    candidate second adapter if temporal queries outgrow Mem0 — do not swap now)
  Letta: agent-memory patterns
  screenpipe: capture patterns (own Rust capture core decision stands — Tauri sensor SPI built)
  CrewAI/Agno/Haystack: patterns already mined in 2026 research sweep
  Baserow/NocoDB/Appsmith: table/page UX patterns only (licenses + product-fit)
reject:
  OpenFGA/OPA/Cedar/SpiceDB: Bridge's CBAC+policy+ledger+trust-model IS the moat and is BUILT —
    swapping = rewrite of working, tested governance for zero user-visible gain. Revisit ONLY if
    enterprise RBAC scale breaks the custom engine (P6+). Record as standing decision.
  Refine (as dependency): view grammar + <DataViews> registry IS the enforcement moat; a second
    UI framework dilutes it. Patterns reference only.
  Electron: Tauri decided.
  AutoGen: maintenance mode.
  Temporal now: stays deferred behind RitualExecutor (unchanged).
  Windmill embed: AGPL/commercial-terms risk + overlaps Hatchet/BullMQ choice; patterns only.
```

## Tracks (subagent-executable)

Ordering: A (docs) → B (purge) unblock everything; C/D/E/F parallel after; G research parallel anytime.
Every write-capable parallel agent: `isolation: "worktree"`. Model guidance per task below.

### Track A — Doc reconciliation (haiku, sequential, fast)
- **A1 DONE this session**: consent REVERSED in design.md + DESIGN-FIX.md; this plan doc; ADR-026.
- **A2** (haiku): write missing specs into wiki/raw — control-panel icon (between filter + 3-dots on
  every broad table: popover listing associated tools/workflows/resources/people/agents/skills) ·
  workspace-name-from-email rule (company after @ → workspace name; else "<Name>'s Workspace";
  editable) · avatar growth = knowledge-depth indicator (egg→creature→mature, driven by memory/
  capability counts, NOT streaks) · dream cycle = named nightly system ritual (dedupe/link-repair/
  enrich/merge-conflict-resolve/summary-refresh — all as governed proposals where risk demands) ·
  virtual office (Termi-like) = P5/P6 optional capability package · Fork = "request egg from
  spirit animal" metaphor · AI-Executive-Office growth framing paragraph in vision.md · CoS weekly
  "board meeting" reflection ritual (P3).
- **A3** (haiku): BUGS.md hygiene — annotate stale dummy_-celebrating entries as pre-reversal;
  cross-check research sweep doc for Hermes/OpenClaw coverage, note gap if absent.

### Track B — Dummy purge (sonnet, 1 agent, worktree) — **P-1 RULED 2026-07-06: purge EVERYTHING**
Grep every `dummy_`/seed/demo instance; ALL categories die: (a) runtime/product-state → DELETE,
fail-closed like Google gateway precedent; (b) structural dev-identity constants
(`dummy_pilot@bridge.local`) → env-required real identity, fail-fast; (c) unit-test doubles
mocking SDKs → DELETE too (user override of P-1) — affected suites converted to live-credential
integration tests gated on env vars (skip-with-loud-notice when creds absent, never fake-pass);
`bridge/dummy-prefix` ESLint rule retired. Social-provider fixture seam: purged, same hard-purge
treatment as Google. Prototype `dummy_dealCandidates` demo fallback → remove; honest empty state.
Gate: full turbo build --force green; test suites either live-cred green or explicitly env-skipped.

### Track C — UI migration: prototype design → apps/web (sonnet, 2-3 agents, worktrees)
- **C1**: extract prototype design tokens/components (Design Bridge AI Interface (Copy)) →
  apps/web theme layer; align with design-system.md tokens; no redesign of prototype itself.
- **C2**: restyle Shell IA (ADR-023 structure KEPT — KnowledgeBase/Projects/bottom bar/tab order)
  with prototype's visual language (ListBar, StandardToolbar, flags-as-actions, green/yellow/red,
  card/kanban/list parity). IA = ADR-023; skin = prototype. Explicit: these are two codebases;
  this track closes the divergence the user flagged.
- **C3**: control-panel icon feature (spec from A2) on every table-backed view.
- **C4**: browser-verify each page vs prototype (preview tools), file diffs to BUGS.md.

### Track D — Avatar Day 1 (sonnet, 1-2 agents)
- **D1** (spec, haiku): states egg/meditating/awake/blink; hatch animation; spirit-animal set;
  growth stages; per-surface variants (desktop overlay vs web/mobile in-page persona).
- **D2**: web in-page persona component — meditating idle, click→awaken→read current context
  (context-provider API), blink on `sensor.capture` event, click-through to the inspectable
  Memory entry (capture contract). Ship web first (works everywhere), Tauri overlay window next.
- **D3**: onboarding egg — egg visual through the pop-up flow, spirit-animal question added to
  questions.ts, hatch on blueprint activation. Angels background = simple, ≤60s total (prior
  critique adopted: delight must explain state, never delay first value).

### Track E — Intelligent onboarding v2 (sonnet, 1 agent)
- **E1**: rewrite questions.ts — free-text profession-led (not multi-select), 5-12 adaptive,
  email/password login step, workspace-name-from-email rule, LinkedIn button REMOVED.
- **E2**: hypothesis step — after profession, agent states hypothesis (flows/tools/work) + asks
  explicit permission to inspect installed apps / downloads (intent stated), with
  build-from-scratch option. Wire to integration-first principle; permission requests only
  when relevant to stated goal, rest on-demand.
- **E3**: registry search step — onboarding queries package registry for candidate packages,
  proposes top matches (Pi-mapping flow above). Needs only local registry v1 (installed +
  bundled packages) until Commons ships.

### Track F — Kernel additions (sonnet, sequential-ish; F1 first)
- **F1**: ladder audit enforcement — verify all lifecycle transitions are pure fn/SQL, zero
  model calls in threshold checks; move any stragglers into policy_params compiler rules.
- **F2**: Builder toolbelt — `fs:read`/`fs:write`/`code:exec` capability primitives + manifests +
  computed risk + `SandboxProvider` port (isolated-vm impl); pipeline-routed, agent-floor rules
  apply, exec = sandbox-mandatory.
- **F3**: Pi package importer — manifest translator → ADR-018 capability package,
  origin=Community, version-pinned, sandbox for executable content, install via existing
  `packages.*` flow. Includes Activepieces-piece import via same translator seam.
- **F4**: progressive disclosure loader — package contents lazy-load on relevance; extends
  ≤20-active-tools rule to skills/workflows inside installed packages.
- **F5**: PromptAssembler — layered system-prompt assembly (persona · disclosed capabilities ·
  current context block from providers · memory · governance state · output contracts) feeding
  Chief of Staff + all agents; documented in architecture wiki.
- **F6**: durable package store (Drizzle `package_installations`) + capability ResourceType —
  closes 2 open BUGS rows while in this lane.

### Track G — OSS adoption ADRs (haiku research → sonnet ADR, parallel, read-only)
One ADR per verdict group from the map above (adopt/reference/reject + why + alternatives),
so the OSS decisions stop living only in this plan. Nango + Docling get concrete adapter
port sketches; Langfuse-vs-Mastra-evals bake-off criteria written for P3.

## Sequencing

```
Week 1: A2/A3 (haiku) ‖ B ‖ G          — docs, purge, research
Week 2: C1→C2 ‖ D1→D2 ‖ E1            — skin, avatar web, onboarding rewrite
Week 3: C3/C4 ‖ D3 ‖ E2/E3 ‖ F1/F2    — control panel, egg-hatch, hypothesis, toolbelt
Week 4: F3/F4/F5/F6                    — Pi import, disclosure, prompt assembler, durability
```

## Pushbacks recorded

- **P-1 RULED (2026-07-06): purge everything** — user overrode the keep-test-doubles pushback.
  Test doubles die; suites become env-gated live-credential integration tests (skip loudly when
  creds absent, never fake-pass). Accepted cost: CI needs creds for full coverage.
- **P-2 (asserted)**: OpenFGA/OPA not adopted — governance engine is built, tested, and the moat.
- **P-3 (asserted)**: Refine not adopted as dependency — view grammar enforcement is the moat.
- **P-4 (asserted)**: avatar web-first, Tauri overlay second — ships Day-1 avatar on every surface
  fastest; overlay window (always-on-top, transparent) follows in the same track.

---

## v3 adaptations (2026-07-06, session 3 — ADR-027)

External review doc arrived (agent-authored, NOT grounded in this repo). Ground-check run; verdicts:

### Rejected (ungrounded claims)
- "apps/web missing / ADR-023/026 undiscoverable" — FALSE. `platform/apps/web` exists (frontend migration Phases 1-4 landed); ADRs in `docs/raw/decisions-log.md`; workspace_definitions + package store + capability manifests in `platform/packages`. Reviewer audited repo root only, missed `platform/` monorepo.
- Retargeting all UI implementation to `Design Bridge AI Interface (Copy)` — REJECTED. Target map stands: **platform/apps/web = product target**; prototype = visual reference + purge/scrub target only.

### Accepted (grounded technical corrections)
- **Sandbox doctrine split**: isolated-vm = narrow no-network JS transforms ONLY. `shell:execute`/`code:exec` = container/microVM via SandboxProvider port, E2B adapter for cloud. NEVER isolated-vm for shell, never raw host.
- **Daytona** repo unmaintained since June 2026 → reference only. E2B first.
- **Firecrawl** core AGPL-3.0 → hosted API behind adapter only, never embed server. Stagehand/Playwright fallback path kept.
- **Nango** Elastic License → conditional: evaluate for ConnectorProvider, license/commercial review required before dependency; minimal OAuth seam kept as fallback.
- **OpenFGA/OPA/Cedar**: reject→PARK. Pipeline stays source of truth; re-evaluate policy-expression backends only on concrete enterprise/ReBAC trigger.
- **RunContextAssembler ⊇ PromptAssembler** (Track F5 renamed): assembles persona · request · selected object/surface · ContextProvider packs · disclosed capabilities · governance state · memory/retrieval · output schema · trace/ledger keys. Prompt text = one projection.
- **Avatar framing**: operational status surface first (idle/listening/reading_context/drafting/awaiting_approval/blocked_by_policy/error), personality second. Egg ceremony <60s, never blocks first value.

### Adapted (partial reversal of P-1 "purge everything", flagged to user)
- Runtime product surfaces: ZERO fake data — absolute, unchanged.
- Test doubles: NOT deleted. Renamed `test_fixture_*`, confined to test dirs. Live-credential env-gated integration tests where external systems are touched. Rationale: deleting all synthetic fixtures makes CI depend on external systems and guts packages/core unit suites — reviewer pushback accepted as correct engineering.
- `bridge/dummy-prefix` ESLint rule retired; replaced by `check:no-dummy-runtime` guard (fails on `dummy_` outside test dirs).

### Capability OS framing (user vision, adopted)
Bridge = Capability Operating System. Everything imports into ONE abstraction: Capability → Bridge Manifest → Governance → Sandbox → Evaluation → Registry → Workspace. Pi packages, MCP servers, Activepieces pieces, OSS agents (OpenHands-class), memory systems — all become Capability Packages. Moat = Capability Lifecycle, not better agents. Bridge = integration layer of the open-source AI ecosystem. Deploy pipeline (Ink pattern): Generate → Sandbox → Evaluate → Activate, CI/CD-shaped. MCP: Bridge both consumes AND exposes everything through MCP (Shepherd pattern). Study set: Shepherd (unified memory/cross-tool context), Ink (deploy pipeline), Coast (workflows-not-pages).

### Execution launched (session 3)
Wave 1, 5 parallel worktree-isolated agents: kernel types (ContextProvider + foreign-import) · platform dummy purge + fixture policy · prototype scrub (dummy/consent/vocab) · UI parity audit → docs/raw/ui-parity-audit-2026-07.md · specs + OSS ADR docs. Wave 2 (after wave 1 merges): avatar Day-1 + onboarding egg in apps/web · Control Panel + Knowledge Base IA · skin migration per parity audit. Wave 3: RunContextAssembler · builder toolbelt + SandboxProvider · Pi/MCP/Activepieces importer.
