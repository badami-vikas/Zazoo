/**
 * TASK-081 — the rail's per-Organization Module presentation.
 *
 * Hiding, renaming and reordering a Module in the rail are PRESENTATION.
 * Nothing here may uninstall a Module, change a permission or a plane, or
 * remove a Module from Intelligence/search (ADR-178: grouping is a
 * re-arrangement, never a filter). So this model returns every Module it was
 * given, flagged — the rail decides what to draw, and no other surface reads
 * this file.
 *
 * TASK-089 — the Organization admin surface is reached from the rail's
 * Organization control, the one slot ADR-180's closed left-nav scope grants
 * it. It is ONE Organization surface, never a per-Module page (ADR-224/261).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyRailPresentation,
  canHideModule,
  EMPTY_RAIL_PRESENTATION,
  loadRailPresentation,
  moveModuleInOrder,
  railPresentationKey,
  saveRailPresentation,
} from "../src/app/rail-module-presentation.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const read = (rel) => readFileSync(join(APP, rel), "utf8");

const mods = [
  { moduleName: "task-manager", displayName: "TaskManager" },
  { moduleName: "deal-pilot", displayName: "DealManager" },
  { moduleName: "d2c", displayName: "D2C" },
];

test("presentation returns EVERY Module, flagged — it never filters one away", () => {
  const out = applyRailPresentation(mods, { ...EMPTY_RAIL_PRESENTATION, hidden: ["d2c"] });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((m) => m.hidden), [false, false, true]);
});

test("a saved order wins; a Module the order has never seen lands at the end", () => {
  const out = applyRailPresentation(mods, {
    ...EMPTY_RAIL_PRESENTATION,
    order: ["d2c", "deal-pilot"],
  });
  assert.deepEqual(out.map((m) => m.moduleName), ["d2c", "deal-pilot", "task-manager"]);
});

test("unlisted Modules keep their incoming relative order", () => {
  const out = applyRailPresentation(mods, { ...EMPTY_RAIL_PRESENTATION, order: ["d2c"] });
  assert.deepEqual(out.map((m) => m.moduleName), ["d2c", "task-manager", "deal-pilot"]);
});

test("a rename replaces the display name and nothing else", () => {
  const out = applyRailPresentation(mods, {
    ...EMPTY_RAIL_PRESENTATION,
    names: { "deal-pilot": "Acquisitions" },
  });
  assert.equal(out[1].displayName, "Acquisitions");
  assert.equal(out[1].moduleName, "deal-pilot");
  assert.equal(out[0].displayName, "TaskManager");
});

test("a blank or whitespace rename is ignored rather than blanking the rail row", () => {
  const out = applyRailPresentation(mods, {
    ...EMPTY_RAIL_PRESENTATION,
    names: { "deal-pilot": "   " },
  });
  assert.equal(out[1].displayName, "DealManager");
});

test("moveModuleInOrder drops the moved name in at the target's position", () => {
  const names = ["a", "b", "c", "d"];
  assert.deepEqual(moveModuleInOrder(names, "d", "b"), ["a", "d", "b", "c"]);
  assert.deepEqual(moveModuleInOrder(names, "a", "c"), ["b", "c", "a", "d"]);
  assert.deepEqual(moveModuleInOrder(names, "a", "a"), names);
  assert.deepEqual(moveModuleInOrder(names, "a", "zzz"), names);
});

test("the last visible Module cannot be hidden — the rail can never empty itself", () => {
  assert.equal(canHideModule(mods, [], "d2c"), true);
  assert.equal(canHideModule(mods, ["d2c", "deal-pilot"], "task-manager"), false);
  assert.equal(canHideModule(mods, ["d2c"], "task-manager"), true);
});

test("the store is per Organization and a corrupt payload degrades to defaults", () => {
  assert.match(railPresentationKey("org-1"), /^bridge\.org-1\.rail\./);
  assert.notEqual(railPresentationKey("org-1"), railPresentationKey("org-2"));

  const backing = new Map();
  const storage = {
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => backing.set(k, v),
  };
  saveRailPresentation("k", { order: ["a"], hidden: ["b"], names: { a: "A" } }, storage);
  assert.deepEqual(loadRailPresentation("k", storage), {
    order: ["a"],
    hidden: ["b"],
    names: { a: "A" },
  });

  backing.set("k", "{not json");
  assert.deepEqual(loadRailPresentation("k", storage), EMPTY_RAIL_PRESENTATION);
  backing.set("k", JSON.stringify({ order: "nope", hidden: [1, "b"], names: { a: 3 } }));
  assert.deepEqual(loadRailPresentation("k", storage), { order: [], hidden: ["b"], names: {} });

  assert.deepEqual(
    loadRailPresentation("k", {
      getItem() {
        throw new Error("storage unavailable");
      },
      setItem() {},
    }),
    EMPTY_RAIL_PRESENTATION,
  );
});

test("the rail wires the context menu, the View options restore, and drag-reorder", () => {
  const layout = read("Layout.tsx");
  // The gesture that opens a table header's column menu, on a rail Module row.
  assert.ok(/onContextMenu=/.test(layout), "rail Module rows must open a context menu");
  assert.ok(/draggable/.test(layout), "rail Module rows must be drag-reorderable");
  assert.ok(/onDrop=/.test(layout), "a drop must commit the new order");
  assert.ok(/View options/.test(layout), "hidden Modules must be restorable from View options");
  assert.ok(/rail-module-presentation/.test(layout), "the rail must use the shared presentation model");
  // Hiding is rail presentation only — it must never reach an install path.
  assert.ok(!/modules\.uninstall|modules\.install\b/.test(layout));
});

test("the Organization admin surface hangs off the Organization control, not off a Module", () => {
  const layout = read("Layout.tsx");
  const routes = read("routes.tsx");
  assert.ok(/organization\/admin/.test(routes), "one Organization admin route must exist");
  assert.ok(/OrganizationAdminPage/.test(routes));
  // ADR-180 closed rail scope: the entry point is the Organization control at
  // the top of the rail, never a new rail nav entry of its own.
  assert.ok(/\/organization\/admin/.test(layout));
  assert.ok(
    /\/organization\/admin/.test(layout.slice(layout.indexOf("orgMenuOpen &&"))),
    "the link must live inside the Organization control's menu",
  );
  // ADR-224/261: Module Detail stays deleted.
  const page = readFileSync(join(APP, "pages", "OrganizationAdminPage.tsx"), "utf8");
  assert.ok(!/Module Detail/.test(page));
  assert.ok(/ModuleSurfaceLayout/.test(page));
  assert.ok(/<DataViews/.test(page));
});
