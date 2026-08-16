/**
 * K11 (TASK-054) — the input drain's decision layer, as a module with NO
 * imports at all.
 *
 * It sits apart from `input-capture-drain.ts` (the React hook) on purpose:
 * this is the third of three independent refusals in the keystroke lane
 * (Rust accumulator -> HERE -> server re-distillation), and a safety decision
 * that can only be reached through React and a tRPC client is a safety
 * decision that will be tested through mocks, or not at all. With no imports,
 * the fail-closed property is exercised directly.
 *
 * Mirrors the same shape as core's `input-capture.ts`: content roles are an
 * opt-in allowlist, so a role added later suppresses by default.
 */

/** The one field role that may carry content, mirroring core's
 * `CONTENT_ALLOWED_ROLES` opt-in set. Written as a positive allowlist rather
 * than `!== "secure"` so a role added later suppresses by default here too —
 * the same structural fail-closed shape the boundary uses. */
const CONTENT_ALLOWED_ROLES = new Set(["content_ok"]);

/** The wire schema's role enum. A drained burst whose role is not one of
 * these is not reported at all: the API would reject it, and inventing a
 * value to satisfy the schema would be the shell asserting something about
 * the field that the producer declined to assert. */
const WIRE_FIELD_ROLES = new Set(["content_ok", "secure", "undeterminable"]);

export interface DrainedObservation {
  kind?: string;
  ts?: number;
  app_name?: string;
  bundle_id?: string;
  host?: string;
  field_role?: string;
  key_count?: number;
  started_at_ms?: number;
  /** Handle into the local raw ring; present only when the producer stored a
   * payload for this burst (i.e. content was actually collected). */
  raw_id?: number;
}

/** What the drain decided to do with one drained observation. */
export interface PlannedBurstReport {
  /** The ring handle to fetch text from, or `null` to report NO text.
   * `null` is the fail-closed answer and every path that is not a positively
   * content-allowed role with a real handle produces it. */
  rawId: number | null;
  /** The burst report, minus `text` — which only the caller can fill, and
   * only when `rawId` is non-null. Keeping `text` out of this shape is the
   * point: the planner cannot accidentally emit content. */
  report: {
    appName: string;
    appBundleId: string;
    host?: string;
    fieldRole: "content_ok" | "secure" | "undeterminable";
    keyCount: number;
    typedAt: string;
  };
}

/**
 * The drain's whole decision, as a pure function — extracted from the effect
 * so the safety property is testable without a shell, and so "should this
 * burst's text be fetched?" is answered in one place rather than inline in a
 * loop where a later edit could quietly widen it.
 *
 * Returns `null` for anything this lane must not report at all: a non-input
 * observation, or one missing the identity/role fields the wire schema
 * requires. Inventing a value to satisfy the schema would be the shell
 * asserting something about the field that the producer declined to assert.
 */
export function planInputBurstReport(
  observation: DrainedObservation,
  now: () => number = Date.now,
): PlannedBurstReport | null {
  if (
    observation.kind !== "input" ||
    typeof observation.app_name !== "string" ||
    typeof observation.bundle_id !== "string" ||
    typeof observation.field_role !== "string" ||
    !WIRE_FIELD_ROLES.has(observation.field_role)
  ) {
    return null;
  }
  const fieldRole = observation.field_role as "content_ok" | "secure" | "undeterminable";
  return {
    // THE gate. Not `raw_id != null` — the role must positively allow content
    // first, so a producer bug that attached a payload to a secure-field
    // burst still results in no text being requested from the ring.
    rawId:
      CONTENT_ALLOWED_ROLES.has(fieldRole) && typeof observation.raw_id === "number"
        ? observation.raw_id
        : null,
    report: {
      appName: observation.app_name,
      appBundleId: observation.bundle_id,
      ...(typeof observation.host === "string" ? { host: observation.host } : {}),
      fieldRole,
      keyCount: typeof observation.key_count === "number" ? observation.key_count : 0,
      // When typing STARTED, not when the burst flushed — a burst ends on an
      // idle timeout, so the flush time would place every burst a couple of
      // seconds after the fact and skew the time-of-day bucket the rhythm
      // lane groups on.
      typedAt: new Date(
        typeof observation.started_at_ms === "number" ? observation.started_at_ms : now(),
      ).toISOString(),
    },
  };
}
