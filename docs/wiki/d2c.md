# D2C

Merge plan: [../raw/module-merge-accounting-d2c-2026-08-16.md](../raw/module-merge-accounting-d2c-2026-08-16.md) (ADR-246/248, AP-162/163, TASK-071/072/074)

- CV Naturals (a D2C-brand ops app) ported in as the D2C Module via `git subtree` merge (3 donor commits) — same donor-untouched, history-preserved shape as [accounting](accounting.md).
- Orders and Inventory are D2C's own toggle Pages (`platform/commons/d2c/src/{orders,inventory}.ts`); Research and Notes are `parent: d2c` sub-modules, not top-level nav items.
- CVN shipped its own WhatsApp integration; a byte-for-byte diff against Bridge's existing `@bridge/whatsapp` found all 16 files identical, so the clone was deduped rather than imported — `@bridge/whatsapp` serves D2C directly.
- Local Plane over its own `better-sqlite3` file (same `module-host`/`ModuleContext.dataDir` pattern as Accounting, not PGlite).
- D2C declares no `governance` block in its manifest — its Governance Section renders "Allowed 0 / Denied 0" with the honest "an empty policy is not a default-deny" copy, proving the Section renders present-not-absent even with nothing seeded.
