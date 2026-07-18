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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import {
  createDrizzlePorts,
  createLocalDb,
  ensureLearningAgentGovernance,
  ensureOutreachAgentGovernance,
  ensureEgressAgentGovernance,
  ensureIntakeAgentGovernance,
  ensureDealPilotPrincipalGovernance,
  ensureRelationshipUserGovernance,
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

test("local plane renames the legacy text external-record table before Drizzle migrations", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-legacy-local-plane-"));
  const seed = new PGlite({ dataDir: root });
  try {
    await seed.exec(`
      CREATE TABLE external_records (
        workspace_id text NOT NULL,
        source text NOT NULL,
        source_record_id text NOT NULL,
        entity_type text NOT NULL,
        entity_id text NOT NULL,
        created_at text NOT NULL,
        PRIMARY KEY (workspace_id, source, source_record_id)
      );
      INSERT INTO external_records
        (workspace_id, source, source_record_id, entity_type, entity_id, created_at)
      VALUES
        ('workspace-a', 'gmail', 'message-a', 'touchpoint', 'entity-a', '2026-07-18T00:00:00.000Z');
    `);
  } finally {
    await seed.close();
  }

  try {
    const local = await createLocalDb({ dataDir: root });
    try {
      const canonical = await local.client.query<{
        column_name: string;
        data_type: string;
      }>(
        `SELECT column_name, data_type
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'external_records'`,
      );
      const columns = new Map(
        canonical.rows.map((row) => [row.column_name, row.data_type]),
      );
      assert.equal(columns.get("id"), "uuid");
      assert.equal(columns.get("workspace_id"), "uuid");
      const backup = await local.client.query<{ count: string | number }>(
        `SELECT count(*) AS count FROM local_external_records_legacy`,
      );
      assert.equal(Number(backup.rows[0]?.count), 1);
    } finally {
      await local.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
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
    assert.deepEqual(await ports.agents.capabilityScope(agentId), [
      "signal:write",
      "touchpoint:write",
    ]);
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

test("persistent governance idempotently provisions Human Relation read/write authority", async () => {
  const workspaceId = "b0000000-0000-4000-a000-000000000021";
  const userId = "e0f0053b-fc44-476e-be27-1371e179e921";
  const { db, close } = await createLocalDb();
  let roleAssumed = false;
  try {
    await db.insert(schema.users).values({
      id: userId,
      email: "test_fixture_relation_governance@example.com",
    });
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      name: "Relation governance test",
    });
    const config = { workspaceId, userId };
    await db.execute(sql.raw("CREATE ROLE test_fixture_relation_governance_app"));
    await db.execute(
      sql.raw(
        "GRANT USAGE ON SCHEMA public, app_private TO test_fixture_relation_governance_app",
      ),
    );
    await db.execute(
      sql.raw(
        "GRANT SELECT, INSERT ON TABLE permissions TO test_fixture_relation_governance_app",
      ),
    );
    await db.execute(sql.raw("SET ROLE test_fixture_relation_governance_app"));
    roleAssumed = true;
    await Promise.all(
      Array.from({ length: 10 }, () => ensureRelationshipUserGovernance(db, config)),
    );
    await ensureRelationshipUserGovernance(db, config);
    await db.execute(sql.raw("RESET ROLE"));
    roleAssumed = false;

    const grants = await createDrizzlePorts(db).roles.directGrants(
      workspaceId,
      { type: "user", id: userId },
    );
    assert.deepEqual(
      grants
        .filter((grant) => grant.resourceType === "relation")
        .map((grant) => `${grant.action}:${grant.effect}`)
        .sort(),
      ["read:allow", "write:allow"],
    );
    const rows = (await db.select().from(schema.permissions)).filter(
      (row) =>
        row.workspaceId === workspaceId &&
        row.actorType === "user" &&
        row.actorId === userId &&
        row.resourceType === "relation",
    );
    assert.equal(rows.length, 2);
  } finally {
    if (roleAssumed) await db.execute(sql.raw("RESET ROLE"));
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

test("persistent governance aligns Egress and Intake authority with their governed Skill manifests", async () => {
  const workspaceId = "b0000000-0000-4000-a000-000000000011";
  const userId = "e0f0053b-fc44-476e-be27-1371e179e911";
  const egressAgentId = "b0000000-0000-4000-a000-0000000000e1";
  const intakeAgentId = "b0000000-0000-4000-a000-0000000000e2";
  const { db, close } = await createLocalDb();
  try {
    await db.insert(schema.users).values({ id: userId, email: "runtime-governance@test.invalid" });
    await db.insert(schema.workspaces).values({ id: workspaceId, name: "Runtime governance test" });
    await ensureEgressAgentGovernance(db, {
      workspaceId,
      userId,
      agentId: egressAgentId,
      roleId: "b0000000-0000-4000-a000-0000000000f1",
      permissionId: "b0000000-0000-4000-a000-0000000000c7",
    });

    test("persistent governance provisions DealPilot's Human tool permissions without widening Agent roles", async () => {
      const workspaceId = "b0000000-0000-4000-a000-000000000012";
      const userId = "e0f0053b-fc44-476e-be27-1371e179e912";
      const { db, close } = await createLocalDb();
      try {
        await db.insert(schema.users).values({ id: userId, email: "dealpilot-governance@test.invalid" });
        await db.insert(schema.workspaces).values({ id: workspaceId, name: "DealPilot governance test" });

        await Promise.all(
          Array.from({ length: 5 }, () =>
            ensureDealPilotPrincipalGovernance(db, { workspaceId, userId })),
        );
        await ensureDealPilotPrincipalGovernance(db, { workspaceId, userId });

        const direct = await createDrizzlePorts(db).roles.directGrants(
          workspaceId,
          { type: "user", id: userId },
        );
        assert.equal(
          direct.filter(
            (grant) =>
              grant.resourceType === "tool" &&
              (grant.action === "read" || grant.action === "write") &&
              grant.effect === "allow",
          ).length,
          2,
        );
        assert.equal((await db.select().from(schema.roles)).length, 0);
        assert.equal((await db.select().from(schema.agents)).length, 0);
      } finally {
        await close();
      }
    });
    await ensureIntakeAgentGovernance(db, {
      workspaceId,
      userId,
      agentId: intakeAgentId,
      roleId: "b0000000-0000-4000-a000-0000000000f6",
      permissionId: "b0000000-0000-4000-a000-0000000000c8",
    });

    const ports = createDrizzlePorts(db);
    assert.deepEqual(await ports.agents.allowedSkills(egressAgentId), [
      "dealpilot.source",
      "google.sourceGmail",
      "google.sourceCalendar",
      "google.listCalendarEvents",
    ]);
    assert.deepEqual(await ports.agents.capabilityScope(intakeAgentId), [
      "touchpoint:write",
      "signal:write",
      "person:write",
    ]);
    assert.deepEqual(await ports.agents.allowedSkills(intakeAgentId), ["google.stage"]);
    assert.equal(await ports.agents.workspaceId(intakeAgentId), workspaceId);
    assert.equal(await ports.agents.isActive(intakeAgentId), true);
  } finally {
    await close();
  }
});
