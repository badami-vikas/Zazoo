// The ONE intake seam for manifest-composed external tools (docs/wiki/known-issues.md:
// "Recon stranded outside the tool system" / "Tool registry desync" — this closes both).
// Every external tool's manifest forces `intakePolicy.quarantine = true` (registry.ts,
// mirrors the agent-floor rule): sourced data must land in QUARANTINE, never straight into
// a tool's committed store. A human "Add" step (capture ≠ commit, same UX as Camera/Card
// Scanner) materializes it. The skill itself still runs through the Universal Action
// Pipeline as an `external:fetch` proposal — authority/policy/audit apply exactly as for
// every other read (google.sourceGmail is the pattern this generalizes).
import type { Skill } from "@bridge/core";
import type { CaptureEnvelope, SourceConnector, SourceQuery } from "@bridge/sourcing";

export interface QuarantinedCapture extends CaptureEnvelope {
  captureId: string;
  toolId: string;
}

/** Where quarantined captures wait between propose() and the human's Add. */
export interface ToolCaptureStore {
  put(capture: QuarantinedCapture): Promise<void>;
  get(captureId: string): Promise<QuarantinedCapture | undefined>;
  list(toolId: string): Promise<QuarantinedCapture[]>;
}

export function createInMemoryCaptureStore(): ToolCaptureStore {
  const rows = new Map<string, QuarantinedCapture>();
  return {
    async put(capture) {
      rows.set(capture.captureId, capture);
    },
    async get(captureId) {
      return rows.get(captureId);
    },
    async list(toolId) {
      return [...rows.values()].filter((r) => r.toolId === toolId);
    },
  };
}

/**
 * Builds the pipeline Skill a tool registers for its `<toolId>.source` action. Running it
 * fetches through the connector and quarantines every envelope — the skill's proposedOutput
 * is a LIGHT manifest (counts + capture ids + a small sample), never the full payload, same
 * "light manifest, audit trail rides the store" shape as google.sourceGmail.
 */
export function createToolSourceSkill(deps: {
  toolId: string;
  captures: ToolCaptureStore;
  connector: SourceConnector;
}): Skill {
  return {
    name: `${deps.toolId}.source`,
    async run(inputs, ctx) {
      const query = inputs as SourceQuery;
      const envelopes = await deps.connector.fetch(query);
      const captureIds: string[] = [];
      for (const envelope of envelopes) {
        const captureId = ctx.ids.next();
        await deps.captures.put({ ...envelope, captureId, toolId: deps.toolId });
        captureIds.push(captureId);
      }
      return {
        proposedOutput: {
          toolId: deps.toolId,
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
 * The human "Add" step: commits ONE quarantined capture into the tool's own store.
 * `commit` is tool-owned (DealPilot appends to @bridge/facts + rescoring; a future Recon
 * migration would append to its own facts store the same way) — this class only owns the
 * quarantine lifecycle (fetch-once semantics), never the tool's data shape.
 */
export class ToolIntakeMaterializer {
  #captures: ToolCaptureStore;
  #commit: (capture: QuarantinedCapture) => Promise<void>;

  constructor(deps: { captures: ToolCaptureStore; commit: (capture: QuarantinedCapture) => Promise<void> }) {
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
