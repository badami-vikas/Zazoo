/**
 * K2+K5 capture consent + source emitters (AI Harness K2/K5) — the contract:
 * every source defaults OFF and the parse fails CLOSED; the kill switch
 * trumps per-source consent without rewriting it; consent to one source
 * says nothing about another; the chat mapper refuses cloud-plane turns;
 * the WhatsApp mapper refuses inbound messages; message text is
 * structurally inexpressible to both K2 mappers. K5 adds the "google"
 * source and its two mappers: approved Gmail threads and Calendar events
 * become metadata-only signals (sender/subject/time; summary/attendees/
 * time) whose envelopes cannot express snippet, body, or description.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPTURE_SOURCES,
  captureAllowed,
  defaultCaptureConsent,
  isCaptureSource,
  readCaptureConsent,
  withCapturePaused,
  withSourceConsent,
} from "../src/learning/capture-consent.js";
import {
  calendarEventCaptureSignal,
  chatTurnCaptureSignal,
  gmailThreadCaptureSignal,
  timeOfDayBucket,
  whatsAppMessageCaptureSignal,
  type CalendarEventCaptureEnvelope,
  type ChatTurnCaptureEnvelope,
  type GmailThreadCaptureEnvelope,
  type WhatsAppMessageCaptureEnvelope,
} from "../src/learning/source-emitters.js";

const SCOPE = { organizationId: "org-1", userId: "user-1" };
const AT = "2026-08-09T09:30:00.000Z";

test("every source defaults OFF: the fresh state emits nothing anywhere", () => {
  const state = defaultCaptureConsent();
  assert.equal(state.paused, false);
  for (const source of CAPTURE_SOURCES) {
    assert.equal(state.sources[source].enabled, false, `${source} must default off`);
    assert.equal(captureAllowed(state, source), false, `${source} must not be allowed by default`);
    assert.equal(state.sources[source].changedAt, null);
    assert.equal(state.sources[source].changedBy, null);
  }
});

test("readCaptureConsent fails CLOSED on every malformed shape", () => {
  const cases: unknown[] = [
    null,
    undefined,
    "enabled",
    42,
    [],
    {},
    { sources: null },
    { sources: "all" },
    // Non-boolean enabled values must never read as on.
    { sources: { chat: { enabled: "true" } } },
    { sources: { chat: { enabled: 1 } } },
    { sources: { chat: {} } },
  ];
  for (const value of cases) {
    const state = readCaptureConsent(value);
    for (const source of CAPTURE_SOURCES) {
      assert.equal(
        captureAllowed(state, source),
        false,
        `${JSON.stringify(value)} must read as OFF for ${source}`,
      );
    }
  }
});

test("readCaptureConsent round-trips a well-formed state and drops unknown source keys", () => {
  const written = withSourceConsent(defaultCaptureConsent(), "chat", true, "user-1", AT);
  const read = readCaptureConsent(JSON.parse(JSON.stringify(written)));
  assert.equal(captureAllowed(read, "chat"), true);
  assert.equal(captureAllowed(read, "whatsapp"), false);
  assert.equal(read.sources.chat.changedAt, AT);
  assert.equal(read.sources.chat.changedBy, "user-1");

  // A key from a build this one does not know is dropped, not carried.
  const withUnknown = {
    ...JSON.parse(JSON.stringify(written)),
    sources: {
      ...JSON.parse(JSON.stringify(written)).sources,
      microphone: { enabled: true, changedAt: AT, changedBy: "user-1" },
    },
  };
  const reread = readCaptureConsent(withUnknown);
  assert.deepEqual(Object.keys(reread.sources).sort(), [...CAPTURE_SOURCES].sort());
  assert.equal(isCaptureSource("microphone"), false);
});

test("consent is per-source: enabling chat says nothing about whatsapp, and vice versa", () => {
  const chatOn = withSourceConsent(defaultCaptureConsent(), "chat", true, "user-1", AT);
  assert.equal(captureAllowed(chatOn, "chat"), true);
  assert.equal(captureAllowed(chatOn, "whatsapp"), false);
  const bothOn = withSourceConsent(chatOn, "whatsapp", true, "user-1", AT);
  const chatOffAgain = withSourceConsent(bothOn, "chat", false, "user-1", AT);
  assert.equal(captureAllowed(chatOffAgain, "chat"), false);
  assert.equal(captureAllowed(chatOffAgain, "whatsapp"), true);
});

test("the kill switch trumps consent and restores it unchanged when lifted", () => {
  const enabled = withSourceConsent(defaultCaptureConsent(), "whatsapp", true, "user-1", AT);
  const paused = withCapturePaused(enabled, true, "user-1", AT);
  for (const source of CAPTURE_SOURCES) {
    assert.equal(captureAllowed(paused, source), false, `${source} must be silenced by pause`);
  }
  // Pause is a circuit breaker, not a consent rewrite: the per-source
  // choices survive it verbatim.
  assert.equal(paused.sources.whatsapp.enabled, true);
  const resumed = withCapturePaused(paused, false, "user-1", "2026-08-09T10:00:00.000Z");
  assert.equal(captureAllowed(resumed, "whatsapp"), true);
  assert.equal(captureAllowed(resumed, "chat"), false);
  assert.equal(resumed.pausedChangedBy, "user-1");
});

test("timeOfDayBucket: four coarse buckets over the whole day, no gaps", () => {
  assert.equal(timeOfDayBucket(AT, 5), "morning");
  assert.equal(timeOfDayBucket(AT, 11), "morning");
  assert.equal(timeOfDayBucket(AT, 12), "afternoon");
  assert.equal(timeOfDayBucket(AT, 16), "afternoon");
  assert.equal(timeOfDayBucket(AT, 17), "evening");
  assert.equal(timeOfDayBucket(AT, 21), "evening");
  assert.equal(timeOfDayBucket(AT, 22), "night");
  assert.equal(timeOfDayBucket(AT, 4), "night");
  for (let hour = 0; hour < 24; hour += 1) {
    assert.ok(
      ["morning", "afternoon", "evening", "night"].includes(timeOfDayBucket(AT, hour)),
      `hour ${hour} must land in a bucket`,
    );
  }
});

test("chat mapper: a local user turn becomes an envelope-only signal; a cloud turn becomes nothing", () => {
  const envelope: ChatTurnCaptureEnvelope = {
    turnId: "turn-1",
    threadId: "thread-1",
    plane: "local",
    surface: "web",
    sentAt: AT,
  };
  const signal = chatTurnCaptureSignal(envelope, SCOPE, "signal-1");
  assert.ok(signal);
  assert.equal(signal.moduleId, "chat");
  assert.equal(signal.recordKind, "turn");
  assert.equal(signal.recordId, "turn-1");
  assert.equal(signal.action, "converse");
  assert.deepEqual(Object.keys(signal.attributes).sort(), ["surface", "timeOfDay"]);
  assert.equal(signal.attributes["surface"], "web");
  assert.equal(signal.observedAt, AT);

  // The Local-Plane boundary is checked in the MAPPER, before any consent
  // question: a cloud thread's turn cannot become a capture signal at all.
  assert.equal(chatTurnCaptureSignal({ ...envelope, plane: "cloud" }, SCOPE, "signal-2"), null);
});

test("whatsapp mapper: outbound becomes an envelope-only signal; inbound — someone else's act — becomes nothing", () => {
  const envelope: WhatsAppMessageCaptureEnvelope = {
    messageId: "msg-1",
    chatId: "123@g.us",
    direction: "outbound",
    isGroup: true,
    sentAt: AT,
    capturedAt: "2026-08-09T09:31:00.000Z",
  };
  const signal = whatsAppMessageCaptureSignal(envelope, SCOPE, "signal-3");
  assert.ok(signal);
  assert.equal(signal.moduleId, "whatsapp");
  assert.equal(signal.recordKind, "message");
  assert.equal(signal.recordId, "msg-1");
  assert.equal(signal.action, "send");
  assert.deepEqual(Object.keys(signal.attributes).sort(), ["chatKind", "timeOfDay"]);
  assert.equal(signal.attributes["chatKind"], "group");
  assert.equal(signal.observedAt, AT);
  assert.equal(
    whatsAppMessageCaptureSignal({ ...envelope, isGroup: false }, SCOPE, "signal-4")?.attributes["chatKind"],
    "direct",
  );

  assert.equal(
    whatsAppMessageCaptureSignal({ ...envelope, direction: "inbound" }, SCOPE, "signal-5"),
    null,
  );

  // A message the source gave no sent time falls back to capture time.
  const uncertain = whatsAppMessageCaptureSignal(
    { ...envelope, sentAt: null },
    SCOPE,
    "signal-6",
  );
  assert.equal(uncertain?.observedAt, "2026-08-09T09:31:00.000Z");
});

test("message text is structurally inexpressible: neither envelope type admits a content/body field", () => {
  // Compile-time in spirit, runtime in practice: build the fullest possible
  // envelopes and assert the produced signals carry ONLY envelope facts.
  const chatSignal = chatTurnCaptureSignal(
    { turnId: "t", threadId: "th", plane: "local", surface: "web", sentAt: AT },
    SCOPE,
    "s-1",
  );
  const waSignal = whatsAppMessageCaptureSignal(
    { messageId: "m", chatId: "c", direction: "outbound", isGroup: false, sentAt: AT, capturedAt: AT },
    SCOPE,
    "s-2",
  );
  const SECRET = "XYZZY-the-message-text";
  for (const signal of [chatSignal, waSignal]) {
    assert.ok(signal);
    assert.ok(
      !JSON.stringify(signal).includes(SECRET),
      "no signal field can carry message text",
    );
    // The only free-text-capable field on ObservedSignal stays absent.
    assert.equal(signal.reason, undefined);
  }
});

// ── K5: the "google" source (TASK-049) ──────────────────────────────────────

test("K5: 'google' is a consent source that defaults OFF like every other", () => {
  assert.ok(isCaptureSource("google"));
  const state = defaultCaptureConsent();
  assert.equal(captureAllowed(state, "google"), false);
  // Enabling google says nothing about the K2 sources, and vice versa.
  const googleOn = withSourceConsent(state, "google", true, "user-1", AT);
  assert.equal(captureAllowed(googleOn, "google"), true);
  assert.equal(captureAllowed(googleOn, "chat"), false);
  assert.equal(captureAllowed(googleOn, "whatsapp"), false);
  assert.equal(captureAllowed(withCapturePaused(googleOn, true, "user-1", AT), "google"), false);
});

test("gmail mapper: an approved thread becomes a sender/subject/time metadata signal", () => {
  const envelope: GmailThreadCaptureEnvelope = {
    threadId: "thread-9",
    subject: "Re: partnership terms",
    counterpartyEmail: "founder@example.com",
    lastMessageAt: AT,
  };
  const signal = gmailThreadCaptureSignal(envelope, SCOPE, "signal-g1");
  assert.ok(signal);
  assert.equal(signal.moduleId, "google");
  assert.equal(signal.recordKind, "thread");
  assert.equal(signal.recordId, "thread-9");
  assert.equal(signal.action, "email");
  assert.deepEqual(Object.keys(signal.attributes).sort(), ["counterparty", "subject", "timeOfDay"]);
  assert.equal(signal.attributes["counterparty"], "founder@example.com");
  assert.equal(signal.attributes["subject"], "Re: partnership terms");
  assert.equal(signal.observedAt, AT);

  // A thread with no counterparty still signals — the key is just absent.
  const solo = gmailThreadCaptureSignal({ ...envelope, counterpartyEmail: null }, SCOPE, "signal-g2");
  assert.deepEqual(Object.keys(solo!.attributes).sort(), ["subject", "timeOfDay"]);
});

test("calendar mapper: an approved event becomes a summary/attendees/time metadata signal", () => {
  const envelope: CalendarEventCaptureEnvelope = {
    eventId: "evt-9",
    summary: "Quarterly review",
    startsAt: AT,
    attendeeEmails: ["founder@example.com", "self@example.com"],
  };
  const signal = calendarEventCaptureSignal(envelope, SCOPE, "signal-c1");
  assert.ok(signal);
  assert.equal(signal.moduleId, "google");
  assert.equal(signal.recordKind, "event");
  assert.equal(signal.recordId, "evt-9");
  assert.equal(signal.action, "meet");
  assert.deepEqual(Object.keys(signal.attributes).sort(), ["attendees", "summary", "timeOfDay"]);
  assert.equal(signal.attributes["attendees"], "founder@example.com, self@example.com");
  assert.equal(signal.observedAt, AT);

  // No invitees → the attendees key is absent, never an empty string.
  const empty = calendarEventCaptureSignal({ ...envelope, attendeeEmails: [] }, SCOPE, "signal-c2");
  assert.deepEqual(Object.keys(empty!.attributes).sort(), ["summary", "timeOfDay"]);
});

test("google content is structurally inexpressible: no envelope admits snippet/body/description", () => {
  const SECRET = "XYZZY-the-thread-body-or-event-description";
  const gmail = gmailThreadCaptureSignal(
    { threadId: "t", subject: "s", counterpartyEmail: "a@b.c", lastMessageAt: AT },
    SCOPE,
    "s-3",
  );
  const calendar = calendarEventCaptureSignal(
    { eventId: "e", summary: "s", startsAt: AT, attendeeEmails: ["a@b.c"] },
    SCOPE,
    "s-4",
  );
  for (const signal of [gmail, calendar]) {
    assert.ok(signal);
    assert.ok(!JSON.stringify(signal).includes(SECRET));
    assert.equal(signal.reason, undefined);
  }
});
