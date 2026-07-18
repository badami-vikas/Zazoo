<!-- Updated: 2026-07-18 | Files scanned: platform/packages/db/src/{schema,graph-store,ledger-store,relation-materialization-store}.ts, migrations/, docs/raw/SCHEMA.sql | Token estimate: ~650 -->

# Data Codemap

Drizzle ORM + Supabase Postgres (pgvector, pg_trgm). `packages/db/src/schema.ts` is the live
source of truth; `docs/raw/SCHEMA.sql` is a design doc that has **drifted stale** (missing v1.1
recon/social columns — see known-issues).

## Migration state

```
migrations/meta/_journal.json   linear Drizzle high-water through 0015
migrations/0008_rls_as_code.sql FORCE-RLS + workspace/user policies
migrations/0011_same_cyclops.sql signed package/install persistence
migrations/0013_uneven_dragon_lord.sql singular Automation Agent ownership + Skill-name migration
migrations/0014_task007_...sql  Goal/Task/SkillManifest/child Agent Run persistence
migrations/0015_task008_...sql  Relation evidence/owner/provenance + durable effect ledger
```

Journal timestamps are strictly increasing. `0015` follows released `0014`, so fresh installs
and upgrades receive the same Relation contract. It repairs legacy append sequences before
enforcing non-null and backfills only unambiguous, physically pre-0003 decision references.
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
Registries       node_types (Plane + owning Module), edges (polymorphic src/dst plus bounded
                 evidence, confidence, validity, owner, source Module, decision provenance),
                 relation_materialization_effects, rituals, tools, skills, ritual_runs
Knowledge        embeddings (vector(768), pinned single-model — NO hnsw index, only a btree
                 lookup index; every similarity query is a full seq-scan), embedding_models
                 (registry with zero real consumer)
Events           events (workspace_id+created_at indexed), signals (read-only, +saved col)
```

## Known integrity gaps (see ../BUGS.md for verified detail)

- `dedup_key` nullable-unique on both canonical tables — NULL rows never dedupe.
- Heterogeneous type+id pairs cannot use ordinary FKs. Relation writes fail closed through the
  node-type registry and access checks; touchpoint assignees and file refs retain the broader gap.
- Enum-as-text remains common; security-sensitive orchestration states now have DB checks.
- No `updated_at` on most mutable tables; two competing soft-delete idioms (`archived_at` vs
  `status` text) with no documented rule for which table uses which.
- `recon_signals` jsonb column has a GIN index and zero code reading or writing it.

See also: [architecture.md](architecture.md), [../BUGS.md](../BUGS.md),
[../raw/SCHEMA.sql](../raw/SCHEMA.sql) (stale — treat schema.ts as authoritative).
