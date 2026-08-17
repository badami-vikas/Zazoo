/**
 * K11c ambient audio — the fail-closed distillation boundary for microphone
 * and system-audio capture (TASK-054).
 *
 * Built before any capture backend exists, per the K10 gate. Pure functions
 * only; the desktop provider and the API lane distil through the same logic.
 *
 * ── WHY THIS BOUNDARY IS SHAPED UNLIKE THE OTHER TWO ────────────────────────
 *
 * K11a and K11b protect the USER from over-capture of the user's own activity.
 * The user consents, and the boundary's job is to hold that consent to its
 * promises. Audio breaks that model, and no amount of care inside this file
 * fixes it:
 *
 *   **The person speaking may not be the person who consented.**
 *
 * A colleague on a call, someone in the room, a voice on a speakerphone —
 * none of them agreed to anything. This product's whole capture model is
 * per-user consent; the input lane's API even refuses a non-Human identity
 * with "only that user's own identity may report it". Ambient audio is the
 * one sense where the consenting party and the captured party come apart.
 * Several jurisdictions require ALL parties to consent to a recording.
 *
 * There is no technical gate that obtains a third party's consent. So this
 * boundary does the only honest thing available: it makes the problem
 * STRUCTURAL AND UNAVOIDABLE rather than a warning someone can skim.
 *
 *   1. Ambient audio is NOT ambient. It requires an explicit per-session arm
 *      (`armed`); an unarmed session captures nothing. Every other sensor in
 *      this product is consent-once-then-continuous; this one is not, because
 *      "I agreed to this months ago" is not something a user can meaningfully
 *      say on behalf of whoever walks into the room today.
 *   2. A session with other participants (`multi_party`) stores NOTHING unless
 *      the user has explicitly asserted all-party consent FOR THAT SESSION.
 *      The assertion is a required field, not a setting — it cannot be
 *      satisfied by a default, and it is recorded with what was stored so an
 *      audit can ask who claimed it.
 *   3. `undeterminable` participant scope fails closed, like everywhere else.
 *      "We could not tell whether anyone else was on the call" is exactly the
 *      case that must not capture.
 *
 * Note that system-audio (loopback) capture is INHERENTLY multi-party — it is
 * literally the other side of the call — so it can never reach the
 * own-voice-only path. That is deliberate and is asserted in the tests.
 *
 * ── THE CONTENT DECISION, AGAIN, IS NOT MADE HERE ───────────────────────────
 * Whether transcripts may be stored at all is the same class of question
 * AP-157 settled for keystrokes, and the plan records no decision for audio.
 * Transcript storage is structurally opt-in (`AUDIO_CONTENT_ALLOWED_MODES`)
 * and defaults OFF. Raw audio is never an output of this module: no field on
 * `DistilledAudioEvent` can carry samples, a buffer, or a file path.
 */
import { redactSensitivePatterns, type Redaction } from "./input-capture.js";

/**
 * Who is audible in this session. The provider maps platform state (an active
 * call with remote participants, a solo dictation session, a failed query)
 * onto exactly one of these.
 *
 *  - "own_voice_only"  — only the consenting user's own microphone, with no
 *                        detectable remote participants.
 *  - "multi_party"     — other people are present or on the line. Third-party
 *                        speech WILL be captured. Requires an explicit
 *                        all-party consent assertion.
 *  - "undeterminable"  — could not be established. FAILS CLOSED.
 */
export type AudioParticipantScope = "own_voice_only" | "multi_party" | "undeterminable";

/** The only scope that may be captured on the user's consent alone. Anything
 * else needs the all-party assertion, and an unlisted scope added later is
 * refused by default. */
const SOLO_ALLOWED_SCOPES: ReadonlySet<AudioParticipantScope> =
  new Set<AudioParticipantScope>(["own_voice_only"]);

/** How much of a captured session may become stored content. Mirrors the
 * screen lane: metadata by default, transcript only by explicit decision. */
export type AudioContentMode = "metadata_only" | "transcript";

const AUDIO_CONTENT_ALLOWED_MODES: ReadonlySet<AudioContentMode> =
  new Set<AudioContentMode>(["transcript"]);

/** The shipped default — the safe direction, pending a recorded decision. */
export const DEFAULT_AUDIO_CONTENT_MODE: AudioContentMode = "metadata_only";

/** Apps whose audio is NEVER captured. Separate list from the screen and
 * input lanes for the same reason those are separate from each other:
 * consenting to one sense is not consenting to another. */
export interface AudioCaptureDenylist {
  apps: readonly string[];
}

/**
 * The seed floor. Unlike the other two lanes this is not about password
 * managers — it is about calls that are categorically not ours to record:
 * telephony and one-to-one personal calls, where the other party has the
 * strongest expectation that no software is listening.
 */
export const SEED_AUDIO_DENYLIST_APPS: readonly string[] = [
  "com.apple.FaceTime",
  "com.apple.mobilephone",
  "com.apple.iChat",
  "net.whatsapp.WhatsApp",
  "com.apple.Passwords",
];

/**
 * Built through the same merge every save uses, NOT by copying the seed array.
 * Real macOS bundle ids are mixed-case (`com.apple.FaceTime`), matching is
 * case-insensitive by lowercasing the probe, and a raw copy would therefore
 * have produced a default list that **did not actually deny anything with a
 * capital letter in it** — FaceTime included. Caught by the test below; the
 * one construction path is the fix.
 */
export function defaultAudioCaptureDenylist(): AudioCaptureDenylist {
  return mergeAudioSeedFloor([]);
}

/** Parse stored config, failing CLOSED to the seed floor and re-merging it. */
export function readAudioCaptureDenylist(value: unknown): AudioCaptureDenylist {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const raw = record["apps"];
  const apps = Array.isArray(raw)
    ? raw.filter((e): e is string => typeof e === "string" && e.trim().length > 0)
    : [];
  return mergeAudioSeedFloor(apps);
}

export function mergeAudioSeedFloor(apps: readonly string[]): AudioCaptureDenylist {
  const norm = [...new Set(apps.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0))];
  return {
    apps: [...new Set([...SEED_AUDIO_DENYLIST_APPS.map((a) => a.toLowerCase()), ...norm])].sort(),
  };
}

export function isAudioDenylisted(denylist: AudioCaptureDenylist, bundleId: string): boolean {
  return denylist.apps.includes(bundleId.trim().toLowerCase());
}

/**
 * The gate verdict for one audio session. Note there is no "suppressed but
 * tell them how long it was" — duration is a content hint for a session we
 * refused to listen to, the same class as ADR-239's password length.
 */
export type AudioGateVerdict =
  | { capture: "session" }
  | {
      capture: "suppressed";
      reason: "not_armed" | "no_all_party_consent" | "undeterminable_participants";
    }
  | { capture: "none" };

/**
 * Decide what may be stored for one audio session.
 *
 * `allPartyConsentAssertedBy` is a USER ID, not a boolean, and it is the only
 * way past the multi-party refusal. A boolean would be satisfiable by a
 * default or a stale setting; requiring the identity of whoever claimed it
 * means the claim is attributable, and an empty/absent value refuses.
 */
export function gateAudioCapture(ctx: {
  scope: AudioParticipantScope;
  bundleId: string;
  armed: boolean;
  allPartyConsentAssertedBy?: string | null;
  denylist: AudioCaptureDenylist;
}): AudioGateVerdict {
  if (isAudioDenylisted(ctx.denylist, ctx.bundleId)) {
    // Nothing at all — a FaceTime call must not even reveal it happened.
    return { capture: "none" };
  }
  // Checked before everything about participants: an unarmed session is not
  // a session we are entitled to characterise at all.
  if (!ctx.armed) {
    return { capture: "suppressed", reason: "not_armed" };
  }
  if (SOLO_ALLOWED_SCOPES.has(ctx.scope)) {
    return { capture: "session" };
  }
  if (ctx.scope === "multi_party") {
    const asserted = typeof ctx.allPartyConsentAssertedBy === "string"
      && ctx.allPartyConsentAssertedBy.trim().length > 0;
    return asserted
      ? { capture: "session" }
      : { capture: "suppressed", reason: "no_all_party_consent" };
  }
  // undeterminable, and anything added to the union later.
  return { capture: "suppressed", reason: "undeterminable_participants" };
}

/**
 * One observed audio session as the provider reports it. There is NO field
 * for samples, a buffer, or a path — raw audio cannot be expressed here.
 */
export interface RawAudioSession {
  appName: string;
  appBundleId: string;
  scope: AudioParticipantScope;
  armed: boolean;
  allPartyConsentAssertedBy?: string | null;
  /** Transcribed on-device. Only ever STORED when the gate passes AND the
   * content mode allows it. */
  transcript?: string;
}

export interface DistilledAudioEvent {
  summary: string;
  appName: string;
  appBundleId: string;
  /** Present ONLY when the gate passed AND the mode allows transcripts;
   * already redacted. */
  content?: string;
  disposition: "captured" | "suppressed";
  suppressionReason?: "not_armed" | "no_all_party_consent" | "undeterminable_participants";
  /** Who asserted all-party consent, carried into the stored event so an
   * audit can ask who claimed it. Absent for solo sessions. */
  allPartyConsentAssertedBy?: string;
  redactions: Redaction[];
}

/**
 * Distil one session. `null` for a denylisted app — nothing emitted at all.
 * `contentMode` defaults to the safe direction; transcripts cannot be
 * obtained by omission.
 */
export function distilAudioSession(
  session: RawAudioSession,
  denylist: AudioCaptureDenylist,
  contentMode: AudioContentMode = DEFAULT_AUDIO_CONTENT_MODE,
): DistilledAudioEvent | null {
  const verdict = gateAudioCapture({
    scope: session.scope,
    bundleId: session.appBundleId,
    armed: session.armed,
    allPartyConsentAssertedBy: session.allPartyConsentAssertedBy ?? null,
    denylist,
  });

  if (verdict.capture === "none") return null;

  if (verdict.capture === "suppressed") {
    // No duration, no participant count, no transcript — nothing that hints
    // at the shape of a conversation we declined to record.
    return {
      summary: `Audio activity in ${session.appName}`,
      appName: session.appName,
      appBundleId: session.appBundleId,
      disposition: "suppressed",
      suppressionReason: verdict.reason,
      redactions: [],
    };
  }

  const asserted =
    session.scope === "multi_party" && typeof session.allPartyConsentAssertedBy === "string"
      ? { allPartyConsentAssertedBy: session.allPartyConsentAssertedBy }
      : {};

  if (!AUDIO_CONTENT_ALLOWED_MODES.has(contentMode) || session.transcript === undefined) {
    return {
      summary: `Audio session in ${session.appName}`,
      appName: session.appName,
      appBundleId: session.appBundleId,
      disposition: "captured",
      ...asserted,
      redactions: [],
    };
  }

  const { text, redactions } = redactSensitivePatterns(session.transcript);
  return {
    summary: `Audio session in ${session.appName}`,
    appName: session.appName,
    appBundleId: session.appBundleId,
    content: text,
    disposition: "captured",
    ...asserted,
    redactions,
  };
}
