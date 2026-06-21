/**
 * Write path: draft → gate → (human approval) → publish (egress).
 *
 * Publishing is external:send — agent-floor DENY, so the gate forces approval and
 * the provider.publish() egress call fires ONLY after a human approves. The draft
 * step composes locally and never reaches the platform.
 */
import type { Actor, RunCtx } from "@bridge/core";
import type { GovernedGate } from "./gate.js";
import {
  PUBLISH_ACTION,
  PUBLISH_RESOURCE,
  type DraftedAction,
  type OutboundAction,
  type PublishResult,
  type SocialProvider,
} from "./provider.js";

export interface DraftOutboundResult {
  proposalId: string;
  status: string;
  drafted: DraftedAction;
}

/** Compose an outbound action and propose it through the gate. Never publishes. */
export async function draftOutbound(args: {
  gate: GovernedGate;
  provider: SocialProvider;
  action: OutboundAction;
  workspaceId: string;
  actor: Actor;
  run: RunCtx;
}): Promise<DraftOutboundResult> {
  const { gate, provider, action, workspaceId, actor, run } = args;
  const drafted = await provider.draftAction(action); // compose only — no network send
  const proposal = await gate.propose(
    {
      workspaceId,
      actor,
      action: PUBLISH_ACTION,
      resourceType: PUBLISH_RESOURCE,
      inputs: { provider: provider.id, draft: drafted },
      skill: "stageMutation",
      dataScope: "public", // egress to a public platform surface
      seed: `social-send:${provider.id}:${drafted.draftId}`,
    },
    run,
  );
  return { proposalId: proposal.id, status: proposal.status, drafted };
}

/** Approve the gated proposal, then — and only then — publish to the platform. */
export async function approveAndPublish(args: {
  gate: GovernedGate;
  provider: SocialProvider;
  proposalId: string;
  drafted: DraftedAction;
  run: RunCtx;
}): Promise<PublishResult> {
  const { gate, provider, proposalId, drafted, run } = args;
  await gate.decide(proposalId, "approve", run); // human approval at the gate
  return provider.publish(drafted); // egress fires only post-approval
}
