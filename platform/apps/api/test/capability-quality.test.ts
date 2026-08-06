/**
 * End-to-end proof that the Agent Quality Vector now scores REAL governed
 * episodes (A1-R1/F2).
 *
 * Before migration 0037 and `LedgerAqvSource`, the eval harness was fully built
 * and structurally unable to run: no ledger row recorded which capability
 * produced it, no row carried an execution snapshot, and `AqvSource` had no
 * implementation. Every existing AQV test therefore hand-injected its fixtures,
 * which is exactly why the missing writer was invisible to CI.
 *
 * These tests drive the REAL pipeline through the REAL wiring and then read the
 * score back through the REAL tRPC procedure. Nothing is hand-seeded.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  hashTaintValue,
  KERNEL_PASSTHROUGH_SKILL,
  labelAtSource,
  SeededRng,
  SystemClock,
  UuidGen,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function caller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: "test_fixture_quality_user" },
    authenticated: true,
    verifying: false,
  });
}

// The reserved Human-invocable kernel skill. A governed Skill like
// `stageStrategicRecommendation` is agent-only by design and a direct user call is
// correctly REJECTED at the gate, which produces an audit row with no execution —
// not the completed episode these tests need to score.
const SKILL = KERNEL_PASSTHROUGH_SKILL;

// One RunCtx per caller, threaded through every propose in that test: `makeRun()`
// seeds a deterministic RNG, so building a fresh one per call re-issues the SAME
// id and the append-only ledger correctly rejects the duplicate.
async function proposeOnce(wiring: Wiring, text: string, run: RunCtx) {
  return wiring.pipeline.propose(
    {
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "write",
      resourceType: "signal",
      inputs: { text },
      taintLabel: labelAtSource("human_input", {
        ref: "capability-quality:test",
        valueHash: hashTaintValue(text),
        sensitivity: "organization",
        instructionRisk: "instruction_like",
      }),
      skill: SKILL,
    },
    run,
  );
}

test("a real pipeline run is attributable to its capability and carries a snapshot", async () => {
  const wiring = await buildWiring();
  try {
    const proposal = await proposeOnce(wiring, "attribution probe", makeRun());
    const entry = await wiring.ledger.get(proposal.id);

    assert.ok(entry, "the pipeline must have appended a ledger row");
    assert.equal(entry?.skill, SKILL, "the row must name the capability that produced it");

    const snapshot = entry?.executionSnapshot;
    assert.ok(snapshot, "the row must carry an execution snapshot");
    assert.equal(snapshot?.terminalState, "completed");
    assert.equal(typeof snapshot?.violationCount, "number");
    assert.ok(snapshot?.startedAt, "the turn's start must be recorded");
    assert.ok(snapshot?.finishedAt, "the turn's end must be recorded");

    // Deliberately absent — nothing in the platform produces these yet, and a
    // fabricated 0 would read as "free" rather than "unknown" to the efficiency axis.
    assert.equal(snapshot?.cost, undefined);
    assert.equal(snapshot?.baselineCost, undefined);
  } finally {
    await wiring.close?.();
  }
});

test("capability.quality scores the capability from those real episodes", async () => {
  const wiring = await buildWiring();
  try {
    const run = makeRun();
    await proposeOnce(wiring, "quality probe one", run);
    await proposeOnce(wiring, "quality probe two", run);

    const score = await caller(wiring).capability.quality({ manifestId: SKILL });

    assert.equal(score.capabilityId, SKILL);
    assert.equal(score.episodeCount, 2, "both governed runs must be scored, and only those");
    assert.equal(score.instrumentedEpisodes, 2, "the pipeline wrote a snapshot for each");
    assert.equal(score.success, 1, "both auto-approved cleanly");
    assert.equal(score.correction, 0);
    // Reliability is derived from snapshots the pipeline really wrote — this is the
    // assertion that would have been impossible before this change, because nothing
    // in the platform produced an ExecutionSnapshot at all.
    assert.equal(score.reliability, 1);
    assert.equal(score.safety, 1);
    // No baseline-cost producer exists anywhere yet, so efficiency must report
    // "unknown" rather than scoring the capability as maximally inefficient.
    assert.equal(score.efficiency, null);
  } finally {
    await wiring.close?.();
  }
});

test("a capability with no episodes scores as unmeasured, not as failing", async () => {
  const wiring = await buildWiring();
  try {
    const score = await caller(wiring).capability.quality({
      manifestId: "a-capability-that-never-ran",
    });
    assert.equal(score.episodeCount, 0);
    assert.equal(score.instrumentedEpisodes, 0);
    assert.equal(score.reliability, null);
    assert.equal(score.efficiency, null);
    assert.equal(score.safety, 1, "safety has no violations to veto on");
  } finally {
    await wiring.close?.();
  }
});
