/**
 * DrizzlePackageStore — round-trip + jsonb-validation + re-registration
 * idempotency coverage against a real pglite-backed Postgres, mirroring
 * capability-store.test.ts's shape (write-time throws on malformed jsonb;
 * read-time throws rather than silently coercing a pre-existing malformed
 * row). See ADR-023 (docs/raw/decisions-log.md) for the idempotency design.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { PackageManifest } from "@bridge/core";
import { createLocalDb, DrizzlePackageStore, parsePackageManifestRow, schema } from "../src/index.js";

async function seedWorkspace(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db.insert(schema.workspaces).values({ name: "dummy_ws_package" }).returning({ id: schema.workspaces.id });
  assert.ok(ws);
  return ws.id;
}

function dummyManifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    name: "dummy-package",
    version: "1.0.0",
    kind: "workflow",
    summary: "dummy_summary",
    description: "dummy_description",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        id: "cap-1",
        name: "dummy_capability",
        version: "1.0.0",
        capabilityType: "workflow",
        origin: "user_code",
        audience: "private",
        permissions: [],
        connectors: [],
        dependencies: [],
      },
    ],
    contextProviders: [],
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    ...overrides,
  };
}

test("package store: create + get round-trip, manifest jsonb preserved", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzlePackageStore(db);

    const created = await store.create({
      workspaceId,
      packageName: "dummy-package",
      packageVersion: "1.0.0",
      manifest: dummyManifest(),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });
    assert.equal(created.packageName, "dummy-package");

    const fetched = await store.get(created.id);
    assert.ok(fetched);
    assert.equal(fetched.manifest.capabilities.length, 1);
    assert.equal(fetched.manifest.capabilities[0]?.name, "dummy_capability");
  } finally {
    await close();
  }
});

test("package store: list paginates within a workspace", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzlePackageStore(db);
    for (let i = 0; i < 3; i++) {
      await store.create({
        workspaceId,
        packageName: `dummy-package-${i}`,
        packageVersion: "1.0.0",
        manifest: dummyManifest({ name: `dummy-package-${i}` }),
        computedRisk: "advisory",
        state: "private",
        status: "pending_review",
        lineageManifestId: null,
      });
    }
    const page = await store.list(workspaceId, { limit: 2, offset: 0 });
    assert.equal(page.total, 3);
    assert.equal(page.items.length, 2);
  } finally {
    await close();
  }
});

test("package store: re-registering the SAME name+version is idempotent — returns the existing row, not a duplicate", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzlePackageStore(db);

    const first = await store.create({
      workspaceId,
      packageName: "dummy-idempotent-pkg",
      packageVersion: "1.0.0",
      manifest: dummyManifest({ name: "dummy-idempotent-pkg" }),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });

    const second = await store.create({
      workspaceId,
      packageName: "dummy-idempotent-pkg",
      packageVersion: "1.0.0",
      manifest: dummyManifest({ name: "dummy-idempotent-pkg" }),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });

    assert.equal(first.id, second.id, "same (workspaceId, packageName, packageVersion) must reuse the existing row");

    const versions = await store.listVersions(workspaceId, "dummy-idempotent-pkg");
    assert.equal(versions.length, 1, "no duplicate row inserted");
  } finally {
    await close();
  }
});

test("package store: install v1 -> install v2 -> rollback lifecycle (promote auto-demotes, rollback forks a new draft)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzlePackageStore(db);

    // v1: register -> promote -> available.
    const v1 = await store.create({
      workspaceId,
      packageName: "dummy-lifecycle-pkg",
      packageVersion: "1.0.0",
      manifest: dummyManifest({ name: "dummy-lifecycle-pkg", version: "1.0.0" }),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });
    await store.setState(v1.id, "promoted");
    const v1Available = await store.setState(v1.id, "available");
    await store.setStatus(v1.id, "installed");
    assert.equal((await store.getAvailable(workspaceId, "dummy-lifecycle-pkg"))?.id, v1Available.id);

    // v2: a genuinely NEW version always inserts a new row (not idempotent-deduped,
    // since packageVersion differs) -> promote -> available auto-demotes v1 to legacy.
    const v2 = await store.create({
      workspaceId,
      packageName: "dummy-lifecycle-pkg",
      packageVersion: "2.0.0",
      manifest: dummyManifest({ name: "dummy-lifecycle-pkg", version: "2.0.0" }),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });
    assert.notEqual(v2.id, v1.id, "a different packageVersion must insert a new row");
    await store.setState(v2.id, "promoted");
    await store.setState(v2.id, "available");
    await store.setStatus(v2.id, "installed");
    // Caller (router.ts's packages.promote) is responsible for demoting the prior
    // available row in the same operation — exercise that half of the contract here.
    await store.setState(v1.id, "legacy");

    const nowAvailable = await store.getAvailable(workspaceId, "dummy-lifecycle-pkg");
    assert.equal(nowAvailable?.id, v2.id, "v2 is now the single available version");
    const v1AfterDemote = await store.get(v1.id);
    assert.equal(v1AfterDemote?.state, "legacy", "v1 auto-demoted to legacy");

    // rollback: fork a NEW draft row from v1's history, chained via lineageManifestId —
    // never an in-place revert of v1 or v2.
    const rolledBack = await store.create({
      workspaceId,
      packageName: "dummy-lifecycle-pkg",
      packageVersion: "2.0.1-rollback-from-1.0.0",
      manifest: dummyManifest({ name: "dummy-lifecycle-pkg", version: "2.0.1-rollback-from-1.0.0" }),
      computedRisk: v1AfterDemote.computedRisk,
      state: "private",
      status: "pending_review",
      lineageManifestId: v1.id,
    });
    assert.equal(rolledBack.lineageManifestId, v1.id, "rollback row chains back to the historical version it forked from");
    assert.equal(rolledBack.state, "private", "rollback forks a fresh draft, never mutates history in place");

    const allVersions = await store.listVersions(workspaceId, "dummy-lifecycle-pkg");
    assert.equal(allVersions.length, 3, "v1, v2, and the rollback fork all coexist as separate rows");
    // v2 is still available — rollback alone does not activate the forked row.
    assert.equal((await store.getAvailable(workspaceId, "dummy-lifecycle-pkg"))?.id, v2.id);
  } finally {
    await close();
  }
});

test("package store: write-time — create throws on a malformed manifest instead of persisting it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzlePackageStore(db);
    await assert.rejects(
      () =>
        store.create({
          workspaceId,
          packageName: "dummy-bad-manifest",
          packageVersion: "1.0.0",
          // @ts-expect-error — intentionally malformed to prove write-time validation
          manifest: { name: "dummy-bad-manifest" },
          computedRisk: "informational",
          state: "private",
          status: "pending_review",
          lineageManifestId: null,
        }),
      /Invalid package_installations.manifest jsonb/,
    );
  } finally {
    await close();
  }
});

test("package store: read-time — get throws on a manifest shape already-malformed in the row", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    // Insert directly, bypassing DrizzlePackageStore.create entirely — simulates a
    // row written before this fix existed, or by a raw SQL path.
    const [inserted] = await db
      .insert(schema.packageInstallations)
      .values({
        workspaceId,
        packageName: "dummy-malformed-row",
        packageVersion: "1.0.0",
        manifest: { not: "a valid package manifest" },
        computedRisk: "informational",
        state: "private",
        status: "pending_review",
      })
      .returning({ id: schema.packageInstallations.id });
    assert.ok(inserted);
    const store = new DrizzlePackageStore(db);
    await assert.rejects(() => store.get(inserted.id), /Invalid package_installations.manifest jsonb/);
  } finally {
    await close();
  }
});

test("parsePackageManifestRow: throws loudly on a missing required field", () => {
  assert.throws(() => parsePackageManifestRow({ name: "dummy" }), /Invalid package_installations.manifest jsonb/);
});
