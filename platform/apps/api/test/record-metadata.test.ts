/**
 * Derived Record metadata (TASK-063).
 *
 * The fold is the whole feature: get the ORDER wrong and "created" and "last
 * edited" swap, which looks like data rather than a bug. These pin it, plus the
 * rule that an actor Bridge did not record reads as unknown rather than as a
 * plausible id.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  actorFromPayload,
  deriveRecordMetadata,
  emptyRecordMetadata,
} from "../src/record-metadata.js";

test("created is the earliest Event and last-edited the latest, whatever order they arrive in", () => {
  const derived = deriveRecordMetadata([
    { entityId: "t1", createdAt: "2026-09-02T10:00:00.000Z", payload: { actorId: "user-b" } },
    { entityId: "t1", createdAt: "2026-09-01T09:00:00.000Z", payload: { actorId: "user-a" } },
    { entityId: "t1", createdAt: "2026-09-03T11:00:00.000Z", payload: { deciderId: "user-c" } },
  ]);
  assert.deepEqual(derived.get("t1"), {
    createdTime: "2026-09-01T09:00:00.000Z",
    createdBy: "user-a",
    lastEditedTime: "2026-09-03T11:00:00.000Z",
    lastEditedBy: "user-c",
  });
});

test("one Event means created and last-edited are the same instant and actor", () => {
  const derived = deriveRecordMetadata([
    { entityId: "t2", createdAt: "2026-09-01T09:00:00.000Z", payload: { ownerUserId: "user-a" } },
  ]);
  assert.deepEqual(derived.get("t2"), {
    createdTime: "2026-09-01T09:00:00.000Z",
    createdBy: "user-a",
    lastEditedTime: "2026-09-01T09:00:00.000Z",
    lastEditedBy: "user-a",
  });
});

test("Records are kept apart — one entity's Events never fill another's columns", () => {
  const derived = deriveRecordMetadata([
    { entityId: "t1", createdAt: "2026-09-01T09:00:00.000Z", payload: { actorId: "user-a" } },
    { entityId: "t2", createdAt: "2026-09-05T09:00:00.000Z", payload: { actorId: "user-z" } },
  ]);
  assert.equal(derived.get("t1")?.lastEditedBy, "user-a");
  assert.equal(derived.get("t2")?.createdTime, "2026-09-05T09:00:00.000Z");
  assert.equal(derived.get("t3"), undefined);
});

test("an actor Bridge never recorded reads as unknown, never as a guess", () => {
  assert.equal(actorFromPayload({ note: "no actor here" }), null);
  assert.equal(actorFromPayload(null), null);
  assert.equal(actorFromPayload("a string payload"), null);
  // An empty string is not an actor.
  assert.equal(actorFromPayload({ actorId: "   " }), null);
  // Priority order is the declared one: actorId wins over the fallbacks.
  assert.equal(actorFromPayload({ userId: "u", actorId: "a" }), "a");

  const derived = deriveRecordMetadata([
    { entityId: "t4", createdAt: "2026-09-01T09:00:00.000Z", payload: {} },
  ]);
  assert.equal(derived.get("t4")?.createdBy, null);
  assert.equal(derived.get("t4")?.createdTime, "2026-09-01T09:00:00.000Z");
});

test("a Record nothing has happened to reads unknown in every field", () => {
  assert.deepEqual(emptyRecordMetadata(), {
    createdTime: null,
    createdBy: null,
    lastEditedTime: null,
    lastEditedBy: null,
  });
  assert.equal(deriveRecordMetadata([]).size, 0);
});
