/**
 * K5 Google capture over the real `buildWiring()` composition root (AI
 * Harness K5, TASK-049) — the contract:
 *
 *  - with the "google" consent toggle OFF (the default), approved Gmail and
 *    Calendar intakes emit NOTHING (asserted, not assumed);
 *  - with it ON, an APPROVED intake emits one metadata-only signal per
 *    interaction record: sender/subject/time for a thread, summary/
 *    attendees/time for an event;
 *  - body, snippet, and description never reach a signal row (asserted over
 *    fixtures carrying distinctive content strings);
 *  - a VETOED intake emits nothing — the human approval is the warrant;
 *  - emission is idempotent across an owner-initiated decide replay
 *    (deterministic per-source-record ids);
 *  - emitted signals are inspectable, deletable Memory.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  type RunCtx,
} from "@bridge/core";
import type {
  CalendarEvent,
  CreateDraftResult,
  CreateEventResult,
  FetchEventsResult,
  FetchThreadsResult,
  GmailThread,
  GoogleGateway,
  GoogleGatewayFactory,
} from "@bridge/integrations-google";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

const ORG = PILOT_ORGANIZATION;
const SECRET_BODY = "XYZZY-the-email-body-that-must-never-reach-a-signal";
const SECRET_SNIPPET = "XYZZY-the-thread-snippet-that-must-never-reach-a-signal";
const SECRET_DESCRIPTION = "XYZZY-the-event-description-that-must-never-reach-a-signal";

const test_fixture_thread: GmailThread = {
  threadId: "test_fixture_k5_thread_1",
  subject: "test_fixture_ Renewal terms",
  participants: [
    { email: "test_fixture_founder@example.com", name: "test_fixture_ Founder" },
    { email: "test_fixture_self@example.com" },
  ],
  lastMessageAt: "2026-08-10T09:00:00.000Z",
  snippet: SECRET_SNIPPET,
  messages: [
    {
      messageId: "test_fixture_k5_msg_1",
      from: { email: "test_fixture_founder@example.com", name: "test_fixture_ Founder" },
      to: [{ email: "test_fixture_self@example.com" }],
      date: "2026-08-10T09:00:00.000Z",
      subject: "test_fixture_ Renewal terms",
      bodyText: SECRET_BODY,
    },
  ],
};

const test_fixture_event: CalendarEvent = {
  eventId: "test_fixture_k5_event_1",
  summary: "test_fixture_ Quarterly sync",
  description: SECRET_DESCRIPTION,
  start: "2026-08-11T14:00:00.000Z",
  end: "2026-08-11T15:00:00.000Z",
  organizer: { email: "test_fixture_self@example.com" },
  attendees: [
    { email: "test_fixture_founder@example.com", name: "test_fixture_ Founder" },
    { email: "test_fixture_self@example.com" },
  ],
};

class test_fixture_FakeGateway implements GoogleGateway {
  constructor(
    private readonly threads: GmailThread[],
    private readonly events: CalendarEvent[],
  ) {}
  async fetchThreads(): Promise<FetchThreadsResult> {
    return { threads: this.threads };
  }
  async fetchEvents(): Promise<FetchEventsResult> {
    return { events: this.events };
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

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(53);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring, run: makeRun(), identity: { type: "user", id: PILOT_USER }, authenticated: true, verifying: false,
  });
}

async function buildK5(threads: GmailThread[] = [test_fixture_thread], events: CalendarEvent[] = [test_fixture_event]) {
  return buildWiring({
    learningObservationEnabled: true,
    googleGateways: new test_fixture_FakeFactory(new test_fixture_FakeGateway(threads, events)),
  });
}

/** Current "google" capture-signal rows, parsed from the Memory store. */
async function googleSignalRows(wiring: Wiring) {
  const rows = await wiring.memoryStore.retrieve(
    { limit: 200 },
    { organizationId: ORG, userId: PILOT_USER },
  );
  return rows.filter((row) => {
    try {
      const value = JSON.parse(row.content) as { anchor?: { kind?: string; moduleId?: string } };
      return value.anchor?.kind === "observed_signal" && value.anchor.moduleId === "google";
    } catch {
      return false;
    }
  });
}

async function decideAll(
  caller: ReturnType<typeof makeCaller>,
  proposals: { proposalId: string; status: string }[],
  decision: "approve" | "veto",
) {
  for (const proposal of proposals) {
    assert.equal(proposal.status, "pending_review", "intake stages for human review");
    await caller.action.decide({
      proposalId: proposal.proposalId,
      decision,
      ...(decision === "veto" ? { reason: "test veto" } : {}),
    });
  }
}

test("consent OFF (the default): approved gmail + calendar intakes emit zero google signals", async () => {
  const wiring = await buildK5();
  try {
    const caller = makeCaller(wiring);
    const gmail = await caller.google.syncGmail({});
    await decideAll(caller, gmail.proposals, "approve");
    const calendar = await caller.google.syncCalendar({});
    await decideAll(caller, calendar.proposals, "approve");
    assert.equal((await googleSignalRows(wiring)).length, 0, "no consent, no signals — ever");
  } finally {
    await wiring.close();
  }
});

test("consent ON: an approved gmail thread emits sender/subject/time; body and snippet never leak; replay is idempotent", async () => {
  const wiring = await buildK5([test_fixture_thread], []);
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "google", enabled: true });
    const gmail = await caller.google.syncGmail({});
    assert.equal(gmail.proposals.length, 1);
    await decideAll(caller, gmail.proposals, "approve");

    const signals = await googleSignalRows(wiring);
    assert.equal(signals.length, 1, "one approved thread, one signal");
    const parsed = JSON.parse(signals[0]!.content) as {
      anchor: { moduleId: string; action: string };
      recordKind: string;
      recordId: string;
      attributes: Record<string, string>;
    };
    assert.equal(parsed.anchor.action, "email");
    assert.equal(parsed.recordKind, "thread");
    assert.equal(parsed.recordId, "test_fixture_k5_thread_1");
    assert.deepEqual(Object.keys(parsed.attributes).sort(), ["counterparty", "subject", "timeOfDay"]);
    assert.equal(parsed.attributes["counterparty"], "test_fixture_founder@example.com");
    assert.equal(parsed.attributes["subject"], "test_fixture_ Renewal terms");
    assert.ok(!signals[0]!.content.includes(SECRET_BODY), "message bodies never reach a signal row");
    assert.ok(!signals[0]!.content.includes(SECRET_SNIPPET), "the snippet is content, not metadata");
    assert.ok(signals[0]!.taintLabel, "capture signals stay taint-labeled at source");

    // Owner-initiated decide replay re-runs the post-approval effects; the
    // deterministic per-record id keeps the signal single.
    await caller.action.decide({ proposalId: gmail.proposals[0]!.proposalId, decision: "approve" });
    assert.equal((await googleSignalRows(wiring)).length, 1, "a replayed approval never duplicates a signal");
  } finally {
    await wiring.close();
  }
});

test("consent ON: an approved calendar event emits summary/attendees/time; the description never leaks; the row is deletable", async () => {
  const wiring = await buildK5([], [test_fixture_event]);
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "google", enabled: true });
    const calendar = await caller.google.syncCalendar({});
    assert.equal(calendar.proposals.length, 1);
    await decideAll(caller, calendar.proposals, "approve");

    const signals = await googleSignalRows(wiring);
    assert.equal(signals.length, 1, "one approved event, one signal");
    const parsed = JSON.parse(signals[0]!.content) as {
      anchor: { action: string };
      recordKind: string;
      recordId: string;
      attributes: Record<string, string>;
    };
    assert.equal(parsed.anchor.action, "meet");
    assert.equal(parsed.recordKind, "event");
    assert.equal(parsed.recordId, "test_fixture_k5_event_1");
    assert.deepEqual(Object.keys(parsed.attributes).sort(), ["attendees", "summary", "timeOfDay"]);
    assert.equal(parsed.attributes["summary"], "test_fixture_ Quarterly sync");
    assert.equal(
      parsed.attributes["attendees"],
      "test_fixture_founder@example.com, test_fixture_self@example.com",
      "the invite list rides the signal as plain emails",
    );
    assert.ok(!signals[0]!.content.includes(SECRET_DESCRIPTION), "the description is content, not metadata");

    // Inspectable AND deletable Memory, like every capture signal.
    const { forgotten } = await caller.onboarding.forgetMemory({
      organizationId: ORG,
      memoryId: signals[0]!.id,
    });
    assert.equal(forgotten, true);
    assert.equal((await googleSignalRows(wiring)).length, 0, "a forgotten signal is gone");
  } finally {
    await wiring.close();
  }
});

test("a VETOED intake emits nothing — the human approval is the emission warrant", async () => {
  const wiring = await buildK5([test_fixture_thread], []);
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "google", enabled: true });
    const gmail = await caller.google.syncGmail({});
    await decideAll(caller, gmail.proposals, "veto");
    assert.equal((await googleSignalRows(wiring)).length, 0, "a vetoed record never becomes a signal");
  } finally {
    await wiring.close();
  }
});
