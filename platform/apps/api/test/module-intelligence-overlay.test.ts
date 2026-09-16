/**
 * The intelligence overlay (TASK-114).
 *
 * User directive 2026-09-11: every intelligence entry is editable, and a
 * field that is not says why. These are the two halves that makes that true
 * rather than claimed — the write lands and every reader sees it, and a locked
 * field is refused by the SERVER with the reason the page shows.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MODULE_INTELLIGENCE_FIELDS, type ModuleIntelligenceKind } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";

const MODULE = "task-manager";

async function withCaller<T>(
  operation: (caller: ReturnType<typeof makeCaller>, wiring: Wiring) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "bridge-intelligence-overlay-"));
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

test("every locked field states a reason — a silent read-only is the defect", () => {
  for (const [kind, fields] of Object.entries(MODULE_INTELLIGENCE_FIELDS)) {
    assert.ok(fields.length > 0, `${kind} declares no fields`);
    const editable = fields.filter((field) => !field.lockedReason);
    assert.ok(editable.length > 0, `${kind} has nothing editable — editing is the default`);
    for (const field of fields) {
      if (field.lockedReason === undefined) continue;
      assert.ok(
        field.lockedReason.trim().length > 20,
        `${kind}.${field.field} is locked without a real reason`,
      );
    }
  }
});

test("with no overlay, get() reports the shipped declaration and userEdited false", async () => {
  await withCaller(async (caller) => {
    const view = await caller.moduleIntelligence.get({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
    });
    assert.equal(view.userEdited, false);
    assert.ok(view.entries.some((entry) => entry.kind === "agent"));
    assert.ok(view.entries.every((entry) => entry.edited === false));
  });
});

test("renaming an Agent lands, and modules.list serves the edited name", async () => {
  await withCaller(async (caller) => {
    const before = await caller.moduleIntelligence.get({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
    });
    const agent = before.entries.find((entry) => entry.kind === "agent");
    assert.ok(agent, "task-manager declares an Agent");

    const after = await caller.moduleIntelligence.set({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
      kind: "agent",
      entryId: agent.id,
      patch: { name: "Desk Sergeant" },
    });
    assert.equal(after.userEdited, true);
    const edited = after.entries.find((entry) => entry.id === agent.id);
    assert.equal(edited?.label, "Desk Sergeant");
    assert.equal(edited?.edited, true);

    // The point of resolving in modules.list: no surface still shows the
    // shipped name.
    const modules = await caller.modules.list({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    const installed = modules.items.find((item) => item.moduleName === MODULE);
    assert.equal(
      installed?.manifest.module?.agents.find((a) => a.id === agent.id)?.name,
      "Desk Sergeant",
    );
  });
});

test("a locked field is refused by the server, quoting the reason the page shows", async () => {
  await withCaller(async (caller) => {
    const view = await caller.moduleIntelligence.get({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
    });
    const agent = view.entries.find((entry) => entry.kind === "agent");
    assert.ok(agent);
    const locked = MODULE_INTELLIGENCE_FIELDS.agent.find((field) => field.field === "plane");
    assert.ok(locked?.lockedReason);

    await assert.rejects(
      caller.moduleIntelligence.set({
        organizationId: PILOT_ORGANIZATION,
        moduleName: MODULE,
        kind: "agent",
        entryId: agent.id,
        patch: { plane: "cloud" },
      }),
      (error: Error) => error.message.includes(locked.lockedReason!),
    );
  });
});

test("an Agent cannot be pointed at a Skill the Module never shipped", async () => {
  await withCaller(async (caller) => {
    const view = await caller.moduleIntelligence.get({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
    });
    const agent = view.entries.find((entry) => entry.kind === "agent");
    assert.ok(agent);
    await assert.rejects(
      caller.moduleIntelligence.set({
        organizationId: PILOT_ORGANIZATION,
        moduleName: MODULE,
        kind: "agent",
        entryId: agent.id,
        patch: { skillIds: ["not.a.skill.this.module.ships"] },
      }),
      /may only consume Skills this Module ships/,
    );
  });
});

test("reset puts the entry back to what its Module shipped", async () => {
  await withCaller(async (caller) => {
    const view = await caller.moduleIntelligence.get({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
    });
    const agent = view.entries.find((entry) => entry.kind === "agent");
    assert.ok(agent);
    const shipped = agent.label;

    await caller.moduleIntelligence.set({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
      kind: "agent",
      entryId: agent.id,
      patch: { name: "Temporary" },
    });
    const reset = await caller.moduleIntelligence.reset({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
      kind: "agent",
      entryId: agent.id,
    });
    assert.equal(reset.userEdited, false);
    assert.equal(reset.entries.find((entry) => entry.id === agent.id)?.label, shipped);
  });
});

test("an overlay for a Module nothing installed is refused rather than stored", async () => {
  await withCaller(async (caller) => {
    await assert.rejects(
      caller.moduleIntelligence.get({
        organizationId: PILOT_ORGANIZATION,
        moduleName: "no-such-module",
      }),
      /No installed Module named no-such-module/,
    );
  });
});

test("the editability table is served to the client, so no surface ships its own copy", async () => {
  await withCaller(async (caller) => {
    const table = await caller.moduleIntelligence.fields();
    for (const kind of table.kinds as ModuleIntelligenceKind[]) {
      assert.deepEqual(table.fields[kind], MODULE_INTELLIGENCE_FIELDS[kind]);
    }
  });
});

test("a cadence on an Automation with no schedule is refused, not silently stored", async () => {
  await withCaller(async (caller) => {
    const view = await caller.moduleIntelligence.get({
      organizationId: PILOT_ORGANIZATION,
      moduleName: MODULE,
    });
    // An Automation the Module gave no schedule: the scheduler reads
    // `schedule`, so an accepted cadence here would change nothing at all.
    const unscheduled = view.entries.find(
      (entry) =>
        entry.kind === "automation"
        && entry.fields.some((field) => field.field === "everyMinutes" && field.lockedReason),
    );
    assert.ok(unscheduled, "task-manager declares an Automation with no schedule");
    await assert.rejects(
      caller.moduleIntelligence.set({
        organizationId: PILOT_ORGANIZATION,
        moduleName: MODULE,
        kind: "automation",
        entryId: unscheduled.id,
        patch: { everyMinutes: 30 },
      }),
      /no schedule/,
    );
  });
});
