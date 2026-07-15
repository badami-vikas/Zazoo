export { dealPilotManifest } from "./manifest.js";
export type { ThesisProfile, DealProfile, TriageState, ThesisFitResult } from "./types.js";
export { scoreThesisFit } from "./scoring.js";
export type { DealPipelineResult } from "./pipeline.js";
export { processDealCandidate } from "./pipeline.js";
export { dealsTableSpec, dealsKanbanView, dealsStageBoardView } from "./table.js";
export type { ParseBatchSummary } from "./connectors.js";
export {
  createBizBuySellAlertConnector,
  createBusinessBrokerNetConnector,
  parseBizBuySellAlert,
  parseBizBuySellAlertBatch,
  createGmailFetchMessages,
  normalizeBusinessBrokerRow,
} from "./connectors.js";
export type {
  DealStage,
  DealShell,
  StageTransitionError,
  TransitionResult,
} from "./deal.js";
export {
  VALID_TRANSITIONS,
  TERMINAL_STAGES,
  PIPELINE_STAGES,
  transitionStage,
  canTransition,
} from "./deal.js";
export type {
  ActivityActor,
  ActivityKind,
  ActivityEvent,
  FlagSeverity,
  DealFlag,
  DealKeyEconomics,
  DealSummaryProjection,
  DealProfileProjection,
  DealDocumentKind,
  DealDocumentStatus,
  DealDocument,
  DealDocumentsProjection,
  DealActivityProjection,
} from "./projections.js";
export { projectSummary, projectProfile, projectDocuments, projectActivity } from "./projections.js";
