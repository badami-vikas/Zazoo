export { dealPilotManifest } from "./manifest.js";
export type { ThesisProfile, DealProfile, TriageState, ThesisFitResult } from "./types.js";
export { scoreThesisFit } from "./scoring.js";
export type { DealPipelineResult } from "./pipeline.js";
export { processDealCandidate } from "./pipeline.js";
export { dealsTableSpec, dealsKanbanView } from "./table.js";
export type { ParseBatchSummary } from "./connectors.js";
export {
  createBizBuySellAlertConnector,
  createBusinessBrokerNetConnector,
  parseBizBuySellAlert,
  parseBizBuySellAlertBatch,
  createGmailFetchMessages,
  normalizeBusinessBrokerRow,
} from "./connectors.js";
