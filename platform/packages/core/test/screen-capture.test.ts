/**
 * K11b screen-capture boundary (TASK-054) — the executable version of the
 * promise, written before any frame grabber exists (the K10 gate).
 *
 * The properties under test, each of which must FAIL if its guard is removed:
 *  - a denylisted window emits NOTHING, not even a marker;
 *  - a window the OS marked un-shareable is never captured;
 *  - a private/incognito window is never captured, even when shareable;
 *  - an unreadable window fails closed (unknown is sensitive);
 *  - a SUPPRESSED frame carries no window title — metadata about what we
 *    refused to look at is itself sensitive (the ADR-239 lesson);
 *  - derived text is structurally opt-in and OFF by default;
 *  - nothing in the distilled type can carry a raw frame.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SCREEN_CONTENT_MODE,
  defaultScreenCaptureDenylist,
  distilScreenFrame,
  gateScreenCapture,
  isScreenDenylisted,
  mergeSeedFloor,
  readScreenCaptureDenylist,
  type RawScreenFrame,
  type ScreenCaptureDenylist,
} from "../src/learning/screen-capture.js";

const DENYLIST: ScreenCaptureDenylist = defaultScreenCaptureDenylist();

function frame(over: Partial<RawScreenFrame> = {}): RawScreenFrame {
  return {
    appName: "Notes",
    appBundleId: "com.apple.notes",
    windowTitle: "Q3 planning",
    shareability: "shareable",
    isPrivateWindow: false,
    ...over,
  };
}

test("an ordinary shareable window is captured, with its title but no content by default", () => {
  const event = distilScreenFrame(frame(), DENYLIST);
  assert.ok(event);
  assert.equal(event.disposition, "captured");
  assert.equal(event.windowTitle, "Q3 planning");
  // The undecided content question: metadata only until someone decides.
  assert.equal(event.content, undefined);
  assert.equal(DEFAULT_SCREEN_CONTENT_MODE, "metadata_only");
});

test("a denylisted app emits NOTHING — not even a suppressed marker", () => {
  // A vault window must not reveal that it was open. `null`, not a marker.
  assert.equal(distilScreenFrame(frame({ appBundleId: "com.1password.1password" }), DENYLIST), null);
  // ...and the denial outranks a perfectly shareable, non-private window.
  assert.equal(
    distilScreenFrame(
      frame({ appBundleId: "com.bitwarden.desktop", shareability: "shareable", isPrivateWindow: false }),
      DENYLIST,
    ),
    null,
  );
});

test("a denylisted DOMAIN in a browser window emits nothing, subdomains included", () => {
  assert.equal(
    distilScreenFrame(frame({ appBundleId: "com.apple.Safari", host: "my.1password.com" }), DENYLIST),
    null,
  );
  assert.ok(distilScreenFrame(frame({ appBundleId: "com.apple.Safari", host: "example.com" }), DENYLIST));
});

test("a window the OS marked un-shareable is suppressed — the NSWindowSharingNone analogue", () => {
  const event = distilScreenFrame(frame({ shareability: "excluded" }), DENYLIST);
  assert.ok(event);
  assert.equal(event.disposition, "suppressed");
  assert.equal(event.suppressionReason, "os_excluded");
});

test("a private/incognito window is suppressed EVEN WHEN the OS says it is shareable", () => {
  // The browser's incognito promise outranks the window server's opinion —
  // and a screen sensor must not become the back door around K8's refusal to
  // capture incognito browsing.
  const event = distilScreenFrame(frame({ shareability: "shareable", isPrivateWindow: true }), DENYLIST);
  assert.ok(event);
  assert.equal(event.disposition, "suppressed");
  assert.equal(event.suppressionReason, "private_window");
});

test("an unreadable window fails closed — unknown is sensitive", () => {
  const event = distilScreenFrame(frame({ shareability: "undeterminable" }), DENYLIST);
  assert.ok(event);
  assert.equal(event.disposition, "suppressed");
  assert.equal(event.suppressionReason, "undeterminable_window");
});

test("a SUPPRESSED frame carries no window title — a title is content", () => {
  // "Q3 layoffs.xlsx" in a window we refused to capture is the same class of
  // leak as ADR-239's password length: metadata about a refusal is sensitive.
  for (const over of [
    { shareability: "excluded" as const },
    { shareability: "undeterminable" as const },
    { isPrivateWindow: true },
  ]) {
    const event = distilScreenFrame(frame({ ...over, windowTitle: "Q3 layoffs.xlsx" }), DENYLIST);
    assert.ok(event);
    assert.equal(event.windowTitle, undefined);
    assert.ok(!JSON.stringify(event).includes("layoffs"), `title leaked for ${JSON.stringify(over)}`);
  }
});

test("two suppressed frames with very different titles distil IDENTICALLY", () => {
  // No length or shape hint survives, exactly as K11a's two secrets do.
  const short = distilScreenFrame(frame({ shareability: "excluded", windowTitle: "a" }), DENYLIST);
  const long = distilScreenFrame(
    frame({ shareability: "excluded", windowTitle: "merger with Acme — board only" }),
    DENYLIST,
  );
  assert.deepEqual(short, long);
});

test("derived text is opt-in: present on the frame but NOT stored in the default mode", () => {
  const withText = frame({ derivedText: "call Dana about the renewal" });
  const defaulted = distilScreenFrame(withText, DENYLIST);
  assert.ok(defaulted);
  assert.equal(defaulted.content, undefined);
  // Removal-fails in spirit: the text was RIGHT THERE and still did not land.
  assert.ok(!JSON.stringify(defaulted).includes("Dana"));

  const allowed = distilScreenFrame(withText, DENYLIST, "derived_text");
  assert.ok(allowed);
  assert.equal(allowed.content, "call Dana about the renewal");
});

test("derived text is redacted when it IS stored", () => {
  const event = distilScreenFrame(
    frame({ derivedText: "invoice paid with 4111111111111111 today" }),
    DENYLIST,
    "derived_text",
  );
  assert.ok(event);
  assert.ok(!event.content?.includes("4111111111111111"));
  assert.equal(event.content, "invoice paid with [redacted:card] today");
  assert.equal(event.redactions.some((r) => r.kind === "card_number"), true);
});

test("derived text is never stored for a SUPPRESSED frame, whatever the mode", () => {
  // The mode says "derived text may be stored"; the gate says "not this one".
  // The gate wins — a content mode is not a bypass.
  for (const over of [
    { shareability: "excluded" as const },
    { shareability: "undeterminable" as const },
    { isPrivateWindow: true },
  ]) {
    const event = distilScreenFrame(
      frame({ ...over, derivedText: "SECRET-XYZZY" }),
      DENYLIST,
      "derived_text",
    );
    assert.ok(event);
    assert.equal(event.content, undefined);
    assert.ok(!JSON.stringify(event).includes("XYZZY"));
  }
});

test("the distilled type cannot carry a raw frame at all", () => {
  // Structural, not conventional: there is no pixel/handle/path field to fill.
  const event = distilScreenFrame(frame({ derivedText: "x" }), DENYLIST, "derived_text");
  assert.ok(event);
  for (const forbidden of ["pixels", "image", "frame", "path", "bitmap", "png", "screenshot"]) {
    assert.equal(forbidden in event, false, `distilled event must not expose ${forbidden}`);
  }
});

test("a MIXED-CASE seed is denied by the DEFAULT list, not just an edited one", () => {
  // Same regression the audio lane hit: matching lowercases the probe, so a
  // raw copy of the seeds silently fails to deny every entry with a capital.
  // The earlier tests here passed only because they happened to use the
  // all-lowercase seeds. `com.lastpass.LastPass` is the one that would have
  // shipped broken for a user who never edited the list.
  const fresh = defaultScreenCaptureDenylist();
  assert.equal(isScreenDenylisted(fresh, "com.lastpass.LastPass"), true);
  assert.equal(isScreenDenylisted(fresh, "com.dashlane.Dashlane"), true);
  assert.equal(isScreenDenylisted(fresh, "com.agilebits.onepassword7"), true);
  assert.equal(isScreenDenylisted(fresh, "com.example.editor"), false);
});

test("the seed floor survives a malformed denylist and every save", () => {
  // Parse fails CLOSED — garbage can only ever ADD protection.
  const fromGarbage = readScreenCaptureDenylist({ apps: "not-an-array", domains: 42 });
  assert.ok(fromGarbage.apps.includes("com.1password.1password"));
  assert.ok(fromGarbage.domains.includes("1password.com"));

  // A human cannot edit their way into capturing a vault window.
  const edited = mergeSeedFloor({ apps: ["com.example.editor"], domains: ["example.com"] });
  assert.ok(edited.apps.includes("com.1password.1password"));
  assert.ok(edited.apps.includes("com.example.editor"));
  assert.equal(isScreenDenylisted(edited, "com.1password.1password"), true);
});

test("the seed floor does NOT cover banks — the promise must match the list", () => {
  // Same honesty rule as ADR-241: no bounded list of the world's banking apps
  // exists, so the floor promises exactly what it enforces and the UI asks the
  // user to add their own.
  const denylist = defaultScreenCaptureDenylist();
  assert.equal(isScreenDenylisted(denylist, "com.apple.Safari", "chase.com"), false);
  assert.equal(isScreenDenylisted(denylist, "com.apple.Safari", "hsbc.co.uk"), false);
  assert.equal(isScreenDenylisted(denylist, "com.apple.Safari", "1password.com"), true);
});

test("the gate's refusal order is denylist → OS exclusion → private → unknown", () => {
  // A denylisted AND un-shareable window still emits nothing rather than a
  // suppressed marker: the strongest refusal wins, not the first one checked.
  assert.deepEqual(
    gateScreenCapture({
      shareability: "excluded",
      bundleId: "com.1password.1password",
      isPrivateWindow: true,
      denylist: DENYLIST,
    }),
    { capture: "none" },
  );
  // OS exclusion outranks private-window reporting, so the reason a user sees
  // is the one the OS asserted.
  assert.deepEqual(
    gateScreenCapture({
      shareability: "excluded",
      bundleId: "com.apple.notes",
      isPrivateWindow: true,
      denylist: DENYLIST,
    }),
    { capture: "suppressed", reason: "os_excluded" },
  );
});
