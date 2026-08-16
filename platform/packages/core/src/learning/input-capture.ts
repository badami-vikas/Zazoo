/**
 * K11 input capture — the fail-closed distillation boundary for continuous
 * keystroke/click capture (TASK-054, AP-157: FULL CONTENT behind this
 * boundary).
 *
 * This is the most invasive sensor in the product, so its guarantees are
 * executable here rather than asserted in a doc (the K10 gate ordering: the
 * boundary is tests before raw ever flows). Everything in this module is a
 * PURE function — no ports, no I/O, no clock — so the desktop Rust provider
 * and the API lane both distil through the SAME logic and it is exhaustively
 * unit-testable with no OS, no event tap, no model.
 *
 * The promise (mirrors the plan's "input-capture boundary, defense in depth"):
 * the actual typed characters are distilled into a stored event ONLY when the
 * field-role gate is clear AND the app is not denylisted. In every other case
 * — a secure/password field, an UNDETERMINABLE field role (unknown =
 * sensitive), or a denylisted app — the content is suppressed to at most
 * "typed in <role> in <app>", never the characters. Raw keystrokes are never
 * an output of this module: `distilLKeystrokeBurst` returns a
 * `DistilledInputEvent`, which has no field that can carry the raw stream, so
 * "raw never persists" is structural, not a convention. A pattern-redaction
 * backstop then strips card numbers, SSNs, long digit runs and high-entropy
 * tokens from content that WAS captured, because a clear field role does not
 * make a pasted card number safe to store.
 */

/**
 * The coarse field-role category the gate decides on. The desktop provider
 * maps the raw platform accessibility role (macOS AXSecureTextField,
 * AXTextField, AXTextArea, a null/failed AX read, …) onto exactly one of
 * these three before it reaches core — core never sees a raw AX string, and
 * the mapping is deliberately coarse so a new platform role cannot silently
 * become "capturable" by default.
 *
 *  - "content_ok"      — an ordinary editable text field; content MAY be
 *                        captured (subject to the denylist + redaction).
 *  - "secure"          — a password/secure-entry field; content is NEVER
 *                        captured. (macOS `EnableSecureEventInput` usually
 *                        stops the event tap seeing these at all — this is the
 *                        second line, for the cases where it does not.)
 *  - "undeterminable"  — the focused-element role could not be read (no
 *                        Accessibility grant, an AX read failure, a
 *                        non-standard control). UNKNOWN FAILS CLOSED: treated
 *                        exactly like "secure". This is the load-bearing
 *                        default — the absence of a determinable role is the
 *                        suppression trigger.
 */
export type FieldRole = "content_ok" | "secure" | "undeterminable";

/** The only field roles under which characters may be captured. A single
 * source of truth so the gate and its removal-fails test agree; adding a role
 * to `FieldRole` without adding it here leaves it suppressed by default. */
const CONTENT_ALLOWED_ROLES: ReadonlySet<FieldRole> = new Set<FieldRole>(["content_ok"]);

/**
 * A user-editable denylist of apps (by bundle id) and domains (for the
 * browser) that are NEVER captured — not the content, not even the fact that
 * typing happened. A DENYLIST (deny-specific, allow-the-rest) is the right
 * shape here because input capture is ambient across every app once consented;
 * the seed set below is the non-negotiable floor (password managers ONLY —
 * see the note on SEED_DENYLIST_DOMAINS about why banks are NOT seeded),
 * to which the user adds. Matching is case-insensitive and, for domains,
 * label-boundary suffix aware ("chase.com" denies "secure.chase.com" but not
 * "notchase.com"), the same discipline K8's browser policy uses.
 */
export interface InputCaptureDenylist {
  /** Lowercased app bundle identifiers, e.g. "com.apple.keychainaccess". */
  apps: readonly string[];
  /** Lowercased registrable domains, e.g. "chase.com". */
  domains: readonly string[];
}

/** The seed denylist floor. These are denied even before the user edits the
 * list, and are re-merged on every save — so the UI presents them as LOCKED
 * rather than editable, because a control that accepts an edit and then
 * silently discards it lies about the state of the system. */
export const SEED_DENYLIST_APPS: readonly string[] = [
  "com.apple.keychainaccess",
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.agilebits.onepassword-osx",
  "com.bitwarden.desktop",
  "com.dashlane.dashlanephonefinal",
  "in.sinew.walletx", // Enpass
  "com.lastpass.lastpassmacdesktop",
  "com.keepassxc.keepassxc",
];

/**
 * Password-manager web vaults. **Banks are deliberately NOT seeded**, and the
 * product must not claim they are: there is no bounded, maintainable list of
 * the world's banking domains, and a partial list is worse than none — a user
 * whose bank is missing reads "banks are always excluded" and trusts a promise
 * we never kept. (Caught by the visual-critic pass: the copy claimed banking
 * cover this list never had.) The seed floor promises exactly what it
 * enforces; the UI asks the user to add their own bank and says why.
 */
export const SEED_DENYLIST_DOMAINS: readonly string[] = [
  "1password.com",
  "bitwarden.com",
  "lastpass.com",
  "dashlane.com",
];

export function defaultInputCaptureDenylist(): InputCaptureDenylist {
  return { apps: [...SEED_DENYLIST_APPS], domains: [...SEED_DENYLIST_DOMAINS] };
}

/** A bundle id is `label(.label)+` — lowercase letters/digits/hyphens per
 * dot-segment. A domain is `label(.label)+` too but we validate it as a bare
 * hostname (no scheme, no path, no port). Both reject anything path- or
 * space-bearing so a malformed entry fails LOUDLY at the edit boundary rather
 * than silently never matching. */
const BUNDLE_ID_RE = /^[a-z0-9]+(?:[-][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-][a-z0-9]+)*)+$/;
const DOMAIN_RE = /^[a-z0-9]+(?:[-][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-][a-z0-9]+)*)+$/;

export function isValidBundleId(value: string): boolean {
  return BUNDLE_ID_RE.test(normalizeToken(value));
}
export function isValidDenyDomain(value: string): boolean {
  return DOMAIN_RE.test(normalizeToken(value));
}

/**
 * Parse a stored denylist, failing CLOSED to the SEED FLOOR: a missing or
 * malformed row is not "capture everything", it is the seed denylist (password
 * managers still protected). Unknown/invalid entries are dropped, and
 * the seed floor is always merged in so a user cannot, by editing raw storage,
 * end up with a password manager capturable. Entries are normalized and
 * de-duplicated.
 */
export function readInputCaptureDenylist(value: unknown): InputCaptureDenylist {
  const seedApps = new Set(SEED_DENYLIST_APPS.map(normalizeToken));
  const seedDomains = new Set(SEED_DENYLIST_DOMAINS.map(normalizeToken));
  const apps = new Set(seedApps);
  const domains = new Set(seedDomains);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const rawApps = record["apps"];
    if (Array.isArray(rawApps)) {
      for (const entry of rawApps) {
        if (typeof entry === "string" && isValidBundleId(entry)) apps.add(normalizeToken(entry));
      }
    }
    const rawDomains = record["domains"];
    if (Array.isArray(rawDomains)) {
      for (const entry of rawDomains) {
        if (typeof entry === "string" && isValidDenyDomain(entry)) domains.add(normalizeToken(entry));
      }
    }
  }
  return { apps: [...apps].sort(), domains: [...domains].sort() };
}

/**
 * Build a denylist from a user edit, refusing invalid entries by NAMING them
 * (never silently dropping — the same discipline K8's domain-policy editor
 * uses) and always keeping the seed floor. Returns the normalized denylist
 * plus any rejected raw entries for the UI to surface.
 */
export function withInputCaptureDenylist(edit: {
  apps: readonly string[];
  domains: readonly string[];
}): { denylist: InputCaptureDenylist; rejected: string[] } {
  const rejected: string[] = [];
  const apps = new Set(SEED_DENYLIST_APPS.map(normalizeToken));
  const domains = new Set(SEED_DENYLIST_DOMAINS.map(normalizeToken));
  for (const entry of edit.apps) {
    if (typeof entry === "string" && isValidBundleId(entry)) apps.add(normalizeToken(entry));
    else if (entry.trim().length > 0) rejected.push(entry);
  }
  for (const entry of edit.domains) {
    if (typeof entry === "string" && isValidDenyDomain(entry)) domains.add(normalizeToken(entry));
    else if (entry.trim().length > 0) rejected.push(entry);
  }
  return { denylist: { apps: [...apps].sort(), domains: [...domains].sort() }, rejected };
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

/** Label-boundary suffix match: `host` is covered by `domain` iff it equals
 * the domain or ends with "." + domain. Prevents "notchase.com" matching
 * "chase.com" while still denying "secure.chase.com". */
function domainCovers(domain: string, host: string): boolean {
  const d = normalizeToken(domain);
  const h = normalizeToken(host);
  if (!d || !h) return false;
  return h === d || h.endsWith("." + d);
}

/** Is this app (and optional browser host) on the denylist? */
export function isDenylisted(
  denylist: InputCaptureDenylist,
  appBundleId: string,
  host?: string,
): boolean {
  const app = normalizeToken(appBundleId);
  if (app && denylist.apps.some((entry) => normalizeToken(entry) === app)) return true;
  if (host && denylist.domains.some((entry) => domainCovers(entry, host))) return true;
  return false;
}

/**
 * The gate verdict for one focus context. `capture: "content"` is the ONLY
 * verdict under which characters may be stored; every other path is a reason
 * the content was withheld, carried so the distilled event can honestly say
 * why (never a silent drop).
 */
export type InputGateVerdict =
  | { capture: "content" }
  | { capture: "suppressed"; reason: "secure_field" | "undeterminable_field" | "denylisted" }
  | { capture: "none"; reason: "denylisted" };

/**
 * THE gate. Given the focus context, decide whether characters may be
 * captured. Order matters and is fail-closed at every branch:
 *   1. A denylisted app/host ⇒ NOTHING is emitted at all (`capture: "none"`),
 *      not even a "typed here" marker — a bank must not even reveal that the
 *      user was typing.
 *   2. A secure or UNDETERMINABLE field ⇒ suppressed to a no-character marker.
 *   3. Only a determinable content_ok field in a non-denylisted app ⇒ content.
 */
export function gateInputCapture(ctx: {
  fieldRole: FieldRole;
  appBundleId: string;
  host?: string;
  denylist: InputCaptureDenylist;
}): InputGateVerdict {
  if (isDenylisted(ctx.denylist, ctx.appBundleId, ctx.host)) {
    return { capture: "none", reason: "denylisted" };
  }
  if (ctx.fieldRole === "secure") {
    return { capture: "suppressed", reason: "secure_field" };
  }
  if (!CONTENT_ALLOWED_ROLES.has(ctx.fieldRole)) {
    // Any role not explicitly allowed — including "undeterminable" and any
    // future FieldRole member added without opting it in — suppresses. Unknown
    // is sensitive.
    return { capture: "suppressed", reason: "undeterminable_field" };
  }
  return { capture: "content" };
}

// ---------------------------------------------------------------------------
// Pattern redaction backstop
// ---------------------------------------------------------------------------

/** What a redaction removed, for the inspectable audit trail. */
export interface Redaction {
  kind: "card_number" | "ssn" | "long_digit_run" | "high_entropy_token";
  /** The placeholder that replaced it in the stored text. */
  placeholder: string;
}

const PLACEHOLDER: Record<Redaction["kind"], string> = {
  card_number: "[redacted:card]",
  ssn: "[redacted:ssn]",
  long_digit_run: "[redacted:digits]",
  high_entropy_token: "[redacted:token]",
};

/** Luhn check so a 13–19 digit run is only called a card number when it could
 * actually be one — avoids redacting long ID numbers as "cards" (they still
 * fall to the long-digit-run rule, but labelled honestly). */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Order matters: card (Luhn 13–19) and SSN are tried before the generic
// long-digit-run so the specific label wins; the high-entropy token rule runs
// last on what remains.
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const DIGIT_GROUP_RE = /\b(?:\d[ -]?){13,19}\b/g; // spaced/dashed card-like groups
const LONG_DIGIT_RE = /\b\d{9,}\b/g;
const HIGH_ENTROPY_RE = /\b(?=[A-Za-z0-9+/_-]*[A-Za-z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{20,}\b/g;

/**
 * Strip sensitive literals from content that WAS captured. Returns the
 * redacted text plus the list of what was removed (for the inspectable
 * Memory). A clear field role does not make a pasted card number safe to
 * store — this is the backstop the plan names.
 */
export function redactSensitivePatterns(text: string): { text: string; redactions: Redaction[] } {
  const redactions: Redaction[] = [];
  let out = text;

  out = out.replace(DIGIT_GROUP_RE, (match) => {
    const digits = match.replace(/[ -]/g, "");
    const kind: Redaction["kind"] = passesLuhn(digits) ? "card_number" : "long_digit_run";
    redactions.push({ kind, placeholder: PLACEHOLDER[kind] });
    return PLACEHOLDER[kind];
  });
  out = out.replace(SSN_RE, () => {
    redactions.push({ kind: "ssn", placeholder: PLACEHOLDER.ssn });
    return PLACEHOLDER.ssn;
  });
  out = out.replace(LONG_DIGIT_RE, () => {
    redactions.push({ kind: "long_digit_run", placeholder: PLACEHOLDER.long_digit_run });
    return PLACEHOLDER.long_digit_run;
  });
  out = out.replace(HIGH_ENTROPY_RE, () => {
    redactions.push({ kind: "high_entropy_token", placeholder: PLACEHOLDER.high_entropy_token });
    return PLACEHOLDER.high_entropy_token;
  });

  return { text: out, redactions };
}

// ---------------------------------------------------------------------------
// Distillation — the single boundary from a raw burst to a stored event
// ---------------------------------------------------------------------------

/**
 * A raw input burst as the desktop provider observes it IN MEMORY. This type
 * exists only as the INPUT to distillation; it is never persisted and never
 * an output of this module. `text` is the concatenated typed characters for
 * the burst; the provider holds it only long enough to call `distil…`.
 */
export interface RawInputBurst {
  /** The characters typed in this burst (in-memory only). */
  text: string;
  /** Number of key events in the burst (kept even when text is suppressed —
   * the count is not sensitive and powers "typed ~40 chars" summaries). */
  keyCount: number;
  fieldRole: FieldRole;
  appBundleId: string;
  appName: string;
  /** Browser host when the frontmost app is a browser, for domain denylisting. */
  host?: string;
}

/**
 * The DISTILLED event — the only thing that leaves this module and the only
 * thing eligible to become an inspectable Memory row. It has NO field that can
 * carry the raw burst: when content was captured it carries the redacted text;
 * when suppressed it carries only the marker and the reason. "Raw never
 * persists" is enforced by this type shape.
 */
export interface DistilledInputEvent {
  /** Human-inspectable one-line summary — becomes the Memory content. */
  summary: string;
  appBundleId: string;
  appName: string;
  /**
   * Present ONLY for a CAPTURED burst. Deliberately absent when suppressed:
   * for a secure or undeterminable field the character count is itself
   * sensitive — "typed 8 characters in a secure field" publishes the length
   * of a password, which materially narrows a brute-force space, and it
   * would be written into a durable, inspectable Memory row. Under this
   * module's own "unknown is sensitive" rule the count is withheld with the
   * characters. (Found by the red-team pass, not by review — the first
   * implementation leaked the exact length here.)
   */
  keyCount?: number;
  /** Present ONLY when the gate returned "content": the redacted typed text.
   * Absent (undefined) whenever content was suppressed. */
  content?: string;
  /** How the gate resolved, carried for the audit trail. */
  disposition: "captured" | "suppressed";
  suppressionReason?: "secure_field" | "undeterminable_field" | "denylisted";
  /** What redaction removed from captured content (empty when none/suppressed). */
  redactions: Redaction[];
}

/** A short, honest field descriptor for suppressed-event summaries. */
function roleLabel(role: FieldRole): string {
  switch (role) {
    case "secure":
      return "a secure field";
    case "content_ok":
      return "a text field";
    case "undeterminable":
    default:
      return "an unknown field";
  }
}

/**
 * The one boundary function. Takes a raw burst (held in memory by the
 * provider) and returns the distilled event, or `null` when the gate says
 * emit nothing at all (denylisted). The provider MUST drop its reference to
 * the raw burst immediately after this returns — this function copies out only
 * what may persist.
 */
export function distilKeystrokeBurst(
  burst: RawInputBurst,
  denylist: InputCaptureDenylist,
): DistilledInputEvent | null {
  const verdict = gateInputCapture({
    fieldRole: burst.fieldRole,
    appBundleId: burst.appBundleId,
    ...(burst.host !== undefined ? { host: burst.host } : {}),
    denylist,
  });

  if (verdict.capture === "none") {
    // Denylisted: nothing is emitted at all, not even a marker.
    return null;
  }

  if (verdict.capture === "suppressed") {
    // No character count here, by design — see `DistilledInputEvent.keyCount`.
    // The event says typing HAPPENED and where, never how much.
    return {
      summary: `Typed in ${roleLabel(burst.fieldRole)} in ${burst.appName}`,
      appBundleId: burst.appBundleId,
      appName: burst.appName,
      disposition: "suppressed",
      suppressionReason: verdict.reason,
      redactions: [],
    };
  }

  // capture === "content": redact, then store the redacted text only.
  const { text, redactions } = redactSensitivePatterns(burst.text);
  return {
    summary: `Typed in ${burst.appName}: ${text}`,
    appBundleId: burst.appBundleId,
    appName: burst.appName,
    keyCount: burst.keyCount,
    content: text,
    disposition: "captured",
    redactions,
  };
}
