/**
 * FakeContextProvider — in-memory test double for the SPI. Emits scripted
 * captures on demand (no timers, no OS APIs) so hub behavior is testable
 * deterministically. Also the reference for what a real provider owes the
 * contract: raw + derived emitted together, typed apart.
 */
import type { CaptureEmission, ContextProvider, ContextProviderKind } from "./types.js";

export class FakeContextProvider implements ContextProvider {
  readonly id: string;
  readonly kind: ContextProviderKind;
  readonly plane = "local" as const;
  #emit: ((emission: CaptureEmission) => Promise<void>) | null = null;
  started = 0;
  stopped = 0;

  constructor(id: string, kind: ContextProviderKind) {
    this.id = id;
    this.kind = kind;
  }

  async start(emit: (emission: CaptureEmission) => Promise<void>): Promise<void> {
    this.#emit = emit;
    this.started++;
  }

  async stop(): Promise<void> {
    this.#emit = null;
    this.stopped++;
  }

  /** Test hook: push one scripted capture through the hub. */
  async emitCapture(emission: CaptureEmission): Promise<void> {
    if (!this.#emit) throw new Error(`fake provider ${this.id} not started`);
    await this.#emit(emission);
  }
}
