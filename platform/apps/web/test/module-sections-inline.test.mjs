/**
 * The Module Sections edit in place and stop explaining themselves
 * (user directive 2026-09-06: "Everything should be intuitive and inline and
 * dont draft definitions and explainers, only add them as tool tips where
 * necessary and relevant").
 *
 * Same shape as ui-conformance.test.mjs: the rule is a property of the source,
 * so a surface that drifts back to a mode toggle or a paragraph of definitions
 * fails `pnpm verify` rather than depending on anyone remembering the directive.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app");
const read = (rel) => readFileSync(join(APP, ...rel.split("/")), "utf8");
const SHARED = "components/shared";

test("no 'Manage in Module Detail' hop anywhere", () => {
  // /module/:name renders the SAME Intelligence and Governance Sections the
  // button sat in, so it led from a surface to itself. A control that goes
  // nowhere new is a control that needs explaining.
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.(?:ts|tsx)$/.test(entry.name) &&
        readFileSync(full, "utf8").includes("Manage in Module Detail")
      ) {
        offenders.push(entry.name);
      }
    }
  };
  walk(APP);
  assert.deepEqual(offenders, [], `still referencing Module Detail: ${offenders.join(", ")}`);
});

test("the Governance policy is edited inline, with no edit mode", () => {
  const src = read(`${SHARED}/ModuleGovernanceSection.tsx`);
  assert.doesNotMatch(src, /Edit policy/, "the policy is always editable — no Edit button");
  assert.doesNotMatch(src, /editing \?/, "no edit-mode branch: rules are fields, always");
  // Added, edited and removed in place…
  assert.match(src, /aria-label="Remove rule"/);
  assert.match(src, /onBlur=/, "an inline edit commits when the field is left");
  // …through the governed mutation, with the SERVER's answer rendered back
  // rather than the input echoed (ADR-247).
  assert.match(src, /trpc\.moduleGovernance\.set\.mutate/);
  assert.match(src, /setView\(await operation\)/);
  // A save that fails says so, and an unsaved edit is never shown as stored.
  assert.match(src, /setError\(String\(cause\)\)/);
  assert.match(src, /Not saved yet/);
});

test("explainers are tooltips on the control they concern, not standing prose", () => {
  const governance = read(`${SHARED}/ModuleGovernanceSection.tsx`);
  // Load-bearing: someone reading "Denied 0" must not conclude everything is
  // blocked. Kept — as a title on the tab that shows the count.
  assert.match(
    governance,
    /title="[^"]*not a default-deny[^"]*"/i,
    "the default-deny distinction stays, as a tooltip",
  );
  assert.doesNotMatch(governance, /No governance policy declared for this Module\. Nothing is denied/);

  const record = read(`${SHARED}/RecordSections.tsx`);
  assert.doesNotMatch(record, /nothing is written before then/i);
  assert.match(
    record,
    /title=\{recordId === null \? "Notes save once this Record is saved"/,
    "the Notes box itself says when it starts saving",
  );

  const intelligence = read(`${SHARED}/ModuleIntelligenceSection.tsx`);
  assert.doesNotMatch(intelligence, /attributable Agent bindings are declared/);
});
