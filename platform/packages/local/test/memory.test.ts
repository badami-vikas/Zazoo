/**
 * The in-memory LOCAL plane binds the same ports as the pglite adapters (used by
 * tests and the zero-infra dev build). Covers the commitEntity idempotency fix:
 * a retry after a partial dual-write failure re-commits the same deterministic id
 * — that must be a silent no-op, not a thrown duplicate-id error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryLocalPlane } from "../src/index.js";

test("memory local plane: commitEntity is idempotent on retry with the same id", async () => {
  const plane = createMemoryLocalPlane();

  await plane.graph.upsertPerson({ id: "p1", organizationId: "ws-1", fullName: "Priya", emails: ["priya@x.example"] });

  const entry = {
    id: "tp1",
    organizationId: "ws-1",
    kind: "touchpoint" as const,
    personId: "p1",
    payload: { touchpointKind: "email" },
    source: "gmail",
    sourceRecordId: "thread_1",
    createdAt: "2026-06-20T00:00:00.000Z",
  };

  await plane.graph.commitEntity(entry);
  assert.equal((await plane.graph.listEntities("ws-1", "touchpoint")).length, 1);

  // Retry with the SAME id: previously threw "duplicate entity id"; must now no-op.
  await assert.doesNotReject(() => plane.graph.commitEntity(entry));
  assert.equal((await plane.graph.listEntities("ws-1", "touchpoint")).length, 1, "no duplicate row after retry");

  await plane.close();
});

test("memory local state serializes concurrent organization-scoped updates", async () => {
  const plane = createMemoryLocalPlane();
  await Promise.all(
    Array.from({ length: 50 }, () =>
      plane.state.update("organization-a", "counter", { count: 0 }, (current) => {
        const state = current as { count: number };
        return { state: { count: state.count + 1 }, result: undefined };
      }),
    ),
  );

  assert.deepEqual(await plane.state.read("organization-a", "counter"), { count: 50 });
  assert.equal(await plane.state.read("organization-b", "counter"), null);
});
