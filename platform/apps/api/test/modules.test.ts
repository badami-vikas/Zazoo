/**
 * modules.{register,install,list,get,promote,rollback} — P2 capability
 * modules (docs/raw/capability-module-format.md, ADR-018). Mirrors
 * chief-of-staff.test.ts's harness (buildWiring() + appRouter.createCaller).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  InMemoryModuleStore,
  SeededRng,
  SystemClock,
  UuidGen,
  parseModuleManifest,
  promoteToAvailable,
  type RunCtx,
} from "@bridge/core";
import {
  ModuleFilesPathError,
  moduleFilesRoot,
  saveModuleFile,
} from "../src/module-files.js";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  PILOT_USER,
  PILOT_ORGANIZATION,
  retireSupersededBuiltIns,
  type Wiring,
} from "../src/wiring.js";

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
    authenticated: true, // SEC-1: in-process test caller is a trusted, authenticated actor
    verifying: false,
  });
}

function dummyManifest(overrides: Record<string, unknown> = {}) {
  const version = (overrides.version as string | undefined) ?? "1.0.0";
  return {
    module: {
      name: "dummy-test-module",
      version,
      kind: "organization_definition",
      summary: "dummy test module",
      description: "dummy test module description",
      dependencies: [],
      // Read-only, no egress -> informational -> auto-approvable (private
      // audience), so install() can flow all the way through in tests that
      // need an actually-installed row (promote/rollback below). Capability
      // version tracks the module version — capability_manifests has a
      // unique (organization, name, version) constraint, so re-installing the
      // SAME capability version across two module versions would collide
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

test("modules.register: creates a private/pending_review installation, no risk computed yet", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest(),
    });
    assert.equal(installation.state, "private");
    assert.equal(installation.status, "pending_review");
    assert.equal(installation.moduleName, "dummy-test-module");
  } finally {
    await wiring.close();
  }
});

test("modules.register: rejects an invalid manifest with BAD_REQUEST", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () => caller.modules.register({ organizationId: PILOT_ORGANIZATION, manifest: { module: { name: "Bad Name", version: "1.0.0" } } }),
      /BAD_REQUEST|module manifest invalid/,
    );
  } finally {
    await wiring.close();
  }
});

test("modules.register: rejects an authenticated organization nonmember", async () => {
  const wiring = await buildWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "user", id: "d0000000-0000-4000-a000-00000000dead" },
      authenticated: true,
      verifying: false,
    });
    await assert.rejects(
      () => caller.modules.register({ organizationId: PILOT_ORGANIZATION, manifest: dummyManifest() }),
      /not a member/,
    );
  } finally {
    await wiring.close();
  }
});

test("modules.install: an informational-risk module auto-installs, registers its capabilities as draft", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest(),
    });
    const result = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
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

test("modules.install: a transformational-risk module is parked pending user_pref, not auto-installed", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
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
    const result = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
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

test("modules.install: an external-risk module (egress permission) is parked pending_review, never auto-installed", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest({
        capabilities: [
          {
            id: "dummy.egress-cap",
            capability_type: "automation",
            permissions: [{ resource_type: "external_fetch", action: "read", data_scope: "public", egress: true }],
            connectors: [],
          },
        ],
      }),
    });
    const result = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
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

test("modules.install: lethal trifecta assembled across separate bundled capabilities escalates to external even though composite risk alone would not", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
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
            capability_type: "automation",
            permissions: [{ resource_type: "touchpoint", action: "write", data_scope: "all", egress: false }],
            connectors: [{ id: "dummy-sender", external_send: true }],
          },
        ],
      }),
    });
    const result = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
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

test("modules.promote: auto-demotes the prior available version, never two live at once", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation: v1 } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest({ version: "1.0.0" }),
    });

    test("module availability: Commons attachments for different Module Agents remain available together", async () => {
      const wiring = await buildWiring();
      try {
        const manifest = parseModuleManifest(dummyManifest({ name: "shared-commons-skill", version: "1.0.0" }));
        const first = await wiring.moduleStore.create({
          organizationId: PILOT_ORGANIZATION,
          moduleName: manifest.name,
          moduleVersion: manifest.version,
          manifest,
          computedRisk: "informational",
          state: "promoted",
          status: "installed",
          lineageManifestId: null,
          moduleAttachment: {
            source: "commons",
            ownerModuleName: "job-pilot",
            agentId: "application-agent",
            needId: "calendar",
            contentHash: `sha256:${"1".repeat(64)}`,
          },
        });
        const second = await wiring.moduleStore.create({
          organizationId: PILOT_ORGANIZATION,
          moduleName: manifest.name,
          moduleVersion: manifest.version,
          manifest,
          computedRisk: "informational",
          state: "promoted",
          status: "installed",
          lineageManifestId: null,
          moduleAttachment: {
            source: "commons",
            ownerModuleName: "job-pilot",
            agentId: "research-agent",
            needId: "calendar",
            contentHash: `sha256:${"1".repeat(64)}`,
          },
        });

        for (const target of [first, second]) {
          const available = await wiring.moduleStore.getAvailable(
            PILOT_ORGANIZATION,
            target.moduleName,
            target.moduleAttachment,
          );
          const promotion = promoteToAvailable(target, available);
          await wiring.moduleStore.setState(promotion.promoted.installationId, promotion.promoted.nextState);
          if (promotion.demoted) {
            await wiring.moduleStore.setState(promotion.demoted.installationId, promotion.demoted.nextState);
          }
        }

        assert.equal((await wiring.moduleStore.get(first.id))?.state, "available");
        assert.equal((await wiring.moduleStore.get(second.id))?.state, "available");
      } finally {
        await wiring.close();
      }
    });
    await caller.modules.install({ organizationId: PILOT_ORGANIZATION, installationId: v1.id, todayKey: "2026-07-06" });
    const promotedV1 = await caller.modules.promote({ organizationId: PILOT_ORGANIZATION, installationId: v1.id });
    assert.equal(promotedV1.installation.state, "available");

    const { installation: v2 } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest({ version: "2.0.0" }),
    });
    await caller.modules.install({ organizationId: PILOT_ORGANIZATION, installationId: v2.id, todayKey: "2026-07-06" });
    const promotedV2 = await caller.modules.promote({ organizationId: PILOT_ORGANIZATION, installationId: v2.id });
    assert.equal(promotedV2.installation.state, "available");

    const v1After = await caller.modules.get({ installationId: v1.id });
    assert.equal(v1After.installation.state, "legacy");
  } finally {
    await wiring.close();
  }
});

test("modules.rollback: forks a new draft installation from a historical version, never mutates it", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { installation: v1 } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest({ version: "1.0.0" }),
    });
    await caller.modules.install({ organizationId: PILOT_ORGANIZATION, installationId: v1.id, todayKey: "2026-07-06" });
    await caller.modules.promote({ organizationId: PILOT_ORGANIZATION, installationId: v1.id });

    const { installation: v2 } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest({ version: "2.0.0" }),
    });
    await caller.modules.install({ organizationId: PILOT_ORGANIZATION, installationId: v2.id, todayKey: "2026-07-06" });
    await caller.modules.promote({ organizationId: PILOT_ORGANIZATION, installationId: v2.id });

    const { installation: forked } = await caller.modules.rollback({
      organizationId: PILOT_ORGANIZATION,
      rollbackTargetId: v1.id,
    });
    assert.equal(forked.state, "private");
    assert.equal(forked.moduleVersion, "2.0.0-rollback-from-1.0.0");
    assert.equal(forked.lineageManifestId, v1.id);

    const v1Unchanged = await caller.modules.get({ installationId: v1.id });
    assert.equal(v1Unchanged.installation.state, "legacy");
  } finally {
    await wiring.close();
  }
});

test("modules.list: paginates a organization's installations", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const baseline = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 });
    await caller.modules.register({ organizationId: PILOT_ORGANIZATION, manifest: dummyManifest({ name: "dummy-a" }) });
    await caller.modules.register({ organizationId: PILOT_ORGANIZATION, manifest: dummyManifest({ name: "dummy-b" }) });
    const { items, total } = await caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 1, offset: 0 });
    assert.equal(total, baseline.total + 2);
    assert.equal(items.length, 1);
  } finally {
    await wiring.close();
  }
});

test("built-in bootstrap retires standalone Helpdesk and all Calendar versions without deleting history", async () => {
  const store = new InMemoryModuleStore();
  const row = await store.create({
    organizationId: PILOT_ORGANIZATION,
    moduleName: "helpdesk",
    moduleVersion: "1.0.0",
    manifest: parseModuleManifest(dummyManifest({ name: "helpdesk" })),
    computedRisk: "operational",
    state: "available",
    status: "installed",
    lineageManifestId: null,
  });
  const calendarAvailable = await store.create({
    organizationId: PILOT_ORGANIZATION,
    moduleName: "calendar",
    moduleVersion: "0.2.0",
    manifest: parseModuleManifest(dummyManifest({ name: "calendar", version: "0.2.0" })),
    computedRisk: "external",
    state: "available",
    status: "installed",
    lineageManifestId: null,
  });
  const calendarDraft = await store.create({
    organizationId: PILOT_ORGANIZATION,
    moduleName: "calendar",
    moduleVersion: "0.3.0",
    manifest: parseModuleManifest(dummyManifest({ name: "calendar", version: "0.3.0" })),
    computedRisk: "external",
    state: "private",
    status: "pending_review",
    lineageManifestId: calendarAvailable.id,
  });

  await retireSupersededBuiltIns(store, PILOT_ORGANIZATION);

  const retired = await store.get(row.id);
  assert.equal(retired?.state, "legacy");
  assert.equal(retired?.status, "installed");
  assert.equal((await store.get(calendarAvailable.id))?.state, "legacy");
  assert.equal((await store.get(calendarDraft.id))?.state, "legacy");
});
test("modules.files: reads and writes through the configured canonical File root", async () => {
  const bridgeRoot = await mkdtemp(join(tmpdir(), "bridge-module-files-"));
  const wiring = await buildWiring({ moduleFilesBridgeRoot: bridgeRoot });
  try {
    const caller = await makeCaller(wiring);
    const added = await caller.modules.addFile({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "deal-pilot",
      fileName: "notes.txt",
      contentBase64: Buffer.from("private local evidence").toString("base64"),
    });
    const inventory = await caller.modules.files({
      organizationId: PILOT_ORGANIZATION,
      moduleName: "deal-pilot",
    });
    assert.equal(inventory.root, join(bridgeRoot, "Pilot Organization", "DealPilot"));
    assert.equal(added.path, "notes.txt");
    assert.deepEqual(inventory.items.map((item) => item.path), ["notes.txt"]);
    assert.equal(
      await readFile(join(inventory.root, added.path), "utf8"),
      "private local evidence",
    );
  } finally {
    await wiring.close();
    await rm(bridgeRoot, { recursive: true, force: true });
  }
});

test("modules.files: authenticated deployments reject tokenless local-file metadata reads", async () => {
  const wiring = await buildWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "user", id: PILOT_USER },
      authenticated: false,
      verifying: true,
    });
    await assert.rejects(
      () => caller.modules.files({ organizationId: PILOT_ORGANIZATION, moduleName: "deal-pilot" }),
      /verified authentication is required/,
    );
    await assert.rejects(
      () => caller.modules.addFile({
        organizationId: PILOT_ORGANIZATION,
        moduleName: "deal-pilot",
        fileName: "notes.txt",
        contentBase64: Buffer.from("private").toString("base64"),
      }),
      /verified authentication is required/,
    );
    await assert.rejects(
      () => caller.modules.list({ organizationId: PILOT_ORGANIZATION, limit: 10, offset: 0 }),
      /verified authentication is required/,
    );
  } finally {
    await wiring.close();
  }
});

test("moduleFilesRoot: rejects Organization and Module traversal segments", () => {
  assert.throws(() => moduleFilesRoot("..", "DealPilot"), ModuleFilesPathError);
  assert.throws(() => moduleFilesRoot("Bridge", "."), ModuleFilesPathError);
  assert.throws(() => moduleFilesRoot(" .. ", " .. "), ModuleFilesPathError);
});

test("saveModuleFile: writes local bytes without overwrite or path traversal", async () => {
  const bridgeRoot = await mkdtemp(join(tmpdir(), "bridge-module-files-"));
  try {
    const first = await saveModuleFile(
      "Test Organization",
      "Test Module",
      "notes.txt",
      Buffer.from("first"),
      bridgeRoot,
    );
    const second = await saveModuleFile(
      "Test Organization",
      "Test Module",
      "notes.txt",
      Buffer.from("second"),
      bridgeRoot,
    );
    assert.equal(first.path, "notes.txt");
    assert.equal(second.path, "notes (2).txt");
    assert.equal(
      await readFile(join(bridgeRoot, "Test Organization", "Test Module", first.path), "utf8"),
      "first",
    );
    assert.equal(
      await readFile(join(bridgeRoot, "Test Organization", "Test Module", second.path), "utf8"),
      "second",
    );
    await assert.rejects(
      () => saveModuleFile(
        "Test Organization",
        "Test Module",
        "../escape.txt",
        Buffer.from("blocked"),
        bridgeRoot,
      ),
      ModuleFilesPathError,
    );
  } finally {
    await rm(bridgeRoot, { recursive: true, force: true });
  }
});
test("modules.install: re-installing two module versions whose bundled capability keeps the SAME (name, version) is idempotent — reuses the existing manifest instead of colliding with capability_manifests_uq (ADR-024)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    // Both module versions bundle the identical capability id+version —
    // this is the exact known-gap shape from docs/BUGS.md: capability
    // version does NOT track module version here.
    const sharedCapability = {
      id: "dummy.shared-capability",
      capability_type: "skill",
      version: "1.0.0",
      permissions: [{ resource_type: "person", action: "read", data_scope: "all", egress: false }],
      connectors: [],
    };
    const { installation: v1 } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest({ version: "1.0.0", capabilities: [sharedCapability] }),
    });

    const resultV1 = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: v1.id,
      todayKey: "2026-07-06",
    });
    assert.equal(resultV1.installed, true);
    assert.equal(resultV1.registeredManifestIds.length, 1);
    await wiring.capabilityStore.upsertState({
      manifestId: resultV1.registeredManifestIds[0]!,
      organizationId: PILOT_ORGANIZATION,
      state: "active",
      suspended: true,
      suspendReason: "operator pause",
      evidence: { activeRunCount: 9 },
    });

    const { installation: v2 } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest({ version: "2.0.0", capabilities: [sharedCapability] }),
    });
    // Must NOT throw a capability_manifests_uq violation.
    const resultV2 = await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: v2.id,
      todayKey: "2026-07-06",
    });
    assert.equal(resultV2.installed, true);
    assert.equal(resultV2.registeredManifestIds.length, 1);
    // Same underlying manifest id is reused, not a second row.
    assert.equal(resultV2.registeredManifestIds[0], resultV1.registeredManifestIds[0]);
    const preservedState = await wiring.capabilityStore.getState(resultV1.registeredManifestIds[0]!);
    assert.equal(preservedState?.state, "active");
    assert.equal(preservedState?.suspended, true);
    assert.equal(preservedState?.suspendReason, "operator pause");
    assert.deepEqual(preservedState?.evidence, { activeRunCount: 9 });

    const { total } = await wiring.capabilityStore.listManifests(PILOT_ORGANIZATION, { limit: 100, offset: 0 });
    assert.equal(total, 1);
  } finally {
    await wiring.close();
  }
});

test("modules.install: rejects a signed capability collision with different content", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const originalCapability = {
      id: "test-fixture.content-pinned-capability",
      capability_type: "skill",
      version: "1.0.0",
      permissions: [{ resource_type: "person", action: "read", data_scope: "all", egress: false }],
      connectors: [],
    };
    const { installation: original } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest({ version: "1.0.0", capabilities: [originalCapability] }),
    });
    await caller.modules.install({
      organizationId: PILOT_ORGANIZATION,
      installationId: original.id,
      todayKey: "2026-07-16",
    });

    const { installation: collision } = await caller.modules.register({
      organizationId: PILOT_ORGANIZATION,
      manifest: dummyManifest({
        version: "2.0.0",
        capabilities: [{
          ...originalCapability,
          permissions: [{ resource_type: "person", action: "write", data_scope: "all", egress: false }],
        }],
      }),
    });
    await assert.rejects(
      () =>
        caller.modules.install({
          organizationId: PILOT_ORGANIZATION,
          installationId: collision.id,
          todayKey: "2026-07-16",
        }),
      /different signed content/,
    );
  } finally {
    await wiring.close();
  }
});
