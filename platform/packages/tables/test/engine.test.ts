import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilters, applySorts, groupBy } from "../src/engine.js";
import { createLocalStoragePort, createMemoryPort } from "../src/persistence-port.js";

test("applyFilters: AND (all) requires every active filter to pass", () => {
  const rows = [{ id: "1", company: "Acme", ring: "Inner" }, { id: "2", company: "Acme", ring: "Warm" }];
  const out = applyFilters(rows, [{ field: "company", op: "contains", value: "Acme" }, { field: "ring", op: "is", value: "Inner" }], "all");
  assert.deepEqual(out.map((r) => r.id), ["1"]);
});

test("applyFilters: OR (any) requires at least one active filter to pass", () => {
  const rows = [{ id: "1", ring: "Inner" }, { id: "2", ring: "Warm" }, { id: "3", ring: "Dormant" }];
  const out = applyFilters(rows, [{ field: "ring", op: "is", value: "Inner" }, { field: "ring", op: "is", value: "Warm" }], "any");
  assert.deepEqual(out.map((r) => r.id), ["1", "2"]);
});

test("applyFilters: empty-value filters are ignored (not yet configured, per DataEngine behavior)", () => {
  const rows = [{ id: "1" }, { id: "2" }];
  assert.equal(applyFilters(rows, [{ field: "company", op: "contains", value: "" }]).length, 2);
});

test("applySorts: multi-sort — primary then tie-break, Notion 'then by'", () => {
  const rows = [
    { id: "a", warmth: 50, name: "Zed" },
    { id: "b", warmth: 50, name: "Amy" },
    { id: "c", warmth: 90, name: "Mid" },
  ];
  const out = applySorts(rows, [{ id: "warmth", dir: "desc" }, { id: "name", dir: "asc" }]);
  assert.deepEqual(out.map((r) => r.id), ["c", "b", "a"]);
});

test("applySorts: no sorts is a no-op (identity)", () => {
  const rows = [{ id: "1" }, { id: "2" }];
  assert.deepEqual(applySorts(rows, []), rows);
});

test("groupBy: buckets by field value, 'No value' bucket sorts last", () => {
  const rows = [{ id: "1", ring: "Close" }, { id: "2", ring: "Extended" }, { id: "3" }];
  const groups = groupBy(rows, "ring");
  assert.deepEqual(groups.map(([key]) => key), ["Close", "Extended", "No value"]);
});

test("regression: 'add row' fix — a prepended row with no sort survives filter+sort unshifted at index 0 (2026-07-03 known-issue)", () => {
  // Reproduces the exact bug: a newly-added row used to render on the LAST page because it
  // was appended, not prepended. The engine itself must not reorder an unsorted prepended row.
  const base = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}` }));
  const withNewRow = [{ id: "new-1", name: "New connection" }, ...base];
  const sorted = applySorts(applyFilters(withNewRow, []), []); // no active sort/filter
  assert.equal(sorted[0]?.id, "new-1");
});

test("PersistencePort (localStorage adapter): round-trips, falls back on missing/corrupt data", () => {
  const backing = new Map<string, string>();
  const fakeStorage: Pick<Storage, "getItem" | "setItem"> = {
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => void backing.set(k, v),
  };
  const port = createLocalStoragePort(fakeStorage);
  assert.deepEqual(port.get("missing", { x: 1 }), { x: 1 });
  port.set("k", { rows: [1, 2, 3] });
  assert.deepEqual(port.get("k", {}), { rows: [1, 2, 3] });
  backing.set("corrupt", "{not json");
  assert.deepEqual(port.get("corrupt", "fallback"), "fallback");
});

test("PersistencePort (memory adapter): same contract, no browser required", () => {
  const port = createMemoryPort();
  assert.equal(port.get("x", 0), 0);
  port.set("x", 42);
  assert.equal(port.get("x", 0), 42);
});
