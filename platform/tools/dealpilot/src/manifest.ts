import {
  parseExecutableManifest,
  type ModuleExecutableManifest,
} from "@bridge/capability-kit";

// DealPilot is a surfaced Module that composes registered Skills. Add dependencies here as
// capabilities become real; do not reimplement sourcing, deduplication, facts, or recording.
export const dealPilotManifest: ModuleExecutableManifest = parseExecutableManifest({
  id: "dealpilot",
  name: "DealPilot",
  version: "0.1.0",
  kind: "module",
  runModes: ["account_bound"],
  surfaces: [
    { route: "/dealpilot/deals", nav: "Modules", icon: "briefcase" },
    { route: "/dealpilot/sources", icon: "database" },
    { route: "/dealpilot/theses", icon: "target" },
  ],
  skillDependencies: ["company-sourcing", "people-sourcing", "recorder"],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as ModuleExecutableManifest;
