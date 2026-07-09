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

function generalizedManifest(version = "1.0.0") {
  return {
    name: "example-view",
    version,
    kind: "view",
    summary: "A generalized example view capability.",
    description: "Registry roundtrip fixture — generalized knowledge only.",
    capabilities: [
      {
        id: "example-view.surface",
        capability_type: "view",
        permissions: [{ resource_type: "person", action: "read", data_scope: "all", egress: false }],
      },
    ],
  };
}

test("publish → get roundtrip, list filtering, and privacy-gate rejection over HTTP", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "commons-test-"));
  const app = buildCommonsServer(new FsCommonsStore(dataDir));
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  // publish v1 + v2
  const published = await app.inject({
    method: "POST",
    url: "/v1/packages",
    payload: { manifest: generalizedManifest("1.0.0"), tags: ["graph"] },
  });
  assert.equal(published.statusCode, 201);
  assert.deepEqual(published.json(), { name: "example-view", version: "1.0.0" });
  assert.equal(
    (await app.inject({ method: "POST", url: "/v1/packages", payload: { manifest: generalizedManifest("1.1.0"), tags: ["graph"] } }))
      .statusCode,
    201,
  );

  // duplicate version is immutable → 409
  const dup = await app.inject({ method: "POST", url: "/v1/packages", payload: { manifest: generalizedManifest("1.0.0") } });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error, "duplicate_version");

  // list + filters
  const list = (await app.inject({ url: "/v1/packages?kind=view&tag=graph" })).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].latestVersion, "1.1.0");
  assert.equal(list.items[0].versionCount, 2);
  const misses = (await app.inject({ url: "/v1/packages?tag=nonexistent" })).json();
  assert.equal(misses.total, 0);

  // name detail + exact version
  const detail = (await app.inject({ url: "/v1/packages/example-view" })).json();
  assert.equal(detail.latest.version, "1.1.0");
  assert.equal(detail.versions.length, 2);
  const exact = (await app.inject({ url: "/v1/packages/example-view/1.0.0" })).json();
  assert.equal(exact.manifest.summary, "A generalized example view capability.");
  assert.equal((await app.inject({ url: "/v1/packages/example-view/9.9.9" })).statusCode, 404);
});

test("publishing workspace data is rejected with offending paths (422)", async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), "commons-test-"));
  const app = buildCommonsServer(new FsCommonsStore(dataDir));
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  const leaky = { ...generalizedManifest(), workspaceId: "ws_1", ownerEmail: undefined, created_by: "user_2" };
  const res = await app.inject({ method: "POST", url: "/v1/packages", payload: { manifest: leaky } });
  assert.equal(res.statusCode, 422);
  const body = res.json();
  assert.equal(body.error, "workspace_data_rejected");
  assert.deepEqual(body.offendingPaths.sort(), ["created_by", "workspaceId"]);

  // and nothing was stored
  assert.equal((await app.inject({ url: "/v1/packages/example-view" })).statusCode, 404);
});
