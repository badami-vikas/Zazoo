# TASK-013 repository and manifest cleanup

TASK-013 removes duplicate production sources and runtime fixture surfaces from main while preserving the exact pre-cleanup state at private archive ref `archive/task-013-pre-cleanup-2026-07-21` (`7f37e17e1132ebbbee74f1c612f0e83b211139ef`). Repository history was not rewritten, so legacy material remains in old commits and the private archive.

Built-in Module identity now has one source at [`platform/modules/manifests/src/index.ts`](../platform/modules/manifests/src/index.ts). API installation and Commons publication re-export it; DealPilot/JobPilot executable manifests derive their versions and routes from it; web routes, Home, Settings, and the New flow use manifest or installed-Module data rather than duplicate catalogs.

Superseded prototype-only pages, local fixture datasets, and standalone runtime entrypoints were deleted. Canonical Module, Relationship, DealPilot, JobPilot, Approvals, Task Manager, Graph, and Google surfaces remain connected to real APIs or honest empty/error states. Deterministic security, migration, RLS, cryptography, and provider-isolation fixtures remain tracked in [`docs/dummy.md`](../docs/dummy.md).

Evidence: [`docs/TASKS.md`](../docs/TASKS.md) · [`docs/APPROVALS.md`](../docs/APPROVALS.md) AP-061 · [`docs/raw/decisions-log.md`](../docs/raw/decisions-log.md) ADR-135 · [`docs/CODEMAPS/architecture.md`](../docs/CODEMAPS/architecture.md) · [`docs/CODEMAPS/frontend.md`](../docs/CODEMAPS/frontend.md).

GitHub Actions run `29806155556` failed all runner-backed jobs with zero steps and skipped installer aggregation, matching the repository's payment-blocked runner condition. No CI success is claimed.
