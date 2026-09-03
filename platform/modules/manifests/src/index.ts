/**
 * Signed source definitions for built-in Modules. Module Detail reads the same
 * manifests the module store installs; no frontend inventory is hardcoded.
 */
import { TASK_PLAYBOOKS } from "@bridge/core";
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
/**
 * Chief of Staff's governed runtime identity (ADR-201).
 *
 * It had none until now, on a TASK-007-era reading of the glossary line "its
 * routing role is a product composition, not an architectural requirement" —
 * taken to mean CoS never acts as a pipeline actor. That reading was made when
 * nothing required CoS to act. ADR-107 then deliberately gave it ownership of
 * routing and dispatch, and this Module's manifest declares four Automations
 * under it. An Automation starts an Agent Run, and only an attributable Agent
 * may invoke a Skill — so an owner with no runtime identity owns nothing that
 * can run. The glossary sentence is about how chat routing is composed, not
 * about whether Chief of Staff can be an actor; the glossary's own first
 * clause calls it a "default coordinating Agent".
 */
export const CHIEF_OF_STAFF_AGENT_RUNTIME_ID = "b0000000-0000-4000-a000-0000000000d6";
export const TASK_MANAGER_DRIFT_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000f7";
export const TASK_MANAGER_SWEEP_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000f8";
export const TASK_MANAGER_DRIFT_AUTOMATION_KEY = "task-manager.ledger-drift-detector";
export const TASK_MANAGER_SWEEP_AUTOMATION_KEY = "task-manager.completed-bay-sweep";
/** TM3/TM4 runtime bindings. These three Automations were DECLARED in this
 * manifest from the start with no runtime id and no procedure behind them —
 * the same "declared, not built" gap the planning Skills had. */
export const TASK_MANAGER_SCAN_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000fa";
export const TASK_MANAGER_PLANNING_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000fc";
export const TASK_MANAGER_SCAN_AUTOMATION_KEY = "task-manager.proactive-scan-cadence";
/** ADR-201 — the two Chief of Staff cadence Automations, runnable now that CoS
 * has a runtime Agent identity. Both were declared from TM0 with no runtime id.
 * `standup-brief` reads the queue and synthesizes progress; `stale-task-review`
 * surfaces live work nobody has touched. Neither proposes a status change:
 * what a rotting Task needs is a judgement, so they report and stop. */
export const TASK_MANAGER_STANDUP_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000fd";
export const TASK_MANAGER_STALE_REVIEW_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000fe";
/** ADR-202 — the Governance guard and gate Automations. All four were declared
 * from TM0 with no runtime id: two evaluate the queue's standing invariants,
 * two apply the deterministic approval band (ADR-073 lineage — the kernel
 * decides, the Agent explains). */
export const TASK_MANAGER_WIP_BREACH_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000ff";
export const TASK_MANAGER_UNVERIFIED_DONE_AUTOMATION_ID = "b0000000-0000-4000-a000-000000000100";
export const TASK_MANAGER_RESCHEDULE_GATE_AUTOMATION_ID = "b0000000-0000-4000-a000-000000000101";
export const TASK_MANAGER_ROUTING_GATE_AUTOMATION_ID = "b0000000-0000-4000-a000-000000000102";
/** ADR-203 — the four Internal Strategist Automations. Three of them already
 * raised a governed proposal that halted for review, so the gap was never
 * governance: it was ATTRIBUTION. The proposal's actor was the Human who
 * happened to trigger it and its skill was the kernel passthrough, so the
 * analysis Internal Strategist supposedly performed had no Agent Run behind
 * it and no Skill invocation to point at. */
export const TASK_MANAGER_GOAL_REVIEW_AUTOMATION_ID = "b0000000-0000-4000-a000-000000000103";
export const TASK_MANAGER_IMPACT_FIT_AUTOMATION_ID = "b0000000-0000-4000-a000-000000000104";
export const TASK_MANAGER_RESTRUCTURE_AUTOMATION_ID = "b0000000-0000-4000-a000-000000000105";
export const TASK_MANAGER_REOPEN_AUTOMATION_ID = "b0000000-0000-4000-a000-000000000106";
/** ADR-204 — the last Chief of Staff Automation. Declared since TM0 and
 * blocked on the schema rather than on ownership: there were no dependency
 * edges to notice clearing. */
export const TASK_MANAGER_DEPENDENCY_AUTOMATION_ID = "b0000000-0000-4000-a000-000000000107";
/** ADR-207 — the LAST Automation this Module declared with no runtime id, and
 * the one every slice since ADR-196 correctly refused to bind on its own.
 * `routeTaskByRequiredSkill` has existed since TM0 and `taskManager.route`
 * exposed it as a QUERY: it answered "who is eligible" and nothing could act
 * on the answer, because no write path set `assignedAgentId` after creation.
 * The missing piece was a decision surface, so this Automation arrives with
 * one rather than being wired to a computation that decides nothing. */
export const TASK_MANAGER_ROUTING_AUTOMATION_ID = "b0000000-0000-4000-a000-000000000108";
export const TASK_MANAGER_ROUTING_AUTOMATION_KEY = "task-manager.agent-task-routing-on-assign";
export const TASK_MANAGER_DEPENDENCY_AUTOMATION_KEY = "task-manager.dependency-unblock-notifier";
export const TASK_MANAGER_GOAL_REVIEW_AUTOMATION_KEY = "task-manager.goal-review-cadence";
export const TASK_MANAGER_IMPACT_FIT_AUTOMATION_KEY = "task-manager.task-created-impact-analysis";
export const TASK_MANAGER_RESTRUCTURE_AUTOMATION_KEY = "task-manager.task-tree-restructure-proposal";
export const TASK_MANAGER_REOPEN_AUTOMATION_KEY = "task-manager.target-change-reopen-prompt";
export const TASK_MANAGER_WIP_BREACH_AUTOMATION_KEY = "task-manager.wip-breach-detector";
export const TASK_MANAGER_UNVERIFIED_DONE_AUTOMATION_KEY = "task-manager.unverified-done-challenger";
export const TASK_MANAGER_RESCHEDULE_GATE_AUTOMATION_KEY = "task-manager.reschedule-approval-gate";
export const TASK_MANAGER_ROUTING_GATE_AUTOMATION_KEY = "task-manager.routing-approval-gate";
export const TASK_MANAGER_STANDUP_AUTOMATION_KEY = "task-manager.standup-brief";
export const TASK_MANAGER_STALE_REVIEW_AUTOMATION_KEY = "task-manager.stale-task-review";
/** The user-triggered planning Automation. Unlike the other four this one is
 * NOT on a cadence and not fired by a Task Event: the authoring Skills answer
 * a question a Human asked ("decompose this", "write me an exit test"), so its
 * trigger is a person, and the Automation exists to give that invocation an
 * attributable Agent Run and a proposal that halts for review. */
export const TASK_MANAGER_PLANNING_AUTOMATION_KEY = "task-manager.planning-playbook";
export const LEARNING_RECOMMENDATION_SKILL_ID = "stageLearningRecommendation";
export const CITED_ROLE_MODEL_PRACTICE_VERSION = "1.0.1";
/** DevPilot D0/D1 (TASK-067/TASK-068, ADR-235) — continuing the runtime-id
 * sequence after Task Manager's routing Automation (…000108). */
export const DEVPILOT_TRACKER_AGENT_ID = "b0000000-0000-4000-a000-000000000109";
export const DEVPILOT_GITHUB_POLL_AUTOMATION_ID = "b0000000-0000-4000-a000-00000000010a";
export const DEVPILOT_GITHUB_POLL_AUTOMATION_KEY = "devpilot.github-poll";
/** DevPilot D2 (TASK-071, ADR-237) — engineering-assist Skills that call a
 * model over quarantined GitHub content. A separate Agent identity from the
 * tracker (…109): the tracker's authority is `external:fetch:read` alone,
 * the reviewer additionally needs model-calling + `record:write` to draft a
 * proposal, and least-privilege keeps those scopes on separate identities
 * rather than widening the tracker's. Continuing the id sequence after the
 * tracker poll Automation (…10a). */
export const DEVPILOT_REVIEWER_AGENT_ID = "b0000000-0000-4000-a000-00000000010b";
export const DEVPILOT_REVIEW_PR_AUTOMATION_ID = "b0000000-0000-4000-a000-00000000010c";
export const DEVPILOT_REVIEW_PR_AUTOMATION_KEY = "devpilot.review-pr";
export const DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_ID = "b0000000-0000-4000-a000-00000000010d";
export const DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_KEY = "devpilot.suggest-practice";
export const DEVPILOT_ANALYZE_ISSUE_AUTOMATION_ID = "b0000000-0000-4000-a000-00000000010e";
export const DEVPILOT_ANALYZE_ISSUE_AUTOMATION_KEY = "devpilot.analyze-issue";
/** JobPilot source sweep (ADR-266). The Application tracking Agent gains a
 * runtime identity here for the first time: without one the generic Module
 * Automation materializer in wiring.ts skips the Automation entirely, and a
 * declared schedule that silently never fires is the exact defect ADR-179
 * built the scheduler to end. Continuing the id sequence after DevPilot. */
export const JOBPILOT_APPLICATION_AGENT_ID = "b0000000-0000-4000-a000-00000000010f";
export const JOBPILOT_SOURCE_SWEEP_AUTOMATION_ID = "b0000000-0000-4000-a000-000000000110";
export const JOBPILOT_SOURCE_SWEEP_AUTOMATION_KEY = "job-pilot.source-sweep";

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
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_SCAN_AUTOMATION_KEY) {
    return TASK_MANAGER_SCAN_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_PLANNING_AUTOMATION_KEY) {
    return TASK_MANAGER_PLANNING_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_STANDUP_AUTOMATION_KEY) {
    return TASK_MANAGER_STANDUP_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_STALE_REVIEW_AUTOMATION_KEY) {
    return TASK_MANAGER_STALE_REVIEW_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_WIP_BREACH_AUTOMATION_KEY) {
    return TASK_MANAGER_WIP_BREACH_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_UNVERIFIED_DONE_AUTOMATION_KEY) {
    return TASK_MANAGER_UNVERIFIED_DONE_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_RESCHEDULE_GATE_AUTOMATION_KEY) {
    return TASK_MANAGER_RESCHEDULE_GATE_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_ROUTING_GATE_AUTOMATION_KEY) {
    return TASK_MANAGER_ROUTING_GATE_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_GOAL_REVIEW_AUTOMATION_KEY) {
    return TASK_MANAGER_GOAL_REVIEW_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_IMPACT_FIT_AUTOMATION_KEY) {
    return TASK_MANAGER_IMPACT_FIT_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_RESTRUCTURE_AUTOMATION_KEY) {
    return TASK_MANAGER_RESTRUCTURE_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_REOPEN_AUTOMATION_KEY) {
    return TASK_MANAGER_REOPEN_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_DEPENDENCY_AUTOMATION_KEY) {
    return TASK_MANAGER_DEPENDENCY_AUTOMATION_ID;
  }
  if (moduleName === "task-manager" && manifestAutomationId === TASK_MANAGER_ROUTING_AUTOMATION_KEY) {
    return TASK_MANAGER_ROUTING_AUTOMATION_ID;
  }
  if (moduleName === "devpilot" && manifestAutomationId === DEVPILOT_GITHUB_POLL_AUTOMATION_KEY) {
    return DEVPILOT_GITHUB_POLL_AUTOMATION_ID;
  }
  if (moduleName === "devpilot" && manifestAutomationId === DEVPILOT_REVIEW_PR_AUTOMATION_KEY) {
    return DEVPILOT_REVIEW_PR_AUTOMATION_ID;
  }
  if (moduleName === "devpilot" && manifestAutomationId === DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_KEY) {
    return DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_ID;
  }
  if (moduleName === "job-pilot" && manifestAutomationId === JOBPILOT_SOURCE_SWEEP_AUTOMATION_KEY) {
    return JOBPILOT_SOURCE_SWEEP_AUTOMATION_ID;
  }
  if (moduleName === "devpilot" && manifestAutomationId === DEVPILOT_ANALYZE_ISSUE_AUTOMATION_KEY) {
    return DEVPILOT_ANALYZE_ISSUE_AUTOMATION_ID;
  }
  return undefined;
}

export function isModuleRuntimeAutomationId(automationId: string): boolean {
  return [
    DEALPILOT_SOURCE_AUTOMATION_ID,
    TASK_MANAGER_DRIFT_AUTOMATION_ID,
    TASK_MANAGER_SWEEP_AUTOMATION_ID,
    TASK_MANAGER_SCAN_AUTOMATION_ID,
    TASK_MANAGER_PLANNING_AUTOMATION_ID,
    TASK_MANAGER_STANDUP_AUTOMATION_ID,
    TASK_MANAGER_STALE_REVIEW_AUTOMATION_ID,
    TASK_MANAGER_WIP_BREACH_AUTOMATION_ID,
    TASK_MANAGER_UNVERIFIED_DONE_AUTOMATION_ID,
    TASK_MANAGER_RESCHEDULE_GATE_AUTOMATION_ID,
    TASK_MANAGER_ROUTING_GATE_AUTOMATION_ID,
    TASK_MANAGER_GOAL_REVIEW_AUTOMATION_ID,
    TASK_MANAGER_IMPACT_FIT_AUTOMATION_ID,
    TASK_MANAGER_RESTRUCTURE_AUTOMATION_ID,
    TASK_MANAGER_REOPEN_AUTOMATION_ID,
    TASK_MANAGER_DEPENDENCY_AUTOMATION_ID,
    TASK_MANAGER_ROUTING_AUTOMATION_ID,
    DEVPILOT_GITHUB_POLL_AUTOMATION_ID,
    DEVPILOT_REVIEW_PR_AUTOMATION_ID,
    DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_ID,
    DEVPILOT_ANALYZE_ISSUE_AUTOMATION_ID,
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
  if (moduleName === "task-manager" && manifestAgentId === "chief-of-staff") {
    return CHIEF_OF_STAFF_AGENT_RUNTIME_ID;
  }
  if (moduleName === "devpilot" && manifestAgentId === "tracker-agent") {
    return DEVPILOT_TRACKER_AGENT_ID;
  }
  if (moduleName === "devpilot" && manifestAgentId === "reviewer-agent") {
    return DEVPILOT_REVIEWER_AGENT_ID;
  }
  if (moduleName === "job-pilot" && manifestAgentId === "application-agent") {
    return JOBPILOT_APPLICATION_AGENT_ID;
  }
  return undefined;
}

const SOURCE_REPOSITORY = "https://github.com/badami-vikas/relationship-os";
const INSPECTED_COMMIT = "689fca0ca742cfa01eae8e3785b00c50c5e3ca5b";
const BUILT_IN_SOURCE_REFS: Readonly<Record<string, string>> = {
  "deal-pilot": "platform/modules/dealpilot/src/manifest.ts",
  "job-pilot": "platform/modules/jobpilot/src/manifest.ts",
  relationship: "platform/apps/web/src/app/pages/RelationshipPage.tsx",
  academics: "platform/apps/web/src/app/pages/AcademicsPage.tsx",
  events: "platform/apps/web/src/app/pages/EventsPage.tsx",
  "task-manager": "platform/packages/core/src/task-manager.ts",
  whatsapp: "platform/modules/whatsapp/src/index.ts",
  devpilot: "platform/modules/devpilot/src/index.ts",
  // Imported Modules (ADR-246). The source ref points at the domain layer that
  // came across in the subtree merge, not at the donor repository: the donors
  // are read-only sources and are not modified by the merge, so this repo is
  // where the inspected code actually lives.
  accounting: "platform/modules/accounting/src/index.ts",
  d2c: "platform/modules/d2c/src/index.ts",
  "d2c-research": "platform/modules/d2c/src/index.ts",
  "d2c-notes": "platform/modules/d2c/src/index.ts",
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
  // The sweep is the ONLY JobPilot capability that leaves the machine, so it
  // gets its own capability id rather than widening the tracking Automation's
  // record-only authority. `readPublic("external:fetch")` — public ATS board
  // JSON, no credentials, nothing personal sent outbound.
  capability(
    "job-pilot.source-sweep",
    "Job source sweep",
    "automation",
    [readPublic("external:fetch"), writeAll("record")],
    [],
    [
      { manifestId: "job-pilot.application-agent", versionRange: "0.2.0" },
      { manifestId: "job-pilot.score-fit", versionRange: "0.2.0" },
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
  capability("relationship.page.signals", "Signals", "database", [
    readPrivate("signal"),
    writePrivate("signal"),
    readPrivate("person"),
    readPrivate("community"),
  ]),
  capability("relationship.page.people", "People", "database", [
    readPrivate("person"),
    writePrivate("person"),
  ]),
  capability("relationship.page.communities", "Communities", "database", [
    readPrivate("community"),
    writePrivate("community"),
  ]),
  capability("relationship.submodule.relations", "Relations", "database", [
    readPrivate("relation"),
    writePrivate("relation"),
  ]),
  capability("relationship.submodule.interactions", "Interactions", "database", [
    readPrivate("event"),
    writePrivate("event"),
  ]),
  capability("relationship.submodule.introductions", "Introductions", "database", [
    readPrivate("event"),
    writePrivate("event"),
  ]),
  capability("relationship.submodule.helpdesk", "Helpdesk", "database", [
    readPrivate("record"),
    writePrivate("record"),
    readPrivate("event"),
    writePrivate("event"),
  ]),
  capability("relationship.submodule.sources", "Sources", "database", [
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
/**
 * Academics Module capabilities (TASK-067, ADR-231). Three private
 * database Pages over the owner's own coursework Records — no egress. The
 * Study Steward Agent is declared with no `skillIds` yet: lecture-synthesis,
 * syllabus-intake, recall-scheduler, reference-resolve, and workload-forecast
 * are later phases of this same Task, not a separate Module version.
 */
const academicsCapabilities = [
  capability("academics.page.subjects", "Subjects", "database", [readPrivate("record"), writePrivate("record")]),
  capability("academics.page.lecture-sessions", "Lecture Sessions", "database", [
    readPrivate("record"),
    writePrivate("record"),
  ]),
  capability("academics.page.assignments", "Assignments", "database", [
    readPrivate("record"),
    writePrivate("record"),
  ]),
  capability("academics.agent.study-steward", "Study Steward", "agent", [
    readPrivate("record"),
    writePrivate("record"),
  ]),
];

/**
 * Events sub-module capabilities (TASK-068, ADR-231). Nested under
 * NetworkManager for nav only (ADR-178) — nesting grants nothing, so this
 * Module declares its own `person` permissions rather than relying on the
 * parent's. Speaker extraction and the LinkedIn outreach-note drafting Skill
 * are later phases of this same Task; there is no automated LinkedIn SEND
 * capability declared here or anywhere else, deliberately — see ADR-231.
 */
const eventsCapabilities = [
  capability("events.page.events", "Events", "database", [
    readPrivate("record"),
    writePrivate("record"),
    readPrivate("person"),
    writePrivate("person"),
  ]),
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
  capability("whatsapp.page.chats", "Chats", "database", [readPrivate("event")]),
  capability("whatsapp.page.tools", "Tools", "database", [readPrivate("record")]),
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
  // ADR-202 — two Governance capabilities that existed as core code with no
  // Skill id. `queue-guard` evaluates the queue's standing invariants
  // (`evaluateTaskGuards`, reachable only as read-only query data until now);
  // `change-gate` classifies one proposed reschedule or routing change into
  // an approval band and applies the calibrated decision. Separate Skills
  // because they answer separate questions — the state of the queue versus
  // whether one specific change may proceed without a Human.
  ["queue-guard", "Governance Agent"],
  ["change-gate", "Governance Agent"],
  // ADR-204 — the dependency graph. Chief of Staff's, because "what is
  // blocking what, and what just became startable" is a coordination
  // question; Internal Strategist keeps placement and Governance keeps
  // control. It reads the queue and the edges and writes nothing.
  ["dependency-analysis", "Chief of Staff"],
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
  // Human-triggered rather than scheduled or Event-fired: the planning
  // Playbooks answer a question someone asked. It is an Automation so that
  // invocation gets an attributable Agent Run and a proposal that halts for
  // review, not because anything about it runs on its own.
  ["planning-playbook", "Internal Strategist"],
] as const;

// DevPilot D0/D1 (TASK-067/TASK-068, ADR-235) — a freelance engineer's
// tracked repos, pull requests, and issues, synced from GitHub through a
// fine-grained Personal Access Token. Read-only: no external:send capability
// in D1 (D2's PR-review drafts stay local; posting is a later, separately
// approval-gated capability).
const devpilotCapabilities = [
  capability("devpilot.repos", "Repos database and views", "database", [readAll("record"), writeAll("record")]),
  capability("devpilot.pulls", "Pull Requests database and views", "database", [readAll("record"), writeAll("record")]),
  capability("devpilot.issues", "Issues database and views", "database", [readAll("record"), writeAll("record")]),
  capability(
    "devpilot.syncGithub",
    "Sync GitHub repos, pull requests, and issues",
    "skill",
    [{ resourceType: "external:fetch", action: "read", dataScope: "public", egress: true }],
    [{ id: "github" }],
  ),
  capability(
    "devpilot.tracker-agent",
    "Dev tracker Agent",
    "agent",
    [readAll("record"), writeAll("record")],
    [],
    [{ manifestId: "devpilot.syncGithub", versionRange: "0.2.0" }],
  ),
  capability(
    "devpilot.github-poll",
    "GitHub tracker poll",
    "automation",
    [readPublic("external:fetch"), writeAll("record")],
    [{ id: "github" }],
    [
      { manifestId: "devpilot.tracker-agent", versionRange: "0.2.0" },
      { manifestId: "devpilot.syncGithub", versionRange: "0.2.0" },
    ],
  ),
  capability("devpilot.github", "GitHub tracker intake", "integration", [readAll("external:fetch")], [{ id: "github" }]),
  // DevPilot D2 (TASK-071, ADR-237) — draft-only engineering-assist Skills.
  // Each reads quarantined PR/Issue content (untrusted_external, GitHub's
  // own private-repo dataScope) and writes a governed proposal a Human must
  // approve; none may send or write back to GitHub — no external:send here,
  // same posture D1 declared for the tracker.
  capability(
    "devpilot.reviewPr",
    "Draft a code review from a Pull Request's diff",
    "skill",
    [{ resourceType: "external:fetch", action: "read", dataScope: "private", egress: true }, readAll("record"), writeAll("record")],
    [{ id: "github" }],
  ),
  capability(
    "devpilot.suggestPractice",
    "Draft best-practice suggestions from a Pull Request's diff",
    "skill",
    [{ resourceType: "external:fetch", action: "read", dataScope: "private", egress: true }, readAll("record"), writeAll("record")],
    [{ id: "github" }],
  ),
  capability(
    "devpilot.analyzeIssue",
    "Draft a triage analysis from an Issue's body",
    "skill",
    [{ resourceType: "external:fetch", action: "read", dataScope: "private", egress: true }, readAll("record"), writeAll("record")],
    [{ id: "github" }],
  ),
  capability(
    "devpilot.reviewer-agent",
    "Dev reviewer Agent",
    "agent",
    [readAll("record"), writeAll("record")],
    [],
    [
      { manifestId: "devpilot.reviewPr", versionRange: "0.2.0" },
      { manifestId: "devpilot.suggestPractice", versionRange: "0.2.0" },
      { manifestId: "devpilot.analyzeIssue", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "devpilot.review-pr-automation",
    "Draft PR review (manual)",
    "automation",
    [readPrivate("external:fetch"), readAll("record"), writeAll("record")],
    [{ id: "github" }],
    [
      { manifestId: "devpilot.reviewer-agent", versionRange: "0.2.0" },
      { manifestId: "devpilot.reviewPr", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "devpilot.suggest-practice-automation",
    "Draft best-practice suggestions (manual)",
    "automation",
    [readPrivate("external:fetch"), readAll("record"), writeAll("record")],
    [{ id: "github" }],
    [
      { manifestId: "devpilot.reviewer-agent", versionRange: "0.2.0" },
      { manifestId: "devpilot.suggestPractice", versionRange: "0.2.0" },
    ],
  ),
  capability(
    "devpilot.analyze-issue-automation",
    "Draft issue analysis (manual)",
    "automation",
    [readPrivate("external:fetch"), readAll("record"), writeAll("record")],
    [{ id: "github" }],
    [
      { manifestId: "devpilot.reviewer-agent", versionRange: "0.2.0" },
      { manifestId: "devpilot.analyzeIssue", versionRange: "0.2.0" },
    ],
  ),
];

const taskManagerCapabilities = [
  capability("task-manager.tasks", "Tasks Database and Views", "database", [readAll("record"), writeAll("record")]),
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
        }, {
          // Source toggle page (ADR-266) — mirrors DealPilot's /dealpilot/sources
          // rather than inventing a second shape for the same job. Binds the same
          // Database as the Jobs page: sources have no Database of their own,
          // because the catalog is code and only toggle STATE is persisted.
          id: "sources",
          name: "Sources",
          route: "/jobpilot/sources",
          databaseId: "jobpilot.jobs",
          capabilityId: "job-pilot.jobs",
        }],
        agents: [{
          id: "application-agent",
          name: "Application tracking Agent",
          capabilityId: "job-pilot.application-agent",
          skillIds: ["job-pilot.score-fit", "job-pilot.transition-application"],
          // Local: the sweep reads public board JSON and writes Job records on
          // this machine. Nothing personal leaves the Local Plane.
          plane: "local",
        }],
        automations: [{
          id: "track-application",
          name: "Job tracking intake",
          capabilityId: "job-pilot.track-application",
          agentId: "application-agent",
          trigger: "Job saved",
          procedure: "jobpilot.create",
        }, {
          // The "regularly fetches" half. Declared with a runRoute so the manual
          // and scheduled paths are the same Automation, as DealPilot's source
          // intake established — a manual refresh must not be a second code path
          // that can drift from what the schedule actually does.
          id: "source-sweep",
          name: "Job source sweep",
          capabilityId: "job-pilot.source-sweep",
          agentId: "application-agent",
          trigger: "Scheduled",
          // The cadence is DATA the scheduler reads (ADR-179) — the English
          // `trigger` above is display text and starts nothing on its own.
          schedule: { kind: "schedule", everyMinutes: 360 },
          procedure: "jobpilot.sources.run",
          automationId: JOBPILOT_SOURCE_SWEEP_AUTOMATION_KEY,
          runRoute: "/jobpilot/sources",
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
      // 0.2.4 added the Learning Agent's `runRoute` (ADR-180). 0.3.0 (a
      // parallel workstream) renamed the display name to "NetworkManager"
      // and made this Module a nav PARENT (WhatsApp declares it, ADR-178).
      // 0.3.1 is the union of both — Module content is IMMUTABLE at a given
      // version, so a manifest carrying both changes needs a version past
      // either parent, not a pick between them.
      version: "0.3.1",
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
            // The Research Run surface (TASK-028) belongs to the Agent that
            // consumes the `web-research` Skill — not to a top-level nav entry
            // of its own (ADR-180).
            runRoute: "/research",
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
    // Internal: Helpdesk reads and writes the owner's own private Records and
    // Events through NetworkManager's already-declared capability. It reaches
    // nothing external, which is why it is not "external" like WhatsApp.
    computedRisk: "operational",
    manifest: {
      name: "helpdesk",
      // 0.1.0: first shipped manifest. The Helpdesk PAGE and its route already
      // existed (`RelationshipHelpdeskPage`, `/module/relationship/helpdesk`)
      // and the `relationship.submodule.helpdesk` capability was already
      // declared — what was missing was a Module row, which is what the nav
      // tree is built from, so the Page was reachable by URL but invisible in
      // the left rail.
      version: "0.1.0",
      kind: "organization_definition",
      summary: "Help items for the people and communities NetworkManager already tracks.",
      description:
        "A nested sub-module of NetworkManager. Help items are Records and their activity is Events, both on the same private contracts the parent Module uses — Helpdesk adds a surface over that data rather than a second store beside it.",
      lineageManifestId: null,
      dependencies: [],
      // Every module needs >=1 declared capability (manifest.js's non-empty-
      // array rule — the seed step rejects an empty array outright, which is
      // what a stale build of this manifest failed on 2026-08-10). This is the
      // SAME id NetworkManager already declares (`relationship.submodule.
      // helpdesk`, above) with the identical permission set, not a second
      // grant: the data and the plane are identical, so restating the same
      // capability under Helpdesk's own module row is descriptive (what this
      // Module's inventory shows) rather than a new authority boundary.
      capabilities: [
        capability("relationship.submodule.helpdesk", "Helpdesk", "database", [
          readPrivate("record"),
          writePrivate("record"),
          readPrivate("event"),
          writePrivate("event"),
        ]),
      ],
      contextProviders: [],
      organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: "Helpdesk",
        // Nesting is nav only (ADR-178), exactly as WhatsApp's is: governance,
        // plane and capability resolution are unchanged by the parent.
        parentModule: "relationship",
        route: "/module/relationship/helpdesk",
        pages: [
          {
            id: "helpdesk",
            name: "Helpdesk",
            route: "/module/relationship/helpdesk",
            databaseId: "relationship.helpdesk",
            capabilityId: "relationship.submodule.helpdesk",
          },
        ],
        agents: [],
        automations: [],
      },
    },
  },
  {
    // Internal: personal coursework vault. No egress, no third-party session.
    computedRisk: "operational",
    manifest: {
      name: "academics",
      version: "0.1.0",
      kind: "organization_definition",
      summary: "Subjects, Lecture Sessions, and Assignments — the owner's coursework vault.",
      description:
        "Three sibling toggles over the owner's own coursework Records: Subjects, Lecture Sessions, Assignments. A Subject's Record Detail carries its own Sessions and Assignments as related Sections (ui-architecture-rules — toggles stay one level; nesting is a sub-module concern, not this Module's). Local Files land under `~/Documents/Bridge/<Organization>/Academics/`.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: academicsCapabilities,
      contextProviders: [{ kind: "capture", required: false }],
      organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: "Academics",
        // Bare parent route — three Pages share this prefix, same convention
        // as NetworkManager's own multi-Page `route: "/module/relationship"`
        // (a single-Page sub-module like Helpdesk uses its own Page route).
        route: "/module/academics",
        pages: [
          {
            id: "subjects",
            name: "Subjects",
            route: "/module/academics/subjects",
            databaseId: "academics.subjects",
            capabilityId: "academics.page.subjects",
          },
          {
            id: "sessions",
            name: "Lecture Sessions",
            route: "/module/academics/sessions",
            databaseId: "academics.lecture-sessions",
            capabilityId: "academics.page.lecture-sessions",
          },
          {
            id: "assignments",
            name: "Assignments",
            route: "/module/academics/assignments",
            databaseId: "academics.assignments",
            capabilityId: "academics.page.assignments",
          },
        ],
        agents: [
          {
            id: "study-steward",
            name: "Study Steward",
            capabilityId: "academics.agent.study-steward",
            skillIds: [],
            // Raw lecture capture (recording/transcript) stays Local by
            // principle — the same reasoning WhatsApp's Agents carry.
            plane: "local",
          },
        ],
        automations: [],
      },
    },
  },
  {
    // Internal: reads and writes NetworkManager's own private People through a
    // capability this Module declares itself — nesting grants nothing (ADR-178).
    computedRisk: "operational",
    manifest: {
      name: "events",
      version: "0.1.0",
      kind: "organization_definition",
      summary: "Conference and event links, with speakers resolved into NetworkManager's People.",
      description:
        "A nested sub-module of NetworkManager for conference/event links. There is deliberately no separate Speakers table — the extraction pipeline (TASK-068, later phase) resolves speakers into the Module's existing People database under the same three-tier match gate NetworkManager already uses, and drafts an outreach note for a human to send manually. No automated LinkedIn send capability is declared here or anywhere in this codebase (ADR-231).",
      lineageManifestId: null,
      dependencies: [],
      capabilities: eventsCapabilities,
      contextProviders: [{ kind: "capture", required: false }],
      organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: "Events",
        parentModule: "relationship",
        route: "/module/relationship/events",
        pages: [
          {
            id: "events",
            name: "Events",
            route: "/module/relationship/events",
            databaseId: "events.events",
            capabilityId: "events.page.events",
          },
        ],
        agents: [],
        automations: [],
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
      // 1.2.0: TM3/TM4 runtime bindings — `proactive-scan-cadence` and the new
      // `planning-playbook` gain real runtime Automation ids and procedures
      // (they were declared with neither). This line previously also named
      // `standup-brief`, which was wrong: ADR-198 deliberately left it
      // unbound because Chief of Staff had no runtime Agent identity.
      // 1.3.0: ADR-201 gives Chief of Staff that identity, and `standup-brief`
      // and `stale-task-review` gain runtime ids and a procedure.
      // 1.4.0: ADR-202 adds two Governance Skills (`queue-guard`,
      // `change-gate`) that existed as core code with no Skill id, and binds
      // the four Governance guard/gate Automations to them.
      // 1.5.0: ADR-203 binds the four Internal Strategist Automations. Three
      // already halted for review — the gap was attribution, not governance.
      // 1.6.0: ADR-204 adds Task dependency Relations (migration 0039), the
      // `dependency-analysis` Skill, and binds `dependency-unblock-notifier`.
      // 1.7.0: ADR-205 derives each Automation's `automationId` from the one
      // resolver that owns runtime ids. The ternary chain it replaces named
      // four Automations and had been stale since ADR-201, so nine manifest
      // entries were claiming no runtime Automation stood behind them.
      // 1.8.0: ADR-206 (TM6) declares the five Playbooks the Module ships and
      // gives its Commons entry real discovery tags.
      // 1.9.0: ADR-207 binds `agent-task-routing-on-assign`, the last declared
      // Automation with no runtime id — and the routing DECISION surface that
      // is why it stayed unbound: `route` becomes a stageable proposal kind,
      // so an eligible-Agent answer can now be accepted.
      version: "1.9.0",
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
        // TM6 (ADR-206) — the Playbooks the Module ships, declared so a fresh
        // Commons install can be audited against what it actually received.
        // Derived from `TASK_PLAYBOOKS` rather than restated, for the same
        // reason `TASK_MANAGER_PLAYBOOKS` is (ADR-197): a hand-listed roster
        // drifts from its content the moment either side changes.
        //
        // NOT capability entries. ADR-180's rule is that a capability is the
        // thing that is GOVERNED — permissions and a trust lifecycle — which
        // is why `view` stopped being one. A Playbook holds no permissions;
        // the Skills it names hold them all, and giving a Playbook permissions
        // would create a second place authority could widen unnoticed.
        playbooks: TASK_PLAYBOOKS.map((playbook) => ({
          id: playbook.id,
          methodology: playbook.methodology,
          version: playbook.version,
          intent: playbook.intent,
          skillCapabilityIds: playbook.skills.map((skillId) => `task-manager.skill.${skillId}`),
        })),
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
            trigger: id === "planning-playbook"
              ? "Human request"
              : id.includes("cadence") || id.includes("brief")
                ? "Scheduled"
                : "Task Event",
            procedure: `task-manager.${id}`,
            // Derived from the ONE resolver that owns runtime ids rather than
            // restated as a ternary chain. The chain it replaces listed four
            // Automations and was already stale by ADR-201: every binding
            // added since would have shipped a manifest entry claiming no
            // runtime Automation existed behind it.
            ...(resolveModuleAutomationRuntimeId("task-manager", `task-manager.${id}`)
              ? { automationId: `task-manager.${id}` }
              : {}),
          };
        }),
      },
    },
  },
  {
    // External: the sync Skill reaches the internet (GitHub REST API) with
    // egress, same computedRisk tier as DealPilot's sourcing.
    computedRisk: "external",
    manifest: {
      name: "devpilot",
      version: "0.2.0",
      kind: "organization_definition",
      summary: "Organizes a freelance engineer's code, issues, and work priorities.",
      description:
        "Tracks GitHub repos, pull requests, and issues in DevPilot-owned Databases, refreshed by a scheduled poll behind a fine-grained Personal Access Token. Drafts PR reviews, best-practice suggestions, and Issue triage on request — always a proposal a Human approves, never posted back to GitHub. No capability may send to GitHub in this version.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: devpilotCapabilities,
      contextProviders: [],
      organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: "DevPilot",
        route: "/module/devpilot/pulls",
        pages: [
          {
            id: "pulls",
            name: "Pull Requests",
            route: "/module/devpilot/pulls",
            databaseId: "devpilot.pulls",
            capabilityId: "devpilot.pulls",
          },
          {
            id: "issues",
            name: "Issues",
            route: "/module/devpilot/issues",
            databaseId: "devpilot.issues",
            capabilityId: "devpilot.issues",
          },
          {
            id: "repos",
            name: "Repos",
            route: "/module/devpilot/repos",
            databaseId: "devpilot.repos",
            capabilityId: "devpilot.repos",
          },
        ],
        agents: [
          {
            id: "tracker-agent",
            name: "Dev tracker Agent",
            capabilityId: "devpilot.tracker-agent",
            skillIds: ["devpilot.syncGithub"],
            plane: "cloud",
          },
          {
            id: "reviewer-agent",
            name: "Dev reviewer Agent",
            capabilityId: "devpilot.reviewer-agent",
            skillIds: ["devpilot.reviewPr", "devpilot.suggestPractice", "devpilot.analyzeIssue"],
            plane: "cloud",
          },
        ],
        automations: [
          {
            id: "github-poll",
            name: "GitHub tracker poll",
            capabilityId: "devpilot.github-poll",
            agentId: "tracker-agent",
            trigger: "Scheduled",
            schedule: { kind: "schedule", everyMinutes: 15 },
            procedure: "devpilot.syncGithub",
            automationId: DEVPILOT_GITHUB_POLL_AUTOMATION_KEY,
            runRoute: "/module/devpilot/pulls",
          },
          {
            id: "review-pr",
            name: "Draft PR review",
            capabilityId: "devpilot.review-pr-automation",
            agentId: "reviewer-agent",
            // Human-triggered rather than scheduled or Event-fired, same
            // reasoning as Task Manager's planning-playbook Automation: this
            // answers a question someone asked ("review this PR"), so no
            // `schedule` — an Automation still gives the invocation an
            // attributable Agent Run and a proposal that halts for review.
            trigger: "Manual — 'Draft review' on a tracked Pull Request",
            procedure: "devpilot.reviewPr",
            automationId: DEVPILOT_REVIEW_PR_AUTOMATION_KEY,
            runRoute: "/module/devpilot/pulls",
          },
          {
            id: "suggest-practice",
            name: "Draft best-practice suggestions",
            capabilityId: "devpilot.suggest-practice-automation",
            agentId: "reviewer-agent",
            trigger: "Manual — 'Suggest practices' on a tracked Pull Request",
            procedure: "devpilot.suggestPractice",
            automationId: DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_KEY,
            runRoute: "/module/devpilot/pulls",
          },
          {
            id: "analyze-issue",
            name: "Draft issue analysis",
            capabilityId: "devpilot.analyze-issue-automation",
            agentId: "reviewer-agent",
            trigger: "Manual — 'Analyze' on a tracked Issue",
            procedure: "devpilot.analyzeIssue",
            automationId: DEVPILOT_ANALYZE_ISSUE_AUTOMATION_KEY,
            runRoute: "/module/devpilot/issues",
          },
        ],
      },
    },
  },
  {
    // Internal: the advisor's own imported books. Nothing egresses — the
    // Module opens its own sqlite inside the dataDir the host grants it
    // (ADR-246) and never reaches @bridge/db or the PGlite Local Plane.
    computedRisk: "operational",
    manifest: {
      name: "accounting",
      // 0.1.0 as a Bridge Module; the imported domain layer carries Avilo's
      // own 1.10.1 in its package version, and its 35 commits of history are
      // reachable through the subtree merge.
      version: "0.1.0",
      kind: "organization_definition",
      summary: "QuickBooks exports become a month-end report, a dashboard, and a PDF.",
      description:
        "Imported from Avilo Advisory (ADR-246). Facts are keyed by (client, period, account) so any range is a WHERE clause; row labels resolve through persisted, user-correctable mappings; metrics are versioned formulas evaluated at runtime; corrections are overrides with full history. Every figure on screen traces to an imported fact, a stored override, or a formula — 'unknown' is a first-class result (ADR-247).",
      lineageManifestId: null,
      dependencies: [],
      capabilities: [
        capability("accounting.books", "Imported books and periods", "database", [
          readPrivate("record"),
          writePrivate("record"),
        ]),
        capability("accounting.reports", "Month-end reports and formulas", "database", [
          readPrivate("record"),
          writePrivate("record"),
        ]),
      ],
      contextProviders: [],
      organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      // Avilo's AI posture, moved out of prose and into declared data (ADR-248).
      // It was correct for a year and enforced by nothing: BUG-029…BUG-045 are
      // all the assistant claiming work it had not done under exactly these
      // rules, and ADR-045 records prompt text failing twice on the same defect.
      // The user can edit these in the Governance Section; deny always wins.
      governance: {
        allow: [
          {
            action: "model.call.requested",
            reason: "Suggest, Generate, the Assistant panel and Test connection each run on an explicit button press.",
          },
          {
            action: "books.read",
            reason: "The Assistant sees the open client's imported periods and accounts, read-only, from the same queries the report view runs.",
          },
        ],
        deny: [
          {
            action: "model.call.unattended",
            reason: "No model call without an explicit user action — nothing calls out on upload, render, navigation or a timer. The app works fully with no model configured.",
          },
          {
            action: "books.write.model",
            reason: "A model may choose, never invent. It reads facts; it cannot write one. A hallucinated id degrades to skip.",
          },
          {
            action: "external.agent.books",
            reason: "An external agent reaches configuration, never the books — enforced by the module import graph, not by this rule alone.",
          },
        ],
      },
      module: {
        displayName: "Accounting",
        route: "/module/accounting",
        pages: [
          {
            id: "clients",
            name: "Clients",
            route: "/module/accounting/clients",
            databaseId: "accounting.books",
            capabilityId: "accounting.books",
          },
          {
            id: "reports",
            name: "Reports",
            route: "/module/accounting/reports",
            databaseId: "accounting.reports",
            capabilityId: "accounting.reports",
          },
        ],
        agents: [],
        automations: [],
      },
    },
  },
  {
    // Internal: the owner's own D2C business records. The WhatsApp boundary is
    // NOT declared here — it is served by the existing @bridge/whatsapp Module,
    // whose clone in CV Naturals was byte-identical and therefore not imported.
    computedRisk: "operational",
    manifest: {
      name: "d2c",
      version: "0.1.0",
      kind: "organization_definition",
      summary: "Orders, inventory and research for a direct-to-consumer herbal business.",
      description:
        "Imported from CV Naturals (ADR-246). The parent Module for four sub-modules — Orders, Inventory, Research and Notes — over one domain layer covering order lifecycle, GST invoice numbering, product-to-source mapping, formula costing and the stock ledger. Opens its own sqlite in the host-granted dataDir; never touches the PGlite Local Plane.",
      lineageManifestId: null,
      dependencies: [],
      capabilities: [
        capability("d2c.commerce", "Orders, invoices and stock", "database", [
          readPrivate("record"),
          writePrivate("record"),
        ]),
      ],
      contextProviders: [],
      organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: "D2C",
        route: "/module/d2c",
        // Orders and Inventory are the SAME commerce domain in different data
        // shapes, so they are toggle Pages of this Module rather than
        // sub-modules — the ui-architecture rule from AP-011 (different columns
        // → toggle Pages; loosely related → sub-module). Research (plants) and
        // Notes are loosely related and nest below as sub-modules instead.
        // A Module must also land on a real data Page, never on its own
        // capability-inventory overview (catalog.test.ts), which a Pages-less
        // parent would do.
        pages: [
          {
            id: "orders",
            name: "Orders",
            route: "/module/d2c/orders",
            databaseId: "d2c.commerce",
            capabilityId: "d2c.commerce",
          },
          {
            id: "inventory",
            name: "Inventory",
            route: "/module/d2c/inventory",
            databaseId: "d2c.commerce",
            capabilityId: "d2c.commerce",
          },
        ],
        agents: [],
        automations: [],
      },
    },
  },
  ...(
    [
      {
        name: "d2c-research",
        displayName: "Research",
        summary: "Plants, their traditional uses and their sourcing.",
        description:
          "A nested sub-module of D2C. Plant Records carry uses, contraindications, sourcing and regulatory classification, linked to the raw materials Inventory tracks.",
      },
      {
        name: "d2c-notes",
        displayName: "Notes",
        summary: "The owner's working notes, linked to the Records they concern.",
        description:
          "A nested sub-module of D2C. Notes are Records that link to orders, products and plants, so a note about a batch is reachable from the batch.",
      },
    ] as const
  ).map((sub): BuiltInModule => ({
    // Internal: same private contracts as the parent, no egress.
    computedRisk: "operational",
    manifest: {
      name: sub.name,
      version: "0.1.0",
      kind: "organization_definition",
      summary: sub.summary,
      description: sub.description,
      lineageManifestId: null,
      dependencies: [],
      // Restating the parent's capability under the sub-module's own row is
      // descriptive, not a second grant — identical data, identical plane,
      // exactly as Helpdesk does under NetworkManager. Every Module needs at
      // least one declared capability or the seed step rejects it outright.
      capabilities: [
        capability("d2c.commerce", "Orders, invoices and stock", "database", [
          readPrivate("record"),
          writePrivate("record"),
        ]),
      ],
      contextProviders: [],
      organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
      module: {
        displayName: sub.displayName,
        // Nesting is nav only (ADR-178): governance, plane and capability
        // resolution are unchanged by the parent.
        parentModule: "d2c",
        route: `/module/d2c/${sub.displayName.toLowerCase()}`,
        pages: [
          {
            id: sub.displayName.toLowerCase(),
            name: sub.displayName,
            route: `/module/d2c/${sub.displayName.toLowerCase()}`,
            databaseId: "d2c.commerce",
            capabilityId: "d2c.commerce",
          },
        ],
        agents: [],
        automations: [],
      },
    },
  })),
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
    (pkg) =>
      pkg.manifest.name !== "relationship" &&
      pkg.manifest.name !== "whatsapp" &&
      // Helpdesk is excluded for the same reason its parent is: its Records and
      // Events are the owner's private relationship data, not a generalized
      // capability another Organization could install. Commons never carries
      // personal data.
      pkg.manifest.name !== "helpdesk" &&
      // Academics is the owner's own coursework — personal data, same reasoning.
      pkg.manifest.name !== "academics" &&
      // Events resolves speakers into the owner's own private People, same as
      // Helpdesk's reasoning above (TASK-070, ADR-236).
      pkg.manifest.name !== "events" &&
      // DevPilot is excluded for the same class of reason as WhatsApp: reading
      // the owner's own tracked GitHub repos through a personal token is not a
      // generalized capability another Organization could safely install.
      pkg.manifest.name !== "devpilot",
  ).map((pkg) => ({
    ...pkg,
    commons: {
      provenance: provenance(builtInSourceRef(pkg.manifest.name)),
      // TM6 (ADR-206) — Task Manager earns discovery tags of its own. A
      // Commons entry tagged only `built-in` + its kind is present but
      // unfindable, and Commons exists so someone with a NEED can find the
      // capability that meets it. Every tag names a capability this Module
      // actually ships; none names personal data, which never enters Commons.
      tags: pkg.manifest.name === "task-manager"
        ? [
            "built-in",
            pkg.manifest.kind,
            "task-management",
            "execution-queue",
            "planning",
            "governed-automation",
            "need:single-execution-queue",
            "need:agent-task-routing",
            "need:planning-playbooks",
          ]
        : ["built-in", pkg.manifest.kind],
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
