/**
 * GovernedGate — the orchestrator's view of the Universal Action Pipeline. The
 * social read/write paths never touch the graph directly: they propose through
 * the gate and act only on an approved decision. The real UniversalActionPipeline
 * satisfies this interface structurally; decoupling here lets the orchestration be
 * tested against the gate contract while the pipeline's own authority + agent-floor
 * math stays proven by @bridge/core's conformance suite.
 */
import type { ActionRequest, Decision, Proposal, RunCtx } from "@bridge/core";

export interface GovernedGate {
  propose(request: ActionRequest, run: RunCtx): Promise<Proposal>;
  decide(proposalId: string, decision: Decision, run: RunCtx, editedOutput?: unknown): Promise<unknown>;
}
