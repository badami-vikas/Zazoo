/**
 * InMemoryMemoryStore.redactLineageContent — TASK-011 remediation
 * (coordinator central-merge review, issue 2). `compareAndSupersede`'s
 * normal "purge the current view" pattern only ever rewrites the CURRENT
 * row via a new successor; every ancestor row in a lineage (in particular
 * whichever row first held sensitive/expired raw bytes) remained durably
 * readable via `retrieve({ includeSuperseded: true })` forever.
 * `redactLineageContent` walks the SAME bidirectional lineage `forget()`
 * uses and rewrites `content` in place wherever the caller's `redact`
 * predicate says to — never deleting rows, never touching unrelated
 * Memory, never fabricating a false "already redacted" outcome.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryMemoryStore, type MemoryWrite } from "../src/index.js";

const WS = "ws-1";
const USER_A = "user-a";
const USER_B = "user-b";

function mem(overrides: Partial<MemoryWrite> & { id: string }): MemoryWrite {
  return {
    organizationId: WS,
    type: "episodic",
    scope: "organization",
    content: "test_fixture_memory",
    confidence: 0.5,
    trustOrigin: "untrusted_external",
    plane: "local",
    createdBy: "test_fixture_provider",
    ...overrides,
  };
}

test("redactLineageContent: redacts content across the FULL lineage (ancestor row AND current row), not just the current view — the exact gap compareAndSupersede alone leaves open", async () => {
  const store = new InMemoryMemoryStore();
  const first = await store.write(mem({ id: "10000000-0000-4000-8000-000000000001", content: "SECRET raw payload v1" }));
  const second = await store.compareAndSupersede(first.id, mem({ id: "10000000-0000-4000-8000-000000000002", content: "SECRET raw payload v2" }));

  const redactedCount = await store.redactLineageContent(second.id, { organizationId: WS }, (entry) =>
    entry.content.includes("SECRET") ? entry.content.replace("SECRET raw payload", "[redacted]") : null,
  );
  assert.equal(redactedCount, 2, "both the current row AND its superseded ancestor must be redacted");

  const currentAfter = await store.retrieve({ includeSuperseded: false }, { organizationId: WS });
  assert.equal(currentAfter.length, 1);
  assert.equal(currentAfter[0]!.content, "[redacted] v2");

  const allAfter = await store.retrieve({ includeSuperseded: true }, { organizationId: WS });
  assert.equal(allAfter.length, 2);
  for (const row of allAfter) {
    assert.ok(!row.content.includes("SECRET"), `row ${row.id} must never retain the raw SECRET bytes after redaction`);
  }
  // The ANCESTOR row (v1) must be redacted too — this is the exact property
  // a plain compareAndSupersede-only purge cannot provide.
  const ancestor = allAfter.find((r) => r.id === first.id)!;
  assert.equal(ancestor.content, "[redacted] v1");
});

test("redactLineageContent: leaves every other field untouched — id, supersedesId, timestamps, scope, sourceRefType/sourceRefId, confidence, trustOrigin, plane, createdBy, ownerUserId", async () => {
  const store = new InMemoryMemoryStore();
  const written = await store.write(
    mem({
      id: "20000000-0000-4000-8000-000000000001",
      scope: "private",
      ownerUserId: USER_A,
      sourceRefType: "ledger",
      sourceRefId: "30000000-0000-4000-8000-000000000099",
      confidence: 0.87,
      trustOrigin: "untrusted_external",
      plane: "local",
      createdBy: "test_fixture_learning_agent",
      content: "SECRET",
      createdAt: "2026-07-01T00:00:00.000Z",
    }),
  );

  await store.redactLineageContent(written.id, { organizationId: WS, userId: USER_A }, () => "[redacted]");

  const [after] = await store.retrieve({ includeSuperseded: true }, { organizationId: WS, userId: USER_A });
  assert.ok(after);
  assert.equal(after!.id, written.id);
  assert.equal(after!.content, "[redacted]");
  assert.equal(after!.scope, "private");
  assert.equal(after!.ownerUserId, USER_A);
  assert.equal(after!.sourceRefType, "ledger");
  assert.equal(after!.sourceRefId, "30000000-0000-4000-8000-000000000099");
  assert.equal(after!.confidence, 0.87);
  assert.equal(after!.trustOrigin, "untrusted_external");
  assert.equal(after!.plane, "local");
  assert.equal(after!.createdBy, "test_fixture_learning_agent");
  assert.equal(after!.createdAt, "2026-07-01T00:00:00.000Z");
  assert.equal(after!.supersedesId, null);
});

test("redactLineageContent: a null return from redact() leaves that row's content COMPLETELY untouched — never a false 'redacted' outcome, never silently rewrites content the predicate did not select", async () => {
  const store = new InMemoryMemoryStore();
  const untouchable = await store.write(mem({ id: "40000000-0000-4000-8000-000000000001", content: "not sensitive at all" }));

  const redactedCount = await store.redactLineageContent(untouchable.id, { organizationId: WS }, () => null);
  assert.equal(redactedCount, 0, "a redact() that never matches must report zero rows changed");

  const [after] = await store.retrieve({ includeSuperseded: true }, { organizationId: WS });
  assert.equal(after!.content, "not sensitive at all", "content must be byte-for-byte unchanged when redact() returns null");
});

test("redactLineageContent: scoped to the SAME lineage forget() uses — an UNRELATED Memory (different subject/lineage entirely, even in the same organization) is never touched, redact() is never even invoked for it", async () => {
  const store = new InMemoryMemoryStore();
  const target = await store.write(mem({ id: "50000000-0000-4000-8000-000000000001", content: "SECRET target" }));
  const unrelated = await store.write(mem({ id: "50000000-0000-4000-8000-000000000002", content: "SECRET unrelated" }));

  const seenIds: string[] = [];
  await store.redactLineageContent(target.id, { organizationId: WS }, (entry) => {
    seenIds.push(entry.id);
    return "[redacted]";
  });

  assert.deepEqual(seenIds, [target.id], "redact() must be invoked ONLY for rows in the target lineage, never a broad organization-wide scan");
  const rows = await store.retrieve({ includeSuperseded: true }, { organizationId: WS });
  const unrelatedAfter = rows.find((r) => r.id === unrelated.id);
  assert.equal(unrelatedAfter!.content, "SECRET unrelated", "an unrelated Memory row must be completely unaffected by a redaction of a DIFFERENT lineage");
});

test("redactLineageContent: authority-scoped exactly like forget() — a caller lacking visibility (wrong organization, or a private row owned by someone else) gets 0 rows redacted, never an unauthorized rewrite", async () => {
  const store = new InMemoryMemoryStore();
  const privateToA = await store.write(mem({ id: "60000000-0000-4000-8000-000000000001", scope: "private", ownerUserId: USER_A, content: "SECRET" }));

  const asOtherOrganization = await store.redactLineageContent(privateToA.id, { organizationId: "ws-other" }, () => "[redacted]");
  assert.equal(asOtherOrganization, 0, "a caller in a DIFFERENT organization must never redact this row");

  const asWrongUser = await store.redactLineageContent(privateToA.id, { organizationId: WS, userId: USER_B }, () => "[redacted]");
  assert.equal(asWrongUser, 0, "a caller who is not the owning user must never redact a private row");

  const [stillIntact] = await store.retrieve({ includeSuperseded: true }, { organizationId: WS, userId: USER_A });
  assert.equal(stillIntact!.content, "SECRET", "the row must remain completely unredacted after two unauthorized attempts");
});

test("redactLineageContent: forget() and redactLineageContent() agree on lineage membership — a row reachable via forget()'s lineage walk is equally reachable/redactable here", async () => {
  const store = new InMemoryMemoryStore();
  const v1 = await store.write(mem({ id: "70000000-0000-4000-8000-000000000001", content: "SECRET v1" }));
  const v2 = await store.compareAndSupersede(v1.id, mem({ id: "70000000-0000-4000-8000-000000000002", content: "SECRET v2" }));
  const v3 = await store.compareAndSupersede(v2.id, mem({ id: "70000000-0000-4000-8000-000000000003", content: "SECRET v3" }));

  // Confirm redaction from ANY lineage member reaches the WHOLE 3-row chain
  // — mirrors forget()'s own "any lineage member forgets everything" property.
  const redactedFromMiddle = await store.redactLineageContent(v2.id, { organizationId: WS }, () => "[redacted]");
  assert.equal(redactedFromMiddle, 3, "redacting from a MIDDLE lineage member must reach every row in the chain, not just its own descendants");

  const all = await store.retrieve({ includeSuperseded: true }, { organizationId: WS });
  assert.equal(all.length, 3);
  for (const row of all) assert.equal(row.content, "[redacted]");
  void v3;
});
