/**
 * DrizzleModuleStore — round-trip + jsonb-validation + re-registration
 * idempotency coverage against a real pglite-backed Postgres, mirroring
 * capability-store.test.ts's shape (write-time throws on malformed jsonb;
 * read-time throws rather than silently coercing a pre-existing malformed
 * row). See ADR-023 (docs/raw/decisions-log.md) for the idempotency design.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeCommonsSignedPayload,
  commonsModuleContent,
  computeCommonsContentHash,
  verifyCommonsEntry,
  type CommonsModuleEntry,
  type ModuleManifest,
} from "@bridge/core";
import { createLocalDb, DrizzleModuleStore, parseModuleManifestRow, schema } from "../src/index.js";

async function seedOrganization(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db.insert(schema.organizations).values({ name: "test_fixture_ws_module" }).returning({ id: schema.organizations.id });
  assert.ok(ws);
  return ws.id;
}

function dummyManifest(overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    name: "dummy-module",
    version: "1.0.0",
    kind: "automation",
    summary: "test_fixture_summary",
    description: "test_fixture_description",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        id: "cap-1",
        name: "test_fixture_capability",
        version: "1.0.0",
        capabilityType: "automation",
        origin: "user_code",
        audience: "private",
        permissions: [],
        connectors: [],
        dependencies: [],
      },
    ],
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    ...overrides,
  };
}

test("module store: create + get round-trip, manifest jsonb preserved", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);

    const created = await store.create({
      organizationId,
      moduleName: "dummy-module",
      moduleVersion: "1.0.0",
      manifest: dummyManifest(),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });

    assert.equal(created.moduleName, "dummy-module");

    const fetched = await store.get(created.id);
    assert.ok(fetched);
    assert.equal(fetched.manifest.capabilities.length, 1);
    assert.equal(fetched.manifest.capabilities[0]?.name, "test_fixture_capability");
  } finally {
    await close();
  }
});

test("module store: list paginates within a organization", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);
    for (let i = 0; i < 3; i++) {
      await store.create({
        organizationId,
        moduleName: `dummy-module-${i}`,
        moduleVersion: "1.0.0",
        manifest: dummyManifest({ name: `dummy-module-${i}` }),
        computedRisk: "advisory",
        state: "private",
        status: "pending_review",
        lineageManifestId: null,
      });
    }
    const page = await store.list(organizationId, { limit: 2, offset: 0 });
    assert.equal(page.total, 3);
    assert.equal(page.items.length, 2);
  } finally {
    await close();
  }
});

test("module store: root Commons source attaches idempotently and rejects conflicting envelopes", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);
    const manifest = dummyManifest({ name: "signed-root", kind: "organization_definition" });
    const created = await store.create({
      organizationId,
      moduleName: manifest.name,
      moduleVersion: manifest.version,
      manifest,
      computedRisk: "operational",
      state: "available",
      status: "installed",
      lineageManifestId: null,
    });
    const source = {
      contentHash: `sha256:${"a".repeat(64)}`,
      manifestHash: `sha256:${"b".repeat(64)}`,
      entry: {
        name: manifest.name,
        version: manifest.version,
        kind: manifest.kind,
        summary: manifest.summary,
        tags: ["built-in"],
        manifest,
        provenance: {
          sourceRepository: "https://github.com/example/repo",
          sourceRef: "module",
          inspectedCommit: "0123456789abcdef0123456789abcdef01234567",
          repositoryLicense: "MIT",
          contentLicense: "MIT",
          licenseVerified: true,
        },
        securityScan: {
          scanner: "bridge-commons-manifest" as const,
          scannerVersion: "1.0.0" as const,
          policyVersion: "CM1-2026-07" as const,
          status: "passed" as const,
          riskBand: "operational" as const,
          lethalTrifecta: false,
          checks: [],
        },
        integrity: { algorithm: "sha256" as const, value: `sha256:${"a".repeat(64)}` },
        publishedAt: "2026-07-21T00:00:00.000Z",
      },
    };
    const attached = await store.setCommonsSource(created.id, source);
    assert.equal(attached.commonsSource?.contentHash, source.contentHash);
    assert.equal((await store.setCommonsSource(created.id, source)).id, created.id);
    await assert.rejects(
      () => store.setCommonsSource(created.id, {
        ...source,
        contentHash: `sha256:${"c".repeat(64)}`,
      }),
      /conflicting immutable Commons source/,
    );
  } finally {
    await close();
  }
});

test("module store: installedRootsOnly filters before pagination and totals", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);
    await store.create({
      organizationId,
      moduleName: "available-root",
      moduleVersion: "1.0.0",
      manifest: dummyManifest({ name: "available-root" }),
      computedRisk: "informational",
      state: "available",
      status: "installed",
      lineageManifestId: null,
    });
    await store.create({
      organizationId,
      moduleName: "private-root",
      moduleVersion: "1.0.0",
      manifest: dummyManifest({ name: "private-root" }),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });

    const page = await store.list(organizationId, {
      limit: 1,
      offset: 0,
      installedRootsOnly: true,
    });
    assert.equal(page.total, 1);
    assert.deepEqual(page.items.map((item) => item.moduleName), [
      "available-root",
    ]);
  } finally {
    await close();
  }
});

test("module store: re-registering the SAME name+version is idempotent — returns the existing row, not a duplicate", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);

    const first = await store.create({
      organizationId,
      moduleName: "dummy-idempotent-pkg",
      moduleVersion: "1.0.0",
      manifest: dummyManifest({ name: "dummy-idempotent-pkg" }),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });

    const second = await store.create({
      organizationId,
      moduleName: "dummy-idempotent-pkg",
      moduleVersion: "1.0.0",
      manifest: dummyManifest({ name: "dummy-idempotent-pkg" }),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });

    assert.equal(first.id, second.id, "same (organizationId, moduleName, moduleVersion) must reuse the existing row");

    const versions = await store.listVersions(organizationId, "dummy-idempotent-pkg");
    assert.equal(versions.length, 1, "no duplicate row inserted");
  } finally {
    await close();
  }
});

test("module store: same attachment identity rejects changed immutable content", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);
    const moduleName = "test_fixture_immutable_module";
    const attachment = {
      source: "commons" as const,
      ownerModuleName: "job-pilot",
      agentId: "application-agent",
      needId: "calendar",
      contentHash: `sha256:${"1".repeat(64)}`,
    };
    await store.create({
      organizationId,
      moduleName,
      moduleVersion: "1.0.0",
      manifest: dummyManifest({ name: moduleName }),
      computedRisk: "informational",
      state: "available",
      status: "installed",
      lineageManifestId: null,
      moduleAttachment: attachment,
    });

    await assert.rejects(
      () =>
        store.create({
          organizationId,
          moduleName,
          moduleVersion: "1.0.0",
          manifest: dummyManifest({ name: moduleName, summary: "test_fixture_changed_summary" }),
          computedRisk: "informational",
          state: "available",
          status: "installed",
          lineageManifestId: null,
          moduleAttachment: attachment,
        }),
      /conflicting immutable content/,
    );
    await assert.rejects(
      () =>
        store.create({
          organizationId,
          moduleName,
          moduleVersion: "1.0.0",
          manifest: dummyManifest({ name: moduleName }),
          computedRisk: "informational",
          state: "available",
          status: "installed",
          lineageManifestId: null,
          moduleAttachment: {
            ...attachment,
            contentHash: `sha256:${"2".repeat(64)}`,
          },
        }),
      /conflicting immutable content/,
    );
  } finally {
    await close();
  }
});

test("module store: install v1 -> install v2 -> rollback lifecycle (promote auto-demotes, rollback forks a new draft)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);

    // v1: register -> promote -> available.
    const v1 = await store.create({
      organizationId,
      moduleName: "dummy-lifecycle-pkg",
      moduleVersion: "1.0.0",
      manifest: dummyManifest({ name: "dummy-lifecycle-pkg", version: "1.0.0" }),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });

    await store.setState(v1.id, "promoted");
    const v1Available = await store.setState(v1.id, "available");
    await store.setStatus(v1.id, "installed");
    assert.equal((await store.getAvailable(organizationId, "dummy-lifecycle-pkg"))?.id, v1Available.id);

    // v2: a genuinely NEW version always inserts a new row (not idempotent-deduped,
    // since moduleVersion differs) -> promote -> available auto-demotes v1 to legacy.
    const v2 = await store.create({
      organizationId,
      moduleName: "dummy-lifecycle-pkg",
      moduleVersion: "2.0.0",
      manifest: dummyManifest({ name: "dummy-lifecycle-pkg", version: "2.0.0" }),
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
    });
    assert.notEqual(v2.id, v1.id, "a different moduleVersion must insert a new row");
    await store.setState(v2.id, "promoted");
    await store.setState(v2.id, "available");
    await store.setStatus(v2.id, "installed");
    // Caller (router.ts's modules.promote) is responsible for demoting the prior
    // available row in the same operation — exercise that half of the contract here.
    await store.setState(v1.id, "legacy");

    const nowAvailable = await store.getAvailable(organizationId, "dummy-lifecycle-pkg");
    assert.equal(nowAvailable?.id, v2.id, "v2 is now the single available version");
    const v1AfterDemote = await store.get(v1.id);
    assert.equal(v1AfterDemote?.state, "legacy", "v1 auto-demoted to legacy");

    // rollback: fork a NEW draft row from v1's history, chained via lineageManifestId —
    // never an in-place revert of v1 or v2.
    const rolledBack = await store.create({
      organizationId,
      moduleName: "dummy-lifecycle-pkg",
      moduleVersion: "2.0.1-rollback-from-1.0.0",
      manifest: dummyManifest({ name: "dummy-lifecycle-pkg", version: "2.0.1-rollback-from-1.0.0" }),
      computedRisk: v1AfterDemote.computedRisk,
      state: "private",
      status: "pending_review",
      lineageManifestId: v1.id,
    });
    assert.equal(rolledBack.lineageManifestId, v1.id, "rollback row chains back to the historical version it forked from");
    assert.equal(rolledBack.state, "private", "rollback forks a fresh draft, never mutates history in place");

    const allVersions = await store.listVersions(organizationId, "dummy-lifecycle-pkg");
    assert.equal(allVersions.length, 3, "v1, v2, and the rollback fork all coexist as separate rows");
    // v2 is still available — rollback alone does not activate the forked row.
    assert.equal((await store.getAvailable(organizationId, "dummy-lifecycle-pkg"))?.id, v2.id);
  } finally {
    await close();
  }
});

test("module store: write-time — create throws on a malformed manifest instead of persisting it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);
    await assert.rejects(
      () =>
        store.create({
          organizationId,
          moduleName: "dummy-bad-manifest",
          moduleVersion: "1.0.0",
          // @ts-expect-error — intentionally malformed to prove write-time validation
          manifest: { name: "dummy-bad-manifest" },
          computedRisk: "informational",
          state: "private",
          status: "pending_review",
          lineageManifestId: null,
        }),
      /Invalid module_installations.manifest jsonb/,
    );
  } finally {
    await close();
  }
});

test("module store: read-time — get throws on a manifest shape already-malformed in the row", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    // Insert directly, bypassing DrizzleModuleStore.create entirely — simulates a
    // row written before this fix existed, or by a raw SQL path.
    const [inserted] = await db
      .insert(schema.moduleInstallations)
      .values({
        organizationId,
        moduleName: "dummy-malformed-row",
        moduleVersion: "1.0.0",
        manifest: { not: "a valid module manifest" },
        computedRisk: "informational",
        state: "private",
        status: "pending_review",
      })
      .returning({ id: schema.moduleInstallations.id });
    assert.ok(inserted);
    const store = new DrizzleModuleStore(db);
    await assert.rejects(() => store.get(inserted.id), /Invalid module_installations.manifest jsonb/);
  } finally {
    await close();
  }
});

test("parseModuleManifestRow: throws loudly on a missing required field", () => {
  assert.throws(() => parseModuleManifestRow({ name: "dummy" }), /Invalid module_installations.manifest jsonb/);
});

test("module store: Commons Module attachment preserves the verified content-hash pin", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);
    const manifest = dummyManifest({ name: "dummy-commons-skill", kind: "skill" });
    const content = {
      name: manifest.name,
      version: manifest.version,
      kind: manifest.kind,
      summary: manifest.summary,
      tags: ["need:calendar"],
      manifest,
      provenance: {
        sourceRepository: "https://github.com/example/repo",
        sourceRef: "skill",
        inspectedCommit: "0123456789abcdef0123456789abcdef01234567",
        repositoryLicense: "MIT",
        contentLicense: "MIT",
        licenseVerified: true,
      },
      securityScan: {
        scanner: "bridge-commons-manifest" as const,
        scannerVersion: "1.0.0" as const,
        policyVersion: "CM1-2026-07" as const,
        status: "passed" as const,
        riskBand: "informational" as const,
        lethalTrifecta: false,
        checks: [],
      },
    };
    const hash = (value: string) => `hash(${value})`;
    const integrity = computeCommonsContentHash(content, hash);
    const entry: CommonsModuleEntry = {
      ...content,
      integrity,
      publishedAt: "2026-07-16T00:00:00.000Z",
      signature: {
        signature: `sig(${canonicalizeCommonsSignedPayload(content, integrity, "2026-07-16T00:00:00.000Z")})`,
        publicKey: "trusted-key",
        algorithm: "ed25519",
        signedAt: "2026-07-16T00:00:00.000Z",
      },
    };
    assert.deepEqual(
      verifyCommonsEntry(
        entry,
        hash,
        (data, signature, publicKey) => signature === `sig(${data})` && publicKey === "trusted-key",
        { trustedPublicKeys: ["trusted-key"] },
      ),
      { valid: true },
    );
    assert.equal(computeCommonsContentHash(commonsModuleContent(entry), hash).value, integrity.value);

    const created = await store.create({
      organizationId,
      moduleName: manifest.name,
      moduleVersion: manifest.version,
      manifest,
      computedRisk: "informational",
      state: "private",
      status: "pending_review",
      lineageManifestId: null,
      moduleAttachment: {
        source: "commons",
        ownerModuleName: "job-pilot",
        agentId: "application-agent",
        needId: "calendar",
        contentHash: integrity.value,
      },
    });
    assert.equal((await store.get(created.id))?.moduleAttachment?.contentHash, integrity.value);
  } finally {
    await close();
  }
});

test("module store: concurrent attachment retries converge on one installation", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);
    const manifest = dummyManifest({ name: "calendar-availability", kind: "skill" });
    const proposal = {
      organizationId,
      moduleName: manifest.name,
      moduleVersion: manifest.version,
      manifest,
      computedRisk: "informational" as const,
      state: "private" as const,
      status: "pending_review" as const,
      lineageManifestId: null,
      moduleAttachment: {
        source: "commons" as const,
        ownerModuleName: "job-pilot",
        agentId: "application-agent",
        needId: "interview-calendar-availability",
        contentHash: `sha256:${"1".repeat(64)}`,
      },
    };

    const rows = await Promise.all(Array.from({ length: 8 }, () => store.create(proposal)));
    assert.equal(new Set(rows.map((row) => row.id)).size, 1);
    assert.equal((await store.listVersions(organizationId, manifest.name)).length, 1);
  } finally {
    await close();
  }
});

test("module store: available Commons attachments are scoped to their Module Agent target", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleModuleStore(db);
    const manifest = dummyManifest({ name: "shared-commons-skill", version: "1.0.0" });
    const first = await store.create({
      organizationId,
      moduleName: manifest.name,
      moduleVersion: manifest.version,
      manifest,
      computedRisk: "informational",
      state: "available",
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
    const second = await store.create({
      organizationId,
      moduleName: manifest.name,
      moduleVersion: manifest.version,
      manifest,
      computedRisk: "informational",
      state: "available",
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

    assert.equal(
      (await store.getAvailable(organizationId, manifest.name, first.moduleAttachment))?.id,
      first.id,
    );
    assert.equal(
      (await store.getAvailable(organizationId, manifest.name, second.moduleAttachment))?.id,
      second.id,
    );
    assert.equal(await store.getAvailable(organizationId, manifest.name), null);
  } finally {
    await close();
  }
});
