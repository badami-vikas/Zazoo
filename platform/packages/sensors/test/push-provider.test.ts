/**
 * PushContextProvider (K7, TASK-051) — the boundary-relay provider's
 * contract: pushes flow into the hub's full ingest path only while started;
 * a stopped provider DROPS (returns false) and never buffers — pause means
 * nothing was sensed, not "sensed and queued for later".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryCapabilityStore, InMemoryEventBus } from "@bridge/core";
import {
  InMemoryCaptureLedger,
  PushContextProvider,
  SensorHub,
  type CaptureEmission,
} from "../src/index.js";

const WS = "ws-push";

function makeHub() {
  let n = 0;
  const capabilities = new InMemoryCapabilityStore();
  const ledger = new InMemoryCaptureLedger();
  const events = new InMemoryEventBus();
  const hub = new SensorHub({
    capabilities,
    ledger,
    events,
    organizationId: WS,
    surface: "desktop",
    ids: () => `id-${++n}`,
    nowISO: () => "2026-08-12T00:00:00.000Z",
  });
  return { hub, ledger, events };
}

function focusEmission(id: string): CaptureEmission {
  return {
    raw: {
      id: `raw-${id}`,
      providerId: "desktop-apps",
      kind: "apps",
      occurredAt: "2026-08-12T00:00:00.000Z",
      rawPayload: { appName: "Xcode", bundleId: "com.apple.dt.Xcode" },
    },
    observation: {
      id: `obs-${id}`,
      providerId: "desktop-apps",
      kind: "apps",
      occurredAt: "2026-08-12T00:00:00.000Z",
      summary: "Focused Xcode",
      payload: { appName: "Xcode", bundleId: "com.apple.dt.Xcode" },
      rawCaptureId: `raw-${id}`,
    },
  };
}

test("a started push provider relays into the hub: Memory entry + blink tell", async () => {
  const { hub, ledger, events } = makeHub();
  const provider = new PushContextProvider("desktop-apps", "apps");
  await hub.register(provider);
  await hub.start("desktop-apps");

  assert.equal(await provider.push(focusEmission("a")), true);
  const entries = await ledger.list(WS);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.type, "capture.apps");
  assert.equal(entries[0]?.content, "Focused Xcode");
  assert.ok(events.events.some((e) => e.type === "sensor.capture"));
});

test("a stopped provider DROPS pushes fail-closed — no buffering across stop/start", async () => {
  const { hub, ledger } = makeHub();
  const provider = new PushContextProvider("desktop-apps", "apps");
  await hub.register(provider);

  // Never started: dropped.
  assert.equal(await provider.push(focusEmission("b")), false);
  assert.equal((await ledger.list(WS)).length, 0);

  await hub.start("desktop-apps");
  assert.equal(await provider.push(focusEmission("c")), true);

  await hub.stop("desktop-apps");
  assert.equal(await provider.push(focusEmission("d")), false, "stopped must drop");
  const entries = await ledger.list(WS);
  assert.equal(entries.length, 1, "the drop must not have been queued for later replay");

  // Restarting opens the path again — but only for NEW captures.
  await hub.start("desktop-apps");
  assert.equal(await provider.push(focusEmission("e")), true);
  assert.equal((await ledger.list(WS)).length, 2);
});

test("re-registration over a durable store reuses the manifest and never resurrects a suspension", async () => {
  const capabilities = new InMemoryCapabilityStore();
  const events = new InMemoryEventBus();
  const mk = () =>
    new SensorHub({
      capabilities,
      ledger: new InMemoryCaptureLedger(),
      events,
      organizationId: WS,
      surface: "desktop",
      ids: () => `id-${Math.random()}`,
      nowISO: () => "2026-08-12T00:00:00.000Z",
    });

  // Boot 1 registers; an admin then suspends the provider capability.
  const hubA = mk();
  const row = await hubA.register(new PushContextProvider("desktop-apps", "apps"));
  await capabilities.upsertState({
    manifestId: row.id,
    organizationId: WS,
    state: "draft",
    suspended: true,
    evidence: {},
  });

  // Boot 2 (fresh hub, same durable store) must reuse, not throw — and the
  // suspension must be exactly as the admin left it.
  const hubB = mk();
  const reused = await hubB.register(new PushContextProvider("desktop-apps", "apps"));
  assert.equal(reused.id, row.id);
  assert.deepEqual(hubB.providerIds(), ["desktop-apps"]);
  assert.equal((await capabilities.getState(row.id))?.suspended, true);
  assert.equal(capabilities.manifests.size, 1, "one manifest row, not one per boot");
});
