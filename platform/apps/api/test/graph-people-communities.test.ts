/**
 * graph.listPeople / graph.listCommunities — read surface for KnowledgeBasePage's
 * People/Communities tabs (currently `NotWiredYet` placeholders in apps/web).
 * Mirrors graph.listInitiatives/listSignals: workspace-scoped, paginated, rejects
 * any workspaceId that isn't the pilot workspace (assertPilotWorkspace).
 *
 * `Wiring` doesn't expose a raw db handle (graphStore/workspaceStore keep it
 * private), so fixtures are seeded through a short-lived `createLocalDb`
 * connection bound to the SAME `BRIDGE_LOCAL_DIR` `buildWiring()` will use —
 * same one-connection-at-a-time approach pagination.test.ts uses for
 * `integration.list`, since pglite doesn't reliably share writes across two
 * concurrently-open connections against one on-disk directory.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { createLocalDb, schema } from "@bridge/db";
import {
  InMemoryRoleStore,
  SeededRng,
  SystemClock,
  UuidGen,
  type Actor,
  type RunCtx,
} from "@bridge/core";
import { makeContextFactory } from "../src/context.js";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE, PILOT_USER, type Wiring } from "../src/wiring.js";

const FIXTURE_COUNT = 5;

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
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
    run: makeRun(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: false,
    verifying: true,
  });
}

/** Seed FIXTURE_COUNT people + FIXTURE_COUNT communities under PILOT_WORKSPACE/
 * PILOT_USER via a connection to `dir`, then close it BEFORE `buildWiring()` opens
 * its own connection against the same directory. */
async function seedFixtures(
  dir: string,
  options: { addNewerSourceEvent?: boolean } = {},
): Promise<{
  signalId: string;
  eventId: string;
  personId: string;
  communityId: string;
  otherMemberId: string;
}> {
  const { db, close } = await createLocalDb({ dataDir: dir });
  try {
    // Idempotent: workspace/user rows may already exist from a prior buildWiring()
    // bootstrap against this directory; onConflictDoNothing keeps this safe to
    // call before that bootstrap ever runs too.
    await db.insert(schema.workspaces).values({ id: PILOT_WORKSPACE, name: "Pilot workspace (graph test)" }).onConflictDoNothing({
      target: schema.workspaces.id,
    });
    await db.insert(schema.users).values({ id: PILOT_USER, email: "test_fixture_pilot@example.com" }).onConflictDoNothing({
      target: schema.users.id,
    });
    const [otherMember] = await db
      .insert(schema.users)
      .values({ email: "test_fixture_relation_workspace_member@example.com" })
      .returning({ id: schema.users.id });
    assert.ok(otherMember);
    await db.insert(schema.workspaceMembers).values({
      workspaceId: PILOT_WORKSPACE,
      userId: otherMember.id,
    });
    let firstPersonId: string | null = null;
    let firstCommunityId: string | null = null;
    for (let i = 0; i < FIXTURE_COUNT; i += 1) {
      const [person] = await db
        .insert(schema.people)
        .values({
          workspaceId: PILOT_WORKSPACE,
          userId: PILOT_USER,
          fullNameOverride: `test_fixture_person_${i}`,
        })
        .returning({ id: schema.people.id });
      if (i === 0) firstPersonId = person?.id ?? null;
      const [community] = await db
        .insert(schema.communities)
        .values({
          workspaceId: PILOT_WORKSPACE,
          userId: PILOT_USER,
          nameOverride: `test_fixture_community_${i}`,
        })
        .returning({ id: schema.communities.id });
      if (i === 0) firstCommunityId = community?.id ?? null;
    }
    assert.ok(firstPersonId);
    assert.ok(firstCommunityId);
    const [signal] = await db
      .insert(schema.signals)
      .values({
        workspaceId: PILOT_WORKSPACE,
        type: "meeting_prep",
        subjectType: "person",
        subjectId: firstPersonId,
        payload: { reason: "A permitted meeting Event is approaching." },
        recommendedAction: { label: "Prepare context" },
      })
      .returning({ id: schema.signals.id });
    assert.ok(signal);
    const [event] = await db
      .insert(schema.events)
      .values({
        workspaceId: PILOT_WORKSPACE,
        type: "calendar.meeting_upcoming",
        entityType: "signal",
        entityId: signal.id,
        payload: { source: "google-calendar" },
      })
      .returning({ id: schema.events.id });
    assert.ok(event);
    await db.insert(schema.edges).values({
      workspaceId: PILOT_WORKSPACE,
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
    if (options.addNewerSourceEvent) {
      await db.insert(schema.events).values({
        workspaceId: PILOT_WORKSPACE,
        type: "calendar.meeting_followup",
        entityType: "signal",
        entityId: signal.id,
        payload: { source: "newer-calendar-event" },
        createdAt: new Date("2027-01-01T00:00:00.000Z"),
      });
    }
    return {
      signalId: signal.id,
      eventId: event.id,
      personId: firstPersonId,
      communityId: firstCommunityId,
      otherMemberId: otherMember.id,
    };
  } finally {
    await close();
  }
}

test("graph.listPeople: paginates people under the pilot workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-graph-people-test-"));
  await seedFixtures(dir);

  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    const caller = await makeCaller(wiring);

    const page = await caller.graph.listPeople({ workspaceId: PILOT_WORKSPACE, limit: 2, offset: 0 });
    assert.equal(page.items.length, 2);
    assert.equal(page.total, FIXTURE_COUNT);
    assert.equal(page.hasMore, true);

    const lastPage = await caller.graph.listPeople({ workspaceId: PILOT_WORKSPACE, limit: 2, offset: 4 });
    assert.equal(lastPage.items.length, 1);
    assert.equal(lastPage.hasMore, false);

    await assert.rejects(() =>
      caller.graph.listPeople({ workspaceId: "test_fixture_other_workspace", limit: 10, offset: 0 }),
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
      () => caller.graph.listPeople({ workspaceId: PILOT_WORKSPACE, limit: 10, offset: 0 }),
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
    const token = await new SignJWT({})
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

    const caller = appRouter.createCaller(context);
    const page = await caller.graph.listPeople({
      workspaceId: PILOT_WORKSPACE,
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
      workspaceId: PILOT_WORKSPACE,
      subject: "Public Help Request",
      submitterEmail: "public-help-request@example.com",
      body: "Please route this request.",
      operationId: "10000000-0000-4000-8000-000000000011",
      accessToken: "test_fixture_public_token_0000000000000001",
    };
    const created = await caller.helpdesk.public.createTicket(createInput);
    const retried = await caller.helpdesk.public.createTicket(createInput);
    assert.equal(retried.ticket.id, created.ticket.id);
    assert.equal(retried.message.id, created.message.id);
    await assert.rejects(() =>
      caller.helpdesk.public.createTicket({
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
    const reply = await caller.helpdesk.public.reply(replyInput);
    const retriedReply = await caller.helpdesk.public.reply(replyInput);
    assert.equal(retriedReply.id, reply.id);
    assert.equal(
      (await caller.helpdesk.public.getThread({ accessToken: created.ticket.accessToken })).messages.length,
      2,
    );

    await assert.rejects(
      () => caller.helpdesk.list({ workspaceId: PILOT_WORKSPACE, limit: 10, offset: 0 }),
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
        caller.helpdesk.route({
          workspaceId: PILOT_WORKSPACE,
          subject: "Need help",
          body: "",
          topicsByPerson: { "not-a-uuid": ["fundraising"] },
          limit: 3,
        }),
      /candidate Person ids must be UUIDs/,
    );
    await assert.rejects(
      () =>
        caller.helpdesk.stageAnswer({
          workspaceId: PILOT_WORKSPACE,
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

test("graph.listCommunities: paginates communities under the pilot workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-graph-communities-test-"));
  await seedFixtures(dir);

  const prior = process.env.BRIDGE_LOCAL_DIR;
  process.env.BRIDGE_LOCAL_DIR = dir;
  let wiring: Wiring | undefined;
  try {
    wiring = await buildWiring();
    const caller = await makeCaller(wiring);

    const page = await caller.graph.listCommunities({ workspaceId: PILOT_WORKSPACE, limit: 3, offset: 0 });
    assert.equal(page.items.length, 3);
    assert.equal(page.total, FIXTURE_COUNT);
    assert.equal(page.hasMore, true);

    const lastPage = await caller.graph.listCommunities({ workspaceId: PILOT_WORKSPACE, limit: 3, offset: 3 });
    assert.equal(lastPage.items.length, 2);
    assert.equal(lastPage.hasMore, false);

    await assert.rejects(() =>
      caller.graph.listCommunities({ workspaceId: "test_fixture_other_workspace", limit: 10, offset: 0 }),
    );
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});

test("graph Relationship path resolves evidence and proposes a governed Action", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-graph-relationship-test-"));
  const fixture = await seedFixtures(dir);

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

    const detail = await caller.graph.getSignalDetail({
      workspaceId: PILOT_WORKSPACE,
      signalId: fixture.signalId,
    });
    assert.ok(detail);
    assert.equal(detail.sourceEvent?.id, fixture.eventId);
    assert.equal(detail.participants[0]?.recordId, fixture.personId);
    assert.equal(detail.participants[0]?.relationType, "participant");

    const proposal = await caller.graph.proposeSignalAction({
      workspaceId: PILOT_WORKSPACE,
      signalId: fixture.signalId,
    });
    assert.equal(proposal.status, "applied");
    assert.equal(proposal.request.resourceType, "signal");
    assert.equal(proposal.request.resourceId, fixture.signalId);
    assert.equal(proposal.request.seed, fixture.eventId);
    assert.equal(proposal.request.actor.plane, "local");

    const routed = await caller.helpdesk.route({
      workspaceId: PILOT_WORKSPACE,
      subject: "Fundraising support",
      body: "We need fundraising guidance.",
      topicsByPerson: { [fixture.personId]: ["fundraising"] },
      limit: 3,
    });
    assert.equal(routed.routes[0]?.personId, fixture.personId);

    const staged = await caller.helpdesk.stageAnswer({
      workspaceId: PILOT_WORKSPACE,
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
    const caller = await makeCaller(wiring);

    assert.deepEqual(
      await caller.relationship.nodeTypeOwner({
        workspaceId: PILOT_WORKSPACE,
        nodeType: "event",
      }),
      { nodeType: "event", plane: "operational", owningModule: "relationship" },
    );
    await assert.rejects(
      () =>
        Reflect.apply(caller.action.propose, caller.action, [{
          workspaceId: PILOT_WORKSPACE,
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
          workspaceId: PILOT_WORKSPACE,
          nodeType: "signal",
          nodeId: fixture.signalId,
          limit: 10,
          offset: 0,
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
          workspaceId: PILOT_WORKSPACE,
          nodeType: "person",
        }),
      /FORBIDDEN|not a member/,
    );
    await assert.rejects(
      () =>
        caller.relationship.listRelations({
          workspaceId: "00000000-0000-4000-8000-000000000099",
          nodeType: "signal",
          nodeId: fixture.signalId,
          limit: 10,
          offset: 0,
        }),
      /pilot workspace|BAD_REQUEST/i,
    );

    await assert.rejects(
      () =>
        caller.relationship.proposeSignalEvidence({
          workspaceId: PILOT_WORKSPACE,
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
          workspaceId: PILOT_WORKSPACE,
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
      workspaceId: PILOT_WORKSPACE.toUpperCase(),
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
    assert.equal(
      (
        await otherMemberCaller.action.listPending({
          workspaceId: PILOT_WORKSPACE,
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
          workspaceId: PILOT_WORKSPACE,
          nodeType: "signal",
          nodeId: fixture.signalId,
          limit: 10,
          offset: 0,
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
          workspaceId: PILOT_WORKSPACE,
          nodeType: "signal",
          nodeId: fixture.signalId,
          limit: 10,
          offset: 0,
        })
      ).total,
      0,
    );
    assert.equal(
      (await caller.action.listPending({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })).total,
      0,
      "resolved proposals must not remain in Approvals after a post-decision effect failure",
    );
    assert.deepEqual(
      await caller.action.resolution({ proposalId: proposed.proposal.id }),
      { status: "resolved", decision: "edit" },
    );
    await assert.rejects(
      () => caller.action.decide({ proposalId: proposed.proposal.id, decision: "approve" }),
      /already resolved|CONFLICT/i,
    );

    const reconciled = await caller.relationship.reconcileApproved({
      workspaceId: PILOT_WORKSPACE,
      proposalId: proposed.proposal.id,
    });
    const retried = await caller.relationship.reconcileApproved({
      workspaceId: PILOT_WORKSPACE,
      proposalId: proposed.proposal.id,
    });
    assert.equal(reconciled.status, "confirmed");
    assert.equal(reconciled.sourceEvent.id, retried.sourceEvent.id);
    const materializedDetail = await caller.graph.getSignalDetail({
      workspaceId: PILOT_WORKSPACE,
      signalId: fixture.signalId,
    });
    assert.equal(
      materializedDetail?.sourceEvent?.id,
      fixture.eventId,
      "Signal reads must retain the approved Event when a newer unapproved Event exists",
    );
    assert.deepEqual(
      reconciled.participants.map((relation) => relation.id).sort(),
      retried.participants.map((relation) => relation.id).sort(),
    );
    const ownerHistory = await caller.action.listHistory({
      workspaceId: PILOT_WORKSPACE,
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
      workspaceId: PILOT_WORKSPACE,
      limit: 100,
      offset: 0,
    });
    assert.equal(
      otherMemberHistory.items.some((entry) => entry.resourceType === "relation"),
      false,
      "workspace membership must not reveal another owner's Relation ledger rows",
    );
    const signalRelations = await caller.relationship.listRelations({
      workspaceId: PILOT_WORKSPACE,
      nodeType: "signal",
      nodeId: fixture.signalId,
      limit: 10,
      offset: 0,
    });
    assert.equal(signalRelations.total, 1);
    assert.equal(signalRelations.items[0]?.edgeType, "source_event");
    const eventRelations = await caller.relationship.listRelations({
      workspaceId: PILOT_WORKSPACE,
      nodeType: "event",
      nodeId: fixture.eventId,
      limit: 10,
      offset: 0,
    });
    assert.equal(eventRelations.total, 3);
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
      workspaceId: PILOT_WORKSPACE,
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
      relationCount: 3,
    });
    assert.deepEqual(
      await caller.action.resolution({ proposalId: approved.proposal.id }),
      { status: "resolved", decision: "approve" },
    );
    await assert.rejects(
      () =>
        caller.relationship.reconcileApproved({
          workspaceId: PILOT_WORKSPACE,
          proposalId: proposed.proposal.id,
        }),
      /Stale Relationship decision/i,
    );
    const relationsAfterStaleReconcile = await caller.relationship.listRelations({
      workspaceId: PILOT_WORKSPACE,
      nodeType: "event",
      nodeId: fixture.eventId,
      limit: 10,
      offset: 0,
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

    const vetoed = await caller.relationship.proposeSignalEvidence({
      workspaceId: PILOT_WORKSPACE,
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
          workspaceId: PILOT_WORKSPACE,
          proposalId: vetoed.proposal.id,
        }),
      /no approved resolution|PRECONDITION_FAILED/i,
    );
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});
