import assert from "node:assert/strict";
import test from "node:test";
import {
  createLocalDb,
  DrizzleCanonicalIdentityStore,
  schema,
} from "../src/index.js";
import { eq, isNull } from "drizzle-orm";

test("canonical identity upsert honors the partial dedup index under sequential and concurrent writes", async () => {
  const { db, close } = await createLocalDb();
  try {
    const store = new DrizzleCanonicalIdentityStore(db);
    const firstId = "71000000-0000-4000-8000-000000000001";
    const duplicateId = "71000000-0000-4000-8000-000000000002";

    assert.deepEqual(
      await store.upsertPersonIdentity(
        {
          dedupKey: "person@example.test",
          fullName: "Original Person",
          emails: ["person@example.test"],
          currentCompanyName: "Original Company",
        },
        firstId,
      ),
      { canonicalPersonId: firstId, created: true },
    );
    assert.deepEqual(
      await store.upsertPersonIdentity(
        {
          dedupKey: "person@example.test",
          fullName: "Changed Person",
          emails: ["changed@example.test"],
          currentCompanyName: "Changed Company",
        },
        duplicateId,
      ),
      { canonicalPersonId: firstId, created: false },
    );

    const [preserved] = await db
      .select({
        fullName: schema.peopleCanonical.fullName,
        emails: schema.peopleCanonical.emails,
        currentCompanyName: schema.peopleCanonical.currentCompanyName,
      })
      .from(schema.peopleCanonical)
      .where(eq(schema.peopleCanonical.id, firstId));
    assert.deepEqual(preserved, {
      fullName: "Original Person",
      emails: ["person@example.test"],
      currentCompanyName: "Original Company",
    });

    const nullKeyIds = [
      "71000000-0000-4000-8000-000000000003",
      "71000000-0000-4000-8000-000000000004",
    ];
    for (const id of nullKeyIds) {
      assert.deepEqual(
        await store.upsertPersonIdentity({ dedupKey: null, emails: [] }, id),
        { canonicalPersonId: id, created: true },
      );
    }
    const nullRows = await db
      .select({ id: schema.peopleCanonical.id })
      .from(schema.peopleCanonical)
      .where(isNull(schema.peopleCanonical.dedupKey));
    assert.deepEqual(
      nullRows.map(({ id }) => id).sort(),
      nullKeyIds,
    );

    const concurrentIds = Array.from(
      { length: 8 },
      (_, index) => `72000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const concurrent = await Promise.all(
      concurrentIds.map((id) =>
        store.upsertPersonIdentity(
          {
            dedupKey: "concurrent@example.test",
            emails: ["concurrent@example.test"],
          },
          id,
        ),
      ),
    );
    assert.equal(new Set(concurrent.map(({ canonicalPersonId }) => canonicalPersonId)).size, 1);
    assert.equal(concurrent.filter(({ created }) => created).length, 1);
  } finally {
    await close();
  }
});
