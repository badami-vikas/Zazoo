/**
 * Calendar CRUD conformance — the Calendar tool's read + write round-trip through the
 * REAL pipeline + gate, with a fake gateway (dummy_ data, zero network).
 *
 * Asserts the governed contract the Calendar surface depends on:
 *   - listCalendarEvents READS through the gate (external:fetch) and returns events.
 *   - create / update / delete are DRAFT-only at propose() — the gateway is NOT called.
 *   - the real Google write runs ONLY after a human approves (external:send >= L2).
 *   - egress is idempotent (approving/executing twice never double-writes).
 *   - an agent can never resolve (approve) an external:send proposal (agent-floor).
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
import { InMemoryCanonicalIdentityStore } from "@bridge/db";

import {
  EgressExecutor,
  GoogleService,
  IntakeMaterializer,
  IntakeService,
  googleSkills,
  type CalendarEvent,
  type CreateEventEnvelope,
  type CreateEventResult,
  type CreateDraftResult,
  type FetchEventsResult,
  type FetchThreadsResult,
  type GoogleGateway,
  type GoogleGatewayFactory,
  type SendEmailEnvelope,
} from "../src/index.js";

const WS = "ws-cal";
const EGRESS_AGENT = "agent-egress";
const INTAKE_AGENT = "agent-intake";
const USER = "user-1";

// Dummy calendar events the fake gateway "fetches" — clearly dummy_-prefixed.
const dummy_events: CalendarEvent[] = [
  {
    eventId: "dummy_evt_standup",
    summary: "dummy_ Daily Standup",
    start: "2026-06-25T09:00:00.000Z",
    end: "2026-06-25T09:30:00.000Z",
    organizer: { email: "dummy_self@example.com" },
    attendees: [{ email: "dummy_teammate@example.com" }],
  },
  {
    eventId: "dummy_evt_lunch",
    summary: "dummy_ Lunch with Alex",
    location: "dummy_ Cafe",
    start: "2026-06-25T12:00:00.000Z",
    end: "2026-06-25T13:00:00.000Z",
    organizer: { email: "dummy_self@example.com" },
    attendees: [{ email: "dummy_alex@example.com" }],
  },
];

/** Records every gateway call so tests can assert what crossed the gate (and when). */
class dummy_FakeGateway implements GoogleGateway {
  calls: { method: string; args: unknown }[] = [];
  async fetchThreads(): Promise<FetchThreadsResult> {
    return { threads: [] };
  }
  async fetchEvents(): Promise<FetchEventsResult> {
    this.calls.push({ method: "fetchEvents", args: {} });
    return { events: dummy_events };
  }
  async createDraft(_e: SendEmailEnvelope): Promise<CreateDraftResult> {
    this.calls.push({ method: "createDraft", args: _e });
    return { providerDraftId: "dummy_draft_1" };
  }
  async createEvent(env: CreateEventEnvelope): Promise<CreateEventResult> {
    this.calls.push({ method: "createEvent", args: env });
    return { providerEventId: "dummy_created_1", htmlLink: "https://dummy/event/created" };
  }
  async updateEvent(eventId: string, env: Partial<CreateEventEnvelope>): Promise<CreateEventResult> {
    this.calls.push({ method: "updateEvent", args: { eventId, env } });
    return { providerEventId: eventId };
  }
  async deleteEvent(eventId: string): Promise<CreateEventResult> {
    this.calls.push({ method: "deleteEvent", args: { eventId } });
    return { providerEventId: eventId };
  }
  countOf(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }
}

class dummy_FakeFactory implements GoogleGatewayFactory {
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
  gw: dummy_FakeGateway;
  ledger: InMemoryLedger;
  localPlane: LocalPlane;
}> {
  const roles = new InMemoryRoleStore();
  const agents = new InMemoryAgentStore();
  const ephemeral = new InMemoryEphemeralStore();
  const ledger = new InMemoryLedger();
  const events = new InMemoryEventBus();
  const variance = new RecordingVarianceAdjuster();

  // Egress agent (cloud) — sources the internet (external:fetch read).
  agents.assumed.set(EGRESS_AGENT, "role-egress");
  agents.scope.set(EGRESS_AGENT, ["external:fetch:read"]);
  agents.tiers.set(EGRESS_AGENT, "public");
  roles.roleGrants.set("role-egress", [{ resourceType: "external:fetch", resourceId: null, action: "read", effect: "allow" }]);

  // Intake agent (local) — drafts graph proposals.
  agents.assumed.set(INTAKE_AGENT, "role-intake");
  agents.scope.set(INTAKE_AGENT, ["touchpoint:write", "signal:write", "person:write"]);
  roles.roleGrants.set("role-intake", [
    { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);

  // The signed-in user — may read external + share external (approve their own draft).
  roles.direct.set(`user:${USER}`, [
    { resourceType: "external:fetch", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "external:send", resourceId: null, action: "share", effect: "allow" },
  ]);

  const gw = new dummy_FakeGateway();
  const gateways = new dummy_FakeFactory(gw);
  const localPlane = await createMemoryLocalPlane();
  const canonical = new InMemoryCanonicalIdentityStore();

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

  const google = new GoogleService({
    pipeline,
    intake: new IntakeService({ pipeline, bodies: localPlane.bodies, graph: localPlane.graph }),
    materializer: new IntakeMaterializer({ graph: localPlane.graph, canonical }),
    egress: new EgressExecutor({ ledger, gateways, graph: localPlane.graph }),
    secrets: localPlane.secrets,
    identities: { workspaceId: WS, egressAgentId: EGRESS_AGENT, intakeAgentId: INTAKE_AGENT, userId: USER },
    selfEmails: ["dummy_self@example.com"],
  });

  return { google, gw, ledger, localPlane };
}

function ctx(): RunCtx {
  const clock = new FixedClock("2026-06-24T00:00:00.000Z");
  const rng = new SeededRng(11);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

test("listCalendarEvents reads full events through the gate (display projection)", async () => {
  const { google, gw, localPlane } = await build();
  const events = await google.listCalendarEvents(ctx(), { maxResults: 50 });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.eventId), ["dummy_evt_standup", "dummy_evt_lunch"]);
  assert.equal(events[1]?.location, "dummy_ Cafe"); // full event, not a stripped manifest
  assert.equal(gw.countOf("fetchEvents"), 1);
  await localPlane.close();
});

test("create event is draft-only at propose, written only after human approval (idempotent)", async () => {
  const { google, gw, localPlane } = await build();
  const c = ctx();

  const envelope: CreateEventEnvelope = {
    summary: "dummy_ New Sync",
    start: "2026-06-26T15:00:00.000Z",
    end: "2026-06-26T15:30:00.000Z",
    attendees: ["dummy_guest@example.com"],
  };
  const proposal = await google.proposeSend(c, { kind: "calendar", action: "create", envelope });

  // Draft-then-approve: external:send is NEVER auto-applied; the gateway is untouched.
  assert.equal(proposal.status, "pending_review");
  assert.equal(gw.countOf("createEvent"), 0);

  // Human approves → EgressExecutor performs the real create through the gate.
  const decided = await pipelineOf(google).decide(proposal.id, "approve", { type: "user", id: USER }, c);
  const effects = await google.onApproved(proposal.id, decided, c);
  assert.equal(effects.sent, true);
  assert.equal(gw.countOf("createEvent"), 1);
  assert.deepEqual((gw.calls.find((x) => x.method === "createEvent")?.args as CreateEventEnvelope).summary, "dummy_ New Sync");

  // Idempotency: re-running the post-approval side effect never double-writes.
  const again = await google.onApproved(proposal.id, decided, c);
  assert.equal(again.sent, false);
  assert.equal(gw.countOf("createEvent"), 1);

  await localPlane.close();
});

test("update event routes through compose → approve → gateway.updateEvent", async () => {
  const { google, gw, localPlane } = await build();
  const c = ctx();

  const proposal = await google.proposeSend(c, {
    kind: "calendar",
    action: "update",
    envelope: { eventId: "dummy_evt_lunch", summary: "dummy_ Lunch (moved)", start: "2026-06-25T12:30:00.000Z" },
  });
  assert.equal(proposal.status, "pending_review");
  assert.equal(gw.countOf("updateEvent"), 0);

  const decided = await pipelineOf(google).decide(proposal.id, "approve", { type: "user", id: USER }, c);
  const effects = await google.onApproved(proposal.id, decided, c);
  assert.equal(effects.sent, true);
  assert.equal(gw.countOf("updateEvent"), 1);
  const args = gw.calls.find((x) => x.method === "updateEvent")?.args as { eventId: string; env: Partial<CreateEventEnvelope> };
  assert.equal(args.eventId, "dummy_evt_lunch");
  assert.equal(args.env.summary, "dummy_ Lunch (moved)");

  await localPlane.close();
});

test("delete event routes through compose → approve → gateway.deleteEvent", async () => {
  const { google, gw, localPlane } = await build();
  const c = ctx();

  const proposal = await google.proposeSend(c, { kind: "calendar", action: "delete", envelope: { eventId: "dummy_evt_standup" } });
  assert.equal(proposal.status, "pending_review");
  assert.equal(gw.countOf("deleteEvent"), 0);

  const decided = await pipelineOf(google).decide(proposal.id, "approve", { type: "user", id: USER }, c);
  const effects = await google.onApproved(proposal.id, decided, c);
  assert.equal(effects.sent, true);
  assert.equal(gw.countOf("deleteEvent"), 1);
  assert.equal((gw.calls.find((x) => x.method === "deleteEvent")?.args as { eventId: string }).eventId, "dummy_evt_standup");

  await localPlane.close();
});

test("an agent can never approve a calendar external:send proposal (agent-floor)", async () => {
  const { google, gw, localPlane } = await build();
  const c = ctx();
  const proposal = await google.proposeSend(c, {
    kind: "calendar",
    action: "create",
    envelope: { summary: "dummy_ Blocked", start: "2026-06-27T10:00:00.000Z", end: "2026-06-27T10:30:00.000Z" },
  });
  await assert.rejects(
    () => pipelineOf(google).decide(proposal.id, "approve", { type: "agent", id: EGRESS_AGENT }, c),
    /agent|floor|approve/i,
  );
  assert.equal(gw.countOf("createEvent"), 0);
  await localPlane.close();
});

/** Reach the pipeline the service was built with (tests drive decide() directly). */
function pipelineOf(google: GoogleService): UniversalActionPipeline {
  return (google as unknown as { deps: { pipeline: UniversalActionPipeline } }).deps.pipeline;
}
