import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalDb,
  DrizzleGraphStore,
  InvalidDatabaseIdentifierError,
  schema,
} from "../src/index.js";

test("Relationship stores reject malformed UUIDs before SQL and keep PGlite usable", async () => {
  const { db, client, close } = await createLocalDb();
  const organizationId = "73000000-0000-4000-8000-000000000001";
  const otherOrganizationId = "73000000-0000-4000-8000-000000000002";
  const missingOrganizationId = "73000000-0000-4000-8000-000000000003";
  const userId = "74000000-0000-4000-8000-000000000001";
  const personId = "75000000-0000-4000-8000-000000000001";
  const missingPersonId = "75000000-0000-4000-8000-000000000002";
  try {
    await db.insert(schema.organizations).values([
      { id: organizationId, name: "UUID boundary organization" },
      { id: otherOrganizationId, name: "Other UUID boundary organization" },
    ]);
    await db.insert(schema.users).values({
      id: userId,
      email: "uuid-boundary@example.test",
    });
    await db.insert(schema.organizationMembers).values({
      organizationId,
      userId,
    });
    await db.insert(schema.people).values({
      id: personId,
      organizationId,
      userId,
      fullNameOverride: "UUID Boundary Person",
    });

    const store = new DrizzleGraphStore(db);
    for (const invalidId of ["not-a-uuid", ""]) {
      await assert.rejects(
        () => store.listPeople(invalidId, userId, { limit: 10, offset: 0 }),
        InvalidDatabaseIdentifierError,
      );
      assert.equal((await client.query<{ value: number }>("SELECT 1 AS value")).rows[0]?.value, 1);
    }
    await assert.rejects(
      () => store.listCommunities(organizationId, "bad-user-id", { limit: 10, offset: 0 }),
      InvalidDatabaseIdentifierError,
    );
    await assert.rejects(
      () => store.getPerson(organizationId, userId, "bad-person-id"),
      InvalidDatabaseIdentifierError,
    );

    assert.deepEqual(
      await store.listPeople(missingOrganizationId, userId, { limit: 10, offset: 0 }),
      { items: [], total: 0 },
    );
    assert.deepEqual(
      await store.listPeople(otherOrganizationId, userId, { limit: 10, offset: 0 }),
      { items: [], total: 0 },
    );
    assert.equal((await store.getPerson(organizationId, userId, missingPersonId)), null);
    assert.equal((await store.getPerson(organizationId, userId, personId))?.id, personId);
    assert.equal((await client.query<{ value: number }>("SELECT 1 AS value")).rows[0]?.value, 1);
  } finally {
    await close();
  }
});
