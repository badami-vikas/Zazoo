/**
 * Composition root of the API. Every namespace lives in ./routers/<name>.ts and
 * shares the prelude in ./router-shared.ts (context, guards, schemas, helpers).
 * Split from a single 23k-line file on 2026-09-03; behaviour unchanged.
 *
 * Two compositions (ADR 2026-09-04 "The Egg ships the kernel; Modules live in
 * Commons"): `appRouter` is everything and stays the client's type; `eggRouter`
 * is the kernel alone — what `BRIDGE_PROFILE=egg` mounts. A Commons Module's
 * namespace is simply absent from the Egg until the Module is installed from
 * the registry; the web shell already hides what `modules.list` does not
 * return, so nothing on the surface points at a procedure that is not there.
 */
import { chatRouter } from "./routers/chat.js";
import { taskManagerRouter } from "./routers/taskManager.js";
import { viewRouter } from "./routers/view.js";
import { actionRouter } from "./routers/action.js";
import { captureRouter } from "./routers/capture.js";
import { whatsappRouter } from "./routers/whatsapp.js";
import { googleRouter } from "./routers/google.js";
import { agentRouter } from "./routers/agent.js";
import { automationRouter } from "./routers/automation.js";
import { relationshipRouter } from "./routers/relationship.js";
import { devpilotRouter } from "./routers/devpilot.js";
import { dealpilotRouter } from "./routers/dealpilot.js";
import { modelProviderKeyRouter } from "./routers/modelProviderKey.js";
import { integrationRouter } from "./routers/integration.js";
import { briefRouter } from "./routers/brief.js";
import { learningRouter } from "./routers/learning.js";
import { onboardingRouter } from "./routers/onboarding.js";
import { redFlagRouter } from "./routers/redFlag.js";
import { organizationRouter } from "./routers/organization.js";
import { graphRouter } from "./routers/graph.js";
import { jobpilotRouter } from "./routers/jobpilot.js";
import { builderRouter } from "./routers/builder.js";
import { moduleGovernanceRouter } from "./routers/moduleGovernance.js";
import { moduleIntelligenceRouter } from "./routers/moduleIntelligence.js";
import { tableSchemaRouter } from "./routers/tableSchema.js";
import { accountingRouter } from "./routers/accounting.js";
import { d2cRouter } from "./routers/d2c.js";
import { d2cResearchRouter } from "./routers/d2cResearch.js";
import { d2cNotesRouter } from "./routers/d2cNotes.js";
import { resourcesRouter } from "./routers/resources.js";
import { eventsRouter } from "./routers/events.js";
import { capabilityRouter } from "./routers/capability.js";
import { modulesRouter } from "./routers/modules.js";
import { commonsRouter } from "./routers/commons.js";
import { chiefOfStaffRouter } from "./routers/chiefOfStaff.js";
import { agentOrchestrationRouter } from "./routers/agentOrchestration.js";
import { recordsRouter } from "./routers/records.js";
import { moduleRecordsRouter } from "./routers/moduleRecords.js";
import { procedure, t } from "./router-shared.js";

export * from "./router-shared.js";

/** The Egg: kernel, Builder, Research/Learning Agent, and the primitives
 * every Module is built from. Nothing here belongs to one Module. */
const kernelNamespaces = {
  chat: chatRouter,
  taskManager: taskManagerRouter,
  health: procedure.query(() => ({ ok: true, service: "bridge-api" })),
  view: viewRouter,
  action: actionRouter,
  capture: captureRouter,
  agent: agentRouter,
  automation: automationRouter,
  modelProviderKey: modelProviderKeyRouter,
  integration: integrationRouter,
  brief: briefRouter,
  learning: learningRouter,
  onboarding: onboardingRouter,
  redFlag: redFlagRouter,
  organization: organizationRouter,
  graph: graphRouter,
  builder: builderRouter,
  moduleGovernance: moduleGovernanceRouter,
  moduleIntelligence: moduleIntelligenceRouter,
  tableSchema: tableSchemaRouter,
  records: recordsRouter,
  moduleRecords: moduleRecordsRouter,
  capability: capabilityRouter,
  modules: modulesRouter,
  commons: commonsRouter,
  chiefOfStaff: chiefOfStaffRouter,
  agentOrchestration: agentOrchestrationRouter,
};

/** Commons Modules — code under `platform/commons/`, manifests published to
 * the registry by `commons.publishBuiltins`. Mounted only in the full profile. */
const commonsModuleNamespaces = {
  whatsapp: whatsappRouter,
  google: googleRouter,
  relationship: relationshipRouter,
  devpilot: devpilotRouter,
  dealpilot: dealpilotRouter,
  jobpilot: jobpilotRouter,
  accounting: accountingRouter,
  d2c: d2cRouter,
  d2cResearch: d2cResearchRouter,
  d2cNotes: d2cNotesRouter,
  resources: resourcesRouter,
  events: eventsRouter,
};

export const COMMONS_MODULE_NAMESPACES = Object.freeze(
  Object.keys(commonsModuleNamespaces),
) as readonly string[];

export const appRouter = t.router({ ...kernelNamespaces, ...commonsModuleNamespaces });

/** What `BRIDGE_PROFILE=egg` serves. Typed as its own router so a test can
 * prove which namespaces the Egg does and does not expose. */
export const eggRouter = t.router(kernelNamespaces);

export type AppRouter = typeof appRouter;
