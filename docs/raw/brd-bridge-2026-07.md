---
title: Bridge — Business Requirements Document (Executive Brief)
type: raw
doc_kind: reference
status: active
companions: [vision-pivot-living-software.md, execution-plan-2026-07.md]
related_wiki: ../wiki/vision.md
updated: 2026-07-06
tags: [brd, strategy, commons, clients, branding, executive]
---

# Bridge — Business Requirements Document

*Executive brief · July 2026 · Confidential*

## 1. What Bridge is

Bridge is **Living Software**: an adaptive workspace platform that learns how a professional or team works, generates a personalized workspace for them, and then continuously evolves that workspace — its workflows, skills, agents, and tools — as their work changes. It is not a CRM, not a task manager, not a sales tool, and not a static app of any category. It is the platform those things get generated *from*.

The strategic frame is **Capability Operating System**. Every unit of functionality — an integration, a skill, an agent, a workflow, a UI view, a whole product like DealPilot — is a *capability* that moves through one governed lifecycle: proposed → validated → approved → active → trusted → deprecated. Capabilities from anywhere (our own compiler, the open-source ecosystem, third-party marketplaces) import into this one abstraction. The moat is not having the best agents; it is having the best **Capability Lifecycle** — the place where all capabilities can live together safely, adaptively, and evolve.

**One-line value proposition:** *Software that builds itself around your work — and proves every action it takes.*

## 2. Architecture in one paragraph

A surface-agnostic **Kernel** (graph of People, Relationships, Memories, Communities, Initiatives, Rituals, Touchpoints, Signals + governance engine) feeds a **Compiler** that turns learned context and capability packages into a **Blueprint** (a generated software definition), which a **Runtime** instantiates as a living **Workspace**. Around this sits the **Capability Trust Model**: every capability carries a manifest; risk is computed on two axes (what it can do: Informational → Advisory → Transformational → Operational → External; and where it came from: Built-in → Template → Community → AI-generated → User code). Anything outbound or sensitive pauses for human approval; everything is recorded in an append-only ledger. Capabilities never hold credentials — a broker injects them at execution time.

## 3. Universal Commons — what it does and how

**What it is.** The Commons is Bridge's cloud registry of *generalized capability knowledge* — and only that. It stores capability packages, blueprints, vocabulary templates, integration adapters, and evaluation results. It **never stores user data**. A user's graph, memories, documents, and captures stay in their own planes (local device and their own cloud tenancy).

**How it works:**

1. **Curation in, discovery out (v1).** Version 1 is a curated package registry. Packages are reviewed, signed, version-pinned, and risk-labeled before listing. There is no open firehose at launch.
2. **Agent-searched, not browsed.** The Commons is a *Capability Registry*, deliberately not an App Store. Users don't shop; during onboarding and whenever a need appears, the Learning Agent searches the registry, finds candidate packages, asks the user whether to use them, adapts them to the user's vocabulary and context, and the Workspace Generator compiles them in. Packages are ingredients, not finished products.
3. **The import funnel (the moat mechanism).** Foreign capabilities — Pi packages, MCP servers, Activepieces pieces, open-source agents and parsers — all enter through one pipeline: *Capability → Bridge Manifest (translation) → Governance (computed risk, declared permissions) → Sandbox (if executable) → Evaluation → Registry → Workspace*. This makes Bridge the integration layer of the open-source AI ecosystem: everyone else's output becomes our supply.
4. **Learning flows up, data never does.** When a generated capability proves itself in one workspace, its *generalized form* (structure, prompts, schema — stripped of all user data) can be proposed back to the Commons. The individual gets a better workspace; the platform gets compounding capability knowledge.
5. **Separation of concerns.** Control-plane functions (accounts, sync, billing, telemetry) live in a separate "Bridge Cloud" service, so the Commons stays a clean knowledge registry.

## 4. The three clients — one platform, one kernel

Users should think "I'm using Bridge," never "I'm using Bridge Desktop." All three clients are thin surfaces over the same kernel API (the Notion model). Desktop ships first — a sequencing choice, not an architectural one.

| Client | Role | What it uniquely does |
|---|---|---|
| **Desktop (Tauri)** | Reference implementation; the complete workspace | Local execution and local-first data plane; native context capture (screen, apps, accessibility, clipboard, filesystem, voice) via the Sensor SPI; the avatar as an always-present overlay; hosts the web app inside it |
| **Web** | First-class reach and collaboration | Full workspace in any browser; sharing and team surfaces; browser-native context; delegates privileged native work to Desktop when present; the same avatar as an in-page persona |
| **Mobile (Expo/RN)** | Capture, awareness, approvals | Quick capture (voice, photo, note → Memory); Signal awareness and notifications; the approvals inbox on the go; quick Touchpoints |

Capture is a day-1 capability on desktop, always opt-in per provider, with stated intent. The Sensor layer is an *optional capability*, never a kernel dependency — Bridge works fully without it.

## 5. Branding

- **Name & metaphor:** *Bridge* — between you and your work, between your relationships, and between the AI ecosystem and safe daily use.
- **The avatar is the brand's face.** During onboarding an egg forms in the background; the user picks a spirit animal; the egg progresses with *real* setup state and hatches only when the first usable workspace exists (under 60 seconds of ceremony — delight explains state, never delays value). The hatched avatar persists on screen, meditating. It is an **operational status surface first, personality second**: its states (idle, listening, reading context, drafting, awaiting approval, blocked by policy, error) tell the truth about what the system is doing. It **blinks every time context is captured** — the capture tell — and clicking it opens the inspectable Memory entry. It grows with knowledge depth, not usage streaks. Asking your avatar for new software spawns a new egg: software birth as a product ritual.
- **Vocabulary is the brand.** Kernel scope speaks only Bridge: Person, Relationship, Memory, Community, Initiative, Ritual, Touchpoint, Signal. Never Lead, Deal, Pipeline, Contact-as-noun. Compiled workspaces may speak the user's domain language (DealPilot says "Deal") — the user's own naming always wins at the surface.
- **Tone:** trust-first, explainable, quietly capable. Governance is visible, not buried; no naked scores (qualitative states, never "warmth 0.31"); provenance on every AI action ("drafted by Outreach Agent on behalf of Priya, because …").

## 6. Feature hierarchy

**Layer 0 — Kernel (the substrate).** Object graph (the eight nouns) · Memory engine (every capture → an inspectable Memory entry) · Governance engine: Universal Action Pipeline (propose → policy check → human review with approve/veto/edit-diff → execute → append-only Ledger) · Capability Trust Model (risk × origin, trust-based approval thresholds, External band always human at launch) · Credential broker · ContextProvider registry (nine typed providers: apps, accessibility, screen, voice, clipboard, filesystem, browser, documents, emails — each item carries permission, data scope, provenance, retention; screenshots are one provider, not the architecture).

**Layer 1 — Intelligence.** Learning Agent (researches the user's domain live, checks installed software, proposes integration before building) · Chief of Staff (routing, triage, the conversational front door) · RunContextAssembler (assembles persona + request + context packs + disclosed capabilities + governance state + memory + output contracts for every model run — the Claude-Code-grade prompt uplift, built in) · progressive disclosure (packages may contain dozens of skills; only the relevant subset loads per run).

**Layer 2 — Generation.** Blueprints (generated software definitions) · Workspace Generator/Compiler · view grammar (four generated view types only: Table with morphs — board, calendar, card, graph, map; Chat/composer; Dashboard; Canvas) · Capability Builder with a governed toolbelt (file:read/write/edit, shell:execute — always sandboxed, never raw host) and a CI/CD-shaped deploy pipeline: Generate → Sandbox → Evaluate → Activate.

**Layer 3 — Distribution.** Universal Commons (§3) · foreign-capability importer (Pi/MCP/Activepieces/OSS) · first compiled packages, sold as mix-and-match add-ons, not separate products: **DealPilot** (deal sourcing/execution), **Helpdesk**, **Recon** (background research). MCP both ways: Bridge consumes MCP servers as capabilities and exposes its own capabilities over MCP.

**Layer 4 — Experience.** Avatar (§5) · onboarding v2 (free-text profession-led; workspace named from email domain; Bridge states its hypothesis and asks permission before inspecting anything; registry search step; first useful workspace before any integration completes) · shell IA: pinned Projects and Tools, KnowledgeBase (People / Communities / Resources / Projects), Intelligence (tools, integrations, agents, skills, workflows), Approvals + Signals, Settings, Control Panel · Approvals inbox and Execution Ledger as first-class surfaces.

## 7. Major business decisions (with rationale)

1. **Category:** adaptive workspace platform / Capability OS — never framed against OS vendors; competitors are ambient desktop agents (Vida, Invoko, AirJelly), generated workspaces (Notion AI, Fibery, Noloco), and agent-ops platforms (Retrace, AgentOS). Per-product competitors are researched live at blueprint time, never hardcoded.
2. **Everything proposed, governed, evolved.** Draft-then-approve is generalized into the Capability Trust Model. No auto-send; outbound actions always pause for a human at launch. This is the enterprise trust story and the defensible engineering asset — which is why we build governance ourselves and only *park* (not adopt) policy engines like OpenFGA/OPA until an enterprise-scale trigger appears.
3. **Consent model (revised 2026-07-06):** private by default; the data owner controls their own data; outbound send requires sender approval; both-party consent is a policy-triggered exception (law, workspace policy), **not** a universal gate. No silent enrichment. No auto-send.
4. **Real data only (2026-07-06):** no demo/dummy/placeholder data in any runnable product surface — real connected data or honest empty states. Synthetic fixtures survive only inside test directories under a distinct naming scheme.
5. **Registry, not App Store.** Discovery is agent-mediated and need-driven; packages are adapted ingredients. This differentiates from marketplace plays and keeps quality curated in v1.
6. **Integration over custom development.** The Learning Agent proposes integrating what the user already runs (with explicit permission and stated intent) before building from scratch; from-scratch is the open-source-based fallback.
7. **OSS as replaceable providers behind ports, never as exposed architecture.** Adopt: Docling (documents, MIT), E2B (cloud sandbox, Apache-2.0), Stagehand (browser actions), Langfuse (observability sidecar; our Ledger stays the system of record), Activepieces piece-import (MIT). Conditional pending license review: Nango (Elastic License). Restricted: Firecrawl via hosted API only (core is AGPL). Reference-only: Daytona (unmaintained), Graphiti, screenpipe, Refine patterns. Rejected: Electron, embedding Windmill, Temporal-for-now. Two moats are never outsourced: the governance engine and the view grammar.
8. **Sandbox doctrine:** generated or imported executable code never runs on the raw host. Narrow no-network JS transforms may use in-process isolation; anything shell-level runs in containers/microVMs (E2B adapter for cloud), fully audited.
9. **Sequencing:** desktop-first (capture + avatar are strongest there), web same kernel immediately reachable, mobile after. Roadmap is 7 hypothesis-phases; current consolidation sprint: real-data purge, prototype skin onto the platform frontend, avatar day-1, onboarding v2, builder toolbelt, importer.
10. **Trust boundaries as product:** raw capture stays on the local plane; identity/contact fields may go global, everything else local-only; models are pluggable (local models default for the capture plane; Claude default for cloud reasoning).

## 8. Business model (current thesis)

Platform subscription (per seat) + paid capability packages (DealPilot, Helpdesk, Recon as add-ons) + a future Commons economy where third-party capability publishers reach users through the curated registry. Enterprise wedge: the governance ledger (SOC 2 evidence exports, delegation lens, auditability) — the thing ambient-agent competitors cannot retrofit.

## 9. Risks the executive team should hold

- **Scope gravity.** The platform can absorb unlimited ambition; the consolidation sprint enforces "first value before ceremony" (egg < 60s, workspace usable before integrations finish).
- **Licensing exposure** in the OSS supply chain — mitigated by the ports-and-adapters rule and the license verdicts in §7; requires ongoing review as dependencies evolve.
- **Trust is one incident away.** The no-auto-send, sandbox-always, ledger-everything posture is the mitigation; it must survive growth pressure.
- **Category education.** "Living Software" needs the avatar + egg + visible governance to make the abstraction tangible; otherwise we get read as "another AI workspace."
