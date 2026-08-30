/**
 * The governed schema-mutation capability (TASK-084).
 *
 * `StandardColumnMenu` shipped with 13 of its 17 items permanently disabled for
 * one reason: nothing behind them. This file is the half that was missing — a
 * per-Organization column overlay on the Local Plane, a dependency preview that
 * says what it did and did NOT inspect, and one level of undo.
 *
 * The cases below are the ones where a plausible implementation is silently
 * wrong: a capability that reports itself available for a table it does not
 * know (which would ship a menu that fails at the server — the exact thing
 * ADR-247 forbids), a preview that reports an empty list for a source it never
 * looked at, and a formula edit that commits before it validates.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { classifyPublicCloudProcedure } from "../src/deployment-boundary.js";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(84);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

async function withCaller<T>(
  operation: (caller: ReturnType<typeof makeCaller>, wiring: Wiring) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "bridge-table-schema-"));
  const prior = process.env.BRIDGE_ACCOUNTING_DB_PATH;
  process.env.BRIDGE_ACCOUNTING_DB_PATH = join(dir, "accounting.sqlite");
  const wiring = await buildWiring();
  try {
    return await operation(makeCaller(wiring), wiring);
  } finally {
    await wiring.close?.();
    if (prior === undefined) delete process.env.BRIDGE_ACCOUNTING_DB_PATH;
    else process.env.BRIDGE_ACCOUNTING_DB_PATH = prior;
    await rm(dir, { recursive: true, force: true });
  }
}

const REPORTS = "accounting.reports";

test("a table the server does not know reports the capability UNAVAILABLE with a reason", async () => {
  await withCaller(async (caller) => {
    const view = await caller.tableSchema.get({
      organizationId: PILOT_ORGANIZATION,
      specId: "jobpilot.applications",
    });
    // The whole dependency note of TASK-084: a menu item enabled against a
    // capability that is not there fails at the server. Absence is reported,
    // never guessed.
    assert.equal(view.available, false);
    assert.ok(view.reason && view.reason.length > 0, "an unavailable capability must say why");
    assert.equal(view.spec, null);
  });
});

test("a known table reports the capability available and serves the shipped spec", async () => {
  await withCaller(async (caller) => {
    const view = await caller.tableSchema.get({ organizationId: PILOT_ORGANIZATION, specId: REPORTS });
    assert.equal(view.available, true);
    assert.equal(view.reason, null);
    assert.equal(view.spec?.id, REPORTS);
    assert.equal(view.canUndo, false, "nothing has been done, so there is nothing to undo");
  });
});

test("a rename persists and survives a re-read", async () => {
  await withCaller(async (caller) => {
    const saved = await caller.tableSchema.mutate({
      organizationId: PILOT_ORGANIZATION,
      specId: REPORTS,
      op: { kind: "rename", columnId: "label", label: "Metric name" },
    });
    assert.equal(saved.spec?.columns.find((c) => c.id === "label")?.label, "Metric name");

    const reread = await caller.tableSchema.get({ organizationId: PILOT_ORGANIZATION, specId: REPORTS });
    assert.equal(reread.spec?.columns.find((c) => c.id === "label")?.label, "Metric name");
    assert.equal(reread.canUndo, true);
  });
});

test("renaming a column the table does not have is refused, not stored where nothing reads it", async () => {
  await withCaller(async (caller) => {
    await assert.rejects(
      () =>
        caller.tableSchema.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId: REPORTS,
          op: { kind: "rename", columnId: "no-such-column", label: "Ghost" },
        }),
      /no-such-column/,
    );
  });
});

test("delete removes the column and undo puts it back", async () => {
  await withCaller(async (caller) => {
    const before = await caller.tableSchema.get({ organizationId: PILOT_ORGANIZATION, specId: REPORTS });
    const deleted = await caller.tableSchema.mutate({
      organizationId: PILOT_ORGANIZATION,
      specId: REPORTS,
      op: { kind: "delete", columnId: "description" },
    });
    assert.ok(!deleted.spec?.columns.some((c) => c.id === "description"));

    const undone = await caller.tableSchema.undo({ organizationId: PILOT_ORGANIZATION, specId: REPORTS });
    assert.deepEqual(
      undone.spec?.columns.map((c) => c.id),
      before.spec?.columns.map((c) => c.id),
      "undo restores the column list the delete changed",
    );
    assert.equal(undone.canUndo, false, "undo is one level — it does not offer to undo itself");
  });
});

test("the dependency preview distinguishes 'nothing found' from 'never looked'", async () => {
  await withCaller(async (caller) => {
    const preview = await caller.tableSchema.preview({
      organizationId: PILOT_ORGANIZATION,
      specId: REPORTS,
      columnId: "unit",
    });
    for (const source of ["views", "automations", "skills", "formulas", "relations"] as const) {
      const report = preview[source];
      assert.ok(report, `${source} must be reported`);
      assert.ok(Array.isArray(report.items), `${source} must carry a list`);
      // An empty list from a source that was never inspected is the lie this
      // asserts against: every source states which of the two it is, and an
      // uninspected one must say why.
      if (!report.inspected) {
        assert.ok(report.note && report.note.length > 0, `${source} was not inspected and must say why`);
      }
    }
    // Automations and Skills record no column-level reference anywhere in their
    // contract, so their emptiness is NOT evidence of safety.
    assert.equal(preview.automations.inspected, false);
    assert.equal(preview.skills.inspected, false);
  });
});

test("the preview names the formulas that depend on the identifier being deleted", async () => {
  await withCaller(async (caller) => {
    // `gross_profit` is a seeded registry formula that `gross_margin_pct`
    // references. Deleting it must name the dependent, not shrug.
    const preview = await caller.tableSchema.preview({
      organizationId: PILOT_ORGANIZATION,
      specId: REPORTS,
      columnId: "gross_profit",
    });
    assert.equal(preview.formulas.inspected, true);
    assert.ok(
      preview.formulas.items.some((item) => item.includes("gross_margin_pct")),
      `expected gross_margin_pct among ${JSON.stringify(preview.formulas.items)}`,
    );
  });
});

test("a bad formula expression is rejected BEFORE it commits", async () => {
  await withCaller(async (caller) => {
    const before = await caller.accounting.reportsList({ organizationId: PILOT_ORGANIZATION });
    const original = before.items.find((f) => f.id === "gross_profit")?.expression;
    assert.ok(original);

    await assert.rejects(
      () =>
        caller.tableSchema.setFormulaExpression({
          organizationId: PILOT_ORGANIZATION,
          formulaId: "gross_profit",
          expression: "pl.revenue - nonsense.account",
        }),
      /nonsense\.account|unknown/i,
    );

    const after = await caller.accounting.reportsList({ organizationId: PILOT_ORGANIZATION });
    assert.equal(
      after.items.find((f) => f.id === "gross_profit")?.expression,
      original,
      "a refused edit must leave the stored expression untouched",
    );
  });
});

test("a self-referential expression is rejected as a cycle rather than stored", async () => {
  await withCaller(async (caller) => {
    await assert.rejects(
      () =>
        caller.tableSchema.setFormulaExpression({
          organizationId: PILOT_ORGANIZATION,
          formulaId: "gross_margin_pct",
          expression: "gross_margin_pct + 1",
        }),
      /cycle|circular/i,
    );
  });
});

test("a good expression commits and the dependent metric recomputes from it", async () => {
  await withCaller(async (caller) => {
    const saved = await caller.tableSchema.setFormulaExpression({
      organizationId: PILOT_ORGANIZATION,
      formulaId: "gross_profit",
      expression: "pl.revenue - pl.cogs - pl.overhead",
    });
    assert.deepEqual(saved.dependencies.sort(), ["pl.cogs", "pl.overhead", "pl.revenue"]);

    const after = await caller.accounting.reportsList({ organizationId: PILOT_ORGANIZATION });
    assert.equal(
      after.items.find((f) => f.id === "gross_profit")?.expression,
      "pl.revenue - pl.cogs - pl.overhead",
    );
    // The recompute is the engine's, and it is derived — never hand-maintained.
    assert.ok(
      saved.dependents.includes("gross_margin_pct"),
      "every metric downstream of the edit is named as recomputed",
    );
  });
});

test("an Agent cannot mutate a Database's schema or a global formula", async () => {
  await withCaller(async (_caller, wiring) => {
    const agent = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "agent", id: "agent-with-opinions-about-columns" },
      authenticated: true,
      verifying: false,
    });
    await assert.rejects(
      () =>
        agent.tableSchema.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId: REPORTS,
          op: { kind: "delete", columnId: "description" },
        }),
      /Human decision/,
    );
    await assert.rejects(
      () =>
        agent.tableSchema.setFormulaExpression({
          organizationId: PILOT_ORGANIZATION,
          formulaId: "gross_profit",
          expression: "pl.revenue",
        }),
      /Human decision/,
    );
  });
});

test("the schema-mutation surface is Local-Plane-classified, so the completeness gate stays green", () => {
  for (const path of [
    "tableSchema.get",
    "tableSchema.preview",
    "tableSchema.mutate",
    "tableSchema.undo",
    "tableSchema.setFormulaExpression",
  ]) {
    const verdict = classifyPublicCloudProcedure(path);
    assert.equal(verdict.kind, "local-only", `${path} must not be served from the public shell`);
  }
});
