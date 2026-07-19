/**
 * PKG-1 (Month-6) — the package install path enforces the sandbox floor for
 * executable capabilities (packages/core/src/capability/sandbox-policy.ts wired
 * into packages.install). An executable capability may only install when its
 * declared isolation satisfies the gate; a declarative capability is unaffected.
 * Mirrors packages.test.ts's buildWiring() + createCaller harness.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_WORKSPACE, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

/** A package whose single capability is EXECUTABLE (carries an execution spec),
 * so it is subject to the PKG-1 sandbox floor. */
function executableManifest(execution: Record<string, unknown>) {
  return {
    package: {
      name: "test-fixture-executable-pkg",
      version: "1.0.0",
      kind: "module",
      summary: "test fixture executable package",
      description: "test fixture executable package",
      dependencies: [],
      capabilities: [
        {
          id: "test-fixture.executable-cap",
          capability_type: "skill",
          version: "1.0.0",
          permissions: [{ resource_type: "person", action: "read", data_scope: "public", egress: false }],
          connectors: [],
          execution,
        },
      ],
    },
  };
}

test("packages.install: rejects an executable capability declaring isolation \"none\" (sandbox floor)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: executableManifest({ executable: true, isolation: "none", sandbox: { network: false } }),
    });
    await assert.rejects(
      () => caller.packages.install({ workspaceId: PILOT_WORKSPACE, installationId: installation.id, todayKey: "2026-07-06" }),
      /executable_requires_isolation|cannot be installed/,
    );
  } finally {
    await wiring.close();
  }
});

test("packages.install: rejects a network-granting executable with only \"process\" isolation (needs a real boundary)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: executableManifest({ executable: true, isolation: "process", sandbox: { network: true } }),
    });
    await assert.rejects(
      () => caller.packages.install({ workspaceId: PILOT_WORKSPACE, installationId: installation.id, todayKey: "2026-07-06" }),
      /executable_caps_require_stronger_isolation|cannot be installed/,
    );
  } finally {
    await wiring.close();
  }
});

test("packages.install: a container-isolated executable with gated network caps clears the sandbox floor", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: executableManifest({ executable: true, isolation: "container", sandbox: { network: true, filesystem: [], env: [] } }),
    });
    // The gate PASSES (no sandbox rejection). Risk still computes normally —
    // granting network escalates via the sandbox trifecta legs, so this is
    // parked for approval rather than auto-installed, but crucially it is NOT
    // rejected at the sandbox floor.
    const result = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: installation.id,
      todayKey: "2026-07-06",
    });
    assert.equal(typeof result.risk.effectiveRisk, "string");
    assert.ok(["installed", "decision"].some((k) => k in result));
  } finally {
    await wiring.close();
  }
});

test("packages.install: a purely declarative package (no execution spec) is unaffected by the sandbox floor", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: {
        package: {
          name: "test-fixture-declarative-pkg",
          version: "1.0.0",
          kind: "skill",
          summary: "test fixture declarative package",
          description: "test fixture declarative package",
          dependencies: [],
          capabilities: [
            {
              id: "test-fixture.declarative-read",
              capability_type: "skill",
              version: "1.0.0",
              permissions: [{ resource_type: "person", action: "read", data_scope: "all", egress: false }],
              connectors: [],
            },
          ],
        },
      },
    });
    const result = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: installation.id,
      todayKey: "2026-07-06",
    });
    assert.equal(result.installed, true);
    assert.equal(result.risk.effectiveRisk, "informational");
  } finally {
    await wiring.close();
  }
});
