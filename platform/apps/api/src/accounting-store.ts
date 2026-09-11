/**
 * The Accounting Module's own SQLite database (ADR-246/238).
 *
 * Deliberately NOT `@bridge/db` and NOT the PGlite Local Plane. The merge that
 * brought this Module in (ADR-230/AP-148) approved keeping it on its own
 * sqlite, unrewritten, so its 168 tests stay proof of the real thing rather
 * than proof of a port. A Module owns its own storage inside the host-granted
 * files root — this file is that grant, hand-rolled rather than through
 * `@bridge/module-host` (which nothing in this repo actually mounts; see
 * ADR-246 §"open items", "module-host was dead weight").
 *
 * `seedReferenceData` below is Avilo's own function, carried across verbatim
 * (not re-derived): it exists because "a fresh database is not a test" —
 * seeding used to skip any row that already existed, so a corrected formula
 * expression only ever reached a FRESH install, and every beta machine kept
 * the broken one. This is the upgrade path.
 */
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { schema, CANONICAL_ACCOUNTS, SEED_FORMULAS, BUILTIN_LABEL_MAPPINGS } from "@bridge/accounting";
import { accountingMigrationsDir } from "@bridge/accounting/migrations-dir";

import { openModuleSqlite } from "./module-sqlite.js";

export type AccountingDb = BetterSQLite3Database<typeof schema>;

/**
 * Seed *reference* data only: the canonical chart of accounts, the formula registry, and
 * the built-in QuickBooks label dialects.
 *
 * This is not demo data. No client, no fact, and no figure is created here — the
 * application starts empty and shows honest empty states (ADR-247).
 */
function seedReferenceData(db: AccountingDb): void {
  db.transaction((tx) => {
    for (const account of CANONICAL_ACCOUNTS) {
      tx.insert(schema.accounts)
        .values({
          id: account.id,
          label: account.label,
          statement: account.statement,
          role: account.role,
          unit: account.unit,
          description: account.description ?? null,
          sortOrder: account.sortOrder,
        })
        .onConflictDoNothing()
        .run();
    }

    /*
      Every expression this application has ever shipped for a formula, most recent last.

      A stored expression matching one of these is a definition the user inherited and
      never edited, so replacing it is a correction. Anything else is theirs. Append here
      whenever a seed expression changes — the list is the upgrade path.
    */
    const SUPERSEDED_EXPRESSIONS: Record<string, string[]> = {
      days_cash_on_hand: [
        "bs.cash / ((pl.cogs + pl.overhead) / 365)",
        "bs.cash / ((pl.cogs + pl.overhead) / 30)",
      ],
      dso: ["ar.total / pl.revenue * 30", "ar.total / pl.revenue * 365"],
      dpo: [
        "ap.total / ((pl.cogs + pl.overhead)) * 30",
        "ap.total / ((pl.cogs + pl.overhead)) * 365",
      ],
    };

    for (const formula of SEED_FORMULAS) {
      const existing = tx
        .select({
          id: schema.formulas.id,
          expression: schema.formulas.expression,
          version: schema.formulas.version,
        })
        .from(schema.formulas)
        .where(eq(schema.formulas.id, formula.id))
        .all();

      const current = existing[0];
      if (current) {
        const superseded = SUPERSEDED_EXPRESSIONS[formula.id] ?? [];
        const untouched = superseded.includes(current.expression.trim());
        if (current.expression.trim() === formula.expression.trim() || !untouched) continue;

        const nextVersion = current.version + 1;
        tx.update(schema.formulas)
          .set({
            expression: formula.expression,
            label: formula.label,
            description: formula.description,
            benchmark: formula.benchmark ? JSON.stringify(formula.benchmark) : null,
            unit: formula.unit,
            sortOrder: formula.sortOrder,
            version: nextVersion,
          })
          .where(eq(schema.formulas.id, formula.id))
          .run();

        tx.insert(schema.formulaVersions)
          .values({
            id: `${formula.id}@${nextVersion}`,
            formulaId: formula.id,
            version: nextVersion,
            expression: formula.expression,
            author: "system",
            note: "Corrected definition shipped with the application",
          })
          .onConflictDoNothing()
          .run();
        continue;
      }

      tx.insert(schema.formulas)
        .values({
          id: formula.id,
          label: formula.label,
          expression: formula.expression,
          unit: formula.unit,
          description: formula.description,
          benchmark: formula.benchmark ? JSON.stringify(formula.benchmark) : null,
          active: true,
          version: 1,
          sortOrder: formula.sortOrder,
        })
        .run();

      tx.insert(schema.formulaVersions)
        .values({
          id: `${formula.id}@1`,
          formulaId: formula.id,
          version: 1,
          expression: formula.expression,
          author: "system",
          note: "Initial definition",
        })
        .onConflictDoNothing()
        .run();
    }

    for (const mapping of BUILTIN_LABEL_MAPPINGS) {
      tx.insert(schema.labelMappings)
        .values({
          id: `builtin:${mapping.reportType}:${mapping.normalizedLabel}`,
          clientId: null,
          reportType: mapping.reportType,
          normalizedLabel: mapping.normalizedLabel,
          rawLabel: mapping.normalizedLabel,
          accountId: mapping.accountId,
          origin: "builtin",
          confidence: 1,
        })
        .onConflictDoNothing()
        .run();
    }
  });
}

const store = openModuleSqlite({
  name: "Accounting",
  envVar: "BRIDGE_ACCOUNTING_DB_PATH",
  migrate(raw) {
    const db = drizzle(raw, { schema });
    migrate(db, { migrationsFolder: accountingMigrationsDir() });
    seedReferenceData(db);
  },
});

export function getAccountingDb(): AccountingDb {
  return getAccountingConnection().db;
}

export function getAccountingConnection(): { db: AccountingDb; raw: Database.Database } {
  const raw = store.open();
  return { db: drizzle(raw, { schema }), raw };
}

/** Mirrors Avilo's own close: WAL leaves a `-wal` journal behind on an unclean exit. */
export function closeAccountingConnection(): void {
  store.close();
}
