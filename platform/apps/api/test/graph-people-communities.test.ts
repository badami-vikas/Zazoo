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
import { createLocalDb, schema } from "@bridge/db";
import {
  InMemoryPolicyStore,
  InMemoryRoleStore,
  SeededRng,
  SystemClock,
  UuidGen,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE, PILOT_USER, type Wiring } from "../src/wiring.js";

const FIXTURE_COUNT = 5;

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true, // SEC-1: in-process test caller is a trusted, authenticated actor
    verifying: false,
  });
}

/** Seed FIXTURE_COUNT people + FIXTURE_COUNT communities under PILOT_WORKSPACE/
 * PILOT_USER via a connection to `dir`, then close it BEFORE `buildWiring()` opens
 * its own connection against the same directory. */
async function seedFixtures(dir: string): Promise<{
  signalId: string;
  eventId: string;
  personId: string;
  communityId: string;
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
    return {
      signalId: signal.id,
      eventId: event.id,
      personId: firstPersonId,
      communityId: firstCommunityId,
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
      { resourceType: "relation", resourceId: null, action: "read", effect: "allow", dataScope: "private" },
      { resourceType: "relation", resourceId: null, action: "write", effect: "allow", dataScope: "private" },
    ]);
    const caller = await makeCaller(wiring);

    const detail = await caller.graph.getSignalDetail({
      workspaceId: PILOT_WORKSPACE,
      signalId: fixture.signalId,
    });
    assert.ok(detail);
    assert.equal(detail.sourceEvent?.id, fixture.eventId);
    assert.equal(detail.participants[0]?.recordId, fixture.personId);
    assert.equal(detail.participants[0]?.relationType, "signal_subject");

    const owner = await caller.relationship.nodeTypeOwner({
      workspaceId: PILOT_WORKSPACE,
      nodeType: "event",
    });
    assert.equal(owner?.owningModule, "relationship");

    await assert.rejects(() =>
      caller.relationship.linkSignalEvidence({
        workspaceId: PILOT_WORKSPACE,
        signalId: fixture.signalId,
        sourceEventId: fixture.eventId,
        participants: [
          { recordType: "person", recordId: fixture.personId, role: "attendee", confidence: 1 },
          { recordType: "person", recordId: fixture.personId, role: "observer", confidence: 0.9 },
        ],
      }),
    );
    const linked = await caller.relationship.linkSignalEvidence({
      workspaceId: PILOT_WORKSPACE,
      signalId: fixture.signalId,
      sourceEventId: fixture.eventId,
      visibility: "private",
      userConfirmed: true,
      participants: [
        { recordType: "person", recordId: fixture.personId, role: "attendee", confidence: 1 },
        { recordType: "community", recordId: fixture.communityId, role: "host", confidence: 0.9 },
      ],
    });
    assert.equal(linked.proposal.status, "applied");
    assert.equal(linked.proposal.request.resourceType, "relation");
    assert.ok(!("ownerUserId" in (linked.proposal.request.inputs as Record<string, unknown>)));
    assert.equal(linked.relations?.sourceEvent.edgeType, "source_event");
    assert.equal(linked.relations?.sourceEvent.ownerUserId, PILOT_USER);
    assert.equal(linked.relations?.participants.length, 2);
    assert.ok(linked.relations?.participants.every((relation) => relation.sourceModule === "relationship"));

    const signalRelations = await caller.relationship.listRelations({
      workspaceId: PILOT_WORKSPACE,
      nodeType: "signal",
      nodeId: fixture.signalId,
      limit: 10,
      offset: 0,
    });
    assert.equal(signalRelations.total, 1);
    assert.equal(signalRelations.items[0]?.dstType, "event");

    const eventRelations = await caller.relationship.listRelations({
      workspaceId: PILOT_WORKSPACE,
      nodeType: "event",
      nodeId: fixture.eventId,
      limit: 10,
      offset: 0,
    });
    assert.equal(eventRelations.total, 3);

    assert.ok(wiring.policies instanceof InMemoryPolicyStore);
    wiring.policies.policies.push((policyInput) =>
      policyInput.phase === "pre" &&
      typeof policyInput.inputs === "object" &&
      policyInput.inputs !== null &&
      (policyInput.inputs as { kind?: unknown }).kind === "relationship_signal_evidence"
        ? {
            policyId: "test_fixture_relation_approval",
            phase: "pre",
            effect: "require_approval",
            reason: "Test fixture requires Relationship Relation review",
          }
        : null,
    );
    const pendingLink = await caller.relationship.linkSignalEvidence({
      workspaceId: PILOT_WORKSPACE,
      signalId: fixture.signalId,
      sourceEventId: fixture.eventId,
      visibility: "private",
      userConfirmed: true,
      participants: [
        { recordType: "person", recordId: fixture.personId, role: "required", confidence: 1 },
        { recordType: "community", recordId: fixture.communityId, role: "host", confidence: 0.95 },
      ],
    });
    assert.equal(pendingLink.proposal.status, "pending_review");
    assert.equal(pendingLink.relations, null);
    await assert.rejects(() =>
      caller.action.decide({
        proposalId: pendingLink.proposal.id,
        decision: "edit",
        editedOutput: {
          kind: "relationship_signal_evidence",
          signalId: fixture.signalId,
          sourceEventId: fixture.eventId,
          visibility: "private",
          userConfirmed: true,
          participants: [
            { recordType: "person", recordId: fixture.personId, role: "required", confidence: 1 },
            { recordType: "person", recordId: fixture.personId, role: "observer", confidence: 0.9 },
          ],
        },
      }),
    );
    const stillPending = await caller.action.listPending({
      workspaceId: PILOT_WORKSPACE,
      limit: 50,
      offset: 0,
    });
    assert.ok(stillPending.items.some((proposal) => proposal.id === pendingLink.proposal.id));
    const approvedLink = await caller.action.decide({
      proposalId: pendingLink.proposal.id,
      decision: "approve",
    });
    assert.equal(approvedLink.status, "applied");
    assert.ok("relationshipMaterialization" in approvedLink.effects);
    assert.equal(approvedLink.effects.relationshipMaterialization.status, "materialized");
    assert.equal(approvedLink.effects.relationshipMaterialization.relations.participants.length, 2);
    const noLongerPending = await caller.action.listPending({
      workspaceId: PILOT_WORKSPACE,
      limit: 50,
      offset: 0,
    });
    assert.ok(!noLongerPending.items.some((proposal) => proposal.id === pendingLink.proposal.id));
    const reconciled = await caller.relationship.reconcileApproved({
      workspaceId: PILOT_WORKSPACE,
      proposalId: pendingLink.proposal.id,
    });
    assert.equal(reconciled.status, "materialized");
    assert.equal(reconciled.relations.participants.length, 2);

    const linkedDetail = await caller.graph.getSignalDetail({
      workspaceId: PILOT_WORKSPACE,
      signalId: fixture.signalId,
    });
    assert.equal(linkedDetail?.participants.length, 2);
    assert.ok(linkedDetail?.participants.every((participant) => participant.relationType === "participant"));

    const proposal = await caller.graph.proposeSignalAction({
      workspaceId: PILOT_WORKSPACE,
      signalId: fixture.signalId,
    });
    assert.equal(proposal.status, "applied");
    assert.equal(proposal.request.resourceType, "signal");
    assert.equal(proposal.request.resourceId, fixture.signalId);
    assert.equal(proposal.request.seed, fixture.eventId);
    assert.equal(proposal.request.actor.plane, "local");
  } finally {
    if (wiring) await wiring.close();
    if (prior === undefined) delete process.env.BRIDGE_LOCAL_DIR;
    else process.env.BRIDGE_LOCAL_DIR = prior;
  }
});
