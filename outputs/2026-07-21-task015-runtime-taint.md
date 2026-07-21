---
title: TASK-015 Runtime Taint RT0-RT4
date: 2026-07-21
task: TASK-015
status: done; landing in focused PR
---

# Outcome

RT0-RT4 are complete under AP-070/ADR-142.

- One browser-safe v1 `TaintLabel` lattice and opaque `RuntimeValue` envelope.
- Monotonic propagation through current model, Skill, pipeline, Automation, child Run, Ledger/Result, Memory, Event/Signal, File, Google, sensor, search/MCP, signed Commons, cache, queue, retry, and restart seams.
- Exhaustive server-owned source/sink registries. Unknown/malformed labels quarantine. Untrusted instruction-bearing content cannot reach authority-bearing sinks.
- ContentGuard isolation retained. Egress joins context. Validator/Human-only declassification is immutable.
- Migration `0029` backfills supported surfaces, preserves legacy labels explicitly, adds forced-RLS sink/declassification audit, and keeps Plane-partitioned Ledger refs opaque.
- Approval detail shows “Influenced by untrusted content” or unknown quarantine plus the inspectable source chain. Metrics/alerts/replay contain hashes and classifications, never prompts/private payloads.

# Proof

Targeted property, core/DB/RLS/migration, local, model, Google, net-guard, sensor, API, web-research/culture, restart, declassification, red-team, and UI tests pass. A real file-backed runtime A creates an untrusted proposal and sink trace; runtime B reopens the same directory and reads identical label/trace hashes. Ten hostile instruction retries produce zero Events/Actions. Unknown/malformed stored labels read as `UNKNOWN_LABEL`.

One bounded changed-scope review found nine substantive defects. All were fixed: pre-Skill sink enforcement, trace-before-auto ordering, Plane-routed durable audit, legacy unknown-axis quarantine, server-derived web labels, Automation step carry-forward, original-request model monotonicity, per-Ledger trace uniqueness, and accountable-Human-only declassification. Direct regressions pass.

Affected builds/typechecks, changed-file ESLint, vocabulary, no-runtime-dummy, exact desktop render, and CDP-emulated 375px render (`innerWidth=375`, `scrollWidth=375`) pass. GitHub Actions are payment-blocked; no CI success is claimed.

# Files

- [`platform/packages/core/src/taint.ts`](../platform/packages/core/src/taint.ts)
- [`platform/packages/db/migrations/0029_task015_runtime_taint.sql`](../platform/packages/db/migrations/0029_task015_runtime_taint.sql)
- [`platform/packages/db/src/taint-audit-store.ts`](../platform/packages/db/src/taint-audit-store.ts)
- [`platform/apps/web/src/app/pages/ApprovalsPage.tsx`](../platform/apps/web/src/app/pages/ApprovalsPage.tsx)
- [`docs/TASKS.md`](../docs/TASKS.md)
