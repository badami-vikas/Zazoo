/**
 * @bridge/integrations-google — Gmail + Google Calendar.
 *
 * READ pipeline: an egress agent SOURCES through the gate (external:fetch) → bodies
 * persist to the LOCAL plane → graph entries are PROPOSED (draft-then-approve).
 * WRITE pipeline: compose a DRAFT → human approves the external:send (>= L2) → the
 * EgressExecutor performs the real send/write through the gate, append-only audited.
 */
export * from "./contracts.js";
export * from "./gateway.js";
export {
  googleSkills,
  type GoogleSkillDeps,
  SKILL_SOURCE_GMAIL,
  SKILL_SOURCE_CALENDAR,
  SKILL_LIST_CALENDAR,
  SKILL_STAGE,
  SKILL_COMPOSE_EMAIL,
  SKILL_COMPOSE_EVENT,
  SKILL_COMPOSE_UPDATE_EVENT,
  SKILL_COMPOSE_DELETE_EVENT,
} from "./skills.js";
export {
  IntakeService,
  IntakeMaterializer,
  type IntakeServiceDeps,
  type IntakeMaterializerDeps,
  type IntakeIdentities,
  type SyncOpts,
  type IntakeResult,
  type IntakeProposalSummary,
  type MatchOutcome,
  type IntakeDirective,
  type EntityDirective,
  type PersonDirective,
  type ExternalDirective,
} from "./intake.js";
export { EgressExecutor, type EgressExecutorDeps, type EgressOutcome } from "./egress.js";
export { GoogleService, type GoogleServiceDeps, type ProposeSendInput, type CalendarWriteAction } from "./service.js";
export { GOOGLE_MANIFEST, type ToolManifest, type ToolCapability, type ToolOutputMapping } from "./manifest.js";
export {
  oauthConfigFromEnv,
  buildOAuthClient,
  authUrl,
  exchangeCode,
  clientFromToken,
  tokenRecordFrom,
  type GoogleOAuthConfig,
  type ExchangedTokens,
} from "./oauth.js";
export { GoogleApiGateway, GoogleApiGatewayFactory } from "./gateway-google.js";
