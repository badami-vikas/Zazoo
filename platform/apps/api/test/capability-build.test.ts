/**
 * The governed capability-build chain, end to end through `buildWiring()`
 * (ADR-181).
 *
 * `capability-build-chain.test.ts` (core) proves the rules. These prove the
 * WIRING — the half that had been missing for months while the rules sat
 * unused: that Capability Builder now actually holds a Skill, that each
 * junction reaches the pipeline under its OWN Agent's identity, that a cleared
 * draft becomes a real `draft` capability row, and that a blocked one leaves
 * nothing behind.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SeededRng, SystemClock, UuidGen, labelFromLegacyTrustOrigin, type RunCtx } from "@bridge/core";

import { appRouter } from "../src/router.js";
import { classifyPublicCloudProcedure, isPublicCloudProcedureAllowed } from "../src/deployment-boundary.js";
import { runCapabilityBuildChain } from "../src/capability-build.js";
import {
  buildWiring,
  CAPABILITY_BUILDER_AGENT,
  CAPABILITY_BUILD_GOAL_TYPE,
  DRAFT_CAPABILITY_SKILL_ID,
  DRAFT_CAPABILITY_TASK_TYPE,
  GOVERNANCE_AGENT,
  GOVERNED_SKILL_MANIFEST_CATALOG,
  INTERNAL_STRATEGIST_AGENT,
  PILOT_ORGANIZATION,
  PILOT_USER,
  RECOMMEND_CAPABILITY_BUILD_SKILL_ID,
  RECOMMEND_CAPABILITY_BUILD_TASK_TYPE,
  REVIEW_CAPABILITY_DRAFT_SKILL_ID,
  REVIEW_CAPABILITY_DRAFT_TASK_TYPE,
  type Wiring,
} from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(7);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    taintLabel: labelFromLegacyTrustOrigin("operator", "capability-build-test"),
  };
}

function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user" as const, id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

async function walk(wiring: Wiring, over: Partial<Parameters<typeof runCapabilityBuildChain>[1]> = {}) {
  const provisioned: Array<{ taskType: string; agentId: string }> = [];
  const result = await runCapabilityBuildChain(
    {
      wiring,
      run: makeRun(),
      organizationId: PILOT_ORGANIZATION,
      actingUserId: PILOT_USER,
      provisionTask: async (taskType, agentId) => {
        provisioned.push({ taskType, agentId });
        const seam = { nextId: () => crypto.randomUUID(), nowISO: () => new Date().toISOString() };
        const goals = await wiring.goalTasks.listGoals(PILOT_ORGANIZATION);
        const goal =
          goals.find((g) => g.type === CAPABILITY_BUILD_GOAL_TYPE) ??
          (await wiring.goalTasks.createGoal(
            { organizationId: PILOT_ORGANIZATION, type: CAPABILITY_BUILD_GOAL_TYPE, title: "test_fixture builds" },
            seam,
          ));
        const task = await wiring.goalTasks.createTask(
          { organizationId: PILOT_ORGANIZATION, goalId: goal.id, type: taskType, assignedAgentId: agentId },
          seam,
        );
        return { goalId: goal.id, taskId: task.id };
      },
    },
    {
      origin: "proactive",
      capabilityType: "automation",
      title: "Weekly network digest",
      rationale: "The same summary is re-derived by hand every Monday.",
      evidence: [],
      ...over,
    },
  );
  return { result, provisioned };
}

test("Capability Builder finally holds a Skill — and exactly one", async () => {
  // The fact this whole change exists to correct. Before ADR-181 this Agent had
  // an identity, a role, and a governance row, and `agents.skills` had no entry
  // for it at all, so there was nothing it could be asked to do.
  const wiring = await buildWiring();
  try {
    const skills = await wiring.agents.allowedSkills(CAPABILITY_BUILDER_AGENT);
    assert.deepEqual(skills, [DRAFT_CAPABILITY_SKILL_ID]);
  } finally {
    await wiring.close();
  }
});

test("each junction's Skill is granted to exactly one Agent — no agent holds two", async () => {
  // Separation of the three roles at the grant layer, so the pure-code actor
  // check in build-chain.ts is not the only thing standing between the Builder
  // and reviewing its own work.
  const wiring = await buildWiring();
  try {
    const holders = async (skillId: string) => {
      const found: string[] = [];
      for (const agentId of [INTERNAL_STRATEGIST_AGENT, CAPABILITY_BUILDER_AGENT, GOVERNANCE_AGENT]) {
        const skills = await wiring.agents.allowedSkills(agentId);
        if (skills.includes(skillId)) found.push(agentId);
      }
      return found;
    };
    assert.deepEqual(await holders(RECOMMEND_CAPABILITY_BUILD_SKILL_ID), [INTERNAL_STRATEGIST_AGENT]);
    assert.deepEqual(await holders(DRAFT_CAPABILITY_SKILL_ID), [CAPABILITY_BUILDER_AGENT]);
    assert.deepEqual(await holders(REVIEW_CAPABILITY_DRAFT_SKILL_ID), [GOVERNANCE_AGENT]);
  } finally {
    await wiring.close();
  }
});

test("wiring the chain widened no Agent's capability scope", async () => {
  // Every one of the three Skills declares `signal:write`, which all three
  // Agents already held. Adding a governed capability path must not be a way to
  // quietly hand an Agent new authority.
  for (const skillId of [
    RECOMMEND_CAPABILITY_BUILD_SKILL_ID,
    DRAFT_CAPABILITY_SKILL_ID,
    REVIEW_CAPABILITY_DRAFT_SKILL_ID,
  ]) {
    const manifest = GOVERNED_SKILL_MANIFEST_CATALOG.find((m) => m.skillId === skillId);
    assert.ok(manifest, `${skillId} must be in the governed catalog`);
    assert.deepEqual(manifest.permissions, ["signal:write"]);
  }

  const wiring = await buildWiring();
  try {
    assert.deepEqual(await wiring.agents.capabilityScope(CAPABILITY_BUILDER_AGENT), ["signal:write"]);
  } finally {
    await wiring.close();
  }
});

test("one walk produces three proposals, one per Agent, in junction order", async () => {
  const wiring = await buildWiring();
  try {
    const { result, provisioned } = await walk(wiring);
    assert.equal(result.proposalIds.length, 3);
    assert.deepEqual(provisioned, [
      { taskType: RECOMMEND_CAPABILITY_BUILD_TASK_TYPE, agentId: INTERNAL_STRATEGIST_AGENT },
      { taskType: DRAFT_CAPABILITY_TASK_TYPE, agentId: CAPABILITY_BUILDER_AGENT },
      { taskType: REVIEW_CAPABILITY_DRAFT_TASK_TYPE, agentId: GOVERNANCE_AGENT },
    ]);
  } finally {
    await wiring.close();
  }
});

test("a cleared chain registers a manifest in draft — never active", async () => {
  const wiring = await buildWiring();
  try {
    const { result } = await walk(wiring);
    assert.equal(result.state.phase, "reviewed");
    assert.ok(result.manifestId);

    const state = await wiring.capabilityStore.getState(result.manifestId!);
    assert.equal(state?.state, "draft");

    const row = await wiring.capabilityStore.getManifest(result.manifestId!);
    assert.equal(row?.origin, "ai_generated");
    assert.equal(row?.capabilityType, "automation");
  } finally {
    await wiring.close();
  }
});

test("a blocked chain writes NO capability row", async () => {
  // The property that makes blocking meaningful. If a blocked draft still
  // landed as a row, it would show up in the Approvals surface and a human
  // would be asked about something Governance had already refused to forward.
  const wiring = await buildWiring();
  try {
    const page = { limit: 100, offset: 0 };
    const before = await wiring.capabilityStore.listManifests(PILOT_ORGANIZATION, page);
    const { result } = await walk(wiring, { origin: "retrospective", evidence: [] });

    assert.equal(result.state.phase, "blocked");
    assert.equal(result.manifestId, null);
    assert.equal(result.blockers.length, 1);
    assert.match(result.blockers[0]!, /cites no evidence/);

    const after = await wiring.capabilityStore.listManifests(PILOT_ORGANIZATION, page);
    assert.equal(after.total, before.total);

    // The junctions still ran and are still attributable — a refusal is a
    // recorded act, not silence.
    assert.equal(result.proposalIds.length, 3);
  } finally {
    await wiring.close();
  }
});

test("offline, the draft is the least-privilege skeleton and says so", async () => {
  // No model is configured in this composition, so nothing generated the
  // manifest. Claiming otherwise on the Approvals card would be the dishonest
  // version of this feature.
  const wiring = await buildWiring();
  try {
    const { result } = await walk(wiring);
    assert.equal(result.state.phase, "reviewed");
    const drafted = result.state as { draft: { source: string; manifest: { permissions: unknown[] } } };
    assert.equal(drafted.draft.source, "offline_skeleton");
    assert.deepEqual(drafted.draft.manifest.permissions, [
      { resourceType: "signal", action: "write", dataScope: "private", egress: false },
    ]);
  } finally {
    await wiring.close();
  }
});

test("the router exposes ONE door — no per-junction endpoint to bypass with", () => {
  // Asserted against the router DEFINITION rather than a caller proxy, because
  // the proxy answers to any property name and so can never prove absence.
  const paths = Object.keys(appRouter._def.procedures).filter((p) => p.startsWith("capabilityBuild."));
  assert.deepEqual(paths, ["capabilityBuild.run"]);
});

test("the chain is Local-Plane only — a public cloud shell cannot build capabilities", () => {
  // `capabilityBuild.run` does NOT start with "capability." (the dot), so the
  // pre-existing capability-authoring deny prefix never covered it. It needs
  // its own entry, and it must never be publicly allowed: the chain drives
  // three Agent Runs and writes governed capability state.
  const verdict = classifyPublicCloudProcedure("capabilityBuild.run");
  assert.equal(verdict.kind, "local-only");
  assert.equal(isPublicCloudProcedureAllowed("capabilityBuild.run"), false);
});

test("capabilityBuild.run walks the chain and reports an honest trail", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const result = await caller.capabilityBuild.run({
      organizationId: PILOT_ORGANIZATION,
      origin: "proactive",
      capabilityType: "skill",
      title: "Digest unread threads",
      rationale: "Repeated manual triage every morning.",
      evidence: [],
    });

    assert.equal(result.phase, "reviewed");
    assert.ok(result.manifestId);
    assert.equal(result.proposalIds.length, 3);
    assert.match(result.trail, /Internal Strategist recommended/);
    assert.match(result.trail, /Capability Builder drafted/);
    assert.match(result.trail, /Governance computed/);
    assert.match(result.trail, /no capability is active until a person approves it/);
  } finally {
    await wiring.close();
  }
});

test("capabilityBuild.run cannot activate — the returned manifest still needs a human", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const result = await caller.capabilityBuild.run({
      organizationId: PILOT_ORGANIZATION,
      origin: "proactive",
      capabilityType: "automation",
      title: "Nudge stale threads",
      rationale: "Threads go quiet and nobody notices.",
      evidence: [],
    });
    const state = await wiring.capabilityStore.getState(result.manifestId!);
    assert.equal(state?.state, "draft");
    assert.notEqual(state?.state, "active");
    // And the verdict it carried says so in as many words.
    assert.equal((result.verdict as { humanApprovalRequired?: unknown }).humanApprovalRequired, true);
  } finally {
    await wiring.close();
  }
});
