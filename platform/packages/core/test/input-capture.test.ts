/**
 * K11 input-capture boundary (AI Harness K11, TASK-054, AP-157) — the
 * fail-closed contract for continuous keystroke capture. FULL CONTENT is
 * captured ONLY when the field-role gate is clear AND the app is not
 * denylisted; a secure/undeterminable field or a denylisted app yields at
 * most a no-character marker, never the typed text. Raw is structurally
 * unable to persist (the distilled event has no field for it). A
 * pattern-redaction backstop strips card numbers, SSNs, long digit runs and
 * high-entropy tokens from content that WAS captured.
 *
 * Every test below is REMOVAL-FAILS: delete the guard it names and the
 * assertion breaks. That is the whole point of gating this sensor behind
 * K10 — the guarantees are executable before raw ever flows.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPTURE_SOURCES,
  defaultCaptureConsent,
  captureAllowed,
  defaultInputCaptureDenylist,
  distilKeystrokeBurst,
  gateInputCapture,
  isDenylisted,
  redactSensitivePatterns,
  readInputCaptureDenylist,
  withInputCaptureDenylist,
  SEED_DENYLIST_APPS,
  inputCaptureSignal,
  keyCountBucket,
  type RawInputBurst,
  type FieldRole,
} from "../src/index.js";

const DENYLIST = defaultInputCaptureDenylist();

function burst(over: Partial<RawInputBurst>): RawInputBurst {
  return {
    text: "hello world",
    keyCount: 11,
    fieldRole: "content_ok",
    appBundleId: "com.example.editor",
    appName: "Editor",
    ...over,
  };
}

test("K11 registers 'input' as a capture source, default OFF (K2 machinery)", () => {
  assert.ok(CAPTURE_SOURCES.includes("input"));
  const consent = defaultCaptureConsent();
  assert.equal(consent.sources.input.enabled, false);
  // Fail-closed + kill-switch are inherited for free from the K2 state machine.
  assert.equal(captureAllowed(consent, "input"), false);
});

test("secure field NEVER yields characters — only a no-content marker", () => {
  const verdict = gateInputCapture({
    fieldRole: "secure",
    appBundleId: "com.example.editor",
    denylist: DENYLIST,
  });
  assert.deepEqual(verdict, { capture: "suppressed", reason: "secure_field" });

  const event = distilKeystrokeBurst(burst({ text: "hunter2", fieldRole: "secure" }), DENYLIST);
  assert.ok(event);
  assert.equal(event.disposition, "suppressed");
  assert.equal(event.content, undefined); // removal-fails: no character path for secure fields
  assert.ok(!event.summary.includes("hunter2"));
  // The COUNT is withheld too: "typed 7 characters in a secure field" would
  // publish the password's length into a durable Memory row.
  assert.equal(event.keyCount, undefined);
  assert.ok(!/\d/.test(event.summary));
});

test("UNDETERMINABLE field role fails closed — unknown is sensitive", () => {
  const verdict = gateInputCapture({
    fieldRole: "undeterminable",
    appBundleId: "com.example.editor",
    denylist: DENYLIST,
  });
  assert.deepEqual(verdict, { capture: "suppressed", reason: "undeterminable_field" });

  const event = distilKeystrokeBurst(
    burst({ text: "maybe-a-password", fieldRole: "undeterminable" }),
    DENYLIST,
  );
  assert.ok(event);
  assert.equal(event.content, undefined);
  assert.ok(!event.summary.includes("maybe-a-password"));
});

test("a hypothetical new FieldRole is suppressed unless explicitly opted in", () => {
  // Removal-fails guard: CONTENT_ALLOWED_ROLES is the single opt-in set. A role
  // not in it must never capture. Cast simulates a future member added to the
  // union but not to the allow-set.
  const rogue = "rich_text_v2" as unknown as FieldRole;
  const verdict = gateInputCapture({
    fieldRole: rogue,
    appBundleId: "com.example.editor",
    denylist: DENYLIST,
  });
  assert.equal(verdict.capture, "suppressed");
});

test("denylisted app emits NOTHING — not even that typing happened", () => {
  const event = distilKeystrokeBurst(
    burst({ text: "master-password", appBundleId: "com.1password.1password", appName: "1Password" }),
    DENYLIST,
  );
  assert.equal(event, null); // removal-fails: denylist short-circuit returns null
});

test("denylisted browser host emits nothing (label-boundary suffix match)", () => {
  assert.equal(isDenylisted(DENYLIST, "com.apple.Safari", "vault.bitwarden.com"), true);
  // not a false-positive on a lookalike domain
  assert.equal(isDenylisted(DENYLIST, "com.apple.Safari", "notbitwarden.com"), false);
  const event = distilKeystrokeBurst(
    burst({ appBundleId: "com.apple.Safari", host: "vault.bitwarden.com", text: "secret" }),
    DENYLIST,
  );
  assert.equal(event, null);
});

test("seed denylist floor denies password managers and banks out of the box", () => {
  assert.ok(isDenylisted(DENYLIST, "com.apple.keychainaccess"));
  assert.ok(isDenylisted(DENYLIST, "com.bitwarden.desktop"));
  assert.ok(isDenylisted(DENYLIST, "com.apple.Safari", "1password.com"));
  assert.ok(!isDenylisted(DENYLIST, "com.example.editor"));
});

test("clear field in an allowed app captures the (redacted) content", () => {
  const event = distilKeystrokeBurst(burst({ text: "buy milk and bread" }), DENYLIST);
  assert.ok(event);
  assert.equal(event.disposition, "captured");
  assert.equal(event.content, "buy milk and bread");
});

test("redaction strips a card number even from a capturable field", () => {
  const { text, redactions } = redactSensitivePatterns("my card is 4111 1111 1111 1111 ok");
  assert.ok(!text.includes("4111"));
  assert.ok(text.includes("[redacted:card]"));
  assert.equal(redactions.some((r) => r.kind === "card_number"), true);
});

test("redaction strips SSNs, long digit runs, and high-entropy tokens", () => {
  const ssn = redactSensitivePatterns("ssn 123-45-6789 here");
  assert.ok(!ssn.text.includes("123-45-6789"));
  assert.equal(ssn.redactions.some((r) => r.kind === "ssn"), true);

  const digits = redactSensitivePatterns("acct 998877665544");
  assert.ok(!digits.text.includes("998877665544"));

  const token = redactSensitivePatterns("key sk9aZ12bQ7rT4mN8xC3vB6wE0pL5kJ2");
  assert.ok(token.text.includes("[redacted:token]"));
});

test("captured content is redacted end-to-end through the distiller", () => {
  const event = distilKeystrokeBurst(
    burst({ text: "pay with 4111111111111111 today" }),
    DENYLIST,
  );
  assert.ok(event);
  assert.equal(event.disposition, "captured");
  assert.ok(event.content && !event.content.includes("4111111111111111"));
  assert.equal(event.redactions.length >= 1, true);
});

test("denylist parse fails CLOSED to the seed floor, never to capture-everything", () => {
  assert.deepEqual(readInputCaptureDenylist(null).apps.includes("com.bitwarden.desktop"), true);
  assert.deepEqual(readInputCaptureDenylist("garbage").apps.includes("com.1password.1password"), true);
  // a malformed stored blob still yields the full seed floor
  const parsed = readInputCaptureDenylist({ apps: 42, domains: ["chase.com"] });
  for (const seed of SEED_DENYLIST_APPS) assert.ok(parsed.apps.includes(seed));
  assert.ok(parsed.domains.includes("chase.com"));
});

test("a user edit cannot remove the seed floor and rejects invalid entries by name", () => {
  const { denylist, rejected } = withInputCaptureDenylist({
    apps: ["com.example.myeditor", "not a bundle id", "  "],
    domains: ["mybank.example", "http://evil.com/path"],
  });
  // seed floor preserved even though the edit omitted it
  for (const seed of SEED_DENYLIST_APPS) assert.ok(denylist.apps.includes(seed));
  assert.ok(denylist.apps.includes("com.example.myeditor"));
  assert.ok(denylist.domains.includes("mybank.example"));
  // invalid entries are surfaced, not silently dropped
  assert.ok(rejected.includes("not a bundle id"));
  assert.ok(rejected.includes("http://evil.com/path"));
  // whitespace-only is ignored, not "rejected"
  assert.ok(!rejected.includes("  "));
});

test("the signal row carries NO typed content — only bucketed facets", () => {
  // The distilled event may carry redacted content for the Memory body, but
  // the SIGNAL's attributes (which the digest groups on and which fan out to
  // rhythm mining) must never carry the text itself.
  const signal = inputCaptureSignal(
    {
      burstId: "b1",
      appName: "Editor",
      bundleId: "com.example.editor",
      summary: "Typed in Editor: buy milk",
      keyCount: 9,
      content: "buy milk",
      disposition: "captured",
      redactionCount: 0,
      typedAt: "2026-08-16T10:00:00.000Z",
    },
    { organizationId: "org", userId: "user" },
    "sig-1",
  );
  assert.ok(signal);
  const attrs = JSON.stringify(signal.attributes);
  assert.ok(!attrs.includes("buy milk")); // removal-fails: no content facet
  assert.equal(signal.attributes["keyCount"], "brief"); // bucketed, not a tally
  assert.equal(signal.attributes["disposition"], "captured");
});

test("suppressed bursts signal the reason and never the text", () => {
  const signal = inputCaptureSignal(
    {
      burstId: "b2",
      appName: "Mail",
      bundleId: "com.apple.mail",
      summary: "Typed in a secure field in Mail",
      disposition: "suppressed",
      suppressionReason: "secure_field",
      redactionCount: 0,
      typedAt: "2026-08-16T22:00:00.000Z",
    },
    { organizationId: "org", userId: "user" },
    "sig-2",
  );
  assert.ok(signal);
  assert.equal(signal.attributes["suppressionReason"], "secure_field");
  assert.equal(signal.attributes["disposition"], "suppressed");
  assert.equal(signal.attributes["timeOfDay"], "night");
  // No volume facet at all for a suppressed burst — not even a coarse band,
  // since any volume signal about a password field is a length hint.
  assert.equal(signal.attributes["keyCount"], undefined);
});

test("key counts bucket coarsely — a tally is never stored", () => {
  assert.equal(keyCountBucket(1), "brief");
  assert.equal(keyCountBucket(10), "brief");
  assert.equal(keyCountBucket(11), "short");
  assert.equal(keyCountBucket(60), "short");
  assert.equal(keyCountBucket(61), "medium");
  assert.equal(keyCountBucket(300), "medium");
  assert.equal(keyCountBucket(301), "long");
});

test("the distilled event type carries no raw-burst field (raw cannot persist)", () => {
  const event = distilKeystrokeBurst(burst({ text: "anything" }), DENYLIST);
  assert.ok(event);
  // Structural: the only content-bearing field is `content` (already redacted);
  // there is no `raw`/`rawText`/`keystrokes` field on the event.
  assert.equal("raw" in event, false);
  assert.equal("rawText" in event, false);
  assert.equal("keystrokes" in event, false);
});
