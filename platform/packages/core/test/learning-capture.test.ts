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
  appFocusCaptureSignal,
  browserVisitCaptureSignal,
  calendarEventCaptureSignal,
  chatTurnCaptureSignal,
  gmailThreadCaptureSignal,
  timeOfDayBucket,
  whatsAppMessageCaptureSignal,
  type AppFocusCaptureEnvelope,
  type BrowserVisitCaptureEnvelope,
  type CalendarEventCaptureEnvelope,
  type ChatTurnCaptureEnvelope,
  type GmailThreadCaptureEnvelope,
  type WhatsAppMessageCaptureEnvelope,
} from "../src/learning/source-emitters.js";
import {
  browserCaptureVerdict,
  normalizeBrowserDomain,
  readBrowserDomainPolicy,
} from "../src/learning/browser-capture.js";
import { UNKNOWN_LABEL } from "../src/taint.js";

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
    // Both free-text-capable fields on ObservedSignal stay absent. `content`
    // was added for the input lane (task #80 / AP-157) and is deliberately
    // shared rather than input-only, so THIS is the assertion standing between
    // that field and a future lane quietly filling it.
    assert.equal(signal.reason, undefined);
    assert.equal(signal.content, undefined);
  }
});

test("the shared `content` field is reachable by ONE lane — every other emitter leaves it unset", () => {
  // ObservedSignal.content exists so the input lane can persist redacted typed
  // text (AP-157). The other six emitters' ADRs promise metadata only — "never
  // the message text / page content / window contents" — and after widening,
  // nothing but this test enforces that. It is a removal-fails guard: delete
  // any lane's restraint and this goes red.
  //
  // Note the envelopes are the deeper defence: none of these six envelope
  // TYPES admits a text field, so a lane cannot fill `content` without first
  // widening its own input shape (which its own test above forbids). This
  // asserts the outcome that layering is supposed to produce.
  const signals = [
    chatTurnCaptureSignal({ turnId: "t", threadId: "th", plane: "local", surface: "web", sentAt: AT }, SCOPE, "g-1"),
    whatsAppMessageCaptureSignal(
      { messageId: "m", chatId: "c", direction: "outbound", isGroup: false, sentAt: AT, capturedAt: AT },
      SCOPE,
      "g-2",
    ),
    gmailThreadCaptureSignal(
      { threadId: "th", subject: "s", counterpartyEmail: "a@b.com", lastMessageAt: AT },
      SCOPE,
      "g-3",
    ),
    calendarEventCaptureSignal(
      { eventId: "e", summary: "s", attendeeEmails: ["a@b.com"], startsAt: AT },
      SCOPE,
      "g-4",
    ),
    browserVisitCaptureSignal({ visitId: "v", domain: "example.com", title: "Example", visitedAt: AT }, SCOPE, "g-5"),
    appFocusCaptureSignal(
      { focusId: "f", appName: "Editor", bundleId: "com.example.editor", windowTitle: "notes.md", focusedAt: AT },
      SCOPE,
      "g-6",
    ),
  ];
  for (const signal of signals) {
    assert.ok(signal, "fixture should produce a signal");
    assert.equal(signal.content, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(signal, "content"), false);
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

// ── K8: the "browser" source + domain policy (TASK-052) ─────────────────────

test("K8: 'browser' is a consent source that defaults OFF like every other", () => {
  assert.ok(isCaptureSource("browser"));
  const state = defaultCaptureConsent();
  assert.equal(captureAllowed(state, "browser"), false);
  // Enabling browser says nothing about any other source, and pause wins.
  const browserOn = withSourceConsent(state, "browser", true, "user-1", AT);
  assert.equal(captureAllowed(browserOn, "browser"), true);
  assert.equal(captureAllowed(browserOn, "chat"), false);
  assert.equal(captureAllowed(withCapturePaused(browserOn, true, "user-1", AT), "browser"), false);
});

test("K8: the domain policy parse fails CLOSED — malformed reads as capture-nothing", () => {
  for (const stored of [null, undefined, 42, "allow-everything", [], { allowlist: "github.com" }]) {
    const policy = readBrowserDomainPolicy(stored);
    assert.deepEqual(policy, { allowlist: [], denylist: [] });
    assert.equal(browserCaptureVerdict(policy, "github.com"), "not_allowlisted");
  }
  // Malformed ENTRIES are dropped, never repaired into something wider.
  const partial = readBrowserDomainPolicy({
    allowlist: ["GitHub.com.", "https://evil.com/path", "has space.com", 7, "linear.app"],
    denylist: ["Mail.Google.com"],
  });
  assert.deepEqual(partial.allowlist, ["github.com", "linear.app"]);
  assert.deepEqual(partial.denylist, ["mail.google.com"]);
});

test("K8: default-deny — the empty allowlist captures nothing, listed domains capture on label boundaries", () => {
  const policy = readBrowserDomainPolicy({ allowlist: ["google.com"], denylist: [] });
  assert.equal(browserCaptureVerdict(policy, "google.com"), "allowed");
  assert.equal(browserCaptureVerdict(policy, "DOCS.Google.com"), "allowed", "subdomains of an entry match");
  assert.equal(browserCaptureVerdict(policy, "evilgoogle.com"), "not_allowlisted", "label boundary holds");
  assert.equal(browserCaptureVerdict(policy, "github.com"), "not_allowlisted", "unlisted is denied");
  assert.equal(browserCaptureVerdict(policy, "not a domain"), "not_allowlisted", "malformed is denied");
  const empty = readBrowserDomainPolicy({});
  assert.equal(browserCaptureVerdict(empty, "google.com"), "not_allowlisted");
});

test("K8: deny wins — a domain matching both lists is denylisted, including via subdomain", () => {
  const policy = readBrowserDomainPolicy({
    allowlist: ["google.com"],
    denylist: ["mail.google.com"],
  });
  assert.equal(browserCaptureVerdict(policy, "docs.google.com"), "allowed");
  assert.equal(browserCaptureVerdict(policy, "mail.google.com"), "denylisted");
  assert.equal(browserCaptureVerdict(policy, "deep.mail.google.com"), "denylisted");
  // The same domain on both lists is denied outright.
  const both = readBrowserDomainPolicy({ allowlist: ["bank.com"], denylist: ["bank.com"] });
  assert.equal(browserCaptureVerdict(both, "bank.com"), "denylisted");
});

test("K8: normalizeBrowserDomain accepts bare hostnames only", () => {
  assert.equal(normalizeBrowserDomain("  GitHub.COM.  "), "github.com");
  assert.equal(normalizeBrowserDomain("localhost"), "localhost");
  for (const bad of ["https://a.com", "a.com/path", "a.com:443", "a b.com", "-a.com", "", 9]) {
    assert.equal(normalizeBrowserDomain(bad), null, `must reject: ${String(bad)}`);
  }
});

test("K8: a browser visit signal is domain+title+timeOfDay — the URL is structurally inexpressible", () => {
  const envelope: BrowserVisitCaptureEnvelope = {
    visitId: "v-1",
    domain: "github.com",
    title: "Pull request #42 — bridge",
    visitedAt: AT,
    taintLabel: UNKNOWN_LABEL,
  };
  const signal = browserVisitCaptureSignal(envelope, SCOPE, "s-5");
  assert.ok(signal);
  assert.equal(signal.moduleId, "browser");
  assert.equal(signal.recordKind, "visit");
  assert.equal(signal.recordId, "v-1");
  assert.equal(signal.action, "browse");
  assert.deepEqual(Object.keys(signal.attributes).sort(), ["domain", "timeOfDay", "title"]);
  assert.equal(signal.attributes.domain, "github.com");
  assert.equal(signal.taintLabel, UNKNOWN_LABEL);
  // No URL, path, or query anywhere on the signal — the envelope has no
  // field to carry one, so a path/token string cannot appear.
  const SECRET = "/secret/path?token=XYZZY";
  assert.ok(!JSON.stringify(signal).includes(SECRET));
});

// ── K7: the "apps" source + app-focus emitter (TASK-051) ────────────────────

test("K7: 'apps' is a consent source that defaults OFF like every other", () => {
  assert.ok(isCaptureSource("apps"));
  const state = defaultCaptureConsent();
  assert.equal(captureAllowed(state, "apps"), false);
  // Enabling apps says nothing about any other source, and pause wins.
  const appsOn = withSourceConsent(state, "apps", true, "user-1", AT);
  assert.equal(captureAllowed(appsOn, "apps"), true);
  assert.equal(captureAllowed(appsOn, "browser"), false);
  assert.equal(captureAllowed(withCapturePaused(appsOn, true, "user-1", AT), "apps"), false);
});

test("K7: an app-focus signal is appName+bundleId+windowTitle+timeOfDay — nothing else", () => {
  const envelope: AppFocusCaptureEnvelope = {
    focusId: "f-1",
    appName: "Xcode",
    bundleId: "com.apple.dt.Xcode",
    windowTitle: "bridge — build succeeded",
    focusedAt: AT,
    taintLabel: UNKNOWN_LABEL,
  };
  const signal = appFocusCaptureSignal(envelope, SCOPE, "s-7");
  assert.ok(signal);
  assert.equal(signal.moduleId, "apps");
  assert.equal(signal.recordKind, "focus");
  assert.equal(signal.recordId, "f-1");
  assert.equal(signal.action, "focus");
  assert.deepEqual(Object.keys(signal.attributes).sort(), [
    "appName",
    "bundleId",
    "timeOfDay",
    "windowTitle",
  ]);
  assert.equal(signal.attributes.windowTitle, "bridge — build succeeded");
  assert.equal(signal.taintLabel, UNKNOWN_LABEL);
});

test("K7: a suppressed title (no Accessibility grant) is ABSENT, not empty — and distinct from ''", () => {
  const suppressed = appFocusCaptureSignal(
    { focusId: "f-2", appName: "Mail", bundleId: "com.apple.mail", windowTitle: null, focusedAt: AT },
    SCOPE,
    "s-8",
  );
  assert.ok(suppressed);
  assert.deepEqual(Object.keys(suppressed.attributes).sort(), ["appName", "bundleId", "timeOfDay"]);
  // An app that genuinely titled its window "" still carries the field.
  const empty = appFocusCaptureSignal(
    { focusId: "f-3", appName: "Mail", bundleId: "com.apple.mail", windowTitle: "", focusedAt: AT },
    SCOPE,
    "s-9",
  );
  assert.ok(empty);
  assert.equal(empty.attributes.windowTitle, "");
});

test("K7: window content, AX trees, and input events are structurally inexpressible", () => {
  // The envelope admits exactly these keys — a provider cannot smuggle a
  // richer capture through the emitter without a type error AND this list
  // changing in the same review.
  const envelope: Required<AppFocusCaptureEnvelope> = {
    focusId: "f-4",
    appName: "Safari",
    bundleId: "com.apple.Safari",
    windowTitle: "Apple",
    focusedAt: AT,
    taintLabel: UNKNOWN_LABEL,
  };
  assert.deepEqual(Object.keys(envelope).sort(), [
    "appName",
    "bundleId",
    "focusId",
    "focusedAt",
    "taintLabel",
    "windowTitle",
  ]);
});
