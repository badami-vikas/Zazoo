/**
 * Message capture: identity attribution and incremental-sync arithmetic.
 *
 * The identity assertions here are the regression suite for the fabricated-
 * number bug (4,203 of 8,384 contacts on the account measured 2026-08-01). They
 * are deliberately paranoid about the LID space, including the laundered case
 * where LID digits arrive already sitting in a phone-shaped field.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ackOf,
  advanceCursor,
  attachmentOf,
  chatsDueForSync,
  emptySyncState,
  isoFromEpochSeconds,
  mapMessages,
  newMessagesSince,
  readSyncState,
  senderOf,
  sinceFor,
  summarizeSync,
  type RawChatSummary,
  type RawMessage,
} from "../src/messages.js";

/**
 * `exactOptionalPropertyTypes` is on, so a plain `Partial` cannot express
 * "this optional field is explicitly absent" — which is exactly the case
 * several of these tests need to exercise.
 */
type RawOverrides = { [K in keyof RawMessage]?: RawMessage[K] | undefined };

function raw(overrides: RawOverrides = {}): RawMessage {
  return {
    id: "true_919876543210@c.us_3EB0ABC",
    chatId: "919876543210@c.us",
    fromMe: false,
    timestamp: 1_785_600_000,
    body: "hello",
    type: "chat",
    ack: 3,
    ...overrides,
    // The cast is what lets an override erase an optional field. At runtime the
    // key is present and undefined, which is precisely the shape a real read op
    // produces for a message with no author, type, or body.
  } as RawMessage;
}

// ── Identity ────────────────────────────────────────────────────────────────

test("a direct-chat message is attributed to the phone identity of its chat", () => {
  assert.deepEqual(senderOf(raw()), {
    senderKind: "phone",
    senderKey: "whatsapp:+919876543210",
  });
});

test("the owner's own messages are self and carry NO sender key", () => {
  const resolved = senderOf(raw({ fromMe: true }));
  assert.equal(resolved.senderKind, "self");
  assert.equal(resolved.senderKey, undefined);
});

test("a @lid sender becomes a LID key and NEVER a phone number", () => {
  const resolved = senderOf(raw({ chatId: "123456789012345@lid", from: "123456789012345@lid" }));
  assert.equal(resolved.senderKind, "lid");
  assert.equal(resolved.senderKey, "whatsapp-lid:123456789012345@lid");
  assert.ok(!resolved.senderKey?.startsWith("whatsapp:+"));
});

test("a group message is attributed to its author, never to the group", () => {
  const resolved = senderOf(
    raw({ chatId: "120363001234567890@g.us", author: "919876543210@c.us" }),
  );
  assert.deepEqual(resolved, { senderKind: "phone", senderKey: "whatsapp:+919876543210" });
});

test("a group message with no author is unknown — never attributed to the group id", () => {
  const resolved = senderOf(raw({ chatId: "120363001234567890@g.us" }));
  assert.equal(resolved.senderKind, "unknown");
  assert.equal(resolved.senderKey, undefined);
});

test("a LID author in a group stays in the LID space", () => {
  const resolved = senderOf(
    raw({ chatId: "120363001234567890@g.us", author: "987654321098765@lid" }),
  );
  assert.deepEqual(resolved, {
    senderKind: "lid",
    senderKey: "whatsapp-lid:987654321098765@lid",
  });
});

test("LID digits laundered into a phone-shaped id are STILL not a phone number", () => {
  // The exact regression: an upstream layer strips "@lid" and hands on bare
  // digits. Without a suffix there is no evidence of a phone identity, so the
  // only honest answer is "unknown" — not a fabricated +number.
  const resolved = senderOf(raw({ chatId: "123456789012345", from: "123456789012345" }));
  assert.equal(resolved.senderKind, "unknown");
  assert.equal(resolved.senderKey, undefined);
});

test("broadcast and newsletter threads produce no sender identity", () => {
  for (const id of ["status@broadcast", "120363001@newsletter"]) {
    const resolved = senderOf(raw({ chatId: id, from: id }));
    assert.equal(resolved.senderKind, "unknown", id);
    assert.equal(resolved.senderKey, undefined, id);
  }
});

test("every sender key sits in exactly one of the two disjoint spaces", () => {
  const samples = [
    raw(),
    raw({ fromMe: true }),
    raw({ chatId: "123@lid", from: "123@lid" }),
    raw({ chatId: "120363001@g.us" }),
    raw({ chatId: "status@broadcast", from: "status@broadcast" }),
  ];
  for (const sample of samples) {
    const { senderKind, senderKey } = senderOf(sample);
    if (senderKey === undefined) {
      assert.ok(senderKind === "self" || senderKind === "unknown");
      continue;
    }
    const phone = senderKey.startsWith("whatsapp:+");
    const lid = senderKey.startsWith("whatsapp-lid:");
    assert.ok(phone !== lid, `"${senderKey}" must be in exactly one space`);
    assert.equal(senderKind, phone ? "phone" : "lid");
    if (phone) assert.ok(!senderKey.includes("@"), "a phone key must not keep an id suffix");
  }
});

// ── Field mapping ───────────────────────────────────────────────────────────

test("acks map to the modelled set, and anything else is unknown", () => {
  assert.equal(ackOf(-1), "error");
  assert.equal(ackOf(0), "pending");
  assert.equal(ackOf(1), "sent");
  assert.equal(ackOf(2), "delivered");
  assert.equal(ackOf(3), "read");
  assert.equal(ackOf(4), "played");
  assert.equal(ackOf(9), "unknown");
  assert.equal(ackOf(undefined), "unknown");
});

test("plain text carries no attachment", () => {
  assert.equal(attachmentOf(raw({ type: "chat" })), undefined);
  assert.equal(attachmentOf(raw({ type: undefined })), undefined);
});

test("media becomes an attachment DESCRIPTION and never a URL", () => {
  const attachment = attachmentOf(
    raw({ type: "image", mimetype: "image/jpeg", filename: "a.jpg", size: 2048 }),
  );
  assert.deepEqual(attachment, {
    kind: "image",
    mimeType: "image/jpeg",
    fileName: "a.jpg",
    byteSize: 2048,
  });
  assert.ok(!JSON.stringify(attachment).includes("http"));
});

test("a voice note is audio, and an unrecognised type is other", () => {
  assert.equal(attachmentOf(raw({ type: "ptt" }))?.kind, "audio");
  assert.equal(attachmentOf(raw({ type: "poll_creation" }))?.kind, "other");
});

test("epoch seconds convert, and an unusable time is refused rather than invented", () => {
  assert.equal(isoFromEpochSeconds(1_785_600_000), "2026-08-01T16:00:00.000Z");
  assert.equal(isoFromEpochSeconds(0), null);
  assert.equal(isoFromEpochSeconds(-5), null);
  assert.equal(isoFromEpochSeconds(Number.NaN), null);
  assert.equal(isoFromEpochSeconds(undefined), null);
});

test("mapMessages maps a batch and counts what it refused", () => {
  const result = mapMessages([
    raw(),
    raw({ id: "  " }),
    raw({ id: "b", chatId: "" }),
    raw({ id: "c", timestamp: 0 }),
  ]);
  assert.equal(result.messages.length, 1);
  assert.deepEqual(result.skipped, {
    no_message_id: 1,
    no_chat_id: 1,
    unusable_timestamp: 1,
  });
});

test("a media-only message maps to an empty body, not a missing one", () => {
  const [message] = mapMessages([raw({ body: undefined, type: "image" })]).messages;
  assert.equal(message?.body, "");
  assert.equal(message?.attachment?.kind, "image");
});

test("direction follows fromMe", () => {
  assert.equal(mapMessages([raw()]).messages[0]?.direction, "inbound");
  assert.equal(mapMessages([raw({ fromMe: true })]).messages[0]?.direction, "outbound");
});

// ── Incremental sync ────────────────────────────────────────────────────────

test("a chat with no cursor asks for everything the device holds", () => {
  assert.equal(sinceFor(emptySyncState(), "919876543210@c.us"), 0);
});

test("the cursor advances to the newest message actually stored", () => {
  const stored = mapMessages([
    raw({ id: "a", timestamp: 1_785_600_000 }),
    raw({ id: "b", timestamp: 1_785_700_000 }),
  ]).messages;
  const state = advanceCursor(emptySyncState(), "919876543210@c.us", stored, "2026-08-02T00:00:00Z");
  assert.equal(state.chats["919876543210@c.us"]?.newestTimestamp, 1_785_700_000);
  assert.equal(state.chats["919876543210@c.us"]?.oldestTimestamp, 1_785_600_000);
  assert.equal(state.chats["919876543210@c.us"]?.messageCount, 2);
  assert.equal(sinceFor(state, "919876543210@c.us"), 1_785_700_000);
});

test("an empty batch still records that we looked, without moving the watermark", () => {
  const first = advanceCursor(
    emptySyncState(),
    "c",
    mapMessages([raw({ timestamp: 1_785_600_000 })]).messages,
    "2026-08-02T00:00:00Z",
  );
  const second = advanceCursor(first, "c", [], "2026-08-02T01:00:00Z");
  assert.equal(second.chats.c?.newestTimestamp, 1_785_600_000);
  assert.equal(second.chats.c?.syncedAt, "2026-08-02T01:00:00Z");
  assert.equal(second.chats.c?.messageCount, 1);
});

test("advancing one chat leaves every other cursor untouched", () => {
  const base = advanceCursor(emptySyncState(), "a", mapMessages([raw()]).messages, "t0");
  const next = advanceCursor(base, "b", mapMessages([raw({ id: "z" })]).messages, "t1");
  assert.equal(next.chats.a?.syncedAt, "t0");
  assert.equal(next.chats.b?.syncedAt, "t1");
});

test("a re-read that includes the watermark message does not re-store it", () => {
  const messages = mapMessages([
    raw({ id: "a", timestamp: 1_785_600_000 }),
    raw({ id: "b", timestamp: 1_785_700_000 }),
  ]).messages;
  const fresh = newMessagesSince(messages, 1_785_600_000);
  assert.deepEqual(
    fresh.map((message) => message.messageId),
    ["b"],
  );
  assert.equal(newMessagesSince(messages, 0).length, 2);
});

test("chats are due only when activity is strictly newer than their cursor", () => {
  const summaries: RawChatSummary[] = [
    { id: "fresh", isGroup: false, lastMessageTimestamp: 1_785_700_000 },
    { id: "stale", isGroup: false, lastMessageTimestamp: 1_785_600_000 },
    { id: "empty", isGroup: false },
  ];
  const state = advanceCursor(
    emptySyncState(),
    "stale",
    mapMessages([raw({ timestamp: 1_785_600_000 })]).messages,
    "t",
  );
  assert.deepEqual(
    chatsDueForSync(summaries, state).map((chat) => chat.id),
    ["fresh"],
  );
});

test("due chats come back newest-activity first, and the limit is honoured", () => {
  const summaries: RawChatSummary[] = [
    { id: "old", isGroup: false, lastMessageTimestamp: 100 },
    { id: "new", isGroup: false, lastMessageTimestamp: 300 },
    { id: "mid", isGroup: false, lastMessageTimestamp: 200 },
  ];
  const ordered = chatsDueForSync(summaries, emptySyncState());
  assert.deepEqual(
    ordered.map((chat) => chat.id),
    ["new", "mid", "old"],
  );
  assert.deepEqual(
    chatsDueForSync(summaries, emptySyncState(), 2).map((chat) => chat.id),
    ["new", "mid"],
  );
});

test("unrecognised persisted state resets rather than half-trusting a cursor", () => {
  assert.deepEqual(readSyncState(null), emptySyncState());
  assert.deepEqual(readSyncState("nonsense"), emptySyncState());
  assert.deepEqual(readSyncState({ version: 99, chats: {} }), emptySyncState());
  assert.deepEqual(readSyncState({ version: 1 }), emptySyncState());
});

test("a valid persisted state round-trips, and a malformed cursor inside it is dropped", () => {
  const state = advanceCursor(
    emptySyncState(),
    "a",
    mapMessages([raw({ timestamp: 1_785_600_000 })]).messages,
    "t",
  );
  const restored = readSyncState(
    JSON.parse(JSON.stringify({ ...state, chats: { ...state.chats, bad: { chatId: "bad" } } })),
  );
  assert.equal(restored.chats.a?.newestTimestamp, 1_785_600_000);
  assert.equal(restored.chats.bad, undefined);
});

test("the summary reports the real history window it holds", () => {
  let state = advanceCursor(
    emptySyncState(),
    "a",
    mapMessages([
      raw({ id: "1", timestamp: 1_785_600_000 }),
      raw({ id: "2", timestamp: 1_785_700_000 }),
    ]).messages,
    "t",
  );
  state = advanceCursor(
    state,
    "b",
    mapMessages([raw({ id: "3", timestamp: 1_785_500_000 })]).messages,
    "t",
  );
  const progress = summarizeSync(state, [
    { id: "a", isGroup: false, lastMessageTimestamp: 1_785_700_000 },
    { id: "c", isGroup: false, lastMessageTimestamp: 1_785_800_000 },
  ]);
  assert.equal(progress.chatsSynced, 2);
  assert.equal(progress.messagesSynced, 3);
  assert.equal(progress.oldestTimestamp, 1_785_500_000);
  assert.equal(progress.newestTimestamp, 1_785_700_000);
  assert.equal(progress.chatsDue, 1);
});
