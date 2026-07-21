// Shared intake seam for surfaced Modules. Sourced data lands in quarantine;
// a Human "Add" decision materializes it. The Skill still runs through the Universal Action
// Pipeline as an `external:fetch` proposal — authority/policy/audit apply exactly as for
// every other read (google.sourceGmail is the pattern this generalizes).
import type { Skill } from "@bridge/core";
import type { CaptureEnvelope, SourceConnector, SourceQuery } from "@bridge/sourcing";

export interface QuarantinedCapture extends CaptureEnvelope {
  captureId: string;
  moduleId: string;
}

/** Where quarantined captures wait between propose() and the human's Add. */
export interface ModuleCaptureStore {
  put(capture: QuarantinedCapture): Promise<void>;
  get(captureId: string): Promise<QuarantinedCapture | undefined>;
  list(moduleId: string): Promise<QuarantinedCapture[]>;
}

export function createInMemoryCaptureStore(): ModuleCaptureStore {
  const rows = new Map<string, QuarantinedCapture>();
  return {
    async put(capture) {
      rows.set(capture.captureId, capture);
    },
    async get(captureId) {
      return rows.get(captureId);
    },
    async list(moduleId) {
      return [...rows.values()].filter((row) => row.moduleId === moduleId);
    },
  };
}

/**
 * Builds the pipeline Skill a Module registers for its `<moduleId>.source` Action. Running it
 * fetches through the connector and quarantines every envelope — the skill's proposedOutput
 * is a LIGHT manifest (counts + capture ids + a small sample), never the full payload, same
 * "light manifest, audit trail rides the store" shape as google.sourceGmail.
 */
export function createModuleSourceSkill(deps: {
  moduleId: string;
  captures: ModuleCaptureStore;
  connector: SourceConnector;
}): Skill {
  return {
    name: `${deps.moduleId}.source`,
    async run(inputs, ctx) {
      const query = inputs as SourceQuery;
      const envelopes = await deps.connector.fetch(query);
      const captureIds: string[] = [];
      for (const envelope of envelopes) {
        const captureId = ctx.ids.next();
        // PI-1: the ONE intake seam is where "untrusted by default" is enforced —
        // an envelope with no explicit provenance is quarantined as untrusted_external,
        // never silently trusted. A connector that DID tag its source keeps its value.
        await deps.captures.put({
          ...envelope,
          captureId,
          moduleId: deps.moduleId,
          trustOrigin: envelope.trustOrigin ?? "untrusted_external",
        });
        captureIds.push(captureId);
      }
      return {
        proposedOutput: {
          moduleId: deps.moduleId,
          count: envelopes.length,
          captureIds,
          sample: envelopes.slice(0, 3).map((e) => e.payload),
        },
        diff: { quarantined: envelopes.length },
      };
    },
  };
}

/**
 * The Human "Add" step commits one quarantined capture into the Module's own store.
 * `commit` is Module-owned (DealPilot appends to @bridge/facts + rescoring; a future Recon
 * migration would append to its own facts store the same way) — this class only owns the
 * quarantine lifecycle (fetch-once semantics), never the Module's data shape.
 */
export class ModuleIntakeMaterializer {
  #captures: ModuleCaptureStore;
  #commit: (capture: QuarantinedCapture) => Promise<void>;

  constructor(deps: { captures: ModuleCaptureStore; commit: (capture: QuarantinedCapture) => Promise<void> }) {
    this.#captures = deps.captures;
    this.#commit = deps.commit;
  }

  async add(captureId: string): Promise<{ committed: boolean }> {
    const capture = await this.#captures.get(captureId);
    if (!capture) return { committed: false };
    await this.#commit(capture);
    return { committed: true };
  }
}
