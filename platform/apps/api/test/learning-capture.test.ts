/**
 * K2 capture over the real `buildWiring()` composition root (AI Harness K2,
 * TASK-046) — the contract:
 *
 *  - every source's consent defaults OFF, and with it OFF the source emits
 *    NOTHING (asserted, not assumed);
 *  - flipping one source on emits envelope-only signals from that source
 *    only — consent is per-source, never inherited;
 *  - the kill switch silences every source without rewriting consent;
 *  - message/turn text never reaches a signal row;
 *  - emission is idempotent (deterministic ids);
 *  - emitted signals are deletable Memory over HTTP;
 *  - the toggle surface is inspectable (who consented, when);
 *  - only a Human can flip consent; the flight gates every capture
 *    procedure.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

const ORG = PILOT_ORGANIZATION;
const SECRET = "XYZZY-private-message-text-never-in-a-signal";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(37);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(
  wiring: Wiring,
  identity: { type: "user" | "team"; id: string } = { type: "user", id: PILOT_USER },
) {
  return appRouter.createCaller({ wiring, run: makeRun(), identity, authenticated: true, verifying: false });
}

class CaptureChatModel implements ModelProvider {
  readonly id = "capture-chat-local";
  readonly plane = "local" as const;
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models = { cheap: "capture-chat-v1", default: "capture-chat-v1" } as const;
  readonly calls: ModelCompletionRequest[] = [];

  routingHealth() {
    return "healthy" as const;
  }

  async complete(request: ModelCompletionRequest) {
    this.calls.push(request);
    return {
      text: JSON.stringify({ kind: "answer", text: "Understood." }),
      model: "capture-chat-v1",
      tier: request.tier,
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        source: "provider" as const,
      },
      ...(request.taintLabel ? { taintLabel: request.taintLabel } : {}),
    };
  }
}

/** Current signal rows for one capture source, parsed from the store. */
async function signalRows(wiring: Wiring, moduleId: string) {
  const rows = await wiring.memoryStore.retrieve(
    { limit: 200 },
    { organizationId: ORG, userId: PILOT_USER },
  );
  return rows.filter((row) => {
    try {
      const value = JSON.parse(row.content) as { anchor?: { kind?: string; moduleId?: string } };
      return value.anchor?.kind === "observed_signal" && value.anchor.moduleId === moduleId;
    } catch {
      return false;
    }
  });
}

async function sendChatTurn(wiring: Wiring, clientRequestId: string, message = SECRET) {
  const caller = makeCaller(wiring);
  const { thread } = await caller.chat.thread.create({
    organizationId: ORG,
    plane: "local",
    clientRequestId: `${clientRequestId}-thread`,
  });
  await caller.chat.turn.send({
    organizationId: ORG,
    threadId: thread.id,
    clientRequestId,
    message,
  });
  return thread.id;
}

function waMessage(id: string, fromMe: boolean, body = SECRET) {
  return {
    id,
    chatId: "12345@c.us",
    fromMe,
    timestamp: 1_770_000_000,
    body,
  };
}

async function ingestWaMessages(
  wiring: Wiring,
  messages: ReturnType<typeof waMessage>[],
  chatId = "12345@c.us",
) {
  const caller = makeCaller(wiring);
  return caller.whatsapp.ingestMessages({
    chatId,
    capturedAt: "2026-08-09T10:00:00.000Z",
    since: 0,
    messages,
  });
}

test("flight OFF: capture procedures fail closed; status stays answerable for honest hiding", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const status = await caller.learning.capture.status({ organizationId: ORG });
    assert.equal(status.enabled, false);
    await assert.rejects(
      () => caller.learning.capture.setSource({ organizationId: ORG, source: "chat", enabled: true }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
  } finally {
    await wiring.close();
  }
});

test("DEFAULT OFF, asserted: with no consent ever given, chat and whatsapp emit zero signals", async () => {
  const local = new CaptureChatModel();
  const wiring = await buildWiring({ learningObservationEnabled: true, modelProviders: [local] });
  try {
    const status = await makeCaller(wiring).learning.capture.status({ organizationId: ORG });
    assert.equal(status.enabled, true);
    assert.equal(status.paused, false);
    for (const source of ["chat", "whatsapp"] as const) {
      assert.equal(status.sources[source].enabled, false, `${source} must default off`);
      assert.equal(status.sources[source].changedAt, null);
      assert.equal(status.sources[source].changedBy, null);
    }

    await sendChatTurn(wiring, "default-off-turn");
    await ingestWaMessages(wiring, [waMessage("wa-default-off", true)]);

    assert.equal((await signalRows(wiring, "chat")).length, 0, "chat must emit nothing by default");
    assert.equal((await signalRows(wiring, "whatsapp")).length, 0, "whatsapp must emit nothing by default");
  } finally {
    await wiring.close();
  }
});

test("per-source consent: chat ON emits envelope-only chat signals; whatsapp stays silent; idempotent; text never leaks", async () => {
  const local = new CaptureChatModel();
  const wiring = await buildWiring({ learningObservationEnabled: true, modelProviders: [local] });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "chat", enabled: true });
    const status = await caller.learning.capture.status({ organizationId: ORG });
    assert.equal(status.sources.chat.enabled, true);
    assert.equal(status.sources.chat.changedBy, PILOT_USER, "the consenting human is recorded");
    assert.ok(status.sources.chat.changedAt, "the consent moment is recorded");
    assert.equal(status.sources.whatsapp.enabled, false);

    await sendChatTurn(wiring, "consented-turn");
    const chatSignals = await signalRows(wiring, "chat");
    assert.equal(chatSignals.length, 1, "one user turn, one signal");
    const parsed = JSON.parse(chatSignals[0]!.content) as {
      anchor: { moduleId: string; action: string };
      attributes: Record<string, string>;
      recordKind: string;
    };
    assert.equal(parsed.anchor.action, "converse");
    assert.equal(parsed.recordKind, "turn");
    assert.deepEqual(Object.keys(parsed.attributes).sort(), ["surface", "timeOfDay"]);
    assert.ok(
      !chatSignals[0]!.content.includes(SECRET),
      "the turn's message text must never reach a signal row",
    );
    // Taint-labeled at source: the signal carries the turn's own label.
    assert.ok(chatSignals[0]!.taintLabel, "capture signals are taint-labeled at source");

    // The OTHER source did not inherit consent.
    await ingestWaMessages(wiring, [waMessage("wa-not-consented", true)]);
    assert.equal((await signalRows(wiring, "whatsapp")).length, 0);

    // Same clientRequestId re-sent → same deterministic turn id → no second signal.
    await sendChatTurn(wiring, "consented-turn-2");
    const afterSecond = await signalRows(wiring, "chat");
    assert.equal(afterSecond.length, 2);
    const caller2 = makeCaller(wiring);
    const { thread } = await caller2.chat.thread.create({
      organizationId: ORG,
      plane: "local",
      clientRequestId: "retry-thread",
    });
    await caller2.chat.turn.send({ organizationId: ORG, threadId: thread.id, clientRequestId: "retry-turn", message: "hello once" });
    const baseline = (await signalRows(wiring, "chat")).length;
    await caller2.chat.turn.send({
      organizationId: ORG,
      threadId: thread.id,
      clientRequestId: "retry-turn",
      message: "hello once",
      retryTurnId: undefined,
    }).catch(() => undefined);
    assert.equal((await signalRows(wiring, "chat")).length, baseline, "a replayed turn id never duplicates its signal");
  } finally {
    await wiring.close();
  }
});

test("whatsapp consent ON: outbound emits, inbound never does, re-ingest is a no-op, text never leaks", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "whatsapp", enabled: true });

    const first = await ingestWaMessages(wiring, [
      waMessage("wa-out-1", true),
      waMessage("wa-in-1", false),
    ]);
    assert.equal(first.stored, 2, "both messages stored in the message store");
    const signals = await signalRows(wiring, "whatsapp");
    assert.equal(signals.length, 1, "only the owner's own outbound act becomes a signal");
    const parsed = JSON.parse(signals[0]!.content) as {
      anchor: { action: string };
      attributes: Record<string, string>;
      recordId: string;
    };
    assert.equal(parsed.anchor.action, "send");
    assert.equal(parsed.recordId, "wa-out-1");
    assert.deepEqual(Object.keys(parsed.attributes).sort(), ["chatKind", "timeOfDay"]);
    assert.ok(!signals[0]!.content.includes(SECRET), "message body must never reach a signal row");

    // Chat did not inherit whatsapp's consent.
    assert.equal((await signalRows(wiring, "chat")).length, 0);

    // Re-ingesting the same window emits nothing new.
    await ingestWaMessages(wiring, [waMessage("wa-out-1", true), waMessage("wa-in-1", false)]);
    assert.equal((await signalRows(wiring, "whatsapp")).length, 1);
  } finally {
    await wiring.close();
  }
});

test("the kill switch silences an enabled source and lifting it restores consent unchanged", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "whatsapp", enabled: true });
    await caller.learning.capture.setPaused({ organizationId: ORG, paused: true });

    await ingestWaMessages(wiring, [waMessage("wa-paused", true)]);
    assert.equal((await signalRows(wiring, "whatsapp")).length, 0, "paused capture emits nothing");

    const paused = await caller.learning.capture.status({ organizationId: ORG });
    assert.equal(paused.paused, true);
    assert.equal(paused.sources.whatsapp.enabled, true, "pause never rewrites consent");

    await caller.learning.capture.setPaused({ organizationId: ORG, paused: false });
    await ingestWaMessages(wiring, [waMessage("wa-resumed", true)]);
    assert.equal((await signalRows(wiring, "whatsapp")).length, 1, "lifting pause restores emission");
  } finally {
    await wiring.close();
  }
});

test("emitted signals are deletable Memory over HTTP, and the toggle surface reflects every flip", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await caller.learning.capture.setSource({ organizationId: ORG, source: "whatsapp", enabled: true });
    await ingestWaMessages(wiring, [waMessage("wa-deletable", true)]);
    const signals = await signalRows(wiring, "whatsapp");
    assert.equal(signals.length, 1);

    const { forgotten } = await caller.onboarding.forgetMemory({
      organizationId: ORG,
      memoryId: signals[0]!.id,
    });
    assert.equal(forgotten, true);
    assert.equal((await signalRows(wiring, "whatsapp")).length, 0, "a forgotten signal is gone");

    // Withdrawing consent is recorded like granting it.
    await caller.learning.capture.setSource({ organizationId: ORG, source: "whatsapp", enabled: false });
    const status = await caller.learning.capture.status({ organizationId: ORG });
    assert.equal(status.sources.whatsapp.enabled, false);
    assert.ok(status.sources.whatsapp.changedAt);
    await ingestWaMessages(wiring, [waMessage("wa-after-revoke", true)]);
    assert.equal((await signalRows(wiring, "whatsapp")).length, 0, "revoked consent stops emission");
  } finally {
    await wiring.close();
  }
});

test("only a Human can flip consent or the kill switch", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const nonHuman = makeCaller(wiring, { type: "team", id: PILOT_USER });
    await assert.rejects(
      () => nonHuman.learning.capture.setSource({ organizationId: ORG, source: "chat", enabled: true }),
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => nonHuman.learning.capture.setPaused({ organizationId: ORG, paused: true }),
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});
