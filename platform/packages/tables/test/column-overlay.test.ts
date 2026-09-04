/**
 * The column overlay (TASK-084).
 *
 * A schema mutation on a Database whose columns ship with the application has to
 * live somewhere that is neither a migration nor a lie. The overlay is that
 * place: a per-Organization patch resolved OVER the shipped `TableSpec`, so the
 * base spec stays the Module author's and the user's edit is separable and
 * undoable.
 *
 * The cases below are the ones where a plausible implementation is silently
 * wrong — an overlay naming a column the spec does not have, and ORDER (a
 * removal must win over a rename, or a deleted column comes back wearing a new
 * label).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyColumnOverlay } from "../src/types.js";
import type { TableSpec } from "../src/types.js";

const SPEC: TableSpec = {
  id: "accounting.reports",
  columns: [
    { id: "label", label: "Metric", kind: "text" },
    { id: "unit", label: "Unit", kind: "text" },
    { id: "version", label: "Version", kind: "number" },
  ],
};

test("no overlay leaves the shipped spec exactly as the Module author wrote it", () => {
  assert.deepEqual(applyColumnOverlay(SPEC, null), SPEC);
  assert.deepEqual(applyColumnOverlay(SPEC, {}), SPEC);
});

test("a rename changes the label and nothing else", () => {
  const out = applyColumnOverlay(SPEC, { labels: { unit: "Denomination" } });
  assert.deepEqual(out.columns.map((c) => c.label), ["Metric", "Denomination", "Version"]);
  assert.deepEqual(out.columns.map((c) => c.id), ["label", "unit", "version"]);
  assert.equal(out.columns[1]?.kind, "text", "a rename must not change the kind");
});

test("the base spec is never mutated — the overlay is resolved, not applied in place", () => {
  applyColumnOverlay(SPEC, { labels: { unit: "Denomination" }, removed: ["version"] });
  assert.deepEqual(SPEC.columns.map((c) => c.label), ["Metric", "Unit", "Version"]);
  assert.equal(SPEC.columns.length, 3);
});

test("a removal wins over a rename of the same column", () => {
  // Otherwise a deleted column reappears wearing its new label.
  const out = applyColumnOverlay(SPEC, { labels: { version: "Rev" }, removed: ["version"] });
  assert.deepEqual(out.columns.map((c) => c.id), ["label", "unit"]);
});

test("an overlay naming a column the spec does not have is inert, never an invented column", () => {
  const out = applyColumnOverlay(SPEC, {
    labels: { ghost: "Ghost" },
    removed: ["ghost"],
    locked: ["ghost"],
    kinds: { ghost: "number" },
  });
  assert.deepEqual(out.columns.map((c) => c.id), ["label", "unit", "version"]);
});

test("lock and type-change are carried onto the column", () => {
  const out = applyColumnOverlay(SPEC, { locked: ["label"], kinds: { version: "text" } });
  assert.equal(out.columns[0]?.locked, true);
  assert.equal(out.columns[2]?.kind, "text");
});

test("unlocking is expressible — an overlay's absent lock does not leave a stale one", () => {
  const locked = applyColumnOverlay(SPEC, { locked: ["label"] });
  const unlocked = applyColumnOverlay(locked, { locked: [] });
  assert.equal(unlocked.columns[0]?.locked, false);
});
