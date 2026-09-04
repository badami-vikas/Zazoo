# Bridge - Project Instructions

Bridge is **Living Software**: one governed Engine adapts installed Modules around user work across
web, desktop, and mobile. Modules contain Databases, Pages, Views, Records, Relations, Skills,
Integrations, Agents, and Automations. Commons is a signed generalized-capability registry and never
stores personal data; Bridge Cloud is separate hosted control/sync infrastructure. Local Plane and
Cloud Plane are the only residency boundaries. Terms: [docs/glossary.md](docs/glossary.md).

## Governance facilitates work (AP-182)

Only critical governance blocks: secret leakage, an unauthorized external side effect, a residency
violation, or irreversible loss. Everything else is a flag that is recorded and can be overridden.

- **Routine work:** reads, questions, and isolated code/docs changes. Read
  [current tasks](docs/CODEMAPS/current-tasks.md), then only the matching task/wiki/code. Run the
  smallest targeted check and inspect direct callers/shared types. Update ledgers only when the state
  they represent changes; a read-only answer writes nothing.
- **Governed work:** security/privacy/auth, schema/migration, production/deployment, canonical
  vocabulary/strategy, cross-plane, broad, or multi-surface work. Use the full rules below.

Secret handling, Local/Cloud residency, governed execution, and user approval remain universal.
Never weaken a safety boundary to save tokens.

## Context and docs

- This file is the only instruction authority. If the runtime already supplied it, do not read it
  again. `AGENTS.md` is only a stale-instruction guard.
- Navigation: [docs/INDEX.md](docs/INDEX.md); flows/schema:
  [docs/CODEMAPS/flows.md](docs/CODEMAPS/flows.md); summaries:
  [docs/wiki/index.md](docs/wiki/index.md). Read wiki -> raw -> code, escalating only as needed.
- [docs/TASKS.md](docs/TASKS.md) is the sole execution queue. Plans scope work; BUGS, requests, and
  APPROVALS preserve evidence/gates, never parallel task rows. Create or reorder a TASK directly,
  citing the directive. Read the compact task projection first and only targeted TASK IDs.
- `docs/wiki/` stays caveman-terse; invoke `caveman` when available. `docs/raw/` holds full depth;
  frontmatter (`title`, `type: raw`, `doc_kind`, `status`, `updated`, `tags`) and a wiki companion
  are guidance, not gates. Requirement bodies are verbatim. Data-shaped raw docs use fenced YAML.
- Write `outputs/` only for governed decisions/audits/plans, a requested durable handoff, or a
  result that must outlive chat. Never store secrets, private payloads, hidden reasoning, raw tool
  output, or transient commentary.
- Never default-load the append-only ledgers (they are hundreds of KB); search targeted sections.
  Batch independent reads, never reread files just edited. Regenerate codemaps only on structural
  change. Any new always-loaded instruction or skill metadata is a reviewed recurring cost.
- Optimize **total** tokens: handle simple chains inline. Delegate only independent broad work whose
  context isolation exceeds agent startup cost; never duplicate delegated exploration.

## Governance and engineering

- Non-trivial governed decisions append rationale, rejected alternatives, and consequences to
  [docs/raw/decisions-log.md](docs/raw/decisions-log.md), cited by **date and title** (numbers are a
  convenience, never renumbered). Strategic one-liners also update `docs/wiki/decisions.md`.
- File abnormalities immediately as targeted `docs/BUGS.md` evidence attached to the matching TASK. A
  new TASK needs an independent outcome/test. Resolve evidence with date when fixed.
- User-reported bugs preserve the verbatim report and promote the matching task to P0 when blocking
  the prototype/current path. Same-surface scope may grow ~30% only when sharing the exit test.
- Routine work owns direct callers/shared types. Governed work owns callers, sibling adapters,
  pipeline/gates, persistence, and prototype surfaces. Fix in scope or record an honest blocker;
  narrow green checks cannot hide affected failures.
- **Build and wire in the same run.** Nothing is shipped until a real caller reaches it from the
  surface that needs it; otherwise record the gap in the TASK as NOT LANDED.
- Only irreversible or strategy-reversing changes - locked wiki/requirements, ADR reversal, a
  security/residency boundary, phase completion - need [docs/APPROVALS.md](docs/APPROVALS.md),
  recorded APPLIED when the user approved in-session. Everything else is done, then logged.
- Runtime surfaces use real connected data or honest empty states. Any unavoidable dummy is tracked
  in [docs/dummy.md](docs/dummy.md) with reason, represented element, and removal condition.
- Evidence: a test proves nothing until seen failing unfixed; "zero results" != "nothing to do"; a
  live process is not proof the right UI rendered; a fresh database hides migration bugs.
  `pnpm verify` is the one gate list; CI runs it.
- **Encode knowledge as data** (ADR-247). Never fabricate a figure; "unknown" is first-class.
  Generated UI binds ids, never values. An author declares the levers it changes and is refused
  outside them. The server has the last word on what changed. "Already configured" is not a refusal.
- Before building a capability resembling an existing source, run reuse intake. Prefer lawful
  import/wrap/adapt. For restricted license/contract/patent/trademark/data/access, follow the
  [clean-room protocol](docs/raw/clean-room-capability-research-protocol-2026-07.md): preserve source
  terms/provenance, benchmark behavior, author requirements independently, and keep a
  restricted-source researcher out of the implementation. Never copy/paraphrase/translate protected
  assets or bypass access/terms; ambiguous commercial cases stop for counsel/upstream permission.

## Product canon

- UI Page/nav/View work follows the [UI Rulebook](docs/raw/ui-rulebook.md), the single canon; local
  files sit under `~/Documents/Bridge/<Organization>/<Module>/<Sub-module>/`.
- [docs/glossary.md](docs/glossary.md) governs copy, identifiers, APIs, schema, Events, payloads, and
  tests. Domain Record labels never become kernel primitives. Legacy names need a time-boxed
  [migration](docs/raw/vocabulary-code-migration-plan-2026-07-14.md) with deletion criteria.
- Every Module shows a **Governance Section** below Intelligence: the manifest's `governance`
  `allow`/`deny` (`platform/modules/manifests`), engine-read, edited as an Organization overlay
  replacing it (ADR-263); an empty policy is not a default-deny. Accounting and D2C are Local-Plane
  sqlite (ADR-246/248).
- Every installed Module is clickable. Skills stay under consuming
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
