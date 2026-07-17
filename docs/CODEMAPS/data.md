<!-- Updated: 2026-07-17 | Files scanned: platform/packages/db/src, migrations/, docs/raw/SCHEMA.sql | Token estimate: ~550 -->

# Data Codemap

Drizzle ORM + Supabase Postgres (pgvector, pg_trgm). `packages/db/src/schema.ts` is the live
source of truth; `docs/raw/SCHEMA.sql` is a design doc that has **drifted stale** (missing v1.1
recon/social columns — see known-issues).

## Migration state

```
migrations/meta/_journal.json   linear Drizzle high-water through 0014
migrations/0008_rls_as_code.sql FORCE-RLS + workspace/user policies
migrations/0011_same_cyclops.sql signed package/install persistence
migrations/0013_uneven_dragon_lord.sql singular Automation Agent ownership + Skill-name migration
migrations/0014_task007_...sql  Goal/Task/SkillManifest/child Agent Run persistence
```

Journal timestamps are strictly increasing. `0014` is after already-released `0013`, so both
fresh installs and databases already at the prior high-water mark receive orchestration DDL.
`drizzle-kit generate` reports no schema drift.

## Table groups (`schema.ts`)

```
Tenancy          workspaces, teams, integrations
Two-tier network people_canonical / communities_canonical (global, dedup_key nullable-unique)
                 people / communities (per-workspace mirror + overrides)
Governance       roles, role_permissions, permissions (effect=deny default),
                 agents, ephemeral_grants, delegations, ledger (append-only resolution spine)
Orchestration     goals, tasks, skill_manifests, child_agent_runs
Operational      touchpoints (parent_touchpoint_id/sort_order/depth — Taskade-style tree,
                 no traversal code yet), initiatives, files, timeline_entries
                 (⚠ NO index at all beyond PK — full scan for any workspace timeline query)
Registries       node_types (plane tag), edges (polymorphic src/dst, no FK/CHECK enforcement),
                 rituals, tools, skills, ritual_runs
Knowledge        embeddings (vector(768), pinned single-model — NO hnsw index, only a btree
                 lookup index; every similarity query is a full seq-scan), embedding_models
                 (registry with zero real consumer)
Events           events (workspace_id+created_at indexed), signals (read-only, +saved col)
```

## Known integrity gaps (see ../BUGS.md for verified detail)

- `dedup_key` nullable-unique on both canonical tables — NULL rows never dedupe.
- Polymorphic type+id pairs (edges, touchpoints.assignee, file_refs) have zero FK/CHECK.
- Enum-as-text remains common; security-sensitive orchestration states now have DB checks.
- No `updated_at` on most mutable tables; two competing soft-delete idioms (`archived_at` vs
  `status` text) with no documented rule for which table uses which.
- `recon_signals` jsonb column has a GIN index and zero code reading or writing it.

See also: [architecture.md](architecture.md), [../BUGS.md](../BUGS.md),
[../raw/SCHEMA.sql](../raw/SCHEMA.sql) (stale — treat schema.ts as authoritative).
