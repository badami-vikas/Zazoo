/**
 * Signed source definitions for built-in Modules. Module Detail reads the same
 * manifests the module store installs; no frontend inventory is hardcoded.
 *
 * Packaged Modules own their own entry (`@bridge/<x>/module`); this catalog
 * assembles them next to the kernel Modules that have no package of their own
 * (relationship, helpdesk, academics, events, task-manager).
 */
import {
  builtInSourceRef,
  capability,
  provenance,
  readAll,
  readPrivate,
  readPublic,
  writeAll,
  writePrivate,
  TASK_PLAYBOOKS,
  type BuiltInModule,
  type BuiltInModuleWithSurface,
  type CommonsBuiltInModule,
  type ModuleDatabaseBinding,
  type ModuleRuntimeIds,
} from "@bridge/core";
import { accountingModule } from "@bridge/accounting/module";
import { d2cModule, d2cNotesModule, d2cResearchModule } from "@bridge/d2c/module";
import { DEALPILOT_RUNTIME_IDS, dealPilotModule } from "@bridge/dealpilot/module";
import { DEVPILOT_RUNTIME_IDS, devpilotGithubReview, devpilotGithubSync, devpilotModule } from "@bridge/devpilot/module";
import { jobPilotModule } from "@bridge/jobpilot/module";
import { whatsappModule } from "@bridge/whatsapp/module";

export {
  builtInSourceRef,
  capability,
  provenance,
  readAll,
  readPrivate,
  readPublic,
  writeAll,
  writePrivate,
  BUILT_IN_SOURCE_REFS,
  INSPECTED_COMMIT,
  SOURCE_REPOSITORY,
  type BuiltInModule,
  type BuiltInModuleWithSurface,
  type CommonsBuiltInModule,
  type ModuleRuntimeIds,
} from "@bridge/core";
export {
  accountingModule,
  d2cModule,
  d2cNotesModule,
  d2cResearchModule,
  dealPilotModule,
  devpilotModule,
  jobPilotModule,
  whatsappModule,
};
export * from "@bridge/dealpilot/module";
export * from "@bridge/devpilot/module";

export const LEARNING_AGENT_RUNTIME_ID = "b0000000-0000-4000-a000-0000000000d2";
export const INTERNAL_STRATEGIST_AGENT_RUNTIME_ID = "b0000000-0000-4000-a000-0000000000d3";
export const GOVERNANCE_AGENT_RUNTIME_ID = "b0000000-0000-4000-a000-0000000000d4";
/** The Builder Agent's runtime identity (BA0). Every primitive call and every
 * Run receipt is attributed to it, and the ledger's actor column is a uuid —
 * an actor named "builder:<module>" is not an actor the ledger can hold. */
// One Agent, one id: this is the same identity `CAPABILITY_BUILDER_AGENT` in
// the api wiring seeds and resolves authority for. Until 2026-09-04 the Builder
// acted under a second id (…d7) that no Agent registry knew, so its Runs were
// attributed to an Agent nobody could find or narrow.
export const BUILDER_AGENT_RUNTIME_ID = "b0000000-0000-4000-a000-0000000000d5";
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

export const RELATIONSHIP_RUNTIME_IDS: ModuleRuntimeIds = {
  automations: {},
  agents: { "learning-agent": LEARNING_AGENT_RUNTIME_ID },
};

export const TASK_MANAGER_RUNTIME_IDS: ModuleRuntimeIds = {
  automations: {
    [TASK_MANAGER_DRIFT_AUTOMATION_KEY]: TASK_MANAGER_DRIFT_AUTOMATION_ID,
    [TASK_MANAGER_SWEEP_AUTOMATION_KEY]: TASK_MANAGER_SWEEP_AUTOMATION_ID,
    [TASK_MANAGER_SCAN_AUTOMATION_KEY]: TASK_MANAGER_SCAN_AUTOMATION_ID,
    [TASK_MANAGER_PLANNING_AUTOMATION_KEY]: TASK_MANAGER_PLANNING_AUTOMATION_ID,
    [TASK_MANAGER_STANDUP_AUTOMATION_KEY]: TASK_MANAGER_STANDUP_AUTOMATION_ID,
    [TASK_MANAGER_STALE_REVIEW_AUTOMATION_KEY]: TASK_MANAGER_STALE_REVIEW_AUTOMATION_ID,
    [TASK_MANAGER_WIP_BREACH_AUTOMATION_KEY]: TASK_MANAGER_WIP_BREACH_AUTOMATION_ID,
    [TASK_MANAGER_UNVERIFIED_DONE_AUTOMATION_KEY]: TASK_MANAGER_UNVERIFIED_DONE_AUTOMATION_ID,
    [TASK_MANAGER_RESCHEDULE_GATE_AUTOMATION_KEY]: TASK_MANAGER_RESCHEDULE_GATE_AUTOMATION_ID,
    [TASK_MANAGER_ROUTING_GATE_AUTOMATION_KEY]: TASK_MANAGER_ROUTING_GATE_AUTOMATION_ID,
    [TASK_MANAGER_GOAL_REVIEW_AUTOMATION_KEY]: TASK_MANAGER_GOAL_REVIEW_AUTOMATION_ID,
    [TASK_MANAGER_IMPACT_FIT_AUTOMATION_KEY]: TASK_MANAGER_IMPACT_FIT_AUTOMATION_ID,
    [TASK_MANAGER_RESTRUCTURE_AUTOMATION_KEY]: TASK_MANAGER_RESTRUCTURE_AUTOMATION_ID,
    [TASK_MANAGER_REOPEN_AUTOMATION_KEY]: TASK_MANAGER_REOPEN_AUTOMATION_ID,
    [TASK_MANAGER_DEPENDENCY_AUTOMATION_KEY]: TASK_MANAGER_DEPENDENCY_AUTOMATION_ID,
    [TASK_MANAGER_ROUTING_AUTOMATION_KEY]: TASK_MANAGER_ROUTING_AUTOMATION_ID,
  },
  agents: {
    // The Egg (ADR 2026-09-04): Task Manager's Learning Agent IS the Learning
    // Agent — the same runtime identity Relationship binds in the full profile.
    "learning-agent": LEARNING_AGENT_RUNTIME_ID,
    "capability-builder": BUILDER_AGENT_RUNTIME_ID,
    "internal-strategist": INTERNAL_STRATEGIST_AGENT_RUNTIME_ID,
    "governance-agent": GOVERNANCE_AGENT_RUNTIME_ID,
    "chief-of-staff": CHIEF_OF_STAFF_AGENT_RUNTIME_ID,
  },
};

/**
 * Runtime identities per Module. A packaged Module declares its own table in
 * `src/module.ts`; kernel Modules declare theirs above. Kept OFF the catalog
 * entries on purpose: entries are published to Commons and a runtime row must
 * never travel with them. The UUIDs are persisted rows in the
 * agents/automations tables — the catalog test pins every (module, key) → id
 * pair so a refactor cannot orphan them.
 */
export const MODULE_RUNTIME_IDS: Readonly<Record<string, ModuleRuntimeIds>> = {
  "deal-pilot": DEALPILOT_RUNTIME_IDS,
  relationship: RELATIONSHIP_RUNTIME_IDS,
  "task-manager": TASK_MANAGER_RUNTIME_IDS,
  devpilot: DEVPILOT_RUNTIME_IDS,
};

const RUNTIME_AUTOMATION_IDS = new Set(
  Object.values(MODULE_RUNTIME_IDS).flatMap((ids) => Object.values(ids.automations)),
);

export function resolveModuleAutomationRuntimeId(moduleName: string, manifestAutomationId: string): string | undefined {
  return MODULE_RUNTIME_IDS[moduleName]?.automations[manifestAutomationId];
}

export function isModuleRuntimeAutomationId(automationId: string): boolean {
  return RUNTIME_AUTOMATION_IDS.has(automationId);
}

export function resolveModuleAgentRuntimeId(moduleName: string, manifestAgentId: string): string | undefined {
  return MODULE_RUNTIME_IDS[moduleName]?.agents[manifestAgentId];
}

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
  // `web-research` and `relationship.integration.google-sources` used to be
  // declared HERE. They are now separately-installed Commons Skills
  // (`governedWebResearch` / `googleRelationshipSources` below): together with
  // the Learning Agent's own egress permission they were the egress leg that
  // made this Module's capability union the lethal trifecta, so the base
  // Module was refused by the Commons publish scan and could never be
  // installed at all. Reach is now its own governed decision.
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
    // The Agent's own `readPublic("external:fetch")` (untrusted ingest +
    // egress) is gone: reach arrives with the `governed-web-research` Commons
    // Skill it declares a need for, not with the Agent. The Agent capability
    // itself cannot move to Commons — a Module agent binding must reference an
    // agent capability the Module declares, and a Commons skill entry may only
    // carry skill-type capabilities — so this is the "strip the egress
    // permission and consume the need" branch.
    [
      writePrivate("signal"),
      writePrivate("event"),
    ],
    [],
    [
      { manifestId: "relationship.help-request.stage-offer", versionRange: "0.2.0" },
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
];

/**
 * Academics Module capabilities (TASK-069, ADR-231). Three private
 * database Pages over the owner's own coursework Records — no egress. The
 * Study Steward Agent is declared with no `skillIds` yet: lecture-synthesis,
 * syllabus-intake, recall-scheduler, reference-resolve, and workload-forecast
 * are later phases of this same Task, not a separate Module version.
 *
 * Since ADR 2026-09-04 "The Egg ships the kernel; Modules live in Commons"
 * this Module ships NO code: `academicsDatabases` below is the whole surface —
 * the standard Module Page renders each declared Database and
 * `moduleRecords.*` serves its rows from the Local Plane. The manifest is a
 * Commons entry (it carries no personal data; the owner's coursework Records
 * never leave the Local Plane), and the Egg does not seed it (`EGG_MODULES`).
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

const academicsDatabases: ModuleDatabaseBinding[] = [
  {
    id: "subjects",
    name: "Subjects",
    columns: [
      { id: "name", label: "Name", kind: "text", required: true },
      { id: "code", label: "Code", kind: "text" },
      { id: "term", label: "Term", kind: "text" },
      { id: "instructor", label: "Instructor", kind: "text" },
      { id: "credits", label: "Credits", kind: "number" },
    ],
  },
  {
    id: "lecture-sessions",
    name: "Lecture Sessions",
    columns: [
      // A relation column is stored as declared; the standard Page has no
      // relation picker yet (ADR 2026-09-04 consequences), so the Subject is
      // typed by hand until it does.
      { id: "subject", label: "Subject", kind: "relation", relationTarget: "academics.subjects", required: true },
      { id: "date", label: "Date", kind: "date" },
      { id: "topic", label: "Topic", kind: "text", required: true },
      { id: "notes_summary", label: "Notes summary", kind: "text" },
      { id: "recording_link", label: "Recording link", kind: "url" },
    ],
  },
  {
    id: "assignments",
    name: "Assignments",
    columns: [
      { id: "subject", label: "Subject", kind: "relation", relationTarget: "academics.subjects", required: true },
      { id: "title", label: "Title", kind: "text", required: true },
      { id: "due_date", label: "Due date", kind: "date" },
      {
        id: "status",
        label: "Status",
        kind: "select",
        options: ["not_started", "in_progress", "submitted", "graded"],
      },
      { id: "grade", label: "Grade", kind: "text" },
    ],
  },
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

const taskManagerCapabilities = [
  capability("task-manager.tasks", "Tasks Database and Views", "database", [readAll("record"), writeAll("record")]),
  // The Egg's Research Agent (ADR 2026-09-04): with no Relationship Module
  // installed, Task Manager's Learning Agent owns the `web-research` Skill.
  // Same permissions Relationship declares for it; the Skill is the kernel's
  // (GOVERNED_SKILL_MANIFEST_CATALOG), only its Module owner changes.
  capability("task-manager.skill.web-research", "Skill: web research", "skill", [readPublic("external:fetch"), writePrivate("event")]),
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

export const relationshipModule: BuiltInModuleWithSurface = {
  computedRisk: "external",
  manifest: {
    name: "relationship",
    // 0.2.4 added the Learning Agent's `runRoute` (ADR-180). 0.3.0 (a
    // parallel workstream) renamed the display name to "NetworkManager"
    // and made this Module a nav PARENT (WhatsApp declares it, ADR-178).
    // 0.3.1 is the union of both — Module content is IMMUTABLE at a given
    // version, so a manifest carrying both changes needs a version past
    // either parent, not a pick between them.
    // 0.4.0 (2026-09-15) removes `web-research` and the Google sources
    // integration from the bundle and declares Commons needs for them
    // instead. Content changed, so the version must: an installed 0.3.1 row
    // carries the old bundle and `create()` refuses a different manifest at
    // the same version.
    version: "0.4.0",
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
          // `web-research` is no longer bundled — it arrives from Commons and
          // is attached to this Agent at install (commonsNeeds below).
          skillIds: ["relationship.help-request.stage-offer"],
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
        id: "governed-web-research",
        title: "Web research",
        description:
          "Let the Learning Agent look things up on the public web inside a governed Agent Run. Reaching the internet is a separate decision from installing this Module.",
        agentId: "learning-agent",
        kind: "skill",
        tags: ["need:governed-web-research"],
      }, {
        id: "google-relationship-sources",
        title: "Gmail and Calendar as relationship sources",
        description:
          "Let the Relationship Steward read your Gmail and Calendar to keep People, Signals, and Communities current.",
        agentId: "steward",
        kind: "skill",
        tags: ["need:google-relationship-sources"],
      }, {
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
};

export const helpdeskModule: BuiltInModuleWithSurface = {
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
};

export const academicsModule: BuiltInModuleWithSurface = {
  // Internal: personal coursework vault. No egress, no third-party session.
  computedRisk: "operational",
  manifest: {
    name: "academics",
    // 0.2.0: declared Databases replace the bespoke Page/router/store
    // (ADR 2026-09-04 "The Egg ships the kernel; Modules live in Commons").
    version: "0.2.0",
    kind: "organization_definition",
    summary: "Subjects, Lecture Sessions, and Assignments — the owner's coursework vault.",
    description:
      "Three sibling toggles over the owner's own coursework Records: Subjects, Lecture Sessions, Assignments — each a declared Database rendered by the standard Module Page (UI Rulebook §3d). Local Files land under `~/Documents/Bridge/<Organization>/Academics/`.",
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
      databases: academicsDatabases,
      pages: [
        {
          id: "subjects",
          name: "Subjects",
          route: "/module/academics/subjects",
          databaseId: "subjects",
          capabilityId: "academics.page.subjects",
        },
        {
          id: "sessions",
          name: "Lecture Sessions",
          route: "/module/academics/sessions",
          databaseId: "lecture-sessions",
          capabilityId: "academics.page.lecture-sessions",
        },
        {
          id: "assignments",
          name: "Assignments",
          route: "/module/academics/assignments",
          databaseId: "assignments",
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
};

export const eventsModule: BuiltInModuleWithSurface = {
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
};

export const taskManagerModule: BuiltInModuleWithSurface = {
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
    version: "1.10.0",
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
        skillIds: [
          ...taskManagerSkills
            .filter(([, owner]) => owner === agent.name)
            .map(([skillId]) => `task-manager.skill.${skillId}`),
          ...(agent.id === "learning-agent" ? ["task-manager.skill.web-research"] : []),
        ],
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
};

export const BUILT_IN_MODULES: readonly BuiltInModule[] = [
  dealPilotModule,
  jobPilotModule,
  relationshipModule,
  helpdeskModule,
  academicsModule,
  eventsModule,
  whatsappModule,
  taskManagerModule,
  devpilotModule,
  accountingModule,
  d2cModule,
  d2cResearchModule,
  d2cNotesModule,
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

/** The Learning Agent's public-web reach, split out of the Relationship Module
 * so the base Module publishes clean (2026-09-15). Capability id, permissions
 * and connectors are unchanged from what `relationship` used to bundle — every
 * caller (`WEB_RESEARCH_SKILL_ID`, the Agent-Run authority check, the AQV
 * ledger) keys on the id, which moved rather than disappeared. */
const governedWebResearch: BuiltInModule = {
  computedRisk: "external",
  manifest: {
    name: "governed-web-research",
    version: "1.0.0",
    kind: "skill",
    summary: "Look things up on the public web inside a governed Agent Run.",
    description:
      "Bridge's governed public-web research Skill. Every run is an attributable Agent Run whose fetched content is quarantined and whose Result is inspectable Memory — no private data leaves the Local Plane to obtain it.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        ...capability("web-research", "Governed public web research", "skill", [
          readPublic("external:fetch"),
          writePrivate("event"),
        ]),
        version: "1.0.0",
        audience: "private",
      },
    ],
    contextProviders: [],
    organizationVocab: { alignsToBridgeTheme: true, domainTerms: {} },
  },
};

/** Gmail + Calendar as relationship sources, split out of the Relationship
 * Module for the same reason. `capabilityType` is "skill" rather than the
 * "integration" it was declared as inside the Module: a Commons capability
 * installed beneath a Module Agent must be a Skill (routers/commons.ts). The
 * id, permissions and connectors are byte-identical. */
const googleRelationshipSources: BuiltInModule = {
  computedRisk: "external",
  manifest: {
    name: "google-relationship-sources",
    version: "1.0.0",
    kind: "skill",
    summary: "Read Gmail and Calendar to keep People, Signals, and Communities current.",
    description:
      "Reuses Bridge's governed Google connectors so a Relationship Agent can see who you actually talk to and meet. Read-only: no capability here may send mail or write a calendar.",
    lineageManifestId: null,
    dependencies: [],
    capabilities: [
      {
        ...capability(
          "relationship.integration.google-sources",
          "Google relationship sources",
          "skill",
          [{
            resourceType: "external:fetch",
            action: "read",
            // "private" described the sensitivity of what Gmail returns, and
            // read it as the trifecta's private-data-read leg, which made this
            // one capability unpublishable on its own. The leg this permission
            // actually supplies is untrusted ingest + egress: it reaches a
            // third party, it reads nothing of the owner's own Bridge data.
            dataScope: "public",
            egress: true,
          }],
          [{ id: "google-gmail" }, { id: "google-calendar" }],
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
  // EVERY built-in is published. The five that used to be withheld —
  // relationship, whatsapp, helpdesk, events, devpilot — are back, per the ADR
  // "2026-09-11 — A manifest is a definition, not a dossier".
  //
  // The old exclusions read "reading the owner's private contact graph out of a
  // third-party session is not a generalized capability anyone else could
  // safely install". That conflated two different things. A manifest carries
  // Databases, Pages, capability declarations and context-provider
  // requirements — no rows, no seed data, nothing personal. Publishing
  // `devpilot` publishes the SHAPE "sync the repos you track, with a token you
  // supply"; it publishes nobody's repos. And that shape is as generalized as a
  // capability gets: every installer has their own repos, exactly as every
  // installer has their own inbox, and the Google integration was always in
  // Commons on that reasoning.
  //
  // What the exclusions were really reaching for is installer RISK, which has
  // its own machinery — `RiskBand`, `CapabilityOrigin`, `requireHumanReview` at
  // install — and belongs there, not in a publish-time allowlist. `relationship`
  // is the sharpest case (its capability union is the lethal trifecta:
  // private-read + untrusted-content ingest + egress) and is published on the
  // same basis, by user directive 2026-09-11: install-time review is the gate,
  // and splitting that union into independently safe Results remains the
  // standing follow-up rather than a precondition for discovery.
  ...BUILT_IN_MODULES.map((pkg) => ({
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
        : pkg.manifest.name === "academics"
          ? ["built-in", pkg.manifest.kind, "coursework", "study", "need:coursework-vault"]
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
  // ── The egress split (2026-09-15) ──
  // `relationship` and `devpilot` were the two built-ins the publish scan
  // refused: the UNION of their bundled capabilities formed the lethal
  // trifecta, so neither was ever in the registry and neither could be added
  // from "New". These four entries are the reach that used to be bundled.
  // The base Modules now publish clean and deliberately do less on arrival —
  // gaining reach is its own governed install.
  {
    ...governedWebResearch,
    commons: {
      provenance: provenance("platform/apps/api/src/web-research-skill.ts"),
      tags: ["built-in", "research", "web", "need:governed-web-research"],
    },
  },
  {
    ...googleRelationshipSources,
    commons: {
      provenance: provenance("platform/packages/integrations-google/src/skills.ts"),
      tags: ["built-in", "google", "gmail", "calendar", "relationship", "need:google-relationship-sources"],
    },
  },
  {
    ...devpilotGithubSync,
    commons: {
      provenance: provenance("platform/commons/devpilot/src/module.ts"),
      tags: ["built-in", "github", "engineering", "need:github-sync"],
    },
  },
  {
    ...devpilotGithubReview,
    commons: {
      provenance: provenance("platform/commons/devpilot/src/module.ts"),
      tags: ["built-in", "github", "engineering", "code-review", "need:github-review"],
    },
  },
];

// ── Egg profile (ADR 2026-09-04 "The Egg ships the kernel; Modules live in Commons") ──
//
// `BRIDGE_PROFILE=egg` boots the bare Egg: kernel + Builder + Research Agent
// + primitives, with ONLY the Modules named here seeded as installed. Every
// other built-in is Commons content — it lives under `platform/commons/`,
// `commons.publishBuiltins` pushes it to the registry, and the Egg installs
// it from there like any other Module. The full profile (default, and what
// every existing test runs under) seeds all of BUILT_IN_MODULES as before.
export type BridgeProfile = "egg" | "full";

/** The Modules the bare Egg ships with. Task Manager is the Egg's own
 * default surface (Layout's DEFAULT_MODULES); nothing else is kernel. */
export const EGG_MODULES: ReadonlySet<string> = new Set(["task-manager"]);

/** Read the profile from an environment map. Anything but "egg" is full —
 * a misspelt value must not silently strip Modules from a running install. */
export function bridgeProfileFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): BridgeProfile {
  return (env.BRIDGE_PROFILE ?? "").trim().toLowerCase() === "egg" ? "egg" : "full";
}

/** The built-ins a boot under `profile` seeds and registers Automations for. */
export function builtInModulesForProfile(profile: BridgeProfile): readonly BuiltInModule[] {
  return profile === "egg"
    ? BUILT_IN_MODULES.filter((pkg) => EGG_MODULES.has(pkg.manifest.name))
    : BUILT_IN_MODULES;
}

