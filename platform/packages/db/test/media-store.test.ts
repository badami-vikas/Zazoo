import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PgliteMediaStore } from "../src/index.js";
import type { MediaCaptureRecord } from "@bridge/core";

function rec(partial: Partial<MediaCaptureRecord> = {}): MediaCaptureRecord {
  return {
    id: "m1", workspaceId: "ws-1", kind: "photo", mimeType: "image/jpeg",
    byteSize: 4, status: "pending",
    provenance: { skill: "camera.capture", version: "1.0.0" },
    capturedAt: "2026-06-20T00:00:00.000Z", ...partial,
  };
}

test("pglite store round-trips the record and the bytea blob (local, never cloud)", async () => {
  const s = await PgliteMediaStore.create(); // in-memory pglite
  const blob = new Uint8Array([10, 20, 30, 40]);
  await s.put(rec(), blob);
  const got = await s.get("m1");
  assert.equal(got?.kind, "photo");
  assert.deepEqual(await s.getBlob("m1"), blob);
  await s.close();
});

test("list filters; update flips status without touching the blob; archive is soft", async () => {
  const s = await PgliteMediaStore.create();
  await s.put(rec({ id: "a", status: "pending" }), new Uint8Array([1]));
  await s.put(rec({ id: "b", kind: "video", status: "committed" }), new Uint8Array([2]));
  assert.deepEqual((await s.list({ status: "pending" })).map((r) => r.id), ["a"]);
  const up = await s.update("a", { status: "committed", ledgerId: "led-1" });
  assert.equal(up.status, "committed");
  assert.deepEqual(await s.getBlob("a"), new Uint8Array([1]));
  await s.archive("a");
  assert.equal((await s.get("a"))?.status, "archived");
  await s.close();
});

test("append-only: duplicate id throws", async () => {
  const s = await PgliteMediaStore.create();
  await s.put(rec({ id: "dup" }), new Uint8Array([1]));
  await assert.rejects(() => s.put(rec({ id: "dup" }), new Uint8Array([2])), /duplicate|unique/i);
  await s.close();
});

test("opening a local media store migrates legacy capture provenance to its Skill", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bridge-media-vocab2-"));
  try {
    const initial = await PgliteMediaStore.create(dataDir);
    await initial.put(rec(), new Uint8Array([1]));
    await initial.close();

    const legacy = new PGlite(dataDir);
    await legacy.query(
      `UPDATE media_captures SET provenance = '{"tool":"camera","version":"1.0.0"}'::jsonb WHERE id = 'm1'`,
    );
    await legacy.close();

    const migrated = await PgliteMediaStore.create(dataDir);
    assert.deepEqual((await migrated.get("m1"))?.provenance, {
      skill: "camera",
      version: "1.0.0",
    });
    await migrated.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
