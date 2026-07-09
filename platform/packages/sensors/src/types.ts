/**
 * Sensor SPI types — the CONTEXT PROVIDER registry contract
 * (docs/wiki/clients.md "Context providers", superseding the earlier
 * "3 sensor kinds" framing; docs/raw/client-architecture-context-providers.md
 * is the verbatim requirement).
 *
 * Design invariants:
 *  1. RAW vs DERIVED are separated AT THE TYPE LEVEL. A provider emits a
 *     `CaptureEmission` = { raw, observation }. The hub's consumer-facing API
 *     carries ONLY `ContextObservation` (derived, normalized, redacted) — the
 *     raw payload (frames, AX dumps, audio, full email bodies) is a distinct
 *     type that never appears on any consumer signature, so "Learning Agent
 *     consumes context, not screenshots" is structural, not a convention.
 *  2. Providers are peers and swappable — same interface for every kind.
 *  3. plane is literally typed "local": a context provider cannot exist on
 *     the cloud plane at the type level (raw capture local-plane ONLY).
 *  4. The kernel runs with ZERO providers — nothing in @bridge/core depends
 *     on this package; it is an optional capability surface.
 */

/** The provider registry kinds — peers, swappable, per the adopted client
 * architecture. Surfaces implement subsets (SURFACE_PROVIDER_KINDS). */
export type ContextProviderKind =
  | "apps" // frontmost app / focus tracking (macOS: NSWorkspace)
  | "accessibility" // AX-tree reads of the focused window
  | "screen" // on-demand screenshots (CGWindowList)
  | "voice" // microphone / voice command capture
  | "clipboard" // clipboard changes
  | "filesystem" // watched-folder / recent-file events
  | "browser" // current tab, selected text (browser extension)
  | "documents" // open/edited documents
  | "emails"; // mail account context

/**
 * The RAW side of a capture — local-plane ONLY. Never crosses the gate, never
 * reaches a consumer: the hub stores it behind `readRawCapture()`, which
 * refuses cloud-plane requestors (planeGate semantics). Deliberately NOT a
 * superset/subtype of ContextObservation so a raw record can never be passed
 * where an observation is expected.
 */
export interface RawCapture {
  id: string;
  providerId: string;
  kind: ContextProviderKind;
  occurredAt: string;
  /** The unredacted capture payload (frame bytes ref, AX dump, full text…). */
  rawPayload: unknown;
}

/**
 * The DERIVED side — the normalized context entry consumers (Learning Agent,
 * UI, signals) see. Contains only derived summaries/fields, never the raw
 * payload; `rawCaptureId` is an opaque reference a LOCAL-plane inspector can
 * dereference via the hub (cloud consumers cannot).
 */
export interface ContextObservation {
  id: string;
  providerId: string;
  kind: ContextProviderKind;
  occurredAt: string;
  /** Human-inspectable one-line summary — becomes the Memory entry content. */
  summary: string;
  /** Structured derived fields (app name, doc title, url host…). Derived
   * ONLY — providers must not smuggle raw payloads in here; redactions below
   * document what was stripped. */
  payload: Record<string, unknown>;
  /** What the provider redacted/stripped when deriving (audit/inspect aid). */
  redactions?: string[];
  /** Link back to the raw capture (local-plane dereference only). */
  rawCaptureId?: string;
}

/** What a provider emits per capture: both sides, typed apart. */
export interface CaptureEmission {
  raw: RawCapture;
  observation: ContextObservation;
}

/**
 * A context provider (the Sensor SPI). Implemented OUTSIDE the kernel — the
 * Tauri Rust capture core implements the desktop subset, the browser
 * extension the browser subset. `plane` is the literal "local": providers
 * run where the data is and never on the cloud plane.
 */
export interface ContextProvider {
  id: string;
  kind: ContextProviderKind;
  readonly plane: "local";
  /** Begin capturing; push each capture through `emit`. */
  start(emit: (emission: CaptureEmission) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

/** Back-compat alias — the vision doc's original name for the SPI. */
export type Sensor = ContextProvider;
export type SensorObservation = ContextObservation;

/** The three client surfaces (Notion model — one kernel, three thin clients). */
export type Surface = "desktop" | "browser" | "mobile";

/**
 * Per-surface provider subsets (docs/wiki/clients.md): desktop = all ·
 * browser = browser/documents · mobile = voice (+ photo capture, which rides
 * the existing LocalMediaStore camera path rather than a context provider) +
 * documents. A surface registering a kind outside its subset is rejected by
 * the hub.
 */
export const SURFACE_PROVIDER_KINDS: Readonly<Record<Surface, readonly ContextProviderKind[]>> = {
  desktop: [
    "apps",
    "accessibility",
    "screen",
    "voice",
    "clipboard",
    "filesystem",
    "browser",
    "documents",
    "emails",
  ],
  browser: ["browser", "documents"],
  mobile: ["voice", "documents"],
};
