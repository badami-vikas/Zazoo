/**
 * K11c ambient-audio boundary (TASK-054) — written before any capture backend
 * exists (the K10 gate).
 *
 * The property this lane exists to enforce, and which the other two sensors
 * never had to: **the person speaking may not be the person who consented.**
 * These tests pin the structural consequences of that — an unarmed session
 * captures nothing, a multi-party session captures nothing without an
 * attributable all-party consent assertion, and system-audio loopback (which
 * IS the other side of the call) can never reach the solo path.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_AUDIO_CONTENT_MODE,
  defaultAudioCaptureDenylist,
  distilAudioSession,
  gateAudioCapture,
  isAudioDenylisted,
  mergeAudioSeedFloor,
  readAudioCaptureDenylist,
  type AudioCaptureDenylist,
  type RawAudioSession,
} from "../src/learning/audio-capture.js";

const DENYLIST: AudioCaptureDenylist = defaultAudioCaptureDenylist();

function session(over: Partial<RawAudioSession> = {}): RawAudioSession {
  return {
    appName: "Voice Memos",
    appBundleId: "com.apple.voicememos",
    scope: "own_voice_only",
    armed: true,
    ...over,
  };
}

test("an armed solo session is captured — metadata only by default", () => {
  const event = distilAudioSession(session(), DENYLIST);
  assert.ok(event);
  assert.equal(event.disposition, "captured");
  assert.equal(event.content, undefined);
  assert.equal(DEFAULT_AUDIO_CONTENT_MODE, "metadata_only");
});

test("an UNARMED session captures nothing — ambient audio is not ambient", () => {
  // Every other sensor here is consent-once-then-continuous. This one is not:
  // "I agreed months ago" is not something a user can say on behalf of
  // whoever walks into the room today.
  const event = distilAudioSession(session({ armed: false, transcript: "SECRET-XYZZY" }), DENYLIST, "transcript");
  assert.ok(event);
  assert.equal(event.disposition, "suppressed");
  assert.equal(event.suppressionReason, "not_armed");
  assert.equal(event.content, undefined);
  assert.ok(!JSON.stringify(event).includes("XYZZY"));
});

test("a MULTI-PARTY session captures nothing without an all-party consent assertion", () => {
  // The third party never consented, and no gate can obtain that for them.
  const event = distilAudioSession(
    session({ scope: "multi_party", transcript: "SECRET-XYZZY" }),
    DENYLIST,
    "transcript",
  );
  assert.ok(event);
  assert.equal(event.disposition, "suppressed");
  assert.equal(event.suppressionReason, "no_all_party_consent");
  assert.ok(!JSON.stringify(event).includes("XYZZY"));
});

test("the all-party assertion must be an ATTRIBUTABLE identity, not a truthy value", () => {
  // A boolean would be satisfiable by a default or a stale setting. Requiring
  // who claimed it makes the claim auditable — and empty/whitespace refuses.
  for (const bad of [null, "", "   "] as const) {
    const event = distilAudioSession(
      session({ scope: "multi_party", allPartyConsentAssertedBy: bad }),
      DENYLIST,
    );
    assert.ok(event);
    assert.equal(event.disposition, "suppressed", `should refuse for ${JSON.stringify(bad)}`);
  }
  // ...and an entirely absent field refuses too (the omission case).
  const omitted = distilAudioSession(session({ scope: "multi_party" }), DENYLIST);
  assert.ok(omitted);
  assert.equal(omitted.disposition, "suppressed");
  const ok = distilAudioSession(
    session({ scope: "multi_party", allPartyConsentAssertedBy: "user-1" }),
    DENYLIST,
  );
  assert.ok(ok);
  assert.equal(ok.disposition, "captured");
  // ...and who claimed it travels WITH the stored event, so an audit can ask.
  assert.equal(ok.allPartyConsentAssertedBy, "user-1");
});

test("a solo session never records an all-party assertion it did not need", () => {
  const event = distilAudioSession(
    session({ scope: "own_voice_only", allPartyConsentAssertedBy: "user-1" }),
    DENYLIST,
  );
  assert.ok(event);
  assert.equal(event.allPartyConsentAssertedBy, undefined);
});

test("undeterminable participants fail closed — 'we could not tell who was on the call'", () => {
  const event = distilAudioSession(session({ scope: "undeterminable" }), DENYLIST);
  assert.ok(event);
  assert.equal(event.disposition, "suppressed");
  assert.equal(event.suppressionReason, "undeterminable_participants");
});

test("system-audio loopback is inherently multi-party and cannot reach the solo path", () => {
  // Loopback IS the other side of the call. A provider reporting it must
  // report multi_party; this asserts the gate treats it as such rather than
  // letting a "system audio" session pass on the user's consent alone.
  const loopback = session({ appName: "System Audio", appBundleId: "ai.bridge.loopback", scope: "multi_party" });
  const refused = distilAudioSession(loopback, DENYLIST, "transcript");
  assert.ok(refused);
  assert.equal(refused.suppressionReason, "no_all_party_consent");
});

test("a denylisted app emits NOTHING — a FaceTime call must not reveal it happened", () => {
  assert.equal(distilAudioSession(session({ appBundleId: "com.apple.FaceTime" }), DENYLIST), null);
  assert.equal(distilAudioSession(session({ appBundleId: "net.whatsapp.WhatsApp" }), DENYLIST), null);
  // The denial outranks a fully armed, fully consented session.
  assert.equal(
    distilAudioSession(
      session({
        appBundleId: "com.apple.FaceTime",
        scope: "multi_party",
        armed: true,
        allPartyConsentAssertedBy: "user-1",
      }),
      DENYLIST,
    ),
    null,
  );
});

test("a suppressed session leaks no shape — no duration, no participant count", () => {
  // Same rule as ADR-239's password length: metadata about a conversation we
  // refused to record is itself sensitive.
  const a = distilAudioSession(session({ armed: false }), DENYLIST);
  const b = distilAudioSession(session({ armed: false }), DENYLIST);
  assert.deepEqual(a, b);
  const serialized = JSON.stringify(a);
  for (const forbidden of ["duration", "seconds", "participants", "count", "length"]) {
    assert.ok(!serialized.includes(forbidden), `suppressed event must not carry ${forbidden}`);
  }
});

test("transcripts are opt-in and redacted when stored", () => {
  const withText = session({ transcript: "my card is 4111111111111111 ok" });
  const defaulted = distilAudioSession(withText, DENYLIST);
  assert.ok(defaulted);
  assert.equal(defaulted.content, undefined, "transcript must not store by default");

  const allowed = distilAudioSession(withText, DENYLIST, "transcript");
  assert.ok(allowed);
  assert.equal(allowed.content, "my card is [redacted:card] ok");
  assert.equal(allowed.redactions.some((r) => r.kind === "card_number"), true);
});

test("the distilled type cannot carry raw audio at all", () => {
  const event = distilAudioSession(session({ transcript: "x" }), DENYLIST, "transcript");
  assert.ok(event);
  for (const forbidden of ["samples", "buffer", "pcm", "path", "audio", "wav", "stream"]) {
    assert.equal(forbidden in event, false, `distilled event must not expose ${forbidden}`);
  }
});

test("a MIXED-CASE seed is denied by the DEFAULT list, not just an edited one", () => {
  // Regression: `defaultAudioCaptureDenylist` used to copy the seed array raw
  // while matching lowercases the probe, so every seed with a capital in it
  // — `com.apple.FaceTime` among them — was in the list and denied nothing.
  // The edited path passed because merging normalises; only the default was
  // broken, which is the path a user who never opens the editor gets.
  const fresh = defaultAudioCaptureDenylist();
  assert.equal(isAudioDenylisted(fresh, "com.apple.FaceTime"), true);
  assert.equal(isAudioDenylisted(fresh, "com.apple.facetime"), true);
  assert.equal(isAudioDenylisted(fresh, "net.whatsapp.WhatsApp"), true);
  assert.equal(isAudioDenylisted(fresh, "com.example.recorder"), false);
});

test("the seed floor survives malformed config and every save", () => {
  const fromGarbage = readAudioCaptureDenylist({ apps: "not-an-array" });
  assert.ok(fromGarbage.apps.includes("com.apple.facetime"));
  const edited = mergeAudioSeedFloor(["com.example.recorder"]);
  assert.ok(edited.apps.includes("com.apple.facetime"));
  assert.ok(edited.apps.includes("com.example.recorder"));
  assert.equal(isAudioDenylisted(edited, "com.apple.FaceTime"), true);
});

test("the gate's refusal order: denylist → not armed → participants", () => {
  // Unarmed outranks participant scope: an unarmed session is not one we are
  // entitled to characterise at all, even as "multi-party".
  assert.deepEqual(
    gateAudioCapture({
      scope: "multi_party",
      bundleId: "com.apple.voicememos",
      armed: false,
      denylist: DENYLIST,
    }),
    { capture: "suppressed", reason: "not_armed" },
  );
  // Denylist outranks everything, including a fully consented armed session.
  assert.deepEqual(
    gateAudioCapture({
      scope: "own_voice_only",
      bundleId: "com.apple.FaceTime",
      armed: true,
      allPartyConsentAssertedBy: "user-1",
      denylist: DENYLIST,
    }),
    { capture: "none" },
  );
});
