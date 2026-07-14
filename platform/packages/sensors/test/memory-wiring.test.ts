import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryCapabilityStore, InMemoryEventBus, InMemoryMemoryStore } from "@bridge/core";
import { InMemoryCaptureLedger, SensorHub, type CaptureEmission } from "../src/index.js";

const WS = "ws-1";
const USER = "user-1";

function makeHub() {
  let n = 0;
  const capabilities = new InMemoryCapabilityStore();
  const ledger = new InMemoryCaptureLedger();
  const events = new InMemoryEventBus();
  const memories = new InMemoryMemoryStore();
  const hub = new SensorHub({
    capabilities,
    ledger,
    memories,
    events,
    workspaceId: WS,
    userId: USER,
    surface: "desktop",
    ids: () => `id-${++n}`,
    nowISO: () => "2026-07-06T00:00:00.000Z",
  });
  return { hub, ledger, memories };
}

function emission(providerId: string, kind: CaptureEmission["raw"]["kind"], raw: unknown): CaptureEmission {
  return {
    raw: { id: `raw-${providerId}`, providerId, kind, occurredAt: "2026-07-06T00:00:00.000Z", rawPayload: raw },
    observation: {
      id: `obs-${providerId}`,
      providerId,
      kind,
      occurredAt: "2026-07-06T00:00:00.000Z",
      summary: `derived summary from ${providerId}`,
      payload: { appName: "SomeApp" },
      redactions: ["window contents stripped"],
      rawCaptureId: `raw-${providerId}`,
    },
  };
}

test("capture ingest writes a private Memory candidate with untrusted provenance", async () => {
  const { hub, memories } = makeHub();

  const entry = await hub.ingest(emission("scr-1", "screen", { frameBytes: [1, 2, 3] }));

  assert.equal(entry.trustOrigin, "untrusted_external");

  const owned = await memories.retrieve({}, { workspaceId: WS, userId: USER });
  assert.equal(owned.length, 1);
  assert.equal(owned[0]!.content, "derived summary from scr-1");
  assert.equal(owned[0]!.sourceRefType, "timeline_entry");
  assert.equal(owned[0]!.sourceRefId, entry.id);
  assert.equal(owned[0]!.trustOrigin, "untrusted_external");

  const otherUser = await memories.retrieve({}, { workspaceId: WS, userId: "user-2" });
  assert.deepEqual(otherUser, []);
});
