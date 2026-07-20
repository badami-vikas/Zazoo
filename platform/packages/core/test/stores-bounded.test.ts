import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryEventBus, InMemoryEphemeralStore } from "../src/memory/stores.js";
import type { DomainEvent, GrantRule } from "../src/types.js";

/**
 * Dev/pilot-path (no DATABASE_URL) in-memory stores must not grow without
 * bound during a long-running local session — see docs/raw/decisions-log.md
 * for the ring-buffer-vs-time-window / lazy-vs-timer-sweep calls made here.
 */

function dummyEvent(i: number): DomainEvent {
  return {
    id: `test_fixture_event_${i}`,
    organizationId: "test_fixture_ws_1",
    type: "dummy.test.event",
    entityType: "event",
    payload: { i },
    createdAt: new Date().toISOString(),
  };
}

test("InMemoryEventBus caps retained events at the ring-buffer bound, dropping oldest first", async () => {
  const bus = new InMemoryEventBus();
  const cap = 10_000;
  const overBy = 50;
  for (let i = 0; i < cap + overBy; i++) {
    await bus.emit(dummyEvent(i));
  }
  assert.equal(bus.events.length, cap, "events array must not exceed the ring-buffer cap");
  // Oldest events (0..overBy-1) should have been evicted; the buffer should
  // start at the first event that survived the trim.
  assert.equal(bus.events[0]?.id, `test_fixture_event_${overBy}`);
  // Most recent event must still be present.
  assert.equal(bus.events[bus.events.length - 1]?.id, `test_fixture_event_${cap + overBy - 1}`);
});

test("InMemoryEventBus does not trim below the cap for normal usage", async () => {
  const bus = new InMemoryEventBus();
  for (let i = 0; i < 5; i++) {
    await bus.emit(dummyEvent(i));
  }
  assert.equal(bus.events.length, 5);
});

const dummyActor = { type: "user" as const, id: "test_fixture_user_1" };
const dummyGrant: GrantRule = {
  resourceType: "event",
  resourceId: null,
  action: "read",
  effect: "allow",
};

test("InMemoryEphemeralStore prunes expired grants on read: expired grant is absent from activeGrants AND from internal storage", async () => {
  const store = new InMemoryEphemeralStore();
  const past = new Date(Date.now() - 60_000).toISOString();
  store.mint(dummyActor, dummyGrant, past);

  assert.equal(store.grants.length, 1, "grant should be stored before it expires");

  const nowISO = new Date().toISOString();
  const active = await store.activeGrants("test_fixture_ws_1", dummyActor, undefined, nowISO);

  assert.deepEqual(active, [], "expired grant must not be returned as active");
  assert.equal(store.grants.length, 0, "expired grant must be pruned from internal storage, not just filtered");
});

test("InMemoryEphemeralStore keeps unexpired grants active and in storage", async () => {
  const store = new InMemoryEphemeralStore();
  const future = new Date(Date.now() + 60_000).toISOString();
  store.mint(dummyActor, dummyGrant, future);

  const nowISO = new Date().toISOString();
  const active = await store.activeGrants("test_fixture_ws_1", dummyActor, undefined, nowISO);

  assert.equal(active.length, 1);
  assert.equal(store.grants.length, 1, "unexpired grant must remain in storage");
});

test("InMemoryEphemeralStore prunes expired grants on mint (write path), not only on read", () => {
  const store = new InMemoryEphemeralStore();
  const past = new Date(Date.now() - 60_000).toISOString();
  store.mint(dummyActor, dummyGrant, past);
  assert.equal(store.grants.length, 1);

  // A second mint (a write) should sweep the now-expired first grant even
  // before any activeGrants() read happens.
  const future = new Date(Date.now() + 60_000).toISOString();
  store.mint(dummyActor, dummyGrant, future);

  assert.equal(store.grants.length, 1, "expired grant should have been pruned by the mint-time sweep");
  assert.equal(store.grants[0]?.expiresAtISO, future);
});
