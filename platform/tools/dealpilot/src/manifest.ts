import { parseToolManifest, type ExternalToolManifest } from "@bridge/tool-kit";

// External tool manifest — DealPilot ships as a UI surface that COMPOSES internal capabilities;
// it must never re-implement sourcing/dedupe/facts/recording itself (docs/raw/
// tool-standardization-plan.md, section 7 "standalone-build contract"). A parallel session
// building the actual DealPilot feature (kanban/feed/detail UI, ThesisFit scoring, deal_facts
// schema, CIM-request sequences) extends THIS manifest's `composes` list as it wires in each
// capability — it does not fork this file per session.
export const dealPilotManifest: ExternalToolManifest = parseToolManifest({
  id: "dealpilot",
  name: "DealPilot",
  version: "0.0.1",
  kind: "external",
  runModes: ["account_bound"],
  surfaces: [{ route: "/dealpilot", nav: "Work", icon: "briefcase" }],
  composes: ["company-sourcing", "people-sourcing", "recorder"],
  capabilities: [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
  intakePolicy: { quarantine: true, commitVia: "pipeline_proposal", scope: "public", accountBoundOnly: true },
}) as ExternalToolManifest;
