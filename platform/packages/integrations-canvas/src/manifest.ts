/**
 * Canvas Integration manifest. Declares run modes, permissions (egress
 * flags), the typed output_contract (vocabulary: Record — Canvas rows are
 * Academics-owned Records, never Person/Event/Memory/Signal), and the gated
 * intake_policy. Mirrors @bridge/integrations-github's manifest.ts shape.
 */
export interface IntegrationCapability {
  resourceType: string;
  action: string;
  dataScope: "public" | "private" | "all";
  egress: boolean;
}
export interface IntegrationOutputMapping {
  from: string;
  to: "Person" | "Memory" | "Event" | "Signal" | "Record";
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
  /** `direct_write` — organization-authenticated CRUD into the Academics
   * Module's OWN tables with no cross-module effect requiring approval, the
   * same tier as DevPilot's GitHub sync: course/assignment metadata for the
   * owner's own enrollments lands in academics_* tables, not the shared
   * Person/Event/Memory graph. */
  intake_policy: { quarantine: boolean; commit_via: "pipeline_proposal" | "direct_write" };
}

export const CANVAS_MANIFEST: IntegrationManifest = {
  id: "integration-canvas",
  name: "Canvas LMS",
  version: "0.1.0",
  source_repo: "Canvas LMS REST API v1 (official, per-institution instance) — direct, no third-party connector SaaS",
  // Account-bound only: a manual access token belongs to one Canvas account
  // on one institution's instance.
  run_modes: ["account_bound"],
  model_bindings: [],
  capabilities: [
    // Read-only sourcing of the owner's OWN enrollments (private LMS data,
    // unlike GitHub's public-scope tracker). Bridge never posts, submits, or
    // writes anything back to Canvas.
    { resourceType: "external:fetch", action: "read", dataScope: "private", egress: true },
    // Local module-table writes from the sync Skill.
    { resourceType: "record", action: "write", dataScope: "private", egress: false },
  ],
  output_contract: [
    { from: "canvas.course", to: "Record", note: "academics_subjects row (source=canvas)" },
    { from: "canvas.assignment", to: "Record", note: "academics_assignments row (source=canvas)" },
  ],
  intake_policy: { quarantine: false, commit_via: "direct_write" },
};
