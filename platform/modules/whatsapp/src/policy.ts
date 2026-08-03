/**
 * v2 — rate and ban discipline for outbound automation.
 *
 * `send.ts` answers "is this recipient approved, and is this body the one that
 * was approved". This module answers a different and blunter question: "should
 * an automated system be sending this AT ALL, right now". The two compose;
 * neither substitutes for the other.
 *
 * ADR-158 is explicit that engine choice does nothing for behavioural detection,
 * which is what actually triggers bans. These are the rules that do. They are
 * real limits, deliberately low, and they REFUSE rather than warn.
 *
 * Everything here is pure: no clock, no RNG, no I/O, no transport. `now`, the
 * recipient's UTC offset, and the jitter draw are all supplied by the caller.
 * That is not only for testability — ADR-158 requires the ceiling to be
 * re-enforced in Rust, because a cap that only exists in the renderer is
 * bypassable and a cap that does not bind is not protection. Nothing in this
 * file depends on anything a second implementation could not do: integer and
 * float arithmetic, ISO-8601 instants, and string comparison.
 */

import {
  decideSend,
  type RecipientApproval,
  type SendGrant,
  type SendRequest,
} from "./send.js";

// ── Limits ───────────────────────────────────────────────────────────────────

export interface SendPolicyLimits {
  /**
   * Hard ceiling on automated sends per rolling 24 hours. Deliberately low.
   * A rolling window rather than a calendar day: a calendar reset invites a
   * burst at midnight, which is a worse behavioural signature than the steady
   * rate the cap is meant to produce.
   */
  dailyCap: number;
  /** At most one automated message to the same recipient per this many days. */
  recipientCooldownDays: number;
  /** Bodies at or above this similarity count as "the same message". */
  similarityThreshold: number;
  /** How many DISTINCT recipients may receive near-identical text in the window. */
  similarBodyRecipientLimit: number;
  /** Lookback for the near-identical check. */
  similarBodyWindowDays: number;
  /** Sends allowed on the first day after linking, and the daily increment. */
  warmUpFirstDayCap: number;
  warmUpDailyIncrement: number;
  /** Recipient-local send window, 24h clock, `[startHour, endHour)`. */
  businessHourStart: number;
  businessHourEnd: number;
  /** Human-pacing delay bounds, seconds. */
  minJitterSeconds: number;
  maxJitterSeconds: number;
  /**
   * When true, the recipient must have written the FIRST message in the thread,
   * not merely have written at some point. Off by default — see
   * `evaluateSendPolicy`'s consent-gate note.
   */
  requireRecipientInitiated: boolean;
}

/**
 * The shipped ceiling. ADR-158 asks for 30–50; 30 is the low end of the range
 * the owner approved, chosen because the cost of being too conservative is a
 * slower campaign and the cost of being too permissive is a permanent,
 * unappealable ban on a personal number.
 *
 * These numbers are the contract a Rust-side enforcer must mirror. If they
 * diverge, the renderer's copy is the advisory one and Rust's is the real one.
 */
export const SEND_POLICY_LIMITS: SendPolicyLimits = {
  dailyCap: 30,
  recipientCooldownDays: 7,
  similarityThreshold: 0.7,
  similarBodyRecipientLimit: 5,
  similarBodyWindowDays: 7,
  warmUpFirstDayCap: 5,
  warmUpDailyIncrement: 5,
  businessHourStart: 9,
  businessHourEnd: 21,
  minJitterSeconds: 30,
  maxJitterSeconds: 900,
  requireRecipientInitiated: false,
};

// ── Inputs ───────────────────────────────────────────────────────────────────

/** Who has written into this thread. Facts, from the Local Plane message store. */
export interface ThreadActivity {
  inboundCount: number;
  outboundCount: number;
  firstInboundAt?: string;
  lastInboundAt?: string;
  firstOutboundAt?: string;
  lastOutboundAt?: string;
}

/** One message automation has already sent. Manual sends are not counted. */
export interface AutomatedSendRecord {
  recipientKey: string;
  /** ISO-8601. */
  sentAt: string;
  body: string;
}

/**
 * The halt state. `halted` is sticky by construction: there is no expiry, no
 * timeout, and no "resume after N minutes" anywhere in this module. The only
 * transition out is `rearmAutomation`, which requires a named human.
 */
export interface KillSwitchState {
  status: "armed" | "halted";
  haltedAt?: string;
  reason?: string;
  rearmedAt?: string;
  /** The human who re-armed. Never an Agent id. */
  rearmedBy?: string;
}

export interface AccountState {
  /** ISO-8601 — when this WhatsApp account was linked. Drives the warm-up ramp. */
  linkedAt: string;
  killSwitch: KillSwitchState;
}

export interface SendPolicyContext {
  /** ISO-8601. This module has no clock. */
  now: string;
  account: AccountState;
  thread: ThreadActivity;
  /** Automated sends across ALL recipients, for the cap and similarity checks. */
  history: readonly AutomatedSendRecord[];
  /**
   * The recipient's local offset from UTC in minutes (e.g. +330 for IST).
   *
   * An offset, not an IANA zone name: resolving a zone needs a timezone
   * database, which is data rather than policy and is not something a second
   * implementation of this logic should have to agree with us about. Resolving
   * the zone is the caller's job. Absent means the recipient's local time is
   * unknown, and the hours rule cannot be applied — see `evaluateSendPolicy`.
   */
  recipientUtcOffsetMinutes?: number;
  /**
   * A value in [0, 1) supplied by the caller, used for jitter. Passed in rather
   * than drawn here so the decision stays a pure function of its inputs.
   */
  jitterDraw: number;
  limits?: Partial<SendPolicyLimits>;
}

// ── Outputs ──────────────────────────────────────────────────────────────────

export type SendPolicyRule =
  | "kill_switch"
  | "consent_gate"
  | "daily_cap"
  | "recipient_cooldown"
  | "near_identical_body"
  | "business_hours"
  | "unknown_recipient_time";

export type SendPolicyDecision =
  /**
   * Permitted. `delaySeconds` is a human-pacing delay, not a disguise: if the
   * underlying behaviour is bulk outreach, no timing randomisation makes it
   * acceptable, and the rules above are what decide whether it is acceptable.
   * The delay exists so automated sending is actually paced like a person
   * typing, rather than firing the instant a job runs.
   */
  | { status: "allowed"; delaySeconds: number }
  /** Not now, but the same message may become sendable later. */
  | { status: "deferred"; rule: SendPolicyRule; reason: string; earliestAt: string }
  /** Not sendable. Waiting does not fix it. */
  | { status: "refused"; rule: SendPolicyRule; reason: string };

// ── Similarity ───────────────────────────────────────────────────────────────

/**
 * Case-folded, whitespace-collapsed, punctuation-stripped text. Two mail-merge
 * bodies differing only in a name and a comma must normalize to nearly the same
 * string, or the similarity check misses the exact case it exists for.
 */
export function normalizeBody(body: string): string {
  return body
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/**
 * Jaccard index over character trigrams, in [0, 1].
 *
 * Chosen over the alternatives on specific grounds:
 *
 *  - **Exact hashing** (what `bodyDigest` does) is defeated by inserting the
 *    recipient's first name, which is precisely what bulk outreach does. It
 *    would catch nothing real.
 *  - **Levenshtein** is O(n·m) on bodies up to 4,096 characters and its score is
 *    dominated by length difference, so a template with one long and one short
 *    substitution scores as "different" when a reader would call it identical.
 *  - **Trigram Jaccard** is order-insensitive, robust to small edits and
 *    substitutions, linear, and needs no dictionary or tuning per language —
 *    which matters for a multilingual address book.
 *
 * It is also the same family of measure as `pg_trgm`'s `similarity()`, so the
 * message store and this policy describe "similar" the same way, and it is
 * trivially reimplementable in Rust for the enforcing layer.
 *
 * Both bodies empty counts as identical: two empty automated messages are the
 * same message, and `send.ts` refuses empty bodies anyway.
 */
export function bodySimilarity(a: string, b: string): number {
  const left = trigrams(normalizeBody(a));
  const right = trigrams(normalizeBody(b));
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

// ── Time helpers (portable arithmetic only) ──────────────────────────────────

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function instant(iso: string): number {
  const value = Date.parse(iso);
  if (Number.isNaN(value)) throw new Error(`"${iso}" is not an ISO-8601 instant`);
  return value;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Hour-of-day 0–23 in the recipient's local time. */
export function localHour(nowIso: string, utcOffsetMinutes: number): number {
  const shifted = instant(nowIso) + utcOffsetMinutes * MS_PER_MINUTE;
  const hour = Math.floor(shifted / MS_PER_HOUR) % 24;
  return hour < 0 ? hour + 24 : hour;
}

/** The next instant at which the recipient's local hour is `hour`. */
function nextLocalHour(
  nowIso: string,
  utcOffsetMinutes: number,
  hour: number,
): string {
  const nowMs = instant(nowIso);
  const shifted = nowMs + utcOffsetMinutes * MS_PER_MINUTE;
  const dayStart = Math.floor(shifted / MS_PER_DAY) * MS_PER_DAY;
  let target = dayStart + hour * MS_PER_HOUR;
  if (target <= shifted) target += MS_PER_DAY;
  return iso(target - utcOffsetMinutes * MS_PER_MINUTE);
}

// ── Warm-up ──────────────────────────────────────────────────────────────────

/**
 * The cap in force today. A freshly linked device that immediately sends at the
 * steady-state rate is one of the clearest automation signatures there is, so
 * the allowance starts small and climbs.
 */
export function effectiveDailyCap(
  nowIso: string,
  linkedAtIso: string,
  limits: SendPolicyLimits,
): number {
  const days = Math.floor((instant(nowIso) - instant(linkedAtIso)) / MS_PER_DAY);
  if (days < 0) return 0; // A link date in the future is not a warm account.
  const ramped = limits.warmUpFirstDayCap + days * limits.warmUpDailyIncrement;
  return Math.max(0, Math.min(limits.dailyCap, ramped));
}

// ── Kill switch ──────────────────────────────────────────────────────────────

/**
 * Halt all automation. Any WhatsApp-side warning, unexpected disconnect, or
 * delivery anomaly calls this. Halting an already-halted switch keeps the
 * ORIGINAL halt reason and time: the first anomaly is the one worth reading,
 * and later ones must not overwrite it.
 */
export function haltAutomation(
  state: KillSwitchState,
  reason: string,
  atIso: string,
): KillSwitchState {
  if (state.status === "halted") return state;
  return { status: "halted", haltedAt: atIso, reason };
}

/**
 * The ONLY way back to `armed`, and it takes a named human.
 *
 * There is deliberately no time-based, count-based, or "looks fine now"
 * transition anywhere in this module. Automation that resumes on its own after
 * a WhatsApp warning is automation that walks straight back into the behaviour
 * that produced the warning.
 */
export function rearmAutomation(
  state: KillSwitchState,
  rearmedBy: string,
  atIso: string,
): KillSwitchState {
  if (state.status === "armed") return state;
  const human = rearmedBy.trim();
  if (!human) {
    throw new Error("Re-arming automation requires the human who authorised it");
  }
  return { status: "armed", rearmedAt: atIso, rearmedBy: human };
}

// ── The gate ─────────────────────────────────────────────────────────────────

/**
 * Apply the discipline. Pure; returns a decision, performs nothing.
 *
 * Rule order is deliberate. Everything that REFUSES is evaluated before
 * anything that DEFERS, so a message that must never be sent is never reported
 * as "try again in four hours".
 */
export function evaluateSendPolicy(
  recipientKey: string,
  body: string,
  context: SendPolicyContext,
): SendPolicyDecision {
  const limits: SendPolicyLimits = { ...SEND_POLICY_LIMITS, ...context.limits };
  const nowMs = instant(context.now);

  // 1. Kill switch. Nothing else is considered while halted.
  if (context.account.killSwitch.status === "halted") {
    const reason = context.account.killSwitch.reason ?? "an unexplained anomaly";
    return {
      status: "refused",
      rule: "kill_switch",
      reason: `Automation is halted (${reason}) and needs a person to re-arm it.`,
    };
  }

  // 2. Consent gate. The strongest ban trigger and the most important rule here:
  //    automation never opens a conversation. The binding fact is that the
  //    recipient has written into this thread at all — a reply IS the consent
  //    signal, so a thread the owner opened by hand and the recipient answered
  //    is consented. `requireRecipientInitiated` tightens this to the literal
  //    "they sent the first message" reading when a caller wants it.
  if (context.thread.inboundCount <= 0 || !context.thread.firstInboundAt) {
    return {
      status: "refused",
      rule: "consent_gate",
      reason:
        "This recipient has never written in this thread, so an automated message would be a first contact.",
    };
  }
  if (limits.requireRecipientInitiated && context.thread.firstOutboundAt) {
    if (instant(context.thread.firstOutboundAt) < instant(context.thread.firstInboundAt)) {
      return {
        status: "refused",
        rule: "consent_gate",
        reason: "This thread was opened by us, not by the recipient.",
      };
    }
  }

  // 3. Near-identical bodies across recipients. Bulk-identical content is the
  //    clearest spam signature there is, and unlike the timing rules it cannot
  //    be waited out — the same text will still be the same text tomorrow.
  const similarityWindowStart =
    nowMs - limits.similarBodyWindowDays * MS_PER_DAY;
  const similarRecipients = new Set<string>();
  for (const record of context.history) {
    if (instant(record.sentAt) < similarityWindowStart) continue;
    if (record.recipientKey === recipientKey) continue;
    if (bodySimilarity(record.body, body) >= limits.similarityThreshold) {
      similarRecipients.add(record.recipientKey);
    }
  }
  if (similarRecipients.size >= limits.similarBodyRecipientLimit) {
    return {
      status: "refused",
      rule: "near_identical_body",
      reason:
        `${similarRecipients.size} other recipients already received substantially this text in the ` +
        `last ${limits.similarBodyWindowDays} days; the limit is ${limits.similarBodyRecipientLimit}.`,
    };
  }

  // 4. Per-recipient cooldown.
  const cooldownMs = limits.recipientCooldownDays * MS_PER_DAY;
  let lastToRecipient = Number.NEGATIVE_INFINITY;
  for (const record of context.history) {
    if (record.recipientKey !== recipientKey) continue;
    lastToRecipient = Math.max(lastToRecipient, instant(record.sentAt));
  }
  if (lastToRecipient > Number.NEGATIVE_INFINITY && nowMs - lastToRecipient < cooldownMs) {
    return {
      status: "deferred",
      rule: "recipient_cooldown",
      reason: `This recipient already had an automated message in the last ${limits.recipientCooldownDays} days.`,
      earliestAt: iso(lastToRecipient + cooldownMs),
    };
  }

  // 5. Rolling 24h cap, warmed up. Enforced, not advisory.
  const cap = effectiveDailyCap(context.now, context.account.linkedAt, limits);
  const windowStart = nowMs - MS_PER_DAY;
  const inWindow = context.history
    .map((record) => instant(record.sentAt))
    .filter((sentAt) => sentAt > windowStart && sentAt <= nowMs)
    .sort((a, b) => a - b);
  if (inWindow.length >= cap) {
    // The window frees a slot when its oldest member ages out. With cap 0 (an
    // account linked in the future, or a zero warm-up) nothing ages out, so
    // fall back to the end of the window.
    const oldest = inWindow[inWindow.length - cap] ?? inWindow[0];
    return {
      status: "deferred",
      rule: "daily_cap",
      reason: `${inWindow.length} automated messages were sent in the last 24 hours; the cap is ${cap}.`,
      earliestAt: iso((oldest ?? windowStart) + MS_PER_DAY),
    };
  }

  // 6. Recipient-local hours. No night sends — a 3am message is both rude and a
  //    strong automation tell.
  if (context.recipientUtcOffsetMinutes === undefined) {
    return {
      status: "refused",
      rule: "unknown_recipient_time",
      reason:
        "The recipient's local time is unknown, so this send cannot be confirmed to fall in waking hours.",
    };
  }
  const hour = localHour(context.now, context.recipientUtcOffsetMinutes);
  if (hour < limits.businessHourStart || hour >= limits.businessHourEnd) {
    return {
      status: "deferred",
      rule: "business_hours",
      reason:
        `It is ${hour}:00 for the recipient; automated sending runs ` +
        `${limits.businessHourStart}:00–${limits.businessHourEnd}:00 their time.`,
      earliestAt: nextLocalHour(
        context.now,
        context.recipientUtcOffsetMinutes,
        limits.businessHourStart,
      ),
    };
  }

  return { status: "allowed", delaySeconds: jitterSeconds(context.jitterDraw, limits) };
}

/**
 * Map a caller-supplied draw in [0, 1) onto the pacing window.
 *
 * To say it once more where it is implemented: this is pacing, not concealment.
 * A draw outside [0, 1) is clamped rather than rejected, so a caller's bad RNG
 * degrades into a valid delay instead of an exception on a send path.
 */
export function jitterSeconds(draw: number, limits: SendPolicyLimits): number {
  const safe = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 0.999999) : 0;
  const span = limits.maxJitterSeconds - limits.minJitterSeconds;
  return limits.minJitterSeconds + Math.floor(safe * (span + 1));
}

// ── Composition ──────────────────────────────────────────────────────────────

export type AutomatedSendDecision =
  | { status: "allowed"; request: SendRequest; grant: SendGrant; delaySeconds: number }
  | { status: "needs_approval"; request: SendRequest; reason: string }
  | { status: "deferred"; rule: SendPolicyRule; reason: string; earliestAt: string }
  | { status: "refused"; reason: string; rule?: SendPolicyRule };

/**
 * The whole outbound gate for an AGENT-initiated send: discipline plus consent.
 *
 * The order is the point. Policy refusals are evaluated BEFORE `decideSend`, so
 * a first-contact message or a send during a halt is never turned into an
 * approval prompt. Asking a human to approve something the system will refuse
 * anyway is how people learn to click through prompts, and the consent gate is
 * exactly the prompt that must never become reflexive.
 *
 * Then `decideSend` runs, because a human approval that has been withdrawn
 * outranks any amount of good behaviour. Only after both pass does a deferral
 * (cooldown, cap, hours) apply — those are timing, and timing is the last thing
 * that should speak.
 */
export function decideAutomatedSend(
  request: SendRequest,
  approvals: readonly RecipientApproval[],
  context: SendPolicyContext,
): AutomatedSendDecision {
  const policy = evaluateSendPolicy(request.recipientKey, request.body, context);
  if (policy.status === "refused") {
    return { status: "refused", reason: policy.reason, rule: policy.rule };
  }

  const consent = decideSend(request, approvals);
  if (consent.status === "refused") {
    return { status: "refused", reason: consent.reason };
  }
  if (consent.status === "needs_approval") {
    return {
      status: "needs_approval",
      request: consent.request,
      reason: consent.reason,
    };
  }

  if (policy.status === "deferred") {
    return {
      status: "deferred",
      rule: policy.rule,
      reason: policy.reason,
      earliestAt: policy.earliestAt,
    };
  }

  return {
    status: "allowed",
    request: consent.request,
    grant: consent.grant,
    delaySeconds: policy.delaySeconds,
  };
}
