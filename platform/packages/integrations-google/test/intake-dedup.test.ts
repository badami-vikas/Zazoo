/**
 * Gmail sync double-propose window (All fixes.md Phase 2 item 9b / section 3): if
 * `syncGmail` runs twice before the user gets to the Approvals inbox, `hasExternal`
 * alone doesn't catch it (it only excludes MATERIALIZED — i.e. already-approved —
 * records). Without the propose-time dedup added to `IntakeService.stage()`, two syncs
 * would stage two separate PENDING proposals for the same thread, and approving both
 * would double-commit Events/Memories.
 *
 * This exercises the REAL pipeline + gate (no mocked pipeline) with a fake gateway
 * returning the same test_fixture_ thread across two `syncGmail` calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FixedClock,
  SeededRng,
  UuidGen,
  UniversalActionPipeline,
  InMemoryRoleStore,
  InMemoryAgentStore,
  InMemoryEphemeralStore,
  InMemoryPolicyStore,
  InMemoryLedger,
  InMemoryEventBus,
  InMemorySkillRegistry,
  RecordingVarianceAdjuster,
  type PolicyFn,
  type RunCtx,
} from "@bridge/core";
import { createMemoryLocalPlane, type LocalPlane } from "@bridge/local";

import {
  GoogleService,
  GOOGLE_MANIFEST,
  IntakeMaterializer,
  IntakeService,
  googleSkills,
  type CreateDraftResult,
  type CreateEventEnvelope,
  type CreateEventResult,
  type FetchEventsResult,
  type FetchThreadsResult,
  type GmailThread,
  type GoogleGateway,
  type GoogleGatewayFactory,
  type IntakeDirective,
  type SendEmailEnvelope,
} from "../src/index.js";

const WS = "ws-dedup";
const EGRESS_AGENT = "agent-egress";
const INTAKE_AGENT = "agent-intake";
const USER = "user-1";

// A single test_fixture_ Gmail thread the fake gateway "fetches" on every call — simulates
// re-syncing before the user has approved the first proposal.
const test_fixture_thread: GmailThread = {
  threadId: "test_fixture_thread_dedup_1",
  subject: "test_fixture_ Re: partnership terms",
  participants: [{ email: "test_fixture_founder@example.com", name: "test_fixture_ Founder" }],
  lastMessageAt: "2026-07-05T10:00:00.000Z",
  snippet: "test_fixture_ snippet",
  messages: [
    {
      messageId: "test_fixture_msg_1",
      from: { email: "test_fixture_founder@example.com", name: "test_fixture_ Founder" },
      to: [{ email: "test_fixture_self@example.com" }],
      date: "2026-07-05T10:00:00.000Z",
      subject: "test_fixture_ Re: partnership terms",
      bodyText: "test_fixture_ body",
    },
  ],
};

class test_fixture_FakeGateway implements GoogleGateway {
  fetchThreadsCalls = 0;
  threads: GmailThread[] = [test_fixture_thread];
  async fetchThreads(): Promise<FetchThreadsResult> {
    this.fetchThreadsCalls += 1;
    return { threads: this.threads };
  }
  async fetchEvents(): Promise<FetchEventsResult> {
    return { events: [] };
  }
  async createDraft(): Promise<CreateDraftResult> {
    return { providerDraftId: "test_fixture_draft" };
  }
  async createEvent(): Promise<CreateEventResult> {
    return { providerEventId: "test_fixture_evt" };
  }
  async updateEvent(eventId: string): Promise<CreateEventResult> {
    return { providerEventId: eventId };
  }
  async deleteEvent(eventId: string): Promise<CreateEventResult> {
    return { providerEventId: eventId };
  }
}

class test_fixture_FakeFactory implements GoogleGatewayFactory {
  constructor(private readonly gw: GoogleGateway) {}
  async forIntegration(): Promise<GoogleGateway> {
    return this.gw;
  }
}

const externalApprovalPolicy: PolicyFn = (i) =>
  i.resourceType === "external:send" || i.action === "share"
    ? { policyId: "pol-external-approval", phase: "pre", effect: "require_approval", reason: "external send/share requires approval" }
    : null;

async function build(): Promise<{
  google: GoogleService;
  gw: test_fixture_FakeGateway;
  localPlane: LocalPlane;
  pipeline: UniversalActionPipeline;
  ledger: InMemoryLedger;
  restart: () => GoogleService;
}> {
  const roles = new InMemoryRoleStore();
  const agents = new InMemoryAgentStore();
  const ephemeral = new InMemoryEphemeralStore();
  const ledger = new InMemoryLedger();
  const events = new InMemoryEventBus();
  const variance = new RecordingVarianceAdjuster();

  agents.assumed.set(EGRESS_AGENT, "role-egress");
  agents.scope.set(EGRESS_AGENT, ["external:fetch:read"]);
  agents.tiers.set(EGRESS_AGENT, "public");
  roles.roleGrants.set("role-egress", [{ resourceType: "external:fetch", resourceId: null, action: "read", effect: "allow" }]);

  agents.assumed.set(INTAKE_AGENT, "role-intake");
  agents.scope.set(INTAKE_AGENT, ["event:write", "signal:write", "person:write"]);
  roles.roleGrants.set("role-intake", [
    { resourceType: "event", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);

  roles.direct.set(`user:${USER}`, [
    { resourceType: "external:fetch", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "external:send", resourceId: null, action: "share", effect: "allow" },
    // The intake agent drafts Event/Signal/Person proposals on behalf of this
    // user (delegation): resolveAuthority also requires the PRINCIPAL to hold the
    // matching grant, not just the agent's role.
    { resourceType: "event", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);

  const gw = new test_fixture_FakeGateway();
  const gateways = new test_fixture_FakeFactory(gw);
  const localPlane = await createMemoryLocalPlane();

  const skills = new InMemorySkillRegistry();
  for (const s of googleSkills({ gateways, bodies: localPlane.bodies })) skills.register(s);

  const pipeline = new UniversalActionPipeline({
    authority: { roles, agents, ephemeral, nowISO: "" },
    policies: new InMemoryPolicyStore([externalApprovalPolicy]),
    skills,
    ledger,
    events,
    variance,
  });

  const restart = () => {
    const intake = new IntakeService({
      pipeline,
      bodies: localPlane.bodies,
      graph: localPlane.graph,
      pendingLedger: ledger,
    });
    return new GoogleService({
      pipeline,
      intake,
      materializer: new IntakeMaterializer({ graph: localPlane.graph }),
      egress: undefined as never, // unused by this test (no external:send exercised)
      secrets: localPlane.secrets,
      identities: { workspaceId: WS, egressAgentId: EGRESS_AGENT, intakeAgentId: INTAKE_AGENT, userId: USER },
      selfEmails: ["test_fixture_self@example.com"],
    });
  };
  const google = restart();

  return { google, gw, localPlane, pipeline, ledger, restart };
}

function ctx(): RunCtx {
  const clock = new FixedClock("2026-07-05T00:00:00.000Z");
  const rng = new SeededRng(3);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

test("pending source dedup survives an IntakeService restart", async () => {
  const { google, localPlane, restart } = await build();
  const c = ctx();

  const first = await google.syncGmail(c);
  assert.equal(first.proposals.length, 1);
  assert.equal(first.proposals[0]?.status, "pending_review");
  const firstProposalId = first.proposals[0]?.proposalId;

  // Re-sync BEFORE the user has approved anything — same thread, still pending.
  const second = await restart().syncGmail(c);
  assert.equal(second.proposals.length, 1, "still only one proposal summary is returned for the same thread");
  assert.equal(second.proposals[0]?.proposalId, firstProposalId, "the second sync returns the SAME pending proposal, not a new one");
  assert.equal(second.proposals[0]?.status, "pending_review");

  // A third sync for good measure — still no duplicate.
  const third = await google.syncGmail(c);
  assert.equal(third.proposals[0]?.proposalId, firstProposalId);

  await localPlane.close();
});

test("pending identity reservation is reused across distinct source records and restart", async () => {
  const { google, gw, localPlane, ledger, restart } = await build();
  const c = ctx();
  const first = await google.syncGmail(c);
  const firstLedger = await ledger.get(first.proposals[0]!.proposalId);
  const firstDirective = (firstLedger?.proposedOutput as {
    directive?: IntakeDirective;
  } | undefined)?.directive;
  assert.ok(firstDirective?.person);

  gw.threads = [{
    ...test_fixture_thread,
    threadId: "test_fixture_thread_pending_identity_2",
    messages: test_fixture_thread.messages.map((message) => ({
      ...message,
      messageId: "test_fixture_msg_pending_identity_2",
    })),
  }];
  const second = await restart().syncGmail(c);
  const secondLedger = await ledger.get(second.proposals[0]!.proposalId);
  const secondDirective = (secondLedger?.proposedOutput as {
    directive?: IntakeDirective;
  } | undefined)?.directive;
  assert.ok(secondDirective?.person);
  assert.equal(
    secondDirective.person.localPersonId,
    firstDirective.person.localPersonId,
  );
  assert.ok(
    secondDirective.entities.every(
      (entity) => entity.personId === firstDirective.person!.localPersonId,
    ),
  );

  await localPlane.close();
});

test("Gmail intake tags Memory directives as untrusted external when manifest quarantine is enabled", async () => {
  assert.equal(GOOGLE_MANIFEST.intake_policy.quarantine, true);
  const { google, localPlane, ledger } = await build();
  const c = ctx();

  const result = await google.syncGmail(c);
  assert.equal(result.proposals.length, 1);

  const proposal = await ledger.get(result.proposals[0]!.proposalId);
  assert.equal(proposal?.trustOrigin, "untrusted_external");
  const output = proposal?.proposedOutput as { directive?: IntakeDirective } | undefined;
  const memory = output?.directive?.entities.find((e) => e.kind === "memory");

  assert.ok(memory, "Gmail intake stages a Memory directive");
  assert.equal(memory.trustOrigin, "untrusted_external");

  await localPlane.close();
});

test("after the pending proposal is approved and materialized, re-syncing the same thread does not re-propose (hasExternal catches it)", async () => {
  const { google, localPlane, pipeline } = await build();
  const c = ctx();

  const first = await google.syncGmail(c);
  const proposalId = first.proposals[0]!.proposalId;

  const resolved = await pipeline.decide(proposalId, "approve", { type: "user", id: USER }, c);
  const effects = await google.onApproved(proposalId, resolved, c);
  assert.equal(effects.materialized, true);

  const entities = await localPlane.graph.listEntities(WS, "event");
  assert.equal(entities.length, 1, "exactly one Event committed");

  // Re-sync after approval: hasExternal now excludes it (already materialized).
  const again = await google.syncGmail(c);
  assert.equal(again.proposals.length, 0, "already-materialized thread is not re-proposed");

  const entitiesAfter = await localPlane.graph.listEntities(WS, "event");
  assert.equal(entitiesAfter.length, 1, "no duplicate Event after re-sync");

  await localPlane.close();
});

test("Google effects reject a resolved proposal attributed to another owner", async () => {
  const { google, localPlane, pipeline } = await build();
  const c = ctx();
  const first = await google.syncGmail(c);
  const proposalId = first.proposals[0]!.proposalId;
  const resolved = await pipeline.decide(
    proposalId,
    "approve",
    { type: "user", id: USER },
    c,
  );
  await assert.rejects(
    () =>
      google.onApproved(
        proposalId,
        {
          ...resolved,
          request: {
            ...resolved.request,
            onBehalfOf: { type: "user", id: "test_fixture_other_owner" },
          },
        },
        c,
      ),
    /does not match the integration owner/,
  );
  assert.equal((await localPlane.graph.listEntities(WS, "event")).length, 0);
  await localPlane.close();
});

test("approved Local Plane identity is reused by a later source record", async () => {
  const { google, gw, localPlane, pipeline, ledger } = await build();
  const c = ctx();
  const first = await google.syncGmail(c);
  const firstProposalId = first.proposals[0]!.proposalId;
  const resolved = await pipeline.decide(
    firstProposalId,
    "approve",
    { type: "user", id: USER },
    c,
  );
  await google.onApproved(firstProposalId, resolved, c);
  const [approvedPerson] = await localPlane.graph.listPeople(WS);
  assert.ok(approvedPerson);

  gw.threads = [{
    ...test_fixture_thread,
    threadId: "test_fixture_thread_dedup_2",
    subject: "test_fixture_ A second conversation",
    messages: test_fixture_thread.messages.map((message) => ({
      ...message,
      messageId: "test_fixture_msg_2",
      subject: "test_fixture_ A second conversation",
    })),
  }];
  const second = await google.syncGmail(c);
  assert.equal(second.proposals[0]?.match, "linked");
  const secondProposal = await ledger.get(second.proposals[0]!.proposalId);
  const output = secondProposal?.proposedOutput as {
    directive?: IntakeDirective;
  } | undefined;
  assert.equal(output?.directive?.person, undefined);
  assert.ok(
    output?.directive?.entities.every(
      (entity) => entity.personId === approvedPerson.id,
    ),
    "the second source record links to the approved Local Person",
  );

  await localPlane.close();
});

test("failed approved materialization retains its pending dedup seed for replay", async () => {
  const { google, localPlane, pipeline } = await build();
  const c = ctx();
  const first = await google.syncGmail(c);
  const proposalId = first.proposals[0]!.proposalId;
  const resolved = await pipeline.decide(
    proposalId,
    "approve",
    { type: "user", id: USER },
    c,
  );
  const recordExternal = localPlane.graph.recordExternal.bind(localPlane.graph);
  localPlane.graph.recordExternal = async () => {
    throw new Error("test_fixture_receipt_failure");
  };
  await assert.rejects(
    () => google.onApproved(proposalId, resolved, c),
    /test_fixture_receipt_failure/,
  );
  const whileFailed = await google.syncGmail(c);
  assert.equal(
    whileFailed.proposals[0]?.proposalId,
    proposalId,
    "a failed effect cannot open a duplicate proposal window",
  );

  localPlane.graph.recordExternal = recordExternal;
  const replayed = await google.onApproved(proposalId, resolved, c);
  assert.equal(replayed.materialized, true);
  assert.equal(
    (await localPlane.graph.listEntities(WS, "event")).length,
    1,
  );

  await localPlane.close();
});

test("vetoing the pending proposal frees the dedup slot so a later re-sync can re-propose", async () => {
  const { google, localPlane, pipeline } = await build();
  const c = ctx();

  const first = await google.syncGmail(c);
  const proposalId = first.proposals[0]!.proposalId;

  const resolved = await pipeline.decide(proposalId, "veto", { type: "user", id: USER }, c);
  await google.onApproved(proposalId, resolved, c);

  // Not materialized (vetoed), and hasExternal doesn't exclude it either — re-sync
  // should be free to stage a fresh proposal rather than being permanently stuck.
  const again = await google.syncGmail(c);
  assert.equal(again.proposals.length, 1);
  assert.notEqual(again.proposals[0]?.proposalId, proposalId, "a fresh proposal is staged after the prior one was vetoed");

  await localPlane.close();
});
