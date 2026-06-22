import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryMediaStore, type MediaCaptureRecord } from "../src/index.js";

const WS = "ws-1";
function rec(partial: Partial<MediaCaptureRecord> = {}): MediaCaptureRecord {
  return {
    id: "m1",
    workspaceId: WS,
    kind: "photo",
    mimeType: "image/jpeg",
    byteSize: 3,
    status: "pending",
    provenance: { tool: "camera", version: "1.0.0" },
    capturedAt: "2026-06-20T00:00:00.000Z",
    ...partial,
  };
}

test("put then get round-trips the record and the blob (local plane)", async () => {
  const s = new InMemoryMediaStore();
  const blob = new Uint8Array([1, 2, 3]);
  await s.put(rec(), blob);
  const got = await s.get("m1");
  assert.equal(got?.kind, "photo");
  assert.deepEqual(await s.getBlob("m1"), blob);
});

test("list filters by status and kind", async () => {
  const s = new InMemoryMediaStore();
  await s.put(rec({ id: "a", kind: "photo", status: "pending" }), new Uint8Array([1]));
  await s.put(rec({ id: "b", kind: "video", status: "committed" }), new Uint8Array([2]));
  assert.deepEqual((await s.list({ status: "pending" })).map((r) => r.id), ["a"]);
  assert.deepEqual((await s.list({ kind: "video" })).map((r) => r.id), ["b"]);
});

test("update mutates status/ledgerId but never the blob; archive is soft", async () => {
  const s = new InMemoryMediaStore();
  await s.put(rec({ id: "a" }), new Uint8Array([9]));
  const updated = await s.update("a", { status: "committed", ledgerId: "led-1" });
  assert.equal(updated.status, "committed");
  assert.equal(updated.ledgerId, "led-1");
  assert.deepEqual(await s.getBlob("a"), new Uint8Array([9])); // blob immutable
  await s.archive("a");
  const got = await s.get("a");
  assert.equal(got?.status, "archived");
  assert.ok(got?.archivedAt); // soft-delete, row still present
});

test("put is append-only: a duplicate id throws", async () => {
  const s = new InMemoryMediaStore();
  await s.put(rec({ id: "dup" }), new Uint8Array([1]));
  await assert.rejects(() => s.put(rec({ id: "dup" }), new Uint8Array([2])), /duplicate/);
});
