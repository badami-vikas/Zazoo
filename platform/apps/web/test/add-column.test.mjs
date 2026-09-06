/**
 * Adding a column, from the surface side (user report 2026-09-05: "why is add
 * column inactive in academics module, I should always be able to add columns
 * in all modules").
 *
 * Two halves. The id a typed label becomes is real logic — the server refuses
 * anything that is not a field name, so a derivation that emits one produces a
 * control that fails after the user has already typed. And the reason on the
 * disabled slot must come from the SERVER: `DataViews` used to carry one
 * hard-coded sentence saying no schema-mutation capability existed anywhere,
 * which stayed on screen after a Module Database could add a column (ADR-247).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { columnIdFromLabel } from "../src/app/dataviews/columnId.ts";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const DATAVIEWS = readFileSync(join(APP, "dataviews", "DataViews.tsx"), "utf8");
const MODULE_PAGE = readFileSync(join(APP, "pages", "ModulePage.tsx"), "utf8");

/** What the server's own Zod rule accepts. Kept here verbatim so this file
 * fails when the two drift, rather than at the user's keyboard. */
const SERVER_RULE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

test("a typed label becomes an id the server will accept", () => {
  for (const label of [
    "PO number",
    "Due date",
    "notes",
    "2026 target",
    "  spaced  out  ",
    "!!!",
    "Réf client",
    "a".repeat(200),
  ]) {
    const id = columnIdFromLabel(label, []);
    assert.match(id, SERVER_RULE, `"${label}" produced ${id}, which the server refuses`);
  }
});

test("the id reads like the name it came from", () => {
  assert.equal(columnIdFromLabel("PO number", []), "poNumber");
  assert.equal(columnIdFromLabel("Due date", []), "dueDate");
  assert.equal(columnIdFromLabel("Notes", []), "notes");
});

test("a name already taken gets its own id rather than a server conflict", () => {
  const existing = [{ id: "notes" }, { id: "notes2" }];
  assert.equal(columnIdFromLabel("Notes", existing), "notes3");
  assert.equal(columnIdFromLabel("Notes", []), "notes");
});

test("the Add column slot no longer claims there is no capability anywhere", () => {
  assert.ok(
    !DATAVIEWS.includes("this surface has no governed schema-mutation capability"),
    "the hard-coded refusal outlived the capability it described",
  );
  assert.match(
    DATAVIEWS,
    /addReason/,
    "the disabled reason is the server's `addReason`, not a sentence composed here",
  );
  assert.match(
    DATAVIEWS,
    /canAddColumn/,
    "and the slot is enabled only where the server said the row store can hold a column",
  );
});

test("the standard Module Page routes column commands to the governed capability", () => {
  assert.match(MODULE_PAGE, /columnSchema=\{columnSchema\}/, "the table is given the actions");
  for (const op of ["rename", "add", "setKind", "setLocked", "delete"]) {
    assert.ok(
      MODULE_PAGE.includes(`kind: "${op}"`),
      `${op} never reaches the server from a Module Page`,
    );
  }
  assert.match(MODULE_PAGE, /tableSchema\.undo/, "undo reaches the server too");
});
