/**
 * packages.{register,install,list,get,promote,rollback} — P2 capability
 * packages (docs/raw/capability-package-format.md, ADR-018). Mirrors
 * chief-of-staff.test.ts's harness (buildWiring() + appRouter.createCaller).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: "dummy_packages_user" },
  });
}

function dummyManifest(overrides: Record<string, unknown> = {}) {
  const version = (overrides.version as string | undefined) ?? "1.0.0";
  return {
    package: {
      name: "dummy-test-package",
      version,
      kind: "workspace_definition",
      summary: "dummy test package",
      description: "dummy test package description",
      dependencies: [],
      // Read-only, no egress -> informational -> auto-approvable (private
      // audience), so install() can flow all the way through in tests that
      // need an actually-installed row (promote/rollback below). Capability
      // version tracks the package version — capability_manifests has a
      // unique (workspace, name, version) constraint, so re-installing the
      // SAME capability version across two package versions would collide
      // (known gap, see docs/BUGS.md).
      capabilities: [
        {
          id: "dummy.informational-read",
          capability_type: "skill",
          version,
          permissions: [{ resource_type: "person", action: "read", data_scope: "all", egress: false }],
          connectors: [],
        },
      ],
      ...overrides,
    },
  };
}

test("packages.register: creates a private/pending_review installation, no risk computed yet", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest(),
    });
    assert.equal(installation.state, "private");
    assert.equal(installation.status, "pending_review");
    assert.equal(installation.packageName, "dummy-test-package");
  } finally {
    await wiring.close();
  }
});

test("packages.register: rejects an invalid manifest with BAD_REQUEST", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () => caller.packages.register({ workspaceId: PILOT_WORKSPACE, manifest: { package: { name: "Bad Name", version: "1.0.0" } } }),
      /BAD_REQUEST|package manifest invalid/,
    );
  } finally {
    await wiring.close();
  }
});

test("packages.install: an informational-risk package auto-installs, registers its capabilities as draft", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest(),
    });
    const result = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: installation.id,
      todayKey: "2026-07-06",
    });
    assert.equal(result.installed, true);
    assert.equal(result.risk.effectiveRisk, "informational");
    assert.equal(result.registeredManifestIds.length, 1);

    const capState = await wiring.capabilityStore.getState(result.registeredManifestIds[0]!);
    assert.equal(capState?.state, "draft");
  } finally {
    await wiring.close();
  }
});

test("packages.install: a transformational-risk package is parked pending user_pref, not auto-installed", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest({
        capabilities: [
          {
            id: "dummy.transformational-write",
            capability_type: "skill",
            permissions: [{ resource_type: "touchpoint", action: "write", data_scope: "all", egress: false }],
            connectors: [],
          },
        ],
      }),
    });
    const result = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: installation.id,
      todayKey: "2026-07-06",
    });
    assert.equal(result.installed, false);
    assert.equal(result.risk.effectiveRisk, "transformational");
    assert.equal(result.decision.requirement, "user_pref");
  } finally {
    await wiring.close();
  }
});

test("packages.install: an external-risk package (egress permission) is parked pending_review, never auto-installed", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest({
        capabilities: [
          {
            id: "dummy.egress-cap",
            capability_type: "workflow",
            permissions: [{ resource_type: "external_fetch", action: "read", data_scope: "public", egress: true }],
            connectors: [],
          },
        ],
      }),
    });
    const result = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: installation.id,
      todayKey: "2026-07-06",
    });
    assert.equal(result.installed, false);
    assert.equal(result.risk.effectiveRisk, "external");
    assert.equal(result.decision.requirement, "explicit_human");
  } finally {
    await wiring.close();
  }
});

test("packages.install: lethal trifecta assembled across separate bundled capabilities escalates to external even though composite risk alone would not", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest({
        capabilities: [
          {
            id: "dummy.private-read",
            capability_type: "skill",
            permissions: [{ resource_type: "person", action: "read", data_scope: "private", egress: false }],
            connectors: [],
          },
          {
            id: "dummy.untrusted-ingest",
            capability_type: "skill",
            permissions: [{ resource_type: "external_fetch", action: "read", data_scope: "public", egress: false }],
            connectors: [],
          },
          {
            id: "dummy.egress-connector",
            capability_type: "workflow",
            permissions: [{ resource_type: "touchpoint", action: "write", data_scope: "all", egress: false }],
            connectors: [{ id: "dummy-sender", external_send: true }],
          },
        ],
      }),
    });
    const result = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: installation.id,
      todayKey: "2026-07-06",
    });
    assert.equal(result.risk.trifectaEscalated, true);
    assert.equal(result.risk.effectiveRisk, "external");
    assert.equal(result.installed, false);
  } finally {
    await wiring.close();
  }
});

test("packages.promote: auto-demotes the prior available version, never two live at once", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation: v1 } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest({ version: "1.0.0" }),
    });
    await caller.packages.install({ workspaceId: PILOT_WORKSPACE, installationId: v1.id, todayKey: "2026-07-06" });
    const promotedV1 = await caller.packages.promote({ workspaceId: PILOT_WORKSPACE, installationId: v1.id });
    assert.equal(promotedV1.installation.state, "available");

    const { installation: v2 } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest({ version: "2.0.0" }),
    });
    await caller.packages.install({ workspaceId: PILOT_WORKSPACE, installationId: v2.id, todayKey: "2026-07-06" });
    const promotedV2 = await caller.packages.promote({ workspaceId: PILOT_WORKSPACE, installationId: v2.id });
    assert.equal(promotedV2.installation.state, "available");

    const v1After = await caller.packages.get({ installationId: v1.id });
    assert.equal(v1After.installation.state, "legacy");
  } finally {
    await wiring.close();
  }
});

test("packages.rollback: forks a new draft installation from a historical version, never mutates it", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation: v1 } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest({ version: "1.0.0" }),
    });
    await caller.packages.install({ workspaceId: PILOT_WORKSPACE, installationId: v1.id, todayKey: "2026-07-06" });
    await caller.packages.promote({ workspaceId: PILOT_WORKSPACE, installationId: v1.id });

    const { installation: v2 } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest({ version: "2.0.0" }),
    });
    await caller.packages.install({ workspaceId: PILOT_WORKSPACE, installationId: v2.id, todayKey: "2026-07-06" });
    await caller.packages.promote({ workspaceId: PILOT_WORKSPACE, installationId: v2.id });

    const { installation: forked } = await caller.packages.rollback({
      workspaceId: PILOT_WORKSPACE,
      rollbackTargetId: v1.id,
    });
    assert.equal(forked.state, "private");
    assert.equal(forked.packageVersion, "2.0.0-rollback-from-1.0.0");
    assert.equal(forked.lineageManifestId, v1.id);

    const v1Unchanged = await caller.packages.get({ installationId: v1.id });
    assert.equal(v1Unchanged.installation.state, "legacy");
  } finally {
    await wiring.close();
  }
});

test("packages.list: paginates a workspace's installations", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await caller.packages.register({ workspaceId: PILOT_WORKSPACE, manifest: dummyManifest({ name: "dummy-a" }) });
    await caller.packages.register({ workspaceId: PILOT_WORKSPACE, manifest: dummyManifest({ name: "dummy-b" }) });
    const { items, total } = await caller.packages.list({ workspaceId: PILOT_WORKSPACE, limit: 1, offset: 0 });
    assert.equal(total, 2);
    assert.equal(items.length, 1);
  } finally {
    await wiring.close();
  }
});

test("packages.install: re-installing two package versions whose bundled capability keeps the SAME (name, version) is idempotent — reuses the existing manifest instead of colliding with capability_manifests_uq (ADR-024)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    // Both package versions bundle the identical capability id+version —
    // this is the exact known-gap shape from docs/BUGS.md: capability
    // version does NOT track package version here.
    const sharedCapability = {
      id: "dummy.shared-capability",
      capability_type: "skill",
      version: "1.0.0",
      permissions: [{ resource_type: "person", action: "read", data_scope: "all", egress: false }],
      connectors: [],
    };
    const { installation: v1 } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest({ version: "1.0.0", capabilities: [sharedCapability] }),
    });
    const resultV1 = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: v1.id,
      todayKey: "2026-07-06",
    });
    assert.equal(resultV1.installed, true);
    assert.equal(resultV1.registeredManifestIds.length, 1);

    const { installation: v2 } = await caller.packages.register({
      workspaceId: PILOT_WORKSPACE,
      manifest: dummyManifest({ version: "2.0.0", capabilities: [sharedCapability] }),
    });
    // Must NOT throw a capability_manifests_uq violation.
    const resultV2 = await caller.packages.install({
      workspaceId: PILOT_WORKSPACE,
      installationId: v2.id,
      todayKey: "2026-07-06",
    });
    assert.equal(resultV2.installed, true);
    assert.equal(resultV2.registeredManifestIds.length, 1);
    // Same underlying manifest id is reused, not a second row.
    assert.equal(resultV2.registeredManifestIds[0], resultV1.registeredManifestIds[0]);

    const { total } = await wiring.capabilityStore.listManifests(PILOT_WORKSPACE, { limit: 100, offset: 0 });
    assert.equal(total, 1);
  } finally {
    await wiring.close();
  }
});
