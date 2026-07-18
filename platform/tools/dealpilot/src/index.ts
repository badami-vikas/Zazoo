export { dealPilotManifest } from "./manifest.js";
export type { ThesisProfile, DealProfile, ThesisFitBand, ThesisFitResult } from "./types.js";
export { scoreThesisFit } from "./scoring.js";
export type { DealPipelineResult } from "./pipeline.js";
export { processDealCandidate } from "./pipeline.js";
export { dealsTableSpec, dealsKanbanView, dealsStageBoardView } from "./table.js";
export type {
  ParseBatchSummary,
  GmailContinuation,
  GmailFetchReceipt,
  GmailFetchState,
  GmailFetchStateStore,
} from "./connectors.js";
export {
  createBizBuySellAlertConnector,
  createBusinessBrokerNetConnector,
  parseBizBuySellAlert,
  parseBizBuySellAlertBatch,
  createGmailFetchMessages,
  InMemoryGmailFetchStateStore,
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
  SourceCredentialScope,
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
  metadataForCredential,
} from "./credentials.js";
export type { KeyringEntryFactory } from "./keyring-credentials.js";
export {
  KeyringCredentialError,
  KeyringSourceCredentialVault,
} from "./keyring-credentials.js";
export type {
  DealPilotStatePort,
  DealPilotCaptureProjection,
  DealPilotCapturePage,
  DiscoverySettlement,
  SettleDiscoveryBatchInput,
  CommitCaptureResult,
  DealPilotRuntimeStore,
  PendingCredentialOperation,
} from "./runtime-store.js";
export {
  LocalDealPilotStore,
  reconcileCredentialOperations,
} from "./runtime-store.js";
