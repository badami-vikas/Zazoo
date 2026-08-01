import { test } from "node:test";
import assert from "node:assert/strict";

import { FixedClock, SeededRng, UuidGen, type Proposal, type RunCtx } from "@bridge/core";
import type { BodyStore, LocalEntityRecord, LocalGraphStore, LocalPerson,
  LocalPersonList, StoredBody } from "@bridge/local";
import { IntakeMaterializer, IntakeService, type IntakeDirective, type IntakeServiceDeps } from "../src/intake.js";
import { CALENDAR_SOURCE, GMAIL_SOURCE, type CalendarEvent, type GmailThread } from "../src/contracts.js";

const test_fixture_organization = "test_fixture_organization";
const test_fixture_identities = {
  organizationId: test_fixture_organization,
  egressAgentId: "test_fixture_agent_egress",
  intakeAgentId: "test_fixture_agent_intake",
  userId: "test_fixture_user",
};

function ctx(): RunCtx {
  const clock = new FixedClock("2026-07-14T00:00:00.000Z");
  const rng = new SeededRng(17);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

class test_fixture_Pipeline {
  sourceOutput: unknown = {};
  sourceStatus: Proposal["status"] = "pending_review";
  rejectionReason: string | undefined;
  readonly proposed: unknown[] = [];
  readonly decisions: unknown[] = [];

  async propose(request: unknown): Promise<Proposal> {
    this.proposed.push(request);
    const req = request as { resourceType: string; inputs?: unknown; seed?: string };
    if (req.resourceType === "external:fetch") {
      return {
        id: "test_fixture_fetch_proposal",
        status: this.sourceStatus,
        request: request as Proposal["request"],
        authority: { allowed: true, reason: "test_fixture", basis: "role", dataScope: "public" },
        policyResults: [],
        ...(this.rejectionReason ? { rejectionReason: this.rejectionReason } : {}),
        output: { proposedOutput: this.sourceOutput },
      } as Proposal;
    }
    return {
      id: `test_fixture_stage_${this.proposed.length}`,
      status: "pending_review",
      request: request as Proposal["request"],
      authority: { allowed: true, reason: "test_fixture", basis: "role", dataScope: "all" },
      policyResults: [],
      output: { proposedOutput: req.inputs },
    } as Proposal;
  }

  async decide(proposalId: string, decision: string, actor: unknown): Promise<Proposal> {
    this.decisions.push({ proposalId, decision, actor });
    return {
      id: proposalId,
      status: "applied",
      request: { organizationId: test_fixture_organization, actor: { type: "user", id: "test_fixture_user" }, action: "read", resourceType: "external:fetch", skill: "test_fixture", inputs: {} } as Proposal["request"],
      authority: { allowed: true, reason: "test_fixture", basis: "role", dataScope: "public" },
      policyResults: [],
    } as Proposal;
  }
}

class test_fixture_Bodies implements BodyStore {
  readonly bodies = new Map<string, StoredBody>();
  readonly gets: string[] = [];

  key(organizationId: string, source: string, sourceRecordId: string): string {
    return `${organizationId}:${source}:${sourceRecordId}`;
  }

  async put(body: StoredBody): Promise<void> {
    this.bodies.set(this.key(body.organizationId, body.source, body.sourceRecordId), body);
  }

  async get(organizationId: string, source: string, sourceRecordId: string): Promise<StoredBody | null> {
    this.gets.push(this.key(organizationId, source, sourceRecordId));
    return this.bodies.get(this.key(organizationId, source, sourceRecordId)) ?? null;
  }

  async list(organizationId: string, source: string): Promise<StoredBody[]> {
    return [...this.bodies.values()].filter((b) => b.organizationId === organizationId && b.source === source);
  }
}

class test_fixture_Graph implements LocalGraphStore {
  readonly external = new Set<string>();
  readonly peopleByEmail = new Map<string, LocalPerson[]>();
  readonly committed: LocalEntityRecord[] = [];

  key(organizationId: string, source: string, sourceRecordId: string): string {
    return `${organizationId}:${source}:${sourceRecordId}`;
  }

  async findPeopleByEmail(_organizationId: string, email: string): Promise<LocalPerson[]> {
    return this.peopleByEmail.get(email.toLowerCase()) ?? [];
  }

  async upsertPerson(_person: LocalPerson): Promise<void> {}
  async listPeople(_organizationId: string): Promise<LocalPerson[]> {
    return [];
  }
  // Source-scoped identity and person lists exist for imports whose people have
  // no email (WhatsApp). Google intake matches on email and uses neither, so
  // these stay inert here rather than pretending to support a list.
  async findPeopleByDedupeKey(_organizationId: string, _dedupeKey: string): Promise<LocalPerson[]> {
    return [];
  }
  async ensurePersonList(list: LocalPersonList): Promise<LocalPersonList> {
    return list;
  }
  async listPersonLists(_organizationId: string): Promise<LocalPersonList[]> {
    return [];
  }
  async addPeopleToList(_listId: string, _personIds: readonly string[]): Promise<void> {}
  async listPeopleInList(_listId: string): Promise<LocalPerson[]> {
    return [];
  }
  async commitEntity(entry: LocalEntityRecord): Promise<void> {
    this.committed.push(entry);
  }
  async listEntities(_organizationId: string): Promise<LocalEntityRecord[]> {
    return this.committed;
  }
  async recordExternal(row: { organizationId: string; source: string; sourceRecordId: string }): Promise<void> {
    this.external.add(this.key(row.organizationId, row.source, row.sourceRecordId));
  }
  async hasExternal(organizationId: string, source: string, sourceRecordId: string): Promise<boolean> {
    return this.external.has(this.key(organizationId, source, sourceRecordId));
  }
  async getSyncCursor(): Promise<string | null> {
    return null;
  }
  async setSyncCursor(): Promise<void> {}
}

function build(): { intake: IntakeService; pipeline: test_fixture_Pipeline; bodies: test_fixture_Bodies; graph: test_fixture_Graph } {
  const pipeline = new test_fixture_Pipeline();
  const bodies = new test_fixture_Bodies();
  const graph = new test_fixture_Graph();
  const deps: IntakeServiceDeps = { pipeline: pipeline as never, bodies, graph };
  return { intake: new IntakeService(deps), pipeline, bodies, graph };
}

function stored(source: string, sourceRecordId: string, content: unknown): StoredBody {
  return {
    organizationId: test_fixture_organization,
    source,
    sourceRecordId,
    dataScope: "private",
    content,
    capturedAt: "2026-07-14T00:00:00.000Z",
  };
}

test("syncCalendar approves pending source fetch, skips materialized/missing bodies, and stages ambiguous duplicate signals", async () => {
  const { intake, pipeline, bodies, graph } = build();
  pipeline.sourceOutput = {
    events: [
      { eventId: "test_fixture_event_existing" },
      { eventId: "test_fixture_event_missing_body" },
      { eventId: "test_fixture_event_ambiguous" },
    ],
  };
  graph.external.add(graph.key(test_fixture_organization, CALENDAR_SOURCE, "test_fixture_event_existing"));
  graph.peopleByEmail.set("test_fixture_alex@example.com", [
    { id: "test_fixture_person_1", organizationId: test_fixture_organization, fullName: "test_fixture_ Alex One", emails: ["test_fixture_alex@example.com"] },
    { id: "test_fixture_person_2", organizationId: test_fixture_organization, fullName: "test_fixture_ Alex Two", emails: ["test_fixture_alex@example.com"] },
  ]);
  const event: CalendarEvent = {
    eventId: "test_fixture_event_ambiguous",
    summary: "test_fixture_ Ambiguous meeting",
    start: "2026-07-14T09:00:00.000Z",
    end: "2026-07-14T10:00:00.000Z",
    organizer: { email: "test_fixture_self@example.com" },
    attendees: [{ email: " TEST_FIXTURE_SELF@example.com " }, { name: "test_fixture_ Alex", email: "test_fixture_alex@example.com" }],
  };
  await bodies.put(stored(CALENDAR_SOURCE, event.eventId, event));

  const result = await intake.syncCalendar(
    {
      integrationId: "test_fixture_integration",
      identities: test_fixture_identities,
      selfEmails: ["test_fixture_self@example.com"],
      maxResults: 3,
      timeMin: "2026-07-01T00:00:00.000Z",
      timeMax: "2026-08-01T00:00:00.000Z",
    },
    ctx(),
  );

  assert.equal(result.source, CALENDAR_SOURCE);
  assert.equal(result.sourced, 3);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0]?.match, "ambiguous");
  assert.equal(result.proposals[0]?.resourceType, "signal");
  assert.equal(pipeline.decisions.length, 1, "pending external fetch is auto-approved by the syncing user");

  const stage = pipeline.proposed[1] as { resourceType: string; seed: string; inputs: { directive: IntakeDirective } };
  assert.equal(stage.resourceType, "signal");
  assert.equal(stage.seed, `${CALENDAR_SOURCE}:test_fixture_event_ambiguous`);
  assert.deepEqual(stage.inputs.directive.external, [{ source: CALENDAR_SOURCE, sourceRecordId: "test_fixture_event_ambiguous", entityType: "signal" }]);
  assert.deepEqual(stage.inputs.directive.entities[0]?.payload, {
    type: "possible_duplicate",
    reason: "attendee matches multiple people",
    email: "test_fixture_alex@example.com",
    candidates: [
      { id: "test_fixture_person_1", name: "test_fixture_ Alex One" },
      { id: "test_fixture_person_2", name: "test_fixture_ Alex Two" },
    ],
    summary: "test_fixture_ Ambiguous meeting",
  });
});

test("syncGmail surfaces a gate rejection without reading private bodies", async () => {
  const { intake, pipeline, bodies } = build();
  pipeline.sourceStatus = "rejected";
  pipeline.rejectionReason = "test_fixture_policy_denied";

  await assert.rejects(
    () =>
      intake.syncGmail(
        { integrationId: "test_fixture_integration", identities: test_fixture_identities, selfEmails: ["test_fixture_self@example.com"] },
        ctx(),
      ),
    /gmail source rejected at the gate: test_fixture_policy_denied/,
  );
  assert.deepEqual(bodies.gets, []);
});

test("syncGmail stages linked Event and Memory directives for an existing matched Person", async () => {
  const { intake, pipeline, bodies, graph } = build();
  pipeline.sourceStatus = "applied";
  pipeline.sourceOutput = { threads: [{ threadId: "test_fixture_thread_linked" }] };
  graph.peopleByEmail.set("test_fixture_founder@example.com", [
    { id: "test_fixture_person_founder", organizationId: test_fixture_organization, fullName: "test_fixture_ Founder", emails: ["test_fixture_founder@example.com"] },
  ]);
  const thread: GmailThread = {
    threadId: "test_fixture_thread_linked",
    subject: "test_fixture_ Hello",
    participants: [{ email: "test_fixture_self@example.com" }, { name: "test_fixture_ Founder", email: "test_fixture_founder@example.com" }],
    lastMessageAt: "2026-07-14T12:00:00.000Z",
    snippet: "test_fixture_ snippet",
    messages: [
      {
        messageId: "test_fixture_msg",
        from: { email: "test_fixture_founder@example.com" },
        to: [{ email: "test_fixture_self@example.com" }],
        date: "2026-07-14T12:00:00.000Z",
        subject: "test_fixture_ Hello",
        bodyText: "test_fixture_ body",
      },
    ],
  };
  await bodies.put(stored(GMAIL_SOURCE, thread.threadId, thread));

  const result = await intake.syncGmail(
    { integrationId: "test_fixture_integration", identities: test_fixture_identities, selfEmails: ["test_fixture_self@example.com"], query: "newer_than:7d" },
    ctx(),
  );

  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0]?.match, "linked");
  assert.equal(pipeline.decisions.length, 0, "already-applied fetch proposals are not decided again");
  const stage = pipeline.proposed[1] as { inputs: { directive: IntakeDirective; display: { trace: unknown } }; trustOrigin?: string };
  assert.equal(stage.trustOrigin, "untrusted_external");
  assert.equal(stage.inputs.directive.person, undefined);
  assert.deepEqual(
    stage.inputs.directive.entities.map((e) => ({ kind: e.kind, personId: e.personId, source: e.source, sourceRecordId: e.sourceRecordId, trustOrigin: e.trustOrigin })),
    [
      { kind: "event", personId: "test_fixture_person_founder", source: GMAIL_SOURCE, sourceRecordId: "test_fixture_thread_linked", trustOrigin: "untrusted_external" },
      { kind: "memory", personId: "test_fixture_person_founder", source: GMAIL_SOURCE, sourceRecordId: "test_fixture_thread_linked", trustOrigin: "untrusted_external" },
    ],
  );
});

test("syncGmail can stage a self-only thread without creating a new Person directive", async () => {
  const { intake, pipeline, bodies } = build();
  pipeline.sourceStatus = "applied";
  pipeline.sourceOutput = { threads: [{ threadId: "test_fixture_thread_self_only" }] };
  const thread: GmailThread = {
    threadId: "test_fixture_thread_self_only",
    subject: "test_fixture_ Notes to self",
    participants: [{ email: "test_fixture_self@example.com" }],
    lastMessageAt: "2026-07-14T12:00:00.000Z",
    snippet: "test_fixture_ self snippet",
    messages: [],
  };
  await bodies.put(stored(GMAIL_SOURCE, thread.threadId, thread));

  const result = await intake.syncGmail(
    { integrationId: "test_fixture_integration", identities: test_fixture_identities, selfEmails: ["TEST_FIXTURE_SELF@example.com"] },
    ctx(),
  );

  assert.equal(result.proposals[0]?.match, "new");
  assert.equal(result.proposals[0]?.resource, "test_fixture_ Notes to self");
  const stage = pipeline.proposed[1] as { inputs: { directive: IntakeDirective } };
  assert.equal(stage.inputs.directive.person, undefined);
  assert.equal(stage.inputs.directive.entities[0]?.personId, undefined);
  assert.equal((stage.inputs.directive.entities[0]?.payload as { with: string | null }).with, null);
});

test("IntakeMaterializer ignores non-intake proposals with no directive", async () => {
  const graph = new test_fixture_Graph();
  const materializer = new IntakeMaterializer({ graph });
  const proposal = {
    id: "test_fixture_non_intake",
    status: "applied",
    request: { organizationId: test_fixture_organization, actor: { type: "agent", id: "test_fixture_agent", plane: "local" }, action: "write", resourceType: "event", skill: "test_fixture", inputs: {} },
    authority: { allowed: true, reason: "test_fixture", basis: "role", dataScope: "all" },
    policyResults: [],
  } as Proposal;

  assert.equal(await materializer.applyApproved(proposal, ctx()), false);
  assert.deepEqual(graph.committed, []);
});
