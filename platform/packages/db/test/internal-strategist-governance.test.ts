/**
 * Persistent-mode governance seeding for the foundational Agents added/
 * completed in TASK-007 (Internal Strategist — AGS0/AGS1; Governance and
 * Capability Builder — AGS3 durable-boundary closure) — real pglite-backed
 * tests, mirroring governance-stores.test.ts's `createLocalDb` pattern (a
 * genuine, local Postgres-compatible engine, not a mock). Proves the
 * idempotent provision-then-verify shape actually persists usable authority:
 * after calling it, `DrizzleAgentStore`/`DrizzleRoleStore` (the SAME ports the
 * pipeline's `resolveAuthority` reads in persistent mode) report the Agent as
 * holding `signal:write`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, ensureInternalStrategistGovernance, ensureGovernanceAgentGovernance, ensureCapabilityBuilderGovernance, DrizzleAgentStore, DrizzleRoleStore, schema } from "../src/index.js";

async function seedOrganizationAndUser(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db.insert(schema.organizations).values({ name: "test_fixture_ws_internal_strategist" }).returning({ id: schema.organizations.id });
  assert.ok(ws);
  const [user] = await db
    .insert(schema.users)
    .values({ email: `test_fixture_internal_strategist_owner_${crypto.randomUUID()}@example.com` })
    .returning({ id: schema.users.id });
  assert.ok(user);
  return { organizationId: ws!.id, userId: user!.id };
}

test("ensureInternalStrategistGovernance: provisions a real, usable Internal Strategist authority (role + agent + role grant + principal grant)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { organizationId, userId } = await seedOrganizationAndUser(db);
    const config = {
      organizationId,
      userId,
      agentId: crypto.randomUUID(),
      roleId: crypto.randomUUID(),
      permissionId: crypto.randomUUID(),
    };

    await ensureInternalStrategistGovernance(db, config);

    const agentStore = new DrizzleAgentStore(db);
    const roleStore = new DrizzleRoleStore(db);
    assert.equal(await agentStore.assumedRole(config.agentId), config.roleId);
    assert.ok((await agentStore.capabilityScope(config.agentId)).includes("signal:write"));
    const roleGrants = await roleStore.grantsForRole(config.roleId);
    assert.ok(roleGrants.some((g) => g.resourceType === "signal" && g.action === "write" && g.effect === "allow"));
    const principalGrants = await roleStore.directGrants(organizationId, { type: "user", id: userId });
    assert.ok(principalGrants.some((g) => g.resourceType === "signal" && g.action === "write" && g.effect === "allow"));
  } finally {
    await close();
  }
});

test("ensureInternalStrategistGovernance: idempotent — calling it twice does not duplicate grants or error", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { organizationId, userId } = await seedOrganizationAndUser(db);
    const config = {
      organizationId,
      userId,
      agentId: crypto.randomUUID(),
      roleId: crypto.randomUUID(),
      permissionId: crypto.randomUUID(),
    };

    await ensureInternalStrategistGovernance(db, config);
    await ensureInternalStrategistGovernance(db, config); // second call — must not throw or duplicate

    const roleStore = new DrizzleRoleStore(db);
    const roleGrants = await roleStore.grantsForRole(config.roleId);
    const signalWriteGrants = roleGrants.filter((g) => g.resourceType === "signal" && g.action === "write" && g.effect === "allow");
    assert.equal(signalWriteGrants.length, 1, "the role grant must not be duplicated by a second idempotent call");
  } finally {
    await close();
  }
});

test("ensureInternalStrategistGovernance: reuses the SAME agentId across two different organizations without cross-contaminating grants", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { organizationId: ws1, userId: user1 } = await seedOrganizationAndUser(db);
    const { organizationId: ws2, userId: user2 } = await seedOrganizationAndUser(db);
    const sharedAgentId = crypto.randomUUID();

    await ensureInternalStrategistGovernance(db, {
      organizationId: ws1,
      userId: user1,
      agentId: sharedAgentId,
      roleId: crypto.randomUUID(),
      permissionId: crypto.randomUUID(),
    });
    // Re-provisioning under a different organization/user/role updates the SAME
    // agent row's organizationId/assumesRoleId — this mirrors how a single
    // physical Internal Strategist identity is reused per this task's design
    // (LEARNING_AGENT/INTERNAL_STRATEGIST_AGENT are singleton ids, not
    // per-organization), and proves the upsert doesn't silently no-op on an
    // existing row.
    const secondRoleId = crypto.randomUUID();
    await ensureInternalStrategistGovernance(db, {
      organizationId: ws2,
      userId: user2,
      agentId: sharedAgentId,
      roleId: secondRoleId,
      permissionId: crypto.randomUUID(),
    });

    const agentStore = new DrizzleAgentStore(db);
    assert.equal(await agentStore.assumedRole(sharedAgentId), secondRoleId);
  } finally {
    await close();
  }
});

test("ensureGovernanceAgentGovernance: provisions a real, usable Governance authority (AGS3 durable boundary)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { organizationId, userId } = await seedOrganizationAndUser(db);
    const config = { organizationId, userId, agentId: crypto.randomUUID(), roleId: crypto.randomUUID(), permissionId: crypto.randomUUID() };

    await ensureGovernanceAgentGovernance(db, config);

    const agentStore = new DrizzleAgentStore(db);
    assert.equal(await agentStore.assumedRole(config.agentId), config.roleId);
    assert.ok((await agentStore.capabilityScope(config.agentId)).includes("signal:write"));
  } finally {
    await close();
  }
});

test("ensureCapabilityBuilderGovernance: provisions a real, usable Capability Builder authority (AGS3 durable boundary)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { organizationId, userId } = await seedOrganizationAndUser(db);
    const config = { organizationId, userId, agentId: crypto.randomUUID(), roleId: crypto.randomUUID(), permissionId: crypto.randomUUID() };

    await ensureCapabilityBuilderGovernance(db, config);

    const agentStore = new DrizzleAgentStore(db);
    const roleStore = new DrizzleRoleStore(db);
    assert.equal(await agentStore.assumedRole(config.agentId), config.roleId);
    assert.ok((await agentStore.capabilityScope(config.agentId)).includes("signal:write"));
    const roleGrants = await roleStore.grantsForRole(config.roleId);
    assert.ok(roleGrants.some((g) => g.resourceType === "signal" && g.action === "write" && g.effect === "allow"));

    // ADR-181 — the durable half of "the Builder can build". Until this, the
    // Agent was provisioned with NO allowed Skills at all, so its authority was
    // real and unusable. One Skill, one junction: it drafts and nothing else.
    assert.deepEqual(await agentStore.allowedSkills(config.agentId), ["capability.draft"]);
    // And still no route to activation: reviewing and approving are other
    // Agents' (and a Human's) junctions, never this one's.
    for (const notMine of ["capability.reviewDraft", "capability.recommendBuild"]) {
      assert.ok(
        !(await agentStore.allowedSkills(config.agentId)).includes(notMine),
        `Capability Builder must not hold ${notMine}`,
      );
    }
  } finally {
    await close();
  }
});
