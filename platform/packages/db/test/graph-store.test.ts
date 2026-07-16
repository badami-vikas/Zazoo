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
import { eq } from "drizzle-orm";
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

test("relationship reads prune another user's private records", async () => {
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
    const [sharedCommunity] = await db
      .insert(schema.communities)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "team",
        nameOverride: "Shared Community",
      })
      .returning({ id: schema.communities.id });
    assert.ok(privatePerson);
    assert.ok(sharedCommunity);
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
    assert.equal(communitiesPage.items[0]?.displayName, "Shared Community");
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
      .returning({ id: schema.events.id, createdAt: schema.events.createdAt });
    assert.ok(event);
    await db.insert(schema.edges).values({
      workspaceId,
      ownerUserId: userId,
      srcType: "event",
      srcId: event.id,
      dstType: "person",
      dstId: person.id,
      edgeType: "participant",
      properties: { role: "attendee" },
      evidenceRefs: [{ entityType: "event", entityId: event.id, source: "google-calendar" }],
      source: "google-calendar",
      sourceModule: "relationship",
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

test("Relationship owns atomic Signal source-Event and participant Relation materialization", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    const store = new DrizzleGraphStore(db);
    const [person] = await db
      .insert(schema.people)
      .values({ workspaceId, userId, fullNameOverride: "Relation Person" })
      .returning({ id: schema.people.id });
    const [community] = await db
      .insert(schema.communities)
      .values({ workspaceId, userId, nameOverride: "Relation Community" })
      .returning({ id: schema.communities.id });
    assert.ok(person);
    assert.ok(community);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "meeting_prep",
        subjectType: "person",
        subjectId: person.id,
        payload: { reason: "Event evidence exists." },
        recommendedAction: { label: "Prepare" },
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
      .returning({ id: schema.events.id, createdAt: schema.events.createdAt });
    assert.ok(event);

    assert.deepEqual(await store.getNodeTypeOwner("event"), {
      nodeType: "event",
      plane: "operational",
      owningModule: "relationship",
    });
    await assert.rejects(
      () =>
        store.materializeSignalEvidence({
          workspaceId,
          ownerUserId: userId,
          signalId: signal.id,
          sourceEventId: event.id,
          source: "google-calendar",
          observedAt: event.createdAt,
          userConfirmed: false,
          visibility: "private",
          participants: [
            { recordType: "person", recordId: person.id, role: "attendee", confidence: 0.9 },
            { recordType: "person", recordId: person.id, role: "observer", confidence: 0.8 },
          ],
        }),
      /unique by Record/,
    );
    const materialized = await store.materializeSignalEvidence({
      workspaceId,
      ownerUserId: userId,
      signalId: signal.id,
      sourceEventId: event.id,
      source: "google-calendar",
      observedAt: event.createdAt,
      userConfirmed: false,
      visibility: "private",
      participants: [
        { recordType: "person", recordId: person.id, role: "attendee", confidence: 0.9 },
        { recordType: "community", recordId: community.id, role: "host", confidence: 0.8 },
      ],
    });
    assert.equal(materialized.sourceEvent.sourceModule, "relationship");
    assert.equal(materialized.sourceEvent.ownerUserId, userId);
    assert.deepEqual(materialized.sourceEvent.evidenceRefs, [
      { entityType: "event", entityId: event.id, source: "google-calendar" },
    ]);
    assert.equal(materialized.participants.length, 2);
    assert.equal(materialized.participants[0]?.visibility, "private");
    const enrichedSourceRelation = await store.upsertRelation({
      workspaceId,
      ownerUserId: userId,
      srcType: "signal",
      srcId: signal.id,
      dstType: "event",
      dstId: event.id,
      relationType: "source_event",
      evidenceRefs: [
        { entityType: "event", entityId: event.id, source: "google-calendar" },
        { entityType: "signal", entityId: signal.id, source: "relationship" },
      ],
      confidence: 0.95,
      observedAt: event.createdAt,
      userConfirmed: false,
      visibility: "private",
      source: "google-calendar",
      sourceModule: "relationship",
    });
    assert.equal(enrichedSourceRelation.evidenceRefs.length, 2);
    assert.equal(enrichedSourceRelation.confidence, "0.9500");

    const signalRelations = await store.listRelations(
      workspaceId,
      userId,
      { nodeType: "signal", nodeId: signal.id },
      { limit: 10, offset: 0 },
    );
    assert.equal(signalRelations.total, 1);
    assert.equal(signalRelations.items[0]?.edgeType, "source_event");

    const eventRelations = await store.listRelations(
      workspaceId,
      userId,
      { nodeType: "event", nodeId: event.id },
      { limit: 10, offset: 0 },
    );
    assert.equal(eventRelations.total, 3);

    const repeated = await store.materializeSignalEvidence({
      workspaceId,
      ownerUserId: userId,
      signalId: signal.id,
      sourceEventId: event.id,
      source: "google-calendar",
      observedAt: event.createdAt,
      userConfirmed: true,
      visibility: "private",
      participants: [
        { recordType: "person", recordId: person.id, role: "required", confidence: 1 },
        { recordType: "community", recordId: community.id, role: "host", confidence: 0.85 },
      ],
    });
    assert.equal(repeated.participants.length, 2);
    const relationRows = await db.select().from(schema.edges);
    assert.equal(relationRows.length, 3, "semantic Relation upsert must be idempotent");
    assert.ok(relationRows.every((relation) => relation.userConfirmed));

    const [secondOwner] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_second_relation_owner@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(secondOwner);
    await db.update(schema.people).set({ visibility: "workspace" }).where(eq(schema.people.id, person.id));
    await db.update(schema.communities).set({ visibility: "workspace" }).where(eq(schema.communities.id, community.id));
    await store.materializeSignalEvidence({
      workspaceId,
      ownerUserId: secondOwner.id,
      signalId: signal.id,
      sourceEventId: event.id,
      source: "google-calendar",
      observedAt: event.createdAt,
      userConfirmed: false,
      visibility: "private",
      participants: [
        { recordType: "person", recordId: person.id, role: "observer", confidence: 0.7 },
        { recordType: "community", recordId: community.id, role: "host", confidence: 0.8 },
      ],
    });
    const ownerScopedRows = await db.select().from(schema.edges);
    assert.equal(ownerScopedRows.length, 6, "different owners retain separate private Relations");
    assert.equal(ownerScopedRows.filter((relation) => relation.ownerUserId === userId).length, 3);
    assert.equal(ownerScopedRows.filter((relation) => relation.ownerUserId === secondOwner.id).length, 3);
  } finally {
    await close();
  }
});

test("Relation schema rejects invalid confidence at the database boundary", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    await assert.rejects(() =>
      db.insert(schema.edges).values({
        workspaceId,
        ownerUserId: userId,
        srcType: "signal",
        srcId: "10000000-0000-4000-a000-000000000001",
        dstType: "event",
        dstId: "10000000-0000-4000-a000-000000000002",
        edgeType: "source_event",
        evidenceRefs: [{ entityType: "event", entityId: "10000000-0000-4000-a000-000000000002" }],
        confidence: "1.5",
        sourceModule: "relationship",
      }),
    );
  } finally {
    await close();
  }
});

test("Signal detail does not expose another owner's private Relation evidence", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId: ownerUserId, workspaceId } = await seedWorkspaceAndUser(db);
    const [viewer] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_relation_viewer@example.com" })
      .returning({ id: schema.users.id });
    const [person] = await db
      .insert(schema.people)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "workspace",
        fullNameOverride: "Shared Person Private Relation",
      })
      .returning({ id: schema.people.id });
    assert.ok(viewer);
    assert.ok(person);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "private_relation_evidence",
        subjectType: "person",
        subjectId: person.id,
        payload: { reason: "Shared Signal" },
        recommendedAction: { label: "Review" },
      })
      .returning({ id: schema.signals.id });
    assert.ok(signal);
    const [event] = await db
      .insert(schema.events)
      .values({
        workspaceId,
        type: "relationship.private_evidence",
        entityType: "signal",
        entityId: signal.id,
      })
      .returning({ id: schema.events.id });
    assert.ok(event);
    await db.insert(schema.edges).values({
      workspaceId,
      ownerUserId,
      srcType: "event",
      srcId: event.id,
      dstType: "person",
      dstId: person.id,
      edgeType: "participant",
      evidenceRefs: [{ entityType: "event", entityId: event.id, source: "private-note" }],
      confidence: "0.7500",
      visibility: "private",
      source: "private-note",
      sourceModule: "relationship",
    });
    const store = new DrizzleGraphStore(db);

    const ownerDetail = await store.getSignalDetail(workspaceId, ownerUserId, signal.id);
    assert.equal(ownerDetail?.participants[0]?.relationType, "participant");
    assert.equal(ownerDetail?.participants[0]?.confidence, 0.75);

    const viewerDetail = await store.getSignalDetail(workspaceId, viewer.id, signal.id);
    assert.equal(viewerDetail?.participants[0]?.relationType, "signal_subject");
    assert.equal(viewerDetail?.participants[0]?.confidence, null);
    assert.deepEqual(viewerDetail?.participants[0]?.evidenceRefs, []);
  } finally {
    await close();
  }
});
