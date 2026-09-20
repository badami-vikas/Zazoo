import {
  parseExecutableManifest,
  type ModuleExecutableManifest,
} from "@bridge/capability-kit";
// Explicit: the pages type resolves through a core ↔ capability-kit type cycle and was
// order-dependent (implicit any on a cold `tsc -b`, fine on a warm one).
import type { ModulePageBinding } from "@bridge/core";
import { jobPilotModule as jobPilotDefinition } from "./module.js";

const jobPilotModule = jobPilotDefinition.manifest.module;

export const jobPilotManifest: ModuleExecutableManifest = parseExecutableManifest({
  id: "jobpilot",
  name: jobPilotModule.displayName,
  version: jobPilotDefinition.manifest.version,
  kind: "module",
  runModes: ["account_bound"],
  surfaces: jobPilotModule.pages.map((page: ModulePageBinding) => ({
    route: page.route,
    nav: "Modules",
    icon: "briefcase",
  })),
  skillDependencies: ["company-sourcing", "people-sourcing", "resume-evidence-evaluator"],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as ModuleExecutableManifest;
