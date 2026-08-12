/**
 * PushContextProvider — the production relay provider for captures that
 * originate ACROSS a process boundary (K7, TASK-051).
 *
 * The OS-facing half of a desktop sensor lives in the Tauri shell's Rust
 * capture core (providers/apps.rs polls NSWorkspace; the shell buffers and
 * the JS side drains — "drain, don't push" keeps the Rust crate free of
 * HTTP egress). By the time an observation reaches the kernel-side hub it
 * arrives as a pushed message, so the TS provider registered with the
 * SensorHub is necessarily push-shaped: `push()` is called by the transport
 * edge (the tRPC ingest procedure) and forwards into the hub's `ingest`
 * contract like any in-process provider would.
 *
 * Fail-closed lifecycle: a provider that is not started DROPS pushes and
 * says so (`false`) — it never buffers. Between `stop()` and the next
 * `start()` there is no capture path, matching the kill-switch semantics
 * every capture rung owes (a paused sensor must not queue observations for
 * later replay; pause means nothing was sensed).
 */
import type { CaptureEmission, ContextProvider, ContextProviderKind } from "./types.js";

export class PushContextProvider implements ContextProvider {
  readonly id: string;
  readonly kind: ContextProviderKind;
  readonly plane = "local" as const;
  #emit: ((emission: CaptureEmission) => Promise<void>) | null = null;

  constructor(id: string, kind: ContextProviderKind) {
    this.id = id;
    this.kind = kind;
  }

  async start(emit: (emission: CaptureEmission) => Promise<void>): Promise<void> {
    this.#emit = emit;
  }

  async stop(): Promise<void> {
    this.#emit = null;
  }

  /** Relay one boundary-crossing capture into the hub. Returns true when
   * the emission entered the hub's ingest path, false when it was dropped
   * because the provider is stopped (fail-closed — never buffered). */
  async push(emission: CaptureEmission): Promise<boolean> {
    if (!this.#emit) return false;
    await this.#emit(emission);
    return true;
  }
}
