import {
  parseExecutableManifest,
  type ModuleExecutableManifest,
} from "@bridge/capability-kit";
import { requireBuiltInModule } from "@bridge/module-manifests";

const jobPilotDefinition = requireBuiltInModule("job-pilot");
const jobPilotModule = jobPilotDefinition.manifest.module;
if (!jobPilotModule) throw new Error("JobPilot built-in manifest must declare its Module surface");

export const jobPilotManifest: ModuleExecutableManifest = parseExecutableManifest({
  id: "jobpilot",
  name: jobPilotModule.displayName,
  version: jobPilotDefinition.manifest.version,
  kind: "module",
  runModes: ["account_bound"],
  surfaces: jobPilotModule.pages.map((page) => ({
    route: page.route,
    nav: "Modules",
    icon: "briefcase",
  })),
  skillDependencies: ["company-sourcing", "people-sourcing", "resume-evidence-evaluator"],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as ModuleExecutableManifest;
