/**
 * DealPilot's built-in catalog entry, owned by the Module itself.
 * `@bridge/module-manifests` assembles the catalog from it. Browser-safe: no
 * `node:` imports, no keyring — the web bundles this file.
 */
import { capability, readAll, writeAll, readPublic, type BuiltInModuleWithSurface, type ModuleRuntimeIds } from "@bridge/core";

export const DEALPILOT_SOURCING_AGENT_ID = "b0000000-0000-4000-a000-0000000000e1";
export const DEALPILOT_SOURCE_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000f1";
export const DEALPILOT_SOURCE_AUTOMATION_KEY = "deal-pilot.source-intake";

export const DEALPILOT_RUNTIME_IDS: ModuleRuntimeIds = {
  automations: { [DEALPILOT_SOURCE_AUTOMATION_KEY]: DEALPILOT_SOURCE_AUTOMATION_ID },
  agents: { "sourcing-agent": DEALPILOT_SOURCING_AGENT_ID },
};

const dealPilotCapabilities = [
  capability("deal-pilot.deals", "Deals database and views", "database", [readAll("record"), writeAll("record")]),
  capability("deal-pilot.sources", "Sources database and views", "database", [readAll("record"), writeAll("record")]),
  capability("deal-pilot.theses", "Theses database and views", "database", [readAll("record"), writeAll("record")]),
  capability(
    "dealpilot.source",
    "Source governed deal candidates",
    "skill",
    [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
    [{ id: "bizbuysell-alerts" }, { id: "google-gmail" }],
  ),
  capability(
    "deal-pilot.sourcing-agent",
    "Deal sourcing Agent",
    "agent",
    [readAll("record"), writeAll("record")],
    [],
    [{ manifestId: "dealpilot.source", versionRange: "0.2.0" }],
  ),
  capability(
    "deal-pilot.source-intake",
    "Deal source intake",
    "automation",
    [readPublic("external:fetch"), writeAll("record")],
    [{ id: "bizbuysell-alerts" }, { id: "google-gmail" }],
    [
      { manifestId: "deal-pilot.sourcing-agent", versionRange: "0.2.0" },
      { manifestId: "dealpilot.source", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "deal-pilot.brokerage-alerts",
    "Brokerage alert intake",
    "integration",
    [readAll("external:fetch")],
    [{ id: "bizbuysell-alerts" }, { id: "google-gmail" }],
  ),
];

export const dealPilotModule: BuiltInModuleWithSurface = {
  computedRisk: "external",
  manifest: {
    name: "deal-pilot",
    // 0.5.0: display name aligned to the owner-declared Module set
    // (APPROVALS 2026-08-05). `name`/`route` stay `deal-pilot` — those are
    // identifiers, migrated separately under the vocabulary plan.
    version: "0.5.0",
    kind: "organization_definition",
    summary: "Governed ETA sourcing across Deals, Sources, and Theses.",
    description:
      "Adds sibling Deal, Source, and Thesis Databases with reviewed discovery, provenance, rights/spend gates, and secure credential projection.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: dealPilotCapabilities,
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
    module: {
      displayName: "DealManager",
      route: "/dealpilot/deals",
      pages: [
        {
          id: "deals",
          name: "Deals",
          route: "/dealpilot/deals",
          databaseId: "dealpilot.deals",
          capabilityId: "deal-pilot.deals",
        },
        {
          id: "sources",
          name: "Sources",
          route: "/dealpilot/sources",
          databaseId: "dealpilot.sources",
          capabilityId: "deal-pilot.sources",
        },
        {
          id: "theses",
          name: "Theses",
          route: "/dealpilot/theses",
          databaseId: "dealpilot.theses",
          capabilityId: "deal-pilot.theses",
        },
      ],
      agents: [{
        id: "sourcing-agent",
        name: "Deal sourcing Agent",
        capabilityId: "deal-pilot.sourcing-agent",
        skillIds: ["dealpilot.source"],
        plane: "cloud",
      }],
      automations: [{
        id: "source-intake",
        name: "Deal source intake",
        capabilityId: "deal-pilot.source-intake",
        agentId: "sourcing-agent",
        trigger: "Manual source refresh",
        procedure: "dealpilot.source",
        automationId: DEALPILOT_SOURCE_AUTOMATION_KEY,
        runRoute: "/dealpilot/sources",
      }],
    },
  },
};
