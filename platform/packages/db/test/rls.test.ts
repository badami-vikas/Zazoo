import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import {
  assertRlsPosture,
  createDrizzlePorts,
  createLocalDb,
  DrizzleOrganizationStore,
  DrizzleResourcesStore,
  schema,
  withOrganizationContext,
} from "../src/index.js";

async function setRlsContext(
  db: Awaited<ReturnType<typeof createLocalDb>>["db"],
  organizationId: string,
  userId?: string,
) {
  await db.execute(sql`select set_config('app.organization_id', ${organizationId}, false)`);
  if (userId) await db.execute(sql`select set_config('app.user_id', ${userId}, false)`);
}

async function useRlsAppRole(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  await db.execute(sql`create role bridge_rls_member`);
  await db.execute(sql`grant usage on schema public, app_private to bridge_rls_member`);
  await db.execute(sql`grant select, insert, update, delete on all tables in schema public to bridge_rls_member`);
  await db.execute(sql`grant execute on all functions in schema app_private to bridge_rls_member`);
  await db.execute(sql`set role bridge_rls_member`);
}

test("RLS: private Tasks are visible only to their Human owner", async () => {
  const { db, close } = await createLocalDb();
  const organizationId = "10000000-0000-4000-8000-000000000127";
  const ownerId = "20000000-0000-4000-8000-000000000127";
  const otherId = "20000000-0000-4000-8000-000000000128";
  try {
    await db.insert(schema.users).values([
      { id: ownerId, email: "test_fixture_task_owner@example.com" },
      { id: otherId, email: "test_fixture_task_other@example.com" },
    ]);
    await db.insert(schema.organizations).values({ id: organizationId, name: "Task visibility" });
    await useRlsAppRole(db);
    await setRlsContext(db, organizationId, ownerId);
    const [privateTask] = await db.insert(schema.tasks).values({
      organizationId,
      path: "1",
      title: "Private Task",
      type: "task",
      isGoal: true,
      ownerType: "human",
      ownerId,
      visibility: "private",
    }).returning({ id: schema.tasks.id });
    const [organizationTask] = await db.insert(schema.tasks).values({
      organizationId,
      path: "2",
      title: "Organization Task",
      type: "task",
      isGoal: true,
      ownerType: "human",
      ownerId,
      visibility: "organization",
    }).returning({ id: schema.tasks.id });
    assert.ok(privateTask);
    assert.ok(organizationTask);
    await setRlsContext(db, organizationId, otherId);
    const visible = await db.select({ id: schema.tasks.id }).from(schema.tasks);
    assert.deepEqual(visible.map((task) => task.id), [organizationTask.id]);
  } finally {
    await close();
  }
});

test("RLS: Events stay append-only and Events/Files remain Organization-isolated", async () => {
  const { db, close } = await createLocalDb();
  const organizationA = "10000000-0000-4000-8000-000000000123";
  const organizationB = "10000000-0000-4000-8000-000000000124";
  const userA = "20000000-0000-4000-8000-000000000123";
  const userB = "20000000-0000-4000-8000-000000000124";
  try {
    await db.insert(schema.users).values([
      { id: userA, email: "test_fixture_vocab4_a@example.com" },
      { id: userB, email: "test_fixture_vocab4_b@example.com" },
    ]);
    await db.insert(schema.organizations).values([
      { id: organizationA, name: "VOCAB4 A" },
      { id: organizationB, name: "VOCAB4 B" },
    ]);
    await useRlsAppRole(db);
    await setRlsContext(db, organizationA, userA);
    const eventId = "30000000-0000-4000-8000-000000000123";
    const fileId = "40000000-0000-4000-8000-000000000123";
    await db.insert(schema.events).values({
      id: eventId,
      organizationId: organizationA,
      type: "test_fixture_vocab4",
      entityType: "event",
      entityId: eventId,
    });
    await db.insert(schema.files).values({
      id: fileId,
      organizationId: organizationA,
      source: "test_fixture_vocab4",
      storageRef: "module://test/file.txt",
    });
    await db.insert(schema.fileRefs).values({
      fileId,
      entityType: "module",
      entityId: "50000000-0000-4000-8000-000000000123",
    });
    assert.deepEqual(
      await db.update(schema.events)
        .set({ type: "changed" })
        .where(sql`${schema.events.id} = ${eventId}`)
        .returning({ id: schema.events.id }),
      [],
    );
    assert.deepEqual(
      await db.delete(schema.events)
        .where(sql`${schema.events.id} = ${eventId}`)
        .returning({ id: schema.events.id }),
      [],
    );
    await setRlsContext(db, organizationB, userB);
    assert.deepEqual(await db.select().from(schema.events), []);
    assert.deepEqual(await db.select().from(schema.files), []);
    assert.deepEqual(await db.select().from(schema.fileRefs), []);
    await assert.rejects(
      () => db.insert(schema.fileRefs).values({
        fileId,
        entityType: "module",
        entityId: "50000000-0000-4000-8000-000000000124",
      }),
      /Failed query|row-level security/i,
    );
  } finally {
    await close();
  }
});

test("RLS: bridge_app stores scope transaction-locally and reject cross-Organization nesting", async () => {
  const { db, close } = await createLocalDb();
  const organizationA = "10000000-0000-4000-8000-000000000101";
  const organizationB = "10000000-0000-4000-8000-000000000102";
  const userA = "20000000-0000-4000-8000-000000000101";
  const userB = "20000000-0000-4000-8000-000000000102";
  try {
    await db.execute(sql`SET ROLE bridge_app`);
    await assertRlsPosture(db, { env: "production" });

    const organizations = new DrizzleOrganizationStore(db);
    const resources = new DrizzleResourcesStore(db);
    await organizations.bootstrapPilotIdentities({
      organizationId: organizationA,
      userId: userA,
      userEmail: "test_fixture_bridge_app_a@example.com",
    });
    await organizations.bootstrapPilotIdentities({
      organizationId: organizationB,
      userId: userB,
      userEmail: "test_fixture_bridge_app_b@example.com",
    });
    await organizations.ensureMember({
      organizationId: organizationA,
      userId: userA,
      userEmail: "test_fixture_bridge_app_a_updated@example.com",
    });
    await organizations.ensureMember({
      organizationId: organizationA,
      userId: userA,
      userEmail: "test_fixture_bridge_app_a_updated@example.com",
    });
    assert.equal(await organizations.isMember(organizationA, userA), true);
    const agentA = "30000000-0000-4000-8000-000000000101";
    await withOrganizationContext(
      db,
      { organizationId: organizationA, userId: userA },
      async (tx) => {
        await tx.insert(schema.agents).values({
          id: agentA,
          organizationId: organizationA,
          name: "test_fixture_bridge_app_agent_a",
          ownerUserId: userA,
        });
      },
    );
    const ports = createDrizzlePorts(db, {
      defaultOrganizationId: organizationA,
      defaultUserId: userA,
    });
    assert.equal(await ports.agents.isActive(agentA), true);

    const resourceA = await resources.create({
      organizationId: organizationA,
      title: "test_fixture_bridge_app_resource_a",
      kind: "article",
    });
    const resourceB = await resources.create({
      organizationId: organizationB,
      title: "test_fixture_bridge_app_resource_b",
      kind: "article",
    });
    assert.deepEqual(
      (await resources.list(organizationA, { limit: 10, offset: 0 })).items.map(
        (row) => row.id,
      ),
      [resourceA.id],
    );
    assert.deepEqual(
      (await resources.list(organizationB, { limit: 10, offset: 0 })).items.map(
        (row) => row.id,
      ),
      [resourceB.id],
    );
    assert.deepEqual(
      await db.select({ id: schema.resources.id }).from(schema.resources),
      [],
      "transaction-local app.organization_id must reset before connection reuse",
    );

    await withOrganizationContext(
      db,
      { organizationId: organizationA, userId: userA },
      async (tx) => {
        assert.equal(
          (await new DrizzleResourcesStore(tx).list(organizationA, { limit: 10, offset: 0 })).items.length,
          1,
        );
        await withOrganizationContext(
          tx,
          { organizationId: organizationA, userId: userA },
          async () => undefined,
        );
      },
    );
    await assert.rejects(
      () =>
        withOrganizationContext(
          db,
          { organizationId: organizationA, userId: userA },
          (tx) =>
            withOrganizationContext(
              tx,
              { organizationId: organizationB, userId: userB },
              async () => undefined,
            ),
        ),
      /cannot switch Organization inside one transaction/,
    );
    await assert.rejects(
      () =>
        withOrganizationContext(
          db,
          { organizationId: organizationA, userId: userA },
          (tx) =>
            withOrganizationContext(
              tx,
              { organizationId: organizationA, userId: userB },
              async () => undefined,
            ),
        ),
      /cannot switch user inside one transaction/,
    );
  } finally {
    await close();
  }
});

test("RLS: organization-scoped reads are isolated by app.organization_id", async () => {
  const { db, close } = await createLocalDb();
  try {
    await useRlsAppRole(db);
    const [tenantA] = await db.insert(schema.organizations).values({ name: "test_fixture_rls_tenant_a" }).returning({ id: schema.organizations.id });
    const [tenantB] = await db.insert(schema.organizations).values({ name: "test_fixture_rls_tenant_b" }).returning({ id: schema.organizations.id });
    assert.ok(tenantA);
    assert.ok(tenantB);

    await setRlsContext(db, tenantA.id);
    const [resourceA] = await db
      .insert(schema.resources)
      .values({ organizationId: tenantA.id, title: "test_fixture_tenant_a_resource", kind: "article" })
      .returning({ id: schema.resources.id });
    assert.ok(resourceA);
    const [goalA] = await db
      .insert(schema.tasks)
      .values({ organizationId: tenantA.id, type: "test", title: "Tenant A goal Task", path: "1", isGoal: true })
      .returning({ id: schema.tasks.id });
    assert.ok(goalA);

    await setRlsContext(db, tenantB.id);
    const [resourceB] = await db
      .insert(schema.resources)
      .values({ organizationId: tenantB.id, title: "test_fixture_tenant_b_resource", kind: "article" })
      .returning({ id: schema.resources.id });
    assert.ok(resourceB);
    const [goalB] = await db
      .insert(schema.tasks)
      .values({ organizationId: tenantB.id, type: "test", title: "Tenant B goal Task", path: "1", isGoal: true })
      .returning({ id: schema.tasks.id });
    assert.ok(goalB);

    await setRlsContext(db, tenantA.id);
    const rows = await db.select({ id: schema.resources.id }).from(schema.resources);
    assert.deepEqual(rows.map((row) => row.id), [resourceA.id]);
    assert.equal(rows.some((row) => row.id === resourceB.id), false);
    const goals = await db.select({ id: schema.tasks.id }).from(schema.tasks);
    assert.deepEqual(goals.map((row) => row.id), [goalA.id]);
    assert.equal(goals.some((row) => row.id === goalB.id), false);
  } finally {
    await close();
  }
});

test("RLS: relationship visibility honors organization/public and private owner scope", async () => {
  const { db, close } = await createLocalDb();
  try {
    await useRlsAppRole(db);
    const [organization] = await db.insert(schema.organizations).values({ name: "test_fixture_rls_visibility" }).returning({ id: schema.organizations.id });
    const [owner] = await db.insert(schema.users).values({ email: "test_fixture_rls_owner@example.com" }).returning({ id: schema.users.id });
    const [other] = await db.insert(schema.users).values({ email: "test_fixture_rls_other@example.com" }).returning({ id: schema.users.id });
    assert.ok(organization);
    assert.ok(owner);
    assert.ok(other);

    await setRlsContext(db, organization.id, owner.id);
    const [privatePerson] = await db
      .insert(schema.people)
      .values({ organizationId: organization.id, userId: owner.id, visibility: "private", fullNameOverride: "test_fixture_private_person" })
      .returning({ id: schema.people.id });
    const [organizationPerson] = await db
      .insert(schema.people)
      .values({ organizationId: organization.id, userId: owner.id, visibility: "organization", fullNameOverride: "test_fixture_organization_person" })
      .returning({ id: schema.people.id });
    assert.ok(privatePerson);
    assert.ok(organizationPerson);

    await setRlsContext(db, organization.id, other.id);
    const visibleToOther = await db.select({ id: schema.people.id }).from(schema.people);
    assert.deepEqual(visibleToOther.map((row) => row.id), [organizationPerson.id]);
  } finally {
    await close();
  }
});

test("RLS: Relations isolate private owners and bind writes to the current user", async () => {
  const { db, close } = await createLocalDb();
  try {
    await useRlsAppRole(db);
    const [organization] = await db
      .insert(schema.organizations)
      .values({ name: "test_fixture_rls_relations" })
      .returning({ id: schema.organizations.id });
    const [owner] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_rls_relation_owner@example.com" })
      .returning({ id: schema.users.id });
    const [other] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_rls_relation_other@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(organization);
    assert.ok(owner);
    assert.ok(other);
    const eventId = "10000000-0000-4000-8000-000000000001";
    const privateTargetId = "20000000-0000-4000-8000-000000000001";
    const organizationTargetId = "20000000-0000-4000-8000-000000000002";
    const publicTargetId = "20000000-0000-4000-8000-000000000003";

    await setRlsContext(db, organization.id, owner.id);
    const ownerRows = await db
      .insert(schema.edges)
      .values([
        {
          organizationId: organization.id,
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
          organizationId: organization.id,
          ownerUserId: owner.id,
          srcType: "event",
          srcId: eventId,
          dstType: "person",
          dstId: organizationTargetId,
          edgeType: "organization_relation",
          evidenceRefs: [{ entityType: "event", entityId: eventId }],
          visibility: "organization",
          source: "test",
          sourceModule: "relationship",
        },
        {
          organizationId: organization.id,
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

    await setRlsContext(db, organization.id, other.id);
    const visibleToOther = await db
      .select({ id: schema.edges.id, edgeType: schema.edges.edgeType })
      .from(schema.edges);
    assert.deepEqual(
      visibleToOther.map((row) => row.edgeType).sort(),
      ["organization_relation", "public_relation"],
    );
    await assert.rejects(
      () =>
        db.insert(schema.edges).values({
          organizationId: organization.id,
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
        organizationId: organization.id,
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

    await setRlsContext(db, organization.id, owner.id);
    const visibleToOwner = await db
      .select({ id: schema.edges.id, edgeType: schema.edges.edgeType })
      .from(schema.edges);
    assert.deepEqual(
      visibleToOwner.map((row) => row.edgeType).sort(),
      ["organization_relation", "private_relation", "public_relation"],
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
test("RLS: memories isolate private/team/restricted owners while public/organization stay visible to any member, and UPDATE/DELETE respect the same policy", async () => {
  const { db, close } = await createLocalDb();
  try {
    await useRlsAppRole(db);
    const [organization] = await db.insert(schema.organizations).values({ name: "test_fixture_rls_memories" }).returning({ id: schema.organizations.id });
    const [owner] = await db.insert(schema.users).values({ email: "test_fixture_rls_memories_owner@example.com" }).returning({ id: schema.users.id });
    const [other] = await db.insert(schema.users).values({ email: "test_fixture_rls_memories_other@example.com" }).returning({ id: schema.users.id });
    assert.ok(organization);
    assert.ok(owner);
    assert.ok(other);

    const memoryBase = {
      organizationId: organization.id,
      type: "semantic" as const,
      content: "test_fixture_rls_memory_content",
      confidence: "1",
      trustOrigin: "user_content" as const,
      plane: "local" as const,
      createdBy: owner.id,
      ownerUserId: owner.id,
    };

    await setRlsContext(db, organization.id, owner.id);
    const [publicMemory] = await db.insert(schema.memories).values({ ...memoryBase, scope: "public" }).returning({ id: schema.memories.id });
    const [organizationMemory] = await db.insert(schema.memories).values({ ...memoryBase, scope: "organization" }).returning({ id: schema.memories.id });
    const [teamMemory] = await db.insert(schema.memories).values({ ...memoryBase, scope: "team" }).returning({ id: schema.memories.id });
    const [privateMemory] = await db.insert(schema.memories).values({ ...memoryBase, scope: "private" }).returning({ id: schema.memories.id });
    const [restrictedMemory] = await db.insert(schema.memories).values({ ...memoryBase, scope: "restricted" }).returning({ id: schema.memories.id });
    assert.ok(publicMemory);
    assert.ok(organizationMemory);
    assert.ok(teamMemory);
    assert.ok(privateMemory);
    assert.ok(restrictedMemory);

    // The owner's own session (app.user_id = owner.id) sees every scope,
    // including its own team/private/restricted rows — proves INSERT...
    // RETURNING and a same-owner SELECT both pass the new policy.
    const visibleToOwner = await db.select({ id: schema.memories.id }).from(schema.memories);
    assert.deepEqual(
      visibleToOwner.map((row) => row.id).sort(),
      [publicMemory.id, organizationMemory.id, teamMemory.id, privateMemory.id, restrictedMemory.id].sort(),
    );

    // A DIFFERENT organization member sees only public/organization — team/
    // private/restricted are all owner-narrowed, enforced by Postgres
    // itself under a real restricted role, not merely by app-side code.
    await setRlsContext(db, organization.id, other.id);
    const visibleToOther = await db.select({ id: schema.memories.id }).from(schema.memories);
    assert.deepEqual(
      visibleToOther.map((row) => row.id).sort(),
      [publicMemory.id, organizationMemory.id].sort(),
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

    await setRlsContext(db, organization.id, owner.id);
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
