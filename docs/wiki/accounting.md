# Accounting

Merge plan: [../raw/module-merge-accounting-d2c-2026-08-16.md](../raw/module-merge-accounting-d2c-2026-08-16.md) (ADR-246/248, AP-162/163, TASK-071/072/074)

- Avilo (a standalone bookkeeping app) ported in whole as the Accounting Module via `git subtree` merge — 35 donor commits, `git log --follow` still reaches pre-merge history. The donor repo itself is untouched, HEAD unmoved.
- Local Plane, but not PGlite like the rest of Bridge: `platform/modules/accounting` opens its own `better-sqlite3` file inside the host-granted `ModuleContext.dataDir` — the `module-host` contract was built for exactly this, so no kernel change was needed. Two embedded engines coexist and never meet.
- `router.ts`'s `accounting` namespace runs real queries against the imported Drizzle schema (`platform/modules/accounting/src/schema.ts`) — no fabricated rows, honest `0`-row empty states.
- First Module to carry a live-enforced Governance Section (TASK-072): seeded with Avilo's own AI posture from `module.yaml` (2 allow / 3 deny), read by `assertModuleGovernance` at the actual mutation call site (`accounting.overrides.create`) — deny wins, and a `"model"` actor hitting a seeded deny rule gets a `FORBIDDEN` quoting the rule's reason, not just a UI that says so.
- Out of scope by design: P&L formulas, PDF import, GST invoicing, the stock-costing engine — the exit test asked for a real running sqlite-backed surface, not feature parity with Avilo.
