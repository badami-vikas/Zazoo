# Bridge AI — Project Instructions

Bridge AI = private relationship-intelligence OS for VC/GP funds. NOT a CRM, sales tool, or task manager. Full context: [docs/wiki/index.md](docs/wiki/index.md).

## Docs protocol (IMPORTANT)
- `docs/wiki/` = key takeaways, caveman-terse. `docs/raw/` = full depth.
- **Read `docs/wiki/` BY DEFAULT.** Reference `docs/raw/` ONLY on strong need / when wiki is insufficient.
- Start at [docs/wiki/index.md](docs/wiki/index.md). Locked calls: [docs/wiki/decisions.md](docs/wiki/decisions.md).
- **Draft/update wiki in CAVEMAN style** (invoke the `caveman` skill). Raw = normal prose.
- Wiki page exceeds 1000 lines → compact + summarize it.
- New/changed raw → update the matching wiki page + append [docs/log.md](docs/log.md).

## Working rules
- **Search for relevant skills BEFORE heavy actions.**
- Keep docs current; log changes in `docs/log.md`.
- **Vocabulary is the brand**: Person / Relationship / Memory / Community / Initiative / Ritual / Touchpoint / Signal. NEVER Lead / Deal / Pipeline / Contact.
- **Dummy data MUST be `dummy_`-prefixed**: every mock/demo/seed value (ids, names, sample fields, localStorage seeds) carries a `dummy_` prefix so it is greppable and never mistaken for real data. No silent fixtures.
- **Principles**: trust-first (private default, both-party consent) · governed agentic execution (explainable, permissioned, auditable, draft-then-approve) · ambient AI (user sees relationships, AI sees data) · action over analytics (every Signal → an action).

## Stack (see [docs/wiki/stack.md](docs/wiki/stack.md))
TS monorepo: React+Vite+tRPC+Fastify+Drizzle+Supabase (pgvector+pg_trgm+RLS). Models: `ModelProvider` seam (Ollama dev, configurable prod, Claude default). Runtime: thin custom (Agno + LangGraph patterns), Hatchet ritual engine, BullMQ. Defer Temporal behind `RitualExecutor`.

## Status
**Schema v2 pass pending** (see [docs/wiki/decisions.md](docs/wiki/decisions.md) punch-list): governance (roles / delegation / ephemeral grants / agent-floor DENY) · Taskade touchpoint hierarchy · signal read-only · node_types + plane tag · pin embedding dimension.
