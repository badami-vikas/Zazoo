/**
 * Publish → get roundtrip through the real HTTP contract (fastify inject)
 * backed by the real FsCommonsStore in a temp dir — the exact stack the local
 * service runs, minus the TCP socket.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCommonsServer } from "../src/server.js";
import { FsCommonsStore } from "../src/store.js";

const provenance = {
  sourceRepository: "https://github.com/example/generalized-capability",
  sourceRef: "capability",
  inspectedCommit: "0123456789abcdef0123456789abcdef01234567",
  repositoryLicense: "MIT",
  artifactLicense: "MIT",
  licenseVerified: true,
};
const TEST_PUBLISH_TOKEN = "test-commons-publisher-token-00000001";
const AUTH_HEADERS = { authorization: `Bearer ${TEST_PUBLISH_TOKEN}` };

function buildTestServer(dataDir: string) {
  return buildCommonsServer(new FsCommonsStore(dataDir), { publishToken: TEST_PUBLISH_TOKEN });
}

async function publish(app: ReturnType<typeof buildCommonsServer>, payload: Record<string, unknown>) {
  return await app.inject({ method: "POST", url: "/v1/modules", headers: AUTH_HEADERS, payload });
}

function generalizedManifest(version = "1.0.0", name = "example-view") {
  return {
    name,
    version,
    kind: "view",
    summary: "A generalized example view capability.",
    description: "Registry roundtrip fixture — generalized knowledge only.",
    capabilities: [
      {
        id: `${name}.surface`,
        capability_type: "view",
        permissions: [{ resource_type: "person", action: "read", data_scope: "all", egress: false }],
      },
    ],
  };
}

test("publish → get roundtrip, list filtering, and privacy-gate rejection over HTTP", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "commons-test-"));
  const app = buildTestServer(dataDir);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  // publish v1 + v2
  const unauthorized = await app.inject({
    method: "POST",
    url: "/v1/modules",
    payload: { manifest: generalizedManifest("0.9.0"), provenance },
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.json().error, "publisher_unauthorized");

  const published = await publish(app, {
    manifest: generalizedManifest("1.0.0"),
    tags: ["graph"],
    provenance,
  });
  assert.equal(published.statusCode, 201);
  assert.equal(published.json().name, "example-view");
  assert.match(published.json().contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    (await publish(app, { manifest: generalizedManifest("1.1.0"), tags: ["graph"], provenance })).statusCode,
    201,
  );

  // duplicate version is immutable → 409
  const dup = await publish(app, { manifest: generalizedManifest("1.0.0"), provenance });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error, "duplicate_version");

  const concurrent = await Promise.all([
    publish(app, { manifest: generalizedManifest("1.2.0"), tags: ["graph"], provenance }),
    publish(app, { manifest: generalizedManifest("1.2.0"), tags: ["graph"], provenance }),
  ]);
  assert.deepEqual(concurrent.map((response) => response.statusCode).sort(), [201, 409]);

  // list + filters
  const list = (await app.inject({ url: "/v1/modules?kind=view&tag=graph" })).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].latestVersion, "1.2.0");
  assert.equal(list.items[0].versionCount, 3);
  const misses = (await app.inject({ url: "/v1/modules?tag=nonexistent" })).json();
  assert.equal(misses.total, 0);

  // name detail + exact version
  const detail = (await app.inject({ url: "/v1/modules/example-view" })).json();
  assert.equal(detail.latest.version, "1.2.0");
  assert.equal(detail.versions.length, 3);
  const exact = (await app.inject({ url: "/v1/modules/example-view/1.0.0" })).json();
  assert.equal(exact.manifest.summary, "A generalized example view capability.");
  assert.equal(exact.provenance.inspectedCommit, provenance.inspectedCommit);
  assert.equal(exact.securityScan.status, "passed");
  assert.equal(exact.securityScan.checks.length, 9);
  const scanCopy = exact.securityScan.checks.map((item: { detail: string }) => item.detail).join(" ");
  assert.doesNotMatch(scanCopy, /\b(?:organization|module|artifact)\b/i);
  assert.match(exact.integrity.value, /^sha256:[0-9a-f]{64}$/);
  assert.equal((await app.inject({ url: "/v1/modules/example-view/9.9.9" })).statusCode, 404);
});

test("publishing organization data is rejected with offending paths (422)", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "commons-test-"));
  const app = buildTestServer(dataDir);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const leaky = { ...generalizedManifest(), organizationId: "ws_1", ownerEmail: undefined, created_by: "user_2" };
  const res = await publish(app, { manifest: leaky, provenance });
  assert.equal(res.statusCode, 422);
  const body = res.json();
  assert.equal(body.error, "organization_data_rejected");
  assert.deepEqual(body.offendingPaths.sort(), ["manifest.created_by", "manifest.organizationId"]);

  // and nothing was stored
  assert.equal((await app.inject({ url: "/v1/modules/example-view" })).statusCode, 404);
});

test("publish rejects an expected content-hash mismatch before storage", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "commons-test-"));
  const app = buildTestServer(dataDir);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("publish rejects provenance that would fail read-time trust verification", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "commons-test-"));
    const app = buildTestServer(dataDir);
    t.after(async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    });

    const response = await publish(app, {
      manifest: generalizedManifest(),
      provenance: { ...provenance, sourceRef: "" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_provenance");
    assert.equal((await app.inject({ url: "/v1/modules/example-view" })).statusCode, 404);
  });

  const response = await publish(app, {
    manifest: generalizedManifest(),
    provenance,
    expectedContentHash: `sha256:${"0".repeat(64)}`,
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, "content_hash_mismatch");
  assert.equal((await app.inject({ url: "/v1/modules/example-view" })).statusCode, 404);
});

test("publish scan resolves and verifies the exact dependency closure", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "commons-test-"));
  const app = buildTestServer(dataDir);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("publish scan rejects Organization Blueprint capability references without exact signed pins", async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), "commons-test-"));
    const app = buildTestServer(dataDir);
    t.after(async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    });
    const response = await publish(app, {
      manifest: {
        name: "test-fixture-unpinned-blueprint",
        version: "1.0.0",
        kind: "organization_definition",
        summary: "A generalized organization definition.",
        description: "A declarative organization fixture.",
        capabilities: [],
        blueprint: {
          vocabulary: {},
          entities: [],
          views: [],
          capabilities: ["cap.people-directory@1.0.0"],
        },
      },
      provenance,
    });
    assert.equal(response.statusCode, 422);
    assert.ok(response.json().securityScan.checks.some((item: { id: string; status: string }) =>
      item.id === "blueprint-capability-pins" && item.status === "fail"
    ));
  });

  const dependent = {
    ...generalizedManifest("1.0.0", "dependent-view"),
    dependencies: [{ manifestId: "shared-foundation", version: "1.0.0" }],
  };
  const unresolved = await publish(app, { manifest: dependent, provenance });
  assert.equal(unresolved.statusCode, 422);
  assert.equal(unresolved.json().error, "security_scan_failed");
  assert.ok(unresolved.json().securityScan.checks.some((item: { id: string; status: string }) =>
    item.id === "dependency-pins" && item.status === "fail"
  ));

  assert.equal(
    (await publish(app, {
      manifest: generalizedManifest("1.0.0", "shared-foundation"),
      provenance,
    })).statusCode,
    201,
  );
  const resolved = await publish(app, { manifest: dependent, provenance });
  assert.equal(resolved.statusCode, 201);
  const stored = (await app.inject({ url: "/v1/modules/dependent-view/1.0.0" })).json();
  const foundation = (await app.inject({ url: "/v1/modules/shared-foundation/1.0.0" })).json();
  assert.deepEqual(stored.securityScan.dependencyPins, [{
    name: "shared-foundation",
    version: "1.0.0",
    contentHash: foundation.integrity.value,
  }]);
  assert.ok(stored.securityScan.checks.some((item: { id: string; detail: string }) =>
    item.id === "dependency-pins" && item.detail.includes("resolved and verified")
  ));
});

test("publish scan gate rejects an unverified artifact license and surfaces evidence", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "commons-test-"));
  const app = buildTestServer(dataDir);
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const response = await publish(app, {
    manifest: generalizedManifest(),
    provenance: { ...provenance, artifactLicense: "NOASSERTION", licenseVerified: false },
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error, "security_scan_failed");
  assert.equal(response.json().securityScan.status, "failed");
  assert.ok(response.json().securityScan.checks.some((item: { id: string; status: string }) =>
    item.id === "artifact-license" && item.status === "fail"
  ));
});
