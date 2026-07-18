/**
 * Signed source definitions for built-in Modules. Module Detail reads the same
 * manifests the package store installs; no frontend inventory is hardcoded.
 */
import type { CapabilityManifest, CommonsProvenance, PackageManifest, RiskBand } from "@bridge/core";

type BuiltInPackage = {
  manifest: PackageManifest;
  computedRisk: RiskBand;
};

type CommonsBuiltInPackage = BuiltInPackage & {
  commons: {
    provenance: CommonsProvenance;
    tags: string[];
  };
};

export const DEALPILOT_SOURCING_AGENT_ID = "b0000000-0000-4000-a000-0000000000e1";
export const DEALPILOT_SOURCE_RITUAL_ID = "b0000000-0000-4000-a000-0000000000f1";
export const DEALPILOT_SOURCE_RITUAL_KEY = "deal-pilot.source-intake";
export const LEARNING_AGENT_RUNTIME_ID = "b0000000-0000-4000-a000-0000000000d2";
export const LEARNING_RECOMMENDATION_SKILL_ID = "stageLearningRecommendation";

export function resolveModuleRitualRuntimeId(packageName: string, manifestRitualId: string): string | undefined {
  return packageName === "deal-pilot" && manifestRitualId === DEALPILOT_SOURCE_RITUAL_KEY
    ? DEALPILOT_SOURCE_RITUAL_ID
    : undefined;
}

export function isModuleRuntimeRitualId(ritualId: string): boolean {
  return ritualId === DEALPILOT_SOURCE_RITUAL_ID;
}

export function resolveModuleAgentRuntimeId(packageName: string, manifestAgentId: string): string | undefined {
  if (packageName === "deal-pilot" && manifestAgentId === "sourcing-agent") {
    return DEALPILOT_SOURCING_AGENT_ID;
  }
  if (packageName === "relationship" && manifestAgentId === "learning-agent") {
    return LEARNING_AGENT_RUNTIME_ID;
  }
  return undefined;
}

const SOURCE_REPOSITORY = "https://github.com/badami-vikas/relationship-os";
const INSPECTED_COMMIT = "5775e5b9cf63938e9f2a8220e63b36e1122eac80";
const BUILT_IN_SOURCE_REFS: Readonly<Record<string, string>> = {
  "deal-pilot": "platform/tools/dealpilot/src/manifest.ts",
  "job-pilot": "platform/tools/jobpilot/src/manifest.ts",
  relationship: "platform/apps/web/src/app/pages/RelationshipPage.tsx",
  calendar: "platform/apps/web/src/app/pages/CalendarPage.tsx",
};

function builtInSourceRef(packageName: string): string {
  const sourceRef = BUILT_IN_SOURCE_REFS[packageName];
  if (!sourceRef) throw new Error(`No inspected source reference declared for ${packageName}`);
  return sourceRef;
}

function provenance(sourceRef: string): CommonsProvenance {
  return {
    sourceRepository: SOURCE_REPOSITORY,
    sourceRef,
    inspectedCommit: INSPECTED_COMMIT,
    repositoryLicense: "NOASSERTION",
    artifactLicense: "LicenseRef-Bridge-Internal",
    licenseVerified: true,
  };
}

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

const readPublic = (resourceType: string) => ({
  resourceType,
  action: "read" as const,
  dataScope: "public" as const,
  egress: true,
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
  capability("deal-pilot.sources", "Sources database and views", "view", [readAll("record"), writeAll("record")]),
  capability("deal-pilot.theses", "Theses database and views", "view", [readAll("record"), writeAll("record")]),
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
    "workflow",
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
    "relationship.agent.learning",
    "Learning Agent",
    "agent",
    [writePrivate("signal")],
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
    computedRisk: "external",
    manifest: {
      name: "deal-pilot",
      version: "0.4.0",
      kind: "workspace_definition",
      summary: "Governed ETA sourcing across Deals, Sources, and Theses.",
      description:
        "Adds sibling Deal, Source, and Thesis Databases with reviewed discovery, provenance, rights/spend gates, and secure credential projection.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: dealPilotCapabilities,
      contextProviders: [],
      workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: "DealPilot",
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
          ritualId: DEALPILOT_SOURCE_RITUAL_KEY,
          runRoute: "/dealpilot/sources",
        }],
      },
    },
  },
  {
    computedRisk: "advisory",
    manifest: {
      name: "job-pilot",
      version: "0.2.1",
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
  },
  {
    computedRisk: "external",
    manifest: {
      name: "relationship",
      version: "0.2.1",
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
          {
            id: "learning-agent",
            name: "Learning Agent",
            capabilityId: "relationship.agent.learning",
            skillIds: [],
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
        commonsNeeds: [{
          id: "cited-role-model-practice",
          title: "Cited role-model practice",
          description:
            "Let the Learning Agent turn your saved role-model preference into a cited recommendation for review.",
          agentId: "learning-agent",
          kind: "skill",
          tags: ["need:cited-role-model-practice"],
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

const interviewCalendarAvailability: BuiltInPackage = {
  computedRisk: "informational",
  manifest: {
    name: "interview-calendar-availability",
    version: "1.0.0",
    kind: "skill",
    summary: "Read Calendar availability before proposing interview times.",
    description:
      "Reuses Bridge's governed Google Calendar event reader so a Module Agent can check real availability without gaining write or send authority.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        ...calendarCapabilities.find((capability) => capability.id === "google.listCalendarEvents")!,
        version: "1.0.0",
        audience: "private",
      },
    ],
    contextProviders: [],
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  },
};

const citedRoleModelPractice: BuiltInPackage = {
  computedRisk: "advisory",
  manifest: {
    name: "cited-role-model-practice",
    version: "1.0.0",
    kind: "skill",
    summary: "Stage a cited role-model practice recommendation for review.",
    description:
      "Reuses Bridge's governed Learning Agent Skill to turn the user's saved onboarding preference into a cited recommendation that remains editable or vetoable in Approvals.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        id: LEARNING_RECOMMENDATION_SKILL_ID,
        name: "Stage cited role-model practice",
        version: "1.0.0",
        capabilityType: "skill",
        origin: "built_in",
        audience: "private",
        permissions: [writePrivate("signal")],
        connectors: [],
        dependencies: [],
      },
    ],
    contextProviders: [],
    workspaceVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  },
};

export const COMMONS_BUILT_IN_PACKAGES: readonly CommonsBuiltInPackage[] = [
  // Relationship's current full capability union forms the lethal trifecta.
  // It remains a local built-in Module but cannot enter Commons until split
  // into independently safe generalized artifacts.
  ...BUILT_IN_PACKAGES.filter((pkg) => pkg.manifest.name !== "relationship").map((pkg) => ({
    ...pkg,
    commons: {
      provenance: provenance(builtInSourceRef(pkg.manifest.name)),
      tags: ["built-in", pkg.manifest.kind],
    },
  })),
  {
    ...interviewCalendarAvailability,
    commons: {
      provenance: provenance("platform/packages/integrations-google/src/skills.ts"),
      tags: ["built-in", "calendar", "interview", "need:interview-calendar-availability"],
    },
  },
  {
    ...citedRoleModelPractice,
    commons: {
      provenance: provenance("platform/apps/api/src/wiring.ts"),
      tags: ["built-in", "learning", "role-model", "need:cited-role-model-practice"],
    },
  },
];
