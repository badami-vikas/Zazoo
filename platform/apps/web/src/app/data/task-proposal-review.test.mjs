/**
 * The planning review surface's logic (ADR-208).
 *
 * ADR-200 shipped the edit decision and every slice after it recorded the same
 * residual: no UI reached it. These assertions cover the part of that surface
 * that can be WRONG — which payload key holds the entries, which kinds refuse
 * an edit, and which fields a kind actually materializes from. Sending a field
 * the kind ignores is a 400 against a `.strict()` schema, and showing a field
 * it ignores invites an edit that is silently dropped.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  readPlanningProposal,
  toEditedPlanningItems,
  editWouldMaterialize,
} from "./task-proposal-review.ts";

test("a decomposition is read from its own payload key, with its own editable fields", () => {
  const review = readPlanningProposal({
    kind: "task_decomposition",
    children: [
      { title: "Draft the schema", exitTest: "Migration applies cleanly" },
      { title: "Wire the store" },
    ],
  });
  assert.equal(review.editable, true);
  assert.deepEqual(review.fields, ["title", "exitTest"]);
  assert.equal(review.entries.length, 2);
  assert.deepEqual(review.entries[0], {
    index: 0,
    title: "Draft the schema",
    exitTest: "Migration applies cleanly",
  });
});

test("a pre-mortem is readable but refuses an edit, with the reason the API would give", () => {
  // The one kind with nothing to edit must not be the one kind nobody can
  // see: the refusal is data, so approve/veto stay available.
  const review = readPlanningProposal({ kind: "premortem_scenario", scenarios: [{ title: "It ships late" }] });
  assert.equal(review.editable, false);
  assert.match(review.refusal, /writes nothing to the queue by design/);
  assert.deepEqual(review.entries, []);
});

test("a computed plan is readable and refuses an edit rather than offering one", () => {
  // `archive_sweep` and the restructures are plans over specific rows and
  // versions checked for staleness at decision time — an edited one is a
  // different unchecked plan, not a corrected draft (ADR-200).
  const review = readPlanningProposal({ kind: "archive_sweep", taskIds: ["a"] });
  assert.equal(review.editable, false);
  assert.match(review.refusal, /approved or vetoed rather than edited/);
});

test("a scan finding shows its proposed title and carries the Task it came from", () => {
  const review = readPlanningProposal({
    kind: "opportunity_scan",
    opportunities: [{ proposedTitle: "Chase the stalled renewal", taskId: "task-7" }],
  });
  assert.equal(review.entries[0].title, "Chase the stalled renewal", "the label is normalized for display");
  assert.equal(review.entries[0].taskId, "task-7");

  const wire = toEditedPlanningItems(review, review.entries);
  assert.deepEqual(wire, [{ proposedTitle: "Chase the stalled renewal", taskId: "task-7" }]);
});

test("an edit sends only the fields its kind materializes from", () => {
  // The wire schema is `.strict()`. A surface that posted every field it had
  // in state would 400 on kinds that do not use them.
  const review = readPlanningProposal({
    kind: "candidate_task_generation",
    candidates: [{ title: "Interview three users" }],
  });
  const wire = toEditedPlanningItems(review, [
    { index: 0, title: "Interview five users", exitTest: "ignored", measure: "ignored" },
  ]);
  assert.deepEqual(wire, [{ title: "Interview five users" }]);
});

test("an outcome missing its measure or target would materialize nothing", () => {
  // The Playbook exists to produce measurable outcomes. Approving an edit that
  // writes nothing is a veto wearing an approval's clothes (ADR-200), so the
  // surface can say so before sending it.
  const review = readPlanningProposal({
    kind: "goal_outcome_framing",
    outcomes: [{ title: "Faster onboarding", measure: "minutes", target: "10" }],
  });
  assert.equal(editWouldMaterialize(review, [{ index: 0, title: "Faster onboarding", measure: "minutes", target: "10" }]), true);
  assert.equal(editWouldMaterialize(review, [{ index: 0, title: "Faster onboarding" }]), false);
  assert.equal(editWouldMaterialize(review, []), false);
});

test("a Playbook scaffold is marked and carries its methodology, note and prompts", () => {
  // With no model configured the Skills return the Playbook's questions and
  // zero drafted items (ADR-197). A surface that rendered that as an empty
  // plan would let someone approve "nothing" believing it was the answer —
  // and a surface that dropped the note would turn "no model was configured"
  // into the much worse claim "the methodology found nothing".
  //
  // VERBATIM the payload `task-decomposition` returns in scaffold mode,
  // captured from a live Run. The first version of this test invented a
  // `questions` key; the real key is `prompts`, and reading the wrong one
  // silently rendered no methodology at all. Asserting against the shape the
  // Skill actually emits is the only version of this test that can fail for
  // the right reason.
  const review = readPlanningProposal({
    kind: "task_decomposition",
    note: "No model is configured on the Local Plane, so this Playbook returned its questions instead of a draft. Nothing below was generated.",
    runId: "286355de-54d5-5eaa-afdd-e51ebe9316c7",
    source: "playbook_scaffold",
    status: "proposed",
    prompts: [
      "Describe the finished state as though it already happened.",
      "What had to be true immediately before that?",
    ],
    children: [],
    parentPath: "4",
    playbookId: "backward-planning",
    methodology: "Work backward from the finished state to the first startable step",
    playbookVersion: "1.0.0",
  });
  assert.equal(review.scaffold, true);
  assert.deepEqual(review.entries, [], "a scaffold drafted nothing, and nothing is what it shows");
  assert.equal(review.prompts.length, 2);
  assert.equal(review.methodology, "Work backward from the finished state to the first startable step");
  assert.match(review.note, /No model is configured/);
});

test("the technique's prompts are shown alongside a real draft, not only in scaffold mode", () => {
  // `prompts` is always present (task-playbooks.ts): with a model they explain
  // HOW the draft was reached, which is the provenance the Playbook exists to
  // produce. A surface that only rendered them when the draft was empty would
  // hide the reasoning exactly when there is reasoning to show.
  const review = readPlanningProposal({
    kind: "task_decomposition",
    methodology: "Work backward from the finished state to the first startable step",
    prompts: ["Describe the finished state as though it already happened."],
    children: [{ title: "Draft the schema", exitTest: "Migration applies cleanly" }],
  });
  assert.equal(review.scaffold, false);
  assert.equal(review.prompts.length, 1);
  assert.equal(review.entries.length, 1);
});

test("a missing or empty payload is readable rather than a crash", () => {
  const review = readPlanningProposal(null);
  assert.equal(review.editable, false);
  assert.match(review.refusal, /no planning draft/);
});
