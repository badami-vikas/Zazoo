<!-- Nav map: "where does X live". Generated 2026-07-09 from docs/CODEMAPS/* + source scan. Token estimate: ~500. Keep ≤50 lines. -->

# Repo Navigation Map

Two codebases: `platform/` (real backend, pnpm+turbo monorepo) · `Design Bridge AI Interface (Copy)/` (prototype UI). Standalone: `Tools/recon` (OSINT app), `Tools/recorder`.

| Thing | Lives in | Key file |
|---|---|---|
| Action pipeline (propose→decide→commit) | `platform/packages/core` | `src/pipeline.ts` |
| Authority resolver (roles/grants/delegation) | `platform/packages/core` | `src/authority.ts` |
| Agent-floor DENY list | `platform/packages/core` | `src/agent-floor.ts` (+2 copies: `agent-scope.ts`, api `integration-store.ts`) |
| Plane gate + data scopes | `platform/packages/core` | `src/authority.ts` (`planeGate`), `src/data-scope.ts` |
| Capability Trust Model (bands/approvals/budgets) | `platform/packages/core` | `src/capability/{types,approvals}.ts` |
| Ritual executor | `platform/packages/core` | `src/ritual-executor.ts` |
| Skill registry | `platform/packages/core` | `src/skills.ts` |
| Ports (registries, recorder, stores) | `platform/packages/core` | `src/ports.ts` |
| tRPC API (sole API surface) | `platform/apps/api` | `src/router.ts`, `src/server.ts` |
| Composition root / DI wiring | `platform/apps/api` | `src/wiring.ts` (PILOT_* constants = single-tenant) |
| Identity / auth context | `platform/apps/api` | `src/identity.ts` |
| Drizzle schema (56 tables) | `platform/packages/db` | `src/schema.ts` · canonical DDL: `docs/raw/SCHEMA.sql` |
| DB-backed governance/ritual stores | `platform/packages/db` | `src/ritual-stores.ts` etc. |
| Local plane (OAuth tokens, raw bodies, derived T/M/S) | `platform/packages/local` | `src/ports.ts`, `src/stores/{memory,pglite}.ts` |
| Google integration (Gmail/Calendar) | `platform/packages/integrations-google` | intake + egress services |
| Model providers (Ollama/Claude/Groq seam) | `platform/packages/models` | `ModelProvider` port |
| Tool intake seam (manifest→quarantine→commit) | `platform/packages/tool-kit` | only DealPilot wired |
| Sourcing/dedupe/facts/tables shared engines | `platform/packages/{sourcing,dedupe,facts,tables}` | |
| DealPilot / JobPilot / sourcing tools | `platform/tools/*` | |
| Web client (three-client Notion model) | `platform/apps/web` | `src/Layout.tsx` (ADR-023 shell) |
| Tauri desktop shell + capture core | `platform/apps/desktop` (Rust `sensor_bridge`) | CSP + capture stubs → BUGS.md |
| Mobile (Expo/RN, stranded on branch) | `platform/apps/mobile` | see memory: Node≥20, hoisted |
| Commons registry service | `platform/services/commons` (port 4780) | |
| Recon OSINT tool (outside monorepo) | `Tools/recon` | `EXPANSION.md` = its backlog |
| Prototype UI | `Design Bridge AI Interface (Copy)/` | localStorage-backed; PII — never publish |

Docs: start `docs/wiki/index.md` → raw only on need. **Canonical vocabulary: `docs/glossary.md`.** Work tracker: `docs/PROGRESS.md` · migration: `docs/raw/vocabulary-code-migration-plan-2026-07-14.md` · BRDs: `docs/raw/brd-dealpilot-2026-07.md`, `docs/raw/brd-jobpilot-2026-07.md` · bugs: `docs/BUGS.md` · ADRs: `docs/raw/decisions-log.md` · flows/ER: `docs/CODEMAPS/flows.md`.
