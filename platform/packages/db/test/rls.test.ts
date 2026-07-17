import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { assertRlsPosture, createLocalDb, schema } from "../src/index.js";

async function setRlsContext(
  db: Awaited<ReturnType<typeof createLocalDb>>["db"],
  workspaceId: string,
  userId?: string,
) {
  await db.execute(sql`select set_config('app.workspace_id', ${workspaceId}, false)`);
  if (userId) await db.execute(sql`select set_config('app.user_id', ${userId}, false)`);
}

async function useRlsAppRole(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  await db.execute(sql`create role bridge_rls_member`);
  await db.execute(sql`grant usage on schema public, app_private to bridge_rls_member`);
  await db.execute(sql`grant select, insert, update, delete on all tables in schema public to bridge_rls_member`);
  await db.execute(sql`grant execute on all functions in schema app_private to bridge_rls_member`);
  await db.execute(sql`set role bridge_rls_member`);
}

test("RLS: workspace-scoped reads are isolated by app.workspace_id", async () => {
  const { db, close } = await createLocalDb();
  try {
    await useRlsAppRole(db);
    const [tenantA] = await db.insert(schema.workspaces).values({ name: "test_fixture_rls_tenant_a" }).returning({ id: schema.workspaces.id });
    const [tenantB] = await db.insert(schema.workspaces).values({ name: "test_fixture_rls_tenant_b" }).returning({ id: schema.workspaces.id });
    assert.ok(tenantA);
    assert.ok(tenantB);

    await setRlsContext(db, tenantA.id);
    const [resourceA] = await db
      .insert(schema.resources)
      .values({ workspaceId: tenantA.id, title: "test_fixture_tenant_a_resource", kind: "article" })
      .returning({ id: schema.resources.id });
    assert.ok(resourceA);
    const [goalA] = await db
      .insert(schema.goals)
      .values({ workspaceId: tenantA.id, type: "test.goal", title: "Tenant A goal" })
      .returning({ id: schema.goals.id });
    assert.ok(goalA);

    await setRlsContext(db, tenantB.id);
    const [resourceB] = await db
      .insert(schema.resources)
      .values({ workspaceId: tenantB.id, title: "test_fixture_tenant_b_resource", kind: "article" })
      .returning({ id: schema.resources.id });
    assert.ok(resourceB);
    const [goalB] = await db
      .insert(schema.goals)
      .values({ workspaceId: tenantB.id, type: "test.goal", title: "Tenant B goal" })
      .returning({ id: schema.goals.id });
    assert.ok(goalB);

    await setRlsContext(db, tenantA.id);
    const rows = await db.select({ id: schema.resources.id }).from(schema.resources);
    assert.deepEqual(rows.map((row) => row.id), [resourceA.id]);
    assert.equal(rows.some((row) => row.id === resourceB.id), false);
    const goals = await db.select({ id: schema.goals.id }).from(schema.goals);
    assert.deepEqual(goals.map((row) => row.id), [goalA.id]);
    assert.equal(goals.some((row) => row.id === goalB.id), false);
  } finally {
    await close();
  }
});

test("RLS: relationship visibility honors workspace/public and private owner scope", async () => {
  const { db, close } = await createLocalDb();
  try {
    await useRlsAppRole(db);
    const [workspace] = await db.insert(schema.workspaces).values({ name: "test_fixture_rls_visibility" }).returning({ id: schema.workspaces.id });
    const [owner] = await db.insert(schema.users).values({ email: "test_fixture_rls_owner@example.com" }).returning({ id: schema.users.id });
    const [other] = await db.insert(schema.users).values({ email: "test_fixture_rls_other@example.com" }).returning({ id: schema.users.id });
    assert.ok(workspace);
    assert.ok(owner);
    assert.ok(other);

    await setRlsContext(db, workspace.id, owner.id);
    const [privatePerson] = await db
      .insert(schema.people)
      .values({ workspaceId: workspace.id, userId: owner.id, visibility: "private", fullNameOverride: "test_fixture_private_person" })
      .returning({ id: schema.people.id });
    const [workspacePerson] = await db
      .insert(schema.people)
      .values({ workspaceId: workspace.id, userId: owner.id, visibility: "workspace", fullNameOverride: "test_fixture_workspace_person" })
      .returning({ id: schema.people.id });
    assert.ok(privatePerson);
    assert.ok(workspacePerson);

    await setRlsContext(db, workspace.id, other.id);
    const visibleToOther = await db.select({ id: schema.people.id }).from(schema.people);
    assert.deepEqual(visibleToOther.map((row) => row.id), [workspacePerson.id]);
  } finally {
    await close();
  }
});

test("assertRlsPosture: production rejects superuser or BYPASSRLS app roles", async () => {
  await assert.rejects(
    () =>
      assertRlsPosture(
        { execute: async () => ({ rows: [] }) },
        { env: "production", roleAttributes: { rolname: "bridge_app", rolsuper: false, rolbypassrls: true } },
      ),
    /must not be superuser or BYPASSRLS/,
  );
  await assert.rejects(
    () =>
      assertRlsPosture(
        { execute: async () => ({ rows: [] }) },
        { env: "production", roleAttributes: { rolname: "bridge_app", rolsuper: true, rolbypassrls: false } },
      ),
    /must not be superuser or BYPASSRLS/,
  );
});

test("assertRlsPosture: development skips enforcement, production accepts ordinary roles", async () => {
  await assert.doesNotReject(() =>
    assertRlsPosture(
      {
        execute: async () => {
          throw new Error("dev should not query role posture");
        },
      },
      { env: "development", roleAttributes: { rolname: "postgres", rolsuper: true, rolbypassrls: true } },
    ),
  );

  await assert.doesNotReject(() =>
    assertRlsPosture(
      { execute: async () => ({ rows: [] }) },
      { env: { NODE_ENV: "production" }, roleAttributes: { rolname: "bridge_app", rolsuper: false, rolbypassrls: false } },
    ),
  );
});
