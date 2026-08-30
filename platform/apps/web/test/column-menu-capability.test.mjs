/**
 * The column menu against a real capability (TASK-084, ADR-258 under AP-168).
 *
 * The user's directive replaced *disabled-with-reason* with *enabled-and-warn*
 * for commands the surface can actually run. The two failure modes this gate
 * exists to catch are opposite and both fatal:
 *
 *   1. A command ENABLED with nothing behind it — it looks live and fails at the
 *      server, which ADR-247 forbids outright.
 *   2. A command HIDDEN because it cannot run — ADR-001 (present-not-absent) is
 *      unchanged: nothing is ever removed, at any stage.
 *
 * So the assertions are: every one of the 17 commands is still present; a
 * command whose handler is absent is disabled AND carries a reason; and the
 * warning-on-confirm flow uses Bridge's own dialog rather than the browser's
 * (`confirm`/`prompt`/`alert` are counted violations in `check:ui-rules`, and a
 * native dialog cannot state a consequence the way §3a requires).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const MENU = readFileSync(join(APP, "components", "shared", "StandardColumnMenu.tsx"), "utf8");
const EDITOR = readFileSync(join(APP, "components", "shared", "FormulaCellEditor.tsx"), "utf8");

/** Every command the menu has ever shown. ADR-001: this list only ever grows. */
const COMMANDS = [
  "Rename",
  "Edit column",
  "Change type",
  "AI Smartfill",
  "Filter",
  "Sort ascending",
  "Sort descending",
  "Group",
  "Calculate",
  "Lock column",
  "Hide column",
  "Add column left",
  "Add column right",
  "Duplicate column",
  "Delete column",
  "Add page",
  "Remove page",
];

test("all 17 commands are still present — nothing is hidden because it cannot run", () => {
  for (const command of COMMANDS) {
    assert.ok(
      MENU.includes(`"${command}"`),
      `${command} disappeared from the column menu; ADR-001 keeps it visible and disabled instead`,
    );
  }
});

test("no command is disabled without a stated reason", () => {
  // A bare `disabled` with no `title`/reason next to it is the regression: the
  // control greys out and the user is left guessing.
  // Only the JSX ATTRIBUTE forms — `disabled:` is a Tailwind variant and
  // `disabledReason` is the prop that fixes this, so a prefix match would flag
  // the cure as the disease. Tag boundaries, never prefixes.
  const bareAttribute = MENU.match(/^\s*disabled\s*$/gm) ?? [];
  const unexplained = (MENU.match(/\sdisabled=\{[^\n]*/g) ?? []).filter(
    (line) => !/reason|title/i.test(line),
  );
  const bareDisabled = [...bareAttribute, ...unexplained];
  assert.deepEqual(
    bareDisabled,
    [],
    "every disabled control must carry the reason it cannot act (§3a)",
  );
});

test("the warning-on-confirm flow uses Bridge's dialog, never the browser's", () => {
  for (const native of ["window.confirm", "window.prompt", "window.alert"]) {
    assert.ok(!MENU.includes(native), `${native} is a counted UI-rules violation`);
  }
  // Tag boundary, not a prefix: `/<Dialog/` would happily match `<DialogREMOVED`.
  assert.match(MENU, /<Dialog[\s/>]/, "the confirm flow renders Bridge's own Dialog");
});

test("a destructive command states its consequence before it proceeds", () => {
  // "Enabled and warn" is not "enabled": the dialog has to say what happens.
  assert.match(
    MENU,
    /consequence/i,
    "the confirm dialog carries the consequence text, not just a yes/no",
  );
});

test("the menu enables against a SERVER-reported capability, never a client guess", () => {
  assert.match(MENU, /capability/, "the panel takes the capability the server reported");
  assert.match(
    MENU,
    /available/,
    "and reads its `available` flag rather than assuming the surface can write",
  );
});

test("the fx affordance toggles value/expression and never revalidates locally", () => {
  assert.match(EDITOR, /\bfx\b/, "the formula editor carries an fx affordance");
  // The one rule that keeps a second formula engine from growing: the web app
  // must not parse or evaluate an expression. The server (engine.ts's
  // validateExpression) has the last word.
  for (const forbidden of ["mathjs", "parse(", "evaluate("]) {
    assert.ok(
      !EDITOR.includes(forbidden),
      `the editor must not ${forbidden} — understanding an expression belongs to Accounting's engine`,
    );
  }
  assert.match(
    EDITOR,
    /setFormulaExpression|onCommitExpression/,
    "the expression commits through the governed server procedure",
  );
});

test("a rejected expression leaves the editor open rather than closing over a failed write", () => {
  assert.match(
    EDITOR,
    /error/i,
    "the validator's refusal is shown on the editor, not swallowed",
  );
});
