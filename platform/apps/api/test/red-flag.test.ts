/**
 * redFlag.* (TASK-010, docs/raw/ui-architecture-rules-2026-07.md §5d) — end
 * to end over the real `buildWiring()` composition root, covering the
 * independent-review remediation (2026-07-17):
 *  1) auth/ownership — every procedure is authenticated+membership-gated;
 *     owner is ALWAYS the real caller identity, never a shared constant; a
 *     different authenticated member can never read/mutate someone else's
 *     flag (IDOR); `forget` rejects arbitrary/foreign/wrong-kind ids.
 *  2) ledger privacy — the governed proposal's ledger row never carries the
 *     flag's anchor/renderedValue/reason/rationale, only an opaque Memory
 *     reference + non-sensitive summary; clear/forget withdraw a still-
 *     pending proposal.
 *  3) saga/idempotency — a retried `create` (same operationId) converges
 *     instead of duplicating Memory/Task/proposal rows; a thrown/rejected
 *     governed step marks the flag `learningStatus: "failed"` (retryable)
 *     without losing the Human's own correction.
 *  4) single current lineage / CAS — a stale flagId is rejected with
 *     CONFLICT rather than forking history.
 *  5) canonical anchor identity — cell vs. bullet vs. file/result targets
 *     never collide even when some fields coincide.
 *  6) audit/history — listAll paginates server-side; history returns the
 *     full lineage including superseded versions.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
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

/** A second REAL, seeded workspace member — distinct from PILOT_USER — for
 * IDOR/cross-owner tests. */
async function inviteSecondMember(wiring: Wiring): Promise<string> {
  const caller = await makeCaller(wiring);
  const invited = await caller.workspace.inviteMember({ workspaceId: PILOT_WORKSPACE, email: `test_fixture_${Date.now()}@example.com` });
  return invited.userId;
}

const CELL_ANCHOR = { kind: "cell" as const, moduleId: "job-pilot", databaseId: "jobpilot.jobs", recordId: "app-1", fieldId: "fit.summary" };

test("redFlag.create writes a Human-authored correction Memory owned by the REAL caller (never a shared/pilot constant), and starts a governed proposal that always drafts", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({
      workspaceId: PILOT_WORKSPACE,
      operationId: "00000000-0000-4000-8000-000000000001",
      anchor: CELL_ANCHOR,
      renderedValue: "Strong fit for the role",
      reason: "The Candidate Master Profile does not support this",
    });

    assert.equal(memory.sourceRefType, "feedback");
    assert.equal(memory.trustOrigin, "user_content");
    assert.equal(memory.createdBy, PILOT_USER);
    assert.equal(memory.ownerUserId, PILOT_USER, "owner must be ctx.identity.id, never wiring.pilotUserId as a shared constant");
    const value = JSON.parse(memory.content);
    assert.equal(value.kind, "red_flag");
    assert.equal(value.status, "open");
    assert.equal(value.learningStatus, "proposed");
    assert.ok(value.proposalId, "the flag links to its governed proposal's ledger id");
    assert.deepEqual(value.anchor, CELL_ANCHOR);

    const proposalRow = await wiring.ledger.get(value.proposalId);
    assert.ok(proposalRow);
    assert.equal(proposalRow!.userDecision, null, "always drafts — pending_review, never auto-applied");
    assert.equal(proposalRow!.actorId, LEARNING_AGENT);
  } finally {
    await wiring.close();
  }
});

test("PRIVACY: the ledger's proposal row never carries the flag's anchor/renderedValue/reason — only an opaque Memory reference + generic summary", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({
      workspaceId: PILOT_WORKSPACE,
      operationId: "00000000-0000-4000-8000-000000000002",
      anchor: CELL_ANCHOR,
      renderedValue: "a very specific private correction detail",
      reason: "a very specific private reason nobody else should read",
    });
    const value = JSON.parse(memory.content);
    const proposalRow = await wiring.ledger.get(value.proposalId);
    assert.ok(proposalRow);
    const serializedLedgerRow = JSON.stringify(proposalRow);
    assert.doesNotMatch(serializedLedgerRow, /very specific private/);
    assert.doesNotMatch(serializedLedgerRow, /fit\.summary/);
    assert.doesNotMatch(serializedLedgerRow, /app-1/);
    const inputs = proposalRow!.inputs as Record<string, unknown>;
    assert.deepEqual(Object.keys(inputs).sort(), ["applied", "flagMemoryId", "governed", "kind", "summary"]);
  } finally {
    await wiring.close();
  }
});

test("IDOR: a DIFFERENT authenticated workspace member cannot read, clear, reopen, updateReason, or forget someone else's flag", async () => {
  const wiring = await buildWiring();
  try {
    const owner = await makeCaller(wiring);
    const otherUserId = await inviteSecondMember(wiring);
    const other = await makeCaller(wiring, { type: "user", id: otherUserId });

    const { memory } = await owner.redFlag.create({
      workspaceId: PILOT_WORKSPACE,
      operationId: "00000000-0000-4000-8000-000000000003",
      anchor: CELL_ANCHOR,
      renderedValue: "x",
    });

    await assert.rejects(() => other.redFlag.clear({ workspaceId: PILOT_WORKSPACE, flagId: memory.id }), (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    await assert.rejects(() => other.redFlag.reopen({ workspaceId: PILOT_WORKSPACE, flagId: memory.id }), (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    await assert.rejects(() => other.redFlag.updateReason({ workspaceId: PILOT_WORKSPACE, flagId: memory.id, reason: "hijacked" }), (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    await assert.rejects(() => other.redFlag.forget({ workspaceId: PILOT_WORKSPACE, flagId: memory.id }), (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    await assert.rejects(() => other.redFlag.history({ workspaceId: PILOT_WORKSPACE, flagId: memory.id }), (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");

    // Other's own listForScope/listAll must never surface the owner's private flag.
    const othersView = await other.redFlag.listForScope({ workspaceId: PILOT_WORKSPACE, moduleId: CELL_ANCHOR.moduleId, databaseId: CELL_ANCHOR.databaseId, recordId: CELL_ANCHOR.recordId });
    assert.equal(othersView.flags.length, 0);
    const othersAll = await other.redFlag.listAll({ workspaceId: PILOT_WORKSPACE });
    assert.equal(othersAll.flags.length, 0);

    // The flag is untouched by every rejected attempt.
    const stillOpen = await owner.redFlag.listForAnchor({ workspaceId: PILOT_WORKSPACE, anchor: CELL_ANCHOR });
    assert.equal(stillOpen.flags[0]?.value.status, "open");
    assert.equal(stillOpen.flags[0]?.value.reason, undefined);
  } finally {
    await wiring.close();
  }
});

test("unauthenticated and non-member callers are rejected on every redFlag procedure", async () => {
  const wiring = await buildWiring();
  try {
    const unauth = appRouter.createCaller({ wiring, run: makeRun(), identity: { type: "user", id: PILOT_USER }, authenticated: false, verifying: true });
    await assert.rejects(() => unauth.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-0000000000aa", anchor: CELL_ANCHOR, renderedValue: "x" }));
    await assert.rejects(() => unauth.redFlag.listAll({ workspaceId: PILOT_WORKSPACE }));

    const nonMember = await makeCaller(wiring, { type: "user", id: "11111111-1111-4111-8111-111111111111" });
    await assert.rejects(
      () => nonMember.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-0000000000bb", anchor: CELL_ANCHOR, renderedValue: "x" }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("forget rejects an arbitrary/foreign/wrong-kind Memory id instead of deleting it", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    // A real Memory that exists but is NOT a red flag (an onboarding preference).
    const foreign = await wiring.memoryStore.write({
      id: "22222222-0000-4000-8000-000000000001",
      workspaceId: PILOT_WORKSPACE,
      type: "preference",
      scope: "private",
      content: JSON.stringify({ kind: "onboarding_preference", figure: "x", admiredFor: "y" }),
      confidence: 1,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: PILOT_USER,
      ownerUserId: PILOT_USER,
    });
    await assert.rejects(() => caller.redFlag.forget({ workspaceId: PILOT_WORKSPACE, flagId: foreign.id }), (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    const stillThere = await wiring.memoryStore.get(foreign.id, { workspaceId: PILOT_WORKSPACE, userId: PILOT_USER });
    assert.ok(stillThere, "an unrelated Memory kind must never be deleted through redFlag.forget");

    await assert.rejects(() => caller.redFlag.forget({ workspaceId: PILOT_WORKSPACE, flagId: "99999999-0000-4000-8000-000000000099" }), (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
  } finally {
    await wiring.close();
  }
});

test("clear/forget withdraw a still-pending governed proposal so it can never later be approved", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({
      workspaceId: PILOT_WORKSPACE,
      operationId: "00000000-0000-4000-8000-000000000004",
      anchor: CELL_ANCHOR,
      renderedValue: "x",
    });
    const value = JSON.parse(memory.content);
    const beforeClear = await wiring.ledger.get(value.proposalId);
    assert.equal(beforeClear!.userDecision, null);

    const cleared = await caller.redFlag.clear({ workspaceId: PILOT_WORKSPACE, flagId: memory.id });

    const decision = await wiring.ledger.decisionFor(value.proposalId);
    assert.ok(decision, "clear must withdraw (veto) the still-pending proposal");
    assert.equal(decision!.userDecision, "veto");

    // Clearing again's withdrawal call must not throw even though the
    // proposal is now already resolved (AlreadyResolvedError is swallowed).
    const reopened = await caller.redFlag.reopen({ workspaceId: PILOT_WORKSPACE, flagId: cleared.id });
    await caller.redFlag.forget({ workspaceId: PILOT_WORKSPACE, flagId: reopened.id });
  } finally {
    await wiring.close();
  }
});

test("SAGA: a retried create (same operationId) converges — no duplicate Memory/Task/proposal", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const opId = "00000000-0000-4000-8000-000000000005";
    const first = await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: opId, anchor: CELL_ANCHOR, renderedValue: "x", reason: "r" });
    const second = await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: opId, anchor: CELL_ANCHOR, renderedValue: "x", reason: "r" });
    assert.equal(first.memory.id, second.memory.id);

    const allFlags = await caller.redFlag.listAll({ workspaceId: PILOT_WORKSPACE });
    assert.equal(allFlags.flags.length, 1, "retrying the same operationId must not create a second flag");

    const goals = await caller.agentOrchestration.goal.list({ workspaceId: PILOT_WORKSPACE });
    const goal = goals.find((g) => g.type === "platform.red_flag_learning");
    assert.ok(goal);
    const tasks = await caller.agentOrchestration.task.listByGoal({ workspaceId: PILOT_WORKSPACE, goalId: goal!.id });
    assert.equal(tasks.length, 1, "retrying the same operationId must not create a second governed Task");
  } finally {
    await wiring.close();
  }
});

test("SAGA: reusing an operationId with DIFFERENT content is rejected as a conflict, not silently accepted", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const opId = "00000000-0000-4000-8000-000000000006";
    await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: opId, anchor: CELL_ANCHOR, renderedValue: "x" });
    await assert.rejects(
      () => caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: opId, anchor: CELL_ANCHOR, renderedValue: "a totally different value" }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
  } finally {
    await wiring.close();
  }
});

test("SAGA: create rejects a second, DIFFERENT operationId targeting an anchor that already has an open flag", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-000000000007", anchor: CELL_ANCHOR, renderedValue: "x" });
    await assert.rejects(
      () => caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-000000000008", anchor: CELL_ANCHOR, renderedValue: "y" }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
  } finally {
    await wiring.close();
  }
});

test("redFlag: a direct Human invocation of the governed learning skill fails closed even with a valid goalTaskRef", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-000000000009", anchor: CELL_ANCHOR, renderedValue: "x" });
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

test("CAS: clear/reopen/updateReason reject a stale flagId with CONFLICT instead of forking the lineage", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { memory: v1 } = await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-00000000000a", anchor: CELL_ANCHOR, renderedValue: "x" });
    const v2 = await caller.redFlag.clear({ workspaceId: PILOT_WORKSPACE, flagId: v1.id });
    assert.notEqual(v2.id, v1.id);

    // v1 is now stale (superseded) — acting on it again must fail, not fork history.
    await assert.rejects(() => caller.redFlag.reopen({ workspaceId: PILOT_WORKSPACE, flagId: v1.id }), (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT");
    await assert.rejects(() => caller.redFlag.updateReason({ workspaceId: PILOT_WORKSPACE, flagId: v1.id, reason: "stale write" }), (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT");

    const current = await wiring.memoryStore.currentForLineage(PILOT_WORKSPACE, PILOT_USER, v1.subjectElementId!);
    assert.equal(current?.id, v2.id);
  } finally {
    await wiring.close();
  }
});

test("updateReason is a no-op (no new lineage row) when the reason does not actually change", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-00000000000b", anchor: CELL_ANCHOR, renderedValue: "x", reason: "same reason" });
    const result = await caller.redFlag.updateReason({ workspaceId: PILOT_WORKSPACE, flagId: memory.id, reason: "same reason" });
    assert.equal(result.id, memory.id, "an unchanged reason must not fork a new lineage row");
  } finally {
    await wiring.close();
  }
});

test("ANCHOR IDENTITY: a cell anchor and a bullet anchor sharing the same moduleId/recordId never collide", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const bulletAnchor = { kind: "bullet" as const, moduleId: CELL_ANCHOR.moduleId, target: { type: "record" as const, recordId: CELL_ANCHOR.recordId }, bulletPath: "fit.strength.0" };
    await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-00000000000c", anchor: CELL_ANCHOR, renderedValue: "cell value" });
    await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-00000000000d", anchor: bulletAnchor, renderedValue: "bullet value" });
    const all = await caller.redFlag.listAll({ workspaceId: PILOT_WORKSPACE });
    assert.equal(all.flags.length, 2, "a cell and a bullet anchor sharing moduleId/recordId must be two distinct flags");
  } finally {
    await wiring.close();
  }
});

test("ANCHOR IDENTITY: file-only and result-only bullet anchors never collide even with the same bulletPath", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const fileAnchor = { kind: "bullet" as const, moduleId: "job-pilot", target: { type: "file" as const, fileId: "same-id" }, bulletPath: "p.0" };
    const resultAnchor = { kind: "bullet" as const, moduleId: "job-pilot", target: { type: "result" as const, resultId: "same-id" }, bulletPath: "p.0" };
    await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-00000000000e", anchor: fileAnchor, renderedValue: "file value" });
    await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-00000000000f", anchor: resultAnchor, renderedValue: "result value" });
    const all = await caller.redFlag.listAll({ workspaceId: PILOT_WORKSPACE });
    assert.equal(all.flags.length, 2, "a file-only and a result-only anchor with the identical bulletPath/id string must remain distinct");
  } finally {
    await wiring.close();
  }
});

test("listForScope batches an entire scope's current flags in one call (review item 7's server-side primitive)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const anchorB = { ...CELL_ANCHOR, fieldId: "fit.recommendation" };
    await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-000000000010", anchor: CELL_ANCHOR, renderedValue: "x" });
    await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-000000000011", anchor: anchorB, renderedValue: "y" });
    const scoped = await caller.redFlag.listForScope({ workspaceId: PILOT_WORKSPACE, moduleId: CELL_ANCHOR.moduleId, databaseId: CELL_ANCHOR.databaseId, recordId: CELL_ANCHOR.recordId });
    assert.equal(scoped.flags.length, 2);
  } finally {
    await wiring.close();
  }
});

test("listAll paginates server-side with an opaque cursor instead of silently truncating", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    for (let i = 0; i < 5; i++) {
      await caller.redFlag.create({
        workspaceId: PILOT_WORKSPACE,
        operationId: `00000000-0000-4000-8000-00000000030${i}`,
        anchor: { ...CELL_ANCHOR, recordId: `app-page-${i}` },
        renderedValue: "x",
      });
    }
    const page1 = await caller.redFlag.listAll({ workspaceId: PILOT_WORKSPACE, limit: 2 });
    assert.equal(page1.flags.length, 2);
    assert.ok(page1.nextCursor);
    const page2 = await caller.redFlag.listAll({ workspaceId: PILOT_WORKSPACE, limit: 2, cursor: page1.nextCursor! });
    assert.equal(page2.flags.length, 2);
    const page3 = await caller.redFlag.listAll({ workspaceId: PILOT_WORKSPACE, limit: 2, cursor: page2.nextCursor! });
    assert.equal(page3.flags.length, 1);
    assert.equal(page3.nextCursor, null);
    const ids = new Set([...page1.flags, ...page2.flags, ...page3.flags].map((f) => f.row.id));
    assert.equal(ids.size, 5, "pagination must cover every flag exactly once, never truncating");
  } finally {
    await wiring.close();
  }
});

test("history returns the full lineage (the internal none->proposed step, then clear, then reopen), oldest first, including superseded versions", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { memory: v1 } = await caller.redFlag.create({ workspaceId: PILOT_WORKSPACE, operationId: "00000000-0000-4000-8000-000000000020", anchor: CELL_ANCHOR, renderedValue: "x" });
    const v2 = await caller.redFlag.clear({ workspaceId: PILOT_WORKSPACE, flagId: v1.id });
    const v3 = await caller.redFlag.reopen({ workspaceId: PILOT_WORKSPACE, flagId: v2.id });
    const history = await caller.redFlag.history({ workspaceId: PILOT_WORKSPACE, flagId: v3.id });
    // `create()` itself is a two-step saga: an internal "none" learningStatus
    // row is written first, then superseded to "proposed" — v1 is already
    // the SECOND of those two rows, so the full lineage has FOUR versions.
    assert.equal(history.versions.length, 4);
    const ids = history.versions.map((v) => v.row.id);
    assert.deepEqual(ids.slice(1), [v1.id, v2.id, v3.id]);
    assert.equal(history.versions[0]!.value.learningStatus, "none");
    assert.equal(history.versions[1]!.value.learningStatus, "proposed");
    assert.equal(history.versions[2]!.value.status, "cleared");
    assert.equal(history.versions[3]!.value.status, "open");
  } finally {
    await wiring.close();
  }
});
