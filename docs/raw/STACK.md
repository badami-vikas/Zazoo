---
title: Technology Stack (v1)
type: raw
doc_kind: reference
status: active
companions: [ARCHITECTURE.md, SCHEMA.sql, ROADMAP.md]
related_wiki: ../wiki/stack.md
updated: 2026-06-22
tags: [stack, infrastructure, tech]
---

# Bridge AI — Technology Stack (v1)

> Adapted from an earlier single-user plan, reconciled with locked decisions: multi-tenant from day 0, two-tier residency (canonical/platform vs relationship/local-E2EE), thin orchestration. Rows marked _provisional_ await the OSS agent-framework research (`wf_69e372a9-88b`).

## Scale assumption (drives every rendering + storage decision)
**Typical user: ~30,000 canonical connections, <100 high-interaction relationships.**
- Asymmetric by design → large/cheap **canonical** (platform) vs small/rich **relationship** (local/E2EE). This *is* the two-tier split.
- Virtualize every surface that touches the 30K. Graph view must use **WebGL** at this node count.
- De-risks Phase 6: client-side encrypted storage + search over **<100 rows** is trivial — no encrypted-vector-search-at-scale problem.
- The AI reasons over the ~100, never the 30K ("AI sees filtered context" as a performance fact).

## Core stack (adopted)
```yaml
core_stack:
  - layer: Frontend
    tech: React 18 + Vite 6 + TypeScript + Tailwind 4 + shadcn/ui + tRPC client
  - layer: Backend
    tech: Fastify 5 + tRPC 11 + Drizzle ORM + Postgres (Supabase)
  - layer: Database
    tech: "Supabase: Postgres + pgvector + pg_trgm + RLS + Storage + Realtime"
  - layer: IDs
    tech: ULID (or UUIDv7) — time-sortable, good index locality
  - layer: Auth / Tenancy
    tech: Supabase Auth + workspace/team from day 0 (RLS deny-by-default = tenancy + CBAC enforcement). Changed from single-user.
  - layer: Imports
    tech: Gmail + Google Calendar OAuth first; Granola/Fireflies/Slack later
```

> **API note:** tRPC serves the app's own frontend. Add a thin **REST/OpenAPI** surface later for the API-first / MCP goal (external agents can't consume tRPC).

## UI libraries (adopted — all permissive: MIT/BSD/Apache-2.0)
```yaml
ui_libraries:
  - library: "@glideapps/glide-data-grid"
    bridge_surface: Network — 30K people directory, virtualized, inline edit
    license: permissive
  - library: "@xyflow/react (reactflow)"
    bridge_surface: Automations — governed visual builder
    license: MIT
  - library: "@antv/g6 (WebGL mode)"
    bridge_surface: Relationship map — large read-only graph
    license: MIT
  - library: "maplibre-gl + react-map-gl + deck.gl"
    bridge_surface: Map / Place view + heat overlay
    license: BSD/MIT
  - library: "tiptap (+ @mention, slash)"
    bridge_surface: Memory/notes, Initiative descriptions — links into the graph
    license: MIT core (some Pro ext. paid)
  - library: dnd-kit
    bridge_surface: Taskade-style touchpoint reparenting, kanban, builder
    license: MIT
  - library: vis-timeline
    bridge_surface: Person / Initiative timeline
    license: MIT + Apache-2.0
  - library: react-big-calendar
    bridge_surface: Calendar View — month/week/day/agenda render behind a CalendarView port (internalized fork)
    license: MIT
    note: ONLY proven all-free + forkable calendar; built-in resource columns = basic team lanes free. See ../wiki/calendar.md.
  - library: ical.js (mozilla-comm)
    bridge_surface: Calendar — RRULE recurrence expansion + ICS/vCard parse (RecurrenceEngine / IcsCodec ports)
    license: MPL-2.0
  - library: ical-generator
    bridge_surface: Calendar — emit subscribable .ics feed
    license: MIT
  - library: luxon
    bridge_surface: Calendar — pinned timezone lib bound to the calendar localizer
    license: MIT
  - library: qrcode
    bridge_surface: Digital Card QR
    license: MIT
```

> At 30K nodes, ensure G6 runs in **WebGL** mode; evaluate `sigma.js`+`graphology` if perf is tight.

## AI runtime & background jobs
```yaml
ai_runtime:
  - concern: Agent runtime
    pick: BUILD thin custom runtime (the moat); model on Agno scope schema + LangGraph interrupt()/checkpoint (the approve/veto/edit gate) on a Postgres saver
    note: Confirmed by OSS research — don't adopt a framework as infra.
  - concern: Automation execution Engine
    pick: Hatchet (MIT, Postgres-native) candidate, behind the AutomationExecutor interface
    note: Validate vs RLS. Temporal deferred.
  - concern: Job queue
    pick: BullMQ (Redis)
    note: Agent tasks, nightly signal/embedding recompute.
  - concern: Model provider
    pick: "ModelProvider seam: dev → Ollama (local, free); prod → user-configurable multi-provider (Claude default · OpenAI · Gemini · Bedrock · local)"
    note: Same swap discipline as AutomationExecutor; code never imports a provider directly. Local/in-tenant models = a trust feature (inference stays under the Organization's control).
  - concern: Model tiers
    pick: Logical tiers reasoning / default / cheap bound to concrete models per workspace
    note: Dev binds all to Ollama; prod defaults Opus 4.8 / Sonnet 4.6 / Haiku 4.5, overridable.
  - concern: LLM gateway
    pick: Vercel AI SDK (in-process, provider-agnostic, structured output + function calling) + optional LiteLLM proxy (prod routing/keys/budgets)
    note: Both permissive; Ollama provider for dev.
```

> **Embedding caveat:** the *chat* model is freely configurable, but the *embedding* model is **not** — `vector(N)` columns hardcode a dimension. Dev (Ollama `nomic-embed-text` = 768) and prod (OpenAI `3-small` = 1536) differ; switching requires re-embedding. **Decouple embeddings from the chat model and pin one canonical embedding dimension per deployment** (or namespace vectors per model) before Phase 3.

## License discipline (kept from the old plan)
- **Avoid AGPL** for embedded code: Plane, AppFlowy, NocoDB (fine to *learn from*, not to embed in a SaaS).
- **Avoid GPL:** Typesense — and unneeded: `pgvector` + `pg_trgm` cover semantic + fuzzy search.
- **Avoid commercial-locked:** AG Grid Enterprise, FullCalendar Scheduler (`glide-data-grid` replaces AG Grid).
- **Verify:** Mastra (was Elastic License — may have relicensed; OSS Automation checking).

## Changed from / dropped vs the old plan
- **Dropped:** single-user v1 / `DEFAULT_USER_ID` → multi-tenant workspace/team from day 0.
- **Changed:** single fixed model → a configurable **`ModelProvider`** abstraction (Ollama in dev; user-chosen providers in prod, Claude default). Logical task-tiers remain; concrete models are per-workspace config. Agent runtime = build thin (model on Agno + LangGraph), not a framework-as-infra.
