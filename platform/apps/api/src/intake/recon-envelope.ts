// platform/apps/api/src/intake/recon-envelope.ts
// Maps Recon's CaptureEnvelope payload into governed propose-requests. Pure; no I/O.
// The subject + all its memories become ONE person:write proposal; each risk signal
// becomes its own signal:write proposal. Actor is the drafts-only INTAKE_AGENT acting
// on behalf of the pilot user, so every row lands as pending_review (draft-then-approve).
import type { UniversalActionPipeline } from "@bridge/core";

/** The propose-request shape, derived from the pipeline so we never drift from core. */
export type ProposeReq = Parameters<UniversalActionPipeline["propose"]>[0];

/** The subset of Recon's CaptureEnvelope this seam consumes (decoupled from Recon's types). */
export interface ReconEnvelope {
  contract: "recon.v1";
  dataScope: "public";
  payload: {
    person: { name: string; company: string; domain?: string; identifiers: Record<string, string> };
    memories: Array<{ text: string; source: string; url?: string; tier: "A" | "B" | "C" }>;
    signals: Array<{ text: string; source: string; url?: string }>;
  };
}

export interface ReconIntakeIdentities {
  workspaceId: string;
  intakeAgentId: string;
  userId: string;
}

export function envelopeToProposeRequests(env: ReconEnvelope, ids: ReconIntakeIdentities): ProposeReq[] {
  const base = {
    workspaceId: ids.workspaceId,
    actor: { type: "agent" as const, id: ids.intakeAgentId },
    onBehalfOf: { type: "user" as const, id: ids.userId },
    action: "write" as const,
    skill: "stageMutation",
    dataScope: "public" as const,
  };

  const personReq: ProposeReq = {
    ...base,
    resourceType: "person",
    inputs: { person: env.payload.person, memories: env.payload.memories },
  };

  const signalReqs: ProposeReq[] = env.payload.signals.map((s) => ({
    ...base,
    resourceType: "signal",
    inputs: { text: s.text, source: s.source, ...(s.url ? { url: s.url } : {}) },
  }));

  return [personReq, ...signalReqs];
}
