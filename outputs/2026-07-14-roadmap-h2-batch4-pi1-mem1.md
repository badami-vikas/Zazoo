# 2026-07-14 — H2 roadmap Batch 4: PI-1 provenance tagging + MEM-1 Memory table

## Task scope
Continued autopilot execution of the H2-2026 roadmap (`docs/raw/roadmap-6month-2026-h2.md` §M3),
on branch `manishsbhoopalam8498-security-p0-hardening` → PR #10. This batch delivered Month-3's
prompt-injection-defense primitive (PI-1) and the Memory primitive (MEM-1).

## User requests addressed
- "execute the next set of things in the roadmap and corresponding plans"
- "create multiple subagents if required if we have anything independent in the plans and roadmap"
- Governance honored: batch NOT marked DONE without a user-approved `docs/APPROVALS.md` row (AP-013 PROPOSED).

## What was delivered

### PI-1 — Provenance / taint tagging (roadmap §M3)
An additive `TrustOrigin = 'operator' | 'user_content' | 'untrusted_external'` tag that rides every
ingested artifact from the ingestion edge through the ledger — the primitive every later injection
defense (PI-2/PI-3) will read.
- **`@bridge/core`**: `TrustOrigin` union + optional `trustOrigin?` on `ActionRequest`/`LedgerEntry`,
  `RunCtx.taint?`, threaded through `pipeline.ts` (`#appendLedger`, `decide` decision row,
  `#requestFromEntry`) so a proposal's origin persists on the ledger.
- **`@bridge/db`**: `ledger.trust_origin` column (migration `0009`) round-tripped in `ledger-store.ts`.
- **Ingestion edges tag their output**: sourcing connectors (`api-client`/`email-alert`) →
  `untrusted_external`; the one tool-kit intake seam (`createToolSourceSkill`) defaults
  `envelope.trustOrigin ?? "untrusted_external"` (untrusted-by-default); Gmail intake derives the tag
  by **reading the previously-dead `GOOGLE_MANIFEST.intake_policy.quarantine` flag** onto the Memory
  directive + proposal ledger request; sensors taint every capture-ledger record.
- **Tag-and-persist only — no behavior gating** (that is PI-2).

### MEM-1 — The Memory table (roadmap §M3)
Gave "learns how you work" a home — a thin `memories` table for confirmed/superseded facts with
authority-scoped retrieval.
- **`@bridge/core`**: `memory/memory-store.ts` — `MemoryStore` port (`write`/`supersede`/`get`/
  `retrieve`) + `InMemoryMemoryStore` + `memoryVisible()` predicate + types; classification reuses
  the canonical `ContextDataScope` set (`public|workspace|team|private|restricted`).
- **`@bridge/db`**: `memories` table (migration `0009`, RLS enabled+forced, 4 `same_workspace`
  policies reusing 0008's helper) + `DrizzleMemoryStore` that pushes the visibility predicate INTO
  SQL (authority-scoped at the store boundary, not post-filtered). Supersede = append a new row with
  `supersedesId`; `retrieve` excludes superseded rows by default.
- **`@bridge/sensors`**: `hub.ts` gained optional `memories?`/`userId?` deps and writes a derived
  private episodic Memory (referencing the timeline entry, tagged `untrusted_external`) on each
  capture — WITHOUT forking `timeline_entries`.
- **NOT wired into `apps/api`**: `SensorHub` is desktop-only and not constructed in apps/api, and no
  router consumes a Memory store yet, so wiring it there would be dead code. The sensors hub's
  optional `memories` dep is the seam the desktop shell will bind (ADR-062).

## Execution approach
Built the coupled core + db foundation sequentially myself (to avoid the PI-1↔MEM-1 file race), then
fanned the genuinely-independent per-package edges to **2 parallel subagents** (`pi1-gmail` =
integrations-google, `mem1-sensors` = sensors) per the user's parallelize-independent-work request;
did the sourcing + tool-kit edge directly in parallel. Each edge built + tested green independently.

## Verification
- Full `pnpm turbo run typecheck test build --force` → **59/59 tasks green**, all coverage floors pass.
- Per-edge: sourcing 7/7, tool-kit 9/9, integrations-google 22/22, sensors 7/7, db 53→57.
- Migration `0009` applies cleanly in pglite; `ledger.trust_origin` round-trips; memories
  authority-scoping / classification / tenant-isolation / supersede all verified.
- **DONE-WHEN evidence**: PI-1 — an ingested Gmail thread and a scraped-page/API row both land tagged
  `untrusted_external` end-to-end in tests. MEM-1 — a capture produces an inspectable, authority-scoped
  Memory entry, and retrieval respects classification, in tests.

## Artifacts
- PR: #10 (branch `manishsbhoopalam8498-security-p0-hardening`).
- Decisions: ADR-061 (PI-1), ADR-062 (MEM-1) — `docs/raw/decisions-log.md`.
- Governance ledger: `docs/APPROVALS.md` AP-013 (PROPOSED).
- Change ledger: `docs/log.md` (2026-07-14 Batch 4 entry).
- Migration: `platform/packages/db/migrations/0009_memory_and_taint.sql`.

## Open items for the user
- Approve (or revise) **AP-013** to mark Batch 4 DONE and tick its PROGRESS boxes. (AP-011 for Batch 2
  and AP-012 for Batch 3 also still await approval.)
- **PI-2** (tainted-context egress gating — deny `external:send` when the turn's context is tainted)
  and **PI-3** (dual-LLM quarantine + local `ContentGuard` port) are the natural next batch; they build
  directly on PI-1's tags.
- Persistent Mem0 `MemoryStore` adapter + a first Memory consumer (onboarding-profile → persona) are
  the MEM-1 follow-ups.
