/**
 * Read path: source items → LOCAL quarantine → governed proposals.
 *
 * Each sourced item is persisted to the local plane (private body, never egress),
 * then proposed through the gate as an Event (action=write, dataScope=private).
 * The gate drafts it pending_review — humans approve before it commits (capture !=
 * commit). The proposal carries only metadata + a pointer to the quarantined body,
 * never the raw private text, so nothing private rides a record that could sync.
 */
import type { ActionRequest, Actor, Proposal, RunCtx } from "@bridge/core";
import type { GovernedGate } from "./gate.js";
import type { SocialProvider, SourcedItem } from "./provider.js";

/** Local-plane sink for captured items (private bodies live here, never the cloud). */
export interface QuarantineStore {
  put(entry: { provider: string; item: SourcedItem }): Promise<string>;
}

export interface SourceResult {
  quarantinedId: string;
  proposal: Proposal;
  /** Whether the sourced item came from a live provider or the unconfigured (no-op) seam. */
  mode: SocialProvider["mode"];
}

export async function sourceToProposals(args: {
  gate: GovernedGate;
  provider: SocialProvider;
  quarantine: QuarantineStore;
  organizationId: string;
  actor: Actor;
  run: RunCtx;
}): Promise<SourceResult[]> {
  const { gate, provider, quarantine, organizationId, actor, run } = args;
  const items = await provider.sourceItems();
  const out: SourceResult[] = [];
  for (const item of items) {
    // 1) Capture the private body to the local plane — capture, not commit.
    const quarantinedId = await quarantine.put({ provider: provider.id, item });
    // 2) Propose an Event. Note: the raw body is NOT in inputs (residency) —
    //    only metadata + the local pointer travel with the proposal.
    const request: ActionRequest = {
      organizationId,
      actor,
      action: "write",
      resourceType: "event",
      inputs: {
        source: provider.id,
        sourceId: item.sourceId,
        kind: item.kind,
        occurredAt: item.occurredAt,
        counterparty: item.counterparty ?? null,
        quarantinedId,
        // Audit trail must be able to tell fixture-sourced Events from live ones.
        mode: provider.mode,
      },
      skill: "stageMutation",
      dataScope: "private",
      seed: `social:${provider.id}:${item.sourceId}`,
    };
    const proposal = await gate.propose(request, run);
    out.push({ quarantinedId, proposal, mode: provider.mode });
  }
  return out;
}
