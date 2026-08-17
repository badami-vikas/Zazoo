/**
 * K11b screen capture — the fail-closed distillation boundary for continuous
 * screen observation (TASK-054).
 *
 * Built BEFORE any frame grabber exists, for the same reason K11a's keystroke
 * boundary was (the K10 gate: the boundary is tests before raw ever flows).
 * Every function here is PURE — no ports, no I/O, no clock — so the desktop
 * provider and the API lane distil through the SAME logic, and the API
 * re-distils whatever arrives so a patched shell cannot widen what is stored.
 *
 * WHAT MAKES SCREEN DIFFERENT FROM KEYSTROKES, and why the shape still matches:
 *
 * A keystroke burst has one obvious sensitive class (the password field). A
 * screen frame has no such natural unit — everything visible is captured at
 * once, including windows belonging to apps the user never consented for, and
 * including whatever a colleague is showing on a shared call. So the gate
 * keys on the WINDOW, not the screen: a frame is only ever distilled as the
 * frontmost window it belongs to, and that window must positively identify
 * itself as capturable.
 *
 * THE ORDER OF REFUSALS (each independently sufficient):
 *   1. Denylisted app/domain  ⇒ NOTHING is emitted, not even a marker. A
 *      password manager on screen must not even reveal that it was open.
 *   2. OS-declared exclusion  ⇒ suppressed. macOS lets a window set
 *      `NSWindowSharingNone`; screen-recording APIs honour it and so do we.
 *      This is the direct analogue of `IsSecureEventInputEnabled` for K11a:
 *      an app telling the OS "never show me in a capture" is the strongest
 *      signal available, and it is checked before anything else about content.
 *   3. Private/incognito window ⇒ suppressed, structurally. The plan names
 *      "private windows structurally excluded"; K8's browser extension
 *      already refuses incognito, and a screen sensor must not become the
 *      back door around that refusal.
 *   4. Undeterminable window   ⇒ suppressed. UNKNOWN IS SENSITIVE, the same
 *      load-bearing default as K11a's undeterminable field role.
 *
 * RAW FRAMES ARE NOT AN OUTPUT OF THIS MODULE. `DistilledScreenEvent` has no
 * field that can carry pixels, an image handle, or a file path — so "raw never
 * persists" is structural rather than a convention someone must remember.
 *
 * ── THE CONTENT DECISION IS DELIBERATELY NOT MADE HERE ──────────────────────
 * The harness plan's use case for this sense is "post-meeting action drafts",
 * which implies deriving TEXT from what is on screen (OCR or a vision model).
 * That is the same content-vs-metadata question AP-157 answered for
 * keystrokes, and the plan records NO decision for screen. So this boundary
 * ships with derived text structurally OPT-IN and defaulting to OFF:
 * `SCREEN_CONTENT_ALLOWED_MODES` is an allowlist containing only
 * "derived_text", and the default policy is "metadata_only". Until a decision
 * exists, the safe direction is what runs, and enabling content is a
 * one-value change an approval row can authorize rather than a rewrite.
 */
import { redactSensitivePatterns, type Redaction } from "./input-capture.js";

/**
 * Whether the OS/window itself permits being captured. The desktop provider
 * maps platform state (macOS `CGWindowSharingType`, a failed window query, a
 * window that vanished mid-capture) onto exactly one of these before it
 * reaches core — core never sees a raw platform enum, and the mapping is
 * coarse so a new platform state cannot silently become capturable.
 *
 *  - "shareable"       — the window permits capture.
 *  - "excluded"        — the window declared itself un-shareable
 *                        (`NSWindowSharingNone`). NEVER captured. This is
 *                        what password managers and secure viewers set.
 *  - "undeterminable"  — the sharing state could not be read. UNKNOWN FAILS
 *                        CLOSED: treated exactly like "excluded".
 */
export type WindowShareability = "shareable" | "excluded" | "undeterminable";

/** The only shareability under which a frame may be distilled at all. A
 * single source of truth so the gate and its removal-fails test agree; adding
 * a state to `WindowShareability` without adding it here leaves it suppressed
 * by default. */
const CAPTURE_ALLOWED_SHAREABILITY: ReadonlySet<WindowShareability> =
  new Set<WindowShareability>(["shareable"]);

/**
 * How much of a captured frame may become stored content.
 *
 *  - "metadata_only" — app, window title, time. NO derived text. The default,
 *                      and what ships until a content decision is recorded.
 *  - "derived_text"  — text derived on-device from the frame (OCR/vision) may
 *                      be stored, subject to redaction. Requires an explicit
 *                      approval; see the module header.
 */
export type ScreenContentMode = "metadata_only" | "derived_text";

/** Opt-in allowlist, mirroring K11a's `CONTENT_ALLOWED_ROLES`. A mode absent
 * from this set stores no derived text, so a mode added later is metadata-only
 * until someone deliberately adds it here. */
const SCREEN_CONTENT_ALLOWED_MODES: ReadonlySet<ScreenContentMode> =
  new Set<ScreenContentMode>(["derived_text"]);

/** The shipped default. Deliberately the safe direction — see the header's
 * note on the undecided content question. */
export const DEFAULT_SCREEN_CONTENT_MODE: ScreenContentMode = "metadata_only";

/**
 * A user-editable denylist of apps (bundle id) and domains (for browser
 * windows) that are NEVER captured — not the content, not even the fact that
 * the window was on screen.
 *
 * Shares K11a's shape and its seed-floor discipline, but is a SEPARATE list
 * on purpose: consenting to have your typing watched and consenting to have
 * your screen watched are different decisions about different risks, and one
 * list would silently make the narrower consent widen the other.
 */
export interface ScreenCaptureDenylist {
  apps: readonly string[];
  domains: readonly string[];
}

/**
 * Password-manager bundle ids, re-merged on every save so a human cannot edit
 * their way into capturing a vault window. **Banks are deliberately NOT
 * seeded here either**, for the reason ADR-241 records: no bounded list of the
 * world's banking apps exists, and a partial list gives false comfort to
 * everyone missing from it. The floor promises exactly what it enforces.
 */
export const SEED_SCREEN_DENYLIST_APPS: readonly string[] = [
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.bitwarden.desktop",
  "com.lastpass.LastPass",
  "com.dashlane.Dashlane",
  "com.apple.keychainaccess",
];

/** Password-manager web vaults, for browser windows. Same reasoning. */
export const SEED_SCREEN_DENYLIST_DOMAINS: readonly string[] = [
  "1password.com",
  "bitwarden.com",
  "lastpass.com",
  "dashlane.com",
];

/**
 * Built through the same merge every save uses, NOT by copying the seed
 * arrays. Real macOS bundle ids are mixed-case (`com.lastpass.LastPass`) and
 * matching lowercases the probe, so a raw copy yields a default list that
 * silently fails to deny exactly the entries with capitals in them. The
 * sibling audio lane shipped that bug for one test run; one construction path
 * is the fix for both.
 */
export function defaultScreenCaptureDenylist(): ScreenCaptureDenylist {
  return mergeSeedFloor({});
}

/** Parse a stored denylist, failing CLOSED to the seed floor and re-merging
 * it on every read. Malformed storage can only ever ADD protection. */
export function readScreenCaptureDenylist(value: unknown): ScreenCaptureDenylist {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const readList = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
  return mergeSeedFloor({
    apps: readList(record["apps"]),
    domains: readList(record["domains"]),
  });
}

/** Re-merge the seed floor. Exported shape mirrors K11a so both lanes' editors
 * behave identically. */
export function mergeSeedFloor(edit: {
  apps?: readonly string[];
  domains?: readonly string[];
}): ScreenCaptureDenylist {
  const norm = (values: readonly string[] | undefined): string[] =>
    [...new Set((values ?? []).map((v) => v.trim().toLowerCase()).filter((v) => v.length > 0))];
  return {
    apps: [...new Set([...SEED_SCREEN_DENYLIST_APPS.map((a) => a.toLowerCase()), ...norm(edit.apps)])].sort(),
    domains: [...new Set([...SEED_SCREEN_DENYLIST_DOMAINS.map((d) => d.toLowerCase()), ...norm(edit.domains)])].sort(),
  };
}

/** Is this window's app or domain denied? Domain matching covers subdomains,
 * so denying `1password.com` also denies `my.1password.com`. */
export function isScreenDenylisted(
  denylist: ScreenCaptureDenylist,
  bundleId: string,
  host?: string,
): boolean {
  const app = bundleId.trim().toLowerCase();
  if (denylist.apps.some((entry) => entry === app)) return true;
  if (host === undefined) return false;
  const domain = host.trim().toLowerCase().replace(/^www\./, "");
  if (domain.length === 0) return false;
  return denylist.domains.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

/**
 * The gate verdict for one window. `capture: "frame"` is the ONLY value under
 * which anything about the frame may be stored; "suppressed" carries WHY so
 * the distilled event can be honest about what it withheld, and "none" means
 * emit nothing whatsoever.
 */
export type ScreenGateVerdict =
  | { capture: "frame" }
  | {
      capture: "suppressed";
      reason: "os_excluded" | "private_window" | "undeterminable_window";
    }
  | { capture: "none" };

/**
 * Decide what may be stored for one window, in the order the header sets out.
 * Denylist first (it outranks everything, including a perfectly shareable
 * window), then the OS's own exclusion, then private windows, then unknown.
 */
export function gateScreenCapture(ctx: {
  shareability: WindowShareability;
  bundleId: string;
  host?: string;
  isPrivateWindow: boolean;
  denylist: ScreenCaptureDenylist;
}): ScreenGateVerdict {
  if (isScreenDenylisted(ctx.denylist, ctx.bundleId, ctx.host)) {
    // Nothing at all — a vault window must not even reveal it was open.
    return { capture: "none" };
  }
  if (ctx.shareability === "excluded") {
    return { capture: "suppressed", reason: "os_excluded" };
  }
  // Checked BEFORE the shareability allowlist so a private window that is
  // technically shareable still suppresses: the browser's own incognito
  // promise outranks the window server's opinion about sharing.
  if (ctx.isPrivateWindow) {
    return { capture: "suppressed", reason: "private_window" };
  }
  if (!CAPTURE_ALLOWED_SHAREABILITY.has(ctx.shareability)) {
    return { capture: "suppressed", reason: "undeterminable_window" };
  }
  return { capture: "frame" };
}

/**
 * One observed frame, as the provider reports it. There is NO field for pixel
 * data, an image handle, or a path: the provider derives what it derives
 * on-device and this type cannot express the frame itself.
 */
export interface RawScreenFrame {
  appName: string;
  appBundleId: string;
  windowTitle: string;
  host?: string;
  shareability: WindowShareability;
  isPrivateWindow: boolean;
  /** Text derived on-device from the frame. Only ever STORED when the content
   * mode allows it; present-but-discarded otherwise, which is why the mode is
   * checked in the distiller and not only at the provider. */
  derivedText?: string;
}

/**
 * The distilled, storable event. Compare `DistilledInputEvent`: same shape of
 * promise, and the same deliberate absence of any raw-carrying field.
 */
export interface DistilledScreenEvent {
  /** Human-inspectable one-line summary — becomes the Memory summary. */
  summary: string;
  appName: string;
  appBundleId: string;
  /** Suppressed frames carry NO window title. A title is content: "Q3
   * layoffs.xlsx" in a window we refused to capture is exactly the leak
   * ADR-239 found for password length — metadata about what we refused is
   * itself sensitive. */
  windowTitle?: string;
  /** Present ONLY when the gate returned "frame" AND the content mode allows
   * derived text; already redacted. Absent = no content stored. */
  content?: string;
  disposition: "captured" | "suppressed";
  suppressionReason?: "os_excluded" | "private_window" | "undeterminable_window";
  /** What redaction removed from `content` (empty when none/suppressed). */
  redactions: Redaction[];
}

function shareabilityLabel(shareability: WindowShareability): string {
  switch (shareability) {
    case "excluded":
      return "a window that opted out of screen capture";
    case "undeterminable":
      return "an unidentified window";
    case "shareable":
      return "a window";
  }
}

/**
 * Distil one frame. Returns `null` for a denylisted window — nothing is
 * emitted, not even a marker.
 *
 * `contentMode` defaults to the safe direction so a caller that forgets to
 * pass it stores metadata only; there is deliberately no way to get derived
 * text by omission.
 */
export function distilScreenFrame(
  frame: RawScreenFrame,
  denylist: ScreenCaptureDenylist,
  contentMode: ScreenContentMode = DEFAULT_SCREEN_CONTENT_MODE,
): DistilledScreenEvent | null {
  const verdict = gateScreenCapture({
    shareability: frame.shareability,
    bundleId: frame.appBundleId,
    ...(frame.host !== undefined ? { host: frame.host } : {}),
    isPrivateWindow: frame.isPrivateWindow,
    denylist,
  });

  if (verdict.capture === "none") return null;

  if (verdict.capture === "suppressed") {
    // No window title, and no hint of how much was on screen — the same
    // "metadata about a refusal is sensitive" rule K11a learned the hard way.
    return {
      summary: `Screen activity in ${frame.appName} (${shareabilityLabel(frame.shareability)})`,
      appName: frame.appName,
      appBundleId: frame.appBundleId,
      disposition: "suppressed",
      suppressionReason: verdict.reason,
      redactions: [],
    };
  }

  // capture === "frame". The window title is storable; derived text is only
  // storable when the mode positively allows it.
  if (!SCREEN_CONTENT_ALLOWED_MODES.has(contentMode) || frame.derivedText === undefined) {
    return {
      summary: `Screen activity in ${frame.appName}: ${frame.windowTitle}`,
      appName: frame.appName,
      appBundleId: frame.appBundleId,
      windowTitle: frame.windowTitle,
      disposition: "captured",
      redactions: [],
    };
  }

  const { text, redactions } = redactSensitivePatterns(frame.derivedText);
  return {
    summary: `Screen activity in ${frame.appName}: ${frame.windowTitle}`,
    appName: frame.appName,
    appBundleId: frame.appBundleId,
    windowTitle: frame.windowTitle,
    content: text,
    disposition: "captured",
    redactions,
  };
}
