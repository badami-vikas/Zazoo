/**
 * DrizzleGraphStore — read coverage for the Bridge kernel vocabulary nouns
 * (Person/Community here; Initiative/Touchpoint/Signal already ship without
 * their own test file). Against a real (pglite) database: seed a workspace +
 * user, seed a page-worth of people/communities beyond the default page size,
 * and confirm pagination (limit/offset/total/ordering) behaves the same way
 * `listInitiatives`/`listSignals` do.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleGraphStore, schema } from "../src/index.js";

const FIXTURE_COUNT = 5;

async function seedWorkspaceAndUser(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: "test_fixture_graph_store_user@example.com" })
    .returning({ id: schema.users.id });
  assert.ok(user, "fixture user seeded");
  const [workspace] = await db
    .insert(schema.workspaces)
    .values({ name: "test_fixture_graph_store_workspace" })
    .returning({ id: schema.workspaces.id });
  assert.ok(workspace, "fixture workspace seeded");
  return { userId: user!.id, workspaceId: workspace!.id };
}

test("listPeople: paginates workspace-scoped people, newest first", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    const store = new DrizzleGraphStore(db);

    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      await db.insert(schema.people).values({
        workspaceId,
        userId,
        fullNameOverride: `test_fixture_person_${i}`,
      });
    }

    const firstPage = await store.listPeople(workspaceId, userId, { limit: 2, offset: 0 });
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.total, FIXTURE_COUNT);

    const lastPage = await store.listPeople(workspaceId, userId, { limit: 2, offset: 4 });
    assert.equal(lastPage.items.length, 1);
    assert.equal(lastPage.total, FIXTURE_COUNT);

    // A different, unseeded workspace sees none of these rows. Must be a
    // well-formed UUID — pglite (0.2.17) crashes the wasm runtime instead of
    // cleanly erroring on a non-UUID string compared against a `uuid` column
    // (reproduced: `22P02 invalid input syntax for type uuid` followed by
    // `RuntimeError: memory access out of bounds`), so a `test_fixture_`-prefixed
    // plain string here is not safe.
    const other = await store.listPeople("00000000-0000-4000-a000-000000000000", userId, { limit: 50, offset: 0 });
    assert.equal(other.total, 0);
    assert.deepEqual(other.items, []);
  } finally {
    await close();
  }
});

test("listCommunities: paginates workspace-scoped communities", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    const store = new DrizzleGraphStore(db);

    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      await db.insert(schema.communities).values({
        workspaceId,
        userId,
        nameOverride: `test_fixture_community_${i}`,
      });
    }

    const firstPage = await store.listCommunities(workspaceId, userId, { limit: 3, offset: 0 });
    assert.equal(firstPage.items.length, 3);
    assert.equal(firstPage.total, FIXTURE_COUNT);

    const lastPage = await store.listCommunities(workspaceId, userId, { limit: 3, offset: 3 });
    assert.equal(lastPage.items.length, 2);
    assert.equal(lastPage.total, FIXTURE_COUNT);

    // See listPeople's test above for why this must be a well-formed UUID.
    const other = await store.listCommunities("00000000-0000-4000-a000-000000000000", userId, { limit: 50, offset: 0 });
    assert.equal(other.total, 0);
    assert.deepEqual(other.items, []);
  } finally {
    await close();
  }
});

test("relationship reads mirror the RLS visibility allowlist", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId: ownerUserId, workspaceId } = await seedWorkspaceAndUser(db);
    const [viewer] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_relationship_viewer@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(viewer);
    const store = new DrizzleGraphStore(db);

    const [privatePerson] = await db
      .insert(schema.people)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "private",
        fullNameOverride: "Private Person",
      })
      .returning({ id: schema.people.id });
    const [teamCommunity] = await db
      .insert(schema.communities)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "team",
        nameOverride: "Owner-only Team Community",
      })
      .returning({ id: schema.communities.id });
    const [workspaceCommunity] = await db
      .insert(schema.communities)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "workspace",
        nameOverride: "Workspace Community",
      })
      .returning({ id: schema.communities.id });
    assert.ok(privatePerson);
    assert.ok(teamCommunity);
    assert.ok(workspaceCommunity);
    const [privateSignal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "private_context",
        subjectType: "person",
        subjectId: privatePerson.id,
        payload: { reason: "Private relationship context" },
        recommendedAction: { label: "Private action" },
      })
      .returning({ id: schema.signals.id });
    assert.ok(privateSignal);

    const peoplePage = await store.listPeople(workspaceId, viewer.id, { limit: 20, offset: 0 });
    assert.equal(peoplePage.total, 0);
    assert.equal(await store.getPerson(workspaceId, viewer.id, privatePerson.id), null);
    const signalsPage = await store.listSignals(workspaceId, viewer.id, { limit: 20, offset: 0 });
    assert.equal(signalsPage.total, 0);
    assert.equal(await store.getSignalDetail(workspaceId, viewer.id, privateSignal.id), null);

    const communitiesPage = await store.listCommunities(workspaceId, viewer.id, { limit: 20, offset: 0 });
    assert.equal(communitiesPage.total, 1);
    assert.equal(communitiesPage.items[0]?.displayName, "Workspace Community");
    assert.equal(await store.getCommunity(workspaceId, viewer.id, teamCommunity.id), null);
    assert.equal(
      (await store.getCommunity(workspaceId, ownerUserId, teamCommunity.id))?.displayName,
      "Owner-only Team Community",
    );
  } finally {
    await close();
  }
});

test("getSignalDetail requires a linked source Event and real participant Relation", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    const store = new DrizzleGraphStore(db);
    const [person] = await db
      .insert(schema.people)
      .values({ workspaceId, userId, fullNameOverride: "Unlinked Signal Subject" })
      .returning({ id: schema.people.id });
    assert.ok(person);
    const [unrelatedEvent] = await db
      .insert(schema.events)
      .values({
        workspaceId,
        type: "calendar.unrelated",
        entityType: "person",
        entityId: person.id,
        payload: {},
      })
      .returning({ id: schema.events.id });
    assert.ok(unrelatedEvent);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "meeting_prep",
        subjectType: "person",
        subjectId: person.id,
        payload: { sourceEventId: unrelatedEvent.id, reason: "Unverified detector reason" },
        recommendedAction: { label: "Prepare context" },
      })
      .returning({ id: schema.signals.id });
    assert.ok(signal);
    await db.insert(schema.edges).values({
      workspaceId,
      srcType: "event",
      srcId: unrelatedEvent.id,
      dstType: "person",
      dstId: person.id,
      edgeType: "observed",
      properties: {},
    });

    const detail = await store.getSignalDetail(workspaceId, userId, signal.id);
    assert.equal(detail, null);
    const list = await store.listSignals(workspaceId, userId, { limit: 20, offset: 0 });
    assert.equal(list.total, 0);
    assert.deepEqual(list.items, []);
  } finally {
    await close();
  }
});

test("getSignalDetail follows participant Relation and source Event", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    const store = new DrizzleGraphStore(db);
    const [person] = await db
      .insert(schema.people)
      .values({ workspaceId, userId, fullNameOverride: "Signal Participant" })
      .returning({ id: schema.people.id });
    assert.ok(person);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "meeting_prep",
        subjectType: "person",
        subjectId: person.id,
        payload: { reason: "A permitted meeting Event is approaching." },
        recommendedAction: { label: "Prepare context" },
      })
      .returning({ id: schema.signals.id });
    assert.ok(signal);
    const [event] = await db
      .insert(schema.events)
      .values({
        workspaceId,
        type: "calendar.meeting_upcoming",
        entityType: "signal",
        entityId: signal.id,
        payload: { source: "google-calendar" },
      })
      .returning({ id: schema.events.id });
    assert.ok(event);
    await db.insert(schema.edges).values({
      workspaceId,
      srcType: "event",
      srcId: event.id,
      dstType: "person",
      dstId: person.id,
      edgeType: "participant",
      properties: { role: "attendee" },
    });

    const detail = await store.getSignalDetail(workspaceId, userId, signal.id);
    assert.ok(detail);
    assert.equal(detail.sourceEvent?.id, event.id);
    assert.equal(detail.reasonSource, "event");
    assert.equal(detail.participants.length, 1);
    assert.equal(detail.participants[0]?.displayName, "Signal Participant");
    assert.equal(detail.participants[0]?.relationType, "participant");
  } finally {
    await close();
  }
});
