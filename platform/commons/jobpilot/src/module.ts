/**
 * JobPilot's built-in catalog entry, owned by the Module itself.
 * `@bridge/module-manifests` assembles the catalog from it. Browser-safe: no
 * `node:` imports, no keyring — the web bundles this file.
 */
import { capability, readAll, writeAll, type BuiltInModuleWithSurface } from "@bridge/core";

const jobPilotCapabilities = [
  capability("job-pilot.jobs", "Jobs database and views", "database", [readAll("record"), writeAll("record")]),
  capability("job-pilot.score-fit", "Score job fit", "skill", [readAll("record")]),
  capability("job-pilot.transition-application", "Validate application transition", "skill", [writeAll("record")]),
  capability(
    "job-pilot.application-agent",
    "Application tracking Agent",
    "agent",
    [readAll("record"), writeAll("record")],
    [],
    [
      { manifestId: "job-pilot.score-fit", versionRange: "0.2.0" },
      { manifestId: "job-pilot.transition-application", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "job-pilot.track-application",
    "Job tracking intake",
    "automation",
    [readAll("record"), writeAll("record")],
    [],
    [
      { manifestId: "job-pilot.application-agent", versionRange: "0.2.0" },
      { manifestId: "job-pilot.score-fit", versionRange: "0.2.0" },
    ],
  ),
];

export const jobPilotModule: BuiltInModuleWithSurface = {
  computedRisk: "advisory",
  manifest: {
    name: "job-pilot",
    // 0.3.0: display name aligned to the owner-declared Module set.
    version: "0.3.0",
    kind: "organization_definition",
    summary: "Real job records and an application tracking pipeline.",
    description:
      "Stores real job records, scores fit deterministically, and validates every application-stage transition.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: jobPilotCapabilities,
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: { Record: "Application" } },
    module: {
      displayName: "JobManager",
      route: "/jobpilot",
      pages: [{
        id: "jobs",
        name: "Jobs",
        route: "/jobpilot",
        databaseId: "jobpilot.jobs",
        capabilityId: "job-pilot.jobs",
      }],
      agents: [{
        id: "application-agent",
        name: "Application tracking Agent",
        capabilityId: "job-pilot.application-agent",
        skillIds: ["job-pilot.score-fit", "job-pilot.transition-application"],
      }],
      automations: [{
        id: "track-application",
        name: "Job tracking intake",
        capabilityId: "job-pilot.track-application",
        agentId: "application-agent",
        trigger: "Job saved",
        procedure: "jobpilot.create",
      }],
      commonsNeeds: [{
        id: "interview-calendar-availability",
        title: "Check interview availability",
        description: "Let the Application tracking Agent read Calendar availability before proposing interview times.",
        agentId: "application-agent",
        kind: "skill",
        tags: ["need:interview-calendar-availability"],
      }],
    },
  },
};
