/**
 * Events sub-module speaker-extraction review queue (TASK-070 follow-on,
 * ADR-239) — `events.extraction.drafts` / `.decide` and `events.outreach.list`.
 *
 * `events.extraction.run` itself is NOT exercised here: it calls out to the
 * real network via `guardedFetch` (Event URL fetch + OpenAlex), and
 * `guardedFetch` deliberately refuses to connect to loopback/private
 * addresses (SSRF guard) — so it cannot be pointed at a local test server
 * either. That composition shell is intentionally thin and undertested BY
 * DESIGN (see `events-extraction-runtime.ts`'s doc comment); the logic it
 * composes (`extractSpeakerCandidates`, `resolveOpenAlexAuthor`, dedupe's
 * `matchOne`) is unit-tested in `@bridge/events-extraction` and
 * `@bridge/dedupe`. This file seeds staged draft rows directly (as `run`
 * would have) and exercises the review-queue decision path, which is the
 * part with the real risk: never-auto-merge, and never double-materializing
 * a Person/edge/outreach-note on a repeated decision.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, hashTaintValue, labelAtSource, type Actor, type RunCtx } from "@bridge/core";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function runContext(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(7);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    taintLabel: labelAtSource("human_input", {
      ref: "test-fixture:events-extraction",
      valueHash: hashTaintValue("test-fixture-events-extraction"),
      sensitivity: "organization",
      instructionRisk: "none",
    }),
  };
}

async function makeCaller(wiring: Wiring, identity: Actor = { type: "user", id: PILOT_USER }) {
  return appRouter.createCaller({ wiring, run: runContext(), identity, authenticated: true, verifying: false });
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "bridge-api-events-extraction-"));
  const wiring = await buildWiring({ localDir: root });
  const caller = await makeCaller(wiring);
  return { wiring, caller, close: () => wiring.close() };
}

test("approving a strong-tier match links the EXISTING Person, never creating a duplicate", async () => {
  const { wiring, caller, close } = await setup();
  try {
    const event = await caller.events.create({ organizationId: PILOT_ORGANIZATION, name: "DevConf 2026" });
    await wiring.localPlane.graph.upsertPerson({
      id: "11111111-1111-1111-1111-111111111111",
      organizationId: PILOT_ORGANIZATION,
      fullName: "Ada Lovelace",
      emails: [],
    });
    const [draft] = await wiring.eventExtractionStore.insertSpeakerDrafts([
      {
        organizationId: PILOT_ORGANIZATION,
        eventId: event.id,
        runId: "run-1",
        name: "Ada Lovelace",
        affiliation: "Analytical Engines Ltd",
        tier: "strong",
        score: 1,
        matchedPersonId: "11111111-1111-1111-1111-111111111111",
      },
    ]);
    assert.ok(draft);

    const before = await wiring.localPlane.graph.listPeople(PILOT_ORGANIZATION);
    const decided = await caller.events.extraction.decide({
      organizationId: PILOT_ORGANIZATION,
      eventId: event.id,
      eventName: event.name,
      draftId: draft!.id,
      decision: "approve",
    });
    const after = await wiring.localPlane.graph.listPeople(PILOT_ORGANIZATION);

    assert.equal(decided?.status, "approved");
    assert.equal(decided?.resolvedPersonId, "11111111-1111-1111-1111-111111111111");
    // No new Person minted — the strong match's existing Person was reused.
    assert.equal(after.length, before.length);

    const outreach = await wiring.eventExtractionStore.listOutreachDrafts(PILOT_ORGANIZATION, event.id);
    assert.equal(outreach.length, 1);
    assert.equal(outreach[0]?.personId, "11111111-1111-1111-1111-111111111111");
    assert.match(outreach[0]!.noteText, /Ada/);
    assert.match(outreach[0]!.noteText, /DevConf 2026/);
  } finally {
    await close();
  }
});

test("approving an unmatched (flag-tier) draft creates a NEW Person", async () => {
  const { wiring, caller, close } = await setup();
  try {
    const event = await caller.events.create({ organizationId: PILOT_ORGANIZATION, name: "DevConf 2026" });
    const [draft] = await wiring.eventExtractionStore.insertSpeakerDrafts([
      { organizationId: PILOT_ORGANIZATION, eventId: event.id, runId: "run-1", name: "Nobody Yet", tier: "flag", score: 0.4 },
    ]);
    assert.ok(draft);

    const before = await wiring.localPlane.graph.listPeople(PILOT_ORGANIZATION);
    const decided = await caller.events.extraction.decide({
      organizationId: PILOT_ORGANIZATION,
      eventId: event.id,
      eventName: event.name,
      draftId: draft!.id,
      decision: "approve",
    });
    const after = await wiring.localPlane.graph.listPeople(PILOT_ORGANIZATION);

    assert.equal(decided?.status, "approved");
    assert.ok(decided?.resolvedPersonId);
    assert.equal(after.length, before.length + 1);
    assert.ok(after.some((p) => p.id === decided?.resolvedPersonId && p.fullName === "Nobody Yet"));
  } finally {
    await close();
  }
});

test("rejecting a draft leaves no Person, edge, or outreach draft behind", async () => {
  const { wiring, caller, close } = await setup();
  try {
    const event = await caller.events.create({ organizationId: PILOT_ORGANIZATION, name: "DevConf 2026" });
    const [draft] = await wiring.eventExtractionStore.insertSpeakerDrafts([
      { organizationId: PILOT_ORGANIZATION, eventId: event.id, runId: "run-1", name: "Weak Match", tier: "moderate", score: 0.8 },
    ]);
    assert.ok(draft);

    const before = await wiring.localPlane.graph.listPeople(PILOT_ORGANIZATION);
    const decided = await caller.events.extraction.decide({
      organizationId: PILOT_ORGANIZATION,
      eventId: event.id,
      eventName: event.name,
      draftId: draft!.id,
      decision: "reject",
    });
    const after = await wiring.localPlane.graph.listPeople(PILOT_ORGANIZATION);

    assert.equal(decided?.status, "rejected");
    assert.equal(after.length, before.length);
    const outreach = await wiring.eventExtractionStore.listOutreachDrafts(PILOT_ORGANIZATION, event.id);
    assert.equal(outreach.length, 0);
  } finally {
    await close();
  }
});

test("deciding an already-decided draft is refused, never re-runs materialization", async () => {
  const { wiring, caller, close } = await setup();
  try {
    const event = await caller.events.create({ organizationId: PILOT_ORGANIZATION, name: "DevConf 2026" });
    const [draft] = await wiring.eventExtractionStore.insertSpeakerDrafts([
      { organizationId: PILOT_ORGANIZATION, eventId: event.id, runId: "run-1", name: "Once Only", tier: "flag", score: 0.3 },
    ]);
    assert.ok(draft);

    await caller.events.extraction.decide({
      organizationId: PILOT_ORGANIZATION,
      eventId: event.id,
      eventName: event.name,
      draftId: draft!.id,
      decision: "approve",
    });
    const peopleAfterFirst = await wiring.localPlane.graph.listPeople(PILOT_ORGANIZATION);

    await assert.rejects(
      caller.events.extraction.decide({
        organizationId: PILOT_ORGANIZATION,
        eventId: event.id,
        eventName: event.name,
        draftId: draft!.id,
        decision: "approve",
      }),
      (error: unknown) => error instanceof TRPCError && error.code === "CONFLICT",
    );
    const peopleAfterSecond = await wiring.localPlane.graph.listPeople(PILOT_ORGANIZATION);
    assert.equal(peopleAfterSecond.length, peopleAfterFirst.length);

    const outreach = await wiring.eventExtractionStore.listOutreachDrafts(PILOT_ORGANIZATION, event.id);
    assert.equal(outreach.length, 1);
  } finally {
    await close();
  }
});

test("drafts query lists by status and never surfaces another event's drafts", async () => {
  const { wiring, caller, close } = await setup();
  try {
    const eventA = await caller.events.create({ organizationId: PILOT_ORGANIZATION, name: "Event A" });
    const eventB = await caller.events.create({ organizationId: PILOT_ORGANIZATION, name: "Event B" });
    await wiring.eventExtractionStore.insertSpeakerDrafts([
      { organizationId: PILOT_ORGANIZATION, eventId: eventA.id, runId: "run-1", name: "Speaker A1", tier: "moderate", score: 0.8 },
      { organizationId: PILOT_ORGANIZATION, eventId: eventB.id, runId: "run-1", name: "Speaker B1", tier: "moderate", score: 0.8 },
    ]);

    const draftsA = await caller.events.extraction.drafts({ organizationId: PILOT_ORGANIZATION, eventId: eventA.id });
    assert.equal(draftsA.length, 1);
    assert.equal(draftsA[0]?.name, "Speaker A1");

    const pendingA = await caller.events.extraction.drafts({
      organizationId: PILOT_ORGANIZATION,
      eventId: eventA.id,
      status: "approved",
    });
    assert.equal(pendingA.length, 0);
  } finally {
    await close();
  }
});
