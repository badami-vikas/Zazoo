<!-- Nav map: "where does X live". Updated 2026-07-21 from docs/CODEMAPS/* + source scan. Token estimate: ~500. Keep ≤50 lines. -->

# Repo Navigation Map

One production codebase: `platform/` (pnpm + Turbo monorepo). Pre-cleanup legacy source is preserved only on the private archive ref recorded by TASK-013.

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
| Built-in Module manifests | `platform/modules/manifests` | `src/index.ts` |
| Composition root / DI wiring | `platform/apps/api` | `src/wiring.ts` (PILOT_* constants = single-tenant) |
| Identity / auth context | `platform/apps/api` | `src/identity.ts` |
| Drizzle schema (56 tables) | `platform/packages/db` | `src/schema.ts` · canonical DDL: `docs/raw/SCHEMA.sql` |
| DB-backed governance/ritual stores | `platform/packages/db` | `src/ritual-stores.ts` etc. |
| Local plane (OAuth tokens, raw bodies, derived T/M/S) | `platform/packages/local` | `src/ports.ts`, `src/stores/{memory,pglite}.ts` |
| Google integration (Gmail/Calendar) | `platform/packages/integrations-google` | intake + egress services |
| Model providers (Ollama/Claude/Groq seam) | `platform/packages/models` | `ModelProvider` port |
| Chat Panel / Chief of Staff | `platform/apps/web`, `platform/apps/api` | `components/shared/AgentPanel.tsx`, `router.ts` (`chiefOfStaff`) |
| Gated intake seam (manifest→quarantine→commit) | `platform/packages/capability-kit` | only DealPilot wired |
| Sourcing/dedupe/facts/tables shared engines | `platform/packages/{sourcing,dedupe,facts,tables}` | |
| DealPilot / JobPilot Modules | `platform/modules/{dealpilot,jobpilot}` | `src/index.ts`, `src/manifest.ts` |
| Accounting / D2C Modules (donor apps ported via subtree merge) | `platform/modules/{accounting,d2c}` | `accounting/src/schema.ts`, `d2c/src/{orders,inventory}.ts` |
| DevPilot Module (GitHub tracker + review/triage Skills, behind `BRIDGE_DEVPILOT`) | `platform/modules/devpilot` | `src/index.ts`, `src/domain.ts` |
| Sourcing/recording Engine packages | `platform/tools/*` | internal workspace packages pending physical vocabulary convergence |
| Web client (three-client Notion model) | `platform/apps/web` | `src/Layout.tsx` (ADR-023 shell) |
| Tauri desktop shell + capture core | `platform/apps/desktop` (Rust `sensor_bridge`) | CSP + capture stubs → BUGS.md |
| Mobile (Expo/RN, stranded on branch) | `platform/apps/mobile` | see memory: Node≥20, hoisted |
| Commons registry service | `platform/services/commons` (port 4780) | |
| Manish roadmap resume context | `docs/Progress from Manish/` | `README.md` → all subagents, paused worktrees, merge history |

Docs: start `docs/wiki/index.md` → raw only on need. **Canonical vocabulary: `docs/glossary.md`.** Active tasks: `docs/TASKS.md` · progress pointer/rules: `docs/PROGRESS.md` · Manish resume context: `docs/Progress from Manish/README.md` · historical progress archive: `docs/raw/progress-archive-2026-07.md` · vocabulary migration: `docs/raw/vocabulary-code-migration-plan-2026-07-14.md` · vocabulary inventory/guard: `docs/raw/vocabulary-code-inventory-2026-07-19.md` · BRDs: `docs/raw/brd-dealpilot-2026-07.md`, `docs/raw/brd-jobpilot-2026-07.md` · Agent/Skill orchestration: `docs/raw/agent-goal-skill-orchestration-plan-2026-07.md` · bug evidence: `docs/BUGS.md` · Accounting/D2C module merge plan: `docs/raw/module-merge-accounting-d2c-2026-08-16.md` · ADRs: `docs/raw/decisions-log.md` · flows/ER: `docs/CODEMAPS/flows.md` · harness research (Engine vs the field, per-primitive state + roadmap): `docs/harness/README.md`.
