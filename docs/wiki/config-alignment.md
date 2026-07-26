# Config vs Vision — what fights the platform

full: [../raw/config-vision-alignment-audit-2026-07.md](../raw/config-vision-alignment-audit-2026-07.md) · 2026-07-08.

Audits operating harness: instructions, hooks, skills, MCP, plugins. 2026-07-08 found global
Everything-Claude/superpowers noise. **TASK-025 fixed project scope 2026-07-26**: one compact
`CLAUDE.md`; tracked `.claude/settings.json`; 111 off-project skills + four noisy plugins off; no
vendored skill pack/path-policy duplicates; CI context budget.

**Top items working AGAINST the vision (ranked, each w/ fix):**
1. **Stale root `AGENTS.md` (worst)** — Claude Code auto-loads it alongside CLAUDE.md; it was pure
   pre-pivot ("CRM for VC/GP funds", "NEVER Deal", `dummy_`-prefix mandate) — the exact 3 rules the
   pivot REVERSES. **FIXED 2026-07-08**: body replaced with a pointer to CLAUDE.md.
2. **Supabase write-MCP against real-PII prod** (`execute_sql`/`apply_migration`/`deploy_edge_function`
   reachable) — contradicts draft-then-approve + manual-gated-prod-writes. Fix: read-only default,
   treat prod writes as External-band.
3. **superpowers mandate** — skill ceremony before any reply + TDD-first token burn.
   **FIXED 2026-07-26**: project plugin + mandate skills off; agents use relevant skills only for
   heavy work.
4. **Egress/CRM connectors** (Gmail/GCal/GDrive/apollo/hubspot/klaviyo) — local-first product built
   inside an outward-data-flow sales-CRM harness = privacy + vocab-drift conflict. Fix: de-scope for
   Bridge sessions.
5. **Ambient telemetry** (continuous-learning observe hook + ~7MB command/cost logs over real PII) —
   the exact anti-pattern of the product's own "raw capture local-plane only" contract. Fix: turn off
   observe hook, rotate/prune logs.
6. **~300 skills / ~90 agents of other-project noise** (pg-*, marketing, finance, legal, seo) — dilutes
   relevance; naming collisions on `superpowers`/`caveman` create real which-protocol ambiguity.

**Gap closed 2026-07-26**: minimal settings tracked. `CLAUDE.md` sole authority. Tier A skips
tracker/ledger ceremony; Tier B bounded; security/canon/production stay full Tier C.
