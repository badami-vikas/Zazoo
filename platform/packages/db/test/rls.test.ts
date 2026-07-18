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

test("RLS: Relations isolate private owners and bind writes to the current user", async () => {
  const { db, close } = await createLocalDb();
  try {
    await useRlsAppRole(db);
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_rls_relations" })
      .returning({ id: schema.workspaces.id });
    const [owner] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_rls_relation_owner@example.com" })
      .returning({ id: schema.users.id });
    const [other] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_rls_relation_other@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(workspace);
    assert.ok(owner);
    assert.ok(other);
    const eventId = "10000000-0000-4000-8000-000000000001";
    const privateTargetId = "20000000-0000-4000-8000-000000000001";
    const workspaceTargetId = "20000000-0000-4000-8000-000000000002";
    const publicTargetId = "20000000-0000-4000-8000-000000000003";

    await setRlsContext(db, workspace.id, owner.id);
    const ownerRows = await db
      .insert(schema.edges)
      .values([
        {
          workspaceId: workspace.id,
          ownerUserId: owner.id,
          srcType: "event",
          srcId: eventId,
          dstType: "person",
          dstId: privateTargetId,
          edgeType: "private_relation",
          evidenceRefs: [{ entityType: "event", entityId: eventId }],
          visibility: "private",
          source: "test",
          sourceModule: "relationship",
        },
        {
          workspaceId: workspace.id,
          ownerUserId: owner.id,
          srcType: "event",
          srcId: eventId,
          dstType: "person",
          dstId: workspaceTargetId,
          edgeType: "workspace_relation",
          evidenceRefs: [{ entityType: "event", entityId: eventId }],
          visibility: "workspace",
          source: "test",
          sourceModule: "relationship",
        },
        {
          workspaceId: workspace.id,
          ownerUserId: owner.id,
          srcType: "event",
          srcId: eventId,
          dstType: "person",
          dstId: publicTargetId,
          edgeType: "public_relation",
          evidenceRefs: [{ entityType: "event", entityId: eventId }],
          visibility: "public",
          source: "test",
          sourceModule: "relationship",
        },
      ])
      .returning({ id: schema.edges.id, edgeType: schema.edges.edgeType });
    assert.equal(ownerRows.length, 3);

    await setRlsContext(db, workspace.id, other.id);
    const visibleToOther = await db
      .select({ id: schema.edges.id, edgeType: schema.edges.edgeType })
      .from(schema.edges);
    assert.deepEqual(
      visibleToOther.map((row) => row.edgeType).sort(),
      ["public_relation", "workspace_relation"],
    );
    await assert.rejects(
      () =>
        db.insert(schema.edges).values({
          workspaceId: workspace.id,
          ownerUserId: owner.id,
          srcType: "event",
          srcId: eventId,
          dstType: "person",
          dstId: "20000000-0000-4000-8000-000000000004",
          edgeType: "forged_owner",
          evidenceRefs: [{ entityType: "event", entityId: eventId }],
          visibility: "private",
          source: "test",
          sourceModule: "relationship",
        }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "cause" in error &&
        /row-level security policy/i.test(String(error.cause)),
    );
    const privateOwnerRow = ownerRows.find((row) => row.edgeType === "private_relation");
    assert.ok(privateOwnerRow);
    const forbiddenUpdate = await db
      .update(schema.edges)
      .set({ confidence: "0.5000" })
      .where(sql`${schema.edges.id} = ${privateOwnerRow.id}`)
      .returning({ id: schema.edges.id });
    assert.deepEqual(forbiddenUpdate, []);

    const [otherPrivate] = await db
      .insert(schema.edges)
      .values({
        workspaceId: workspace.id,
        ownerUserId: other.id,
        srcType: "event",
        srcId: eventId,
        dstType: "person",
        dstId: "20000000-0000-4000-8000-000000000005",
        edgeType: "other_private_relation",
        evidenceRefs: [{ entityType: "event", entityId: eventId }],
        visibility: "private",
        source: "test",
        sourceModule: "relationship",
      })
      .returning({ id: schema.edges.id });
    assert.ok(otherPrivate);

    await setRlsContext(db, workspace.id, owner.id);
    const visibleToOwner = await db
      .select({ id: schema.edges.id, edgeType: schema.edges.edgeType })
      .from(schema.edges);
    assert.deepEqual(
      visibleToOwner.map((row) => row.edgeType).sort(),
      ["private_relation", "public_relation", "workspace_relation"],
    );
    assert.equal(visibleToOwner.some((row) => row.id === otherPrivate.id), false);
  } finally {
    await close();
  }
});

/**
 * TASK-010 round-7 review non-blocking gap: a genuine two-member RLS test
 * for migration 0016's new `memories_tenant_select`/`update`/`delete`
 * policies (`app_private.visible_memory_row`) under a REAL, restricted
 * (non-superuser) Postgres role — the SAME `bridge_rls_member`
 * role/pattern the tests above already use for `resources`/`people`/
 * `edges`. Proves owner-aware Memory RLS is enforced at the database
 * layer itself (not merely by `DrizzleMemoryStore`'s own app-side
 * predicate), matching this file's existing per-table coverage
 * convention.
 */
test("RLS: memories isolate private/team/restricted owners while public/workspace stay visible to any member, and UPDATE/DELETE respect the same policy", async () => {
  const { db, close } = await createLocalDb();
  try {
    await useRlsAppRole(db);
    const [workspace] = await db.insert(schema.workspaces).values({ name: "test_fixture_rls_memories" }).returning({ id: schema.workspaces.id });
    const [owner] = await db.insert(schema.users).values({ email: "test_fixture_rls_memories_owner@example.com" }).returning({ id: schema.users.id });
    const [other] = await db.insert(schema.users).values({ email: "test_fixture_rls_memories_other@example.com" }).returning({ id: schema.users.id });
    assert.ok(workspace);
    assert.ok(owner);
    assert.ok(other);

    const memoryBase = {
      workspaceId: workspace.id,
      type: "semantic" as const,
      content: "test_fixture_rls_memory_content",
      confidence: "1",
      trustOrigin: "user_content" as const,
      plane: "local" as const,
      createdBy: owner.id,
      ownerUserId: owner.id,
    };

    await setRlsContext(db, workspace.id, owner.id);
    const [publicMemory] = await db.insert(schema.memories).values({ ...memoryBase, scope: "public" }).returning({ id: schema.memories.id });
    const [workspaceMemory] = await db.insert(schema.memories).values({ ...memoryBase, scope: "workspace" }).returning({ id: schema.memories.id });
    const [teamMemory] = await db.insert(schema.memories).values({ ...memoryBase, scope: "team" }).returning({ id: schema.memories.id });
    const [privateMemory] = await db.insert(schema.memories).values({ ...memoryBase, scope: "private" }).returning({ id: schema.memories.id });
    const [restrictedMemory] = await db.insert(schema.memories).values({ ...memoryBase, scope: "restricted" }).returning({ id: schema.memories.id });
    assert.ok(publicMemory);
    assert.ok(workspaceMemory);
    assert.ok(teamMemory);
    assert.ok(privateMemory);
    assert.ok(restrictedMemory);

    // The owner's own session (app.user_id = owner.id) sees every scope,
    // including its own team/private/restricted rows — proves INSERT...
    // RETURNING and a same-owner SELECT both pass the new policy.
    const visibleToOwner = await db.select({ id: schema.memories.id }).from(schema.memories);
    assert.deepEqual(
      visibleToOwner.map((row) => row.id).sort(),
      [publicMemory.id, workspaceMemory.id, teamMemory.id, privateMemory.id, restrictedMemory.id].sort(),
    );

    // A DIFFERENT workspace member sees only public/workspace — team/
    // private/restricted are all owner-narrowed, enforced by Postgres
    // itself under a real restricted role, not merely by app-side code.
    await setRlsContext(db, workspace.id, other.id);
    const visibleToOther = await db.select({ id: schema.memories.id }).from(schema.memories);
    assert.deepEqual(
      visibleToOther.map((row) => row.id).sort(),
      [publicMemory.id, workspaceMemory.id].sort(),
    );
    for (const hiddenId of [teamMemory.id, privateMemory.id, restrictedMemory.id]) {
      assert.equal(visibleToOther.some((row) => row.id === hiddenId), false);
    }

    // UPDATE: the non-owner's own UPDATE of the private row must affect
    // ZERO rows (the policy hides it from UPDATE just as it does SELECT) —
    // proves the `memories_tenant_update` policy (not just `_select`) is
    // enforced, and that a non-owner cannot even blind-write a row it
    // cannot see. `.returning()` is used (rather than a driver-specific
    // `rowCount`) since pglite's row-count reporting under postgres-js is
    // not reliably populated for a zero-match UPDATE/DELETE.
    const otherUpdateResult = await db
      .update(schema.memories)
      .set({ content: "test_fixture_rls_should_not_apply" })
      .where(sql`${schema.memories.id} = ${privateMemory.id}`)
      .returning({ id: schema.memories.id });
    assert.equal(otherUpdateResult.length, 0, "a non-owner's UPDATE must match zero rows under RLS");

    // DELETE: same proof for the `memories_tenant_delete` policy — the
    // non-owner's DELETE of the restricted row must affect zero rows, and
    // the row must still exist afterward under the owner's own session.
    const otherDeleteResult = await db
      .delete(schema.memories)
      .where(sql`${schema.memories.id} = ${restrictedMemory.id}`)
      .returning({ id: schema.memories.id });
    assert.equal(otherDeleteResult.length, 0, "a non-owner's DELETE must match zero rows under RLS");

    await setRlsContext(db, workspace.id, owner.id);
    const stillThere = await db.select({ id: schema.memories.id }).from(schema.memories).where(sql`${schema.memories.id} = ${restrictedMemory.id}`);
    assert.equal(stillThere.length, 1, "the restricted memory must survive the non-owner's no-op DELETE attempt");

    // The OWNER'S OWN UPDATE/DELETE, by contrast, must succeed — proves the
    // policy narrows by OWNERSHIP, not by blanket-denying all mutation.
    const ownerUpdateResult = await db
      .update(schema.memories)
      .set({ content: "test_fixture_rls_owner_can_update" })
      .where(sql`${schema.memories.id} = ${privateMemory.id}`)
      .returning({ id: schema.memories.id });
    assert.equal(ownerUpdateResult.length, 1, "the owner's own UPDATE must succeed");
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
