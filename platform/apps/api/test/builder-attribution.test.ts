/**
 * TASK-094 — the Capability Builder acts as itself.
 *
 * Before this, both Builder lanes executed as whichever human pressed the
 * button: `CAPABILITY_BUILDER_AGENT` had a role, a scope and seeded
 * governance, and nothing referenced it. Two things follow from that, and
 * this file asserts both.
 *
 *  1. **The Builder's work is attributable.** Each lane leaves an Agent Run
 *     under the Builder's agent id, carrying the evidence it derived from.
 *  2. **The attribution is an authority, not a label.** Narrow the Builder's
 *     scope below what the lane needs and the lane fails closed — if it kept
 *     working, the agent identity would be decoration.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_BUILDER_AGENT } from "../src/wiring.js";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { makeCaller, makeRun } from "./caller.js";

const ORG = PILOT_ORGANIZATION;

let evidenceSeq = 0;
function evidenceId(): string {
  evidenceSeq += 1;
  return `3f1c0000-0000-4000-8000-${String(evidenceSeq).padStart(12, "0")}`;
}

/** Three deals is the smallest fixture that gives the rung-4 derivation a
 *  discriminator to find; the point here is the Run, not the shape. */
async function seedThreeDeals(caller: ReturnType<typeof makeCaller>): Promise<void> {
  for (const [name, stage] of [["Cascade", "diligence"], ["Northwind", "loi"], ["Ridgeline", "screening"]]) {
    for (const [field, value] of [["type", "deal"], ["stage", stage!]]) {
      const proposed = await caller.learning.claims.proposeClaim({
        organizationId: ORG,
        entity: { kind: "topic", name: name! },
        field: field!,
        value: value!,
        claimClass: "observed_preference",
        evidence: [{ kind: "memory", id: evidenceId() }],
      });
      assert.equal(proposed.proposed, true);
      await caller.learning.claims.acceptClaim({
        organizationId: ORG,
        suggestionMemoryId: proposed.proposed ? proposed.suggestion.memoryId : "",
      });
    }
  }
}

test("rung 4 leaves an Agent Run attributed to the Capability Builder, carrying its evidence", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await seedThreeDeals(caller);

    const result = await caller.learning.claims.proposeStructure({ organizationId: ORG });
    assert.equal(result.proposed, true);
    assert.ok(result.runId, "the lane reports the Run it acted under");

    const run = await wiring.automationRunRecorder.get(ORG, result.runId);
    assert.ok(run, "the Run is durable, not a returned id with nothing behind it");
    assert.equal(run.agentId, CAPABILITY_BUILDER_AGENT, "attributed to the Builder, not the human");
    assert.equal(run.status, "completed");
    assert.ok(run.finishedAt, "a Run that never finishes reads as still working");
    assert.ok(run.taskId, "the Run advances a Task, like every other attributable Run");

    const output = run.output as { lane: string; proposed: boolean; evidenceClaimIds: string[] };
    assert.equal(output.lane, "claims.proposeStructure");
    assert.equal(output.proposed, true);
    const liveClaimIds = new Set(
      (await caller.learning.claims.claims({ organizationId: ORG })).claims.map((claim) => claim.id),
    );
    assert.ok(output.evidenceClaimIds.length > 0);
    for (const claimId of output.evidenceClaimIds) {
      assert.equal(liveClaimIds.has(claimId), true, "the Run names the claims it read");
    }

    const listed = await caller.learning.builderRuns({ organizationId: ORG });
    assert.equal(listed.agentId, CAPABILITY_BUILDER_AGENT);
    assert.equal(
      listed.runs.some((row) => row.runId === result.runId),
      true,
      "and the Run is readable from outside the Builder — attribution nobody can query is not attribution",
    );
  } finally {
    await wiring.close();
  }
});

test("a refusal is recorded too — the Run says the Builder declined, and why", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const caller = makeCaller(wiring);

    const result = await caller.learning.claims.proposeStructure({ organizationId: ORG });
    assert.equal(result.proposed, false);

    const run = await wiring.automationRunRecorder.get(ORG, result.runId);
    assert.equal(run?.status, "completed", "declining is a completed Run, not a halted one");
    const output = run?.output as { proposed: boolean; reason: string };
    assert.equal(output.proposed, false);
    assert.equal(output.reason, "no_entities");
  } finally {
    await wiring.close();
  }
});

test("narrowing the Builder's scope fails the lane closed — the identity is an authority, not a label", async () => {
  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await seedThreeDeals(caller);
    // Sanity: it works before the scope is taken away, so the refusal below
    // cannot be blamed on the fixture.
    const before = await caller.learning.claims.proposeStructure({ organizationId: ORG });
    assert.equal(before.proposed, true);

    // `wiring.agents` is the read port; the in-memory governance store behind
    // it is where a dev/test deployment's scopes actually live.
    const governance = wiring.memory;
    assert.ok(governance, "this wiring seeds in-memory governance");
    governance.agents.scope.set(CAPABILITY_BUILDER_AGENT, []);

    await assert.rejects(
      caller.learning.claims.proposeStructure({ organizationId: ORG }),
      /Capability Builder is not authorized/,
      "with no scope the Builder cannot act, however the human asks",
    );
  } finally {
    await wiring.close();
  }
});

test("the Builder's Runs are flight-gated and member-scoped like the lanes they record", async () => {
  const off = await buildWiring({ learningObservationEnabled: false, claimSubstrateEnabled: false }); // both lanes off (defaults are ON since AP-182)
  try {
    await assert.rejects(
      makeCaller(off).learning.builderRuns({ organizationId: ORG }),
      /disabled|flight/i,
    );
  } finally {
    await off.close();
  }

  const wiring = await buildWiring({ claimSubstrateEnabled: true });
  try {
    const stranger = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "user", id: "00000000-0000-4000-8000-0000000000ff" },
      authenticated: true,
      verifying: false,
    });
    await assert.rejects(
      stranger.learning.builderRuns({ organizationId: ORG }),
      /member|not found|forbidden/i,
    );
  } finally {
    await wiring.close();
  }
});
