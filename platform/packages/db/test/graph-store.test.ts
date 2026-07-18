/**
 * DrizzleGraphStore — read coverage for the Bridge kernel vocabulary nouns
 * (Person/Community here; Initiative/Touchpoint/Signal already ship without
 * their own test file). Against a real (pglite) database: seed a workspace +
 * user, seed a page-worth of people/communities beyond the default page size,
 * and confirm pagination (limit/offset/total/ordering) behaves the same way
 * `listInitiatives`/`listSignals` do.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
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

test("Relation operations bind workspace and owner context under forced RLS", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    const [otherUser] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_relation_rls_other@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(otherUser);
    const [person] = await db
      .insert(schema.people)
      .values({
        workspaceId,
        userId,
        visibility: "workspace",
        fullNameOverride: "RLS-visible participant",
      })
      .returning({ id: schema.people.id });
    assert.ok(person);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "meeting_prep",
        subjectType: "person",
        subjectId: person.id,
        payload: { reason: "RLS context evidence" },
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
        payload: { source: "calendar" },
      })
      .returning({ id: schema.events.id, createdAt: schema.events.createdAt });
    assert.ok(event);

    await db.execute(sql.raw("CREATE ROLE test_fixture_relation_app"));
    await db.execute(
      sql.raw(
        "GRANT USAGE ON SCHEMA public, app_private TO test_fixture_relation_app",
      ),
    );
    await db.execute(sql.raw(`
      GRANT SELECT ON TABLE
        people, people_canonical, communities, communities_canonical,
        signals, events, edges, node_types
      TO test_fixture_relation_app
    `));
    await db.execute(
      sql.raw(
        "GRANT INSERT, UPDATE, DELETE ON TABLE edges TO test_fixture_relation_app",
      ),
    );
    await db.execute(sql.raw("SET ROLE test_fixture_relation_app"));

    const store = new DrizzleGraphStore(db);
    const anchor = await store.getSignalEvidenceAnchor(
      workspaceId,
      userId,
      signal.id,
      event.id,
    );
    assert.equal(anchor?.sourceEvent.id, event.id);
    const materialized = await store.materializeSignalEvidence({
      workspaceId,
      ownerUserId: userId,
      signalId: signal.id,
      sourceEventId: event.id,
      userConfirmed: true,
      visibility: "private",
      participants: [
        {
          recordType: "person",
          recordId: person.id,
          role: "attendee",
          confidence: 0.9,
        },
      ],
      decisionLedgerId: randomUUID(),
      decisionSequence: 1,
      decisionAt: new Date(),
    });
    assert.equal(materialized.participants.length, 1);
    assert.equal(
      (await store.getSignalDetail(workspaceId, userId, signal.id))?.participants[0]?.recordId,
      person.id,
    );
    const ownerSignals = await store.listSignals(workspaceId, userId, {
      limit: 1,
      offset: 0,
    });
    assert.equal(ownerSignals.total, 1);
    assert.deepEqual(ownerSignals.items.map((item) => item.id), [signal.id]);
    assert.equal(
      await store.getSignalDetail(workspaceId, otherUser.id, signal.id),
      null,
    );
    assert.deepEqual(
      await store.listSignals(workspaceId, otherUser.id, { limit: 1, offset: 0 }),
      { items: [], total: 0 },
    );
  } finally {
    await db.execute(sql.raw("RESET ROLE"));
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

test("getSignalDetail prefers the approved source Event and owner Relation over newer legacy rows", async () => {
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
    const [approvedParticipant] = await db
      .insert(schema.edges)
      .values({
        workspaceId,
        ownerUserId: userId,
        srcType: "event",
        srcId: event.id,
        dstType: "person",
        dstId: person.id,
        edgeType: "participant",
        properties: { role: "attendee" },
        evidenceRefs: [{ entityType: "event", entityId: event.id, source: "google-calendar" }],
        confidence: "0.9",
        observedAt: event.createdAt,
        decisionLedgerId: "60000000-0000-4000-8000-000000000001",
        decisionSequence: 1,
        decisionAt: new Date("2026-07-17T00:00:00.000Z"),
        visibility: "private",
        source: "google-calendar",
        sourceModule: "relationship",
      })
      .returning({ id: schema.edges.id });
    assert.ok(approvedParticipant);
    await db.insert(schema.edges).values([
      {
        workspaceId,
        ownerUserId: userId,
        srcType: "signal",
        srcId: signal.id,
        dstType: "event",
        dstId: event.id,
        edgeType: "source_event",
        evidenceRefs: [{ entityType: "event", entityId: event.id, source: "google-calendar" }],
        confidence: "1",
        observedAt: event.createdAt,
        decisionLedgerId: "60000000-0000-4000-8000-000000000001",
        decisionSequence: 1,
        decisionAt: new Date("2026-07-17T00:00:00.000Z"),
        visibility: "private",
        source: "google-calendar",
        sourceModule: "relationship",
      },
      {
        workspaceId,
        srcType: "event",
        srcId: event.id,
        dstType: "person",
        dstId: person.id,
        edgeType: "participant",
        properties: { role: "legacy-attendee" },
        confidence: "0.1",
        observedAt: new Date("2028-01-01T00:00:00.000Z"),
        visibility: "workspace",
        source: "legacy-import",
        sourceModule: "legacy",
      },
    ]);
    await db.insert(schema.events).values({
      workspaceId,
      type: "calendar.newer_but_unapproved",
      entityType: "signal",
      entityId: signal.id,
      payload: { source: "newer-calendar-event" },
      createdAt: new Date("2027-01-01T00:00:00.000Z"),
    });

    const detail = await store.getSignalDetail(workspaceId, userId, signal.id);
    assert.ok(detail);
    assert.equal(detail.sourceEvent?.id, event.id);
    assert.equal(detail.reasonSource, "event");
    assert.equal(detail.participants.length, 1);
    assert.equal(detail.participants[0]?.displayName, "Signal Participant");
    assert.equal(detail.participants[0]?.relationType, "participant");
    assert.equal(detail.participants[0]?.relationId, approvedParticipant.id);
    assert.equal(detail.participants[0]?.confidence, 0.9);
    assert.equal(
      (await store.listSignals(workspaceId, userId, { limit: 20, offset: 0 })).total,
      1,
    );
  } finally {
    await close();
  }
});

test("getSignalDetail filters inaccessible endpoints before applying its bound", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    const [person] = await db
      .insert(schema.people)
      .values({
        workspaceId,
        userId,
        visibility: "workspace",
        fullNameOverride: "Accessible bounded participant",
      })
      .returning({ id: schema.people.id });
    assert.ok(person);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "meeting_prep",
        subjectType: "person",
        subjectId: person.id,
        payload: { reason: "Bounded detail remains complete." },
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
        payload: { source: "calendar" },
      })
      .returning({ id: schema.events.id, createdAt: schema.events.createdAt });
    assert.ok(event);
    await db.insert(schema.edges).values([
      {
        workspaceId,
        ownerUserId: userId,
        srcType: "event",
        srcId: event.id,
        dstType: "person",
        dstId: person.id,
        edgeType: "participant",
        evidenceRefs: [{ entityType: "event", entityId: event.id, source: "calendar" }],
        observedAt: event.createdAt,
        visibility: "private",
        source: "calendar",
        sourceModule: "relationship",
      },
      ...Array.from({ length: 201 }, () => ({
        workspaceId,
        ownerUserId: userId,
        srcType: "event",
        srcId: event.id,
        dstType: "person",
        dstId: randomUUID(),
        edgeType: "participant",
        observedAt: new Date("2027-01-01T00:00:00.000Z"),
        visibility: "workspace",
        source: "calendar",
        sourceModule: "relationship",
      })),
    ]);

    const detail = await new DrizzleGraphStore(db).getSignalDetail(workspaceId, userId, signal.id);
    assert.ok(detail);
    assert.deepEqual(detail.participants.map((participant) => participant.recordId), [person.id]);
  } finally {
    await close();
  }
});

test("materializeSignalEvidence is atomic, retry-idempotent, and semantically unique per owner", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId: ownerUserId, workspaceId } = await seedWorkspaceAndUser(db);
    const [secondOwner] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_relation_second_owner@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(secondOwner);
    const [person] = await db
      .insert(schema.people)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "workspace",
        fullNameOverride: "Relation Person",
      })
      .returning({ id: schema.people.id });
    const [community] = await db
      .insert(schema.communities)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "workspace",
        nameOverride: "Relation Community",
      })
      .returning({ id: schema.communities.id });
    const [staleCommunity] = await db
      .insert(schema.communities)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "workspace",
        nameOverride: "Stale Relation Community",
      })
      .returning({ id: schema.communities.id });
    assert.ok(person);
    assert.ok(community);
    assert.ok(staleCommunity);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "meeting_prep",
        subjectType: "person",
        subjectId: person.id,
        payload: { reason: "A source Event is available." },
        recommendedAction: { label: "Review context" },
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
      .returning();
    assert.ok(event);
    const store = new DrizzleGraphStore(db);

    assert.equal((await store.getNodeTypeOwner("person"))?.owningModule, "relationship");
    assert.equal((await store.getNodeTypeOwner("community"))?.owningModule, "relationship");
    assert.equal((await store.getNodeTypeOwner("signal"))?.owningModule, "relationship");
    assert.equal((await store.getNodeTypeOwner("event"))?.owningModule, "relationship");
    assert.equal(await store.getNodeTypeOwner("unsupported"), null);
    assert.equal(
      await store.getSignalDetail(workspaceId, ownerUserId, signal.id),
      null,
      "an Event anchor without a participant Relation is not evidence-backed Signal detail",
    );
    assert.equal(
      (await store.getSignalEvidenceAnchor(workspaceId, ownerUserId, signal.id))?.sourceEvent.id,
      event.id,
      "Relation staging can still resolve the accessible Signal and source Event",
    );

    const materialization = {
      workspaceId: workspaceId.toUpperCase(),
      ownerUserId: ownerUserId.toUpperCase(),
      signalId: signal.id.toUpperCase(),
      sourceEventId: event.id.toUpperCase(),
      decisionLedgerId: "60000000-0000-4000-8000-000000000009",
      decisionSequence: 1,
      decisionAt: new Date("2026-07-17T00:00:00.000Z"),
      userConfirmed: true,
      visibility: "private" as const,
      participants: [
        { recordType: "person" as const, recordId: person.id.toUpperCase(), role: "attendee", confidence: 0.95 },
        { recordType: "community" as const, recordId: community.id.toUpperCase(), role: "host", confidence: 0.8 },
      ],
    };

    await assert.rejects(
      () =>
        store.materializeSignalEvidence({
          ...materialization,
          participants: [
            { recordType: "person", recordId: person.id, confidence: 0.9 },
            {
              recordType: "person",
              recordId: person.id.toUpperCase(),
              confidence: 0.8,
            },
          ],
        }),
      /participants must be unique/i,
    );
    await assert.rejects(
      () =>
        store.materializeSignalEvidence({
          ...materialization,
          ownerUserId: "00000000-0000-4000-8000-000000000099",
        }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "cause" in error &&
        /foreign key|violates foreign key constraint/i.test(String(error.cause)),
    );
    assert.equal((await db.select().from(schema.edges)).length, 0, "a failed multi-Relation insert is atomic");

    const first = await store.materializeSignalEvidence(materialization);
    const retry = await store.materializeSignalEvidence(materialization);
    assert.ok(await store.getSignalDetail(workspaceId, ownerUserId, signal.id));
    assert.equal(first.sourceEvent.id, retry.sourceEvent.id);
    assert.deepEqual(
      first.participants.map((relation) => relation.id).sort(),
      retry.participants.map((relation) => relation.id).sort(),
    );
    assert.equal((await db.select().from(schema.edges)).length, 3);
    const newer = await store.materializeSignalEvidence({
      ...materialization,
      decisionLedgerId: "60000000-0000-4000-8000-000000000001",
      decisionSequence: 2,
      decisionAt: new Date("2026-07-17T00:00:00.000Z"),
      userConfirmed: false,
      participants: [
        { recordType: "person", recordId: person.id, role: "reviewed-attendee", confidence: 0.99 },
      ],
    });
    await db
      .delete(schema.communities)
      .where(eq(schema.communities.id, staleCommunity.id));
    const staleRetry = await store.materializeSignalEvidence({
      ...materialization,
      participants: [
        ...materialization.participants,
        {
          recordType: "community",
          recordId: staleCommunity.id,
          role: "obsolete-host",
          confidence: 0.7,
        },
      ],
    });
    assert.deepEqual(
      staleRetry.participants.map((relation) => relation.dstId),
      [person.id],
      "a superseded decision reconciles to the canonical Relation state",
    );
    const newerPerson = newer.participants.find((relation) => relation.dstId === person.id);
    assert.ok(newerPerson);
    assert.deepEqual(newerPerson.properties, { role: "reviewed-attendee" });
    assert.equal(newerPerson.confidence, "0.9900");
    assert.equal(newer.sourceEvent.userConfirmed, false);
    assert.ok(newer.participants.every((relation) => !relation.userConfirmed));
    assert.equal(newerPerson.decisionLedgerId, "60000000-0000-4000-8000-000000000001");
    assert.equal(newerPerson.decisionSequence, 2);
    assert.equal(
      (
        await db
          .select()
          .from(schema.edges)
          .where(
            and(
              eq(schema.edges.ownerUserId, ownerUserId),
              eq(schema.edges.dstId, community.id),
            ),
          )
      ).length,
      0,
      "a newer decision removes a participant omitted from its canonical payload",
    );
    assert.equal(
      (
        await db
          .select()
          .from(schema.edges)
          .where(
            and(
              eq(schema.edges.ownerUserId, ownerUserId),
              eq(schema.edges.dstId, staleCommunity.id),
            ),
          )
      ).length,
      0,
      "a superseded retry cannot reinsert an obsolete participant edge",
    );
    const [reverseSignal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "meeting_prep",
        subjectType: "person",
        subjectId: person.id,
        payload: { reason: "A newer decision materializes first." },
        recommendedAction: { label: "Review context" },
      })
      .returning({ id: schema.signals.id });
    assert.ok(reverseSignal);
    const [reverseEvent] = await db
      .insert(schema.events)
      .values({
        workspaceId,
        type: "calendar.meeting_upcoming",
        entityType: "signal",
        entityId: reverseSignal.id,
        payload: { source: "google-calendar" },
      })
      .returning();
    assert.ok(reverseEvent);
    const reverseBase = {
      ...materialization,
      signalId: reverseSignal.id,
      sourceEventId: reverseEvent.id,
    };
    await store.materializeSignalEvidence({
      ...reverseBase,
      decisionLedgerId: "60000000-0000-4000-8000-000000000004",
      decisionSequence: 4,
      userConfirmed: false,
      participants: [
        {
          recordType: "person",
          recordId: person.id,
          role: "canonical-attendee",
          confidence: 0.99,
        },
      ],
    });
    const reverseStale = await store.materializeSignalEvidence({
      ...reverseBase,
      decisionLedgerId: "60000000-0000-4000-8000-000000000003",
      decisionSequence: 3,
      participants: materialization.participants,
    });
    assert.deepEqual(
      reverseStale.participants.map((relation) => relation.dstId),
      [person.id],
      "materializing newer then older yields the same canonical participant set",
    );
    assert.equal(reverseStale.sourceEvent.userConfirmed, false);
    assert.ok(reverseStale.participants.every((relation) => !relation.userConfirmed));
    const [recoveryCommunity] = await db
      .insert(schema.communities)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "workspace",
        nameOverride: "Post-commit recovery participant",
      })
      .returning({ id: schema.communities.id });
    const [recoverySignal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "meeting_prep",
        subjectType: "person",
        subjectId: person.id,
        payload: { reason: "Post-commit recovery." },
        recommendedAction: { label: "Review context" },
      })
      .returning({ id: schema.signals.id });
    assert.ok(recoveryCommunity);
    assert.ok(recoverySignal);
    const recoveryEvents = await db
      .insert(schema.events)
      .values([
        {
          workspaceId,
          type: "calendar.meeting_upcoming",
          entityType: "signal",
          entityId: recoverySignal.id,
          payload: { source: "legacy-calendar" },
        },
        {
          workspaceId,
          type: "calendar.meeting_updated",
          entityType: "signal",
          entityId: recoverySignal.id,
          payload: { source: "calendar" },
        },
      ])
      .returning();
    assert.equal(recoveryEvents.length, 2);
    const recoveryOld = {
      ...materialization,
      signalId: recoverySignal.id,
      sourceEventId: recoveryEvents[0]!.id,
      decisionLedgerId: "60000000-0000-4000-8000-000000000006",
      decisionSequence: 6,
    };
    const recoveryWinner = {
      ...recoveryOld,
      sourceEventId: recoveryEvents[1]!.id,
      decisionLedgerId: "60000000-0000-4000-8000-000000000007",
      decisionSequence: 7,
      participants: [
        {
          recordType: "person" as const,
          recordId: person.id,
          role: "canonical-attendee",
          confidence: 0.99,
        },
        {
          recordType: "community" as const,
          recordId: recoveryCommunity.id,
          role: "canonical-host",
          confidence: 0.9,
        },
      ],
    };
    await store.materializeSignalEvidence(recoveryOld);
    await store.materializeSignalEvidence(recoveryWinner);
    await db
      .delete(schema.events)
      .where(eq(schema.events.id, recoveryEvents[0]!.id));
    await db
      .delete(schema.communities)
      .where(eq(schema.communities.id, recoveryCommunity.id));
    const sameDecisionRecovery =
      await store.materializeSignalEvidence(recoveryWinner);
    assert.equal(sameDecisionRecovery.participants.length, 2);
    const obsoleteEventRecovery =
      await store.materializeSignalEvidence(recoveryOld);
    assert.equal(
      obsoleteEventRecovery.sourceEvent.dstId,
      recoveryEvents[1]!.id,
      "a stale retry reconciles without requiring its obsolete source Event",
    );
    assert.equal(obsoleteEventRecovery.participants.length, 2);

    const secondOwnerResult = await store.materializeSignalEvidence({
      ...materialization,
      ownerUserId: secondOwner.id,
      decisionLedgerId: "60000000-0000-4000-8000-000000000008",
      decisionSequence: 8,
    });
    assert.notEqual(secondOwnerResult.sourceEvent.id, first.sourceEvent.id);
    assert.equal((await db.select().from(schema.edges)).length, 10);

    const existingParticipant = first.participants.find((relation) => relation.dstId === person.id);
    assert.ok(existingParticipant);
    const enriched = await store.upsertRelation({
      workspaceId,
      ownerUserId,
      srcType: "event",
      srcId: event.id,
      dstType: "person",
      dstId: person.id,
      relationType: "participant",
      properties: { reviewed: true },
      evidenceRefs: [
        { entityType: "event", entityId: event.id, source: "google-calendar" },
        { entityType: "community", entityId: community.id, source: "user" },
      ],
      confidence: 0.99,
      observedAt: event.createdAt,
      validFrom: event.createdAt,
      userConfirmed: true,
      visibility: "private",
      source: "user",
      sourceModule: "relationship",
    });
    assert.equal(enriched.id, existingParticipant.id);
    assert.equal(enriched.evidenceRefs.length, 1);
    assert.equal(enriched.confidence, "0.9900");
    assert.deepEqual(enriched.properties, { role: "reviewed-attendee" });

    const ownerPage = await store.listRelations(
      workspaceId,
      ownerUserId,
      { nodeType: "event", nodeId: event.id },
      { limit: 10 },
    );
    const secondOwnerPage = await store.listRelations(
      workspaceId,
      secondOwner.id,
      { nodeType: "event", nodeId: event.id },
      { limit: 10 },
    );
    assert.equal(ownerPage.total, 2);
    assert.equal(secondOwnerPage.total, 3);
    assert.ok(ownerPage.items.every((relation) => relation.ownerUserId === ownerUserId));
    assert.ok(secondOwnerPage.items.every((relation) => relation.ownerUserId === secondOwner.id));
  } finally {
    await close();
  }
});

test("Relation reads prune inaccessible endpoints and evidence before bounded pagination", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId: ownerUserId, workspaceId } = await seedWorkspaceAndUser(db);
    const [viewer] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_relation_viewer@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(viewer);
    const [subject] = await db
      .insert(schema.people)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "workspace",
        fullNameOverride: "Workspace Subject",
      })
      .returning({ id: schema.people.id });
    const [privateEvidence] = await db
      .insert(schema.people)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "private",
        fullNameOverride: "Private Evidence",
      })
      .returning({ id: schema.people.id });
    const [visibleCommunity] = await db
      .insert(schema.communities)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "workspace",
        nameOverride: "Visible Community",
      })
      .returning({ id: schema.communities.id });
    const [privateCommunity] = await db
      .insert(schema.communities)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "private",
        nameOverride: "Private Community",
      })
      .returning({ id: schema.communities.id });
    assert.ok(subject);
    assert.ok(privateEvidence);
    assert.ok(visibleCommunity);
    assert.ok(privateCommunity);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "meeting_prep",
        subjectType: "person",
        subjectId: subject.id,
        payload: { reason: "Evidence pruning test" },
        recommendedAction: { label: "Inspect" },
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
        payload: { source: "calendar" },
      })
      .returning();
    assert.ok(event);
    const store = new DrizzleGraphStore(db);
    const common = {
      workspaceId,
      ownerUserId,
      srcType: "event",
      srcId: event.id,
      confidence: 0.9,
      observedAt: event.createdAt,
      userConfirmed: true,
      source: "calendar",
      sourceModule: "relationship",
    };

    await store.upsertRelation({
      ...common,
      dstType: "community",
      dstId: visibleCommunity.id,
      relationType: "participant",
      evidenceRefs: [
        { entityType: "event", entityId: event.id, source: "calendar" },
        { entityType: "person", entityId: privateEvidence.id, source: "user" },
      ],
      visibility: "workspace",
    });
    await store.upsertRelation({
      ...common,
      dstType: "person",
      dstId: subject.id,
      relationType: "subject",
      evidenceRefs: [{ entityType: "event", entityId: event.id, source: "calendar" }],
      visibility: "workspace",
    });
    await store.upsertRelation({
      ...common,
      dstType: "community",
      dstId: privateCommunity.id,
      relationType: "hidden_endpoint",
      evidenceRefs: [{ entityType: "event", entityId: event.id, source: "calendar" }],
      visibility: "workspace",
    });
    await store.upsertRelation({
      ...common,
      dstType: "person",
      dstId: subject.id,
      relationType: "owner_only",
      evidenceRefs: [{ entityType: "event", entityId: event.id, source: "calendar" }],
      visibility: "private",
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT
          set_config('app.workspace_id', ${workspaceId}, true),
          set_config('app.user_id', ${ownerUserId}, true)
      `);
      await tx.insert(schema.edges).values({
        workspaceId,
        ownerUserId,
        srcType: "event",
        srcId: event.id,
        dstType: "toString",
        dstId: subject.id,
        edgeType: "unsupported_node_type",
        evidenceRefs: [],
        confidence: "1",
        observedAt: event.createdAt,
        userConfirmed: true,
        visibility: "workspace",
        source: "test_fixture",
        sourceModule: "relationship",
      });
    });

    const firstPage = await store.listRelations(
      workspaceId,
      viewer.id,
      { nodeType: "event", nodeId: event.id },
      { limit: 1 },
    );
    const secondPage = await store.listRelations(
      workspaceId,
      viewer.id,
      { nodeType: "event", nodeId: event.id },
      { limit: 1, cursor: firstPage.nextCursor },
    );
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.items.length, 1);
    assert.equal(secondPage.total, 2);
    assert.equal(secondPage.items.length, 1);
    const visible = [...firstPage.items, ...secondPage.items];
    assert.ok(visible.every((relation) => relation.visibility === "workspace"));
    const participant = visible.find((relation) => relation.edgeType === "participant");
    assert.ok(participant);
    assert.deepEqual(participant.evidenceRefs, [
      { entityType: "event", entityId: event.id, source: "calendar" },
    ]);

    const inaccessibleAnchor = await store.listRelations(
      workspaceId,
      viewer.id,
      { nodeType: "community", nodeId: privateCommunity.id },
      { limit: 10 },
    );
    assert.deepEqual(inaccessibleAnchor, {
      items: [],
      total: 0,
      nextCursor: null,
    });

    const detail = await store.getSignalDetail(workspaceId, viewer.id, signal.id);
    assert.ok(detail);
    const communityParticipant = detail.participants.find(
      (entry) => entry.recordType === "community",
    );
    assert.ok(communityParticipant);
    assert.deepEqual(communityParticipant.evidenceRefs, [
      { entityType: "event", entityId: event.id, source: "calendar" },
    ]);
    assert.deepEqual(
      detail.participants.map((entry) => `${entry.recordType}:${entry.recordId}`),
      [`community:${visibleCommunity.id}`],
      "Signal detail returns only accessible materialized participant Relations",
    );
  } finally {
    await close();
  }
});

test("Relation keyset pagination is deterministic for tied timestamps and concurrent inserts", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    const [person] = await db
      .insert(schema.people)
      .values({
        workspaceId,
        userId,
        visibility: "private",
        fullNameOverride: "test_fixture_keyset_person",
      })
      .returning({ id: schema.people.id });
    assert.ok(person);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "test_fixture_keyset",
        subjectType: "person",
        subjectId: person.id,
        payload: {},
        recommendedAction: {},
      })
      .returning({ id: schema.signals.id });
    assert.ok(signal);
    const [event] = await db
      .insert(schema.events)
      .values({
        workspaceId,
        type: "test_fixture_keyset",
        entityType: "signal",
        entityId: signal.id,
        payload: {},
      })
      .returning({ id: schema.events.id });
    assert.ok(event);
    const tiedAt = new Date("2026-07-16T12:00:00.124Z");
    const initialIds = Array.from(
      { length: 101 },
      (_, index) =>
        `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT
          set_config('app.workspace_id', ${workspaceId}, true),
          set_config('app.user_id', ${userId}, true)
      `);
      await tx.insert(schema.edges).values(
        initialIds.map((id, index) => ({
          id,
          workspaceId,
          ownerUserId: userId,
          srcType: "event",
          srcId: event.id,
          dstType: "person",
          dstId: person.id,
          edgeType: `test_fixture_keyset_${index}`,
          evidenceRefs: [{ entityType: "event", entityId: event.id }],
          confidence: "1",
          observedAt: tiedAt,
          visibility: "private",
          source: "test_fixture",
          sourceModule: "relationship",
          createdAt: tiedAt,
        })),
      );
      await tx.execute(sql`
        UPDATE edges
        SET
          observed_at = CASE
            WHEN id::text <= '10000000-0000-4000-8000-000000000051'
              THEN '2026-07-16T12:00:00.123900Z'::timestamptz
            ELSE '2026-07-16T12:00:00.123800Z'::timestamptz
          END,
          created_at = CASE
            WHEN id::text <= '10000000-0000-4000-8000-000000000051'
              THEN '2026-07-16T12:00:00.123900Z'::timestamptz
            ELSE '2026-07-16T12:00:00.123800Z'::timestamptz
          END
        WHERE workspace_id = ${workspaceId}
      `);
    });
    const store = new DrizzleGraphStore(db);
    const first = await store.listRelations(
      workspaceId,
      userId,
      { nodeType: "event", nodeId: event.id },
      { limit: 50 },
    );
    assert.equal(first.items.length, 50);
    assert.equal(first.total, 101);
    assert.ok(first.nextCursor);

    const concurrentId = "f0000000-0000-4000-8000-000000000001";
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT
          set_config('app.workspace_id', ${workspaceId}, true),
          set_config('app.user_id', ${userId}, true)
      `);
      await tx.insert(schema.edges).values({
        id: concurrentId,
        workspaceId,
        ownerUserId: userId,
        srcType: "event",
        srcId: event.id,
        dstType: "person",
        dstId: person.id,
        edgeType: "test_fixture_keyset_concurrent",
        evidenceRefs: [{ entityType: "event", entityId: event.id }],
        confidence: "1",
        observedAt: tiedAt,
        visibility: "private",
        source: "test_fixture",
        sourceModule: "relationship",
        createdAt: tiedAt,
      });
    });

    const second = await store.listRelations(
      workspaceId,
      userId,
      { nodeType: "event", nodeId: event.id },
      { limit: 50, cursor: first.nextCursor },
    );
    assert.equal(second.items.length, 50);
    assert.ok(second.nextCursor);
    const third = await store.listRelations(
      workspaceId,
      userId,
      { nodeType: "event", nodeId: event.id },
      { limit: 50, cursor: second.nextCursor },
    );
    assert.equal(third.items.length, 1);
    assert.equal(third.nextCursor, null);
    const pagedIds = [...first.items, ...second.items, ...third.items].map(
      (relation) => relation.id,
    );
    assert.equal(new Set(pagedIds).size, 101);
    assert.deepEqual(new Set(pagedIds), new Set(initialIds));
    assert.equal(pagedIds.includes(concurrentId), false);

    const fresh = await store.listRelations(
      workspaceId,
      userId,
      { nodeType: "event", nodeId: event.id },
      { limit: 1 },
    );
    assert.equal(fresh.total, 102);
    assert.equal(fresh.items[0]?.id, concurrentId);
  } finally {
    await close();
  }
});

test("Relation evidence and Signal participants use bounded batch authorization", async () => {
  const queries: string[] = [];
  const { db, close } = await createLocalDb({
    queryLogger: {
      logQuery(query) {
        queries.push(query);
      },
    },
  });
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    const participantRows = await db
      .insert(schema.people)
      .values(
        Array.from({ length: 100 }, (_, index) => ({
          workspaceId,
          userId,
          visibility: "private",
          fullNameOverride: `test_fixture_batch_person_${index}`,
        })),
      )
      .returning({ id: schema.people.id });
    const subject = participantRows[0];
    assert.ok(subject);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId,
        type: "test_fixture_batch_authorization",
        subjectType: "person",
        subjectId: subject.id,
        payload: {},
        recommendedAction: {},
      })
      .returning({ id: schema.signals.id });
    assert.ok(signal);
    const [event] = await db
      .insert(schema.events)
      .values({
        workspaceId,
        type: "test_fixture_batch_authorization",
        entityType: "signal",
        entityId: signal.id,
        payload: {},
      })
      .returning({ id: schema.events.id });
    assert.ok(event);
    const evidenceRefs = Array.from({ length: 100 }, (_, index) => ({
      entityType: "event" as const,
      entityId: event.id,
      source: `test_fixture_source_${index}`,
    }));
    const observedAt = new Date("2026-07-16T13:00:00.000Z");
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT
          set_config('app.workspace_id', ${workspaceId}, true),
          set_config('app.user_id', ${userId}, true)
      `);
      await tx.insert(schema.edges).values([
        {
          id: randomUUID(),
          workspaceId,
          ownerUserId: userId,
          srcType: "signal",
          srcId: signal.id,
          dstType: "event",
          dstId: event.id,
          edgeType: "source_event",
          evidenceRefs,
          confidence: "1",
          observedAt,
          userConfirmed: true,
          visibility: "private",
          source: "test_fixture",
          sourceModule: "relationship",
          decisionLedgerId: randomUUID(),
          decisionSequence: 1,
          decisionAt: observedAt,
        },
        ...participantRows.map((participant, index) => ({
          id: randomUUID(),
          workspaceId,
          ownerUserId: userId,
          srcType: "event",
          srcId: event.id,
          dstType: "person",
          dstId: participant.id,
          edgeType: "participant",
          properties: { index },
          evidenceRefs,
          confidence: "1",
          observedAt,
          userConfirmed: true,
          visibility: "private",
          source: "test_fixture",
          sourceModule: "relationship",
          decisionLedgerId: randomUUID(),
          decisionSequence: index + 2,
          decisionAt: observedAt,
        })),
      ]);
    });
    const store = new DrizzleGraphStore(db);

    queries.length = 0;
    const relationPage = await store.listRelations(
      workspaceId,
      userId,
      { nodeType: "event", nodeId: event.id },
      { limit: 100 },
    );
    assert.equal(relationPage.items.length, 100);
    assert.ok(
      relationPage.items.every((relation) => relation.evidenceRefs.length === 100),
      "distinct provenance sources for one authorization target must be preserved",
    );
    assert.ok(queries.length <= 6, `expected at most 6 queries, received ${queries.length}`);
    assert.equal(
      queries.filter((query) =>
        query.startsWith('select "events"."id" from "events" inner join'),
      ).length,
      0,
      "the already-authorized source Event must not be rechecked for repeated evidence",
    );

    queries.length = 0;
    const detail = await store.getSignalDetail(workspaceId, userId, signal.id);
    assert.equal(detail?.participants.length, 100);
    assert.ok(
      detail?.participants.every(
        (participant) => participant.evidenceRefs.length === 100,
      ),
    );
    assert.ok(queries.length <= 8, `expected at most 8 queries, received ${queries.length}`);
    assert.equal(
      queries.filter(
        (query) =>
          query.startsWith('select "people"."id"') && query.includes(" in ("),
      ).length,
      1,
      "all participant Records must resolve in one batch query",
    );
    assert.equal(
      queries.filter((query) =>
        query.startsWith('select "events"."id" from "events" inner join'),
      ).length,
      0,
      "Signal detail must reuse its already-authorized source Event",
    );
  } finally {
    await close();
  }
});

test("Relationship search escapes wildcards and clamps page bounds", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId, workspaceId } = await seedWorkspaceAndUser(db);
    const [otherUser] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_relationship_search_other@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(otherUser);
    await db.insert(schema.people).values([
      ...Array.from({ length: 103 }, (_, index) => ({
        workspaceId,
        userId,
        visibility: "workspace",
        fullNameOverride: `Bounded Person ${String(index).padStart(3, "0")}`,
        ...(index < 3
          ? { emailsOverride: ["ambiguous-intake@example.com"] }
          : {}),
      })),
      {
        workspaceId,
        userId,
        visibility: "workspace",
        fullNameOverride: "Literal 100% Match",
        emailsOverride: ["intake-match@example.com"],
      },
      {
        workspaceId,
        userId,
        visibility: "workspace",
        fullNameOverride: "Literal 100X Match",
      },
      {
        workspaceId,
        userId: otherUser.id,
        visibility: "private",
        fullNameOverride: "Hidden email match",
        emailsOverride: ["intake-match@example.com"],
      },
    ]);
    const store = new DrizzleGraphStore(db);

    const bounded = await store.listPeople(workspaceId, userId, {
      limit: 1_000,
      offset: -50,
    });
    assert.equal(bounded.items.length, 100);
    assert.equal(bounded.total, 105);

    const literalPercent = await store.listPeople(workspaceId, userId, {
      limit: 50,
      offset: 0,
      query: "%",
    });
    assert.equal(literalPercent.total, 1);
    assert.equal(literalPercent.items[0]?.displayName, "Literal 100% Match");
    const exactEmail = await store.findPeopleByEmail(
      workspaceId,
      userId,
      " INTAKE-MATCH@example.com ",
    );
    assert.deepEqual(
      exactEmail.map((person) => person.displayName),
      ["Literal 100% Match"],
      "exact intake matching prunes another owner's private Person",
    );
    assert.equal(
      (
        await store.findPeopleByEmail(
          workspaceId,
          userId,
          "ambiguous-intake@example.com",
          50,
        )
      ).length,
      2,
      "identity ambiguity detection remains bounded",
    );
  } finally {
    await close();
  }
});

test("Relationship lifecycle is owner-only, decision-provenanced, and archive-idempotent", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId: ownerUserId, workspaceId } = await seedWorkspaceAndUser(db);
    const [viewer] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_relationship_lifecycle_viewer@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(viewer);
    const store = new DrizzleGraphStore(db);
    const personId = randomUUID();
    const createDecisionId = randomUUID();
    const updateDecisionId = randomUUID();
    const staleUpdateDecisionId = randomUUID();
    const ordinaryInteractionId = randomUUID();
    const laggingUpdateDecisionId = randomUUID();
    const staleArchiveDecisionId = randomUUID();
    const archiveDecisionId = randomUUID();
    const archivedUpdateDecisionId = randomUUID();
    const archivedRetryDecisionId = randomUUID();

    const created = await store.createPerson({
      id: personId,
      workspaceId,
      ownerUserId,
      displayName: "Lifecycle Person",
      currentTitle: "Builder",
      bio: "Inspectably governed.",
      emails: ["LIFECYCLE@example.com", "lifecycle@example.com"],
      visibility: "workspace",
      source: "user",
      decisionLedgerId: createDecisionId,
      decisionSequence: 1,
      decisionAt: new Date("2026-07-18T10:00:00.000Z"),
    });
    assert.equal(created.ownerUserId, ownerUserId);
    assert.deepEqual(created.emails, ["lifecycle@example.com"]);
    assert.equal((await store.getPerson(workspaceId, viewer.id, personId))?.isOwner, false);

    const deniedUpdate = await store.updatePerson({
      id: personId,
      workspaceId,
      ownerUserId: viewer.id,
      displayName: "Unauthorized rename",
      decisionLedgerId: randomUUID(),
      decisionSequence: 2,
      decisionAt: new Date("2026-07-18T10:01:00.000Z"),
    });
    assert.equal(deniedUpdate, null);
    const deniedArchive = await store.archivePerson({
      id: personId,
      workspaceId,
      ownerUserId: viewer.id,
      decisionLedgerId: randomUUID(),
      decisionSequence: 3,
      decisionAt: new Date("2026-07-18T10:02:00.000Z"),
    });
    assert.equal(deniedArchive, false);

    const updated = await store.updatePerson({
      id: personId,
      workspaceId,
      ownerUserId,
      displayName: "Lifecycle Person Updated",
      visibility: "private",
      decisionLedgerId: updateDecisionId,
      decisionSequence: 4,
      decisionAt: new Date("2026-07-18T10:03:00.000Z"),
    });
    assert.equal(updated?.displayName, "Lifecycle Person Updated");
    assert.equal(await store.getPerson(workspaceId, viewer.id, personId), null);
    const staleReplay = await store.updatePerson({
      id: personId,
      workspaceId,
      ownerUserId,
      displayName: "Stale replay must not win",
      decisionLedgerId: staleUpdateDecisionId,
      decisionSequence: 2,
      decisionAt: new Date("2026-07-18T10:01:30.000Z"),
    });
    assert.equal(
      staleReplay?.displayName,
      "Lifecycle Person Updated",
      "an older durable effect cannot overwrite a newer Record decision",
    );
    await store.createInteraction({
      id: ordinaryInteractionId,
      workspaceId,
      ownerUserId,
      kind: "person_updated",
      occurredAt: new Date("2026-07-18T10:02:00.000Z"),
      summary: "Ordinary meeting after the queued Record update",
      source: "user",
      visibility: "private",
      participants: [{ recordType: "person", recordId: personId }],
      decisionLedgerId: ordinaryInteractionId,
      decisionSequence: 6,
      decisionAt: new Date("2026-07-18T10:02:00.000Z"),
    });
    const laggingUpdate = await store.updatePerson({
      id: personId,
      workspaceId,
      ownerUserId,
      currentTitle: "Recovered after meeting",
      decisionLedgerId: laggingUpdateDecisionId,
      decisionSequence: 5,
      decisionAt: new Date("2026-07-18T10:01:45.000Z"),
    });
    assert.equal(
      laggingUpdate?.currentTitle,
      "Recovered after meeting",
      "even a colliding Interaction kind cannot supersede a delayed Record mutation",
    );
    assert.equal(
      await store.archivePerson({
        id: personId,
        workspaceId,
        ownerUserId,
        decisionLedgerId: staleArchiveDecisionId,
        decisionSequence: 3,
        decisionAt: new Date("2026-07-18T10:02:30.000Z"),
      }),
      true,
    );
    assert.equal(
      (await store.getPerson(workspaceId, ownerUserId, personId))?.displayName,
      "Lifecycle Person Updated",
      "an older archive cannot erase a newer Record decision",
    );

    assert.equal(
      await store.archivePerson({
        id: personId,
        workspaceId,
        ownerUserId,
        decisionLedgerId: archiveDecisionId,
        decisionSequence: 7,
        decisionAt: new Date("2026-07-18T10:04:00.000Z"),
      }),
      true,
    );
    assert.equal(
      await store.archivePerson({
        id: personId,
        workspaceId,
        ownerUserId,
        decisionLedgerId: archiveDecisionId,
        decisionSequence: 7,
        decisionAt: new Date("2026-07-18T10:04:00.000Z"),
      }),
      true,
    );
    assert.equal(
      await store.updatePerson({
        id: personId,
        workspaceId,
        ownerUserId,
        displayName: "Archived Record must stay archived",
        decisionLedgerId: archivedUpdateDecisionId,
        decisionSequence: 8,
        decisionAt: new Date("2026-07-18T10:05:00.000Z"),
      }),
      null,
    );
    assert.equal(
      await store.archivePerson({
        id: personId,
        workspaceId,
        ownerUserId,
        decisionLedgerId: archivedRetryDecisionId,
        decisionSequence: 9,
        decisionAt: new Date("2026-07-18T10:06:00.000Z"),
      }),
      true,
    );
    assert.equal(await store.getPerson(workspaceId, ownerUserId, personId), null);

    const lifecycleEvents = await db
      .select({ id: schema.events.id, payload: schema.events.payload })
      .from(schema.events)
      .where(eq(schema.events.entityType, "interaction"));
    assert.deepEqual(
      lifecycleEvents.map((event) => event.id).sort(),
      [
        archiveDecisionId,
        createDecisionId,
        laggingUpdateDecisionId,
        ordinaryInteractionId,
        updateDecisionId,
      ].sort(),
    );
    assert.ok(
      lifecycleEvents.every((event) => {
        const payload = event.payload as Record<string, unknown>;
        return payload.decisionLedgerId === event.id;
      }),
    );
    assert.equal(
      (lifecycleEvents.find((event) => event.id === ordinaryInteractionId)?.payload as
        | Record<string, unknown>
        | undefined)?.recordMutationLifecycle,
      undefined,
    );
    assert.ok(
      lifecycleEvents
        .filter((event) => event.id !== ordinaryInteractionId)
        .every(
          (event) =>
            (event.payload as Record<string, unknown>).recordMutationLifecycle === true,
        ),
    );
    const skippedReceipts = await db
      .select({ id: schema.events.id, payload: schema.events.payload })
      .from(schema.events)
      .where(eq(schema.events.entityType, "materialization_receipt"));
    assert.deepEqual(
      skippedReceipts.map((event) => event.id).sort(),
      [
        archivedRetryDecisionId,
        archivedUpdateDecisionId,
        staleArchiveDecisionId,
        staleUpdateDecisionId,
      ].sort(),
    );
    assert.ok(
      skippedReceipts.every((event) => {
        const payload = event.payload as Record<string, unknown>;
        return (
          payload.outcome === "skipped" &&
          (payload.reason === "record_archived" ||
            payload.reason === "superseded_by_newer_decision")
        );
      }),
    );
  } finally {
    await close();
  }
});

test("Interaction participants drive one bounded Timeline with pruned provenance", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId: ownerUserId, workspaceId } = await seedWorkspaceAndUser(db);
    const [viewer] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_relationship_timeline_viewer@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(viewer);
    const [person, privatePerson] = await db
      .insert(schema.people)
      .values([
        {
          workspaceId,
          userId: ownerUserId,
          visibility: "workspace",
          fullNameOverride: "Timeline Person",
        },
        {
          workspaceId,
          userId: ownerUserId,
          visibility: "private",
          fullNameOverride: "Private Timeline Person",
        },
      ])
      .returning({ id: schema.people.id });
    const [community] = await db
      .insert(schema.communities)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "workspace",
        nameOverride: "Timeline Community",
      })
      .returning({ id: schema.communities.id });
    assert.ok(person);
    assert.ok(privatePerson);
    assert.ok(community);
    const store = new DrizzleGraphStore(db);
    const visibleEventIds = [randomUUID(), randomUUID()];
    const visibleDecisionIds = [randomUUID(), randomUUID()];

    for (const [index, id] of visibleEventIds.entries()) {
      const item = await store.createInteraction({
        id,
        workspaceId,
        ownerUserId,
        kind: index === 0 ? "meeting" : "email",
        occurredAt: new Date(
          index === 0
            ? "2026-07-18T11:00:00.000Z"
            : "2026-07-18T10:00:00.000Z",
        ),
        summary: index === 0 ? "Met at the community office." : "Sent a follow-up.",
        source: index === 0 ? "calendar" : "gmail",
        sourceRecordId: `source-${index}`,
        visibility: "workspace",
        participants: [
          { recordType: "person", recordId: person.id, role: "attendee" },
          { recordType: "community", recordId: community.id, role: "host" },
        ],
        decisionLedgerId: visibleDecisionIds[index]!,
        decisionSequence: index + 1,
        decisionAt: new Date(`2026-07-18T1${index}:01:00.000Z`),
      });
      assert.equal(item.participants.length, 2);
      assert.deepEqual(item.provenance.decisionLedgerIds, [visibleDecisionIds[index]]);
      assert.deepEqual(item.provenance.evidenceRefs, [
        { entityType: "event", entityId: id, source: index === 0 ? "calendar" : "gmail" },
      ]);
    }
    const personAfterInteractions = await store.getPerson(
      workspaceId,
      ownerUserId,
      person.id,
    );
    assert.equal(
      personAfterInteractions?.lastInteractionAt?.toISOString(),
      "2026-07-18T11:00:00.000Z",
      "the latest real Interaction advances Person freshness",
    );
    const privateEventId = randomUUID();
    await store.createInteraction({
      id: privateEventId,
      workspaceId,
      ownerUserId,
      kind: "note",
      occurredAt: new Date("2026-07-18T12:00:00.000Z"),
      summary: "Private participant context.",
      source: "capture",
      visibility: "workspace",
      participants: [
        { recordType: "community", recordId: community.id },
        { recordType: "person", recordId: privatePerson.id },
      ],
      decisionLedgerId: randomUUID(),
      decisionSequence: 3,
      decisionAt: new Date("2026-07-18T12:01:00.000Z"),
    });

    const firstPage = await store.listTimeline(
      workspaceId,
      viewer.id,
      "community",
      community.id,
      { limit: 1 },
    );
    assert.equal(firstPage.items.length, 1);
    assert.equal(
      firstPage.items[0]?.id,
      visibleEventIds[0],
      "Timeline order follows occurrence time, not insertion time",
    );
    assert.ok(firstPage.nextCursor);
    const secondPage = await store.listTimeline(
      workspaceId,
      viewer.id,
      "community",
      community.id,
      { limit: 1, cursor: firstPage.nextCursor },
    );
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(
      new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)),
      new Set(visibleEventIds),
    );
    assert.ok(
      [...firstPage.items, ...secondPage.items].every((item) =>
        item.participants.every((participant) => participant.recordId !== privatePerson.id),
      ),
    );

    const ownerTimeline = await store.listTimeline(
      workspaceId,
      ownerUserId,
      "community",
      community.id,
      { limit: 100 },
    );
    assert.equal(ownerTimeline.items.length, 3);
    assert.equal(ownerTimeline.nextCursor, null);
    assert.equal(
      ownerTimeline.items.find((item) => item.id === privateEventId)?.visibility,
      "private",
    );
  } finally {
    await close();
  }
});

test("Commitments are private evidence-bearing Event snapshots with bounded current-state reads", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId: ownerUserId, workspaceId } = await seedWorkspaceAndUser(db);
    const [viewer, person] = await Promise.all([
      db
        .insert(schema.users)
        .values({ email: "test_fixture_commitment_viewer@example.com" })
        .returning({ id: schema.users.id })
        .then((rows) => rows[0]),
      db
        .insert(schema.people)
        .values({
          workspaceId,
          userId: ownerUserId,
          visibility: "workspace",
          fullNameOverride: "Commitment Person",
        })
        .returning({ id: schema.people.id })
        .then((rows) => rows[0]),
    ]);
    assert.ok(viewer);
    assert.ok(person);
    const store = new DrizzleGraphStore(db);
    const commitmentId = randomUUID();
    const createDecisionId = randomUUID();
    const updateDecisionId = randomUUID();
    const archiveDecisionId = randomUUID();

    const created = await store.materializeCommitment({
      operation: "create",
      commitmentId,
      transitionEventId: commitmentId,
      workspaceId,
      ownerUserId,
      personId: person.id,
      text: "Send the diligence notes",
      dueAt: new Date("2026-07-25T12:00:00.000Z"),
      status: "pending",
      decisionLedgerId: createDecisionId,
      decisionSequence: 1,
      decisionAt: new Date("2026-07-18T12:00:00.000Z"),
    });
    assert.equal(created.provenance.evidenceRefs[0]?.entityId, commitmentId);

    await store.materializeCommitment({
      operation: "update",
      commitmentId,
      transitionEventId: updateDecisionId,
      workspaceId,
      ownerUserId,
      personId: person.id,
      text: "Sent the diligence notes",
      dueAt: new Date("2026-07-25T12:00:00.000Z"),
      status: "completed",
      decisionLedgerId: updateDecisionId,
      decisionSequence: 2,
      decisionAt: new Date("2026-07-19T12:00:00.000Z"),
    });

    const current = await store.listCommitments(
      workspaceId,
      ownerUserId,
      person.id,
      { limit: 25, offset: 0 },
    );
    assert.equal(current.total, 1);
    assert.equal(current.items[0]?.status, "completed");
    assert.equal(current.items[0]?.text, "Sent the diligence notes");
    assert.equal(current.items[0]?.provenance.decisionLedgerId, updateDecisionId);
    assert.deepEqual(
      await store.listCommitments(workspaceId, viewer.id, person.id, {
        limit: 25,
        offset: 0,
      }),
      { items: [], total: 0 },
      "another workspace member cannot read the owner's private commitment",
    );
    const timeline = await store.listTimeline(
      workspaceId,
      ownerUserId,
      "person",
      person.id,
      { limit: 25 },
    );
    assert.deepEqual(
      timeline.items.map((item) => item.id),
      [updateDecisionId, commitmentId],
      "commitment transitions remain in the unified Timeline",
    );

    await store.materializeCommitment({
      operation: "archive",
      commitmentId,
      transitionEventId: archiveDecisionId,
      workspaceId,
      ownerUserId,
      personId: person.id,
      text: "Sent the diligence notes",
      dueAt: new Date("2026-07-25T12:00:00.000Z"),
      status: "archived",
      decisionLedgerId: archiveDecisionId,
      decisionSequence: 3,
      decisionAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    assert.equal(
      (
        await store.listCommitments(workspaceId, ownerUserId, person.id, {
          limit: 25,
          offset: 0,
        })
      ).total,
      0,
    );
    assert.equal(
      (
        await store.listCommitments(workspaceId, ownerUserId, person.id, {
          limit: 25,
          offset: 0,
          includeArchived: true,
        })
      ).items[0]?.status,
      "archived",
    );
  } finally {
    await close();
  }
});

test("Introductions require double consent and keep decline reasons private", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId: ownerUserId, workspaceId } = await seedWorkspaceAndUser(db);
    const [[viewer], people] = await Promise.all([
      db
        .insert(schema.users)
        .values({ email: "test_fixture_introduction_viewer@example.com" })
        .returning({ id: schema.users.id }),
      db
        .insert(schema.people)
        .values([
          {
            workspaceId,
            userId: ownerUserId,
            visibility: "workspace",
            fullNameOverride: "Introduction Source",
          },
          {
            workspaceId,
            userId: ownerUserId,
            visibility: "workspace",
            fullNameOverride: "Introduction Target",
          },
        ])
        .returning({ id: schema.people.id }),
    ]);
    assert.ok(viewer);
    const [source, target] = people;
    assert.ok(source);
    assert.ok(target);
    const store = new DrizzleGraphStore(db);
    const introductionId = randomUUID();
    await store.materializeIntroduction({
      operation: "create",
      introductionId,
      transitionEventId: introductionId,
      workspaceId,
      ownerUserId,
      sourcePersonId: source.id,
      targetPersonId: target.id,
      initiatorConsent: true,
      recipientConsent: false,
      status: "awaiting_consents",
      decisionLedgerId: randomUUID(),
      decisionSequence: 1,
      decisionAt: new Date("2026-07-18T12:00:00.000Z"),
    });
    const readyEventId = randomUUID();
    const ready = await store.materializeIntroduction({
      operation: "consent",
      introductionId,
      transitionEventId: readyEventId,
      workspaceId,
      ownerUserId,
      sourcePersonId: source.id,
      targetPersonId: target.id,
      initiatorConsent: true,
      recipientConsent: true,
      status: "ready",
      decisionLedgerId: readyEventId,
      decisionSequence: 2,
      decisionAt: new Date("2026-07-19T12:00:00.000Z"),
    });
    assert.equal(ready.status, "ready");
    assert.equal(ready.provenance.relationIds.length, 2);
    assert.equal(
      (await store.listIntroductions(workspaceId, ownerUserId, source.id, {
        limit: 25,
        offset: 0,
      })).items[0]?.status,
      "ready",
    );
    assert.equal(
      (await store.listIntroductions(workspaceId, ownerUserId, target.id, {
        limit: 25,
        offset: 0,
      })).items[0]?.id,
      introductionId,
      "both People see the same Introduction lifecycle",
    );
    assert.deepEqual(
      await store.listIntroductions(workspaceId, viewer.id, source.id, {
        limit: 25,
        offset: 0,
      }),
      { items: [], total: 0 },
      "a different member cannot read the owner's private Introduction",
    );

    const declinedIntroductionId = randomUUID();
    await store.materializeIntroduction({
      operation: "create",
      introductionId: declinedIntroductionId,
      transitionEventId: declinedIntroductionId,
      workspaceId,
      ownerUserId,
      sourcePersonId: source.id,
      targetPersonId: target.id,
      initiatorConsent: true,
      recipientConsent: false,
      status: "awaiting_consents",
      decisionLedgerId: randomUUID(),
      decisionSequence: 3,
      decisionAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    const declinedEventId = randomUUID();
    await store.materializeIntroduction({
      operation: "consent",
      introductionId: declinedIntroductionId,
      transitionEventId: declinedEventId,
      workspaceId,
      ownerUserId,
      sourcePersonId: source.id,
      targetPersonId: target.id,
      initiatorConsent: true,
      recipientConsent: false,
      status: "declined",
      declineReason: "Not the right time",
      decisionLedgerId: declinedEventId,
      decisionSequence: 4,
      decisionAt: new Date("2026-07-21T12:00:00.000Z"),
    });
    const declined = await store.listIntroductions(
      workspaceId,
      ownerUserId,
      source.id,
      { limit: 1, offset: 0, introductionId: declinedIntroductionId },
    );
    assert.equal(declined.items[0]?.status, "declined");
    assert.equal(declined.items[0]?.declineReasonRecorded, true);
    assert.equal(
      JSON.stringify(declined).includes("Not the right time"),
      false,
      "decline reason contents are not returned by Relationship projections",
    );
  } finally {
    await close();
  }
});

test("Relationship paths are shortest, bounded, and visibility-pruned", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { userId: ownerUserId, workspaceId } = await seedWorkspaceAndUser(db);
    const [otherUser] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_path_other@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(otherUser);
    const [start, end, hidden] = await db
      .insert(schema.people)
      .values([
        {
          workspaceId,
          userId: ownerUserId,
          visibility: "workspace",
          fullNameOverride: "Path Start",
        },
        {
          workspaceId,
          userId: ownerUserId,
          visibility: "workspace",
          fullNameOverride: "Path End",
        },
        {
          workspaceId,
          userId: otherUser.id,
          visibility: "private",
          fullNameOverride: "Hidden Path End",
        },
      ])
      .returning({ id: schema.people.id });
    const [community] = await db
      .insert(schema.communities)
      .values({
        workspaceId,
        userId: ownerUserId,
        visibility: "workspace",
        nameOverride: "Path Community",
      })
      .returning({ id: schema.communities.id });
    assert.ok(start);
    assert.ok(end);
    assert.ok(hidden);
    assert.ok(community);
    const store = new DrizzleGraphStore(db);
    await store.upsertRelation({
      workspaceId,
      ownerUserId,
      srcType: "person",
      srcId: start.id,
      dstType: "community",
      dstId: community.id,
      relationType: "member",
      properties: {},
      evidenceRefs: [{ entityType: "community", entityId: community.id, source: "user" }],
      confidence: 0.8,
      observedAt: new Date("2026-07-18T12:00:00.000Z"),
      userConfirmed: true,
      visibility: "workspace",
      source: "user",
      sourceModule: "relationship",
    });
    await store.upsertRelation({
      workspaceId,
      ownerUserId,
      srcType: "community",
      srcId: community.id,
      dstType: "person",
      dstId: end.id,
      relationType: "member",
      properties: {},
      evidenceRefs: [{ entityType: "community", entityId: community.id, source: "user" }],
      confidence: 0.5,
      observedAt: new Date("2026-07-18T12:01:00.000Z"),
      userConfirmed: true,
      visibility: "workspace",
      source: "user",
      sourceModule: "relationship",
    });

    const result = await store.findRelationshipPaths(
      workspaceId,
      ownerUserId,
      { nodeType: "person", nodeId: start.id },
      { nodeType: "person", nodeId: end.id },
      { maxDepth: 4, maxPaths: 3, maxVisited: 10, maxEdgesPerNode: 10 },
    );
    assert.equal(result.paths.length, 1);
    assert.deepEqual(
      result.paths[0]?.nodes.map((node) => node.nodeType),
      ["person", "community", "person"],
    );
    assert.equal(result.paths[0]?.confidence, 0.4);
    assert.ok(result.visited <= 10);
    assert.equal(
      (
        await store.findRelationshipPaths(
          workspaceId,
          ownerUserId,
          { nodeType: "person", nodeId: start.id },
          { nodeType: "person", nodeId: end.id },
          { maxDepth: 1, maxPaths: 3 },
        )
      ).paths.length,
      0,
    );
    assert.deepEqual(
      await store.findRelationshipPaths(
        workspaceId,
        ownerUserId,
        { nodeType: "person", nodeId: start.id },
        { nodeType: "person", nodeId: hidden.id },
        { maxDepth: 4, maxPaths: 3 },
      ),
      { paths: [], visited: 0, truncated: false },
      "an inaccessible endpoint is indistinguishable from no path",
    );
  } finally {
    await close();
  }
});
