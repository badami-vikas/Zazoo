/**
 * Slice B — integration permission management, on the local plane.
 *
 * Exercises the governed editable-permission surface end to end against a real
 * (pglite) database: connect an integration, grant standing Bridge capabilities,
 * list them, narrow (revoke) one, refuse an agent-floor DENY scope, and confirm
 * disconnect revokes everything. Append-only throughout (revoked_at, never delete).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalDb,
  DrizzleIntegrationStore,
  IntegrationFloorScopeError,
  schema,
} from "../src/index.js";

test("integration permissions: connect, grant, list, narrow, floor-scope guard, disconnect", async () => {
  const { db, close } = await createLocalDb();
  try {
    // Seed the workspace the integration + grants reference (FK target).
    const [ws] = await db.insert(schema.workspaces).values({ name: "dummy_ws" }).returning({
      id: schema.workspaces.id,
    });
    assert.ok(ws, "workspace seeded");
    const store = new DrizzleIntegrationStore(db);

    // Connect an X integration with its declared OAuth scopes.
    const integ = await store.connect(ws.id, "x", ["tweet.read", "tweet.write"]);
    assert.equal(integ.provider, "x");
    assert.equal(integ.status, "active");
    assert.deepEqual(await store.listScopes(ws.id, integ.id), []);

    // Grant two standing Bridge capabilities.
    const fetchGrant = await store.grantScope({
      workspaceId: ws.id,
      integrationId: integ.id,
      resourceType: "external:fetch",
      action: "read",
    });
    await store.grantScope({
      workspaceId: ws.id,
      integrationId: integ.id,
      resourceType: "touchpoint",
      action: "write",
    });
    let scopes = await store.listScopes(ws.id, integ.id);
    assert.equal(scopes.length, 2);
    assert.ok(scopes.every((s) => s.effect === "allow"));

    // Agent-floor DENY scope cannot be granted as a standing allow.
    await assert.rejects(
      () =>
        store.grantScope({
          workspaceId: ws.id,
          integrationId: integ.id,
          resourceType: "external:send",
          action: "share",
        }),
      IntegrationFloorScopeError,
    );

    // Narrow: revoke one grant; history is preserved (append-only) but it stops listing.
    await store.revokeScope(ws.id, fetchGrant.id, new Date("2026-06-20T00:00:00Z"));
    scopes = await store.listScopes(ws.id, integ.id);
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0]?.resourceType, "touchpoint");

    // Disconnect revokes the integration and every remaining standing grant.
    await store.disconnect(ws.id, integ.id, new Date("2026-06-20T00:00:00Z"));
    assert.deepEqual(await store.listScopes(ws.id, integ.id), []);
    const list = await store.list(ws.id);
    assert.equal(list.find((i) => i.id === integ.id)?.status, "revoked");
  } finally {
    await close();
  }
});
