/**
 * Signed source definitions for built-in Modules. Module Detail reads the same
 * manifests the module store installs; no frontend inventory is hardcoded.
 */
import type { CapabilityManifest, CommonsProvenance, ModuleManifest, RiskBand } from "@bridge/core";

export type BuiltInModule = {
  manifest: ModuleManifest;
  computedRisk: RiskBand;
};

export type CommonsBuiltInModule = BuiltInModule & {
  commons: {
    provenance: CommonsProvenance;
    tags: string[];
  };
};

export const DEALPILOT_SOURCING_AGENT_ID = "b0000000-0000-4000-a000-0000000000e1";
export const DEALPILOT_SOURCE_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000f1";
export const DEALPILOT_SOURCE_AUTOMATION_KEY = "deal-pilot.source-intake";
export const LEARNING_AGENT_RUNTIME_ID = "b0000000-0000-4000-a000-0000000000d2";
export const LEARNING_RECOMMENDATION_SKILL_ID = "stageLearningRecommendation";
export const CITED_ROLE_MODEL_PRACTICE_VERSION = "1.0.1";

export function resolveModuleAutomationRuntimeId(moduleName: string, manifestAutomationId: string): string | undefined {
  return moduleName === "deal-pilot" && manifestAutomationId === DEALPILOT_SOURCE_AUTOMATION_KEY
    ? DEALPILOT_SOURCE_AUTOMATION_ID
    : undefined;
}

export function isModuleRuntimeAutomationId(automationId: string): boolean {
  return automationId === DEALPILOT_SOURCE_AUTOMATION_ID;
}

export function resolveModuleAgentRuntimeId(moduleName: string, manifestAgentId: string): string | undefined {
  if (moduleName === "deal-pilot" && manifestAgentId === "sourcing-agent") {
    return DEALPILOT_SOURCING_AGENT_ID;
  }
  if (moduleName === "relationship" && manifestAgentId === "learning-agent") {
    return LEARNING_AGENT_RUNTIME_ID;
  }
  return undefined;
}

const SOURCE_REPOSITORY = "https://github.com/badami-vikas/relationship-os";
const INSPECTED_COMMIT = "a47b781463d078f61f6ed9bd278467df82ae95d7";
const BUILT_IN_SOURCE_REFS: Readonly<Record<string, string>> = {
  "deal-pilot": "platform/modules/dealpilot/src/manifest.ts",
  "job-pilot": "platform/modules/jobpilot/src/manifest.ts",
  relationship: "platform/apps/web/src/app/pages/RelationshipPage.tsx",
  "task-manager": "platform/packages/core/src/task-manager.ts",
};

function builtInSourceRef(moduleName: string): string {
  const sourceRef = BUILT_IN_SOURCE_REFS[moduleName];
  if (!sourceRef) throw new Error(`No inspected source reference declared for ${moduleName}`);
  return sourceRef;
}

function provenance(sourceRef: string): CommonsProvenance {
  return {
    sourceRepository: SOURCE_REPOSITORY,
    sourceRef,
    inspectedCommit: INSPECTED_COMMIT,
    repositoryLicense: "NOASSERTION",
    contentLicense: "LicenseRef-Bridge-Internal",
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
    "automation",
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
  capability("relationship.submodule.relations", "Relations", "view", [
    readPrivate("relation"),
    writePrivate("relation"),
  ]),
  capability("relationship.submodule.interactions", "Interactions", "view", [
    readPrivate("event"),
    writePrivate("event"),
  ]),
  capability("relationship.submodule.introductions", "Introductions", "view", [
    readPrivate("event"),
    writePrivate("event"),
  ]),
  capability("relationship.submodule.helpdesk", "Helpdesk", "view", [
    readPrivate("record"),
    writePrivate("record"),
    readPrivate("event"),
    writePrivate("event"),
  ]),
  capability("relationship.submodule.sources", "Sources", "view", [
    readPrivate("record"),
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
    writePrivate("event"),
  ]),
  capability("relationship.help-request.stage-offer", "Stage a Help Offer", "skill", [
    writePrivate("signal"),
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
      writePrivate("event"),
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
    "automation",
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

const taskManagerSkills = [
  ["goal-outcome-framing", "Internal Strategist"],
  ["candidate-task-generation", "Internal Strategist"],
  ["premortem-scenario", "Internal Strategist"],
  ["task-decomposition", "Internal Strategist"],
  ["task-tree-restructure", "Internal Strategist"],
  ["exit-test-authoring", "Internal Strategist"],
  ["task-reconciliation", "Internal Strategist"],
  ["queue-sequencing", "Internal Strategist"],
  ["impact-fit-analysis", "Internal Strategist"],
  ["agent-task-routing", "Chief of Staff"],
  ["reschedule-confidence-calibration", "Learning Agent"],
  ["proactive-opportunity-scan", "Internal Strategist"],
  ["ledger-projection", "Internal Strategist"],
  ["evidence-verification", "Internal Strategist"],
  ["progress-synthesis", "Chief of Staff"],
  ["habit-scaffolding", "Chief of Staff"],
] as const;

const taskManagerAgents = [
  { id: "chief-of-staff", name: "Chief of Staff" },
  { id: "internal-strategist", name: "Internal Strategist" },
  { id: "learning-agent", name: "Learning Agent" },
  { id: "governance-agent", name: "Governance Agent" },
  { id: "capability-builder", name: "Capability Builder" },
] as const;

const taskManagerAutomations = [
  ["task-created-impact-analysis", "Internal Strategist"],
  ["agent-task-routing-on-assign", "Chief of Staff"],
  ["reschedule-approval-gate", "Governance Agent"],
  ["routing-approval-gate", "Governance Agent"],
  ["task-tree-restructure-proposal", "Internal Strategist"],
  ["target-change-reopen-prompt", "Internal Strategist"],
  ["proactive-scan-cadence", "Internal Strategist"],
  ["completed-bay-sweep", "Governance Agent"],
  ["wip-breach-detector", "Governance Agent"],
  ["unverified-done-challenger", "Governance Agent"],
  ["dependency-unblock-notifier", "Chief of Staff"],
  ["ledger-drift-detector", "Internal Strategist"],
  ["stale-task-review", "Chief of Staff"],
  ["goal-review-cadence", "Internal Strategist"],
  ["standup-brief", "Chief of Staff"],
] as const;

const taskManagerCapabilities = [
  capability("task-manager.tasks", "Tasks Database and Views", "view", [readAll("record"), writeAll("record")]),
  ...taskManagerSkills.map(([id]) =>
    capability(`task-manager.skill.${id}`, id.replaceAll("-", " "), "skill", [readAll("record"), writeAll("record")])
  ),
  ...taskManagerAgents.map((agent) =>
    capability(
      `task-manager.agent.${agent.id}`,
      agent.name,
      "agent",
      [readAll("record"), writeAll("record")],
      [],
      taskManagerSkills
        .filter(([, owner]) => owner === agent.name)
        .map(([skillId]) => ({ manifestId: `task-manager.skill.${skillId}`, versionRange: "0.2.0" })),
    )
  ),
  ...taskManagerAutomations.map(([id, agentName]) => {
    const agent = taskManagerAgents.find((candidate) => candidate.name === agentName)!;
    return capability(
      `task-manager.automation.${id}`,
      id.replaceAll("-", " "),
      "automation",
      [readAll("record"), writeAll("record")],
      [],
      [{ manifestId: `task-manager.agent.${agent.id}`, versionRange: "0.2.0" }],
    );
  }),
];

export const BUILT_IN_MODULES: readonly BuiltInModule[] = [
  {
    computedRisk: "external",
    manifest: {
      name: "deal-pilot",
      version: "0.4.0",
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
          automationId: DEALPILOT_SOURCE_AUTOMATION_KEY,
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
      version: "0.2.2",
      kind: "organization_definition",
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
      organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
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
            skillIds: ["relationship.help-request.stage-offer"],
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
    computedRisk: "operational",
    manifest: {
      name: "task-manager",
      version: "1.0.0",
      kind: "organization_definition",
      summary: "One governed execution queue over a recursive Task Database.",
      description:
        "Provides Task Table, Form, Tree, Record Detail, governed restructuring, evidence verification, planning proposals, guard Automations, and deterministic tasks.md projection.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: taskManagerCapabilities,
      contextProviders: [],
      organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: "Task Manager",
        route: "/task-manager",
        pages: [{
          id: "queue",
          name: "Queue",
          route: "/task-manager",
          databaseId: "task-manager.tasks",
          capabilityId: "task-manager.tasks",
        }],
        agents: taskManagerAgents.map((agent) => ({
          ...agent,
          capabilityId: `task-manager.agent.${agent.id}`,
          skillIds: taskManagerSkills
            .filter(([, owner]) => owner === agent.name)
            .map(([skillId]) => `task-manager.skill.${skillId}`),
        })),
        automations: taskManagerAutomations.map(([id, agentName]) => {
          const agent = taskManagerAgents.find((candidate) => candidate.name === agentName)!;
          return {
            id,
            name: id.replaceAll("-", " "),
            capabilityId: `task-manager.automation.${id}`,
            agentId: agent.id,
            trigger: id.includes("cadence") || id.includes("brief") ? "Scheduled" : "Task Event",
            procedure: `task-manager.${id}`,
          };
        }),
      },
    },
  },
];

export function requireBuiltInModule(moduleName: string): BuiltInModule {
  const builtIn = BUILT_IN_MODULES.find((candidate) => candidate.manifest.name === moduleName);
  if (!builtIn) throw new Error(`Unknown built-in Module: ${moduleName}`);
  return builtIn;
}

const interviewCalendarAvailability: BuiltInModule = {
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
        ...capability(
          "google.listCalendarEvents",
          "List Google Calendar events",
          "skill",
          [readAll("event")],
          [{ id: "google-calendar" }],
        ),
        version: "1.0.0",
        audience: "private",
      },
    ],
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  },
};

const citedRoleModelPractice: BuiltInModule = {
  computedRisk: "advisory",
  manifest: {
    name: "cited-role-model-practice",
    version: CITED_ROLE_MODEL_PRACTICE_VERSION,
    kind: "skill",
    summary: "Stage a cited role-model practice recommendation for review.",
    description:
      "Reuses Bridge's governed Learning Agent Skill to restage an approved local onboarding recommendation that remains editable or vetoable in Approvals.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        id: LEARNING_RECOMMENDATION_SKILL_ID,
        name: "Stage cited role-model practice",
        version: CITED_ROLE_MODEL_PRACTICE_VERSION,
        capabilityType: "skill",
        origin: "built_in",
        audience: "private",
        permissions: [readPrivate("signal"), writePrivate("signal")],
        connectors: [],
        dependencies: [],
      },
    ],
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  },
};

export const COMMONS_BUILT_IN_MODULES: readonly CommonsBuiltInModule[] = [
  // Relationship's current full capability union forms the lethal trifecta.
  // It remains a local built-in Module but cannot enter Commons until split
  // into independently safe generalized Results.
  ...BUILT_IN_MODULES.filter((pkg) => pkg.manifest.name !== "relationship").map((pkg) => ({
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
