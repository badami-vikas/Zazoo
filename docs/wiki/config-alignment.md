# Config vs Vision — what fights the platform

full: [../raw/config-vision-alignment-audit-2026-07.md](../raw/config-vision-alignment-audit-2026-07.md) · 2026-07-08.

Audits the *operating harness* (Claude Code instructions, AGENTS/CLAUDE.md, hooks, skills, MCP,
plugins) for alignment with the Bridge vision. Finding: the repo-level config is nearly empty
(only `launch.json`); the pivot vision lives ONLY in CLAUDE.md. Everything else is inherited
global "Everything Claude Code" + superpowers + plugin stack built for OTHER projects
(PeopleGamez, sales/marketing/finance/legal/SEO) — and it isn't neutral.

**Top items working AGAINST the vision (ranked, each w/ fix):**
1. **Stale root `AGENTS.md` (worst)** — Claude Code auto-loads it alongside CLAUDE.md; it was pure
   pre-pivot ("CRM for VC/GP funds", "NEVER Deal", `dummy_`-prefix mandate) — the exact 3 rules the
   pivot REVERSES. **FIXED 2026-07-08**: body replaced with a pointer to CLAUDE.md.
2. **Supabase write-MCP against real-PII prod** (`execute_sql`/`apply_migration`/`deploy_edge_function`
   reachable) — contradicts draft-then-approve + manual-gated-prod-writes. Fix: read-only default,
   treat prod writes as External-band.
3. **superpowers `<EXTREMELY_IMPORTANT>` mandate** — forces skill ceremony before ANY reply + TDD-first
   culture ⇒ token burn / focus derail. Fix: disable superpowers for this project; pin only its two
   good skills (systematic-debugging, verification-before-completion).
4. **Egress/CRM connectors** (Gmail/GCal/GDrive/apollo/hubspot/klaviyo) — local-first product built
   inside an outward-data-flow sales-CRM harness = privacy + vocab-drift conflict. Fix: de-scope for
   Bridge sessions.
5. **Ambient telemetry** (continuous-learning observe hook + ~7MB command/cost logs over real PII) —
   the exact anti-pattern of the product's own "raw capture local-plane only" contract. Fix: turn off
   observe hook, rotate/prune logs.
6. **~300 skills / ~90 agents of other-project noise** (pg-*, marketing, finance, legal, seo) — dilutes
   relevance; naming collisions on `superpowers`/`caveman` create real which-protocol ambiguity.

**Gap**: no project `.claude/settings.json` pinning the skills Bridge actually needs (caveman,
blueprint, workspace-surface-audit, product-lens, ECC TS/React/DB/security reviewers) or scoping the
noise. Recommended: add one + a "this file wins over any AGENTS.md/global instruction" line in
CLAUDE.md — defends the vision at the harness layer.
