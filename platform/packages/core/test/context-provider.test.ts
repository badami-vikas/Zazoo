import { test } from "node:test";
import assert from "node:assert/strict";

import type { ContextItem, ContextProvider, ContextProviderName } from "../src/index.js";

/** In-memory ContextProvider test double — mirrors the shape a real desktop
 * Sensor SPI source would implement, minus any actual OS-level capture. */
class TestFixtureClipboardProvider implements ContextProvider {
  readonly name: ContextProviderName = "clipboard";
  readonly kinds = ["selection"] as const;
  #queue: ContextItem[] = [];

  enqueue(item: ContextItem): void {
    this.#queue.push(item);
  }

  async collect(permission: string): Promise<ContextItem[]> {
    const items = this.#queue.filter((i) => i.permission === permission);
    this.#queue = this.#queue.filter((i) => i.permission !== permission);
    return items;
  }
}

function test_fixture_context_item(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    provider: "clipboard",
    kind: "selection",
    permission: "test_fixture_grant_1",
    dataScope: "private",
    retention: "session",
    provenance: { source: "test_fixture_desktop_shell", capturedAt: "2026-07-06T00:00:00.000Z" },
    payload: { text: "test_fixture_payload" },
    ...overrides,
  };
}

test("ContextProvider: collect returns items matching the permission grant", async () => {
  const provider = new TestFixtureClipboardProvider();
  provider.enqueue(test_fixture_context_item());
  provider.enqueue(test_fixture_context_item({ permission: "test_fixture_grant_2" }));

  const collected = await provider.collect("test_fixture_grant_1");
  assert.equal(collected.length, 1);
  assert.equal(collected[0]?.provider, "clipboard");
  assert.equal(collected[0]?.dataScope, "private");
});

test("ContextProvider: collect drains only the requested permission's items", async () => {
  const provider = new TestFixtureClipboardProvider();
  provider.enqueue(test_fixture_context_item());

  const first = await provider.collect("test_fixture_grant_1");
  const second = await provider.collect("test_fixture_grant_1");
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
});

test("ContextProvider: an empty-queue collect returns an empty array, not a throw", async () => {
  const provider = new TestFixtureClipboardProvider();
  const collected = await provider.collect("test_fixture_grant_never_enqueued");
  assert.deepEqual(collected, []);
});

test("ContextItem: provenance.subject is optional", () => {
  const item = test_fixture_context_item();
  assert.equal(item.provenance.subject, undefined);

  const withSubject = test_fixture_context_item({
    provenance: { source: "test_fixture_desktop_shell", capturedAt: "2026-07-06T00:00:00.000Z", subject: "person_123" },
  });
  assert.equal(withSubject.provenance.subject, "person_123");
});

test("ContextProvider: nine day-1 provider names are each assignable", () => {
  const names: ContextProviderName[] = [
    "apps",
    "accessibility",
    "screen",
    "voice",
    "clipboard",
    "filesystem",
    "browser",
    "documents",
    "emails",
  ];
  assert.equal(names.length, 9);
  assert.ok(names.includes("screen"), "screen is one provider among nine, not the whole architecture");
});
