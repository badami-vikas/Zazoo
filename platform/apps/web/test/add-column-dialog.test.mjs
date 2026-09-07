/**
 * The Notion-style Add column dialog (TASK-112).
 *
 * User report, 2026-09-07: "Adding a column, just adds column, it doesnt ask me
 * for column type, column name, I want the interface of adding new columns
 * similar to notion. Also why am I still unable to add column in task manager
 * module?"
 *
 * Two halves, and both were true. The toolbar's Add column created a column
 * called "New column" of kind `text` and asked nothing; the column menu's own
 * "Add column left/right" asked for a NAME only. And Task Manager's Database
 * was outside the governed schema capability's reach entirely, so rename,
 * retype, lock and delete were dead there too.
 *
 * Source-conformance, in the shape of `ui-conformance.test.mjs`: these are
 * claims about the wiring, and the wiring is what regressed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const read = (...parts) => readFileSync(join(APP, ...parts), "utf8");
const readOrEmpty = (...parts) => {
  try {
    return read(...parts);
  } catch {
    return "";
  }
};

const DIALOG = readOrEmpty("components", "shared", "AddColumnDialog.tsx");
const MENU = read("components", "shared", "StandardColumnMenu.tsx");
const DATAVIEWS = read("dataviews", "DataViews.tsx");
const TYPES = read("dataviews", "types.ts");
const TASK_PAGE = read("pages", "TaskManagerPage.tsx");

test("the dialog asks for a name, a type, and the choices a choice type needs", () => {
  assert.match(DIALOG, /aria-label="Column name"/, "there is a name field");
  assert.match(DIALOG, /aria-label="Column type"/, "there is a type picker");
  assert.match(DIALOG, /CHOICE_KINDS/, "options are offered for the kinds that have them");
  assert.match(DIALOG, /aria-label="Add option"/, "an option can be added");
  assert.match(DIALOG, /aria-label=\{`Remove option /, "and removed");
});

test("nothing is created until the user confirms, and an unnamed column is refused with a reason", () => {
  // The confirm button is the ONLY path to onSubmit, and it is disabled with a
  // stated reason while the name is empty (ADR-001/§3a: visible and explained,
  // never a silently invented default).
  assert.match(DIALOG, /onSubmit/, "the dialog reports its result to its caller");
  assert.match(
    DIALOG,
    /Name this column/,
    "an empty name is refused with a stated reason rather than filled silently",
  );
  assert.ok(!/\bconfirm\(|\bprompt\(|\balert\(/.test(DIALOG), "Bridge's own Dialog, never the browser's");
});

test("both entry points open the same dialog", () => {
  assert.match(DATAVIEWS, /AddColumnDialog/, "the toolbar's Add column opens it");
  assert.match(MENU, /AddColumnDialog/, "the column menu's Add column left/right opens it too");
  assert.ok(
    !/columnIdFromLabel\("New column"/.test(DATAVIEWS),
    "the toolbar no longer invents a name and a kind without asking",
  );
});

test("the options the user typed reach the server's add op", () => {
  assert.match(DIALOG, /options/, "the dialog carries options");
  assert.match(
    TYPES,
    /options\?: string\[\]/,
    "and the surface's addColumn action accepts them",
  );
});

test("changing a column's type offers the same option editor", () => {
  assert.match(
    MENU,
    /ColumnOptionsEditor/,
    "retyping to a choice kind can name the choices, rather than producing a chooser over nothing",
  );
});

test("the server's Task spec and the Page's pre-load fallback name the same columns", () => {
  // The Page renders `tableSchema.get`'s spec the moment it arrives and its
  // own constant only before that. If the two drift, columns appear and then
  // vanish a beat later — so they are compared here rather than on screen.
  const SHARED = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "api", "src");
  const server = readFileSync(join(SHARED, "router-shared.ts"), "utf8");
  const block = server.slice(server.indexOf("export const TASK_MANAGER_TASKS_SPEC"));
  const serverIds = [...block.slice(0, block.indexOf("\n};")).matchAll(/\{ id: "([^"]+)"/g)].map(
    (match) => match[1],
  );
  const pageBlock = TASK_PAGE.slice(TASK_PAGE.indexOf("const TASK_SPEC"));
  const pageIds = [...pageBlock.slice(0, pageBlock.indexOf("\n};")).matchAll(/^\s+id: "([^"]+)"|^\s+\{ id: "([^"]+)"/gm)]
    .map((match) => match[1] ?? match[2])
    .filter((id) => id !== "task-manager.tasks");
  assert.deepEqual(serverIds, pageIds, "the two column lists drifted");
});

test("Task Manager routes its column commands to the governed capability", () => {
  assert.match(TASK_PAGE, /columnSchema=\{columnSchema\}/, "the table is given the actions");
  assert.match(TASK_PAGE, /tableSchema\.get/, "and the capability comes from the SERVER");
  for (const op of ["rename", "setKind", "setLocked", "delete"]) {
    assert.ok(TASK_PAGE.includes(`kind: "${op}"`), `${op} never reaches the server from Task Manager`);
  }
  assert.ok(
    !TASK_PAGE.includes('kind: "add"'),
    "adding stays refused here — a Task's rows are real sqlite columns",
  );
});
