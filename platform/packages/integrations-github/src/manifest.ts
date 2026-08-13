/**
 * GitHub Integration manifest. Declares run modes, permissions (egress
 * flags), the typed output_contract (vocabulary: Record — GitHub rows are
 * DevPilot-owned Records, never Person/Event/Memory/Signal), and the gated
 * intake_policy. Mirrors @bridge/integrations-google's manifest.ts shape.
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
  /**
   * `pipeline_proposal` (Google's shape) is for content that joins the
   * shared Person/Event/Memory graph and needs human review before it does.
   * `direct_write` is organization-authenticated CRUD into a Module's OWN
   * table with no cross-module effect requiring approval — the same tier as
   * JobPilot's job-listing sync (jobpilot-store.ts). GitHub repo/PR/issue
   * metadata is the latter: it lands in devpilot_* tables the owner already
   * controls by choosing which repos to track, not in the shared graph.
   */
  intake_policy: { quarantine: boolean; commit_via: "pipeline_proposal" | "direct_write" };
}

export const GITHUB_MANIFEST: IntegrationManifest = {
  id: "integration-github",
  name: "GitHub",
  version: "0.1.0",
  source_repo: "GitHub REST API v3 (official) — direct, no third-party connector SaaS",
  // Account-bound only: a Personal Access Token belongs to one GitHub account.
  run_modes: ["account_bound"],
  model_bindings: [],
  capabilities: [
    // Read-only sourcing. No external:send in D1 — DevPilot never posts back
    // to GitHub; D2's PR-review drafts are stored locally and, if posting is
    // ever added, that is a separate per-item approval-gated capability.
    { resourceType: "external:fetch", action: "read", dataScope: "public", egress: true },
    // Local module-table writes from the sync Skill.
    { resourceType: "record", action: "write", dataScope: "all", egress: false },
  ],
  output_contract: [
    { from: "github.repo", to: "Record", note: "devpilot_repos row" },
    { from: "github.pull", to: "Record", note: "devpilot_pulls row" },
    { from: "github.issue", to: "Record", note: "devpilot_issues row (source=github)" },
  ],
  intake_policy: { quarantine: false, commit_via: "direct_write" },
};
