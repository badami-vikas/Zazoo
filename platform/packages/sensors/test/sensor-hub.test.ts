import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryCapabilityStore, InMemoryEventBus } from "@bridge/core";
import {
  FakeContextProvider,
  InMemoryCaptureLedger,
  SensorHub,
  SURFACE_PROVIDER_KINDS,
  type CaptureEmission,
  type ContextObservation,
  type SensorHubDeps,
} from "../src/index.js";

const WS = "ws-1";

function makeHub(surface: SensorHubDeps["surface"] = "desktop") {
  let n = 0;
  const capabilities = new InMemoryCapabilityStore();
  const ledger = new InMemoryCaptureLedger();
  const events = new InMemoryEventBus();
  const hub = new SensorHub({
    capabilities,
    ledger,
    events,
    organizationId: WS,
    surface,
    ids: () => `id-${++n}`,
    nowISO: () => "2026-07-06T00:00:00.000Z",
  });
  return { hub, capabilities, ledger, events };
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

test("kernel runs with zero sensors — hub is fully functional unregistered", async () => {
  const { hub, ledger, events } = makeHub();
  assert.deepEqual(hub.providerIds(), []);
  // Nothing throws; consumers can subscribe/unsubscribe; no captures exist.
  const un = hub.subscribe({ id: "c1", plane: "local", onObservation: () => {} });
  un();
  assert.deepEqual(await ledger.list(WS), []);
  assert.equal(events.events.length, 0);
});

test("observation → inspectable Memory entry + blink tell", async () => {
  const { hub, ledger, events } = makeHub();
  const p = new FakeContextProvider("apps-1", "apps");
  await hub.register(p);
  await hub.start("apps-1");

  await p.emitCapture(emission("apps-1", "apps", { axDump: "<huge raw tree>" }));

  const entries = await ledger.list(WS);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.type, "capture.apps");
  assert.equal(entries[0]!.content, "derived summary from apps-1");
  assert.equal(entries[0]!.createdBy, "apps-1");
  assert.deepEqual(entries[0]!.redactions, ["window contents stripped"]);

  // Blink tell: one "sensor.capture" DomainEvent referencing the Memory entry.
  const blinks = events.events.filter((e) => e.type === "sensor.capture");
  assert.equal(blinks.length, 1);
  assert.equal(blinks[0]!.payload["memoryEntryId"], entries[0]!.id);
});

test("raw payload never crosses plane: consumers get derived only, cloud raw read refused", async () => {
  const { hub } = makeHub();
  const p = new FakeContextProvider("scr-1", "screen");
  await hub.register(p);
  await hub.start("scr-1");

  const seen: ContextObservation[] = [];
  hub.subscribe({ id: "cloud-consumer", plane: "cloud", onObservation: (o) => void seen.push(o) });

  await p.emitCapture(emission("scr-1", "screen", { frameBytes: [1, 2, 3] }));

  assert.equal(seen.length, 1);
  // Type-level separation: the observation object carries no raw payload.
  assert.equal("rawPayload" in seen[0]!, false);
  assert.equal(seen[0]!.summary, "derived summary from scr-1");

  // Local plane may dereference raw; cloud plane is refused unconditionally.
  const raw = hub.readRawCapture("raw-scr-1", "local");
  assert.deepEqual(raw?.rawPayload, { frameBytes: [1, 2, 3] });
  assert.throws(() => hub.readRawCapture("raw-scr-1", "cloud"), /local-plane only/);
});

test("registration creates a capability manifest with COMPUTED risk (built_in, draft)", async () => {
  const { hub, capabilities } = makeHub();
  await hub.register(new FakeContextProvider("clip-1", "clipboard"));
  await hub.register(new FakeContextProvider("mail-1", "emails"));

  // Read-only, no-egress capture sensor computes to informational.
  const clip = await capabilities.getManifest("ctx-provider:clip-1");
  assert.equal(clip?.computedRisk, "informational");
  assert.equal(clip?.origin, "built_in");
  const clipState = await capabilities.getState("ctx-provider:clip-1");
  assert.equal(clipState?.state, "draft"); // generation ≠ activation

  // Emails provider writes signal-shaped context → advisory (higher than clipboard).
  const mail = await capabilities.getManifest("ctx-provider:mail-1");
  assert.equal(mail?.computedRisk, "advisory");
});

test("per-surface subsets: browser surface rejects a screen provider", async () => {
  const { hub } = makeHub("browser");
  await assert.rejects(() => hub.register(new FakeContextProvider("scr-1", "screen")), /not available on surface "browser"/);
  // But browser-kind providers register fine.
  await hub.register(new FakeContextProvider("tab-1", "browser"));
  assert.deepEqual(hub.providerIds(), ["tab-1"]);
  // Sanity on the subset table itself.
  assert.equal(SURFACE_PROVIDER_KINDS.desktop.length, 9);
  assert.deepEqual(SURFACE_PROVIDER_KINDS.browser, ["browser", "documents"]);
});

test("start/stop lifecycle + duplicate registration rejected", async () => {
  const { hub } = makeHub();
  const p = new FakeContextProvider("fs-1", "filesystem");
  await hub.register(p);
  await assert.rejects(() => hub.register(new FakeContextProvider("fs-1", "filesystem")), /already registered/);
  await hub.start("fs-1");
  assert.equal(p.started, 1);
  await hub.start("fs-1"); // idempotent
  assert.equal(p.started, 1);
  await hub.stop("fs-1");
  assert.equal(p.stopped, 1);
  await assert.rejects(() => hub.start("nope"), /unknown provider/);
});
