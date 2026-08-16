/**
 * K11 input-capture RED TEAM (TASK-054, AP-157) — adversarial attempts to
 * leak a single character past the fail-closed boundary. Written in the
 * attacker's posture, not the author's: every test here is an attempted
 * BYPASS, and passing means the bypass failed.
 *
 * Separate from `input-capture.test.ts` (which pins the intended contract)
 * so the two read differently on purpose: that file says "this is what we
 * promise", this file says "here is what we tried to do to it".
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultInputCaptureDenylist,
  distilKeystrokeBurst,
  gateInputCapture,
  isDenylisted,
  readInputCaptureDenylist,
  redactSensitivePatterns,
  withInputCaptureDenylist,
  type FieldRole,
  type RawInputBurst,
} from "../src/index.js";

const DENYLIST = defaultInputCaptureDenylist();
const SECRET = "correct-horse-battery-staple";

function burst(over: Partial<RawInputBurst>): RawInputBurst {
  return {
    text: SECRET,
    keyCount: SECRET.length,
    fieldRole: "content_ok",
    appBundleId: "com.example.editor",
    appName: "Editor",
    ...over,
  };
}

/** The single assertion that matters: this event must not contain the secret
 * ANYWHERE — not in content, not smuggled into the summary. */
function assertNoLeak(event: ReturnType<typeof distilKeystrokeBurst>, secret = SECRET): void {
  if (event === null) return; // emitted nothing at all — the strongest outcome
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes(secret), `LEAK: secret found in ${serialized}`);
}

// ---------------------------------------------------------------------------
// Attack 1: denylist evasion via string trickery
// ---------------------------------------------------------------------------

test("ATTACK: uppercase / mixed-case bundle id does not dodge the denylist", () => {
  assert.equal(isDenylisted(DENYLIST, "COM.1PASSWORD.1PASSWORD"), true);
  assert.equal(isDenylisted(DENYLIST, "Com.BitWarden.Desktop"), true);
  assertNoLeak(distilKeystrokeBurst(burst({ appBundleId: "COM.1PASSWORD.1PASSWORD" }), DENYLIST));
});

test("ATTACK: surrounding whitespace does not dodge the denylist", () => {
  assert.equal(isDenylisted(DENYLIST, "  com.bitwarden.desktop  "), true);
  assertNoLeak(distilKeystrokeBurst(burst({ appBundleId: " com.bitwarden.desktop " }), DENYLIST));
});

test("ATTACK: uppercase / spaced host does not dodge the domain denylist", () => {
  assert.equal(isDenylisted(DENYLIST, "com.apple.Safari", "VAULT.BITWARDEN.COM"), true);
  assert.equal(isDenylisted(DENYLIST, "com.apple.Safari", "  vault.bitwarden.com "), true);
  assertNoLeak(
    distilKeystrokeBurst(burst({ appBundleId: "com.apple.Safari", host: "VAULT.BITWARDEN.COM" }), DENYLIST),
  );
});

test("ATTACK: deep subdomain nesting is still covered by the suffix rule", () => {
  assert.equal(isDenylisted(DENYLIST, "com.apple.Safari", "a.b.c.vault.1password.com"), true);
  assertNoLeak(
    distilKeystrokeBurst(
      burst({ appBundleId: "com.apple.Safari", host: "a.b.c.vault.1password.com" }),
      DENYLIST,
    ),
  );
});

test("BOUNDARY: a lookalike domain is NOT over-blocked (label boundary holds both ways)", () => {
  // The suffix rule must not be a naive substring match, or "notbitwarden.com"
  // and "bitwarden.com.evil.test" would be treated as the protected domain.
  assert.equal(isDenylisted(DENYLIST, "com.apple.Safari", "notbitwarden.com"), false);
  assert.equal(isDenylisted(DENYLIST, "com.apple.Safari", "bitwarden.com.evil.test"), false);
});

test("ATTACK: a user edit cannot delete the seed floor to unlock a password manager", () => {
  // The attacker (or a careless edit) submits a denylist that omits every seed.
  const { denylist } = withInputCaptureDenylist({ apps: [], domains: [] });
  assert.equal(isDenylisted(denylist, "com.1password.1password"), true);
  assertNoLeak(distilKeystrokeBurst(burst({ appBundleId: "com.1password.1password" }), denylist));
});

test("ATTACK: corrupt stored denylist does not degrade to capture-everything", () => {
  for (const corrupt of [null, undefined, 0, "", "[]", { apps: "not-an-array" }, { domains: 42 }]) {
    const parsed = readInputCaptureDenylist(corrupt);
    assert.equal(
      isDenylisted(parsed, "com.1password.1password"),
      true,
      `corrupt input ${JSON.stringify(corrupt)} dropped the seed floor`,
    );
  }
});

// ---------------------------------------------------------------------------
// Attack 2: field-role gate evasion
// ---------------------------------------------------------------------------

test("ATTACK: every non-allowed field role suppresses, including invented ones", () => {
  const roles = [
    "secure",
    "undeterminable",
    "",
    "CONTENT_OK", // case games
    "content_ok ", // trailing space
    "rich_text",
    "password",
    "unknown",
    null,
    undefined,
  ];
  for (const role of roles) {
    const verdict = gateInputCapture({
      fieldRole: role as unknown as FieldRole,
      appBundleId: "com.example.editor",
      denylist: DENYLIST,
    });
    assert.notEqual(verdict.capture, "content", `role ${JSON.stringify(role)} wrongly captured`);
    assertNoLeak(distilKeystrokeBurst(burst({ fieldRole: role as unknown as FieldRole }), DENYLIST));
  }
});

test("ATTACK: a secure field in an allowed app still yields no characters", () => {
  const event = distilKeystrokeBurst(burst({ fieldRole: "secure" }), DENYLIST);
  assert.ok(event);
  assert.equal(event.content, undefined);
  assert.equal(event.disposition, "suppressed");
  assertNoLeak(event);
});

test("ATTACK: denylisted app + clear field role still emits absolutely nothing", () => {
  // Belt-and-braces: the denylist must short-circuit BEFORE the role check,
  // so a "content_ok" role cannot rescue a denylisted app.
  const event = distilKeystrokeBurst(
    burst({ appBundleId: "com.bitwarden.desktop", fieldRole: "content_ok" }),
    DENYLIST,
  );
  assert.equal(event, null);
});

// ---------------------------------------------------------------------------
// Attack 3: redaction evasion on content that IS capturable
// ---------------------------------------------------------------------------

test("ATTACK: card numbers survive neither spacing nor dashes", () => {
  for (const card of ["4111111111111111", "4111 1111 1111 1111", "4111-1111-1111-1111"]) {
    const { text } = redactSensitivePatterns(`pay ${card} now`);
    assert.ok(!text.includes("4111"), `card form "${card}" leaked`);
  }
});

test("ATTACK: a non-Luhn long digit run is still redacted (labelled honestly)", () => {
  // Not a valid card, but still a 16-digit secret-shaped number: it must not
  // be left in the clear just because it fails the Luhn check.
  const { text, redactions } = redactSensitivePatterns("id 1234567890123456 end");
  assert.ok(!text.includes("1234567890123456"));
  assert.equal(redactions.some((r) => r.kind === "long_digit_run"), true);
});

test("ATTACK: multiple distinct secrets in one burst are ALL redacted", () => {
  const { text } = redactSensitivePatterns(
    "card 4111111111111111 ssn 123-45-6789 tok sk9aZ12bQ7rT4mN8xC3vB6wE0pL5kJ2 acct 998877665544",
  );
  assert.ok(!text.includes("4111111111111111"));
  assert.ok(!text.includes("123-45-6789"));
  assert.ok(!text.includes("998877665544"));
  assert.ok(!/sk9aZ12bQ7rT4mN8xC3vB6wE0pL5kJ2/.test(text));
});

test("ATTACK: secrets adjacent to punctuation are still caught", () => {
  const { text } = redactSensitivePatterns("(4111111111111111),[123-45-6789];");
  assert.ok(!text.includes("4111111111111111"));
  assert.ok(!text.includes("123-45-6789"));
});

test("ATTACK: redaction runs end-to-end through the distiller, not just standalone", () => {
  const event = distilKeystrokeBurst(
    burst({ text: "my card 4111 1111 1111 1111 and ssn 123-45-6789" }),
    DENYLIST,
  );
  assert.ok(event);
  assert.ok(event.content);
  assert.ok(!event.content.includes("4111"));
  assert.ok(!event.content.includes("123-45-6789"));
  // and the summary (which becomes the Memory body) is equally clean
  assert.ok(!event.summary.includes("4111"));
  assert.ok(!event.summary.includes("123-45-6789"));
});

// ---------------------------------------------------------------------------
// Attack 4: shape/structural abuse
// ---------------------------------------------------------------------------

test("ATTACK: no distilled event ever carries a raw-stream field, whatever the input", () => {
  const cases: Partial<RawInputBurst>[] = [
    {},
    { fieldRole: "secure" },
    { fieldRole: "undeterminable" },
    { text: "" },
    { text: " ".repeat(1000) },
    { text: "x".repeat(20000), keyCount: 20000 },
    { keyCount: 0 },
    { keyCount: -5 },
  ];
  for (const over of cases) {
    const event = distilKeystrokeBurst(burst(over), DENYLIST);
    if (event === null) continue;
    for (const forbidden of ["raw", "rawText", "keystrokes", "keys", "stream", "buffer"]) {
      assert.equal(forbidden in event, false, `event exposed a ${forbidden} field`);
    }
  }
});

test("ATTACK: an enormous burst does not bypass suppression", () => {
  const huge = "s3cr3t".repeat(5000);
  const event = distilKeystrokeBurst(
    { text: huge, keyCount: huge.length, fieldRole: "undeterminable", appBundleId: "com.example.editor", appName: "Editor" },
    DENYLIST,
  );
  assertNoLeak(event, huge);
});

test("ATTACK: suppressed summary reveals the field kind but never the characters", () => {
  const event = distilKeystrokeBurst(burst({ fieldRole: "secure", text: "hunter2" }), DENYLIST);
  assert.ok(event);
  assert.ok(!event.summary.includes("hunter2"));
  assert.ok(event.summary.includes("secure field"));
});

test("ATTACK: password LENGTH cannot be inferred from a suppressed event", () => {
  // Found by this red-team pass: the first implementation wrote "Typed 8
  // characters in a secure field" into a durable Memory row, publishing the
  // exact length of a password. Length materially narrows a brute-force
  // space, so under "unknown is sensitive" the count goes with the text.
  for (const secret of ["a", "hunter2!", "x".repeat(64)]) {
    for (const role of ["secure", "undeterminable"] as const) {
      const event = distilKeystrokeBurst(
        burst({ fieldRole: role, text: secret, keyCount: secret.length }),
        DENYLIST,
      );
      assert.ok(event);
      assert.equal(event.keyCount, undefined, `${role} leaked an exact count`);
      assert.ok(
        !new RegExp(String(secret.length)).test(event.summary),
        `${role} summary leaked the length ${secret.length}: ${event.summary}`,
      );
      assert.ok(!/\d/.test(event.summary), `${role} summary carried a digit: ${event.summary}`);
    }
  }
});

test("ATTACK: two different-length secrets in the same field are indistinguishable", () => {
  // The strongest form of the length check: the stored events must be byte
  // identical, so an inspector cannot rank them by how much was typed.
  const short = distilKeystrokeBurst(burst({ fieldRole: "secure", text: "ab", keyCount: 2 }), DENYLIST);
  const long = distilKeystrokeBurst(
    burst({ fieldRole: "secure", text: "a".repeat(40), keyCount: 40 }),
    DENYLIST,
  );
  assert.deepEqual(short, long);
});
