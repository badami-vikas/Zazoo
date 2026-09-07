/**
 * A HAND-WRITTEN surface's columns, through the governed schema capability
 * (TASK-112).
 *
 * User report, 2026-09-07: "why am I still unable to add column in task manager
 * module?" — and the true answer was worse than the question. `task-manager.
 * tasks` was neither one of the six hard-coded shipped specs nor a
 * manifest-declared Module Database, so `readTableSchemaCapability` answered
 * `available: false` for it and RENAME, RETYPE, LOCK and DELETE were dead there
 * too, not only adding.
 *
 * Reshaping needs no new storage — the overlay is per-Organization and rides
 * over the shipped spec — so the capability reaches it now. ADDING still does
 * not: a Task's row is a real sqlite row in `tasks`, and a new column would
 * have nowhere to put its values. That refusal is the server's, stated, and
 * asserted here.
 *
 * Runs on a MIGRATED Local Plane (`buildWiring({ localDir })`): the overlay is
 * persisted state, and an in-memory store would prove the rules and none of
 * the storage.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWiring, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";

const SPEC = "task-manager.tasks";

async function withLocalPlane(
  operation: (caller: ReturnType<typeof makeCaller>, wiring: Wiring) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bridge-handwritten-columns-"));
  const wiring = await buildWiring({ localDir: join(dir, "local") });
  try {
    await operation(makeCaller(wiring), wiring);
  } finally {
    await wiring.close?.();
    await rm(dir, { recursive: true, force: true });
  }
}

test("Task Manager's Database can be reshaped but cannot gain a column", async () => {
  await withLocalPlane(async (caller) => {
    const view = await caller.tableSchema.get({ organizationId: PILOT_ORGANIZATION, specId: SPEC });
    assert.equal(view.available, true, "rename/retype/lock/delete reach a hand-written surface");
    assert.equal(view.reason, null);
    assert.equal(view.spec?.id, SPEC);
    assert.ok(
      view.spec?.columns.some((column) => column.id === "title"),
      "the spec is the Task Database's own",
    );
    assert.equal(view.canAddColumn, false, "a Task's row is a real sqlite row");
    assert.match(
      String(view.addReason),
      /nowhere to put its values/,
      "and the server says why, in its own words",
    );
  });
});

test("a Task column renames through the overlay, and the id it is addressed by does not move", async () => {
  await withLocalPlane(async (caller) => {
    const saved = await caller.tableSchema.mutate({
      organizationId: PILOT_ORGANIZATION,
      specId: SPEC,
      op: { kind: "rename", columnId: "exitTest", label: "Proof" },
    });
    const column = saved.spec?.columns.find((entry) => entry.id === "exitTest");
    assert.equal(column?.label, "Proof");
    assert.ok(column, "the stored id is untouched — every reader still addresses `exitTest`");

    const reread = await caller.tableSchema.get({
      organizationId: PILOT_ORGANIZATION,
      specId: SPEC,
    });
    assert.equal(
      reread.spec?.columns.find((entry) => entry.id === "exitTest")?.label,
      "Proof",
      "and it survives the reload",
    );
  });
});

test("adding a column to Task Manager is refused with the server's stated reason", async () => {
  await withLocalPlane(async (caller) => {
    await assert.rejects(
      caller.tableSchema.mutate({
        organizationId: PILOT_ORGANIZATION,
        specId: SPEC,
        op: { kind: "add", columnId: "vibe", label: "Vibe", columnKind: "text" },
      }),
      /nowhere to put its values/,
    );
  });
});

test("retyping to a choice kind carries the choices it will offer", async () => {
  await withLocalPlane(async (caller) => {
    const saved = await caller.tableSchema.mutate({
      organizationId: PILOT_ORGANIZATION,
      specId: SPEC,
      op: {
        kind: "setKind",
        columnId: "estimate",
        columnKind: "select",
        options: ["S", "M", "L"],
      },
    });
    const column = saved.spec?.columns.find((entry) => entry.id === "estimate");
    assert.equal(column?.kind, "select");
    assert.deepEqual(
      column?.options,
      ["S", "M", "L"],
      "a retype to select without options would render a chooser over nothing (ADR-247)",
    );
  });
});

test("options on a kind that has none are refused rather than stored where nothing reads them", async () => {
  await withLocalPlane(async (caller) => {
    await assert.rejects(
      caller.tableSchema.mutate({
        organizationId: PILOT_ORGANIZATION,
        specId: SPEC,
        op: { kind: "setKind", columnId: "estimate", columnKind: "number", options: ["S"] },
      }),
      /no options to choose from/,
    );
  });
});
