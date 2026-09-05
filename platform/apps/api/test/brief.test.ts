/**
 * The morning brief's approval nudges (TASK-097): every waiting approval
 * carries its importance, and the list is ordered by it — an external side
 * effect outranks a write even when the write is newer.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryRoleStore } from "@bridge/core";

import { scheduledRunCtx } from "../src/automation-scheduler.js";
import {
  buildWiring,
  LEARNING_AGENT,
  LEARNING_DIGEST_AUTOMATION_ID,
  OBSERVATION_DIGEST_SKILL_ID,
  PILOT_ORGANIZATION,
  PILOT_USER,
} from "../src/wiring.js";
import { makeCaller } from "./caller.js";

test("brief.morning ranks an egress proposal above a newer write proposal", async () => {
  const wiring = await buildWiring();
  try {
    assert.ok(wiring.roles instanceof InMemoryRoleStore);
    wiring.roles.direct.set(`user:${PILOT_USER}`, [
      { resourceType: "event", resourceId: null, action: "share", effect: "allow" },
    ]);
    const caller = makeCaller(wiring);

    const egress = await caller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "event",
      inputs: { note: "test_fixture_brief_egress" },
      skill: "stageMutation",
    });
    assert.equal(egress.status, "pending_review");

    const ctx = scheduledRunCtx(LEARNING_DIGEST_AUTOMATION_ID);
    const write = await wiring.pipeline.propose(
      {
        organizationId: PILOT_ORGANIZATION,
        actor: { type: "agent", id: LEARNING_AGENT, plane: "local" },
        skill: OBSERVATION_DIGEST_SKILL_ID,
        action: "write",
        resourceType: "signal",
        dataScope: "all",
        inputs: {},
        context: { type: "automation", id: LEARNING_DIGEST_AUTOMATION_ID, runId: ctx.ids.next() },
      },
      ctx,
    );
    assert.equal(write.status, "pending_review");

    // Real wiring may hold other proposals (a scheduler tick can propose
    // before this test does), so the assertion is relative order, not [0].
    const brief = await caller.brief.morning({ organizationId: PILOT_ORGANIZATION });
    const items = brief.approvals.items;
    const at = (id: string) => items.findIndex((item) => item.proposalId === id);
    assert.ok(at(egress.id) >= 0 && at(write.id) >= 0, "both proposals reach the brief");
    assert.ok(at(egress.id) < at(write.id), "the older egress proposal leads the newer write");
    assert.equal(items[at(egress.id)]!.importance.tier, "external");
    assert.equal(items[at(write.id)]!.importance.tier, "write");
    for (let i = 1; i < items.length; i++) {
      assert.ok(items[i - 1]!.importance.rank <= items[i]!.importance.rank, "the list is ordered by rank");
    }
  } finally {
    await wiring.close();
  }
});
