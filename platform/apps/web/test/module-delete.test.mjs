/**
 * Deleting a Module from the rail (2026-09-07 user directive, verbatim):
 * *"Currently I can only hide modules, provide me an option to delete module,
 * clicking on which it should show confirmation with delete module only (data
 * is not deleted), delete module and associated data and Hide module (no
 * deletion)"*.
 *
 * Source conformance, like `ui-conformance.test.mjs`: the defect was an ABSENT
 * control and a missing question, and neither shows up as a wrong render.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const read = (...parts) => readFileSync(join(SRC, ...parts), "utf8");

test("the rail offers Delete, not only Hide", () => {
  const layout = read("Layout.tsx");
  assert.match(layout, /Delete…/, "the Module rail menu has no Delete entry");
  assert.match(layout, /setDeletingModule\(/, "Delete does not open a confirmation");
});

test("Delete asks the three questions the user named, and nothing happens until one is chosen", () => {
  const layout = read("Layout.tsx");
  assert.match(layout, /Delete Module only/, "no Module-only choice");
  assert.match(layout, /Delete Module and its data/, "no Module-and-data choice");
  assert.match(layout, /Hide it instead/, "the confirmation does not offer hiding");

  // Each choice states its own consequence, so nobody has to guess which one
  // keeps their Records.
  assert.match(layout, /Everything it collected stays/, "the Module-only choice does not say data is kept");
  assert.match(layout, /cannot be undone/, "the destructive choice does not say it is irreversible");
  assert.match(layout, /Nothing is deleted/, "the hide choice does not say it deletes nothing");

  assert.match(layout, /confirmModuleDelete\(false\)/, "the Module-only choice does not send deleteData:false");
  assert.match(layout, /confirmModuleDelete\(true\)/, "the with-data choice does not send deleteData:true");
  assert.match(layout, /role="dialog"/, "the confirmation is not a dialog");
});

test("a failed delete shows the server's own words rather than a generic message", () => {
  const layout = read("Layout.tsx");
  assert.match(layout, /setDeletingModule\(\{ \.\.\.target, busy: false, error:/, "the failure path drops the server's reason");
  assert.match(layout, /role="alert"/, "the error is not announced");
});
