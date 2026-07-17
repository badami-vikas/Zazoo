export { dealPilotManifest } from "./manifest.js";
export type { ThesisProfile, DealProfile, ThesisFitBand, ThesisFitResult } from "./types.js";
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
export type {
  DealPilotPageId,
  DealPilotRecordKind,
  RelationKind,
  SourceRightsState,
  SourceHealth,
  SourceConnectionType,
  DealRecord,
  SourceRecord,
  ThesisRecord,
  DealPilotRecord,
  DealPilotRelation,
  DealPilotPage,
  DealPilotBindings,
  DealPilotColumn,
  DealPilotPageManifest,
  DealPilotModuleManifest,
  CreateDealInput,
  CreateSourceInput,
  CreateThesisInput,
  CreateRelationInput,
  DealPilotRecordDetail,
  DealPilotStore,
  ThesisSourceDiscoveryProposal,
} from "./domain.js";
export {
  dealPilotModuleManifest,
  InMemoryDealPilotStore,
  DealPilotStoreError,
  SourceDiscoveryGateError,
  assertSourceDiscoveryAllowed,
  proposeThesisSourceDiscovery,
  applyThesisSourceDiscovery,
} from "./domain.js";
export type {
  CredentialField,
  CredentialAccessAction,
  SourceCredential,
  CredentialMetadata,
  SourceCredentialVault,
  CredentialAuditEvent,
  CredentialAuditSink,
} from "./credentials.js";
export {
  InMemorySourceCredentialVault,
  InMemoryCredentialAuditSink,
  CredentialAccessError,
  HumanReauthentication,
  SourceCredentialService,
} from "./credentials.js";
