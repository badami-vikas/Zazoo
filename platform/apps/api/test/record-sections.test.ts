/**
 * records.* (TASK-083) — the ⋮ → Records toggles and the notes they show.
 *
 * The two properties the UI depends on and a store test cannot see: the toggle
 * is keyed by DATABASE (so it applies to every Record of one and to no Record
 * of another), and switching a Section OFF hides it without touching what it
 * held.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  labelFromLegacyTrustOrigin,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { applyRecordNote, readRecordNotes, readRecordSections } from "../src/record-sections.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(7);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    taintLabel: labelFromLegacyTrustOrigin("operator", "record-sections-test"),
  };
}

function makeCaller(wiring: Wiring, identity: { type: "user" | "agent"; id: string } = { type: "user", id: PILOT_USER }) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity,
    authenticated: true,
    verifying: false,
  });
}

test("Sections are off until a human turns one on, and then apply to that Database only", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    assert.deepEqual(
      await caller.records.sections({ organizationId: PILOT_ORGANIZATION, specId: "task-manager.tasks" }),
      { notes: false, intelligence: false, governance: false },
    );

    const after = await caller.records.setSection({
      organizationId: PILOT_ORGANIZATION,
      specId: "task-manager.tasks",
      section: "notes",
      enabled: true,
    });
    assert.equal(after.notes, true);

    // Re-read, because the server has the last word on what changed.
    const reread = await caller.records.sections({
      organizationId: PILOT_ORGANIZATION,
      specId: "task-manager.tasks",
    });
    assert.deepEqual(reread, { notes: true, intelligence: false, governance: false });

    // A different Database is untouched — the toggle is per-Database, not global.
    const other = await caller.records.sections({
      organizationId: PILOT_ORGANIZATION,
      specId: "events.events",
    });
    assert.equal(other.notes, false);
  } finally {
    await wiring.close?.();
  }
});

test("turning the Notes Section off hides it and preserves the notes it held", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const specId = "task-manager.tasks";
    await caller.records.setSection({ organizationId: PILOT_ORGANIZATION, specId, section: "notes", enabled: true });
    await caller.records.saveNote({
      organizationId: PILOT_ORGANIZATION,
      specId,
      recordId: "task-1",
      text: "Ask the vendor for the signed copy.",
    });

    await caller.records.setSection({ organizationId: PILOT_ORGANIZATION, specId, section: "notes", enabled: false });
    const note = await caller.records.note({ organizationId: PILOT_ORGANIZATION, specId, recordId: "task-1" });
    assert.equal(note.text, "Ask the vendor for the signed copy.");
  } finally {
    await wiring.close?.();
  }
});

test("an Agent cannot decide what every Record page of a Database shows", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, { type: "agent", id: "agent-x" });
    await assert.rejects(
      caller.records.setSection({
        organizationId: PILOT_ORGANIZATION,
        specId: "task-manager.tasks",
        section: "governance",
        enabled: true,
      }),
      /human/i,
    );
  } finally {
    await wiring.close?.();
  }
});

test("a corrupt stored value reads as all-off rather than reshaping every Record page", () => {
  assert.deepEqual(readRecordSections("nonsense"), {
    notes: false,
    intelligence: false,
    governance: false,
  });
  assert.deepEqual(readRecordSections({ notes: "yes", governance: true }), {
    notes: false,
    intelligence: false,
    governance: true,
  });
  assert.deepEqual(readRecordNotes({ a: { text: 4 }, b: { text: "kept" } }), {
    b: { text: "kept", updatedAt: "" },
  });
});

test("an emptied note is removed, not stored as a blank", () => {
  const notes = applyRecordNote({}, "e1", "first", "2026-09-03T00:00:00.000Z");
  assert.equal(notes["e1"]?.text, "first");
  assert.deepEqual(applyRecordNote(notes, "e1", "   ", "2026-09-03T00:01:00.000Z"), {});
});
