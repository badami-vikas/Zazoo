import { test } from "node:test";
import assert from "node:assert/strict";

import {
  advancePackageState,
  InvalidPackageTransitionError,
  promoteToAvailable,
  rollbackFromHistory,
  InMemoryPackageStore,
  type PackageInstallationRow,
} from "../src/index.js";

function row(overrides: Partial<PackageInstallationRow> = {}): PackageInstallationRow {
  return {
    id: "test_fixture_row_1",
    workspaceId: "test_fixture_ws",
    packageName: "dummy-package",
    packageVersion: "1.0.0",
    manifest: {
      name: "dummy-package",
      version: "1.0.0",
      kind: "workspace_definition",
      summary: "s",
      description: "d",
      lineageManifestId: null,
      dependencies: [],
      capabilities: [],
      contextProviders: [],
      workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    },
    computedRisk: "informational",
    state: "private",
    status: "pending_review",
    lineageManifestId: null,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

test("advancePackageState: walks the forward chain", () => {
  assert.equal(advancePackageState("private"), "promoted");
  assert.equal(advancePackageState("promoted"), "available");
  assert.equal(advancePackageState("available"), "legacy");
  assert.equal(advancePackageState("legacy"), "deprecating");
  assert.equal(advancePackageState("deprecating"), "deprecated");
});

test("advancePackageState: deprecated is terminal", () => {
  assert.throws(() => advancePackageState("deprecated"), InvalidPackageTransitionError);
});

test("promoteToAvailable: first-ever promotion has no demoted version", () => {
  const target = row({ id: "v1", state: "promoted" });
  const result = promoteToAvailable(target, null);
  assert.equal(result.promoted.installationId, "v1");
  assert.equal(result.promoted.nextState, "available");
  assert.equal(result.demoted, undefined);
});

test("promoteToAvailable: auto-demotes the prior available version, never two live at once", () => {
  const prior = row({ id: "v1", state: "available" });
  const target = row({ id: "v2", state: "promoted" });
  const result = promoteToAvailable(target, prior);
  assert.equal(result.promoted.installationId, "v2");
  assert.equal(result.promoted.nextState, "available");
  assert.equal(result.demoted?.installationId, "v1");
  assert.equal(result.demoted?.nextState, "legacy");
});

test("promoteToAvailable: rejects a target not in the promoted state", () => {
  const target = row({ id: "v1", state: "private" });
  assert.throws(() => promoteToAvailable(target, null), InvalidPackageTransitionError);
});

test("promoteToAvailable: rejects mismatched workspace/package for the currently-available row", () => {
  const prior = row({ id: "v1", state: "available", packageName: "other-package" });
  const target = row({ id: "v2", state: "promoted" });
  assert.throws(() => promoteToAvailable(target, prior), /same workspace\+package/);
});

test("rollbackFromHistory: forks a NEW draft row, never mutating the historical one", () => {
  const current = row({ id: "current", packageVersion: "1.2.0", state: "available" });
  const historical = row({ id: "hist", packageVersion: "1.1.0", state: "legacy" });
  const forked = rollbackFromHistory({ currentAvailable: current, rollbackTarget: historical });

  assert.equal(forked.packageVersion, "1.2.0-rollback-from-1.1.0");
  assert.equal(forked.state, "private");
  assert.equal(forked.status, "pending_review");
  assert.equal(forked.lineageManifestId, "hist");
  // historical row itself is untouched (this function returns a NEW row, doesn't take a store).
  assert.equal(historical.state, "legacy");
});

test("rollbackFromHistory: rejects a cross-package rollback target", () => {
  const current = row({ id: "current", packageName: "package-a" });
  const historical = row({ id: "hist", packageName: "package-b" });
  assert.throws(() => rollbackFromHistory({ currentAvailable: current, rollbackTarget: historical }), /same package name/);
});

test("InMemoryPackageStore: create/get/list round trip", async () => {
  const store = new InMemoryPackageStore();
  const created = await store.create({
    workspaceId: "test_fixture_ws",
    packageName: "dummy-package",
    packageVersion: "1.0.0",
    manifest: row().manifest,
    computedRisk: "informational",
    state: "private",
    status: "pending_review",
    lineageManifestId: null,
  });
  assert.ok(created.id);
  const fetched = await store.get(created.id);
  assert.equal(fetched?.packageName, "dummy-package");
  const { items, total } = await store.list("test_fixture_ws", { limit: 10, offset: 0 });
  assert.equal(total, 1);
  assert.equal(items[0]?.id, created.id);
});

test("InMemoryPackageStore: getAvailable returns the one available version", async () => {
  const store = new InMemoryPackageStore();
  const v1 = await store.create({
    workspaceId: "test_fixture_ws",
    packageName: "dummy-package",
    packageVersion: "1.0.0",
    manifest: row().manifest,
    computedRisk: "informational",
    state: "available",
    status: "installed",
    lineageManifestId: null,
  });
  await store.create({
    workspaceId: "test_fixture_ws",
    packageName: "dummy-package",
    packageVersion: "0.9.0",
    manifest: row().manifest,
    computedRisk: "informational",
    state: "legacy",
    status: "installed",
    lineageManifestId: null,
  });
  const available = await store.getAvailable("test_fixture_ws", "dummy-package");
  assert.equal(available?.id, v1.id);
});

test("InMemoryPackageStore: setState/setStatus mutate a single row", async () => {
  const store = new InMemoryPackageStore();
  const created = await store.create({
    workspaceId: "test_fixture_ws",
    packageName: "dummy-package",
    packageVersion: "1.0.0",
    manifest: row().manifest,
    computedRisk: "informational",
    state: "private",
    status: "pending_review",
    lineageManifestId: null,
  });
  const promoted = await store.setState(created.id, "promoted");
  assert.equal(promoted.state, "promoted");
  const installed = await store.setStatus(created.id, "installed");
  assert.equal(installed.status, "installed");
});
