/**
 * SensorHub — registers context providers as OPTIONAL capabilities and
 * enforces the capture contract:
 *
 *  - Register: every provider registration creates a capability manifest
 *    (origin "built_in", type "integration") with the risk band COMPUTED from
 *    its declared permissions via @bridge/core's capability module — never
 *    self-declared. Emails/browser providers carry a signal-write permission
 *    (they generate signal-shaped context) so they honestly compute to
 *    `advisory`, while read-only providers (clipboard, apps…) compute to
 *    `informational` — matching the wiki's "emails/browser score higher than
 *    clipboard".
 *  - Ingest: every emission → one inspectable Memory entry via CaptureLedger
 *    + one "sensor.capture" DomainEvent on the EventBus (the avatar-blink
 *    tell — any UI subscribes to surface it).
 *  - Plane: raw payloads are held locally and only reachable through
 *    `readRawCapture()`, which REFUSES cloud-plane requestors (planeGate
 *    semantics — local plane never egresses raw capture). Consumers subscribe
 *    to derived `ContextObservation`s only; the raw type never appears on the
 *    consumer API.
 *  - Zero-provider rule: a hub with no registrations is fully functional
 *    (nothing else in the kernel depends on it) — sensors are desktop-only
 *    optional capabilities, never a kernel dependency.
 */
import {
  computeRisk,
  type CapabilityManifest,
  type CapabilityManifestRow,
  type CapabilityPermission,
  type CapabilityStore,
  type EventBus,
  type MemoryStore,
  type Plane,
  type TrustOrigin,
  hashTaintValue,
  labelAtSource,
} from "@bridge/core";
import type { CaptureLedger, MemoryEntryRecord } from "./capture-ledger.js";
import {
  SURFACE_PROVIDER_KINDS,
  type CaptureEmission,
  type ContextObservation,
  type ContextProvider,
  type ContextProviderKind,
  type RawCapture,
  type Surface,
} from "./types.js";

/** A derived-context consumer. Note the signature: `ContextObservation` only —
 * there is no raw-capture field to forward, by construction. */
export interface ContextConsumer {
  id: string;
  plane: Plane;
  onObservation(obs: ContextObservation): void | Promise<void>;
}

export interface SensorHubDeps {
  capabilities: CapabilityStore;
  ledger: CaptureLedger;
  /** Optional MEM-1 store for derived, authority-scoped Memory candidates. */
  memories?: MemoryStore;
  events: EventBus;
  organizationId: string;
  /** Capturing user; owns private Memories when a MemoryStore is configured. */
  userId?: string;
  /** Which client surface this hub runs on — registration is limited to the
   * surface's provider subset (SURFACE_PROVIDER_KINDS). */
  surface: Surface;
  /** Determinism seams (mirrors core's RunCtx rule: no wall clock/global RNG
   * reads inside engine code). */
  ids: () => string;
  nowISO: () => string;
}

/**
 * Declared permissions per provider kind — the input to risk computation.
 * All providers READ private local context with no egress (informational
 * base). Emails/browser additionally write signal-shaped context entries
 * (advisory). The Memory-entry write itself is the HUB's doing through the
 * ledger port, not a provider permission — providers only sense.
 */
export function permissionsForKind(kind: ContextProviderKind): CapabilityPermission[] {
  const read: CapabilityPermission = {
    resourceType: `context:${kind}`,
    action: "read",
    dataScope: "private",
    egress: false,
  };
  if (kind === "emails" || kind === "browser") {
    return [read, { resourceType: "signal", action: "write", dataScope: "private", egress: false }];
  }
  return [read];
}

export class SensorHub {
  readonly #deps: SensorHubDeps;
  readonly #providers = new Map<string, ContextProvider>();
  readonly #consumers = new Map<string, ContextConsumer>();
  /** Raw captures — LOCAL plane only; see readRawCapture(). In-memory here;
   * durable raw storage rides the local plane (pglite/LocalMediaStore), never
   * the cloud canonical. */
  readonly #raw = new Map<string, RawCapture>();
  readonly #running = new Set<string>();

  constructor(deps: SensorHubDeps) {
    this.#deps = deps;
  }

  /** Register a provider as an optional capability. Computes risk from the
   * kind's declared permissions; rejects kinds outside this surface's subset. */
  async register(provider: ContextProvider): Promise<CapabilityManifestRow> {
    const allowed = SURFACE_PROVIDER_KINDS[this.#deps.surface];
    if (!allowed.includes(provider.kind)) {
      throw new Error(
        `sensor hub: provider kind "${provider.kind}" is not available on surface "${this.#deps.surface}" ` +
          `(allowed: ${allowed.join(", ")})`,
      );
    }
    if (this.#providers.has(provider.id)) {
      throw new Error(`sensor hub: provider ${provider.id} already registered`);
    }

    const manifest: CapabilityManifest = {
      id: `ctx-provider:${provider.id}`,
      name: `Context provider: ${provider.kind} (${provider.id})`,
      version: "0.1.0",
      capabilityType: "integration",
      origin: "built_in",
      audience: "private",
      permissions: permissionsForKind(provider.kind),
      connectors: [],
      dependencies: [],
    };
    const computedRisk = computeRisk(manifest, () => undefined);

    // Re-registration across process boots (K7: the manifest row outlives
    // the process on a durable CapabilityStore): check-before-insert on the
    // (organization, name, version) NATURAL key, per the ports.ts ADR-023
    // precedent — durable stores key rows by UUID, so the logical
    // `ctx-provider:<id>` lives inside the manifest JSON, not in the row id.
    // Reuse touches NOTHING about the existing row's state, so a suspension
    // survives a restart instead of being resurrected by the next boot.
    const existing = await this.#deps.capabilities.getManifestByNameVersion(
      this.#deps.organizationId,
      manifest.name,
      manifest.version,
    );
    if (existing) {
      this.#providers.set(provider.id, provider);
      return existing;
    }

    const row = await this.#deps.capabilities.createManifest({
      id: this.#deps.ids(),
      organizationId: this.#deps.organizationId,
      capabilityType: "integration",
      name: manifest.name,
      version: manifest.version,
      origin: "built_in",
      audience: "private",
      manifest,
      computedRisk,
      dependencies: [],
    });
    await this.#deps.capabilities.upsertState({
      manifestId: row.id,
      organizationId: this.#deps.organizationId,
      state: "draft", // generation ≠ activation — even built-ins start Draft
      suspended: false,
      evidence: {},
    });

    this.#providers.set(provider.id, provider);
    return row;
  }

  providerIds(): string[] {
    return [...this.#providers.keys()];
  }

  async start(providerId: string): Promise<void> {
    const p = this.#providers.get(providerId);
    if (!p) throw new Error(`sensor hub: unknown provider ${providerId}`);
    if (this.#running.has(providerId)) return;
    this.#running.add(providerId);
    await p.start(async (emission) => {
      await this.ingest(emission);
    });
  }

  async stop(providerId: string): Promise<void> {
    const p = this.#providers.get(providerId);
    if (!p) throw new Error(`sensor hub: unknown provider ${providerId}`);
    this.#running.delete(providerId);
    await p.stop();
  }

  /** Subscribe a consumer to DERIVED observations. Returns an unsubscribe fn. */
  subscribe(consumer: ContextConsumer): () => void {
    this.#consumers.set(consumer.id, consumer);
    return () => {
      this.#consumers.delete(consumer.id);
    };
  }

  /**
   * Capture contract enforcement — every emission:
   *  1. raw side retained LOCAL-plane only;
   *  2. one inspectable Memory entry appended (CaptureLedger → timeline_entries);
   *  3. one "sensor.capture" DomainEvent (the blink tell);
   *  4. derived observation fanned out to consumers (any plane — it is
   *     derived by type; raw can never ride along).
   */
  async ingest(emission: CaptureEmission): Promise<MemoryEntryRecord> {
    const { raw, observation } = emission;
    this.#raw.set(raw.id, raw);
    const sourceId =
      observation.kind === "screen"
        ? "screen_capture"
        : observation.kind === "clipboard"
          ? "clipboard_capture"
          : "sensor_capture";
    const taintLabel = labelAtSource(sourceId, {
      ref: raw.id,
      valueHash: hashTaintValue({
        summary: observation.summary,
        payload: observation.payload,
      }),
      sensitivity: "private",
      instructionRisk: "instruction_like",
    });

    const entry = await this.#deps.ledger.record({
      id: this.#deps.ids(),
      organizationId: this.#deps.organizationId,
      type: `capture.${observation.kind}`,
      content: observation.summary,
      occurredAt: observation.occurredAt,
      createdBy: observation.providerId,
      trustOrigin: "untrusted_external" satisfies TrustOrigin,
      taintLabel,
      refs: [],
      payload: observation.payload,
      redactions: observation.redactions ?? [],
    });

    if (this.#deps.memories) {
      await this.#deps.memories.write({
        id: this.#deps.ids(),
        organizationId: this.#deps.organizationId,
        type: "episodic",
        scope: "private",
        content: observation.summary,
        sourceRefType: "timeline_entry",
        sourceRefId: entry.id,
        confidence: 0.5,
        trustOrigin: "untrusted_external",
        taintLabel,
        plane: "local",
        createdBy: observation.providerId,
        ownerUserId: this.#deps.userId ?? null,
      });
    }

    // The blink tell — any UI (overlay avatar on desktop, in-page persona on
    // web/mobile) subscribes to this event type to blink on capture.
    await this.#deps.events.emit({
      id: this.#deps.ids(),
      organizationId: this.#deps.organizationId,
      type: "sensor.capture",
      entityType: "signal",
      entityId: entry.id,
      payload: { providerId: observation.providerId, kind: observation.kind, memoryEntryId: entry.id },
      taintLabel,
      createdAt: this.#deps.nowISO(),
    });

    for (const consumer of this.#consumers.values()) {
      await consumer.onObservation(observation);
    }
    return entry;
  }

  /**
   * Raw-capture access — LOCAL plane only (planeGate semantics: raw capture
   * never crosses to the cloud plane; only derived Memories/Signals cross the
   * gate). A cloud-plane requestor is refused unconditionally.
   */
  readRawCapture(id: string, requestorPlane: Plane): RawCapture | null {
    if (requestorPlane === "cloud") {
      throw new Error(
        "sensor hub: raw capture is local-plane only — cloud-plane consumers receive derived observations, never raw payloads",
      );
    }
    return this.#raw.get(id) ?? null;
  }
}
