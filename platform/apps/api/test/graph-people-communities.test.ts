/**
 * Relationship Person/Community read surfaces and Help Request routing.
 * Mirrors graph.listRecords/listSignals: organization-scoped, paginated, rejects
 * any organizationId that isn't the pilot organization (assertPilotOrganization).
 *
 * `Wiring` doesn't expose a raw db handle (graphStore/organizationStore keep it
 * private), so fixtures are seeded through a short-lived `createLocalDb`
 * connection bound to the SAME `BRIDGE_LOCAL_DIR` `buildWiring()` will use —
 * same one-connection-at-a-time approach pagination.test.ts uses for
 * `integration.list`, since pglite doesn't reliably share writes across two
 * concurrently-open connections against one on-disk directory.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { TRPCError } from "@trpc/server";
import { createLocalDb, schema } from "@bridge/db";
import {
  InMemoryRoleStore,
  SeededRng,
  SystemClock,
  UuidGen,
  hashTaintValue,
  labelAtSource,
  type Actor,
  type RunCtx,
} from "@bridge/core";
import { makeContextFactory } from "../src/context.js";
import { reconcileOrganizationRelationshipMaterializations } from "../src/relationship-materializer.js";
import { materializeRelationshipMutation } from "../src/relationship-record-materializer.js";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

const FIXTURE_COUNT = 5;

/**
 * `authenticated` mirrors context.ts's `makeContextFactory`, which attaches a
 * `human_input`-derived taintLabel to `ctx.run` for every authenticated
 * request (and none for an anonymous/tokenless one). This harness calls
 * `appRouter.createCaller()` directly, bypassing that factory, so it must
 * reproduce the SAME label an authenticated request always gets — otherwise
 * ADR-142's fail-closed unknown-taint-axis quarantine (taint.ts's
 * `evaluateTaintSink`) misclassifies a genuine authenticated Human turn as
 * unlabeled/untrusted and blocks any non-`pure_data` Skill run under an agent
 * actor (see `relationship.help-request.stage-offer`/`stageCapture`, neither
 * of which sets `executionClass: "pure_data"`).
 */
function makeRun(options: { authenticated?: boolean } = {}): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    ...(options.authenticated !== false
      ? {
          taintLabel: labelAtSource("human_input", {
            ref: "test-fixture:authenticated-caller",
            valueHash: hashTaintValue("test-fixture-authenticated-caller"),
            sensitivity: "organization",
            instructionRisk: "none",
          }),
        }
      : {}),
  };
}

async function makeCaller(
  wiring: Wiring,
  identity: Actor = { type: "user", id: PILOT_USER },
) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity,
    authenticated: true, // SEC-1: in-process test caller is a trusted, authenticated actor
    verifying: false,
  });
}

async function makeAnonymousVerifiedCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun({ authenticated: false }),
    identity: { type: "user", id: PILOT_USER },
    authenticated: false,
    verifying: true,
  });
}

/** Seed FIXTURE_COUNT people + FIXTURE_COUNT communities under PILOT_ORGANIZATION/
 * PILOT_USER via a connection to `dir`, then close it BEFORE `buildWiring()` opens
 * its own connection against the same directory. */
async function seedFixtures(
  dir: string,
  options: { addNewerSourceEvent?: boolean; firstPersonSkills?: string[] } = {},
): Promise<{
  signalId: string;
  eventId: string;
  personId: string;
  memberPersonId: string;
  communityId: string;
  otherMemberId: string;
  otherSignalId: string;
  otherEventId: string;
  otherPersonId: string;
  newerEventId: string | null;
}> {
  const { db, close } = await createLocalDb({ dataDir: dir });
  try {
    // Idempotent: organization/user rows may already exist from a prior buildWiring()
    // bootstrap against this directory; onConflictDoNothing keeps this safe to
    // call before that bootstrap ever runs too.
    await db.insert(schema.organizations).values({ id: PILOT_ORGANIZATION, name: "Pilot organization (graph test)" }).onConflictDoNothing({
      target: schema.organizations.id,
    });
    await db.insert(schema.users).values({ id: PILOT_USER, email: "test_fixture_pilot@example.com" }).onConflictDoNothing({
      target: schema.users.id,
    });
    const [otherMember] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_relation_organization_member@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(otherMember);
    await db.insert(schema.organizationMembers).values({
      organizationId: PILOT_ORGANIZATION,
      userId: otherMember.id,
    });
    // Only populated when a test needs a Person with real server-side skills
    // (Helpdesk topic-routing) — every other test leaves this null, so their
    // fixtures are byte-for-byte unchanged.
    let firstPersonCanonicalId: string | null = null;
    if (options.firstPersonSkills) {
      const [canonical] = await db
        .insert(schema.peopleCanonical)
        .values({ skills: options.firstPersonSkills })
        .returning({ id: schema.peopleCanonical.id });
      firstPersonCanonicalId = canonical?.id ?? null;
      assert.ok(firstPersonCanonicalId);
    }
    let firstPersonId: string | null = null;
    let memberPersonId: string | null = null;
    let firstCommunityId: string | null = null;
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      const [person] = await db
        .insert(schema.people)
        .values({
          organizationId: PILOT_ORGANIZATION,
          userId: PILOT_USER,
          fullNameOverride: `test_fixture_person_${i}`,
          ...(i === 0 && firstPersonCanonicalId ? { canonicalPersonId: firstPersonCanonicalId } : {}),
        })
        .returning({ id: schema.people.id });
      if (i === 0) firstPersonId = person?.id ?? null;
      if (i === 1) memberPersonId = person?.id ?? null;
      const [community] = await db
        .insert(schema.communities)
        .values({
          organizationId: PILOT_ORGANIZATION,
          userId: PILOT_USER,
          nameOverride: `test_fixture_community_${i}`,
        })
        .returning({ id: schema.communities.id });
      if (i === 0) firstCommunityId = community?.id ?? null;
    }
    assert.ok(firstPersonId);
    assert.ok(memberPersonId);
    assert.ok(firstCommunityId);
    await db.insert(schema.communityMembers).values({
      communityId: firstCommunityId,
      personId: memberPersonId,
      role: "member",
      confidence: "1",
    });
    const signalId = randomUUID();
    const [event] = await db
      .insert(schema.events)
      .values({
        id: signalId,
        organizationId: PILOT_ORGANIZATION,
        type: "calendar.meeting_upcoming",
        entityType: "event",
        entityId: signalId,
        payload: {
          source: "google-calendar",
          relationshipSignal: {
            type: "meeting_prep",
            subjectType: "person",
            subjectId: firstPersonId,
            payload: { reason: "A permitted meeting Event is approaching." },
            recommendedAction: { label: "Prepare context" },
            status: "new",
          },
        },
      })
      .returning({ id: schema.events.id });
    assert.ok(event);
    const signal = event;
    await db.insert(schema.edges).values({
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
      srcType: "event",
      srcId: event.id,
      dstType: "person",
      dstId: firstPersonId,
      edgeType: "participant",
      properties: { role: "attendee" },
      evidenceRefs: [{ entityType: "event", entityId: event.id, source: "google-calendar" }],
      confidence: "1",
      visibility: "private",
      source: "google-calendar",
      sourceModule: "relationship",
    });
    const [otherPerson] = await db
      .insert(schema.people)
      .values({
        organizationId: PILOT_ORGANIZATION,
        userId: otherMember.id,
        visibility: "private",
        fullNameOverride: "test_fixture_other_owner_person",
      })
      .returning({ id: schema.people.id });
    assert.ok(otherPerson);
    await db.insert(schema.communityMembers).values({
      communityId: firstCommunityId,
      personId: otherPerson.id,
      role: "private member",
      confidence: "1",
    });
    const otherSignalId = randomUUID();
    const [otherEvent] = await db
      .insert(schema.events)
      .values({
        id: otherSignalId,
        organizationId: PILOT_ORGANIZATION,
        type: "calendar.meeting_upcoming",
        entityType: "event",
        entityId: otherSignalId,
        payload: {
          source: "google-calendar",
          relationshipSignal: {
            type: "meeting_prep",
            subjectType: "person",
            subjectId: otherPerson.id,
            payload: { reason: "An owner-scoped Event is approaching." },
            recommendedAction: { label: "Prepare context" },
            status: "new",
          },
        },
      })
      .returning({ id: schema.events.id });
    assert.ok(otherEvent);
    const otherSignal = otherEvent;
    await db.insert(schema.edges).values({
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: otherMember.id,
      srcType: "event",
      srcId: otherEvent.id,
      dstType: "person",
      dstId: otherPerson.id,
      edgeType: "participant",
      evidenceRefs: [
        {
          entityType: "event",
          entityId: otherEvent.id,
          source: "google-calendar",
        },
      ],
      confidence: "1",
      visibility: "private",
      source: "google-calendar",
      sourceModule: "relationship",
    });
    let newerEventId: string | null = null;
    if (options.addNewerSourceEvent) {
      newerEventId = signal.id;
    }
    return {
      signalId: signal.id,
      eventId: event.id,
      personId: firstPersonId,
      memberPersonId,
      communityId: firstCommunityId,
      otherMemberId: otherMember.id,
      otherSignalId: otherSignal.id,
      otherEventId: otherEvent.id,
      otherPersonId: otherPerson.id,
      newerEventId,
    };
  } finally {
    await close();
  }
}

test("graph.listPeople: paginates people under the pilot organization", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-graph-people-test-"));
  const fixtures = await seedFixtures(dir);

  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    const caller = await makeCaller(wiring);

    const page = await caller.relationship.listPeople({ organizationId: PILOT_ORGANIZATION, limit: 2, offset: 0 });
    assert.equal(page.items.length, 2);
    assert.equal(page.total, FIXTURE_COUNT);
    assert.equal(page.hasMore, true);

    const lastPage = await caller.relationship.listPeople({ organizationId: PILOT_ORGANIZATION, limit: 2, offset: 4 });
    assert.equal(lastPage.items.length, 1);
    assert.equal(lastPage.hasMore, false);

    for (const organizationId of ["test_fixture_other_organization", ""]) {
      await assert.rejects(
        () => caller.relationship.listPeople({ organizationId, limit: 10, offset: 0 }),
        // the organization guard middleware rejects a non-pilot organizationId before input parsing
        (error) => error instanceof TRPCError && error.code === "FORBIDDEN",
      );
    }

    await assert.rejects(
      () => caller.relationship.listPeople({
        organizationId: "83000000-0000-4000-8000-000000000001",
        limit: 10,
        offset: 0,
      }),
      (error) => error instanceof TRPCError && error.code === "FORBIDDEN",
    );
    assert.equal(
      await caller.relationship.getPerson({
        organizationId: PILOT_ORGANIZATION,
        id: "84000000-0000-4000-8000-000000000001",
      }),
      null,
    );
    assert.equal(
      (await caller.relationship.getPerson({
        organizationId: PILOT_ORGANIZATION,
        id: fixtures.personId,
      }))?.id,
      fixtures.personId,
    );
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});

test("Relationship private reads reject an unverified pilot fallback", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeAnonymousVerifiedCaller(wiring);
    await assert.rejects(
      () => caller.relationship.listPeople({ organizationId: PILOT_ORGANIZATION, limit: 10, offset: 0 }),
      /UNAUTHORIZED|authentication required/,
    );
  } finally {
    await wiring.close();
  }
});

test("Relationship private reads accept a verified bearer through the real API context", async () => {
  const secret = "test_fixture_relationship_context_secret";
  const priorSecret = process.env.SUPABASE_JWT_SECRET;
  const priorUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_JWT_SECRET = secret;
  delete process.env.SUPABASE_URL;
  const wiring = await buildWiring();
  try {
    const passwordAuthenticatedAt = Math.floor(Date.now() / 1_000);
    const token = await new SignJWT({
      amr: [{ method: "password", timestamp: passwordAuthenticatedAt }],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(PILOT_USER)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(secret));
    const context = await makeContextFactory(wiring)({
      req: { headers: { authorization: `Bearer ${token}` } },
    });
    assert.equal(context.authenticated, true);
    assert.deepEqual(context.identity, { type: "user", id: PILOT_USER });
    assert.equal(context.reauthenticatedAt, passwordAuthenticatedAt * 1_000);

    const caller = appRouter.createCaller(context);
    const page = await caller.relationship.listPeople({
      organizationId: PILOT_ORGANIZATION,
      limit: 10,
      offset: 0,
    });
    assert.ok(Array.isArray(page.items));
  } finally {
    await wiring.close();
    if (priorSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = priorSecret;
    if (priorUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = priorUrl;
  }
});

test("nested Helpdesk keeps token access public while its inbox requires authentication", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeAnonymousVerifiedCaller(wiring);
    const createInput = {
      organizationId: PILOT_ORGANIZATION,
      subject: "Public Help Request",
      submitterEmail: "public-help-request@example.com",
      body: "Please route this request.",
      operationId: "10000000-0000-4000-8000-000000000011",
      accessToken: "test_fixture_public_token_0000000000000001",
    };
    const created = await caller.relationship.helpdesk.public.createTicket(createInput);
    const retried = await caller.relationship.helpdesk.public.createTicket(createInput);
    assert.equal(retried.ticket.id, created.ticket.id);
    assert.equal(retried.message.id, created.message.id);
    await assert.rejects(() =>
      caller.relationship.helpdesk.public.createTicket({
        ...createInput,
        subject: "Oversized request",
        body: "x".repeat(10_001),
      }),
    );
    assert.ok(created.ticket.accessToken);
    const replyInput = {
      accessToken: created.ticket.accessToken,
      body: "One idempotent public reply.",
      operationId: "10000000-0000-4000-8000-000000000012",
    };
    const reply = await caller.relationship.helpdesk.public.reply(replyInput);
    const retriedReply = await caller.relationship.helpdesk.public.reply(replyInput);
    assert.equal(retriedReply.id, reply.id);
    assert.equal(
      (await caller.relationship.helpdesk.public.getThread({ accessToken: created.ticket.accessToken })).messages.length,
      2,
    );

    await assert.rejects(
      () => caller.relationship.helpdesk.list({ organizationId: PILOT_ORGANIZATION, limit: 10, offset: 0 }),
      /UNAUTHORIZED|authentication required/,
    );
  } finally {
    await wiring.close();
  }
});

test("Helpdesk rejects malformed Person identifiers before querying UUID columns", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.relationship.helpdesk.route({
          organizationId: PILOT_ORGANIZATION,
          subject: "Need help",
          body: "",
          candidatePersonIds: ["not-a-uuid"],
          limit: 3,
        }),
      /Invalid uuid|validation/i,
    );
    await assert.rejects(
      () =>
        caller.relationship.helpdesk.stageAnswer({
          organizationId: PILOT_ORGANIZATION,
          subject: "Need help",
          body: "",
          routedToPersonId: "not-a-uuid",
          candidateTopics: ["fundraising"],
          draftBody: "I can help.",
        }),
      /Invalid uuid|validation/i,
    );
  } finally {
    await wiring.close();
  }
});

test("graph.listCommunities: paginates communities under the pilot organization", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-graph-communities-test-"));
  await seedFixtures(dir);

  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    const caller = await makeCaller(wiring);

    const page = await caller.relationship.listCommunities({ organizationId: PILOT_ORGANIZATION, limit: 3, offset: 0 });
    assert.equal(page.items.length, 3);
    assert.equal(page.total, FIXTURE_COUNT);
    assert.equal(page.hasMore, true);

    const lastPage = await caller.relationship.listCommunities({ organizationId: PILOT_ORGANIZATION, limit: 3, offset: 3 });
    assert.equal(lastPage.items.length, 2);
    assert.equal(lastPage.hasMore, false);

    await assert.rejects(() =>
      caller.relationship.listCommunities({ organizationId: "test_fixture_other_organization", limit: 10, offset: 0 }),
    );
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});

test("graph Relationship path resolves evidence and proposes a governed Action", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-graph-relationship-test-"));
  const fixture = await seedFixtures(dir, { firstPersonSkills: ["fundraising"] });

  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    assert.ok(wiring.roles instanceof InMemoryRoleStore);
    wiring.roles.direct.set(`user:${PILOT_USER}`, [
      { resourceType: "signal", resourceId: null, action: "write", effect: "allow", dataScope: "private" },
    ]);
    const caller = await makeCaller(wiring);

    const fullGraph = await caller.graph.full({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
    });
    assert.ok(fullGraph.nodes.some((node) => node.id === `signal:${fixture.signalId}` && node.actionKind === "signal"));
    assert.ok(fullGraph.nodes.some((node) => node.id === `event:${fixture.eventId}`));
    assert.ok(fullGraph.nodes.some((node) => node.id === `person:${fixture.personId}`));
    assert.ok(fullGraph.nodes.every((node) => node.provenance.length > 0));
    assert.ok(fullGraph.edges.some((edge) => edge.sourceModule === "relationship" && edge.evidence.includes("source relationship")));

    const detail = await caller.relationship.getSignalDetail({
      organizationId: PILOT_ORGANIZATION,
      signalId: fixture.signalId,
    });
    assert.ok(detail);
    assert.equal(detail.sourceEvent?.id, fixture.eventId);
    assert.equal(detail.participants[0]?.recordId, fixture.personId);
    assert.equal(detail.participants[0]?.relationType, "participant");

    const proposal = await caller.relationship.proposeSignalAction({
      organizationId: PILOT_ORGANIZATION,
      signalId: fixture.signalId,
    });
    assert.equal(proposal.status, "applied");
    assert.equal(proposal.request.resourceType, "signal");
    assert.equal(proposal.request.resourceId, fixture.signalId);
    assert.equal(proposal.request.seed, fixture.eventId);
    assert.equal(proposal.request.actor.plane, "local");

    // D6: topics come from the Person's OWN server-side `skills` (seeded
    // above as ["fundraising"]) — the caller supplies WHO to consider, never
    // their topics.
    const routed = await caller.relationship.helpdesk.route({
      organizationId: PILOT_ORGANIZATION,
      subject: "Fundraising support",
      body: "We need fundraising guidance.",
      candidatePersonIds: [fixture.personId],
      limit: 3,
    });
    assert.equal(routed.routes[0]?.personId, fixture.personId);
    assert.deepEqual(routed.routes[0]?.matchedTopics, ["fundraising"]);

    // Caller-supplied topics can no longer drive routing: a request that only
    // matches a caller-asserted topic (not the Person's real server-side
    // skills) must NOT route, and any legacy `topicsByPerson` payload a
    // caller still sends is silently ignored, never read.
    const ignoredCallerTopics = await caller.relationship.helpdesk.route({
      organizationId: PILOT_ORGANIZATION,
      subject: "kubernetes crash",
      body: "the cluster is down",
      candidatePersonIds: [fixture.personId],
      limit: 3,
      topicsByPerson: { [fixture.personId]: ["kubernetes"] },
    } as unknown as Parameters<typeof caller.relationship.helpdesk.route>[0]);
    assert.deepEqual(ignoredCallerTopics.routes, []);

    const staged = await caller.relationship.helpdesk.stageAnswer({
      organizationId: PILOT_ORGANIZATION,
      subject: "Fundraising support",
      body: "We need fundraising guidance.",
      routedToPersonId: routed.routes[0]!.personId,
      candidateTopics: routed.routes[0]!.matchedTopics,
      draftBody: "I can help with your fundraising questions.",
    });
    assert.equal(staged.offer.routedTo, fixture.personId);
    assert.deepEqual(staged.offer.routeEvidence.matchedTopics, ["fundraising"]);
    assert.equal(staged.offer.routeEvidence.topicSource, "caller_supplied");
    assert.equal(staged.proposal.request.resourceId, fixture.personId);
    assert.equal(staged.proposal.status, "pending_review");
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});

test("Relationship API stages, edits, materializes, and idempotently reconciles approved Relations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-relationship-materialization-test-"));
  const fixture = await seedFixtures(dir, { addNewerSourceEvent: true });
  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    assert.ok(wiring.roles instanceof InMemoryRoleStore);
    wiring.roles.direct.set(`user:${PILOT_USER}`, [
      {
        resourceType: "relation",
        resourceId: null,
        action: "read",
        effect: "allow",
        dataScope: "private",
      },
      {
        resourceType: "relation",
        resourceId: null,
        action: "write",
        effect: "allow",
        dataScope: "private",
      },
    ]);
    wiring.roles.direct.set(
      `user:${fixture.otherMemberId}`,
      wiring.roles.direct.get(`user:${PILOT_USER}`) ?? [],
    );
    const caller = await makeCaller(wiring);

    assert.deepEqual(
      await caller.relationship.nodeTypeOwner({
        organizationId: PILOT_ORGANIZATION,
        nodeType: "event",
      }),
      { nodeType: "event", plane: "operational", owningModule: "relationship" },
    );
    await assert.rejects(
      () =>
        Reflect.apply(caller.action.propose, caller.action, [{
          organizationId: PILOT_ORGANIZATION,
          actor: { type: "user", id: PILOT_USER },
          action: "write",
          resourceType: "relation",
          inputs: {},
          skill: "stageMutation",
        }]),
      /validation|invalid/i,
    );

    const anonymous = await makeAnonymousVerifiedCaller(wiring);
    await assert.rejects(
      () =>
        anonymous.relationship.listRelations({
          organizationId: PILOT_ORGANIZATION,
          nodeType: "signal",
          nodeId: fixture.signalId,
          limit: 10,
        }),
      /UNAUTHORIZED|authentication required/,
    );
    const nonmember = await makeCaller(wiring, {
      type: "user",
      id: "50000000-0000-4000-8000-000000000099",
    });
    await assert.rejects(
      () =>
        nonmember.relationship.nodeTypeOwner({
          organizationId: PILOT_ORGANIZATION,
          nodeType: "person",
        }),
      /FORBIDDEN|not a member/,
    );
    await assert.rejects(
      () =>
        caller.relationship.listRelations({
          organizationId: "00000000-0000-4000-8000-000000000099",
          nodeType: "signal",
          nodeId: fixture.signalId,
          limit: 10,
        }),
      /pilot organization|BAD_REQUEST/i,
    );

    await assert.rejects(
      () =>
        caller.relationship.proposeSignalEvidence({
          organizationId: PILOT_ORGANIZATION,
          signalId: fixture.signalId,
          sourceEventId: fixture.eventId,
          visibility: "private",
          userConfirmed: false,
          participants: [
            {
              recordType: "community",
              recordId: fixture.communityId,
              confidence: 0.8,
            },
          ],
        }),
      /include the Signal subject|BAD_REQUEST/i,
    );

    await assert.rejects(
      () =>
        caller.relationship.proposeSignalEvidence({
          organizationId: PILOT_ORGANIZATION,
          signalId: fixture.signalId,
          sourceEventId: fixture.eventId,
          visibility: "private",
          userConfirmed: false,
          participants: [
            {
              recordType: "person",
              recordId: fixture.personId,
              confidence: 0.7,
            },
            {
              recordType: "person",
              recordId: fixture.personId.toUpperCase(),
              confidence: 0.8,
            },
          ],
        }),
      /participants must be unique|BAD_REQUEST/i,
    );

    const proposed = await caller.relationship.proposeSignalEvidence({
      organizationId: PILOT_ORGANIZATION.toUpperCase(),
      signalId: fixture.signalId.toUpperCase(),
      sourceEventId: fixture.eventId.toUpperCase(),
      visibility: "private",
      userConfirmed: false,
      participants: [
        {
          recordType: "person",
          recordId: fixture.personId.toUpperCase(),
          role: "attendee",
          confidence: 0.7,
        },
        {
          recordType: "community",
          recordId: fixture.communityId.toUpperCase(),
          role: "host",
          confidence: 0.8,
        },
      ],
    });
    assert.equal(proposed.proposal.status, "pending_review");
    assert.equal(proposed.proposal.request.resourceType, "relation");
    assert.equal(proposed.proposal.request.seed, fixture.eventId);
    assert.equal(proposed.proposal.request.actor.plane, "local");
    assert.deepEqual(proposed.proposal.request.inputs, {
      kind: "relationship_signal_evidence",
      signalId: fixture.signalId,
      sourceEventId: fixture.eventId,
      visibility: "private",
      userConfirmed: false,
      participants: [
        {
          recordType: "person",
          recordId: fixture.personId,
          role: "attendee",
          confidence: 0.7,
        },
        {
          recordType: "community",
          recordId: fixture.communityId,
          role: "host",
          confidence: 0.8,
        },
      ],
    });
    assert.equal(proposed.materialization.status, "pending_approval");
    const otherMemberCaller = await makeCaller(wiring, {
      type: "user",
      id: fixture.otherMemberId,
    });
    await assert.rejects(
      () => otherMemberCaller.google.list(),
      /NOT_FOUND|integration not found/,
      "a organization member cannot operate another user's Google integration",
    );
    assert.equal(
      (
        await otherMemberCaller.action.listPending({
          organizationId: PILOT_ORGANIZATION,
          limit: 50,
          offset: 0,
        })
      ).total,
      0,
    );
    await assert.rejects(
      () => otherMemberCaller.action.resolution({ proposalId: proposed.proposal.id }),
      /NOT_FOUND|proposal not found/,
    );
    await assert.rejects(
      () =>
        otherMemberCaller.action.decide({
          proposalId: proposed.proposal.id,
          decision: "approve",
        }),
      /NOT_FOUND|proposal not found/,
    );
    assert.equal(
      (
        await caller.relationship.listRelations({
          organizationId: PILOT_ORGANIZATION,
          nodeType: "signal",
          nodeId: fixture.signalId,
          limit: 10,
        })
      ).total,
      0,
      "a pending proposal must not materialize a Relation",
    );

    await assert.rejects(
      () =>
        caller.action.decide({
          proposalId: proposed.proposal.id,
          decision: "edit",
          editedOutput: {
            kind: "relationship_signal_evidence",
            signalId: fixture.signalId,
            sourceEventId: fixture.eventId,
            visibility: "private",
            userConfirmed: true,
            participants: [
              {
                recordType: "person",
                recordId: fixture.personId,
                confidence: 0.9,
              },
              {
                recordType: "person",
                recordId: fixture.personId,
                confidence: 0.8,
              },
            ],
          },
        }),
      /Relation contract|participants must be unique/i,
    );
    assert.deepEqual(
      await caller.action.resolution({ proposalId: proposed.proposal.id }),
      { status: "pending", decision: null },
    );
    await assert.rejects(
      () =>
        caller.action.decide({
          proposalId: proposed.proposal.id,
          decision: "edit",
          editedOutput: {
            kind: "relationship_signal_evidence",
            signalId: fixture.signalId,
            sourceEventId: fixture.eventId,
            visibility: "private",
            userConfirmed: true,
            participants: [
              {
                recordType: "community",
                recordId: fixture.communityId,
                confidence: 0.9,
              },
            ],
          },
        }),
      /retain its accessible Signal subject|BAD_REQUEST/i,
    );
    assert.deepEqual(
      await caller.action.resolution({ proposalId: proposed.proposal.id }),
      { status: "pending", decision: null },
    );

    const originalMaterialize = wiring.graphStore.materializeSignalEvidence.bind(wiring.graphStore);
    let failMaterializationOnce = true;
    wiring.graphStore.materializeSignalEvidence = async (input) => {
      if (failMaterializationOnce) {
        failMaterializationOnce = false;
        throw new Error("test_fixture_relation_materialization_interrupted");
      }
      return originalMaterialize(input);
    };
    const editedOutput = {
      kind: "relationship_signal_evidence" as const,
      signalId: fixture.signalId,
      sourceEventId: fixture.eventId,
      visibility: "private" as const,
      userConfirmed: true,
      reviewClientOnly: "must-not-persist",
      participants: [
        {
          recordType: "person" as const,
          recordId: fixture.personId,
          role: " reviewed-attendee ",
          confidence: 0.91,
          reviewClientOnly: "must-not-persist",
        },
        {
          recordType: "community" as const,
          recordId: fixture.communityId,
          role: "reviewed-host",
          confidence: 0.87,
        },
      ],
    };
    const decided = await caller.action.decide({
      proposalId: proposed.proposal.id,
      decision: "edit",
      editedOutput,
      reason: "Corrected participant confidence",
    });
    assert.equal(decided.status, "applied");
    assert.equal(decided.effectsStatus, "failed");
    assert.match(decided.effectsError, /relation_materialization_interrupted/);
    assert.ok("relationshipMaterialization" in decided);
    assert.equal(decided.relationshipMaterialization.status, "failed");
    assert.equal(decided.relationshipMaterialization.attempts, 1);
    const failedEffect = await caller.relationship.materializationStatus({
      organizationId: PILOT_ORGANIZATION,
      proposalId: proposed.proposal.id,
    });
    assert.equal(failedEffect?.status, "failed");
    assert.equal(failedEffect?.attempts, 1);
    assert.match(failedEffect?.lastError ?? "", /materialization_interrupted/);
    const outstandingPage =
      await caller.relationship.outstandingMaterializations({
        organizationId: PILOT_ORGANIZATION,
        limit: 10,
      });
    assert.equal(
      outstandingPage.items.some(
        (effect) => effect.proposalId === proposed.proposal.id,
      ),
      true,
    );
    assert.equal(outstandingPage.nextCursor, null);
    assert.equal(outstandingPage.hasMore, false);
    await assert.rejects(
      () =>
        otherMemberCaller.relationship.retryMaterialization({
          organizationId: PILOT_ORGANIZATION,
          proposalId: proposed.proposal.id,
        }),
      /NOT_FOUND|proposal not found/,
    );
    const persistedEditedDecision = await wiring.ledger.decisionFor(proposed.proposal.id);
    assert.ok(persistedEditedDecision);
    assert.ok((persistedEditedDecision.appendSequence ?? 0) > 0);
    assert.deepEqual(persistedEditedDecision.proposedOutput, {
      kind: "relationship_signal_evidence",
      signalId: fixture.signalId,
      sourceEventId: fixture.eventId,
      visibility: "private",
      userConfirmed: true,
      participants: [
        {
          recordType: "person",
          recordId: fixture.personId,
          role: "reviewed-attendee",
          confidence: 0.91,
        },
        {
          recordType: "community",
          recordId: fixture.communityId,
          role: "reviewed-host",
          confidence: 0.87,
        },
      ],
    });
    assert.equal(
      (
        await caller.relationship.listRelations({
          organizationId: PILOT_ORGANIZATION,
          nodeType: "signal",
          nodeId: fixture.signalId,
          limit: 10,
        })
      ).total,
      0,
    );
    assert.equal(
      (await caller.action.listPending({ organizationId: PILOT_ORGANIZATION, limit: 50, offset: 0 })).total,
      0,
      "resolved proposals must not remain in Approvals after a post-decision effect failure",
    );
    assert.deepEqual(
      await caller.action.resolution({ proposalId: proposed.proposal.id }),
      { status: "resolved", decision: "edit" },
    );
    const inFlight = await wiring.relationMaterializations.beginAttempt(
      {
        organizationId: PILOT_ORGANIZATION,
        ownerUserId: PILOT_USER,
        proposalLedgerId: proposed.proposal.id,
        decisionLedgerId: persistedEditedDecision.id,
      },
      new Date(),
    );
    assert.equal(inFlight.started, true);
    assert.ok(inFlight.effect.leaseToken);
    const concurrentLostResponseRetry = await caller.action.decide({
      proposalId: proposed.proposal.id,
      decision: "approve",
    });
    const concurrentMaterialization =
      "relationshipMaterialization" in concurrentLostResponseRetry
        ? concurrentLostResponseRetry.relationshipMaterialization
        : undefined;
    assert.ok(concurrentMaterialization);
    assert.equal(concurrentLostResponseRetry.id, decided.id);
    assert.equal(concurrentLostResponseRetry.recordedDecision, "edit");
    // An already-resolved retry echoes `proposalFromResolvedRelationshipLedger`'s
    // sanitized shape (proposedOutput + diff only, no taintLabel/trustOrigin),
    // never the fresh pipeline.decide() output that produced `decided` — the two
    // intentionally differ in audit-metadata shape under ADR-142 (see taint.ts);
    // the substantive committed content must still match exactly.
    assert.deepEqual(concurrentLostResponseRetry.output?.proposedOutput, decided.output?.proposedOutput);
    assert.deepEqual(concurrentLostResponseRetry.output?.diff, decided.output?.diff);
    assert.equal(concurrentLostResponseRetry.effectsStatus, "failed");
    assert.equal(
      concurrentMaterialization.status,
      "pending",
      "an idempotent repeat must expose the active durable effect instead of returning success-shaped resolution",
    );
    await wiring.relationMaterializations.markFailed(
      inFlight.effect.id,
      PILOT_ORGANIZATION,
      PILOT_USER,
      inFlight.effect.leaseToken,
      "test_fixture_interrupted_in_flight_worker",
      new Date(),
      new Date(),
    );
    const lostResponseRetry = await caller.action.decide({
      proposalId: proposed.proposal.id,
      decision: "approve",
    });
    assert.equal(lostResponseRetry.id, decided.id);
    assert.equal(lostResponseRetry.recordedDecision, "edit");
    // Same sanitized-replay-shape distinction as the concurrent retry above.
    assert.deepEqual(lostResponseRetry.output?.proposedOutput, decided.output?.proposedOutput);
    assert.deepEqual(lostResponseRetry.output?.diff, decided.output?.diff);
    assert.equal(lostResponseRetry.effectsStatus, "confirmed");
    assert.deepEqual(lostResponseRetry.relationshipMaterialization, {
      status: "confirmed",
      relationCount: 2,
    });
    assert.equal(
      (
        await caller.relationship.outstandingMaterializations({
          organizationId: PILOT_ORGANIZATION,
          limit: 10,
        })
      ).items.some((effect) => effect.proposalId === proposed.proposal.id),
      false,
      "applied effects must leave the outstanding retry surface",
    );
    const appliedEffect = await caller.relationship.materializationStatus({
      organizationId: PILOT_ORGANIZATION,
      proposalId: proposed.proposal.id,
    });
    assert.equal(appliedEffect?.status, "applied");
    assert.equal(appliedEffect?.attempts, 3);
    const immutableEditReplay = await caller.action.decide({
      proposalId: proposed.proposal.id,
      decision: "edit",
      editedOutput: { kind: "test_fixture_invalid_after_resolution" },
    });
    assert.equal(immutableEditReplay.id, decided.id);
    // Same sanitized-replay-shape distinction as the concurrent retry above.
    assert.deepEqual(immutableEditReplay.output?.proposedOutput, decided.output?.proposedOutput);
    assert.deepEqual(immutableEditReplay.output?.diff, decided.output?.diff);
    assert.ok("relationshipMaterialization" in immutableEditReplay);
    assert.deepEqual(immutableEditReplay.relationshipMaterialization, {
      status: "confirmed",
      relationCount: 2,
    });

    const reconciled = await caller.relationship.reconcileApproved({
      organizationId: PILOT_ORGANIZATION,
      proposalId: proposed.proposal.id,
    });
    const retried = await caller.relationship.reconcileApproved({
      organizationId: PILOT_ORGANIZATION,
      proposalId: proposed.proposal.id,
    });
    assert.equal(reconciled.status, "confirmed");
    assert.equal(retried.status, "confirmed");
    // D8: the new generic `action.reconcileApproved` (for approved external
    // effect classes with NO dedicated reconcile surface, e.g. plain Google
    // send/DealPilot) explicitly defers a Relationship approval to this
    // already-durable `relationship.reconcileApproved` path instead of
    // silently no-op-succeeding.
    await assert.rejects(
      () => caller.action.reconcileApproved({ proposalId: proposed.proposal.id }),
      (error: unknown) => error instanceof TRPCError && error.code === "BAD_REQUEST",
    );
    const materializedDetail = await caller.relationship.getSignalDetail({
      organizationId: PILOT_ORGANIZATION,
      signalId: fixture.signalId,
    });
    assert.equal(
      materializedDetail?.sourceEvent?.id,
      fixture.eventId,
      "Signal reads must retain the approved Event when a newer unapproved Event exists",
    );
    assert.equal(retried.effect.relationCount, 2);
    const ownerHistory = await caller.action.listHistory({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    assert.ok(
      ownerHistory.items.some((entry) => entry.id === proposed.proposal.id),
      "the authenticated Execution Ledger must include the owner's Relation proposal",
    );
    assert.ok(
      ownerHistory.items.some((entry) => entry.refLedgerId === proposed.proposal.id),
      "the authenticated Execution Ledger must include the owner's Relation decision",
    );
    const historyViewerCaller = await makeCaller(wiring, {
      type: "user",
      id: fixture.otherMemberId,
    });
    const otherMemberHistory = await historyViewerCaller.action.listHistory({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    assert.equal(
      otherMemberHistory.items.some((entry) => entry.resourceType === "relation"),
      false,
      "organization membership must not reveal another owner's Relation ledger rows",
    );
    const signalRelations = await caller.relationship.listRelations({
      organizationId: PILOT_ORGANIZATION,
      nodeType: "signal",
      nodeId: fixture.signalId,
      limit: 10,
    });
    assert.equal(signalRelations.total, 0);
    const eventRelations = await caller.relationship.listRelations({
      organizationId: PILOT_ORGANIZATION,
      nodeType: "event",
      nodeId: fixture.eventId,
      limit: 10,
    });
    assert.equal(eventRelations.total, 2);
    const firstEventPage = await caller.relationship.listRelations({
      organizationId: PILOT_ORGANIZATION,
      nodeType: "event",
      nodeId: fixture.eventId,
      limit: 1,
    });
    assert.ok(firstEventPage.nextCursor);
    const secondEventPage = await caller.relationship.listRelations({
      organizationId: PILOT_ORGANIZATION,
      nodeType: "event",
      nodeId: fixture.eventId,
      limit: 1,
      cursor: firstEventPage.nextCursor,
    });
    assert.equal(secondEventPage.nextCursor, null);
    assert.equal(
      new Set(
        [...firstEventPage.items, ...secondEventPage.items].map(
          (relation) => relation.id,
        ),
      ).size,
      2,
    );
    const editedPerson = eventRelations.items.find(
      (relation) => relation.edgeType === "participant" && relation.dstId === fixture.personId,
    );
    assert.equal(editedPerson?.confidence, "0.9100");
    assert.deepEqual(editedPerson?.properties, { role: "reviewed-attendee" });
    assert.equal(editedPerson?.ownerUserId, PILOT_USER);
    assert.equal(editedPerson?.source, "google-calendar");
    assert.equal(editedPerson?.sourceModule, "relationship");
    assert.equal(editedPerson?.visibility, "private");
    assert.equal(editedPerson?.userConfirmed, true);
    assert.deepEqual(editedPerson?.evidenceRefs, [
      { entityType: "event", entityId: fixture.eventId, source: "google-calendar" },
    ]);

    const approved = await caller.relationship.proposeSignalEvidence({
      organizationId: PILOT_ORGANIZATION,
      signalId: fixture.signalId,
      sourceEventId: fixture.eventId,
      visibility: "private",
      userConfirmed: true,
      participants: [
        {
          recordType: "person",
          recordId: fixture.personId,
          role: "approved-attendee",
          confidence: 0.93,
        },
        {
          recordType: "community",
          recordId: fixture.communityId,
          role: "approved-host",
          confidence: 0.89,
        },
      ],
    });
    const originalPipelineDecide = wiring.pipeline.decide.bind(wiring.pipeline);
    let failAfterPersistedDecision = true;
    wiring.pipeline.decide = async (
      proposalId,
      decision,
      actor,
      run,
      editedOutput,
      decisionReason,
    ) => {
      const result = await originalPipelineDecide(
        proposalId,
        decision,
        actor,
        run,
        editedOutput,
        decisionReason,
      );
      if (failAfterPersistedDecision) {
        failAfterPersistedDecision = false;
        throw new Error("test_fixture_post_decision_pipeline_interrupted");
      }
      return result;
    };
    const approvedDecision = await caller.action.decide({
      proposalId: approved.proposal.id,
      decision: "approve",
    });
    assert.equal(approvedDecision.effectsStatus, "failed");
    assert.match(
      "effectsError" in approvedDecision ? approvedDecision.effectsError : "",
      /post_decision_pipeline_interrupted/,
    );
    assert.ok("relationshipMaterialization" in approvedDecision);
    assert.deepEqual(approvedDecision.relationshipMaterialization, {
      status: "confirmed",
      relationCount: 2,
    });
    assert.deepEqual(
      await caller.action.resolution({ proposalId: approved.proposal.id }),
      { status: "resolved", decision: "approve" },
    );
    const staleReconcile = await caller.relationship.reconcileApproved({
      organizationId: PILOT_ORGANIZATION,
      proposalId: proposed.proposal.id,
    });
    assert.equal(staleReconcile.status, "confirmed");
    const relationsAfterStaleReconcile = await caller.relationship.listRelations({
      organizationId: PILOT_ORGANIZATION,
      nodeType: "event",
      nodeId: fixture.eventId,
      limit: 10,
    });
    const latestPerson = relationsAfterStaleReconcile.items.find(
      (relation) => relation.edgeType === "participant" && relation.dstId === fixture.personId,
    );
    assert.equal(
      latestPerson?.confidence,
      "0.9300",
      "reconciling an older approval must not roll back newer approved Relation state",
    );
    assert.deepEqual(latestPerson?.properties, { role: "approved-attendee" });

    const leaseRaceProposal = await caller.relationship.proposeSignalEvidence({
      organizationId: PILOT_ORGANIZATION,
      signalId: fixture.signalId,
      sourceEventId: fixture.eventId,
      visibility: "private",
      userConfirmed: true,
      participants: [
        {
          recordType: "person",
          recordId: fixture.personId,
          role: "test_fixture_lease_race",
          confidence: 0.96,
        },
      ],
    });
    await wiring.pipeline.decide(
      leaseRaceProposal.proposal.id,
      "approve",
      { type: "user", id: PILOT_USER },
      makeRun(),
    );
    const originalMarkApplied =
      wiring.relationMaterializations.markApplied.bind(
        wiring.relationMaterializations,
      );
    wiring.relationMaterializations.markApplied = async (...args) => {
      const effect = await originalMarkApplied(...args);
      throw new Error(
        `test_fixture_response_lost_after_applied_${effect.id}`,
      );
    };
    try {
      const leaseRaceResult =
        await caller.relationship.retryMaterialization({
          organizationId: PILOT_ORGANIZATION,
          proposalId: leaseRaceProposal.proposal.id,
        });
      assert.equal(leaseRaceResult.status, "confirmed");
      assert.equal(leaseRaceResult.effect.status, "applied");
    } finally {
      wiring.relationMaterializations.markApplied = originalMarkApplied;
    }

    const vetoed = await caller.relationship.proposeSignalEvidence({
      organizationId: PILOT_ORGANIZATION,
      signalId: fixture.signalId,
      sourceEventId: fixture.eventId,
      visibility: "private",
      userConfirmed: false,
      participants: [
        { recordType: "person", recordId: fixture.personId, confidence: 0.2 },
      ],
    });
    await caller.action.decide({ proposalId: vetoed.proposal.id, decision: "veto" });
    await assert.rejects(
      () =>
        caller.relationship.reconcileApproved({
          organizationId: PILOT_ORGANIZATION,
          proposalId: vetoed.proposal.id,
        }),
      /no approved resolution|PRECONDITION_FAILED/i,
    );

    const restartGap = await caller.relationship.proposeSignalEvidence({
      organizationId: PILOT_ORGANIZATION,
      signalId: fixture.signalId,
      sourceEventId: fixture.eventId,
      visibility: "private",
      userConfirmed: true,
      participants: [
        {
          recordType: "person",
          recordId: fixture.personId,
          role: "test_fixture_restart_recovered",
          confidence: 0.95,
        },
      ],
    });
    await wiring.pipeline.decide(
      restartGap.proposal.id,
      "approve",
      { type: "user", id: PILOT_USER },
      makeRun(),
    );
    const otherRestartGap =
      await otherMemberCaller.relationship.proposeSignalEvidence({
        organizationId: PILOT_ORGANIZATION,
        signalId: fixture.otherSignalId,
        sourceEventId: fixture.otherEventId,
        visibility: "private",
        userConfirmed: true,
        participants: [
          {
            recordType: "person",
            recordId: fixture.otherPersonId,
            role: "test_fixture_other_owner_restart_recovered",
            confidence: 0.94,
          },
        ],
      });
    await wiring.pipeline.decide(
      otherRestartGap.proposal.id,
      "approve",
      { type: "user", id: fixture.otherMemberId },
      makeRun(),
    );
    assert.equal(
      await caller.relationship.materializationStatus({
        organizationId: PILOT_ORGANIZATION,
        proposalId: restartGap.proposal.id,
      }),
      null,
      "the fixture simulates a process stop after decision persistence but before outbox creation",
    );
    assert.equal(
      await otherMemberCaller.relationship.materializationStatus({
        organizationId: PILOT_ORGANIZATION,
        proposalId: otherRestartGap.proposal.id,
      }),
      null,
    );
    await wiring.close();
    wiring = undefined;
    wiring = await buildWiring();
    const restartedCaller = await makeCaller(wiring);
    const restartedOtherCaller = await makeCaller(wiring, {
      type: "user",
      id: fixture.otherMemberId,
    });
    const automaticRetry =
      await reconcileOrganizationRelationshipMaterializations(
        wiring.graphStore,
        wiring.relationMaterializations,
        wiring.ledger,
        PILOT_ORGANIZATION,
        new Date(Date.now() + 60_000),
      );
    assert.equal(automaticRetry.ownersExamined, 2);
    assert.equal(automaticRetry.discovered, 2);
    assert.equal(automaticRetry.applied, 2);
    assert.equal(
      (
        await restartedCaller.relationship.materializationStatus({
          organizationId: PILOT_ORGANIZATION,
          proposalId: restartGap.proposal.id,
        })
      )?.status,
      "applied",
    );
    assert.equal(
      (
        await restartedOtherCaller.relationship.materializationStatus({
          organizationId: PILOT_ORGANIZATION,
          proposalId: otherRestartGap.proposal.id,
        })
      )?.status,
      "applied",
    );
    assert.ok(fixture.newerEventId);
    assert.ok(wiring.roles instanceof InMemoryRoleStore);
    wiring.roles.direct.set(`user:${PILOT_USER}`, [
      {
        resourceType: "relation",
        resourceId: null,
        action: "read",
        effect: "allow",
        dataScope: "private",
      },
      {
        resourceType: "relation",
        resourceId: null,
        action: "write",
        effect: "allow",
        dataScope: "private",
      },
    ]);
    const obsoleteProposal =
      await restartedCaller.relationship.proposeSignalEvidence({
        organizationId: PILOT_ORGANIZATION,
        signalId: fixture.signalId,
        sourceEventId: fixture.eventId,
        visibility: "private",
        userConfirmed: true,
        participants: [
          {
            recordType: "person",
            recordId: fixture.personId,
            role: "test_fixture_obsolete_event_retry",
            confidence: 0.91,
          },
        ],
      });
    const materializeAfterRestart =
      wiring.graphStore.materializeSignalEvidence.bind(wiring.graphStore);
    wiring.graphStore.materializeSignalEvidence = async () => {
      throw new Error("test_fixture_obsolete_event_interrupted");
    };
    const obsoleteDecision = await restartedCaller.action.decide({
      proposalId: obsoleteProposal.proposal.id,
      decision: "approve",
    });
    assert.equal(obsoleteDecision.effectsStatus, "failed");
    wiring.graphStore.materializeSignalEvidence = materializeAfterRestart;
    const newerWinner =
      await restartedCaller.relationship.proposeSignalEvidence({
        organizationId: PILOT_ORGANIZATION,
        signalId: fixture.signalId,
        sourceEventId: fixture.newerEventId,
        visibility: "private",
        userConfirmed: true,
        participants: [
          {
            recordType: "person",
            recordId: fixture.personId,
            role: "test_fixture_newer_event_winner",
            confidence: 0.99,
          },
        ],
      });
    const newerDecision = await restartedCaller.action.decide({
      proposalId: newerWinner.proposal.id,
      decision: "approve",
    });
    assert.ok("relationshipMaterialization" in newerDecision);
    assert.deepEqual(newerDecision.relationshipMaterialization, {
      status: "confirmed",
      relationCount: 1,
    });
    const getSignalEvidenceAnchor =
      wiring.graphStore.getSignalEvidenceAnchor.bind(wiring.graphStore);
    wiring.graphStore.getSignalEvidenceAnchor = async () => {
      throw new Error("test_fixture_obsolete_event_anchor_must_not_be_rechecked");
    };
    const obsoleteRetry =
      await restartedCaller.relationship.retryMaterialization({
        organizationId: PILOT_ORGANIZATION,
        proposalId: obsoleteProposal.proposal.id,
      });
    wiring.graphStore.getSignalEvidenceAnchor = getSignalEvidenceAnchor;
    assert.equal(obsoleteRetry.status, "confirmed");
    assert.equal(obsoleteRetry.effect.status, "applied");
    const recoveredParticipants =
      await restartedCaller.relationship.listRelations({
        organizationId: PILOT_ORGANIZATION,
        nodeType: "event",
        nodeId: fixture.signalId,
        limit: 10,
      });
    assert.equal(recoveredParticipants.items[0]?.dstId, fixture.personId);
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});

test("Relationship Record and Interaction writes stay governed and owner-bound", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-relationship-record-api-test-"));
  const fixture = await seedFixtures(dir);
  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    const caller = await makeCaller(wiring);
    const otherMemberCaller = await makeCaller(wiring, {
      type: "user",
      id: fixture.otherMemberId,
    });

    const impersonatedPersonId = "71000000-0000-4000-8000-000000000099";
    const victimHistoryBefore = await wiring.ledger.listHistory(PILOT_ORGANIZATION, {
      limit: 200,
      offset: 0,
      privateOwnerUserId: PILOT_USER,
    });
    await assert.rejects(
      () =>
        otherMemberCaller.action.propose({
          organizationId: PILOT_ORGANIZATION,
          actor: { type: "user", id: fixture.otherMemberId },
          onBehalfOf: { type: "user", id: PILOT_USER },
          action: "write",
          resourceType: "person",
          resourceId: impersonatedPersonId,
          inputs: {
            kind: "relationship_record_mutation",
            recordType: "person",
            operation: "create",
            recordId: impersonatedPersonId,
            values: {
              displayName: "Forged owner",
              visibility: "private",
            },
          },
          skill: "stageMutation",
          dataScope: "private",
        }),
      /cannot assert delegation|FORBIDDEN/i,
    );
    const victimHistoryAfter = await wiring.ledger.listHistory(PILOT_ORGANIZATION, {
      limit: 200,
      offset: 0,
      privateOwnerUserId: PILOT_USER,
    });
    assert.equal(victimHistoryAfter.total, victimHistoryBefore.total);
    assert.equal(
      await caller.relationship.getPerson({
        organizationId: PILOT_ORGANIZATION,
        id: impersonatedPersonId,
      }),
      null,
    );

    const personCreated = await caller.relationship.createPerson({
      organizationId: PILOT_ORGANIZATION,
      values: {
        displayName: "Governed Person",
        currentTitle: "Operator",
        bio: "Created through the Action Pipeline.",
        emails: ["governed-person@example.com"],
        visibility: "organization",
      },
    });
    assert.equal(personCreated.proposal.status, "applied");
    assert.equal(personCreated.materialization.status, "applied");
    const personId = personCreated.proposal.request.resourceId;
    assert.ok(personId);
    const person = await caller.relationship.getPerson({
      organizationId: PILOT_ORGANIZATION,
      id: personId,
    });
    assert.ok(person);
    assert.equal(person.displayName, "Governed Person");
    assert.equal(person.isOwner, true);

    const communityCreated = await caller.relationship.createCommunity({
      organizationId: PILOT_ORGANIZATION,
      values: {
        displayName: "Governed Community",
        description: "A real governed Community.",
        kind: "network",
        visibility: "organization",
      },
    });
    assert.equal(communityCreated.materialization.status, "applied");
    const communityId = communityCreated.proposal.request.resourceId;
    assert.ok(communityId);
    const community = await caller.relationship.getCommunity({
      organizationId: PILOT_ORGANIZATION,
      id: communityId,
    });
    assert.ok(community);

    await assert.rejects(
      () =>
        otherMemberCaller.relationship.updatePerson({
          organizationId: PILOT_ORGANIZATION,
          id: person.id,
          values: { displayName: "Unauthorized rename" },
        }),
      /NOT_FOUND|Person not found/,
    );
    await assert.rejects(
      () =>
        otherMemberCaller.relationship.archiveCommunity({
          organizationId: PILOT_ORGANIZATION,
          id: community.id,
        }),
      /NOT_FOUND|Community not found/,
    );

    const updateProposalId = "72000000-0000-4000-8000-000000000001";
    await wiring.ledger.append({
      id: updateProposalId,
      organizationId: PILOT_ORGANIZATION,
      actorType: "user",
      actorId: PILOT_USER,
      action: "write",
      resourceType: "person",
      resourceId: person.id,
      inputs: {
        kind: "relationship_record_mutation",
        recordType: "person",
        operation: "update",
        recordId: person.id,
        values: { currentTitle: "Updated through review" },
      },
      proposedOutput: {
        kind: "relationship_record_mutation",
        recordType: "person",
        operation: "update",
        recordId: person.id,
        values: { currentTitle: "Updated through review" },
      },
      userDecision: null,
      policyResults: [{
        policyId: "test-fixture-relationship-human-review",
        phase: "pre",
        effect: "require_approval",
        reason: "Exercise the Human review path.",
      }],
      seed: person.id,
      dataScope: "private",
      createdAt: "2026-07-18T14:00:00.000Z",
    });
    await assert.rejects(
      () =>
        caller.action.decide({
          proposalId: updateProposalId,
          decision: "edit",
          editedOutput: {
            kind: "relationship_record_mutation",
            recordType: "person",
            operation: "update",
            recordId: fixture.personId,
            values: { currentTitle: "Retargeted" },
          },
        }),
      /cannot retarget|target/i,
    );
    assert.equal(
      (await caller.relationship.getPerson({
        organizationId: PILOT_ORGANIZATION,
        id: person.id,
      }))?.currentTitle,
      "Operator",
    );
    await caller.action.decide({
      proposalId: updateProposalId,
      decision: "approve",
    });
    assert.equal(
      (await caller.relationship.getPerson({
        organizationId: PILOT_ORGANIZATION,
        id: person.id,
      }))?.currentTitle,
      "Updated through review",
    );

    const interactionCreated = await caller.relationship.createInteraction({
      organizationId: PILOT_ORGANIZATION,
      values: {
        kind: "meeting",
        occurredAt: "2026-07-18T15:00:00.000Z",
        summary: "Created an RM1-RM2 Interaction.",
        visibility: "organization",
        participants: [
          { recordType: "person", recordId: person.id, role: "attendee" },
          { recordType: "community", recordId: community.id, role: "host" },
        ],
      },
    });
    assert.equal(interactionCreated.proposal.status, "applied");
    assert.equal(interactionCreated.materialization.status, "applied");

    const reviewedEventId = "72000000-0000-4000-8000-000000000002";
    const interactionProposalId = "72000000-0000-4000-8000-000000000003";
    await wiring.ledger.append({
      id: interactionProposalId,
      organizationId: PILOT_ORGANIZATION,
      actorType: "user",
      actorId: PILOT_USER,
      action: "write",
      resourceType: "event",
      resourceId: reviewedEventId,
      inputs: {
        kind: "relationship_interaction_create",
        recordId: reviewedEventId,
        values: {
          kind: "meeting",
          occurredAt: "2026-07-18T15:30:00.000Z",
          summary: "Reviewed an RM1-RM2 Interaction.",
          source: "user",
          sourceRecordId: "local-user-entry",
          visibility: "organization",
          participants: [
            { recordType: "person", recordId: person.id, role: "attendee" },
            { recordType: "community", recordId: community.id, role: "host" },
          ],
        },
      },
      proposedOutput: {
        kind: "relationship_interaction_create",
        recordId: reviewedEventId,
        values: {
          kind: "meeting",
          occurredAt: "2026-07-18T15:30:00.000Z",
          summary: "Reviewed an RM1-RM2 Interaction.",
          source: "user",
          sourceRecordId: "local-user-entry",
          visibility: "organization",
          participants: [
            { recordType: "person", recordId: person.id, role: "attendee" },
            { recordType: "community", recordId: community.id, role: "host" },
          ],
        },
      },
      userDecision: null,
      policyResults: [{
        policyId: "test-fixture-relationship-human-review",
        phase: "pre",
        effect: "require_approval",
        reason: "Exercise the Human review path.",
      }],
      seed: reviewedEventId,
      dataScope: "private",
      createdAt: "2026-07-18T15:31:00.000Z",
    });
    await assert.rejects(
      () =>
        caller.action.decide({
          proposalId: interactionProposalId,
          decision: "edit",
          editedOutput: {
            kind: "relationship_interaction_create",
            recordId: reviewedEventId,
            values: {
              kind: "meeting",
              occurredAt: "2026-07-18T15:30:00.000Z",
              summary: "Reviewed an RM1-RM2 Interaction.",
              source: "gmail",
              sourceRecordId: "local-user-entry",
              visibility: "organization",
              participants: [
                { recordType: "person", recordId: person.id, role: "attendee" },
                { recordType: "community", recordId: community.id, role: "host" },
              ],
            },
          },
        }),
      /cannot change Interaction source provenance|immutable/i,
    );
    await caller.action.decide({
      proposalId: interactionProposalId,
      decision: "approve",
    });
    const personTimeline = await caller.relationship.timeline({
      organizationId: PILOT_ORGANIZATION,
      recordType: "person",
      recordId: person.id,
      limit: 50,
    });
    const interaction = personTimeline.items.find(
      (item) => item.id === reviewedEventId,
    );
    assert.ok(interaction);
    assert.equal(interaction.source, "user");
    assert.equal(interaction.participants.length, 2);
    assert.ok(interaction.provenance.decisionLedgerIds.length > 0);

    const googleEventId = "72000000-0000-4000-8000-000000000004";
    const googleProposalId = "72000000-0000-4000-8000-000000000005";
    const googleDirective = {
      entities: [{
        localId: googleEventId,
        kind: "event",
        personId: person.id,
        payload: {
          interactionKind: "email",
          subject: "Approved Gmail follow-up",
          occurredAt: "2026-07-18T15:45:00.000Z",
          snippet: "Private source text stays in the Local Plane.",
        },
        source: "gmail",
        sourceRecordId: "gmail-thread-1",
      }],
      external: [{
        source: "gmail",
        sourceRecordId: "gmail-thread-1",
        entityType: "event",
      }],
    };
    await wiring.ledger.append({
      id: googleProposalId,
      organizationId: PILOT_ORGANIZATION,
      actorType: "agent",
      actorId: "b0000000-0000-4000-a000-0000000000e2",
      onBehalfOfType: "user",
      onBehalfOfId: PILOT_USER,
      action: "write",
      resourceType: "event",
      inputs: { directive: googleDirective },
      proposedOutput: { directive: googleDirective },
      userDecision: null,
      policyResults: [{
        policyId: "test-fixture-google-intake-review",
        phase: "pre",
        effect: "require_approval",
        reason: "Exercise approved Gmail Timeline intake.",
      }],
      seed: "gmail:gmail-thread-1",
      dataScope: "private",
      trustOrigin: "untrusted_external",
      createdAt: "2026-07-18T15:46:00.000Z",
    });
    await assert.rejects(
      () =>
        otherMemberCaller.action.decide({
          proposalId: googleProposalId,
          decision: "approve",
        }),
      /NOT_FOUND|proposal not found/,
      "another member cannot approve the integration owner's Google intake",
    );
    await assert.rejects(
      () =>
        caller.action.decide({
          proposalId: googleProposalId,
          decision: "edit",
          editedOutput: {
            directive: {
              ...googleDirective,
              entities: [{
                ...googleDirective.entities[0],
                personId: fixture.personId,
              }],
            },
          },
        }),
      /cannot retarget the participant or source Event/i,
    );
    const googleApproved = await caller.action.decide({
      proposalId: googleProposalId,
      decision: "approve",
    });
    assert.ok("relationshipMaterialization" in googleApproved);
    assert.equal(
      googleApproved.relationshipMaterialization?.status,
      "confirmed",
    );
    const timelineWithGoogle = await caller.relationship.timeline({
      organizationId: PILOT_ORGANIZATION,
      recordType: "person",
      recordId: person.id,
      limit: 50,
    });
    const googleInteraction = timelineWithGoogle.items.find(
      (item) => item.id === googleEventId,
    );
    assert.ok(googleInteraction);
    assert.equal(googleInteraction.source, "gmail");
    assert.equal(googleInteraction.summary, "Approved Gmail follow-up");
    assert.deepEqual(
      googleInteraction.provenance.evidenceRefs,
      [{ entityType: "event", entityId: googleEventId, source: "gmail" }],
    );

    const googleNewPersonId = "79000000-0000-4000-8000-000000000001";
    const googleNewEventId = "79000000-0000-4000-8000-000000000002";
    const googleNewProposalId = "79000000-0000-4000-8000-000000000003";
    const privateGoogleEmail = "private-google-person@example.com";
    const googleNewDirective = {
      person: {
        localPersonId: googleNewPersonId,
        fullName: "Private Google Person",
        emails: [privateGoogleEmail],
        dedupKey: privateGoogleEmail,
      },
      entities: [{
        localId: googleNewEventId,
        kind: "event",
        personId: googleNewPersonId,
        payload: {
          interactionKind: "email",
          subject: "First approved private identity interaction",
          occurredAt: "2026-07-18T15:46:30.000Z",
        },
        source: "gmail",
        sourceRecordId: "gmail-thread-new-person-1",
      }],
      external: [{
        source: "gmail",
        sourceRecordId: "gmail-thread-new-person-1",
        entityType: "event",
      }],
    };
    await wiring.ledger.append({
      id: googleNewProposalId,
      organizationId: PILOT_ORGANIZATION,
      actorType: "agent",
      actorId: "b0000000-0000-4000-a000-0000000000e2",
      onBehalfOfType: "user",
      onBehalfOfId: PILOT_USER,
      action: "write",
      resourceType: "event",
      inputs: { directive: googleNewDirective },
      proposedOutput: { directive: googleNewDirective },
      userDecision: null,
      policyResults: [{
        policyId: "test-fixture-google-intake-review",
        phase: "pre",
        effect: "require_approval",
        reason: "Exercise private Google Person materialization.",
      }],
      seed: "gmail:gmail-thread-new-person-1",
      dataScope: "private",
      trustOrigin: "untrusted_external",
      createdAt: "2026-07-18T15:46:31.000Z",
    });
    await caller.action.decide({
      proposalId: googleNewProposalId,
      decision: "approve",
    });
    const googlePerson = await caller.relationship.getPerson({
      organizationId: PILOT_ORGANIZATION,
      id: googleNewPersonId,
    });
    assert.equal(googlePerson?.displayName, "Private Google Person");
    assert.deepEqual(googlePerson?.emails, [privateGoogleEmail]);
    assert.equal(googlePerson?.visibility, "private");
    assert.equal(googlePerson?.source, "google_approved_intake");

    const googleLinkedEventId = "79000000-0000-4000-8000-000000000004";
    const googleLinkedProposalId = "79000000-0000-4000-8000-000000000005";
    const googleLinkedDirective = {
      entities: [{
        localId: googleLinkedEventId,
        kind: "event",
        personId: googleNewPersonId,
        payload: {
          interactionKind: "email",
          subject: "Second linked private identity interaction",
          occurredAt: "2026-07-18T15:46:45.000Z",
        },
        source: "gmail",
        sourceRecordId: "gmail-thread-new-person-2",
      }],
      external: [{
        source: "gmail",
        sourceRecordId: "gmail-thread-new-person-2",
        entityType: "event",
      }],
    };
    await wiring.ledger.append({
      id: googleLinkedProposalId,
      organizationId: PILOT_ORGANIZATION,
      actorType: "agent",
      actorId: "b0000000-0000-4000-a000-0000000000e2",
      onBehalfOfType: "user",
      onBehalfOfId: PILOT_USER,
      action: "write",
      resourceType: "event",
      inputs: { directive: googleLinkedDirective },
      proposedOutput: { directive: googleLinkedDirective },
      userDecision: null,
      policyResults: [{
        policyId: "test-fixture-google-intake-review",
        phase: "pre",
        effect: "require_approval",
        reason: "Exercise linked private Google Person materialization.",
      }],
      seed: "gmail:gmail-thread-new-person-2",
      dataScope: "private",
      trustOrigin: "untrusted_external",
      createdAt: "2026-07-18T15:46:46.000Z",
    });
    await caller.action.decide({
      proposalId: googleLinkedProposalId,
      decision: "approve",
    });
    const linkedTimeline = await caller.relationship.timeline({
      organizationId: PILOT_ORGANIZATION,
      recordType: "person",
      recordId: googleNewPersonId,
      limit: 50,
    });
    assert.ok(
      linkedTimeline.items.some((item) => item.id === googleLinkedEventId),
      "the second source record links to the same owner-scoped Person",
    );

    const calendarEventId = "72000000-0000-4000-8000-000000000008";
    const calendarProposalId = "72000000-0000-4000-8000-000000000009";
    const calendarDecisionId = "72000000-0000-4000-8000-000000000010";
    const calendarDirective = {
      entities: [{
        localId: calendarEventId,
        kind: "event",
        personId: person.id,
        payload: {
          interactionKind: "meeting",
          subject: "Recovered Calendar meeting",
          occurredAt: "2026-07-18T15:47:00.000Z",
        },
        source: "google-calendar",
        sourceRecordId: "calendar-event-1",
      }],
      external: [{
        source: "google-calendar",
        sourceRecordId: "calendar-event-1",
        entityType: "event",
      }],
    };
    await wiring.ledger.append({
      id: calendarProposalId,
      organizationId: PILOT_ORGANIZATION,
      actorType: "agent",
      actorId: "b0000000-0000-4000-a000-0000000000e2",
      onBehalfOfType: "user",
      onBehalfOfId: PILOT_USER,
      action: "write",
      resourceType: "event",
      inputs: { directive: calendarDirective },
      proposedOutput: { directive: calendarDirective },
      userDecision: null,
      policyResults: [],
      dataScope: "private",
      createdAt: "2026-07-18T15:47:30.000Z",
    });
    await wiring.ledger.append({
      id: calendarDecisionId,
      organizationId: PILOT_ORGANIZATION,
      actorType: "agent",
      actorId: "b0000000-0000-4000-a000-0000000000e2",
      onBehalfOfType: "user",
      onBehalfOfId: PILOT_USER,
      action: "write",
      resourceType: "event",
      inputs: { directive: calendarDirective },
      proposedOutput: { directive: calendarDirective },
      userDecision: "approve",
      refLedgerId: calendarProposalId,
      policyResults: [],
      dataScope: "private",
      createdAt: "2026-07-18T15:48:00.000Z",
    });
    const recoveredCalendar =
      await reconcileOrganizationRelationshipMaterializations(
        wiring.graphStore,
        wiring.relationMaterializations,
        wiring.ledger,
        PILOT_ORGANIZATION,
        new Date("2026-07-18T15:49:00.000Z"),
      );
    assert.equal(recoveredCalendar.applied, 1);
    assert.ok(
      (
        await caller.relationship.timeline({
          organizationId: PILOT_ORGANIZATION,
          recordType: "person",
          recordId: person.id,
          limit: 50,
        })
      ).items.some((item) => item.id === calendarEventId),
      "startup reconciliation recovers an approved Calendar Event",
    );

    const recoveredPersonId = "72000000-0000-4000-8000-000000000006";
    const recoveredProposalId = "72000000-0000-4000-8000-000000000007";
    const recoveredPayload = {
      kind: "relationship_record_mutation",
      recordType: "person",
      operation: "create",
      recordId: recoveredPersonId,
      values: {
        displayName: "Recovered Person",
        emails: ["recovered-person@example.com"],
        visibility: "private",
      },
    };
    await wiring.ledger.append({
      id: recoveredProposalId,
      organizationId: PILOT_ORGANIZATION,
      actorType: "user",
      actorId: PILOT_USER,
      action: "write",
      resourceType: "person",
      resourceId: recoveredPersonId,
      inputs: recoveredPayload,
      proposedOutput: recoveredPayload,
      userDecision: "auto",
      policyResults: [],
      seed: recoveredPersonId,
      dataScope: "private",
      createdAt: "2026-07-18T15:50:00.000Z",
    });
    const recovered = await reconcileOrganizationRelationshipMaterializations(
      wiring.graphStore,
      wiring.relationMaterializations,
      wiring.ledger,
      PILOT_ORGANIZATION,
      new Date("2026-07-18T15:51:00.000Z"),
    );
    assert.equal(recovered.applied, 1);
    assert.equal(
      (await caller.relationship.getPerson({
        organizationId: PILOT_ORGANIZATION,
        id: recoveredPersonId,
      }))?.displayName,
      "Recovered Person",
      "startup reconciliation recovers an auto-applied ledger row after response loss",
    );
    const repeatedRecovery = await reconcileOrganizationRelationshipMaterializations(
      wiring.graphStore,
      wiring.relationMaterializations,
      wiring.ledger,
      PILOT_ORGANIZATION,
      new Date("2026-07-18T15:52:00.000Z"),
    );
    assert.equal(repeatedRecovery.attempted, 0);

    const staleUpdateId = "72000000-0000-4000-8000-000000000011";
    const newestUpdateId = "72000000-0000-4000-8000-000000000012";
    const staleUpdatePayload = {
      kind: "relationship_record_mutation",
      recordType: "person",
      operation: "update",
      recordId: recoveredPersonId,
      values: { displayName: "Stale recovered update" },
    };
    const newestUpdatePayload = {
      ...staleUpdatePayload,
      values: { displayName: "Newest recovered update" },
    };
    for (const [id, payload, createdAt] of [
      [staleUpdateId, staleUpdatePayload, "2026-07-18T15:53:00.000Z"],
      [newestUpdateId, newestUpdatePayload, "2026-07-18T15:54:00.000Z"],
    ] as const) {
      await wiring.ledger.append({
        id,
        organizationId: PILOT_ORGANIZATION,
        actorType: "user",
        actorId: PILOT_USER,
        action: "write",
        resourceType: "person",
        resourceId: recoveredPersonId,
        inputs: payload,
        proposedOutput: payload,
        userDecision: "auto",
        policyResults: [],
        seed: recoveredPersonId,
        dataScope: "private",
        createdAt,
      });
    }
    const newestUpdate = await wiring.ledger.get(newestUpdateId);
    assert.ok(newestUpdate);
    await materializeRelationshipMutation(
      wiring.graphStore,
      newestUpdate,
      newestUpdate,
    );
    const staleRecovery = await reconcileOrganizationRelationshipMaterializations(
      wiring.graphStore,
      wiring.relationMaterializations,
      wiring.ledger,
      PILOT_ORGANIZATION,
      new Date("2026-07-18T15:55:00.000Z"),
    );
    assert.equal(staleRecovery.attempted, 1);
    assert.equal(staleRecovery.applied, 1);
    assert.equal(
      (await caller.relationship.getPerson({
        organizationId: PILOT_ORGANIZATION,
        id: recoveredPersonId,
      }))?.displayName,
      "Newest recovered update",
    );
    assert.equal(
      (
        await reconcileOrganizationRelationshipMaterializations(
          wiring.graphStore,
          wiring.relationMaterializations,
          wiring.ledger,
          PILOT_ORGANIZATION,
          new Date("2026-07-18T15:56:00.000Z"),
        )
      ).attempted,
      0,
      "a stale auto mutation writes a durable skip receipt and is not retried forever",
    );

    const archived = await caller.relationship.archivePerson({
      organizationId: PILOT_ORGANIZATION,
      id: person.id,
    });
    assert.equal(archived.proposal.status, "applied");
    assert.equal(archived.materialization.status, "applied");
    assert.equal(
      await caller.relationship.getPerson({
        organizationId: PILOT_ORGANIZATION,
        id: person.id,
      }),
      null,
    );
    const archivedRetryId = "72000000-0000-4000-8000-000000000013";
    const archivedRetryPayload = {
      kind: "relationship_record_mutation",
      recordType: "person",
      operation: "archive",
      recordId: person.id,
    };
    await wiring.ledger.append({
      id: archivedRetryId,
      organizationId: PILOT_ORGANIZATION,
      actorType: "user",
      actorId: PILOT_USER,
      action: "archive",
      resourceType: "person",
      resourceId: person.id,
      inputs: archivedRetryPayload,
      proposedOutput: archivedRetryPayload,
      userDecision: "auto",
      policyResults: [],
      seed: person.id,
      dataScope: "private",
      createdAt: "2026-07-18T15:57:00.000Z",
    });
    assert.equal(
      (
        await reconcileOrganizationRelationshipMaterializations(
          wiring.graphStore,
          wiring.relationMaterializations,
          wiring.ledger,
          PILOT_ORGANIZATION,
          new Date("2026-07-18T15:58:00.000Z"),
        )
      ).applied,
      1,
    );
    assert.equal(
      (
        await reconcileOrganizationRelationshipMaterializations(
          wiring.graphStore,
          wiring.relationMaterializations,
          wiring.ledger,
          PILOT_ORGANIZATION,
          new Date("2026-07-18T15:59:00.000Z"),
        )
      ).attempted,
      0,
      "an already-archived auto mutation writes a durable skip receipt",
    );
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});

test("approved capture materialization is durable, replayable, and emits one Local Event", async () => {
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    const caller = await makeCaller(wiring);
    const mediaId = "local-media-capture-1";
    await wiring.localMedia.put(
      {
        id: mediaId,
        organizationId: PILOT_ORGANIZATION,
        kind: "photo",
        mimeType: "image/jpeg",
        byteSize: 3,
        caption: "Whiteboard notes",
        status: "pending",
        provenance: { skill: "camera.capture", version: "1" },
        capturedAt: "2026-07-18T16:00:00.000Z",
      },
      new Uint8Array([1, 2, 3]),
    );
    const staged = await caller.capture.stage({
      organizationId: PILOT_ORGANIZATION,
      localMediaId: mediaId,
      kind: "photo",
      caption: "Whiteboard notes",
      capturedAt: "2026-07-18T16:00:00.000Z",
    });
    assert.equal(staged.status, "pending_review");
    const duplicateStage = await caller.capture.stage({
      organizationId: PILOT_ORGANIZATION,
      localMediaId: mediaId,
      kind: "photo",
      caption: "Whiteboard notes",
      capturedAt: "2026-07-18T16:00:00.000Z",
    });
    assert.equal(
      duplicateStage.id,
      staged.id,
      "one Local Media record has at most one pending governed proposal",
    );
    assert.deepEqual(
      await caller.capture.status({
        organizationId: PILOT_ORGANIZATION,
        localMediaIds: [mediaId],
      }),
      {
        items: [{
          localMediaId: mediaId,
          status: "pending_review",
          proposalId: staged.id,
          decisionLedgerId: null,
        }],
      },
    );

    const commitEntity =
      wiring.localPlane.graph.commitEntity.bind(wiring.localPlane.graph);
    wiring.localPlane.graph.commitEntity = async () => {
      throw new Error("test_fixture_capture_commit_failure");
    };
    const failed = await caller.action.decide({
      proposalId: staged.id,
      decision: "approve",
    });
    assert.equal(failed.effectsStatus, "failed");
    assert.match(failed.effectsError ?? "", /capture_commit_failure/);
    assert.equal((await wiring.localMedia.get(mediaId))?.status, "pending");

    wiring.localPlane.graph.commitEntity = commitEntity;
    const replayed = await caller.action.decide({
      proposalId: staged.id,
      decision: "approve",
    });
    assert.equal(replayed.effectsStatus, "confirmed");
    const events = await wiring.localPlane.graph.listEntities(
      PILOT_ORGANIZATION,
      "event",
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]?.source, "capture");
    assert.equal(events[0]?.sourceRecordId, mediaId);
    const committed = await wiring.localMedia.get(mediaId);
    assert.equal(committed?.status, "committed");
    assert.equal(committed?.ledgerId, replayed.id);
    assert.deepEqual(committed?.linkedEntity, {
      type: "event",
      id: events[0]?.id,
    });
    assert.equal(
      await wiring.localPlane.graph.hasExternal(
        PILOT_ORGANIZATION,
        "capture",
        mediaId,
      ),
      true,
    );

    await caller.action.decide({
      proposalId: staged.id,
      decision: "approve",
    });
    assert.equal(
      (
        await wiring.localPlane.graph.listEntities(
          PILOT_ORGANIZATION,
          "event",
        )
      ).length,
      1,
      "replaying the recorded decision cannot duplicate the capture Event",
    );
    const appliedStatus = await caller.capture.status({
      organizationId: PILOT_ORGANIZATION,
      localMediaIds: [mediaId],
    });
    assert.equal(appliedStatus.items[0]?.status, "applied");
    assert.equal(appliedStatus.items[0]?.decisionLedgerId, replayed.id);
    await assert.rejects(
      () =>
        caller.capture.stage({
          organizationId: PILOT_ORGANIZATION,
          localMediaId: "test_fixture_capture_oversized",
          kind: "photo",
          caption: "x".repeat(4_001),
          capturedAt: "2026-07-18T16:00:00.000Z",
        }),
      /too_big|maximum|4000/i,
      "oversized caption text cannot evade capture proposal classification",
    );
  } finally {
    if (wiring) await wiring.close();
  }
});

test("Relationship intake review is bounded, owner-scoped, and content-sanitized", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-relationship-intake-review-test-"));
  const fixture = await seedFixtures(dir);
  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    const now = "2026-07-18T16:00:00.000Z";
    await wiring.ledger.append({
      id: "71000000-0000-4000-8000-000000000001",
      organizationId: PILOT_ORGANIZATION,
      actorType: "agent",
      actorId: "b0000000-0000-4000-a000-0000000000e2",
      onBehalfOfType: "user",
      onBehalfOfId: PILOT_USER,
      action: "write",
      resourceType: "event",
      inputs: {
        directive: {
          external: [{
            source: "google:gmail",
            subject: "SECRET SUBJECT MUST NOT LEAK",
            body: "SECRET BODY MUST NOT LEAK",
          }],
          entities: [{
            kind: "signal",
            payload: {
              type: "possible_duplicate",
              email: "candidate@example.com",
              reason: "Two accessible Person candidates share this address.",
              candidates: [
                { id: fixture.personId, name: "Candidate Person" },
                { id: "not-a-uuid", name: "Invalid candidate" },
              ],
            },
          }],
        },
        display: { channel: "Email", resource: "Candidate message" },
      },
      proposedOutput: { rawBody: "SECRET OUTPUT MUST NOT LEAK" },
      userDecision: null,
      policyResults: [],
      dataScope: "private",
      createdAt: now,
    });
    await wiring.ledger.append({
      id: "71000000-0000-4000-8000-000000000002",
      organizationId: PILOT_ORGANIZATION,
      actorType: "agent",
      actorId: "b0000000-0000-4000-a000-0000000000e2",
      onBehalfOfType: "user",
      onBehalfOfId: PILOT_USER,
      action: "write",
      resourceType: "event",
      inputs: {
        local_media_id: "local-media-1",
        kind: "photo",
        caption: "SECRET CAPTION MUST NOT LEAK",
        ocrText: "SECRET OCR MUST NOT LEAK",
      },
      proposedOutput: { text: "SECRET CAPTURE OUTPUT MUST NOT LEAK" },
      userDecision: null,
      policyResults: [],
      dataScope: "private",
      createdAt: "2026-07-18T16:01:00.000Z",
    });
    await wiring.ledger.append({
      id: "71000000-0000-4000-8000-000000000003",
      organizationId: PILOT_ORGANIZATION,
      actorType: "agent",
      actorId: "b0000000-0000-4000-a000-0000000000e2",
      onBehalfOfType: "user",
      onBehalfOfId: fixture.otherMemberId,
      action: "write",
      resourceType: "event",
      inputs: {
        local_media_id: "other-owner-media",
        kind: "photo",
        caption: "OTHER OWNER SECRET",
      },
      userDecision: null,
      policyResults: [],
      dataScope: "private",
      createdAt: "2026-07-18T16:02:00.000Z",
    });

    const caller = await makeCaller(wiring);
    const firstPage = await caller.relationship.intakeReview({
      organizationId: PILOT_ORGANIZATION,
      limit: 1,
      offset: 0,
    });
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.scanned, 1);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.nextOffset, 1);
    const secondPage = await caller.relationship.intakeReview({
      organizationId: PILOT_ORGANIZATION,
      limit: 1,
      offset: firstPage.nextOffset!,
    });
    const items = [...firstPage.items, ...secondPage.items];
    assert.deepEqual(new Set(items.map((item) => item.source)), new Set(["capture", "gmail"]));
    const gmail = items.find((item) => item.source === "gmail");
    assert.equal(gmail?.match, "ambiguous");
    assert.equal(gmail?.candidateEmail, "candidate@example.com");
    assert.deepEqual(gmail?.candidates, [{ id: fixture.personId, name: "Candidate Person" }]);
    const serialized = JSON.stringify(items);
    for (const secret of [
      "SECRET SUBJECT",
      "SECRET BODY",
      "SECRET OUTPUT",
      "SECRET CAPTION",
      "SECRET OCR",
      "OTHER OWNER SECRET",
    ]) {
      assert.equal(serialized.includes(secret), false);
    }

    const anonymous = await makeAnonymousVerifiedCaller(wiring);
    await assert.rejects(
      () =>
        anonymous.relationship.intakeReview({
          organizationId: PILOT_ORGANIZATION,
          limit: 10,
          offset: 0,
        }),
      /UNAUTHORIZED|authentication required/,
    );
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});

test("Relationship Memory, commitments, and meeting preparation stay governed and owner-scoped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-relationship-memory-commitment-test-"));
  const fixture = await seedFixtures(dir);
  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    const caller = await makeCaller(wiring);
    const otherMemberCaller = await makeCaller(wiring, {
      type: "user",
      id: fixture.otherMemberId,
    });

    const added = await caller.relationship.addMemory({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      type: "semantic",
      content: "Prefers a written agenda before meetings.",
      scope: "private",
    });
    assert.equal(added.proposal.status, "applied");
    assert.equal(added.materialization.status, "applied");
    const memoryId = (
      added.materialization.status === "applied" &&
      typeof added.materialization.value === "object" &&
      added.materialization.value !== null &&
      "id" in added.materialization.value
    )
      ? String(added.materialization.value.id)
      : null;
    assert.ok(memoryId);

    const memoryPage = await caller.relationship.memories({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 1,
      offset: 0,
    });
    assert.equal(memoryPage.items.length, 1);
    assert.equal(memoryPage.items[0]?.content, "Prefers a written agenda before meetings.");
    assert.equal(memoryPage.items[0]?.sourceRefType, "feedback");
    let otherMemberMemoryBlocked = false;
    try {
      await otherMemberCaller.relationship.memories({
        organizationId: PILOT_ORGANIZATION,
        personId: fixture.personId,
        limit: 25,
        offset: 0,
      });
    } catch (cause) {
      otherMemberMemoryBlocked =
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "NOT_FOUND";
    }
    assert.equal(otherMemberMemoryBlocked, true);

    const corrected = await caller.relationship.correctMemory({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      memoryId,
      content: "Prefers a concise written agenda before meetings.",
    });
    assert.equal(corrected.materialization.status, "applied");
    const correctedPage = await caller.relationship.memories({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 25,
      offset: 0,
    });
    assert.equal(correctedPage.items.length, 1);
    assert.equal(correctedPage.items[0]?.content, "Prefers a concise written agenda before meetings.");
    assert.equal(correctedPage.items[0]?.supersedesId, memoryId);

    const createdCommitment = await caller.relationship.createCommitment({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      text: "Send the agenda",
      dueAt: "2026-07-25",
    });
    assert.equal(createdCommitment.materialization.status, "applied");
    const commitmentId = createdCommitment.proposal.request.resourceId;
    assert.ok(commitmentId);
    const commitments = await caller.relationship.commitments({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 25,
      offset: 0,
    });
    assert.equal(commitments.total, 1);
    assert.equal(commitments.items[0]?.status, "pending");
    assert.ok(commitments.items[0]?.provenance.evidenceRefs.length);

    const prep = await caller.relationship.meetingPrep({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 10,
    });
    assert.equal(prep.context.memories.length, 1);
    assert.equal(prep.context.commitments.length, 1);
    assert.equal(prep.recommendedActions[0]?.kind, "log_follow_up");
    assert.ok(
      prep.context.recentEvents.some((event) => event.kind === "commitment_create"),
      "commitment evidence remains visible in the unified Timeline",
    );
    const sharedInteraction = await caller.relationship.createInteraction({
      organizationId: PILOT_ORGANIZATION,
      values: {
        kind: "gathering",
        occurredAt: "2026-07-20T10:00:00.000Z",
        summary: "Met through the Community.",
        visibility: "private",
        participants: [
          { recordType: "person", recordId: fixture.personId },
          { recordType: "community", recordId: fixture.communityId },
        ],
      },
    });
    assert.equal(sharedInteraction.materialization.status, "applied");
    const paths = await caller.relationship.findPaths({
      organizationId: PILOT_ORGANIZATION,
      start: { nodeType: "person", nodeId: fixture.personId },
      end: { nodeType: "community", nodeId: fixture.communityId },
      maxDepth: 4,
      maxPaths: 3,
    });
    assert.ok(paths.paths.length > 0);
    assert.ok(paths.paths.every((path) => path.steps.length <= 4));
    assert.ok(paths.visited <= 100);
    const communityOrganization = await caller.relationship.communityOrganization({
      organizationId: PILOT_ORGANIZATION,
      communityId: fixture.communityId,
      limit: 25,
    });
    assert.ok(
      communityOrganization.people.some((person) => person.id === fixture.personId),
    );
    assert.ok(
      communityOrganization.people.some(
        (person) =>
          person.id === fixture.memberPersonId &&
          person.source === "membership",
      ),
      "community_members contributes bounded visible People",
    );
    assert.equal(
      communityOrganization.people.some(
        (person) => person.id === fixture.otherPersonId,
      ),
      false,
      "another owner's private community member is pruned",
    );
    assert.ok(
      communityOrganization.events.some((event) => event.kind === "gathering"),
    );
    assert.deepEqual(communityOrganization.files, []);
    assert.deepEqual(
      await otherMemberCaller.relationship.findPaths({
        organizationId: PILOT_ORGANIZATION,
        start: { nodeType: "person", nodeId: fixture.personId },
        end: { nodeType: "community", nodeId: fixture.communityId },
        maxDepth: 4,
        maxPaths: 3,
      }),
      { paths: [], visited: 0, truncated: false },
      "private path endpoints do not leak to another member",
    );

    const completed = await caller.relationship.updateCommitment({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      commitmentId,
      text: "Sent the agenda",
      dueAt: "2026-07-25T12:00:00.000Z",
      status: "completed",
    });
    assert.equal(completed.materialization.status, "applied");
    const completedPage = await caller.relationship.commitments({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 25,
      offset: 0,
    });
    assert.equal(completedPage.items[0]?.text, "Sent the agenda");
    assert.equal(completedPage.items[0]?.status, "completed");
    const laterPending = await caller.relationship.createCommitment({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      text: "Confirm the next meeting",
      dueAt: "2026-07-30T12:00:00+05:30",
    });
    assert.equal(laterPending.materialization.status, "applied");
    const laterPendingCommitmentId =
      laterPending.proposal.request.resourceId;
    assert.ok(laterPendingCommitmentId);
    const mixedPrep = await caller.relationship.meetingPrep({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 1,
    });
    assert.equal(mixedPrep.context.commitments[0]?.status, "completed");
    assert.match(
      mixedPrep.recommendedActions[0]?.label ?? "",
      /Confirm the next meeting/,
      "pending recommendations are queried before applying the bound",
    );
    const otherCommitments = await otherMemberCaller.relationship.commitments({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 25,
      offset: 0,
    });
    assert.deepEqual(otherCommitments.items, []);
    assert.equal(otherCommitments.total, 0);
    assert.equal(otherCommitments.hasMore, false);

    const targetPersonResult = await caller.relationship.createPerson({
      organizationId: PILOT_ORGANIZATION,
      values: {
        displayName: "Introduction Target",
        visibility: "private",
      },
    });
    assert.equal(targetPersonResult.materialization.status, "applied");
    const targetPersonId = targetPersonResult.proposal.request.resourceId;
    assert.ok(targetPersonId);
    const introduction = await caller.relationship.createIntroduction({
      organizationId: PILOT_ORGANIZATION,
      sourcePersonId: fixture.personId,
      targetPersonId,
    });
    assert.equal(introduction.materialization.status, "applied");
    const introductionId = introduction.proposal.request.resourceId;
    assert.ok(introductionId);
    await assert.rejects(
      () => caller.relationship.transitionIntroduction({
        organizationId: PILOT_ORGANIZATION,
        personId: fixture.personId,
        introductionId,
        transition: "complete",
      }),
      /Introduction not actionable/,
      "an Introduction cannot complete before both consents",
    );
    const consented = await caller.relationship.recordIntroductionConsent({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      introductionId,
      party: "recipient",
      decision: "consent",
    });
    assert.equal(consented.materialization.status, "applied");
    const readyIntroductions = await caller.relationship.introductions({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 25,
      offset: 0,
    });
    assert.equal(readyIntroductions.items[0]?.status, "ready");
    assert.equal(readyIntroductions.items[0]?.counterpart?.id, targetPersonId);
    const otherIntroductions = await otherMemberCaller.relationship.introductions({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 25,
      offset: 0,
    });
    assert.deepEqual(
      otherIntroductions.items,
      [],
      "private Introduction state does not leak to another member",
    );
    assert.equal(otherIntroductions.total, 0);
    assert.equal(otherIntroductions.hasMore, false);
    const completedIntroduction = await caller.relationship.transitionIntroduction({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      introductionId,
      transition: "complete",
    });
    assert.equal(completedIntroduction.materialization.status, "applied");

    const declinedIntroduction = await caller.relationship.createIntroduction({
      organizationId: PILOT_ORGANIZATION,
      sourcePersonId: fixture.personId,
      targetPersonId,
    });
    assert.equal(declinedIntroduction.materialization.status, "applied");
    const declinedIntroductionId = declinedIntroduction.proposal.request.resourceId;
    assert.ok(declinedIntroductionId);
    await caller.relationship.recordIntroductionConsent({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      introductionId: declinedIntroductionId,
      party: "recipient",
      decision: "decline",
      declineReason: "Not the right time",
    });
    const declinedIntroductions = await caller.relationship.introductions({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 25,
      offset: 0,
    });
    const declinedItem = declinedIntroductions.items.find(
      (item) => item.id === declinedIntroductionId,
    );
    assert.equal(declinedItem?.status, "declined");
    assert.equal(declinedItem?.declineReasonRecorded, true);
    assert.equal(
      JSON.stringify(declinedItem).includes("Not the right time"),
      false,
      "private decline reason contents stay outside the API projection",
    );
    const privateDeclineMemories = await caller.relationship.memories({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 25,
      offset: 0,
    });
    assert.equal(
      privateDeclineMemories.items.some(
        (memory) => memory.content === "Not the right time",
      ),
      false,
      "decline reason never enters the organization-readable Memory table",
    );
    await assert.rejects(
      () => otherMemberCaller.relationship.memories({
        organizationId: PILOT_ORGANIZATION,
        personId: fixture.personId,
        limit: 25,
        offset: 0,
      }),
      /Person not found/,
      "another organization member cannot read the private Person or decline Memory",
    );
    await assert.rejects(
      () => otherMemberCaller.relationship.createIntroduction({
        organizationId: PILOT_ORGANIZATION,
        sourcePersonId: fixture.personId,
        targetPersonId,
      }),
      /Introduction People not found/,
      "another member cannot forge an Introduction for the owner's People",
    );

    const forgotten = await caller.relationship.forgetMemory({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      memoryId: correctedPage.items[0]!.id,
    });
    assert.equal(forgotten.materialization.status, "applied");
    const memoriesAfterForget = await caller.relationship.memories({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 25,
      offset: 0,
    });
    assert.equal(
      memoriesAfterForget.items.some((memory) =>
        memory.id === correctedPage.items[0]!.id ||
        memory.id === memoryId ||
        memory.supersedesId === memoryId
      ),
      false,
      "forget removes the complete correction lineage without deleting unrelated private Memory",
    );
    const archived = await caller.relationship.archiveCommitment({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      commitmentId,
    });
    assert.equal(archived.materialization.status, "applied");
    const commitmentsAfterArchive = await caller.relationship.commitments({
      organizationId: PILOT_ORGANIZATION,
      personId: fixture.personId,
      limit: 25,
      offset: 0,
    });
    assert.deepEqual(
      commitmentsAfterArchive.items.map((item) => item.id),
      [laterPendingCommitmentId],
    );
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});
