/**
 * K7 app-focus capture over the real `buildWiring()` composition root
 * (AI Harness K7, TASK-051) — the contract:
 *
 *  - a focus event captures ONLY when the flight is on AND "apps" consent
 *    is explicitly on; declines are structured verdicts, never errors (the
 *    shell's drain loop is a background caller);
 *  - the report flows through the @bridge/sensors SensorHub: the provider
 *    is capability-manifested (risk computed, not self-declared), every
 *    ingest appends an inspectable capture-ledger entry AND emits the
 *    "sensor.capture" blink DomainEvent, and the learning-loop consumer
 *    writes the ONE durable observed-signal Memory;
 *  - a suppressed window title (no Accessibility grant) stays suppressed —
 *    the Memory row carries appName+bundleId and NO windowTitle attribute;
 *  - the write is idempotent per shell-minted focusId;
 *  - the kill switch silences the lane; an agent identity is refused.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";

const ORG = PILOT_ORGANIZATION;
const AT = "2026-08-12T09:30:00.000Z";

async function appsSignals(wiring: Wiring) {
  const rows = await wiring.memoryStore.retrieve(
    { limit: 200 },
    { organizationId: ORG, userId: PILOT_USER },
  );
  return rows.filter((row) => {
    try {
      const value = JSON.parse(row.content) as { anchor?: { kind?: string; moduleId?: string } };
      return value.anchor?.kind === "observed_signal" && value.anchor.moduleId === "apps";
    } catch {
      return false;
    }
  });
}

function focusInput(focusId: string, overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    focusId,
    appName: "Xcode",
    bundleId: "com.apple.dt.Xcode",
    windowTitle: "bridge — build succeeded",
    focusedAt: AT,
    ...overrides,
  };
}

test("consent OFF: a focus event is declined with a structured verdict and writes nothing", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    const result = await caller.learning.capture.appfocus.focus(
      focusInput("aa7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e"),
    );
    assert.deepEqual(result, { captured: false, verdict: "consent_off" });
    assert.equal((await appsSignals(wiring)).length, 0, "consent off writes nothing");
    // The status the drain loop polls says so honestly.
    const status = await caller.learning.capture.appfocus.status({ organizationId: ORG });
    assert.deepEqual(status, { enabled: true, capturing: false, paused: false });
  } finally {
    await wiring.close();
  }
});

test("consented focus → hub capture contract: signal Memory + ledger entry + blink DomainEvent + computed-risk manifest", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const blinkCount = () =>
      wiring.events.events.filter((event) => event.type === "sensor.capture").length;
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "apps", enabled: true });

    const captured = await caller.learning.capture.appfocus.focus(
      focusInput("bb7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e"),
    );
    assert.deepEqual(captured, { captured: true, verdict: "captured" });

    // ONE durable observed-signal Memory, appName + bundleId + windowTitle.
    const signals = await appsSignals(wiring);
    assert.equal(signals.length, 1);
    const value = JSON.parse(signals[0]!.content) as {
      recordKind: string;
      attributes: Record<string, unknown>;
    };
    assert.equal(value.recordKind, "focus");
    assert.equal(value.attributes.appName, "Xcode");
    assert.equal(value.attributes.bundleId, "com.apple.dt.Xcode");
    assert.equal(value.attributes.windowTitle, "bridge — build succeeded");

    // The hub's side of the contract: inspectable ledger entry + blink tell.
    const entries = await wiring.appFocusSensor.ledger.list(ORG);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.type, "capture.apps");
    assert.equal(entries[0]!.content, "Focused Xcode — bridge — build succeeded");
    assert.equal(blinkCount(), 1, "every ingest emits the sensor.capture blink tell");

    // The provider is a registered capability with COMPUTED risk: a
    // read-only context provider computes to informational. Addressed by
    // the (organization, name, version) natural key — the row id is a UUID
    // on the durable store; the logical id lives in the manifest JSON.
    const manifest = await wiring.capabilityStore.getManifestByNameVersion(
      ORG,
      "Context provider: apps (desktop-apps)",
      "0.1.0",
    );
    assert.ok(manifest, "the provider registration wrote a capability manifest");
    assert.equal(manifest.computedRisk, "informational");
    assert.equal((manifest.manifest as { id?: string }).id, "ctx-provider:desktop-apps");
  } finally {
    await wiring.close();
  }
});

test("a suppressed window title stays suppressed: no windowTitle attribute, redaction recorded", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "apps", enabled: true });
    const captured = await caller.learning.capture.appfocus.focus(
      focusInput("cc7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e", { windowTitle: null, appName: "Mail", bundleId: "com.apple.mail" }),
    );
    assert.deepEqual(captured, { captured: true, verdict: "captured" });
    const signals = await appsSignals(wiring);
    assert.equal(signals.length, 1);
    const value = JSON.parse(signals[0]!.content) as { attributes: Record<string, unknown> };
    assert.deepEqual(Object.keys(value.attributes).sort(), ["appName", "bundleId", "timeOfDay"]);
    const entries = await wiring.appFocusSensor.ledger.list(ORG);
    assert.deepEqual(entries[0]!.redactions, ["window title suppressed: Accessibility not granted"]);
    assert.equal(entries[0]!.content, "Focused Mail");
  } finally {
    await wiring.close();
  }
});

test("idempotent per focusId: a re-drained report writes nothing twice and blinks nothing twice", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const blinkCount = () =>
      wiring.events.events.filter((event) => event.type === "sensor.capture").length;
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "apps", enabled: true });
    const id = "dd7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e";
    assert.deepEqual(await caller.learning.capture.appfocus.focus(focusInput(id)), {
      captured: true,
      verdict: "captured",
    });
    assert.deepEqual(await caller.learning.capture.appfocus.focus(focusInput(id)), {
      captured: false,
      verdict: "duplicate",
    });
    assert.equal((await appsSignals(wiring)).length, 1);
    assert.equal((await wiring.appFocusSensor.ledger.list(ORG)).length, 1);
    assert.equal(blinkCount(), 1);
  } finally {
    await wiring.close();
  }
});

test("the kill switch silences the lane and the status says so; lifting it restores capture", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "apps", enabled: true });
    await caller.learning.capture.setPaused({ organizationId: ORG, paused: true });

    const declined = await caller.learning.capture.appfocus.focus(
      focusInput("ee7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e"),
    );
    assert.deepEqual(declined, { captured: false, verdict: "consent_off" });
    assert.equal((await appsSignals(wiring)).length, 0, "paused writes nothing");
    const paused = await caller.learning.capture.appfocus.status({ organizationId: ORG });
    assert.deepEqual(paused, { enabled: true, capturing: false, paused: true });

    await caller.learning.capture.setPaused({ organizationId: ORG, paused: false });
    const restored = await caller.learning.capture.appfocus.focus(
      focusInput("ff7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e"),
    );
    assert.deepEqual(restored, { captured: true, verdict: "captured" });
  } finally {
    await wiring.close();
  }
});

test("an agent identity is refused; whitespace-only names are malformed; the flight off fails closed", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "apps", enabled: true });

    const agent = makeCaller(wiring, { type: "agent", id: PILOT_USER });
    await assert.rejects(
      agent.learning.capture.appfocus.focus(focusInput("0a7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e")),
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
    );

    const malformed = await caller.learning.capture.appfocus.focus(
      focusInput("1a7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e", { appName: "   " }),
    );
    assert.deepEqual(malformed, { captured: false, verdict: "malformed" });
    assert.equal((await appsSignals(wiring)).length, 0);
  } finally {
    await wiring.close();
  }

  const flightOff = await buildWiring({ learningObservationEnabled: false });
  try {
    const caller = makeCaller(flightOff);
    await assert.rejects(
      caller.learning.capture.appfocus.focus(focusInput("2a7c1a52-4a7e-4a3e-9b2f-3d1a2b3c4d5e")),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
    const status = await caller.learning.capture.appfocus.status({ organizationId: ORG });
    assert.deepEqual(status, { enabled: false, capturing: false, paused: false });
  } finally {
    await flightOff.close();
  }
});
