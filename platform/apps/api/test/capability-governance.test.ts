/**
 * Month 4 (Batch 6) router wiring — EVAL-3 (capability.approve's Validated->Active
 * baseline-vs-candidate gate) and GOV-1 (capability.governanceAutoApprove +
 * capability.orgHealth). Mirrors modules.test.ts's harness (buildWiring() +
 * appRouter.createCaller). Seeds manifests/states/eval-runs through the SAME
 * in-memory ports the router reads, then drives the real procedures.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  type AxisScores,
  type CapabilityManifestRow,
  type CapabilityOrigin,
  type CapabilityState,
  type EvalRun,
  type RiskBand,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: "test_fixture_gov_user" },
    authenticated: true,
    verifying: false,
  });
}

/**
 * The REAL seeded pilot user (`wiring.ts`'s `seedGovernance` grants
 * `capability:approve` only to `user:${PILOT_USER}`) — the one identity
 * whose `capability.approve` proposal actually resolves `"applied"` rather
 * than authority-denied `"rejected"`. Use this caller for any test that
 * expects `capability.approve` to legitimately mutate state.
 */
async function makeApprovingCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

async function seedManifest(
  wiring: Wiring,
  opts: {
    risk?: RiskBand;
    origin?: CapabilityOrigin;
    lineageManifestId?: string;
    state: CapabilityState;
    successRate?: number;
    trustedUntil?: string;
  },
): Promise<CapabilityManifestRow> {
  const id = randomUUID();
  const manifest = await wiring.capabilityStore.createManifest({
    id,
    organizationId: PILOT_ORGANIZATION,
    capabilityType: "skill",
    name: `cap-${id.slice(0, 8)}`,
    version: "1.0.0",
    origin: opts.origin ?? "built_in",
    audience: "private",
    manifest: { permissions: [], connectors: [] },
    computedRisk: opts.risk ?? "informational",
    dependencies: [],
    ...(opts.lineageManifestId ? { lineageManifestId: opts.lineageManifestId } : {}),
  });
  await wiring.capabilityStore.upsertState({
    manifestId: id,
    organizationId: PILOT_ORGANIZATION,
    state: opts.state,
    suspended: false,
    ...(opts.trustedUntil ? { trustedUntil: opts.trustedUntil } : {}),
    evidence: opts.successRate !== undefined ? { successRate: opts.successRate } : {},
  });
  return manifest;
}

/** Build + persist an EvalRun keyed to a capability_id from per-case axis rows. */
async function seedRun(wiring: Wiring, capabilityId: string, cases: AxisScores[]): Promise<EvalRun> {
  const axes: Array<keyof AxisScores> = [
    "success",
    "correction",
    "quality",
    "route_p",
    "route_r",
    "reliability",
    "safety",
    "efficiency",
  ];
  const aggregate: AxisScores = {};
  for (const axis of axes) {
    const vals = cases.map((c) => c[axis]).filter((v): v is number => typeof v === "number");
    if (vals.length > 0) aggregate[axis] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return wiring.evalStore.createRun({
    capability_id: capabilityId,
    capability_version: "1.0.0",
    dataset_id: "ds-holdout-1",
    perCase: cases.map((a, i) => ({ caseId: `${capabilityId}-case-${i}`, axes: a })),
    aggregate,
    started_at: "2026-10-01T00:00:00.000Z",
    finished_at: "2026-10-01T00:05:00.000Z",
  });
}

function flat(n: number, row: AxisScores): AxisScores[] {
  return Array.from({ length: n }, () => ({ ...row }));
}

test("EVAL-3: capability.approve auto-advances a candidate that beats baseline, with a why-better card", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeApprovingCaller(wiring);
    const baseline = await seedManifest(wiring, { state: "active" });
    const candidate = await seedManifest(wiring, { state: "validated", lineageManifestId: baseline.id });
    await seedRun(wiring, baseline.id, flat(20, { quality: 0.7, route_p: 0.8, route_r: 0.78, safety: 1, correction: 0.15 }));
    await seedRun(wiring, candidate.id, flat(20, { quality: 0.9, route_p: 0.9, route_r: 0.85, safety: 1, correction: 0.1 }));

    const result = await caller.capability.approve({ manifestId: candidate.id });

    assert.equal(result.state.state, "approved", "validated -> approved on a promote verdict");
    assert.ok(result.comparison, "a why-better card is attached");
    assert.equal(result.comparison?.verdict, "promote");
    assert.ok(result.comparison?.gates.every((g) => g.passed), "every gate line passed");
    assert.match(result.comparison?.headline ?? "", /promoting/i);
  } finally {
    await wiring.close();
  }
});

test("EVAL-3: capability.approve rejects a regressor and leaves it validated", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeApprovingCaller(wiring);
    const baseline = await seedManifest(wiring, { state: "active" });
    const candidate = await seedManifest(wiring, { state: "validated", lineageManifestId: baseline.id });
    await seedRun(wiring, baseline.id, flat(20, { quality: 0.85, route_p: 0.85, route_r: 0.82, safety: 1, correction: 0.1 }));
    // Quality collapses below baseline AND the floor; routing unchanged.
    await seedRun(wiring, candidate.id, flat(20, { quality: 0.6, route_p: 0.85, route_r: 0.82, safety: 1, correction: 0.1 }));

    await assert.rejects(() => caller.capability.approve({ manifestId: candidate.id }), /does not beat baseline/);

    const after = await wiring.capabilityStore.getState(candidate.id);
    assert.equal(after?.state, "validated", "a rejected candidate does not advance");
  } finally {
    await wiring.close();
  }
});

test("EVAL-3: approve proceeds unchanged when there is no lineage baseline to beat", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeApprovingCaller(wiring);
    // First-of-lineage (no lineageManifestId) — nothing to compare against.
    const cap = await seedManifest(wiring, { state: "validated" });
    const result = await caller.capability.approve({ manifestId: cap.id });
    assert.equal(result.state.state, "approved");
    assert.equal((result as { comparison?: unknown }).comparison, undefined, "no card when the gate is not applicable");
  } finally {
    await wiring.close();
  }
});

test("SECURITY: capability.approve throws FORBIDDEN for a caller with no capability:approve grant, and does NOT mutate state", async () => {
  const wiring = await buildWiring();
  try {
    // "test_fixture_gov_user" is intentionally NOT the seeded pilot user —
    // `seedGovernance`'s direct grants only cover `user:${PILOT_USER}`, so
    // this identity's action:"approve" proposal is authority-denied
    // (status "rejected"). Before the hard-stop guard in capability.approve,
    // this call fell through into the state-advance mutation anyway (the bug
    // documented in docs/BUGS.md); it must now throw before ever reaching it.
    const caller = await makeCaller(wiring);
    const cap = await seedManifest(wiring, { state: "validated" });

    await assert.rejects(
      () => caller.capability.approve({ manifestId: cap.id }),
      (err: unknown) => {
        assert.match(String((err as { message?: string })?.message ?? err), /FORBIDDEN|authority|not authorized/i);
        return true;
      },
    );

    const after = await wiring.capabilityStore.getState(cap.id);
    assert.equal(after?.state, "validated", "an unauthorized approve must leave capability state unchanged");
  } finally {
    await wiring.close();
  }
});

test("SECURITY: capability.approve throws FORBIDDEN for an Agent actor (agent-floor), and does NOT mutate state", async () => {
  const wiring = await buildWiring();
  try {
    // Agents can never resolve an approve decision (agent-floor, pipeline.ts) —
    // this must reject even though the grant added for the pilot user exists,
    // proving the fix did not weaken the agent-floor.
    const caller = await appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "agent", id: "test_fixture_gov_agent" },
      authenticated: true,
      verifying: false,
    });
    const cap = await seedManifest(wiring, { state: "validated" });

    await assert.rejects(() => caller.capability.approve({ manifestId: cap.id }));

    const after = await wiring.capabilityStore.getState(cap.id);
    assert.equal(after?.state, "validated", "an agent approve attempt must leave capability state unchanged");
  } finally {
    await wiring.close();
  }
});

test("GOV-1: governanceAutoApprove auto-approves a minor-band capability", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    // informational + built_in => minor.
    const cap = await seedManifest(wiring, { state: "validated", risk: "informational", origin: "built_in" });
    const result = await caller.capability.governanceAutoApprove({ manifestId: cap.id });
    assert.equal(result.autoApproved, true);
    assert.equal(result.band, "minor");
    assert.equal(result.state.state, "approved", "minor advances validated -> approved");
  } finally {
    await wiring.close();
  }
});

test("GOV-1: governanceAutoApprove refuses a major-band capability (routes to a human)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    // operational => major, regardless of origin.
    const cap = await seedManifest(wiring, { state: "validated", risk: "operational", origin: "built_in" });
    const result = await caller.capability.governanceAutoApprove({ manifestId: cap.id });
    assert.equal(result.autoApproved, false);
    assert.equal(result.band, "major");
    assert.equal(result.state.state, "validated", "a major-band capability is NOT auto-advanced");
  } finally {
    await wiring.close();
  }
});

test("GOV-1: governanceAutoApprove refuses a moderate-band capability (ai_generated origin)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    // informational but ai_generated => moderate (not one of the built-in/template origins).
    const cap = await seedManifest(wiring, { state: "validated", risk: "informational", origin: "ai_generated" });
    const result = await caller.capability.governanceAutoApprove({ manifestId: cap.id });
    assert.equal(result.autoApproved, false);
    assert.equal(result.band, "moderate");
    assert.equal(result.state.state, "validated");
  } finally {
    await wiring.close();
  }
});

test("GOV-1: orgHealth renders a rollup over a organization's real capabilities", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeApprovingCaller(wiring); // organizationId inputs now require membership
    // An active capability failing its bar => autonomy pressure.
    const struggling = await seedManifest(wiring, { state: "active", successRate: 0.5 });
    // A validated capability => a pending approval (risk-typed by computedRisk).
    await seedManifest(wiring, { state: "validated", risk: "advisory" });

    const rollup = await caller.capability.orgHealth({ organizationId: PILOT_ORGANIZATION });

    assert.ok(rollup.autonomyPressure.manifestIds.includes(struggling.id), "the failing active cap is flagged");
    assert.equal(rollup.approvalLoad.total, 1, "one validated cap awaiting a decision");
    assert.equal(rollup.approvalLoad.byRisk.advisory, 1);
    assert.equal(rollup.violationTrend.label, "flat", "no violation history yet => flat");
  } finally {
    await wiring.close();
  }
});
