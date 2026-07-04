import { parseToolManifest, type ExternalToolManifest } from "@bridge/tool-kit";

// External tool manifest — JobPilot ships as a UI surface that COMPOSES internal capabilities;
// it must never re-implement sourcing/dedupe/facts itself (docs/raw/tool-standardization-plan.md,
// Phase 4 + section 7 "standalone-build contract"). A parallel session building the actual
// JobPilot feature (onboarding, card feed, tracker, writer/evaluator agents, apply waterfall)
// extends THIS manifest's `composes` list as it wires in each capability — it does not fork this
// file per session. `enrichment`/`llm`/`calendar`/`google` from the plan's Phase 4 line are not
// yet live internal tools, so only what's actually registered today is composed here.
export const jobPilotManifest: ExternalToolManifest = parseToolManifest({
  id: "jobpilot",
  name: "JobPilot",
  version: "0.0.1",
  kind: "external",
  runModes: ["account_bound"],
  surfaces: [{ route: "/jobpilot", nav: "Work", icon: "briefcase" }],
  composes: ["company-sourcing", "people-sourcing"],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as ExternalToolManifest;
