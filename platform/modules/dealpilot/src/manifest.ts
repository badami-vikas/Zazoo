import {
  parseExecutableManifest,
  type ModuleExecutableManifest,
} from "@bridge/capability-kit";
import { requireBuiltInModule } from "@bridge/module-manifests";

const dealPilotDefinition = requireBuiltInModule("deal-pilot");
const dealPilotModule = dealPilotDefinition.manifest.module;
if (!dealPilotModule) throw new Error("DealPilot built-in manifest must declare its Module surface");

export const dealPilotManifest: ModuleExecutableManifest = parseExecutableManifest({
  id: "dealpilot",
  name: dealPilotModule.displayName,
  version: dealPilotDefinition.manifest.version,
  kind: "module",
  runModes: ["account_bound"],
  surfaces: dealPilotModule.pages.map((page, index) => ({
    route: page.route,
    ...(index === 0 ? { nav: "Modules" as const } : {}),
    icon: page.id === "sources" ? "database" : page.id === "theses" ? "target" : "briefcase",
  })),
  skillDependencies: ["company-sourcing", "people-sourcing", "recorder"],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as ModuleExecutableManifest;
