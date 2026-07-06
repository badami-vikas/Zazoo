<!-- Generated: 2026-07-04 | Files scanned: platform/packages/db/src, migrations/, docs/raw/SCHEMA.sql | Token estimate: ~450 -->

# Data Codemap

Drizzle ORM + Supabase Postgres (pgvector, pg_trgm). `packages/db/src/schema.ts` is the live
source of truth; `docs/raw/SCHEMA.sql` is a design doc that has **drifted stale** (missing v1.1
recon/social columns — see known-issues).

## Migration state (fragile — see known-issues P0 batch)

```
migrations/meta/_journal.json   tracks ONLY 0000_amazing_betty_brant
migrations/0000_...sql          base schema (drizzle-tracked)
migrations/0001_governance_seed.sql   NOT in journal; agent-floor DENY block is a documented
                                       template, "not executed" — no DB-level backstop
migrations/001_add_recon_columns.sql NOT in journal; different numbering scheme entirely
```

`drizzle-kit migrate` on a fresh DB today applies only `0000` — governance seed + recon columns
silently missing. **RLS policies are not in any migration file at all** — applied out-of-band
directly to the live Supabase project. Fresh provision = zero RLS.

## Table groups (`schema.ts`)

```
Tenancy          workspaces, teams, integrations
Two-tier network people_canonical / communities_canonical (global, dedup_key nullable-unique)
                 people / communities (per-workspace mirror + overrides)
Governance       roles, role_permissions, permissions (effect=deny default),
                 agents, ephemeral_grants, delegations, ledger (append-only, __refLedgerId
                 jsonb hack for resolution linkage — no real column, no index)
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
- Enum-as-text everywhere, zod-guarded at the API only — direct DB writes have no guardrail.
- No `updated_at` on most mutable tables; two competing soft-delete idioms (`archived_at` vs
  `status` text) with no documented rule for which table uses which.
- `recon_signals` jsonb column has a GIN index and zero code reading or writing it.

See also: [architecture.md](architecture.md), [../BUGS.md](../BUGS.md),
[../raw/SCHEMA.sql](../raw/SCHEMA.sql) (stale — treat schema.ts as authoritative).
