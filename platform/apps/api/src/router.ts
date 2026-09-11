// Composition of every sub-router. Each domain lives in ./routers/<name>.ts;
// shared schemas/middleware/helpers live in ./router-shared.ts.
import { t, procedure } from "./router-shared.js";
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
import { accountingRouter } from "./routers/accounting.js";
import { d2cRouter } from "./routers/d2c.js";
import { d2cResearchRouter } from "./routers/d2cResearch.js";
import { d2cNotesRouter } from "./routers/d2cNotes.js";
import { resourcesRouter } from "./routers/resources.js";
import { academicsRouter } from "./routers/academics.js";
import { eventsRouter } from "./routers/events.js";
import { capabilityRouter } from "./routers/capability.js";
import { authoredModulesRouter } from "./routers/authoredModules.js";
import { modulesRouter } from "./routers/modules.js";
import { commonsRouter } from "./routers/commons.js";
import { chiefOfStaffRouter } from "./routers/chiefOfStaff.js";
import { agentOrchestrationRouter } from "./routers/agentOrchestration.js";
export { deterministicUuid, anchorLineageKey, RETRIEVAL_EVAL_METRIC, RETRIEVAL_EVAL_METRIC_NOTE } from "./router-shared.js";

export const appRouter = t.router({
  chat: chatRouter,
  taskManager: taskManagerRouter,
  health: procedure.query(() => ({ ok: true, service: "bridge-api" })),

  view: viewRouter,
  action: actionRouter,
  capture: captureRouter,
  whatsapp: whatsappRouter,
  google: googleRouter,
  agent: agentRouter,
  automation: automationRouter,
  relationship: relationshipRouter,
  devpilot: devpilotRouter,
  dealpilot: dealpilotRouter,
  modelProviderKey: modelProviderKeyRouter,
  integration: integrationRouter,
  brief: briefRouter,
  learning: learningRouter,
  onboarding: onboardingRouter,
  redFlag: redFlagRouter,
  organization: organizationRouter,
  graph: graphRouter,
  jobpilot: jobpilotRouter,
  accounting: accountingRouter,
  d2c: d2cRouter,
  d2cResearch: d2cResearchRouter,
  d2cNotes: d2cNotesRouter,
  resources: resourcesRouter,
  academics: academicsRouter,
  events: eventsRouter,
  capability: capabilityRouter,
  authoredModules: authoredModulesRouter,
  modules: modulesRouter,
  commons: commonsRouter,
  chiefOfStaff: chiefOfStaffRouter,
  agentOrchestration: agentOrchestrationRouter,
});

export type AppRouter = typeof appRouter;
