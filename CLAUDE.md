# Bridge - Project Instructions

Bridge is **Living Software**: one governed Engine adapts installed Modules around user work across
web, desktop, and mobile. Modules contain Databases, Pages, Views, Records, Relations, Skills,
Integrations, Agents, and Automations. Commons is a signed generalized-capability registry and never
stores personal data; Bridge Cloud is separate hosted control/sync infrastructure. Local Plane and
Cloud Plane are the only residency boundaries. Terms: [docs/glossary.md](docs/glossary.md).

## Work tiers - classify first

- **A - read-only:** explanations, status, narrow lookups, code questions. No repository edits. Use
  supplied context and targeted reads only. Do not read TASKS/log/BUGS by default, run tests, invoke
  agents, or write TASKS/output/log/ADR/approval files.
- **B - routine:** isolated code/docs change with no security, persistence, canon, deployment, or
  cross-surface impact. Every repository edit, including a test-only rename, is at least Tier B.
  Read [current tasks](docs/CODEMAPS/current-tasks.md), then only the matching task/wiki/code. Run the
  smallest targeted check and inspect direct callers/shared types. Update ledgers only when their
  represented state actually changes.
- **C - governed:** security/privacy/auth, schema/migration, production/deployment, canonical
  vocabulary/strategy, cross-plane, broad, or multi-surface work. Use the full governance,
  documentation, affected-neighbour, and live-verification rules below.

Uncertainty escalates B to C. Secret handling, Local/Cloud residency, governed execution, and explicit
user approval remain universal. Never weaken a safety boundary to save tokens.

## Context and docs

- This file is the only instruction authority. If the runtime already supplied it, do not read it
  again. `AGENTS.md` is only a stale-instruction guard.
- Navigation: [docs/INDEX.md](docs/INDEX.md); flows/schema:
  [docs/CODEMAPS/flows.md](docs/CODEMAPS/flows.md); summaries:
  [docs/wiki/index.md](docs/wiki/index.md). Read wiki -> raw -> code, escalating only when needed.
- [docs/TASKS.md](docs/TASKS.md) is the sole execution queue. Plans scope work; BUGS, requests, and
  APPROVALS preserve evidence/gates, never parallel task rows. Tier A skips it. Tier B/C read the
  compact task projection first and only targeted TASK IDs.
- `docs/wiki/` stays caveman-terse; invoke `caveman` when available. `docs/raw/` holds full depth.
  Every raw doc needs frontmatter: `title`, `type: raw`, `doc_kind`, `status`, `companions`,
  `related_wiki`, `updated`, `tags`. Requirement bodies are verbatim and never edited. Data-shaped
  raw docs use fenced YAML, not Markdown tables.
- Write `outputs/` only for Tier C decisions/audits/plans, an explicitly requested durable handoff, or
  a Tier B result that must outlive chat. Never store secrets, private payloads, hidden reasoning, raw
  tool output, or transient commentary. Changed raw docs require their wiki companion and log entry.
- Never default-load append-only ledgers. Search targeted sections. Batch independent reads, bound
  output/ranges, and do not reread files just edited. Regenerate codemaps only on structural change.
- Optimize **total** tokens: handle simple single-repo chains inline. Delegate only independent broad
  work whose context isolation exceeds agent startup cost; never duplicate delegated exploration.
- Keep Tier B orientation under ~2k documentation tokens and Tier C under ~4k. Any new always-loaded
  instruction or skill metadata is a reviewed recurring cost.

## Governance and engineering

- Non-trivial Tier C engineering decisions append rationale, rejected alternatives, and consequences
  to [docs/raw/decisions-log.md](docs/raw/decisions-log.md). Strategic one-liners also update
  `docs/wiki/decisions.md`.
- File abnormalities immediately in targeted `docs/BUGS.md` evidence and attach them to the matching
  TASK. A new TASK needs an independent outcome/test. Resolve evidence with date when fixed.
- User-reported bugs preserve the verbatim report and promote the matching task to P0 when blocking
  the prototype/current path. Same-surface scope may grow ~30% only when sharing the exit test.
- Tier B owns direct callers/shared types. Tier C owns callers, sibling adapters, pipeline/gates,
  persistence, and prototype surfaces. Fix in scope or record an honest blocker; narrow green checks
  cannot hide affected failures.
- Canon changes - locked wiki/requirements, TASK scope/order, plan status, phase completion, roadmap
  order, or ADR reversal - require [docs/APPROVALS.md](docs/APPROVALS.md). Current explicit user
  approval is recorded as APPLIED. Routine code/evidence updates do not need a row.
- Runtime surfaces use real connected data or honest empty states. Any unavoidable runtime or test
  dummy is tracked in [docs/dummy.md](docs/dummy.md) with reason, represented element, and removal
  condition.
- Evidence: a test proves nothing until seen failing unfixed; "zero results" != "nothing to do"; a
  live process is not proof the right UI rendered. `pnpm verify` is the one gate list; CI runs it.
  A fresh database is not a test - migration bugs hide behind fresh installs.
- **Encode knowledge as data** (ADR-247). Never fabricate a figure; "unknown" is first-class.
  Generated UI binds ids, never carries values. An author declares the levers it changes and is
  refused outside them. The server has the last word on what changed. "Already configured" is
  not a refusal.
- Before building a capability resembling an existing source, run reuse intake. Prefer lawful
  import/wrap/adapt. For restricted license/contract/patent/trademark/data/access, follow the
  [clean-room protocol](docs/raw/clean-room-capability-research-protocol-2026-07.md): preserve source
  terms/provenance, benchmark behavior, and author requirements independently. A restricted-source
  researcher does not implement the alternative. Never copy/lightly paraphrase/translate protected
  assets or bypass access/terms; ambiguous commercial cases stop for counsel/upstream permission.

## Product canon

- UI Page/nav/View work follows [UI architecture](docs/wiki/ui-architecture.md): data-shape surfaces,
  landing/related/Files Sections, standard Views including Form, shared menus, Control Panel in
  3-dots, and local files under `~/Documents/Bridge/<Organization>/<Module>/<Sub-module>/`.
- [docs/glossary.md](docs/glossary.md) governs copy, identifiers, APIs, schema, Events, payloads, and
  tests. Domain Record labels never become kernel primitives. Legacy names need a time-boxed
  [migration](docs/raw/vocabulary-code-migration-plan-2026-07-14.md) with deletion criteria.
- Every Module shows a **Governance Section** below Intelligence: `module.yaml` `allow`/`deny`,
  engine-read, user-editable. Accounting and D2C are Local-Plane sqlite (ADR-246/248).
- Every installed Module is clickable with manifest-driven detail. Skills stay under consuming
  Agents; only an attributable allowed Agent invokes them. Automations start Agent Runs. Relationship
  toggles are Signals/People/Communities; Signal is a participant-linked Event. Retained data is
  Module-associated Memory. Second Brain is cross-Module graph UI, not Engine vocabulary. Both side
  panels share expand/collapse/extend. Interactive-looking UI must perform/open/explain a governed
  action.
- Principles: adapt before asking; learn before acting; explain before automating; govern before
  executing; lasting value only; simple surface/powerful core; trust first; action over analytics.
  Every capture creates inspectable Memory, Avatar blink is the tell, and raw capture stays Local.

## Stack

TypeScript monorepo: React/Vite/tRPC/Fastify/Drizzle/Supabase; Tauri desktop and thin web/mobile
clients. Surface-agnostic kernel, optional desktop Sensor SPI, `ModelProvider`, local-first capture,
Engine ports, Hatchet/BullMQ, Mastra, and Mem0. Current work comes from the compact task projection.
