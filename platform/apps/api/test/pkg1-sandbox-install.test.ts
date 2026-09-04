/**
 * PKG-1 (Month-6) — the module install path enforces the sandbox floor for
 * executable capabilities (packages/core/src/capability/sandbox-policy.ts wired
 * into modules.install). An executable capability may only install when its
 * declared isolation satisfies the gate; a declarative capability is unaffected.
 * Mirrors modules.test.ts's buildWiring() + createCaller harness.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";

/** A module whose single capability is EXECUTABLE (carries an execution spec),
 * so it is subject to the PKG-1 sandbox floor. */
function executableManifest(execution: Record<string, unknown>) {
  return {
    module: {
      name: "test-fixture-executable-pkg",
      version: "1.0.0",
      kind: "module",
      summary: "test fixture executable module",
      description: "test fixture executable module",
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

test("modules.install: rejects an executable capability declaring isolation \"none\" (sandbox floor)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: executableManifest({ executable: true, isolation: "none", sandbox: { network: false } }),
    });
    await assert.rejects(
      () => caller.modules.install({ organizationId: PILOT_ORGANIZATION, installationId: installation.id, todayKey: "2026-07-06" }),
      /executable_requires_isolation|cannot be installed/,
    );
  } finally {
    await wiring.close();
  }
});

test("modules.install: rejects a network-granting executable with only \"process\" isolation (needs a real boundary)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: executableManifest({ executable: true, isolation: "process", sandbox: { network: true } }),
    });
    await assert.rejects(
      () => caller.modules.install({ organizationId: PILOT_ORGANIZATION, installationId: installation.id, todayKey: "2026-07-06" }),
      /executable_caps_require_stronger_isolation|cannot be installed/,
    );
  } finally {
    await wiring.close();
  }
});

test("modules.install: a container-isolated executable with gated network caps clears the sandbox floor", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: executableManifest({ executable: true, isolation: "container", sandbox: { network: true, filesystem: [], env: [] } }),
    });
    // The gate PASSES (no sandbox rejection). Risk still computes normally —
    // granting network escalates via the sandbox trifecta legs, so this is
    // parked for approval rather than auto-installed, but crucially it is NOT
    // rejected at the sandbox floor.
    const result = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: installation.id,
      todayKey: "2026-07-06",
    });
    assert.equal(typeof result.risk.effectiveRisk, "string");
    assert.ok(["installed", "decision"].some((k) => k in result));
  } finally {
    await wiring.close();
  }
});

test("modules.install: a purely declarative module (no execution spec) is unaffected by the sandbox floor", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: {
        module: {
          name: "test-fixture-declarative-pkg",
          version: "1.0.0",
          kind: "skill",
          summary: "test fixture declarative module",
          description: "test fixture declarative module",
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
    const result = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: installation.id,
      todayKey: "2026-07-06",
    });
    assert.equal(result.installed, true);
    assert.equal(result.risk.effectiveRisk, "informational");
  } finally {
    await wiring.close();
  }
});
