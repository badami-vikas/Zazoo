import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTaskRestructure,
  applyApprovedTaskProjectionReconciliation,
  calibratedTaskChangeDecision,
  classifyTaskChangeBand,
  detectTaskProjectionDrift,
  draftTaskCreate,
  emitTasksMarkdown,
  evaluateTaskGuards,
  parseTasksMarkdown,
  planCompletedBaySweep,
  routeTaskByRequiredSkill,
  withOutcomeTarget,
  withTaskStatus,
  type CreateTaskRecordInput,
  type TaskRecord,
} from "../src/index.js";

const NOW = "2026-07-21T00:00:00.000Z";

function input(id: string, title: string, parentTaskId?: string): CreateTaskRecordInput {
  return {
    id,
    organizationId: "org-1",
    title,
    ownerType: "human",
    ownerId: "human-1",
    ...(parentTaskId ? { parentTaskId, exitTest: `verify ${title}` } : {}),
  };
}

function createTree(): TaskRecord[] {
  const root = draftTaskCreate({
    ...input("root", "Ship Task Manager"),
    isGoal: true,
    outcomes: [{ id: "o1", title: "Adoption", measure: "flows", target: "1", indicatorKind: "lagging" }],
    reviewCadence: "weekly",
  }, [], NOW, "p0").task;
  const child = draftTaskCreate(input("child", "Build queue", root.id), [root], NOW, "p1").task;
  const leaf = draftTaskCreate(input("leaf", "Verify tree", child.id), [root, child], NOW, "p2").task;
  return [root, child, leaf];
}

test("Task create produces a reviewable impact-fit proposal only for populated queues", () => {
  const [root] = createTree();
  const result = draftTaskCreate(input("next", "Add projection"), [root!], NOW, "impact-1");
  assert.equal(result.impactFitProposal?.kind, "impact_fit");
  assert.equal(result.impactFitProposal?.status, "pending_review");
});

test("promote, insert ancestor, and re-parent preserve identities and recompute paths atomically", () => {
  const original = createTree();
  const promoted = applyTaskRestructure(original, { kind: "promote", taskId: "leaf" }, NOW);
  assert.equal(promoted.find((task) => task.id === "leaf")?.path, "2");
  assert.equal(promoted.find((task) => task.id === "child")?.path, "1.1");
  const inserted = applyTaskRestructure(promoted, {
    kind: "insert_ancestor_above",
    taskId: "child",
    ancestor: { ...input("ancestor", "New branch"), isGoal: false },
  }, NOW);
  assert.equal(inserted.find((task) => task.id === "ancestor")?.path, "1.1");
  assert.equal(inserted.find((task) => task.id === "child")?.path, "1.1.1");
  const reparented = applyTaskRestructure(inserted, { kind: "re_parent", taskId: "leaf", parentTaskId: "ancestor" }, NOW);
  assert.equal(reparented.find((task) => task.id === "leaf")?.path, "1.1.2");
  assert.equal(new Set(reparented.map((task) => task.id)).size, reparented.length);
  assert.throws(
    () => applyTaskRestructure(reparented, { kind: "re_parent", taskId: "ancestor", parentTaskId: "child" }, NOW),
    /cycle/,
  );
  const reordered = applyTaskRestructure(createTree(), { kind: "reorder", taskId: "leaf", sortOrder: 1 }, NOW);
  assert.equal(reordered.find((task) => task.id === "leaf")?.sortOrder, 1);
  assert.ok(reordered.every((task) => task.path.split(".").length - 1 === task.level));
});

test("status honesty rejects in-progress without exit test and done without evidence", () => {
  const task = draftTaskCreate(input("task", "Leaf"), [], NOW, "p").task;
  task.isGoal = false;
  assert.throws(() => withTaskStatus(task, "in_progress", NOW), /exit test/);
  assert.throws(() => withTaskStatus({ ...task, exitTest: "proof" }, "done", NOW), /verification evidence/);
  const done = withTaskStatus({
    ...task,
    exitTest: "proof",
    verification: { verifiedAt: NOW, verifiedBy: "human-1", evidenceRefs: ["event:1"], result: "passed" },
  }, "done", NOW);
  const changed = withOutcomeTarget(
    { ...done, outcomes: [{ id: "o", title: "Target", measure: "count", target: "1", indicatorKind: "leading" }] },
    "o",
    "2",
    NOW,
  );
  assert.equal(changed.reopenProposal?.kind, "reopen");
});

test("required-Skill routing has no default and ambiguous cases require Human assignment", () => {
  const skill = [{ skillId: "build", permissions: ["record:write"], plane: "local" as const, dataScopes: ["all" as const] }];
  const agent = {
    id: "builder",
    active: true,
    allowedSkills: ["build"],
    capabilityScope: ["record:write"],
    plane: "local" as const,
    dataScope: "all" as const,
  };
  assert.deepEqual(routeTaskByRequiredSkill("build", [agent], skill), { kind: "assigned", agentId: "builder" });
  assert.equal(routeTaskByRequiredSkill("build", [agent, { ...agent, id: "strategist" }], skill).kind, "human_assignment_required");
  assert.equal(routeTaskByRequiredSkill("unknown", [agent], skill).kind, "human_assignment_required");
});

test("minor changes auto-apply only after Human calibration; significant and Agent cases never do", () => {
  const minor = classifyTaskChangeBand({ kind: "reschedule", deltaDays: 1 });
  assert.equal(calibratedTaskChangeDecision({ band: minor, approvals: 2, vetoes: 0, actorType: "human" }), "approval_required");
  assert.equal(calibratedTaskChangeDecision({ band: minor, approvals: 3, vetoes: 0, actorType: "human" }), "auto_apply");
  assert.equal(calibratedTaskChangeDecision({ band: "significant", approvals: 100, vetoes: 0, actorType: "human" }), "approval_required");
  assert.equal(calibratedTaskChangeDecision({ band: minor, approvals: 100, vetoes: 0, actorType: "agent" }), "approval_required");
});

test("tasks.md projection is deterministic and external drift becomes reconciliation", () => {
  const tree = createTree();
  const projection = emitTasksMarkdown(tree);
  assert.deepEqual(parseTasksMarkdown(projection.content).map((entry) => entry.id), ["root", "child", "leaf"]);
  assert.equal(detectTaskProjectionDrift(projection, projection.content, tree).drifted, false);
  const edited = projection.content.replace("Build queue", "Build governed queue");
  const drift = detectTaskProjectionDrift(projection, edited, tree);
  assert.equal(drift.drifted, true);
  assert.equal(drift.changes.find((entry) => entry.id === "child")?.title, "Build governed queue");
  const reconciled = applyApprovedTaskProjectionReconciliation(tree, edited, NOW);
  assert.equal(reconciled.find((task) => task.id === "child")?.title, "Build governed queue");
  assert.equal(reconciled.find((task) => task.id === "child")?.version, 2);
  assert.equal(reconciled.find((task) => task.id === "root"), tree.find((task) => task.id === "root"));
  assert.equal(reconciled.find((task) => task.id === "leaf"), tree.find((task) => task.id === "leaf"));
  assert.throws(
    () => applyApprovedTaskProjectionReconciliation(reconciled, edited, NOW),
    /version conflict/,
  );
  const promotedProjection = projection.content.replace("## 1.1.1 — Verify tree", "## 3 — Verify tree");
  const promoted = applyApprovedTaskProjectionReconciliation(tree, promotedProjection, NOW);
  assert.equal(promoted.find((task) => task.id === "leaf")?.parentTaskId, undefined);
  const secondRoot = draftTaskCreate(input("second-root", "Second root"), tree, NOW, "impact-2").task;
  const swappedProjection = emitTasksMarkdown([...tree, secondRoot]).content
    .replace("## 1 — Ship Task Manager", "## swap — Ship Task Manager")
    .replace("## 2 — Second root", "## 1 — Second root")
    .replace("## swap — Ship Task Manager", "## 2 — Ship Task Manager");
  const swapped = applyApprovedTaskProjectionReconciliation(
    [...tree, secondRoot],
    swappedProjection,
    NOW,
  );
  assert.equal(swapped.find((task) => task.id === "child")?.parentTaskId, secondRoot.id);
  assert.equal(swapped.find((task) => task.id === "child")?.version, 2);
  assert.throws(
    () => applyApprovedTaskProjectionReconciliation(
      tree,
      projection.content.replace("- Status: pending", "- Status: done"),
      NOW,
    ),
    /verification evidence/,
  );
  assert.throws(
    () => parseTasksMarkdown(projection.content.replace("- Status: pending", "- Status: invented")),
    /invalid projected status/,
  );
});

test("completed bay sweep deterministically combines cap and age eligibility", () => {
  const tree = createTree().map((task, index) => ({
    ...task,
    status: "done" as const,
    verification: {
      verifiedAt: NOW,
      verifiedBy: "human-1",
      evidenceRefs: [`event:${index}`],
      result: "passed" as const,
    },
    updatedAt: index === 0 ? "2026-07-01T00:00:00.000Z" : `2026-07-${19 + index}T00:00:00.000Z`,
  }));
  const plan = planCompletedBaySweep(tree, "2026-07-21T00:00:00.000Z", 2, 7);
  assert.deepEqual(plan.eligibleTaskIds, ["root"]);
  assert.equal(plan.expectedVersions["root"], 1);
});

test("guards surface WIP, unverified done, completed overflow, and goal cadence without silent mutation", () => {
  const [root, child, leaf] = createTree();
  const findings = evaluateTaskGuards([
    { ...root!, status: "in_progress" },
    { ...child!, status: "in_progress", ownerId: root!.ownerId },
    { ...leaf!, status: "done" },
  ], 0);
  assert.ok(findings.some((finding) => finding.kind === "wip_breach"));
  assert.ok(findings.some((finding) => finding.kind === "unverified_done"));
  assert.ok(findings.some((finding) => finding.kind === "completed_bay_overflow"));
  assert.ok(findings.some((finding) => finding.kind === "goal_review_due"));
});
