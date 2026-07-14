/**
 * ContextProvider contract (docs/wiki/clients.md, Sensor SPI) — the kernel-side
 * shape a desktop-capture-plane source (screen/voice/clipboard/etc.) reports
 * through. Screen capture is ONE provider among nine here, not the
 * architecture — the Sensor SPI is an optional, desktop-only capability,
 * never a kernel dependency (CLAUDE.md stack section). This module only
 * defines the CONTRACT; the actual OS-level capture implementations live in
 * the desktop shell (Tauri/Rust capture core), never in @bridge/core.
 *
 * Raw capture is LOCAL-PLANE ONLY (CLAUDE.md "Capture contract"): a
 * ContextItem's `payload` must never cross the egress boundary un-redacted —
 * only a downstream Memory entry derived from it (post-redaction, inspectable)
 * is eligible to sync global-plane. This module does not enforce that gate
 * itself (the Authority resolver / planeGate in ../authority.ts does); it
 * only documents the constraint at the type level via `dataScope`/`retention`.
 */
import type { TrustOrigin } from "./types.js";

/** The nine day-1 Sensor SPI sources (docs/wiki/roadmap.md P0). Screen is one
 * of nine — not a privileged member of this union. */
export type ContextProviderName =
  | "apps"
  | "accessibility"
  | "screen"
  | "voice"
  | "clipboard"
  | "filesystem"
  | "browser"
  | "documents"
  | "emails";

/** How widely a captured item may be shared — mirrors the trust/audience
 * spirit of capability/types.ts's `Audience` but scoped to raw context data
 * rather than a capability's declared audience. */
export type ContextDataScope = "public" | "workspace" | "team" | "private" | "restricted";

/** How long a captured item may be retained before it must be discarded or
 * distilled into a governed Memory entry. */
export type ContextRetention = "turn" | "session" | "short" | "long";

/** A single unit of context collected from one provider. Generic over the
 * provider-specific payload shape (e.g. a screen provider's payload differs
 * from a clipboard provider's), while the envelope fields
 * (provider/kind/permission/dataScope/retention/provenance) stay uniform so
 * the pipeline can reason about any ContextItem without knowing its payload
 * shape. */
export interface ContextItem<TPayload = unknown> {
  /** Which registered provider produced this item. */
  provider: ContextProviderName;
  /** Provider-defined sub-kind (e.g. "window_title", "selection", "screenshot",
   * "utterance") — free-form, mirrors PackageContextProvider's `kind` string
   * (package/types.ts) so a package's context-provider dependency declaration
   * lines up with what a provider actually emits. */
  kind: string;
  /** The permission grant this collection was authorized under — an Authority
   * resolver scope token, never self-asserted trust. */
  permission: string;
  dataScope: ContextDataScope;
  retention: ContextRetention;
  /** Where this item came from and when — audit trail for the Capture
   * contract's "every capture -> an inspectable Memory entry" guarantee. */
  provenance: {
    source: string;
    capturedAt: string;
    /** Person/Community/Initiative id this item concerns, when known. */
    subject?: string;
  };
  /** Raw, LOCAL-PLANE-ONLY payload — never synced global-plane un-redacted
   * (see module doc comment). */
  payload: TPayload;
  /** Provenance-trust of this payload (PI-1/PI-3). `untrusted_external` marks content
   * that must be spotlighted as DATA (never instructions) when projected into a prompt
   * (projectToPrompt) and that taints the turn for egress gating (PI-2). Absent = not
   * tagged; spotlighting treats only an explicit `untrusted_external` as untrusted. */
  trustOrigin?: TrustOrigin;
}

/**
 * ContextProvider — the port a Sensor SPI source implements (mirrors the
 * create/list-style ports already in this package, e.g. CapabilityStore in
 * capability/ports.ts, PackageStore in package/ports.ts). One provider
 * implementation exists per ContextProviderName; the desktop shell registers
 * whichever providers are installed/permitted on a given machine.
 */
export interface ContextProvider {
  /** Which of the nine day-1 sources this implementation is. */
  readonly name: ContextProviderName;
  /** The `kind` values this provider can emit — lets a package's
   * `contextProviders[].kind` dependency declaration (package/types.ts) be
   * checked against what's actually installed before activation. */
  readonly kinds: readonly string[];
  /** Collect zero or more ContextItems for the given permission grant. A
   * provider that has nothing new to report returns an empty array rather
   * than throwing — collection is expected to be called on a poll/interval
   * cadence, not just once. */
  collect(permission: string): Promise<ContextItem[]>;
}
