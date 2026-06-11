# Bridge AI — Technology Stack (v1)

> Adapted from an earlier single-user plan, reconciled with locked decisions: multi-tenant from day 0, two-tier residency (canonical/platform vs relationship/local-E2EE), thin orchestration. Rows marked _provisional_ await the OSS agent-framework research (`wf_69e372a9-88b`).
> Companion: [ARCHITECTURE.md](./ARCHITECTURE.md) · [SCHEMA.sql](./SCHEMA.sql) · [ROADMAP.md](./ROADMAP.md)

## Scale assumption (drives every rendering + storage decision)
**Typical user: ~30,000 canonical connections, <100 high-interaction relationships.**
- Asymmetric by design → large/cheap **canonical** (platform) vs small/rich **relationship** (local/E2EE). This *is* the two-tier split.
- Virtualize every surface that touches the 30K. Graph view must use **WebGL** at this node count.
- De-risks Phase 6: client-side encrypted storage + search over **<100 rows** is trivial — no encrypted-vector-search-at-scale problem.
- The AI reasons over the ~100, never the 30K ("AI sees filtered context" as a performance fact).

## Core stack (adopted)
| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite 6 + TypeScript + Tailwind 4 + shadcn/ui + tRPC client |
| Backend | Fastify 5 + tRPC 11 + Drizzle ORM + Postgres (Supabase) |
| Database | Supabase: Postgres + **pgvector** + **pg_trgm** + **RLS** + Storage + Realtime |
| IDs | ULID (or UUIDv7) — time-sortable, good index locality |
| Auth / Tenancy | **Supabase Auth + workspace/team from day 0** (RLS deny-by-default = tenancy + CBAC enforcement). _Changed from single-user._ |
| Imports | Gmail + Google Calendar OAuth first; Granola/Fireflies/Slack later |

> **API note:** tRPC serves the app's own frontend. Add a thin **REST/OpenAPI** surface later for the API-first / MCP goal (external agents can't consume tRPC).

## UI libraries (adopted — all permissive: MIT/BSD/Apache-2.0)
| Library | Bridge surface | License |
|---|---|---|
| `@glideapps/glide-data-grid` | Network — 30K people directory, virtualized, inline edit | permissive |
| `@xyflow/react` (reactflow) | Rituals — n8n-style governed visual builder | MIT |
| `@antv/g6` (WebGL mode) | Relationship map — large read-only graph | MIT |
| `maplibre-gl` + `react-map-gl` + `deck.gl` | Map / Place view + heat overlay | BSD/MIT |
| `tiptap` (+ @mention, slash) | Memory/notes, Initiative descriptions — links into the graph | MIT core (some Pro ext. paid) |
| `dnd-kit` | Taskade-style touchpoint reparenting, kanban, builder | MIT |
| `vis-timeline` | Person / Initiative timeline | MIT + Apache-2.0 |
| `qrcode` | Digital Card QR | MIT |

> At 30K nodes, ensure G6 runs in **WebGL** mode; evaluate `sigma.js`+`graphology` if perf is tight.

## AI runtime & background jobs
| Concern | Pick | Note |
|---|---|---|
| Agent runtime | **BUILD thin custom runtime** (the moat); model on **Agno** scope schema + **LangGraph** `interrupt()`/checkpoint (the approve/veto/edit gate) on a Postgres saver | Confirmed by OSS research — don't adopt a framework as infra. |
| Ritual engine | **Hatchet** (MIT, Postgres-native) candidate, behind the `RitualExecutor` interface | Validate vs RLS. Temporal deferred. |
| Job queue | **BullMQ** (Redis) | Agent tasks, nightly signal/embedding recompute. |
| Model provider | **`ModelProvider` seam**: dev → **Ollama** (local, free); prod → **user-configurable multi-provider** (Claude default · OpenAI · Gemini · Bedrock · local) | Same swap discipline as `RitualExecutor`; code never imports a provider directly. Local/in-tenant models = a trust feature (inference stays under the fund's control). |
| Model tiers | Logical tiers **reasoning / default / cheap** bound to concrete models **per workspace** | Dev binds all to Ollama; prod defaults Opus 4.8 / Sonnet 4.6 / Haiku 4.5, overridable. |
| LLM gateway | **Vercel AI SDK** (in-process, provider-agnostic, structured output + tool-calling) + optional **LiteLLM proxy** (prod routing/keys/budgets) | Both permissive; Ollama provider for dev. |

> **Embedding caveat:** the *chat* model is freely configurable, but the *embedding* model is **not** — `vector(N)` columns hardcode a dimension. Dev (Ollama `nomic-embed-text` = 768) and prod (OpenAI `3-small` = 1536) differ; switching requires re-embedding. **Decouple embeddings from the chat model and pin one canonical embedding dimension per deployment** (or namespace vectors per model) before Phase 3.

## License discipline (kept from the old plan)
- **Avoid AGPL** for embedded code: Plane, AppFlowy, NocoDB (fine to *learn from*, not to embed in a SaaS).
- **Avoid GPL:** Typesense — and unneeded: `pgvector` + `pg_trgm` cover semantic + fuzzy search.
- **Avoid commercial-locked:** AG Grid Enterprise, FullCalendar Scheduler (`glide-data-grid` replaces AG Grid).
- **Verify:** Mastra (was Elastic License — may have relicensed; OSS workflow checking).

## Changed from / dropped vs the old plan
- **Dropped:** single-user v1 / `DEFAULT_USER_ID` → multi-tenant workspace/team from day 0.
- **Changed:** single fixed model → a configurable **`ModelProvider`** abstraction (Ollama in dev; user-chosen providers in prod, Claude default). Logical task-tiers remain; concrete models are per-workspace config. Agent runtime = build thin (model on Agno + LangGraph), not a framework-as-infra.
