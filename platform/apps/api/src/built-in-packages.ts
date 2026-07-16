/**
 * Signed source definitions for built-in Modules. Module Detail reads the same
 * manifests the package store installs; no frontend inventory is hardcoded.
 */
import type { CapabilityManifest, PackageManifest, RiskBand } from "@bridge/core";

type BuiltInPackage = {
  manifest: PackageManifest;
  computedRisk: RiskBand;
};

const readAll = (resourceType: string) => ({
  resourceType,
  action: "read" as const,
  dataScope: "all" as const,
  egress: false,
});

const writeAll = (resourceType: string) => ({
  resourceType,
  action: "write" as const,
  dataScope: "all" as const,
  egress: false,
});

const readPrivate = (resourceType: string) => ({
  resourceType,
  action: "read" as const,
  dataScope: "private" as const,
  egress: false,
});

const writePrivate = (resourceType: string) => ({
  resourceType,
  action: "write" as const,
  dataScope: "private" as const,
  egress: false,
});

function capability(
  id: string,
  name: string,
  capabilityType: CapabilityManifest["capabilityType"],
  permissions: CapabilityManifest["permissions"],
  connectors: CapabilityManifest["connectors"] = [],
  dependencies: CapabilityManifest["dependencies"] = [],
): CapabilityManifest {
  return {
    id,
    name,
    version: "0.2.0",
    capabilityType,
    origin: "built_in",
    audience: "team",
    permissions,
    connectors,
    dependencies,
  };
}

const dealPilotCapabilities = [
  capability("deal-pilot.deals", "Deals database and views", "view", [readAll("record"), writeAll("record")]),
  capability(
    "dealpilot.source",
    "Source governed deal candidates",
    "skill",
    [readAll("external:fetch")],
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
    "workflow",
    [readAll("external:fetch"), writeAll("record")],
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

const jobPilotCapabilities = [
  capability("job-pilot.jobs", "Jobs database and views", "view", [readAll("record"), writeAll("record")]),
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
    "workflow",
    [readAll("record"), writeAll("record")],
    [],
    [
      { manifestId: "job-pilot.application-agent", versionRange: "0.2.0" },
      { manifestId: "job-pilot.score-fit", versionRange: "0.2.0" },
    ],
  ),
];

const relationshipCapabilities = [
  capability("relationship.page.signals", "Signals", "view", [
    readPrivate("signal"),
    writePrivate("signal"),
    readPrivate("person"),
    readPrivate("community"),
  ]),
  capability("relationship.page.people", "People", "view", [
    readPrivate("person"),
    writePrivate("person"),
  ]),
  capability("relationship.page.communities", "Communities", "view", [
    readPrivate("community"),
    writePrivate("community"),
  ]),
  capability("relationship.submodule.helpdesk", "Helpdesk", "view", [
    readPrivate("touchpoint"),
    writePrivate("touchpoint"),
  ]),
  capability("relationship.skill.timeline-synthesis", "Relationship timeline synthesis", "skill", [
    readPrivate("signal"),
    readPrivate("person"),
    readPrivate("community"),
  ]),
  capability("relationship.skill.safe-action", "Safe relationship action proposal", "skill", [
    writePrivate("signal"),
  ]),
  capability("relationship.skill.help-routing", "Help request capability routing", "skill", [
    readPrivate("person"),
    readPrivate("community"),
    writePrivate("touchpoint"),
  ]),
  capability(
    "relationship.agent.steward",
    "Relationship Steward",
    "agent",
    [
      readPrivate("signal"),
      readPrivate("person"),
      readPrivate("community"),
      writePrivate("signal"),
    ],
    [],
    [
      { manifestId: "relationship.skill.timeline-synthesis", versionRange: "0.2.0" },
      { manifestId: "relationship.skill.safe-action", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "relationship.agent.community-steward",
    "Community Steward",
    "agent",
    [
      readPrivate("person"),
      readPrivate("community"),
      writePrivate("touchpoint"),
    ],
    [],
    [{ manifestId: "relationship.skill.help-routing", versionRange: "0.2.0" }],
  ),
  capability(
    "relationship.automation.meeting-prep",
    "Pre-meeting relationship review",
    "workflow",
    [readPrivate("person"), writePrivate("signal")],
    [],
    [
      { manifestId: "relationship.agent.steward", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "relationship.integration.google-sources",
    "Google relationship sources",
    "integration",
    [{
      resourceType: "external:fetch",
      action: "read",
      dataScope: "private",
      egress: true,
    }],
    [{ id: "google-gmail" }, { id: "google-calendar" }],
  ),
];

const calendarCapabilities = [
  capability(
    "calendar.events",
    "Calendar events database and views",
    "view",
    [readAll("event"), writeAll("event")],
    [{ id: "google-calendar", externalSend: true }],
  ),
  capability(
    "google.listCalendarEvents",
    "List Google Calendar events",
    "skill",
    [readAll("event")],
    [{ id: "google-calendar" }],
  ),
  capability(
    "google.composeEvent",
    "Compose a governed Calendar event",
    "skill",
    [writeAll("event")],
    [{ id: "google-calendar", externalSend: true }],
  ),
  capability(
    "calendar.agent",
    "Calendar Agent",
    "agent",
    [readAll("event"), writeAll("event")],
    [],
    [
      { manifestId: "google.listCalendarEvents", versionRange: "0.2.0" },
      { manifestId: "google.composeEvent", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "calendar.refresh",
    "Calendar refresh",
    "workflow",
    [readAll("event")],
    [{ id: "google-calendar" }],
    [
      { manifestId: "calendar.agent", versionRange: "0.2.0" },
      { manifestId: "google.listCalendarEvents", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "calendar.google",
    "Google Calendar",
    "integration",
    [readAll("event"), writeAll("event")],
    [{ id: "google-calendar", externalSend: true }],
  ),
];

export const BUILT_IN_PACKAGES: readonly BuiltInPackage[] = [
  {
    computedRisk: "advisory",
    manifest: {
      name: "deal-pilot",
      version: "0.2.0",
      kind: "workspace_definition",
      summary: "Sourcing waterfall and thesis-fit scoring for deal flow.",
      description:
        "Deal sourcing through governed brokerage-alert intake, candidate review, thesis-fit scoring, and real Deal records.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: dealPilotCapabilities,
      contextProviders: [],
      workspaceVocab: { alignsToBridgeTheme: true, domainTerms: { Record: "Deal" } },
      module: {
        displayName: "DealPilot",
        route: "/dealpilot",
        pages: [{
          id: "deals",
          name: "Deals",
          route: "/dealpilot",
          databaseId: "dealpilot.candidates",
          capabilityId: "deal-pilot.deals",
        }],
        agents: [{
          id: "sourcing-agent",
          name: "Deal sourcing Agent",
          capabilityId: "deal-pilot.sourcing-agent",
          skillIds: ["dealpilot.source"],
        }],
        automations: [{
          id: "source-intake",
          name: "Deal source intake",
          capabilityId: "deal-pilot.source-intake",
          agentId: "sourcing-agent",
          trigger: "Manual source refresh",
          procedure: "dealpilot.source",
        }],
      },
    },
  },
  {
    computedRisk: "advisory",
    manifest: {
      name: "job-pilot",
      version: "0.2.0",
      kind: "workspace_definition",
      summary: "Real job records and an application tracking pipeline.",
      description:
        "Stores real job records, scores fit deterministically, and validates every application-stage transition.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: jobPilotCapabilities,
      contextProviders: [],
      workspaceVocab: { alignsToBridgeTheme: true, domainTerms: { Record: "Application" } },
      module: {
        displayName: "JobPilot",
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
      },
    },
  },
  {
    computedRisk: "external",
    manifest: {
      name: "relationship",
      version: "0.2.0",
      kind: "workspace_definition",
      summary: "Signals, People, Communities, and governed relationship continuity.",
      description:
        "One Relationship Module over shared Record, Relation, and Event contracts. Private relationship Memory stays Module-associated; Helpdesk is a nested sub-module.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: relationshipCapabilities,
      contextProviders: [
        { kind: "email", required: false },
        { kind: "calendar", required: false },
        { kind: "capture", required: false },
      ],
      workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: "Relationship",
        route: "/module/relationship",
        pages: [
          {
            id: "signals",
            name: "Signals",
            route: "/module/relationship/signals",
            databaseId: "relationship.signals",
            capabilityId: "relationship.page.signals",
          },
          {
            id: "people",
            name: "People",
            route: "/module/relationship/people",
            databaseId: "relationship.people",
            capabilityId: "relationship.page.people",
          },
          {
            id: "communities",
            name: "Communities",
            route: "/module/relationship/communities",
            databaseId: "relationship.communities",
            capabilityId: "relationship.page.communities",
          },
        ],
        agents: [
          {
            id: "steward",
            name: "Relationship Steward",
            capabilityId: "relationship.agent.steward",
            skillIds: [
              "relationship.skill.timeline-synthesis",
              "relationship.skill.safe-action",
            ],
          },
          {
            id: "community-steward",
            name: "Community Steward",
            capabilityId: "relationship.agent.community-steward",
            skillIds: ["relationship.skill.help-routing"],
          },
        ],
        automations: [{
          id: "meeting-prep",
          name: "Pre-meeting relationship review",
          capabilityId: "relationship.automation.meeting-prep",
          agentId: "steward",
          trigger: "Upcoming meeting Event",
          procedure: "relationship.prepareMeeting",
        }],
      },
    },
  },
  {
    computedRisk: "external",
    manifest: {
      name: "calendar",
      version: "0.2.0",
      kind: "workspace_definition",
      summary: "Time-axis projection over Events and Records.",
      description:
        "Reads Google Calendar through an attributable Calendar Agent and governs every external calendar write.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: calendarCapabilities,
      contextProviders: [],
      workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: "Calendar",
        route: "/calendar/google",
        pages: [{
          id: "events",
          name: "Events",
          route: "/calendar/google",
          databaseId: "calendar.events",
          capabilityId: "calendar.events",
        }],
        agents: [{
          id: "calendar-agent",
          name: "Calendar Agent",
          capabilityId: "calendar.agent",
          skillIds: ["google.listCalendarEvents", "google.composeEvent"],
        }],
        automations: [{
          id: "refresh",
          name: "Calendar refresh",
          capabilityId: "calendar.refresh",
          agentId: "calendar-agent",
          trigger: "Manual refresh",
          procedure: "google.listEvents",
        }],
      },
    },
  },
];
