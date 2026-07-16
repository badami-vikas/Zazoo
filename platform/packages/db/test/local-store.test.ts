/**
 * Slice A — local-plane store conformance.
 *
 * Boots the local pglite store (client-local.ts), applies the SAME migrations the
 * cloud plane uses, binds the SAME Drizzle ports (createDrizzlePorts), and
 * exercises the read path of the ledger + governance tables. Proves the residency
 * adapter: private data can live on the local plane through the exact bindings the
 * cloud plane uses — no Supabase required. Write round-trips (which need FK-valid
 * seed rows) belong to the pipeline integration slice (E/F).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createDrizzlePorts,
  createLocalDb,
  ensureLearningAgentGovernance,
  ensureOutreachAgentGovernance,
  schema,
} from "../src/index.js";

test("local plane: migrations apply and Drizzle ports read the local store", async () => {
  // UUID columns reject non-UUID text (22P02), so probe with the nil UUID.
  const NIL = "00000000-0000-0000-0000-000000000000";
  const { db, close } = await createLocalDb(); // in-memory pglite
  try {
    const ports = createDrizzlePorts(db);

    // ledger table exists + append-only read path works on the local plane
    assert.equal(await ports.ledger.get(NIL), null);
    assert.equal(await ports.ledger.decisionFor(NIL), null);

    // role_permissions table exists + read works
    assert.deepEqual(await ports.roles.grantsForRole(NIL), []);

    // ephemeral_grants table exists + read works
    const grants = await ports.ephemeral.activeGrants(
      NIL,
      { type: "user", id: NIL },
      undefined,
      new Date(0).toISOString(),
    );
    assert.deepEqual(grants, []);
  } finally {
    await close();
  }
});

test("persistent governance provisions and verifies the attributable Learning Agent Signal grant", async () => {
  const workspaceId = "b0000000-0000-4000-a000-000000000001";
  const userId = "e0f0053b-fc44-476e-be27-1371e179e958";
  const agentId = "b0000000-0000-4000-a000-0000000000d2";
  const roleId = "b0000000-0000-4000-a000-0000000000f2";
  const permissionId = "b0000000-0000-4000-a000-0000000000c2";
  const { db, close } = await createLocalDb();
  try {
    await db.insert(schema.users).values({ id: userId, email: "learning-governance@test.invalid" });
    await db.insert(schema.workspaces).values({ id: workspaceId, name: "Learning governance test" });

    const config = { workspaceId, userId, agentId, roleId, permissionId };
    await Promise.all(
      Array.from({ length: 10 }, () => ensureLearningAgentGovernance(db, config)),
    );
    await ensureLearningAgentGovernance(db, config);

    const ports = createDrizzlePorts(db);
    assert.equal(await ports.agents.assumedRole(agentId), roleId);
    assert.deepEqual(await ports.agents.capabilityScope(agentId), ["signal:write"]);
    assert.ok(
      (await ports.roles.grantsForRole(roleId)).some(
        (grant) =>
          grant.resourceType === "signal" &&
          grant.action === "write" &&
          grant.effect === "allow",
      ),
    );
    assert.ok(
      (await ports.roles.directGrants(workspaceId, { type: "user", id: userId })).some(
        (grant) =>
          grant.resourceType === "signal" &&
          grant.action === "write" &&
          grant.effect === "allow",
      ),
    );
    const principalRows = await db.select().from(schema.permissions);
    assert.equal(
      principalRows.filter(
        (row) =>
          row.workspaceId === workspaceId &&
          row.actorType === "user" &&
          row.actorId === userId &&
          row.resourceType === "signal" &&
          row.resourceId === null &&
          row.action === "write" &&
          row.effect === "allow",
      ).length,
      1,
    );
  } finally {
    await close();
  }
});

test("persistent governance provisions the server-owned Outreach Agent Touchpoint grant", async () => {
  const workspaceId = "b0000000-0000-4000-a000-000000000001";
  const userId = "e0f0053b-fc44-476e-be27-1371e179e958";
  const agentId = "b0000000-0000-4000-a000-0000000000d1";
  const roleId = "b0000000-0000-4000-a000-0000000000f1";
  const permissionId = "b0000000-0000-4000-a000-0000000000c1";
  const { db, close } = await createLocalDb();
  try {
    await db.insert(schema.users).values({ id: userId, email: "outreach-governance@test.invalid" });
    await db.insert(schema.workspaces).values({ id: workspaceId, name: "Outreach governance test" });

    const config = { workspaceId, userId, agentId, roleId, permissionId };
    await Promise.all(
      Array.from({ length: 10 }, () => ensureOutreachAgentGovernance(db, config)),
    );
    await ensureOutreachAgentGovernance(db, config);

    const ports = createDrizzlePorts(db);
    assert.equal(await ports.agents.assumedRole(agentId), roleId);
    assert.deepEqual(await ports.agents.capabilityScope(agentId), ["touchpoint:write"]);
    assert.ok(
      (await ports.roles.grantsForRole(roleId)).some(
        (grant) =>
          grant.resourceType === "touchpoint" &&
          grant.action === "write" &&
          grant.effect === "allow",
      ),
    );
    assert.ok(
      (await ports.roles.directGrants(workspaceId, { type: "user", id: userId })).some(
        (grant) =>
          grant.resourceType === "touchpoint" &&
          grant.action === "write" &&
          grant.effect === "allow",
      ),
    );
    assert.equal(
      (await db.select().from(schema.permissions)).filter(
        (row) =>
          row.workspaceId === workspaceId &&
          row.actorType === "user" &&
          row.actorId === userId &&
          row.resourceType === "touchpoint" &&
          row.resourceId === null &&
          row.action === "write" &&
          row.effect === "allow",
      ).length,
      1,
    );
  } finally {
    await close();
  }
});
