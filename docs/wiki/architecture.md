# Architecture

canonical terms: [../glossary.md](../glossary.md) · migration: [../raw/vocabulary-code-migration-plan-2026-07-14.md](../raw/vocabulary-code-migration-plan-2026-07-14.md) · full legacy audit: [../raw/ARCHITECTURE.md](../raw/ARCHITECTURE.md)

Platform = governed Engine/runtime + Module compiler + shared Record/Relation/Event model + thin web/desktop/mobile clients.

## Boundaries

- Local Plane: customer-controlled private residency + local inference.
- Plane Gate: only Local-to-network path; deny default; policy+audit every crossing.
- Cloud Plane: authorized hosted data/execution.
- Relationship Domain: People/Communities/Relations.
- Work Domain: Requests/Plans/Runs/Actions/Events/Results/Automations/Module Records.
- Commons: signed generalized-capability registry; no personal data.
- Bridge Cloud: identity/sync/billing/telemetry control services.

Domain ≠ Plane. Same Domain may contain Local and Cloud Records under policy. Commons/Bridge Cloud ≠ Cloud Plane aliases; they are services with narrower contracts.

## Shared mechanisms

- Graph: Records + one typed Relation fabric.
- Event log: append-only occurrences, residency-partitioned.
- Governed runtime: Request → Plan → Decision → Run → Action → Event → Result/File.
- Capability registry: Skills + Integrations; Agents and Automations invoke through Engine/runtime.
- Plane Gate + authority/policy: every mutation/egress.

## Relations

One Relation row = one semantic relation. It may contain many typed attributes, validity dates, confidence, provenance, and evidence refs. Several meanings between same Records = several Relation rows. Group/n-ary relationship = a Record/Event plus participant Relations.

## Failure routing

Engine recovers bounded runtime faults. Governance remediates policy/control failures. Learning finds patterns. Builder changes capabilities. Human decides ambiguity. One typed Failure Event routes owner/severity/retry/remediation.

## Current debt

Legacy code/schema/API names remain only where tracked migration evidence requires them. Runtime taint RT0–RT4 is DONE (TASK-015): v1 label lattice + required RuntimeValue envelope, monotonic joins, registered source/sink edges, fail-closed unknowns, immutable declassification, prompt-free replay, and migration `0029`.

2026-09-11 (ADR-281): API = `router-shared.ts` + `routers/<domain>.ts`; org guard is middleware. Still open: Module CRUD writes bypass the pipeline by decision (copy is honest); app-focus capture ledger in-memory (no durable impl); Automation scheduler tick not leased; hosted Local Plane is `/tmp`; Groq key mirrored plaintext to companion.json (BUGS 2026-09-11).
