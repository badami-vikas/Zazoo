/**
 * redFlag.* (TASK-010, docs/raw/ui-architecture-rules-2026-07.md §5d) — end to
 * end over the real `buildWiring()` composition root. Covers: the Human-
 * authored correction Memory is written directly (never through the Agent/
 * Skill pipeline), `create` ALSO starts a separate governed learning proposal
 * that always drafts (never auto-applies), clear/reopen is a reversible,
 * audited append-only chain that never erases the original evidence, and a
 * direct Human/Automation invocation of the governed learning Skill fails
 * closed exactly like every other AGS1-governed skill.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE, PILOT_USER, LEARNING_AGENT, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring, identity: { type: "user" | "team"; id: string } = { type: "user", id: PILOT_USER }) {
  return appRouter.createCaller({ wiring, run: makeRun(), identity, authenticated: true, verifying: false });
}

const ANCHOR = { moduleId: "job-pilot", recordId: "app-1", fieldId: "fit.summary" };

test("redFlag.create writes a Human-authored correction Memory (feedback/user_content) and starts a governed learning proposal that drafts", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { memory, proposal } = await caller.redFlag.create({
      workspaceId: PILOT_WORKSPACE,
      anchor: ANCHOR,
      renderedValue: "Strong fit for the role",
      reason: "The Candidate Master Profile does not support this",
    });

    // The correction Memory itself — Human-authored, never governed.
    assert.equal(memory.sourceRefType, "feedback");
    assert.equal(memory.trustOrigin, "user_content");
    assert.equal(memory.createdBy, PILOT_USER);
    const value = JSON.parse(memory.content);
    assert.equal(value.kind, "red_flag");
    assert.equal(value.status, "open");
    assert.equal(value.learningStatus, "proposed");
    assert.deepEqual(value.anchor, ANCHOR);

    // The SEPARATE governed step — always drafts (agent actor => pending_review),
    // never silently applies a preference/policy change.
    assert.equal(proposal.status, "pending_review");
    assert.equal(proposal.request.actor.id, LEARNING_AGENT);
    assert.equal(proposal.request.resourceType, "signal");
    assert.equal(proposal.request.skill, "learning.proposePreferenceAdjustment");
    const proposedOutput = proposal.output?.proposedOutput as { governed: boolean; applied: boolean; flagMemoryId: string };
    assert.equal(proposedOutput.governed, true);
    assert.equal(proposedOutput.applied, false);
    // The proposal cites the ORIGINAL flag row (before create()'s own internal
    // supersede to learningStatus:"proposed") — `memory.supersedesId` is that row.
    assert.equal(proposedOutput.flagMemoryId, memory.supersedesId);
  } finally {
    await wiring.close();
  }
});

test("redFlag: a direct Human invocation of the governed learning skill fails closed even with a valid goalTaskRef", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    // A real Goal/Task assigned to LEARNING_AGENT, from a genuine flag.
    await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, anchor: ANCHOR, renderedValue: "x" });
    const goals = await caller.agentOrchestration.goal.list({ workspaceId: PILOT_WORKSPACE });
    const goal = goals.find((g) => g.type === "platform.red_flag_learning");
    assert.ok(goal);
    const tasks = await caller.agentOrchestration.task.listByGoal({ workspaceId: PILOT_WORKSPACE, goalId: goal!.id });
    const task = tasks.at(-1);
    assert.ok(task);

    const proposal = await wiring.pipeline.propose(
      {
        workspaceId: PILOT_WORKSPACE,
        actor: { type: "user", id: PILOT_USER },
        action: "write",
        resourceType: "signal",
        inputs: { kind: "red_flag_correction_proposal" },
        skill: "learning.proposePreferenceAdjustment",
        goalTaskRef: { goalId: goal!.id, taskId: task!.id },
      },
      makeRun(),
    );
    assert.equal(proposal.status, "rejected");
    assert.match(proposal.rejectionReason ?? "", /may only be invoked by an eligible Agent Run/);
  } finally {
    await wiring.close();
  }
});

test("redFlag.clear/reopen is reversible and append-only — every prior row stays intact, never mutated or erased", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const auth = { workspaceId: PILOT_WORKSPACE, userId: wiring.pilotUserId };
    const created = await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, anchor: ANCHOR, renderedValue: "x" });

    // `create()` itself supersedes once internally (learningStatus none -> proposed),
    // so `created.memory` is already the SECOND row — its `supersedesId` points at
    // the very first ("none") row, which must still be readable, unchanged.
    const firstRowId = created.memory.supersedesId;
    assert.ok(firstRowId);
    const firstRow = await wiring.memoryStore.get(firstRowId!, auth);
    assert.ok(firstRow);
    assert.equal(JSON.parse(firstRow!.content).learningStatus, "none");
    assert.equal(JSON.parse(firstRow!.content).status, "open");

    const cleared = await caller.redFlag.clear({ workspaceId: PILOT_WORKSPACE, flagId: created.memory.id });
    assert.equal(JSON.parse(cleared.content).status, "cleared");
    assert.equal(cleared.supersedesId, created.memory.id);

    const reopened = await caller.redFlag.reopen({ workspaceId: PILOT_WORKSPACE, flagId: cleared.id });
    assert.equal(JSON.parse(reopened.content).status, "open");
    assert.equal(reopened.supersedesId, cleared.id);

    // The first-ever row is STILL there, unchanged, after two more corrections stacked on top.
    const stillThere = await wiring.memoryStore.get(firstRowId!, auth);
    assert.ok(stillThere);
    assert.equal(JSON.parse(stillThere!.content).learningStatus, "none");
  } finally {
    await wiring.close();
  }
});

test("redFlag.updateReason edits the reason without disturbing status/learningStatus", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const created = await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, anchor: ANCHOR, renderedValue: "x" });
    const updated = await caller.redFlag.updateReason({
      workspaceId: PILOT_WORKSPACE,
      flagId: created.memory.id,
      reason: "Corrected reason",
    });
    const value = JSON.parse(updated.content);
    assert.equal(value.reason, "Corrected reason");
    assert.equal(value.status, "open");
    assert.equal(value.learningStatus, "proposed");
  } finally {
    await wiring.close();
  }
});

test("redFlag.forget permanently deletes — distinct from the reversible clear", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const created = await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, anchor: ANCHOR, renderedValue: "x" });
    const result = await caller.redFlag.forget({ workspaceId: PILOT_WORKSPACE, flagId: created.memory.id });
    assert.equal(result.forgotten, true);
    const gone = await wiring.memoryStore.get(created.memory.id, { workspaceId: PILOT_WORKSPACE, userId: wiring.pilotUserId });
    assert.equal(gone, null);
  } finally {
    await wiring.close();
  }
});

test("redFlag.listForAnchor scopes to the exact anchor; listAll powers the audit/inspect surface", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const a = await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, anchor: ANCHOR, renderedValue: "x" });
    const otherAnchor = { moduleId: "job-pilot", recordId: "app-2", fieldId: "fit.summary" };
    const b = await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, anchor: otherAnchor, renderedValue: "y" });

    const forA = await caller.redFlag.listForAnchor({ workspaceId: PILOT_WORKSPACE, moduleId: ANCHOR.moduleId, recordId: ANCHOR.recordId, fieldId: ANCHOR.fieldId });
    assert.equal(forA.flags.length, 1);
    assert.equal(forA.flags[0]!.row.id, a.memory.id);

    await caller.redFlag.clear({ workspaceId: PILOT_WORKSPACE, flagId: b.memory.id });

    const allOpen = await caller.redFlag.listAll({ workspaceId: PILOT_WORKSPACE, status: "open" });
    assert.ok(allOpen.flags.some((f) => f.row.id === a.memory.id));
    assert.ok(!allOpen.flags.some((f) => f.value.anchor.recordId === "app-2" && f.value.status === "open"));

    const allCleared = await caller.redFlag.listAll({ workspaceId: PILOT_WORKSPACE, status: "cleared" });
    assert.ok(allCleared.flags.some((f) => f.value.anchor.recordId === "app-2"));
  } finally {
    await wiring.close();
  }
});

test("redFlag.create requires a concrete anchor target (recordId, fileId, or bulletPath)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      caller.redFlag.create({
        workspaceId: PILOT_WORKSPACE,
        anchor: { moduleId: "job-pilot" } as never,
        renderedValue: "x",
      }),
    );
  } finally {
    await wiring.close();
  }
});
