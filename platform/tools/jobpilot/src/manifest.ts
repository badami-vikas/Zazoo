import {
  parseExecutableManifest,
  type ModuleExecutableManifest,
} from "@bridge/capability-kit";

// JobPilot is a surfaced Module that composes registered Skills. Add dependencies here as
// capabilities become real; do not reimplement sourcing, deduplication, or facts in the Module.
export const jobPilotManifest: ModuleExecutableManifest = parseExecutableManifest({
  id: "jobpilot",
  name: "JobPilot",
  version: "0.0.1",
  kind: "module",
  runModes: ["account_bound"],
  surfaces: [{ route: "/jobpilot", nav: "Work", icon: "briefcase" }],
  skillDependencies: ["company-sourcing", "people-sourcing"],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as ModuleExecutableManifest;
