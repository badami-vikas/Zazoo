# Stack (wiki)

full: [../raw/STACK.md](../raw/STACK.md)

Scale: 30k canonical / <100 hot → virtualize 30k surfaces, WebGL graph, E2EE cheap.

- **Core**: React18+Vite+TS+Tailwind4+shadcn · Fastify5+tRPC11+Drizzle · Supabase (pgvector+pg_trgm+RLS+Storage+Realtime) · ULID · Supabase Auth + workspace/team day 0.
- **UI libs** (permissive): glide-data-grid (30k dir), @xyflow (ritual builder), @antv/g6 WebGL (map), maplibre+deck.gl, tiptap (notes + @mention links), dnd-kit (Taskade reparent), vis-timeline, qrcode, **react-big-calendar (MIT, calendar render — behind `CalendarView` port) + ical.js (MPL-2.0, recurrence/ICS) + ical-generator (MIT, .ics feed) + Luxon (tz)** — see [calendar](calendar.md).
- **Runtime**: BUILD thin agent runtime (Agno scope + LangGraph interrupt/checkpoint). Hatchet (Postgres) ritual engine. BullMQ queue. `RitualExecutor` seam, Temporal deferred.
- **Models**: `ModelProvider` seam. dev=Ollama. prod=user-configurable (Claude default · OpenAI · Gemini · Bedrock · local). Tiers reasoning/default/cheap per workspace. Gateway: Vercel AI SDK (+ LiteLLM proxy prod). Local model = trust feature (inference in-tenant).
- **Embeddings**: model NOT freely swappable (`vector(N)` fixed dim) → pin one canonical embedding model/dim, decouple from chat model. dev Ollama (768) vs prod OpenAI (1536) differ → re-embed on switch.
- **API**: tRPC for app; add REST/OpenAPI later for MCP/external agents.
- **Avoid licenses**: AGPL/SSPL/BUSL/fair-code/commercial → see [oss](oss.md).
