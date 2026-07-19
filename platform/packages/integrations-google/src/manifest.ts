/**
 * Google Integration manifest. Declares run modes, model bindings, permissions,
 * egress flags), the typed output_contract (vocabulary: Person/Memory/Event/
 * Signal — never Lead/Deal/Contact) and the gated intake_policy.
 */
export interface IntegrationCapability {
  resourceType: string;
  action: string;
  dataScope: "public" | "private" | "all";
  egress: boolean;
}
export interface IntegrationOutputMapping {
  from: string;
  to: "Person" | "Memory" | "Event" | "Signal" | "Initiative";
  note?: string;
}
export interface IntegrationManifest {
  id: string;
  name: string;
  version: string;
  source_repo: string;
  run_modes: Array<"standalone" | "account_bound">;
  model_bindings: Array<{ use: "vision" | "transcription" | "llm"; plane_default: "local" | "cloud" }>;
  capabilities: IntegrationCapability[];
  output_contract: IntegrationOutputMapping[];
  intake_policy: { quarantine: boolean; commit_via: "pipeline_proposal" };
}

export const GOOGLE_MANIFEST: IntegrationManifest = {
  id: "integration-google",
  name: "Gmail + Google Calendar",
  version: "0.1.0",
  source_repo: "googleapis (official) — direct, no third-party connector SaaS",
  // Account-bound only: private relationship data, never a shareable anon link.
  run_modes: ["account_bound"],
  model_bindings: [],
  capabilities: [
    // Inbound sourcing through the gate (cloud egress agent only).
    { resourceType: "external:fetch", action: "read", dataScope: "public", egress: true },
    // Outbound send/write through the gate — agent-floor DENY; human >= L2 only.
    { resourceType: "external:send", action: "share", dataScope: "public", egress: true },
    // Local-plane writes from intake proposals (draft-then-approve).
    { resourceType: "event", action: "write", dataScope: "all", egress: false },
    { resourceType: "signal", action: "write", dataScope: "all", egress: false },
    // Counterparty identity — the only public/identity fact dual-written outward.
    { resourceType: "person", action: "write", dataScope: "public", egress: false },
  ],
  output_contract: [
    { from: "gmail.thread", to: "Event", note: "kind=email; linked to the matched Person" },
    { from: "gmail.thread", to: "Memory", note: "thread summary + body (local only)" },
    { from: "calendar.event", to: "Event", note: "kind=meeting" },
    { from: "gmail.sender|calendar.attendee", to: "Person", note: "new counterparty identity (public, dual-written)" },
    { from: "ambiguous.match", to: "Signal", note: "possible_duplicate — manual confirmation, never auto-linked" },
  ],
  intake_policy: { quarantine: true, commit_via: "pipeline_proposal" },
};
