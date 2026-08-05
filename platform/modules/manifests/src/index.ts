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
export const INTERNAL_STRATEGIST_AGENT_RUNTIME_ID = "b0000000-0000-4000-a000-0000000000d3";
export const GOVERNANCE_AGENT_RUNTIME_ID = "b0000000-0000-4000-a000-0000000000d4";
export const TASK_MANAGER_DRIFT_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000f7";
export const TASK_MANAGER_SWEEP_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000f8";
export const TASK_MANAGER_DRIFT_AUTOMATION_KEY = "task-manager.ledger-drift-detector";
export const TASK_MANAGER_SWEEP_AUTOMATION_KEY = "task-manager.completed-bay-sweep";
export const LEARNING_RECOMMENDATION_SKILL_ID = "stageLearningRecommendation";
export const CITED_ROLE_MODEL_PRACTICE_VERSION = "1.0.1";

export function resolveModuleAutomationRuntimeId(moduleName: string, manifestAutomationId: string): string | undefined {
  if (moduleName === "deal-pilot" && manifestAutomationId === DEALPILOT_SOURCE_AUTOMATION_KEY) {
    return DEALPILOT_SOURCE_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_DRIFT_AUTOMATION_KEY) {
    return TASK_MANAGER_DRIFT_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_SWEEP_AUTOMATION_KEY) {
    return TASK_MANAGER_SWEEP_AUTOMATION_ID;
  }
  return undefined;
}

export function isModuleRuntimeAutomationId(automationId: string): boolean {
  return [
    DEALPILOT_SOURCE_AUTOMATION_ID,
    TASK_MANAGER_DRIFT_AUTOMATION_ID,
    TASK_MANAGER_SWEEP_AUTOMATION_ID,
  ].includes(automationId);
}

export function resolveModuleAgentRuntimeId(moduleName: string, manifestAgentId: string): string | undefined {
  if (moduleName === "deal-pilot" && manifestAgentId === "sourcing-agent") {
    return DEALPILOT_SOURCING_AGENT_ID;
  }
  if (moduleName === "relationship" && manifestAgentId === "learning-agent") {
    return LEARNING_AGENT_RUNTIME_ID;
  }
  if (moduleName === "task-manager" && manifestAgentId === "internal-strategist") {
    return INTERNAL_STRATEGIST_AGENT_RUNTIME_ID;
  }
  if (moduleName === "task-manager" && manifestAgentId === "governance-agent") {
    return GOVERNANCE_AGENT_RUNTIME_ID;
  }
  return undefined;
}

const SOURCE_REPOSITORY = "https://github.com/badami-vikas/relationship-os";
const INSPECTED_COMMIT = "689fca0ca742cfa01eae8e3785b00c50c5e3ca5b";
const BUILT_IN_SOURCE_REFS: Readonly<Record<string, string>> = {
  "deal-pilot": "platform/modules/dealpilot/src/manifest.ts",
  "job-pilot": "platform/modules/jobpilot/src/manifest.ts",
  relationship: "platform/apps/web/src/app/pages/RelationshipPage.tsx",
  "task-manager": "platform/packages/core/src/task-manager.ts",
  whatsapp: "platform/modules/whatsapp/src/index.ts",
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
  capability("web-research", "Governed public web research", "skill", [
    readPublic("external:fetch"),
    writePrivate("event"),
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
    [
      writePrivate("signal"),
      writePrivate("event"),
      readPublic("external:fetch"),
    ],
    [],
    [
      { manifestId: "relationship.help-request.stage-offer", versionRange: "0.2.0" },
      { manifestId: "web-research", versionRange: "0.2.0" },
    ],
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

/**
 * WhatsApp Module capabilities.
 *
 * Every permission here is `private` scope and NONE declares egress: v1 reads
 * the owner's own WhatsApp session and writes nothing outbound. The read-only
 * guarantee is enforced in the desktop shell's op allowlist
 * (`whatsapp_webview.rs::script_for_op`); this manifest is the declaration
 * that matches it, and the manifest test asserts the two stay honest.
 */
const whatsappCapabilities = [
  capability("whatsapp.page.chats", "Chats", "view", [readPrivate("event")]),
  capability("whatsapp.page.tools", "Tools", "view", [readPrivate("record")]),
  capability("whatsapp.tool.contact-extractor", "Contact Extractor", "skill", [
    readPrivate("person"),
    writePrivate("person"),
    writePrivate("community"),
    writePrivate("signal"),
  ]),
  // Bridge's OWN data about a subject. No WhatsApp permission of any kind
  // appears here because the Tool touches no WhatsApp surface: it reads and
  // writes local Records the owner authored themselves.
  capability("whatsapp.tool.annotations", "Tags and Internal Notes", "skill", [
    readPrivate("record"),
    writePrivate("record"),
  ]),
  // Read-only over Bridge's own action log. No WhatsApp read permission: the
  // analytics are built from what Bridge did, never from the account.
  capability("whatsapp.tool.audit", "Analytics and Audit Log", "skill", [
    readPrivate("record"),
  ]),
  // The three automation Tools (TASK-030, ADR-158 under AP-091). None declares
  // egress: authoring a rule, reading the queue and naming an Agent are all
  // local reads and writes. The outbound permission stays where the sending
  // actually happens — behind the consent gate in the Agent's own capability —
  // rather than being granted to the surfaces that merely schedule it.
  capability("whatsapp.tool.automation-rules", "Automation Rules", "skill", [
    readPrivate("event"),
    writePrivate("record"),
  ]),
  capability("whatsapp.tool.scheduled-actions", "Scheduled Actions", "skill", [
    readPrivate("record"),
    writePrivate("record"),
  ]),
  capability("whatsapp.tool.agent-assignment", "Agent Assignment", "skill", [
    readPrivate("person"),
    writePrivate("record"),
  ]),
  capability(
    "whatsapp.agent.contact-steward",
    "WhatsApp Contact Steward",
    "agent",
    [readPrivate("person"), writePrivate("person"), writePrivate("community")],
    [],
    [{ manifestId: "whatsapp.tool.contact-extractor", versionRange: "0.2.0" }],
  ),
  /**
   * The Agent an Automation actually starts a Run of.
   *
   * It is separate from the Contact Steward because the two answer for
   * different things: the Steward reconciles an address book, this one answers
   * for a conversation. Assignment (`assignment.ts`) names one of them per chat
   * or Person, and an Automation may only start a Run of the Agent that was
   * named — that is what "only an attributable allowed Agent invokes a Skill"
   * means in this Module.
   *
   * It declares the WRITE permission for messages, and it is the only WhatsApp
   * capability that does. Sending is still not a thing this Agent can do
   * unilaterally: every message it proposes goes through the consent gate, the
   * send discipline, and the Rust-enforced ceiling.
   */
  capability(
    "whatsapp.agent.conversation-steward",
    "WhatsApp Conversation Steward",
    "agent",
    [readPrivate("event"), readPrivate("person"), writePrivate("event"), writePrivate("record")],
    [],
    [
      { manifestId: "whatsapp.tool.automation-rules", versionRange: "0.2.0" },
      { manifestId: "whatsapp.tool.scheduled-actions", versionRange: "0.2.0" },
      { manifestId: "whatsapp.tool.agent-assignment", versionRange: "0.2.0" },
    ],
  ),
];

const taskManagerSkills = [
  ["create-task", "Internal Strategist"],
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
  ["completed-bay-sweep", "Governance Agent"],
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
    capability(`task-manager.skill.${id}`, `Skill: ${id.replaceAll("-", " ")}`, "skill", [readAll("record"), writeAll("record")])
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
      `Automation: ${id.replaceAll("-", " ")}`,
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
  },
  {
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
  },
  {
    computedRisk: "external",
    manifest: {
      name: "relationship",
      // 0.3.0: display name aligned to the owner-declared Module set, and this
      // Module becomes a nav PARENT (WhatsApp declares it, ADR-178).
      version: "0.3.0",
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
        displayName: "NetworkManager",
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
            skillIds: ["relationship.help-request.stage-offer", "web-research"],
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
    // External: the Module renders a third-party site inside the desktop shell
    // and reads the owner's private contact graph out of it.
    computedRisk: "external",
    manifest: {
      name: "whatsapp",
      // 0.2.0: the Tools Page grew five Tools (annotations, audit, rules,
      // queue, assignment) and the Conversation Steward Agent. The installed
      // manifest is immutable per version — content changes REQUIRE this bump,
      // or seedBuiltInModules refuses to start (the 2026-08-02 Local Plane
      // outage was exactly that refusal).
      // 0.3.0: declares NetworkManager as its nav parent (ADR-178).
      version: "0.3.0",
      kind: "organization_definition",
      summary: "Your WhatsApp Web session, with Tools that turn it into People and Communities.",
      description:
        "Runs the owner's own WhatsApp Web session inside the Bridge desktop shell and hosts a Tool list over it. The Contact Extractor stages individual contacts as People and selected groups as Communities with participant membership, all through draft-then-approve. Raw capture and phone numbers stay on the Local Plane.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: whatsappCapabilities,
      contextProviders: [{ kind: "capture", required: false }],
      organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: "WhatsApp",
        // A sub-module of NetworkManager: WhatsApp's Chats are a SOURCE of
        // People and Communities, not a second copy of them. Nesting is nav
        // only — the Local-Plane session, the capture, and every Skill here
        // stay governed exactly as they were at the root.
        parentModule: "relationship",
        route: "/module/whatsapp/chats",
        pages: [
          {
            id: "chats",
            name: "Chats",
            route: "/module/whatsapp/chats",
            databaseId: "whatsapp.chats",
            capabilityId: "whatsapp.page.chats",
          },
          {
            id: "tools",
            name: "Tools",
            route: "/module/whatsapp/tools",
            databaseId: "whatsapp.tools",
            capabilityId: "whatsapp.page.tools",
          },
        ],
        agents: [
          {
            id: "contact-steward",
            name: "WhatsApp Contact Steward",
            capabilityId: "whatsapp.agent.contact-steward",
            skillIds: ["whatsapp.tool.contact-extractor"],
            // The session is desktop-local and never leaves the machine.
            plane: "local",
          },
          {
            id: "conversation-steward",
            name: "WhatsApp Conversation Steward",
            capabilityId: "whatsapp.agent.conversation-steward",
            skillIds: [
              "whatsapp.tool.automation-rules",
              "whatsapp.tool.scheduled-actions",
              "whatsapp.tool.agent-assignment",
            ],
            plane: "local",
          },
        ],
        // Deliberately empty, and it stays empty: no BUILT-IN Automation may
        // run a WhatsApp read or send. Every extraction is a user-clicked Tool
        // run, and the v2 rules are authored by the owner one chat at a time
        // (`automation.ts`) rather than shipped with the Module.
        automations: [],
      },
    },
  },
  {
    computedRisk: "operational",
    manifest: {
      name: "task-manager",
      // 1.1.0: display name aligned to the owner-declared Module set.
      version: "1.1.0",
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
        displayName: "TaskManager",
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
          plane: "local" as const,
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
            ...(id === "ledger-drift-detector"
              ? { automationId: TASK_MANAGER_DRIFT_AUTOMATION_KEY }
              : id === "completed-bay-sweep"
                ? { automationId: TASK_MANAGER_SWEEP_AUTOMATION_KEY }
                : {}),
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

/**
 * Left-nav navigation target for a built-in Module (UI page-anatomy canon):
 * clicking a Module in the rail lands on its PRIMARY data Page — the first
 * Page's route, which renders the sibling-toggle buttons at the top — rather
 * than the manifest capability inventory at /module/:name. The inventory stays
 * reachable from each data Page's Intelligence Section ("Manage in Module
 * Detail") and 3-dots Control Panel.
 *
 * - `landing` is where the rail entry links.
 * - `base` is the longest shared path prefix across the Module's Page routes,
 *   used for the rail's active-highlight so every Page under the Module lights
 *   up its entry (e.g. /dealpilot/sources still highlights DealPilot).
 *
 * Returns `undefined` for Modules with no manifest `module` block (e.g. Skill
 * Modules) so callers fall back to the /module/:name Module Detail route.
 */
export function moduleNavTarget(
  moduleName: string,
): { landing: string; base: string } | undefined {
  const mod = BUILT_IN_MODULES.find(
    (candidate) => candidate.manifest.name === moduleName,
  )?.manifest.module;
  if (!mod) return undefined;
  const routes = mod.pages.map((page) => page.route).filter((route) => route.length > 0);
  if (routes.length === 0) return { landing: mod.route, base: mod.route };
  return { landing: routes[0]!, base: commonRoutePrefix(routes) };
}

/** The minimum a nav entry must expose for {@link buildModuleNavTree}. */
export type NavModuleLike = {
  moduleName: string;
  parentModule?: string | undefined;
};

/** One nav root plus the sub-modules that nest under it (ADR-178). */
export type ModuleNavNode<T extends NavModuleLike> = {
  module: T;
  children: T[];
};

/**
 * Group installed Modules into the one-level nav tree the left rail renders
 * (ADR-178, docs/wiki/ui-architecture.md rule 1.5).
 *
 * Every rule here exists to keep a Module VISIBLE. The failure this design
 * refuses is the one the bug ledger keeps producing (AP-082/AP-085): a surface
 * that quietly disappears because some reference did not resolve, leaving the
 * user to discover it. So:
 *
 *   - A parent that is not installed is not an error — the orphan renders at
 *     root. Uninstalling NetworkManager must not take WhatsApp off the nav.
 *   - A parent that is ITSELF a sub-module does not create a second level. The
 *     grandchild re-attaches to the root-most ancestor, so nesting is capped at
 *     one level by construction rather than by everyone remembering the rule.
 *   - A parent cycle terminates and both Modules render at root.
 *
 * Input order is preserved for roots and within each child list, so the caller
 * (not this function) owns ordering policy.
 */
export function buildModuleNavTree<T extends NavModuleLike>(
  modules: readonly T[],
): ModuleNavNode<T>[] {
  const byName = new Map<string, T>();
  for (const mod of modules) byName.set(mod.moduleName, mod);

  /** Walk up to the root-most ancestor; returns undefined for a nav root. */
  function rootAncestorOf(mod: T): T | undefined {
    let current: T | undefined = mod;
    let parent: T | undefined;
    const seen = new Set<string>([mod.moduleName]);
    while (current?.parentModule) {
      const next = byName.get(current.parentModule);
      // Parent not installed, or a cycle — stop and use the last real ancestor.
      if (!next || seen.has(next.moduleName)) break;
      seen.add(next.moduleName);
      parent = next;
      current = next;
    }
    return parent;
  }

  const nodes: ModuleNavNode<T>[] = [];
  const nodeByName = new Map<string, ModuleNavNode<T>>();
  const pending: { child: T; parentName: string }[] = [];

  for (const mod of modules) {
    const parent = rootAncestorOf(mod);
    if (!parent) {
      const node: ModuleNavNode<T> = { module: mod, children: [] };
      nodes.push(node);
      nodeByName.set(mod.moduleName, node);
      continue;
    }
    // Deferred: the parent may appear later in the input list.
    pending.push({ child: mod, parentName: parent.moduleName });
  }

  for (const { child, parentName } of pending) {
    const node = nodeByName.get(parentName);
    // rootAncestorOf found a parent, so it IS in the input — but if that parent
    // was itself filtered into nothing, refuse to drop the child.
    if (!node) {
      nodes.push({ module: child, children: [] });
      continue;
    }
    node.children.push(child);
  }

  return nodes;
}

/** Longest shared leading path-segment prefix across the given routes. */
function commonRoutePrefix(routes: string[]): string {
  const segmented = routes.map((route) => route.split("/").filter(Boolean));
  const [first, ...rest] = segmented;
  if (!first) return "/";
  let shared = first.length;
  for (const segments of rest) {
    let index = 0;
    while (index < shared && index < segments.length && segments[index] === first[index]) {
      index += 1;
    }
    shared = index;
  }
  return `/${first.slice(0, shared).join("/")}`;
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
  //
  // WhatsApp is excluded for the same class of reason: reading the owner's
  // private contact graph out of a third-party session it also renders is not
  // a generalized capability anyone else could safely install.
  ...BUILT_IN_MODULES.filter(
    (pkg) => pkg.manifest.name !== "relationship" && pkg.manifest.name !== "whatsapp",
  ).map((pkg) => ({
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
