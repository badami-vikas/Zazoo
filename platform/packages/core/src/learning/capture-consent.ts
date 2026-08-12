/**
 * Per-source capture consent (AI Harness K2, ADR-210 — "data already held
 * locally; new USE = new consent surface, default off").
 *
 * Bridge already holds chat threads and WhatsApp messages on the Local
 * Plane. K2 gives that data a NEW use — emitting learning signals — and a
 * new use requires a new consent surface, not an inherited one. This file is
 * the pure state machine for that surface; durable storage and HTTP live in
 * the app layer.
 *
 * Invariants, each load-bearing (harness plan, "Invariants on every capture
 * rung"):
 *
 *  - **Default OFF.** A source emits nothing until its owner explicitly
 *    turned it on. The default state has every source disabled, and — the
 *    structural half — `readCaptureConsent` FAILS CLOSED: a missing row, a
 *    corrupt row, a non-boolean `enabled`, or a source key this build does
 *    not know all read as OFF. Absence of consent and consent-off are the
 *    same state on purpose; there is no way to store a value that reads as
 *    "on" without a well-formed boolean `true` written by the consent
 *    surface.
 *  - **Kill switch trumps everything.** `paused: true` silences every
 *    source regardless of per-source state, and flipping it back restores
 *    the previous per-source choices unchanged — pause is a circuit
 *    breaker, not a bulk consent rewrite.
 *  - **Per-source isolation.** Consent to one source says nothing about any
 *    other; each toggle carries its own `changedAt`/`changedBy` so the
 *    surface stays inspectable (who consented, when — not just the current
 *    boolean).
 */

/** The capture sources. K2 shipped "chat" and "whatsapp"; K5 adds "google" —
 * the connected Google account's approved email threads and calendar events,
 * metadata-first (the plan's "per-account toggle": the pilot holds exactly one
 * Google account per user, so the account-shaped consent IS this one source;
 * a multi-account future grows the key, not this contract). K8 adds
 * "browser" — the extension's domain/title visit capture, additionally gated
 * by the per-domain allowlist/denylist (browser-capture.ts): consent answers
 * WHETHER the browser may emit at all, the policy answers WHICH domains.
 * Later capture rungs (app-focus = K7) add members here — each new member is
 * a new consent surface by construction, because `defaultCaptureConsent`
 * starts it OFF. */
export const CAPTURE_SOURCES = ["chat", "whatsapp", "google", "browser"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export function isCaptureSource(value: unknown): value is CaptureSource {
  return typeof value === "string" && (CAPTURE_SOURCES as readonly string[]).includes(value);
}

export interface CaptureSourceConsent {
  enabled: boolean;
  /** ISO timestamp of the last explicit change; null = never touched. */
  changedAt: string | null;
  /** User id of the human who last changed it; null = never touched. */
  changedBy: string | null;
}

export interface CaptureConsentState {
  /** The kill switch: true silences EVERY source without rewriting them. */
  paused: boolean;
  pausedChangedAt: string | null;
  pausedChangedBy: string | null;
  sources: Record<CaptureSource, CaptureSourceConsent>;
}

const UNTOUCHED: CaptureSourceConsent = Object.freeze({
  enabled: false,
  changedAt: null,
  changedBy: null,
});

export function defaultCaptureConsent(): CaptureConsentState {
  return {
    paused: false,
    pausedChangedAt: null,
    pausedChangedBy: null,
    sources: Object.fromEntries(
      CAPTURE_SOURCES.map((source) => [source, { ...UNTOUCHED }]),
    ) as Record<CaptureSource, CaptureSourceConsent>,
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse a stored consent value, failing CLOSED on anything malformed: the
 * only way a source reads as enabled is a well-formed boolean `true` under
 * a source key this build knows. Unknown keys are dropped (a rolled-back
 * build must not carry forward consent it cannot render a toggle for). */
export function readCaptureConsent(value: unknown): CaptureConsentState {
  const state = defaultCaptureConsent();
  if (typeof value !== "object" || value === null) return state;
  const record = value as Record<string, unknown>;
  if (record["paused"] === true) {
    state.paused = true;
  }
  state.pausedChangedAt = readString(record["pausedChangedAt"]);
  state.pausedChangedBy = readString(record["pausedChangedBy"]);
  const sources = record["sources"];
  if (typeof sources !== "object" || sources === null) return state;
  for (const source of CAPTURE_SOURCES) {
    const row = (sources as Record<string, unknown>)[source];
    if (typeof row !== "object" || row === null) continue;
    const parsed = row as Record<string, unknown>;
    state.sources[source] = {
      enabled: parsed["enabled"] === true,
      changedAt: readString(parsed["changedAt"]),
      changedBy: readString(parsed["changedBy"]),
    };
  }
  return state;
}

export function withSourceConsent(
  state: CaptureConsentState,
  source: CaptureSource,
  enabled: boolean,
  changedBy: string,
  changedAt: string,
): CaptureConsentState {
  return {
    ...state,
    sources: {
      ...state.sources,
      [source]: { enabled, changedAt, changedBy },
    },
  };
}

export function withCapturePaused(
  state: CaptureConsentState,
  paused: boolean,
  changedBy: string,
  changedAt: string,
): CaptureConsentState {
  return { ...state, paused, pausedChangedAt: changedAt, pausedChangedBy: changedBy };
}

/** THE gate every emission point asks. Pause silences everything; otherwise
 * only an explicitly enabled source may emit. */
export function captureAllowed(state: CaptureConsentState, source: CaptureSource): boolean {
  if (state.paused) return false;
  return state.sources[source].enabled;
}
