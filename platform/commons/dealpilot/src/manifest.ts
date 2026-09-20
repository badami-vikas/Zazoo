import {
  parseExecutableManifest,
  type ModuleExecutableManifest,
} from "@bridge/capability-kit";
// Explicit: the pages type resolves through a core ↔ capability-kit type cycle and was
// order-dependent (implicit any on a cold `tsc -b`, fine on a warm one).
import type { ModulePageBinding } from "@bridge/core";
import { dealPilotModule as dealPilotDefinition } from "./module.js";

const dealPilotModule = dealPilotDefinition.manifest.module;

export const dealPilotManifest: ModuleExecutableManifest = parseExecutableManifest({
  id: "dealpilot",
  name: dealPilotModule.displayName,
  version: dealPilotDefinition.manifest.version,
  kind: "module",
  runModes: ["account_bound"],
  surfaces: dealPilotModule.pages.map((page: ModulePageBinding, index: number) => ({
    route: page.route,
    ...(index === 0 ? { nav: "Modules" as const } : {}),
    icon: page.id === "sources" ? "database" : page.id === "theses" ? "target" : "briefcase",
  })),
  skillDependencies: ["company-sourcing", "people-sourcing", "recorder"],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as ModuleExecutableManifest;
