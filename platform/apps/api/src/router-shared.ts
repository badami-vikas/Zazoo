/**
 * tRPC router — the wire surface over the Universal Action Pipeline.
 *
 * Zod schemas here are the single validate+sanitize chokepoint at the seam
 * (backlog #24): nothing reaches the pipeline unvalidated. Procedures are thin —
 * all governance lives in the pipeline, not here.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  IntegrationFloorScopeError,
  UnknownOrganizationError,
  OrganizationRenameRollbackError,
  databaseUuidSchema,
  parseAutomationSteps,
  type RelationMaterializationEffect,
} from "@bridge/db";
import type { ApiContext } from "./context.js";
import type { LocalPlane } from "@bridge/local";
import { isPublicCloudProcedureAllowed } from "./deployment-boundary.js";
import {
  isModelProviderKeyId,
  type ModelProviderKeyId,
} from "./model-provider-keys.js";
import { LocalGeocodingProviderError } from "./geocoding-provider.js";
import {
  applyApprovedRelationshipMaterialization,
  isRelationshipSignalEvidence,
  proposalFromResolvedRelationshipLedger,
  relationshipOwnerFromLedger,
  relationshipSignalEvidencePayloadSchema,
  type RelationshipMaterialization,
} from "./relationship-materializer.js";
import {
  communityCreateFieldsSchema,
  communityUpdateFieldsSchema,
  interactionCreateFieldsSchema,
  isRelationshipMutation,
  materializeRelationshipMutation,
  personCreateFieldsSchema,
  personUpdateFieldsSchema,
  relationshipMutationPayloadSchema,
  validateRelationshipMutationEdit,
  type RelationshipMutationPayload,
} from "./relationship-record-materializer.js";
import {
  isGoogleLinkedInteractionIntake,
  parseGoogleLinkedInteractionIntake,
  validateGoogleInteractionEdit,
} from "./relationship-intake-materializer.js";
import { relationshipDateTimeSchema } from "./relationship-datetime.js";
import {
  CAPABILITY_BUILDER_AGENT,
  EGRESS_AGENT,
  LEARNING_AGENT,
  OUTREACH_AGENT,
  INTERNAL_STRATEGIST_AGENT,
  GOVERNANCE_AGENT,
  CHIEF_OF_STAFF_AGENT,
  TASK_ROUTING_CANDIDATE_AGENTS,
  PILOT_ORGANIZATION,
  LEARNING_ROLE_MODEL_GOAL_TYPE,
  PRODUCE_RECOMMENDATION_TASK_TYPE,
  RELATIONSHIP_HELP_ROUTING_GOAL_TYPE,
  DRAFT_HELP_OFFER_TASK_TYPE,
  RELATIONSHIP_CAPTURE_GOAL_TYPE,
  STAGE_CAPTURE_TASK_TYPE,
  RELATIONSHIP_OUTREACH_GOAL_TYPE,
  DRAFT_OUTREACH_TASK_TYPE,
  LEARNING_WEB_RESEARCH_GOAL_TYPE,
  RESEARCH_PUBLIC_WEB_TASK_TYPE,
  LEARNING_RESEARCH_RUN_GOAL_TYPE,
  RESEARCH_RUN_TASK_TYPE,
  JOBPILOT_CULTURE_RESEARCH_GOAL_TYPE,
  RESEARCH_CULTURE_SOURCE_TASK_TYPE,
  SYNTHESIZE_CULTURE_PROFILE_TASK_TYPE,
  resolveAuthorizedCultureSource,
  computeSourcePolicyHash,
  materializeCultureSourceFetch,
  cancelCultureSourceFetch,
  reconcileIntentChildConsistency,
  selfHealDeadSynthesisPointer,
  isResultExpired,
  CULTURE_SOURCE_REGISTRY,
  type SynthesizeCultureProfileOutput,
  PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE,
  PROPOSE_PREFERENCE_ADJUSTMENT_TASK_TYPE,
  ledgerSignalId,
  appFocusCaptureSignalId,
  browserCaptureSignalId,
  chatCaptureSignalId,
  googleCaptureSignalId,
  inputCaptureSignalId,
  whatsAppCaptureSignalId,
  resolveLocalPlanningModel,
  type Wiring,
} from "./wiring.js";
import { resolveAuthorizedAgentRoleTemplate } from "./agent-role-templates.js";
import {
  planChatTaskNode,
  resolveChatThreadTaskAnchor,
  type ChatTaskAnchorCandidate,
  type ParentCandidateTask,
  assertModuleGovernance,
  ModuleGovernanceDenied,
  readModuleGovernanceOverlay,
  resolveModuleGovernance,
} from "@bridge/core";
import { eq, desc } from "drizzle-orm";
import { schema as accountingSchema, validateExpression } from "@bridge/accounting";
import { applyColumnOverlay } from "@bridge/tables";
import type { ColumnKind, ColumnOverlay, TableSpec } from "@bridge/tables";
import {
  TABLE_SCHEMA_NAMESPACE_PREFIX,
  applyColumnOp,
  automationDependencies,
  formulaDependencies,
  formulaDependentIds,
  hasOverlay,
  readStoredTableSchema,
  relationDependencies,
  skillDependencies,
  viewDependencies,
  type ColumnDependencyPreview,
} from "./table-schema.js";
import { d2cSchema } from "./d2c-store.js";
import type {
  Action,
  Actor,
  ActorType,
  AuthorityDecision,
  DataScope,
  EgressTier,
  ModelProvider,
  MemoryEntry,
  ModuleGovernancePolicy,
  OnBehalfOf,
  PolicyResult,
  ResourceType,
  RunContext,
  TaskRecord,
} from "@bridge/core";
import {
  AgentFloorDeniedError,
  AlreadyResolvedError,
  KERNEL_PASSTHROUGH_SKILL,
  NotPendingProposalError,
  buildAgentCapability,
  validateAutomationWithinAgents,
  computeRisk,
  assertModelCompletionRequest,
  assertModelOutputTaint,
  createModelCallReceipt,
  advance,
  resolveActivationApproval,
  compareRuns,
  computeAqv,
  buildWhyBetterCard,
  resolveGates,
  classifyApprovalBand,
  canGovernanceAutoApprove,
  isOwnerScopedLedgerEntry,
  rollupOrgHealth,
  InvalidTransitionError as CapabilityInvalidTransitionError,
  EvidenceThresholdError,
  compileBlueprint,
  BlueprintCompileError,
  BLUEPRINT_FIELD_KINDS,
  classifyIntent,
  resolveAuthority,
  assertChainDepth,
  MAX_CHAIN_DEPTH,
  parseMention,
  parseSkillMention,
  invokeAgent,
  buildCommunicationsPersona,
  DIRECT_REPLY_OUTPUT_CONTRACT,
  canonicalizeManifest,
  canonicalizeJson,
  findOrganizationDataPaths,
  normalizeCommonsTags,
  COMMUNICATIONS_SKILL,
  findFoundationalAgent,
  buildChiefOfStaffPersona,
  profileFromRow,
  parseModuleManifest,
  ModuleManifestValidationError,
  computeModuleRisk,
  maxRisk,
  evaluateSandboxRequirement,
  isUntrustedOrigin,
  trustGrantsForOrigin,
  advanceModuleState,
  promoteToAvailable,
  rollbackFromHistory,
  InvalidModuleTransitionError,
  resolveSkillForTask,
  cancelChildAgentRun,
  SearchProvidersUnavailableError,
  completeChildAgentRun,
  createChildAgentRun,
  failChildAgentRun,
  ResearchRunAlreadyTerminalError,
  ResearchRunNotFoundError,
  RESEARCH_STOP_REASONS,
  labelFromLegacyTrustOrigin,
  declassifyTaintLabel,
  deriveDeclassifiedLabel,
  hashTaintValue,
  joinTaintLabels,
  labelAtSource,
  validateActionWithinChildRun,
  type ParentRunEnvelope,
  type CapabilityManifest,
  type CapabilityManifestRow,
  type CapabilityOrigin,
  type TrustGrantView,
  type WhyBetterCard,
  type CapabilityHealthRecord,
  type PendingProposalRecord,
  type Proposal,
  type RunCtx,
  type OrganizationBlueprint,
  type RoutableCapability,
  type ModuleInstallationRow,
  type ModuleCapabilityNeed,
  type ModuleManifest,
  type CommonsModuleEntry,
  type CommonsListQuery,
  type CommonsModuleDetail,
  type LedgerEntry,
  type ModelCallReceipt,
  type ModelTier,
  type TaskOutcome,
  uuidv7,
  emitTasksMarkdown,
  emitAgentLedgerTemplate,
  AGENT_LEDGER_TEMPLATE_FILE,
  TASK_PROJECTION_COMPLETED_CAP,
  TASK_RECORD_STATUSES,
  detectTaskProjectionDrift,
  applyApprovedTaskProjectionReconciliation,
  mergeEditedPlanningPayload,
  blockedTasks,
  dependencyBlockedTaskIds,
  taskIsOpen,
  TaskDependencyCycleError,
  MAX_MATERIALIZED_TASKS,
  evaluateTaskGuards,
  DEFAULT_STALE_AFTER_DAYS,
  planCompletedBaySweep,
  routeTaskByRequiredSkill,
  assembleRunContext,
  projectToSystemPrompt,
  ChatCloudGrantError,
  ChatStoreConflictError,
  ChatStoreNotFoundError,
  ChatStoreScopeError,
  CHAT_BACKEND_IDS,
  type ChatBackendTurn,
  type ChatOwnerScope,
  type ChatThread,
  type ChatTurn,
  type ChatTurnRef,
} from "@bridge/core";
import { WEB_RESEARCH_SKILL_ID } from "./web-research-skill.js";
import type { ModelBinding } from "@bridge/capability-kit";
import { createModelRouter, MANAGED_LLAMA_PROVIDER_ID } from "@bridge/models";
import { authUrl, CALENDAR_SOURCE, GMAIL_SOURCE, type IntakeDirective } from "@bridge/integrations-google";
import { classifyPatShape, maskPat } from "@bridge/integrations-github";
import { reposTableSpec, pullsTableSpec, issuesTableSpec, pullsTriageBoardView, issuesUpdatedListView } from "@bridge/devpilot";
import {
  routeHelpRequest,
  draftHelpOffer,
  type HelpResponderCandidate,
} from "./relationship-help-routing.js";
import {
  CredentialAccessError,
  SourceDiscoveryGateError,
  applyThesisSourceDiscovery,
  dealPilotModuleManifest,
  proposeThesisSourceDiscovery,
  scoreThesisFit,
  type ThesisSourceDiscoveryProposal,
  runSourceDiscovery,
  type SourceRecord,
  type ThesisProfile,
} from "@bridge/dealpilot";
import {
  acceptAutomationDraft,
  acceptSuggestion as acceptLearningSuggestion,
  detectAutomationDraftCandidates,
  digestSignals as digestLearningSignals,
  generalizeLearnedPreferences,
  isLearningObservationEntry,
  listPromotionSuggestions,
  ClaimGateError,
  hashingEmbed,
  isSuppressedByRejections,
  type RejectionSuppressionVerdict,
  type TextEmbedder,
  recordRejectionFingerprint,
  classifyClaimContent,
  draftStepsFromEpisodes,
  draftStructureFromClaims,
  episodesForSkill,
  type BuilderRefusalReason,
  type BuilderStepsResult,
  rejectAutomationDraft,
  seedSuggestionsFromArchetypes,
  supportBandRank,
  listSuggestions as listLearningSuggestions,
  listSignalModuleIds,
  mineLedgerSignals,
  preferencesToMemorySnippets,
  rejectSuggestion as rejectLearningSuggestion,
  retrieveLearnedPreferences,
  CAPTURE_SOURCES,
  acceptCommitmentSuggestion,
  browserCaptureVerdict,
  browserVisitCaptureSignal,
  calendarEventCaptureSignal,
  captureAllowed,
  chatTurnCaptureSignal,
  normalizeBrowserDomain,
  readBrowserDomainPolicy,
  detectCommitmentCandidates,
  gmailThreadCaptureSignal,
  listCommitmentSuggestions,
  proposeCommitmentSuggestions,
  readCaptureConsent,
  recordSignal as recordCaptureSignal,
  rejectCommitmentSuggestion,
  whatsAppMessageCaptureSignal,
  withCapturePaused,
  withSourceConsent,
  distilKeystrokeBurst,
  inputCaptureSignal,
  readInputCaptureDenylist,
  withInputCaptureDenylist,
  type CaptureConsentState,
  type InputCaptureDenylist,
  type FieldRole,
  acceptClaimSuggestion,
  claimsToMemorySnippets,
  CLAIM_ENTITY_KINDS,
  listClaimSuggestions,
  PROPOSABLE_CLAIM_CLASSES,
  proposeClaimSuggestion,
  readClaimSuggestion,
  rejectClaimSuggestion,
  TAINT_SENSITIVITY,
  type ClaimProposal,
  type RetrievedMemorySnippet,
} from "@bridge/core";
import {
  jobsTableSpec,
  scoreJobFit,
  transition,
  InvalidTransitionError,
  classifyCultureSource,
  MAX_CULTURE_SOURCES_PER_RUN,
  JOB_FUNCTIONS,
  type ApplicationStage,
  type CandidateProfile,
  type JobProfile,
  type GroundedClaimInput,
} from "@bridge/jobpilot";
import {
  mapExtraction as mapWhatsAppExtraction,
  personIndexFrom as whatsAppPersonIndexFrom,
  advanceCursor as advanceWhatsAppCursor,
  mapMessages as mapWhatsAppMessages,
  newMessagesSince as newWhatsAppMessagesSince,
  readSyncState as readWhatsAppSyncState,
  summarizeSync as summarizeWhatsAppSync,
  syncedThreads as whatsAppSyncedThreads,
  type RawMessage as RawWhatsAppMessage,
  // Bridge's OWN data about a subject — no WhatsApp surface is touched.
  WHATSAPP_ANNOTATIONS_NAMESPACE,
  readAnnotationState,
  addTags as addWhatsAppTags,
  removeTag as removeWhatsAppTag,
  addNote as addWhatsAppNote,
  removeNote as removeWhatsAppNote,
  listAnnotations as listWhatsAppAnnotations,
  tagCounts as whatsAppTagCounts,
  // Bridge's own action log, and its analytics rollup.
  WHATSAPP_AUDIT_NAMESPACE,
  readAuditState,
  appendAuditEvent,
  auditEventFromOutcome,
  listAuditEvents,
  summarizeAudit,
  type AuditEvent as WhatsAppAuditEvent,
  type AuditEventKind as WhatsAppAuditEventKind,
  // v2 automation: rules, schedule, assignment. All Local Plane, none of it a
  // send path — a rule starts an Agent Run and the outbound gate still speaks.
  WHATSAPP_AUTOMATION_NAMESPACE,
  assignmentLedgerOf as whatsAppAssignmentLedger,
  ruleLedgerOf as whatsAppRuleLedger,
  scheduleLedgerOf as whatsAppScheduleLedger,
  withLedgers as whatsAppWithLedgers,
  emptyAutomationState as emptyWhatsAppAutomationState,
  readAutomationState as readWhatsAppAutomationState,
  addRule as addWhatsAppRule,
  deleteRule as deleteWhatsAppRule,
  draftAutomationRule as draftWhatsAppRule,
  planAutomationRun as planWhatsAppAutomationRun,
  setRuleEnabled as setWhatsAppRuleEnabled,
  assignAgent as assignWhatsAppAgent,
  unassignAgent as unassignWhatsAppAgent,
  cancelAction as cancelWhatsAppAction,
  cancelActionsForRule as cancelWhatsAppActionsForRule,
  scheduleFromPolicy as scheduleWhatsAppFromPolicy,
  type WhatsAppAutomationState,
  // The Relationship seam: which Person a chat belongs to, and the Signal
  // raised when that question has more than one answer.
  resolveChatLink as resolveWhatsAppChatLink,
  duplicateSignalId as whatsAppDuplicateSignalId,
  possibleDuplicatePayload as whatsAppPossibleDuplicatePayload,
  identityKindOfDedupeKey as whatsAppIdentityKindOfDedupeKey,
  chatsLinkedToPerson as whatsAppChatsLinkedToPerson,
} from "@bridge/whatsapp";
import {
  BUILT_IN_MODULES,
  COMMONS_BUILT_IN_MODULES,
  CITED_ROLE_MODEL_PRACTICE_VERSION,
  DEALPILOT_SOURCE_AUTOMATION_ID,
  DEVPILOT_GITHUB_POLL_AUTOMATION_ID,
  DEVPILOT_REVIEW_PR_AUTOMATION_ID,
  DEVPILOT_SUGGEST_PRACTICE_AUTOMATION_ID,
  DEVPILOT_ANALYZE_ISSUE_AUTOMATION_ID,
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
  LEARNING_RECOMMENDATION_SKILL_ID,
  isModuleRuntimeAutomationId,
  resolveModuleAgentRuntimeId,
  resolveModuleAutomationRuntimeId,
} from "@bridge/module-manifests";
import { assertCommonsEntryContentTrusted } from "./commons-client.js";
import {
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  transcribeAudio,
  VoiceTranscriptionError,
} from "./voice-transcription.js";
import {
  listModuleFiles,
  renameModuleFolder,
  MAX_MODULE_FILE_BYTES,
  ModuleFileContentConflictError,
  ModuleFilesPathError,
  readModuleFileContent,
  replaceModuleFileContent,
  withOrganizationFileOperationLock,
  saveModuleFile,
  OrganizationFilesConflictError,
  OrganizationFilesRecoveryError,
  organizationFilesRoot,
  moduleFilesRoot,
} from "./module-files.js";
import { runModuleBuilder } from "./builder/run.js";
import { BUILDER_AGENT_RUNTIME_ID } from "@bridge/module-manifests";
import { ClaudeSignInRequiredError } from "./chat/claude-code-backend.js";
import { listProviderIds, oauthScopesFor } from "./social/registry.js";

// Syncs the groq key to companion.json so the Rust companion can use STT
// without restart. Mirrors the boot-time sync in wiring.ts.
export function syncGroqKeyToCompanionJson(apiKey: string | null): void {
  const localDir = process.env.BRIDGE_LOCAL_DIR;
  if (!localDir) return;
  try {
    const filePath = join(dirname(localDir), "companion.json");
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(readFileSync(filePath, "utf8") as string); } catch { /* absent */ }
    if (apiKey) { config.groqApiKey = apiKey; } else { delete config.groqApiKey; }
    writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
  } catch { /* best-effort */ }
}

export const t = initTRPC.context<ApiContext>().create();
export type OutreachDraftResult =
  | Proposal
  | {
      id: string;
      status: "already_resolved";
      decision: "approve" | "veto" | "edit" | "auto";
    };
export const outreachDraftsInFlight = new Map<string, Promise<OutreachDraftResult>>();

// M4: server-side OTP proof — userId → expiry epoch ms. verifyPhoneOtp writes,
// saveProfile consumes. Proof is single-use and expires in 10 min.
export const phoneOtpProofs = new Map<string, number>();
export function consumePhoneOtpProof(userId: string): boolean {
  const exp = phoneOtpProofs.get(userId);
  if (!exp || exp < Date.now()) return false;
  phoneOtpProofs.delete(userId);
  return true;
}

export function stableProposalId(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
export function stableOutreachProposalId(key: string): string {
  return stableProposalId(key);
}

export function stableModuleInstallProposalId(organizationId: string, installationId: string): string {
  return stableProposalId(`module-install:${organizationId}:${installationId}`);
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The Module that captured a record. Matches `LocalMessage.source`. */
export const WHATSAPP_SOURCE = "whatsapp";

/** Local state-store namespace holding the per-chat message sync cursors. */
export const WHATSAPP_SYNC_NAMESPACE = "whatsapp:message-sync";

/** Local state-store namespace holding the K2 per-source capture-consent
 * state (@bridge/core learning/capture-consent). Local Plane by residency:
 * consent to use local data lives beside the data it governs, and the
 * public-cloud shell never evaluates it (every `learning.*` procedure is
 * local-only in deployment-boundary.ts). */
export const LEARNING_CAPTURE_CONSENT_NAMESPACE = "learning:capture-consent";

/** Read the current capture-consent state, failing CLOSED: a missing or
 * unreadable row is the default all-off state (the core parser's contract,
 * mutation-checked there). */
export async function readCaptureConsentState(
  wiring: Pick<Wiring, "localPlane">,
  organizationId: string,
): Promise<CaptureConsentState> {
  return readCaptureConsent(
    await wiring.localPlane.state.read(organizationId, LEARNING_CAPTURE_CONSENT_NAMESPACE),
  );
}

/** Local state-store namespace holding the K8 browser domain policy
 * (@bridge/core learning/browser-capture). Local Plane by residency, like
 * the consent state it refines: which domains the owner's browser may
 * report on lives beside the consent that lets it report at all. */

/** Local state-store namespace holding the K11 input-capture denylist
 * (@bridge/core learning/input-capture). Local Plane by residency, like the
 * consent it refines: which apps and domains are never keystroke-captured
 * lives beside the consent that lets capture happen at all. */
export const LEARNING_INPUT_DENYLIST_NAMESPACE = "learning:input-capture-denylist";

/** Read the current input-capture denylist, failing CLOSED to the SEED FLOOR:
 * a missing or malformed row is not "capture everything", it is the seed
 * denylist (password managers and banks still protected). The core parser
 * owns that contract and is mutation-checked there. */
export async function readInputDenylistState(
  wiring: Pick<Wiring, "localPlane">,
  organizationId: string,
): Promise<InputCaptureDenylist> {
  return readInputCaptureDenylist(
    await wiring.localPlane.state.read(organizationId, LEARNING_INPUT_DENYLIST_NAMESPACE),
  );
}

/** K10 E5's own lexical tier — deliberately NOT the shared
 * `hashingTextEmbedder()` (dim 128, id "bridge-hashing-lexical-v1") that
 * LA5 retrieval fusion already has vectors stored under. Reusing that id
 * here would let two different-dimensional vector spaces collide under one
 * id ("different spaces never mix" — retrieval.ts), and 128 buckets is
 * collision-prone for the SHORT 2-3 token texts a rejected claim usually
 * is (`hashingEmbed` genuinely maps "cet" and "ist" to the same bucket at
 * dim 128 — a real collision, not a hypothetical one). A dedicated id and
 * a much larger bucket count make an unrelated short claim colliding with
 * a rejected one astronomically less likely, without touching fusion's
 * existing vectors at all. */
export const REJECTION_LEXICAL_DIM = 4096;
export function rejectionLexicalEmbedder(): TextEmbedder {
  return {
    id: "bridge-rejection-lexical-v1",
    embed: async (texts) => texts.map((text) => hashingEmbed(text, REJECTION_LEXICAL_DIM)),
  };
}

/** K10 E5 — run a rejection-fingerprint operation with the semantic
 * embedder when the LA5 lane has one, falling back to the always-available
 * lexical hashing embedder when the semantic tier errors at runtime (e.g.
 * Ollama down). A human's rejection must never fail because a model server
 * is unreachable; the lexical tier still catches reworded repeats. */
export async function withRejectionEmbedder<T>(
  wiring: Wiring,
  run: (embedder: TextEmbedder) => Promise<T>,
): Promise<T> {
  const semantic = wiring.semanticEmbedder;
  if (semantic) {
    try {
      return await run(semantic);
    } catch {
      // fall through to the lexical tier
    }
  }
  return run(rejectionLexicalEmbedder());
}

/** K10 E5 — the suppression CHECK, unlike a single fingerprint write, must
 * consult every tier a fingerprint could have been written under: a
 * rejection recorded while Ollama was reachable lands under the semantic
 * embedder's id, one recorded while it was down lands under the lexical
 * hashing id, and the daemon can flap between the two rejections in a
 * lineage's history. Checking only "today's" tier would let a same-session
 * tier flip silently un-suppress an already-rejected idea — the lexical
 * tier is always checked (it is always computable), and the semantic tier
 * is checked in addition whenever it is actually reachable right now. */
export async function isSuppressedByRejectionsAnyTier(
  wiring: Wiring,
  text: string,
  scope: { organizationId: string; userId: string },
  nowISO: string,
): Promise<RejectionSuppressionVerdict> {
  const lexical = await isSuppressedByRejections(wiring.memoryStore, rejectionLexicalEmbedder(), text, scope, nowISO);
  if (lexical.suppressed) return lexical;
  const semantic = wiring.semanticEmbedder;
  if (!semantic) return lexical;
  try {
    return await isSuppressedByRejections(wiring.memoryStore, semantic, text, scope, nowISO);
  } catch {
    return lexical;
  }
}

export const LEARNING_BROWSER_POLICY_NAMESPACE = "learning:browser-domain-policy";

/** Read the current browser domain policy, failing CLOSED: a missing or
 * malformed row is the empty capture-nothing policy (the core parser's
 * contract, mutation-checked there). */
export async function readBrowserPolicyState(
  wiring: Pick<Wiring, "localPlane">,
  organizationId: string,
): Promise<ReturnType<typeof readBrowserDomainPolicy>> {
  return readBrowserDomainPolicy(
    await wiring.localPlane.state.read(organizationId, LEARNING_BROWSER_POLICY_NAMESPACE),
  );
}

/**
 * AI Harness K5 (TASK-049): after an approved Google intake proposal has
 * MATERIALIZED, emit metadata-only capture signals under the "google"
 * consent source (flight on, consent explicitly ON — default off).
 *
 * The emission moment is deliberately post-approval, not sync time: the
 * human's approval of the intake row is the warrant for learning from it,
 * and a record the user vetoes never becomes a signal. The envelope mappers
 * (@bridge/core source-emitters) cannot express a thread's snippet/bodies or
 * an event's description — this call site reads ONLY the metadata fields off
 * the approved directive payload, so there is no code path from content to a
 * signal row. Ids are deterministic per SOURCE record, so a reconcile replay
 * or re-approval never duplicates a signal.
 *
 * Failure here is caught and logged, never thrown: the user's approval has
 * already applied, and capture bookkeeping must not turn a materialized
 * decision into an error response. A lost emission self-heals on the next
 * reconcile replay of the same proposal (same deterministic id, still absent).
 */
export async function emitGoogleCaptureSignals(
  wiring: Wiring,
  resolved: Proposal,
): Promise<void> {
  try {
    if (!wiring.learningObservationEnabled) return;
    const ownerUserId =
      resolved.request.onBehalfOf?.type === "user" ? resolved.request.onBehalfOf.id : null;
    if (!ownerUserId) return;
    const organizationId = resolved.request.organizationId;
    const consent = await readCaptureConsentState(wiring, organizationId);
    if (!captureAllowed(consent, "google")) return;
    const out = resolved.output?.proposedOutput as { directive?: IntakeDirective } | undefined;
    const entities = out?.directive?.entities;
    if (!Array.isArray(entities)) return;
    const owner = { organizationId, userId: ownerUserId };
    for (const entity of entities) {
      // Only the Interaction Event row signals — a possible_duplicate Signal
      // or the private Memory copy is not an interaction that happened.
      if (entity.kind !== "event") continue;
      const payload =
        typeof entity.payload === "object" && entity.payload !== null && !Array.isArray(entity.payload)
          ? (entity.payload as Record<string, unknown>)
          : {};
      const subject = typeof payload.subject === "string" ? payload.subject : "";
      const occurredAt = typeof payload.occurredAt === "string" ? payload.occurredAt : null;
      const counterparty = typeof payload.with === "string" && payload.with.length > 0 ? payload.with : null;
      if (!occurredAt) continue;
      const signalId = googleCaptureSignalId(entity.source, entity.sourceRecordId);
      if (await wiring.memoryStore.get(signalId, owner)) continue;
      const scope = { organizationId, userId: ownerUserId };
      const signal =
        entity.source === GMAIL_SOURCE
          ? gmailThreadCaptureSignal(
              {
                threadId: entity.sourceRecordId,
                subject,
                counterpartyEmail: counterparty,
                lastMessageAt: occurredAt,
                ...(entity.taintLabel ? { taintLabel: entity.taintLabel } : {}),
              },
              scope,
              signalId,
            )
          : entity.source === CALENDAR_SOURCE
            ? calendarEventCaptureSignal(
                {
                  eventId: entity.sourceRecordId,
                  summary: subject,
                  startsAt: occurredAt,
                  attendeeEmails: Array.isArray(payload.attendees)
                    ? payload.attendees.filter((email): email is string => typeof email === "string")
                    : counterparty
                      ? [counterparty]
                      : [],
                  ...(entity.taintLabel ? { taintLabel: entity.taintLabel } : {}),
                },
                scope,
                signalId,
              )
            : null;
      if (signal) await recordCaptureSignal(wiring.memoryStore, signal);
    }
  } catch (cause) {
    console.error(
      `K5 google capture emission failed for proposal ${resolved.id} — the approval stands; a reconcile replay will re-attempt`,
      cause,
    );
  }
}

/**
 * Append one row to the WhatsApp audit log, on the LOCAL plane.
 *
 * Deliberately never throws into its caller. The audit log records what Bridge
 * did; it must not become a reason the thing itself fails. A sync that worked
 * and whose audit row was lost is strictly better than a sync that was rolled
 * back because its bookkeeping failed — and the loss is visible, because the
 * log's own `dropped`/window reporting makes a gap legible rather than silent.
 */
export async function recordWhatsAppAudit(
  localPlane: LocalPlane,
  organizationId: string,
  event: WhatsAppAuditEvent,
): Promise<void> {
  try {
    await localPlane.state.update(
      organizationId,
      WHATSAPP_AUDIT_NAMESPACE,
      readAuditState(null),
      (current) => ({
        state: appendAuditEvent(readAuditState(current), event),
        result: null,
      }),
    );
  } catch {
    // Intentionally swallowed — see the note above.
  }
}

// ── WhatsApp automation helpers (TASK-030, ADR-158 under AP-091) ─────────────

/** A rule/assignment subject. The Module owns the meaning; this is the wire. */
export const whatsAppAutomationSubjectSchema = z.object({
  kind: z.enum(["chat", "person"]),
  key: z.string().trim().min(1).max(200),
});

/**
 * The Agents this Module declares, from the manifest.
 *
 * Read from the manifest every time rather than cached in a constant: the
 * manifest is the authority on which Agents exist, and a second copy here is a
 * copy that can drift into offering an Agent that no longer has a capability.
 */
export function whatsAppModuleAgents(): { id: string; name: string }[] {
  const whatsapp = BUILT_IN_MODULES.find((entry) => entry.manifest.name === "whatsapp");
  const agents = whatsapp?.manifest.module?.agents ?? [];
  return agents.map((agent) => ({ id: agent.id, name: agent.name }));
}

/**
 * The named human behind a mutation.
 *
 * An Agent must not author its own automation rules, assign itself to a chat,
 * or cancel the queue it is in. `assignAgent` and `setRuleEnabled` both refuse
 * an unnamed actor on their own, but they cannot tell a person from an Agent —
 * that distinction is server-resolved identity, and it belongs here.
 */
export function requireWhatsAppHuman(identity: { type: string; id: string }): string {
  if (identity.type !== "user") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only a person can author WhatsApp automation, assign an Agent, or cancel a run.",
    });
  }
  return identity.id;
}

/**
 * Read-modify-write the three automation ledgers atomically.
 *
 * One namespace and one reducer, because the writes are genuinely coupled:
 * deleting a rule must also cancel the actions it queued, and both halves
 * landing or neither is the only correct outcome. The reducer is synchronous
 * and side-effect-free, per `LocalStateStore`'s contract — it may be retried
 * after cross-process contention.
 */
export async function whatsAppAutomationUpdate(
  ctx: {
    identity: { id: string };
    wiring: Pick<ApiContext["wiring"], "organizationStore" | "localPlane">;
  },
  reduce: (state: WhatsAppAutomationState) => WhatsAppAutomationState,
): Promise<void> {
  const organizationId = PILOT_ORGANIZATION;
  await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
  await ctx.wiring.localPlane.state.update(
    organizationId,
    WHATSAPP_AUTOMATION_NAMESPACE,
    emptyWhatsAppAutomationState(),
    (current) => {
      const next = reduce(readWhatsAppAutomationState(current));
      return { state: next, result: null };
    },
  );
}

export function moduleInstallationLedgerResourceId(
  organizationId: string,
  installationId: string,
): string {
  return UUID_PATTERN.test(installationId)
    ? installationId
    : stableProposalId(`legacy-module-installation:${organizationId}:${installationId}`);
}

export const SUPPORTED_RELATIONSHIP_CONTRACT = (() => {
  const relationship = BUILT_IN_MODULES.find(
    (candidate) => candidate.manifest.name === "relationship",
  );
  if (!relationship) throw new Error("Relationship built-in manifest is missing");
  const manifest = parseModuleManifest({ module: relationship.manifest });
  return {
    name: manifest.name,
    version: manifest.version,
    canonicalManifest: canonicalizeManifest(manifest),
  };
})();

export function moduleManifestHash(manifest: ModuleManifest): string {
  return `sha256:${createHash("sha256").update(canonicalizeManifest(manifest)).digest("hex")}`;
}

export function isSupportedCitedRoleModelManifest(manifest: ModuleManifest): boolean {
  const capability = manifest.capabilities[0];
  const readPermission = capability?.permissions[0];
  const writePermission = capability?.permissions[1];
  return manifest.name === "cited-role-model-practice"
    && manifest.version === CITED_ROLE_MODEL_PRACTICE_VERSION
    && manifest.kind === "skill"
    && manifest.dependencies.length === 0
    && manifest.capabilities.length === 1
    && manifest.contextProviders.length === 0
    && manifest.module === undefined
    && manifest.blueprint === undefined
    && capability?.id === LEARNING_RECOMMENDATION_SKILL_ID
    && capability.name === "Stage cited role-model practice"
    && capability.version === CITED_ROLE_MODEL_PRACTICE_VERSION
    && capability.capabilityType === "skill"
    && capability.origin === "built_in"
    && capability.audience === "private"
    && capability.permissions.length === 2
    && readPermission?.resourceType === "signal"
    && readPermission.action === "read"
    && readPermission.dataScope === "private"
    && readPermission.egress === false
    && writePermission?.resourceType === "signal"
    && writePermission.action === "write"
    && writePermission.dataScope === "private"
    && writePermission.egress === false
    && capability.connectors.length === 0
    && capability.dependencies.length === 0
    && capability.execution === undefined;
}

export function isSupportedCitedRoleModelInstallation(
  installation: ModuleInstallationRow,
): boolean {
  const { manifest, moduleAttachment } = installation;
  return installation.moduleName === "cited-role-model-practice"
    && installation.moduleVersion === CITED_ROLE_MODEL_PRACTICE_VERSION
    && installation.state === "available"
    && installation.status === "installed"
    && manifest.name === installation.moduleName
    && manifest.version === installation.moduleVersion
    && isSupportedCitedRoleModelManifest(manifest)
    && moduleAttachment?.source === "commons"
    && moduleAttachment.ownerModuleName === "relationship"
    && resolveModuleAgentRuntimeId(
      moduleAttachment.ownerModuleName,
      moduleAttachment.agentId,
    ) === LEARNING_AGENT;
}

export async function currentSupportedRelationshipOwner(
  wiring: Wiring,
  installation: ModuleInstallationRow,
): Promise<ModuleInstallationRow | null> {
  const attachment = installation.moduleAttachment;
  if (!attachment || attachment.ownerModuleName !== SUPPORTED_RELATIONSHIP_CONTRACT.name) {
    return null;
  }
  const ownerModule = await wiring.moduleStore.getAvailable(
    installation.organizationId,
    attachment.ownerModuleName,
  );
  if (
    !ownerModule
    || ownerModule.status !== "installed"
    || ownerModule.moduleName !== SUPPORTED_RELATIONSHIP_CONTRACT.name
    || ownerModule.moduleVersion !== SUPPORTED_RELATIONSHIP_CONTRACT.version
    || ownerModule.manifest.name !== ownerModule.moduleName
    || ownerModule.manifest.version !== ownerModule.moduleVersion
    || canonicalizeManifest(ownerModule.manifest) !== SUPPORTED_RELATIONSHIP_CONTRACT.canonicalManifest
  ) {
    return null;
  }
  return ownerModule;
}

export function stableDealPilotCaptureProposalId(organizationId: string, captureId: string): string {
  return stableProposalId(`dealpilot-capture:${organizationId}:${captureId}`);
}

export function isDealPilotCaptureProposal(
  entry: LedgerEntry,
  organizationId: string,
  captureId: string,
): boolean {
  if (
    entry.id !== stableDealPilotCaptureProposalId(organizationId, captureId) ||
    entry.organizationId !== organizationId ||
    entry.actorType !== "user" ||
    entry.action !== "write" ||
    entry.resourceType !== "module" ||
    entry.refLedgerId !== undefined ||
    typeof entry.inputs !== "object" ||
    entry.inputs === null ||
    Array.isArray(entry.inputs)
  ) {
    return false;
  }
  const inputs = entry.inputs as Record<string, unknown>;
  return (
    inputs.kind === "dealpilot_capture_commit" &&
    inputs.captureId === captureId
  );
}

/**
 * Translate `NonPilotOrganizationError` → `TRPCError({code:"FORBIDDEN"})` in ONE place
 * (a middleware every procedure below runs through) rather than repeating the
 * `IntegrationFloorScopeError`/`AlreadyResolvedError` try/catch pattern at every one
 * of the dozen-plus call sites that now call `assertPilotOrganization`. The typed error
 * is still the thing procedures throw (matching the existing pattern); only the
 * translation step is centralized to avoid duplicating the same three-line catch
 * block everywhere.
 */
export const withPilotOrganizationGuard = t.middleware(async ({ next }) => {
  const result = await next();
  // tRPC v11's `next()` does NOT throw when the resolver throws — `callRecursive`
  // catches it internally (converting it to a generic TRPCError via
  // `getTRPCErrorFromUnknown`, which loses the original error's identity) and
  // RETURNS `{ ok: false, error }` instead. A try/catch around `next()` here would
  // never fire; the result's `.ok`/`.error` must be checked explicitly, and the
  // ORIGINAL cause (not the already-generic-wrapped `error`) is what still carries
  // the real `NonPilotOrganizationError` instance, via `error.cause`.
  if (!result.ok && result.error.cause instanceof NonPilotOrganizationError) {
    throw new TRPCError({ code: "FORBIDDEN", message: result.error.cause.message });
  }
  return result;
});

export const requireAuthenticatedIdentity = t.middleware(async ({ ctx, next }) => {
  const persistent = ctx.wiring.persistent || process.env.NODE_ENV === "production";
  const allowed = ctx.authenticated || (!ctx.verifying && !persistent);
  if (!allowed) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "authentication required: verified authentication is required because this deployment verifies identities (or persists data), " +
        "but the request presented no verified credentials",
    });
  }
  if (ctx.verifying && ctx.identity.id !== ctx.wiring.pilotUserId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This Supabase account is not approved for the pilot Organization",
    });
  }
  return next();
});

export const enforcePublicCloudBoundary = t.middleware(
  async ({ ctx, path, next }) => {
    if (
      ctx.wiring.publicCloudOnly &&
      !isPublicCloudProcedureAllowed(path)
    ) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "This operation requires the desktop Local Plane and is unavailable from the public cloud API",
      });
    }
    return next();
  },
);

// All non-public procedures require a verified identity on hosted/persistent
// deployments. Helpdesk's token-capability surface is the sole public router.
export const procedure = t.procedure
  .use(requireAuthenticatedIdentity)
  .use(enforcePublicCloudBoundary)
  .use(withPilotOrganizationGuard);
export const authenticatedProcedure = t.procedure
  .use(requireAuthenticatedIdentity)
  .use(enforcePublicCloudBoundary)
  .use(withPilotOrganizationGuard);
export const publicProcedure = t.procedure
  .use(enforcePublicCloudBoundary)
  .use(withPilotOrganizationGuard);

/**
 * TASK-010 (docs/raw/ui-architecture-rules-2026-07.md §5d) — the anchor a Red
 * Flag targets. Mirrors glossary's "Flag target stores Module, Database/
 * Record/Field or File/Result/bullet anchor": `recordId`+`fieldId` addresses a
 * data cell; `bulletPath` addresses a rendered bullet within a Record/Page
 * section or a File/Result (a stable per-item key, the same convention
 * local field edits used, e.g. "s2.b1" or "fit.strength.0"). At least one of recordId/fileId/
 * bulletPath is required so a flag always has a concrete target.
 */
/**
 * TASK-010 (docs/raw/ui-architecture-rules-2026-07.md §5d) — the anchor a Red
 * Flag targets, DISCRIMINATED so a "cell" and a "bullet" (and within bullet,
 * a record/file/result target) can never collide even when some fields
 * coincidentally share a string value across two genuinely different
 * targets (review remediation item 5). `databaseId` on a cell anchor is the
 * concrete Database/table identity (e.g. `TableSpec.id`, "jobpilot.jobs") —
 * NEVER conflated with the coarser `moduleId` grouping.
 */
export interface RedFlagCellAnchor {
  kind: "cell";
  moduleId: string;
  databaseId: string;
  recordId: string;
  fieldId: string;
}
export interface RedFlagBulletAnchor {
  kind: "bullet";
  moduleId: string;
  target:
    | { type: "record"; recordId: string }
    | { type: "file"; fileId: string }
    | { type: "result"; resultId: string };
  bulletPath: string;
}
export type RedFlagAnchor = RedFlagCellAnchor | RedFlagBulletAnchor;

export const redFlagAnchorInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cell"),
    moduleId: z.string().min(1),
    databaseId: z.string().min(1),
    recordId: z.string().min(1),
    fieldId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("bullet"),
    moduleId: z.string().min(1),
    target: z.discriminatedUnion("type", [
      z.object({ type: z.literal("record"), recordId: z.string().min(1) }),
      z.object({ type: z.literal("file"), fileId: z.string().min(1) }),
      z.object({ type: z.literal("result"), resultId: z.string().min(1) }),
    ]),
    bulletPath: z.string().min(1),
  }),
]);

/** TASK-010 review round-5 item 6 — every known ALIAS for the same real
 * module must normalize to ONE canonical spelling BEFORE an anchor is
 * hashed into its lineage key: `moduleIdFromDatabaseId("jobpilot.jobs")`
 * yields `"jobpilot"` while another caller could use the manifest name
 * `"job-pilot"` —
 * two DIFFERENT strings for the SAME real module would silently split one
 * real-world cell/bullet's correction history into two independent,
 * non-colliding lineages depending on which caller's spelling happened to
 * construct the anchor. Same issue for DealPilot's underlying node type
 * `"record"` vs. the module name `"dealpilot"`, and `"person"`/
 * `"people"`, `"community"`/`"communities"`. `validateAnchorTarget`
 * switches on the SAME canonical form this produces, so both are always
 * kept in lockstep. */
export function canonicalModuleId(moduleId: string): string {
  switch (moduleId) {
    case "job-pilot":
      return "jobpilot";
    case "record":
      return "dealpilot";
    case "people":
      return "person";
    case "communities":
      return "community";
    default:
      return moduleId;
  }
}

/** Deterministic string encoding of an anchor — NUL-separated (`\u0000` can
 * never appear in ordinary field values) so no combination of field values
 * across two DIFFERENT anchor shapes can ever produce the same string
 * (review item 5's "file-only/result-only anchors must not collide").
 * `moduleId` is normalized through `canonicalModuleId` FIRST (review
 * round-5 item 6) so an alias never forks a target's lineage in two. */
export function canonicalAnchorString(anchor: RedFlagAnchor): string {
  const moduleId = canonicalModuleId(anchor.moduleId);
  if (anchor.kind === "cell") {
    return ["cell", moduleId, anchor.databaseId, anchor.recordId, anchor.fieldId].join("\u0000");
  }
  const targetKey =
    anchor.target.type === "record" ? anchor.target.recordId :
    anchor.target.type === "file" ? anchor.target.fileId :
    anchor.target.resultId;
  return ["bullet", moduleId, anchor.target.type, targetKey, anchor.bulletPath].join("\u0000");
}

/**
 * A stable, valid-UUID lineage key derived from the canonical anchor string.
 * `memories.subject_record_id` is a `uuid` column (schema.ts) — this lets
 * `MemoryStore.casSupersede`'s lineage-uniqueness contract (organizationId,
 * ownerUserId, lineageKey === subjectRecordId) work WITHOUT a new "lineage
 * key" schema column (review item 4's "extend MemoryStore... if necessary"
 * is satisfied by reusing this existing, indexed column). Not
 * cryptographically sensitive — only needs to be deterministic and
 * collision-resistant for a bounded per-organization anchor space, which
 * SHA-256 easily provides.
 */
export function anchorLineageKey(anchor: RedFlagAnchor): string {
  return deterministicUuid(`redflag-anchor:${canonicalAnchorString(anchor)}`);
}

/** Deterministic, valid-shape UUID from an arbitrary seed string (SHA-256,
 * version/variant bits forced so every consumer sees a well-formed UUID).
 * Used for the anchor lineage key above AND for TASK-010's idempotency keys
 * (review item 3) — the SAME client-supplied `operationId` always derives
 * the SAME Memory/Task/Proposal id, so a retried request converges rather
 * than duplicating rows. Exported (alongside `anchorLineageKey` above) ONLY
 * so tests can precisely reconstruct an in-flight saga's intermediate
 * state (e.g. "the ledger append succeeded but the outcome CAS never ran")
 * without needing a real, hard-to-trigger-on-demand process crash. */
import { deterministicUuid } from "./deterministic-uuid.js";
import { fusedChatMemory } from "./retrieval-fusion.js";
import { RETRIEVAL_EVAL_CAPABILITY_ID } from "./retrieval-eval.js";
export { deterministicUuid };

/**
 * Monotonically increasing ISO timestamp — used for EVERY red-flag Memory
 * write instead of leaving `createdAt` to the store's own `defaultNow()`.
 * Postgres/pglite's `now()` has only millisecond resolution, and a single
 * saga (`create`'s step-1 write immediately followed by its outcome write,
 * or `reopen`'s reset row immediately followed by its own fresh outcome)
 * routinely issues two writes within the SAME millisecond — verified by a
 * real repro during development. The keyset `history`/`listAll` ordering's
 * tie-break then falls to `id`, which has no causal relationship to
 * insertion order once one side is a content-hash-derived id (step 1's
 * deterministic `memoryId`) rather than a time-ordered `uuidv7` — a real,
 * observed bug (the internal "none" row could sort AFTER its own
 * "proposed" successor). This closes the gap without a schema migration:
 * process-local monotonicity is sufficient since every write in one
 * lineage's saga happens on this same server process/request.
 *
 * KNOWN, DOCUMENTED LIMITATION, NARROWED (review round-5/7 — "durable
 * lineage ordering"): this counter is still PROCESS-LOCAL and remains in
 * use for `createdAt` itself (every Memory row still needs a real
 * timestamp, and cross-LINEAGE global listings — e.g. the red-flag audit
 * `flags` list — still order by `(created_at, id)`, for which a per-lineage
 * revision is meaningless — see `MemoryQuery.orderBy`'s doc). What IS now
 * fixed (post-TASK-008-RM4 migration `0016`): `memories.lineage_revision`
 * is allocated atomically inside `casSupersede`'s own SERIALIZABLE
 * transaction, scoped to `(organization_id, owner_user_id,
 * subject_record_id)` — correct across any number of processes/restarts.
 * `history`'s single-lineage keyset order now uses
 * `orderBy: "lineageRevision"` (`(lineage_revision, id)`) instead of
 * `(created_at, id)`, closing the exact gap this comment used to describe
 * as blocked. This function/counter is UNCHANGED and still needed for
 * `createdAt` and for any ordering that spans more than one lineage.
 */
export let lastIssuedRedFlagTimestampMs = 0;
export function monotonicRedFlagNowISO(): string {
  const now = Date.now();
  lastIssuedRedFlagTimestampMs = now > lastIssuedRedFlagTimestampMs ? now : lastIssuedRedFlagTimestampMs + 1;
  return new Date(lastIssuedRedFlagTimestampMs).toISOString();
}

export type LearningMemoryContent =
  | { kind: "onboarding_preference"; figure: string; admiredFor: string }
  | { kind: "reflection_schedule"; dueAt: string; status: "scheduled" | "snoozed" | "paused" | "skipped" }
  | { kind: "trust_capture"; appName: string; bundleId?: string; capturedAt: string }
  | {
      kind: "red_flag";
      anchor: RedFlagAnchor;
      /** The rendered value/version AT FLAG TIME (glossary) — lets Learning/UI
       * detect "the underlying value already changed since this flag." */
      renderedValue: string;
      renderedVersion?: string;
      reason?: string;
      status: "open" | "cleared";
      /** "none" until the governed learning step (see redFlag.create) is
       * attempted; "proposed" once it stages successfully, awaiting review;
       * "applied" once the owner has approved AND enacted the correction
       * (`redFlag.enactCorrection`); "dismissed" once the proposal was
       * vetoed/withdrawn OR the owner explicitly revoked an applied
       * correction (`redFlag.revokeCorrection`) — either way, no longer
       * actionable; "failed" if the governed step itself errored (the
       * CORRECTION still stands — only the learning step failed, and it is
       * retryable via a fresh `create`/`reopen`). */
      learningStatus: "none" | "proposed" | "failed" | "applied" | "dismissed";
      /** The governed proposal's ledger id, once learningStatus leaves
       * "none" — lets a Human jump straight to its Approvals review row.
       * PRIVACY (review item 2): the ledger row itself never carries this
       * flag's anchor/renderedValue/reason — only this opaque reference. */
      proposalId?: string;
      /** The private PreferenceAdjustment Memory this flag's governed step
       * synthesized (review round-4 item 1) — opaque back-reference, owner-
       * scoped, never exposed to the organization-wide ledger. */
      preferenceAdjustmentId?: string;
      /** Set only when learningStatus === "failed" — why the governed step
       * didn't start, never implying the correction itself failed. */
      learningFailureReason?: string;
    }
  | {
      kind: "preference_adjustment";
      /** Evidence back-reference — the red_flag Memory this was synthesized
       * from (owner-authorized read; see `synthesizePreferenceAdjustment`). */
      flagMemoryId: string;
      /** SAME anchor the originating flag targets — this record's scope+
       * target (review round-4 item 1: "scope, target, proposed change,
       * rationale/evidence ref"). */
      anchor: RedFlagAnchor;
      /** The concrete corrective action a Human approval would enact.
       * Intentionally the ONE safe, generic action derivable from a flag
       * without inventing an unverified replacement value out of free-text
       * `reason` — "this specific rendered value is wrong; withhold it from
       * display once enacted" (`redFlag.enactCorrection`), reversible via
       * `redFlag.revokeCorrection`. */
      proposedChange: { type: "suppress_value" };
      rationale: string;
      /** The ledger proposal id this was staged under (opaque back-ref, the
       * inverse of `red_flag.proposalId`). */
      proposalId: string;
      /** "proposed" (awaiting Human review) -> "applied" (owner approved +
       * enacted — the ONLY state where `redFlag.create`'s described display
       * suppression actually takes visible effect) -> "revoked" (terminal —
       * clear/forget/an explicit owner revoke; never re-enactable, review
       * round-4 item 1: "clear/forget/revoke must prevent later
       * enactment"). */
      status: "proposed" | "applied" | "revoked";
      appliedAt?: string;
      revokedAt?: string;
    };

export function parseLearningMemory(content: string): LearningMemoryContent | null {
  try {
    const parsed = JSON.parse(content) as LearningMemoryContent;
    return parsed?.kind === "onboarding_preference" ||
      parsed?.kind === "reflection_schedule" ||
      parsed?.kind === "trust_capture" ||
      parsed?.kind === "red_flag" ||
      parsed?.kind === "preference_adjustment"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function isRedFlagContent(value: LearningMemoryContent | null): value is Extract<LearningMemoryContent, { kind: "red_flag" }> {
  return value?.kind === "red_flag";
}

export function isPreferenceAdjustmentContent(value: LearningMemoryContent | null): value is Extract<LearningMemoryContent, { kind: "preference_adjustment" }> {
  return value?.kind === "preference_adjustment";
}

/** TASK-010 review round-5 item 1 — the legacy onboarding Memory kinds
 * `onboarding.learningState`/`forgetMemory` are allowed to read/delete.
 * Deliberately excludes `red_flag`/`preference_adjustment`: those are
 * private correction evidence that must only ever be read/deleted through
 * the owner-scoped `redFlag.*` surface (which withdraws/revokes the linked
 * governed proposal before deleting — a bare Memory delete never does). */
export type LegacyOnboardingMemoryContent = Extract<LearningMemoryContent, { kind: "onboarding_preference" | "reflection_schedule" | "trust_capture" }>;
export function isLegacyOnboardingContent(value: LearningMemoryContent | null): value is LegacyOnboardingMemoryContent {
  return value?.kind === "onboarding_preference" || value?.kind === "reflection_schedule" || value?.kind === "trust_capture";
}

/** Opaque base64url-encoded keyset cursor — `{createdAt, id, lineageRevision}`
 * (review round-4 item 8: total keyset order, immune to a row inserted/
 * superseded between page fetches, unlike the offset this replaced).
 * `lineageRevision` (review round-7) is included so `history`'s single-
 * lineage listing can paginate by the durable per-lineage revision instead
 * of `createdAt` — the cross-lineage `flags` list still orders/paginates by
 * `createdAt` alone and simply ignores the third slot. */
export function encodeRedFlagCursor(row: { createdAt: string; id: string; lineageRevision?: number | null }): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id, row.lineageRevision ?? null]), "utf8").toString("base64url");
}
export function decodeRedFlagCursor(cursor: string | undefined): { createdAt: string; id: string; lineageRevision?: number | null } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
      const lineageRevision = typeof parsed[2] === "number" ? parsed[2] : null;
      return { createdAt: parsed[0], id: parsed[1], lineageRevision };
    }
  } catch {
    /* fall through */
  }
  return undefined;
}


export async function researchPublicFigure(figure: string): Promise<{ title: string; extract: string; url: string }> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: figure,
    gsrlimit: "1",
    prop: "extracts|info",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    format: "json",
    origin: "*",
  });
  const endpoint = new URL("/w/api.php", "https://en.wikipedia.org");
  endpoint.search = params.toString();
  const response = await fetch(endpoint, {
    headers: { "user-agent": "Bridge/0.1 onboarding-research" },
    // This bounded lane never follows a redirect to a caller-controlled or
    // private address. General research remains in TASK-015.
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.url && new URL(response.url).origin !== endpoint.origin) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Public-source research left its allowlisted origin." });
  }
  if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "Public-source research is unavailable." });
  const body = (await response.json()) as {
    query?: { pages?: Record<string, { title?: string; extract?: string }> };
  };
  const page = Object.values(body.query?.pages ?? {})[0];
  if (!page?.title || !page.extract) {
    throw new TRPCError({ code: "NOT_FOUND", message: `No unambiguous public source found for "${figure}".` });
  }
  const article = encodeURIComponent(page.title.replaceAll(" ", "_"));
  const url = new URL(`/wiki/${article}`, "https://en.wikipedia.org").toString();
  return { title: page.title, extract: page.extract.slice(0, 4_000), url };
}

/** Strip `undefined` so exactOptionalPropertyTypes is satisfied at the seam. */
export function cleanOnBehalfOf(
  o: { type: "user" | "team"; id: string; delegationId?: string | undefined } | undefined,
): OnBehalfOf | undefined {
  if (!o) return undefined;
  return { type: o.type, id: o.id, ...(o.delegationId ? { delegationId: o.delegationId } : {}) };
}

export function resolveClientOnBehalfOf(
  identity: { type: ActorType; id: string },
  value: { type: "user" | "team"; id: string; delegationId?: string | undefined } | undefined,
): OnBehalfOf | undefined {
  const onBehalfOf = cleanOnBehalfOf(value);
  if (
    identity.type === "user" &&
    onBehalfOf &&
    (
      onBehalfOf.type !== "user" ||
      onBehalfOf.id !== identity.id ||
      onBehalfOf.delegationId !== undefined
    )
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Human browser actions cannot assert delegation for another owner",
    });
  }
  return onBehalfOf;
}

export function cleanContext(
  c: { type: "record" | "community" | "automation" | "child_agent_run"; id: string; runId?: string | undefined } | undefined,
): RunContext | undefined {
  if (!c) return undefined;
  return { type: c.type, id: c.id, ...(c.runId ? { runId: c.runId } : {}) };
}

/**
 * Interim single-tenant safety fix (All fixes.md Phase 3 item 11a): the platform is
 * single-tenant by construction (`PILOT_ORGANIZATION` baked into `buildWiring()`), but
 * several procedures accepted a `organizationId` param and either silently ignored it
 * (`dealpilot.list`, pre-fix) or never had the param to begin with (`google.*`).
 * Full multi-tenancy is out of scope for this pass (Phase 5, pilot-recruitment-
 * driven) — so instead of threading real per-tenant scoping through every store,
 * every organization-scoped procedure now EXPLICITLY REJECTS any organizationId that isn't
 * the pilot organization, rather than silently proceeding as if it were. This turns a
 * silent cross-tenant leak (if a second organization id were ever passed) into a loud,
 * typed 403 — an honest reflection of "this platform only serves one organization right
 * now," not a promise of real isolation.
 */
export class NonPilotOrganizationError extends Error {
  constructor(readonly organizationId: string) {
    super(`organizationId "${organizationId}" is not the pilot organization — multi-tenancy is not yet supported`);
    this.name = "NonPilotOrganizationError";
  }
}

export function assertPilotOrganization(organizationId: string): void {
  if (organizationId !== PILOT_ORGANIZATION) throw new NonPilotOrganizationError(organizationId);
}

/**
 * AGS1 (TASK-007) real-catalog migration — `stageLearningRecommendation` is a
 * governed Skill now (see wiring.ts's `LEARNING_RECOMMENDATION_SKILL_MANIFEST`),
 * so every `pipeline.propose` call naming it needs a resolved Goal/Task. This
 * find-or-create helper keeps ONE durable Goal per organization (reused across
 * calls — a Goal is a durable intended outcome, not reminted per request) and
 * mints one bounded Task per recommendation request (each recommendation IS
 * its own bounded unit of work), assigned to `LEARNING_AGENT`.
 */
/**
 * AGS1 (TASK-007) shared find-or-create Goal/Task provisioning — a Goal is a
 * durable intended outcome reused across calls (find-or-create by type); a
 * Task is a bounded unit of work minted fresh per call. Shared by every
 * router procedure that must supply a real `goalTaskRef` to a governed Skill.
 */
export async function provisionGoalTask(
  wiring: Wiring,
  organizationId: string,
  goalType: string,
  goalTitle: string,
  taskType: string,
  assignedAgentId: string,
): Promise<{ goalId: string; taskId: string }> {
  const seam = { nextId: () => uuidv7(), nowISO: () => new Date().toISOString() };
  const existingGoals = await wiring.goalTasks.listGoals(organizationId);
  const goal =
    existingGoals.find((g) => g.type === goalType) ??
    (await wiring.goalTasks.createGoal({ organizationId, type: goalType, title: goalTitle }, seam));
  const task = await wiring.goalTasks.createTask({ organizationId, goalId: goal.id, type: taskType, assignedAgentId }, seam);
  return { goalId: goal.id, taskId: task.id };
}

export async function provisionRoleModelRecommendationTask(
  wiring: Wiring,
  organizationId: string,
): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    organizationId,
    LEARNING_ROLE_MODEL_GOAL_TYPE,
    "Role-model deliberate-practice recommendations",
    PRODUCE_RECOMMENDATION_TASK_TYPE,
    LEARNING_AGENT,
  );
}

export async function provisionWebResearchTask(
  wiring: Wiring,
  organizationId: string,
): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    organizationId,
    LEARNING_WEB_RESEARCH_GOAL_TYPE,
    "Rights-approved public web research",
    RESEARCH_PUBLIC_WEB_TASK_TYPE,
    LEARNING_AGENT,
  );
}

/** TASK-028 — one bounded Task per background Research Run. */
export async function provisionResearchRunTask(
  wiring: Wiring,
  organizationId: string,
): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    organizationId,
    LEARNING_RESEARCH_RUN_GOAL_TYPE,
    "Background browser Research Runs",
    RESEARCH_RUN_TASK_TYPE,
    LEARNING_AGENT,
  );
}

export const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const taintOriginSchema = z.object({
  source: z.enum([
    "operator", "human", "system", "signed_import", "screen", "clipboard",
    "sensor", "email", "google", "web", "mcp", "file_import", "memory",
    "cache", "queue", "mixed", "unknown",
  ]),
  ref: z.string().min(1).max(2_048),
  hash: sha256Schema,
  transform: z.string().min(1).max(200),
}).strict();
export const taintLabelSchema = z.object({
  version: z.literal(1),
  trust: z.enum([
    "verified_system",
    "authenticated_human",
    "verified_signed",
    "untrusted",
    "unknown",
  ]),
  source: taintOriginSchema.shape.source,
  sensitivity: z.enum([
    "public",
    "organization",
    "private",
    "restricted",
    "unknown",
  ]),
  instructionRisk: z.enum(["none", "data", "instruction_like", "unknown"]),
  originChain: z.array(taintOriginSchema).max(16),
  originsTruncated: z.boolean(),
  provenanceHash: sha256Schema,
}).strict();
export const webResearchOutputSchema = z.object({
  kind: z.literal("web_research"),
  objective: z.string().min(1).max(500),
  scope: z.object({
    dataScope: z.literal("public"),
    plane: z.literal("cloud"),
    egress: z.literal("tier_1_free_direct_only"),
  }).strict(),
  budget: z.object({
    maxQueries: z.number().int().min(1).max(3),
    maxResults: z.number().int().min(1).max(10),
    maxResponseBytes: z.number().int().min(1_024).max(512 * 1_024),
    maxProviderAttempts: z.number().int().min(1).max(3),
    timeoutMs: z.number().int().min(1_000).max(15_000),
  }).strict(),
  searchQueries: z.array(z.string().min(1).max(160)).min(1).max(3),
  citations: z.array(z.object({
    url: z.string().url().max(2_048),
    publishedAt: z.string().datetime().nullable(),
    summary: z.string().min(1).max(240),
    entities: z.array(z.string().min(1).max(160)).max(32),
    providerId: z.string().min(1).max(100),
    retrievedAt: z.string().datetime(),
    contentHash: sha256Schema,
    quarantine: z.object({
      safe: z.literal(true),
      categories: z.array(z.string().min(1).max(100)).max(32),
      reason: z.string().min(1).max(500),
    }).strict(),
    trustOrigin: z.literal("untrusted_external"),
    taintLabel: taintLabelSchema,
  }).strict()).min(1).max(10),
  warnings: z.array(z.string().max(500)).max(10),
  provenance: z.object({
    providerId: z.string().min(1).max(100),
    providerTier: z.literal(1),
    providerAccess: z.literal("free_direct"),
    providerRequestId: z.string().min(1).max(200),
    termsUrl: z.string().url(),
    privacyUrl: z.string().url().optional(),
    searchedAt: z.string().datetime(),
    responseBytes: z.number().int().nonnegative().max(512 * 1_024),
    contentHash: sha256Schema,
    rights: z.object({
      status: z.literal("verified"),
      verifiedAt: z.string().datetime(),
      sourceUrl: z.string().url(),
      allowedDataScope: z.literal("public"),
      restrictions: z.array(z.string().max(500)).max(20),
    }).strict(),
  }).strict(),
  providerAttempts: z.array(z.object({
    providerId: z.string().min(1).max(100),
    providerTier: z.literal(1),
    providerAccess: z.literal("free_direct"),
    providerHealth: z.enum(["healthy", "unknown", "degraded", "unavailable"]),
    status: z.enum(["succeeded", "unavailable", "degraded"]),
    code: z.enum([
      "unavailable",
      "timeout",
      "rate_limited",
      "degraded",
      "invalid_response",
      "access_blocked",
      "cancelled",
    ]).optional(),
    detail: z.string().min(1).max(500),
  }).strict()).min(1).max(3),
  trustOrigin: z.literal("untrusted_external"),
}).strict();

export async function assertWebResearchModuleBinding(
  wiring: Wiring,
  organizationId: string,
): Promise<void> {
  const installed = await wiring.moduleStore.getAvailable(
    organizationId,
    "relationship",
  );
  const manifest = installed
    ? parseModuleManifest({ module: installed.manifest })
    : null;
  const learningAgent = manifest?.module?.agents.find(
    (agent) =>
      resolveModuleAgentRuntimeId(manifest.name, agent.id) === LEARNING_AGENT,
  );
  const skill = manifest?.capabilities.find(
    (capability) =>
      capability.id === WEB_RESEARCH_SKILL_ID &&
      capability.capabilityType === "skill",
  );
  if (
    installed?.status !== "installed" ||
    installed.moduleAttachment !== undefined ||
    installed.moduleVersion !== SUPPORTED_RELATIONSHIP_CONTRACT.version ||
    manifest === null ||
    canonicalizeManifest(manifest) !==
      SUPPORTED_RELATIONSHIP_CONTRACT.canonicalManifest ||
    !learningAgent?.skillIds.includes(WEB_RESEARCH_SKILL_ID) ||
    !skill ||
    !skill.permissions.some(
      (permission) =>
        permission.resourceType === "external:fetch" &&
        permission.action === "read" &&
        permission.dataScope === "public" &&
        permission.egress,
    )
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The installed Relationship Module does not bind web-research to the Learning Agent",
    });
  }
}

export async function persistWebResearchOutcome(
  wiring: Wiring,
  run: ApiContext["run"],
  identityId: string,
  organizationId: string,
  goalTaskRef: { goalId: string; taskId: string },
  proposal: Proposal,
): Promise<{
  resultId: string;
  memoryId: string;
  eventId: string;
  trustOrigin: "untrusted_external";
}> {
  const parsed = webResearchOutputSchema.safeParse(
    proposal.output?.proposedOutput,
  );
  if (!parsed.success) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "web research completed without a valid quarantined Result; nothing was persisted",
      cause: parsed.error,
    });
  }
  const resultId = proposal.id;
  const taintLabel =
    proposal.output?.taintLabel ??
    labelFromLegacyTrustOrigin(
      proposal.output?.trustOrigin ?? "untrusted_external",
      `web-research-result:${resultId}`,
    );
  const memoryId = run.ids.next();
  const eventId = run.ids.next();
  const content = {
    kind: "web_research_result_memory",
    moduleName: "relationship",
    resultId,
    goalId: goalTaskRef.goalId,
    taskId: goalTaskRef.taskId,
    result: parsed.data,
  };
  await wiring.memoryStore.write({
    id: memoryId,
    organizationId,
    type: "semantic",
    subjectRecordId: goalTaskRef.taskId,
    scope: "private",
    content: JSON.stringify(content),
    sourceRefType: "ledger",
    sourceRefId: resultId,
    confidence: 1,
    trustOrigin: "untrusted_external",
    taintLabel,
    plane: "local",
    createdBy: LEARNING_AGENT,
    ownerUserId: identityId,
    createdAt: run.clock.nowISO(),
  });
  await wiring.graphStore.recordWebResearchResultEvent({
    organizationId,
    userId: identityId,
    eventId,
    resultId,
    memoryId,
    taskId: goalTaskRef.taskId,
    moduleName: "relationship",
    payload: {
      objective: parsed.data.objective,
      citations: parsed.data.citations,
      provenance: parsed.data.provenance,
      providerAttempts: parsed.data.providerAttempts,
    },
    taintLabel,
  });
  return {
    resultId,
    memoryId,
    eventId,
    trustOrigin: "untrusted_external",
  };
}

export interface CommonsSkillInvocation {
  source: "commons";
  installationId: string;
  moduleName: string;
  moduleVersion: string;
  contentHash: string;
  moduleInstallationId: string;
  ownerModuleName: string;
  ownerModuleVersion: string;
  ownerModuleManifestHash: string;
  ownerModuleAgentId: string;
  runtimeAgentId: string;
  capabilityId: string;
}

export const roleModelRecommendationSchema = z.object({
  kind: z.literal("learning_recommendation"),
  title: z.string().min(1),
  summary: z.string().min(1),
  documentedContext: z.string().min(1),
  interpretation: z.string().min(1),
  citation: z.object({
    label: z.string().min(1),
    url: z.string().url(),
  }),
  cadence: z.string().min(1),
  stopCondition: z.string().min(1),
});
export type RoleModelRecommendation = z.infer<typeof roleModelRecommendationSchema>;

export async function stageRoleModelRecommendation(
  wiring: Wiring,
  run: ApiContext["run"],
  identityId: string,
  organizationId: string,
  recommendation: RoleModelRecommendation,
  commonsInvocation?: CommonsSkillInvocation,
) {
  const proposal = await wiring.pipeline.propose(
    {
      organizationId,
      actor: { type: "agent", id: LEARNING_AGENT },
      onBehalfOf: { type: "user", id: identityId },
      action: "write",
      resourceType: "signal",
      dataScope: "private",
      inputs: {
        ...recommendation,
        ...(commonsInvocation ? { commonsInvocation } : {}),
      },
      skill: LEARNING_RECOMMENDATION_SKILL_ID,
      trustOrigin: "untrusted_external",
      taintLabel: joinTaintLabels(
        labelAtSource("web_search", {
          ref: recommendation.citation.url,
          valueHash: hashTaintValue({
            documentedContext: recommendation.documentedContext,
            citation: recommendation.citation,
          }),
          sensitivity: "public",
          instructionRisk: "data",
        }),
        labelAtSource("human_input", {
          ref: `onboarding-role-model:${identityId}`,
          valueHash: hashTaintValue({
            title: recommendation.title,
            summary: recommendation.summary,
            interpretation: recommendation.interpretation,
          }),
          sensitivity: "private",
          instructionRisk: "data",
        }),
      ),
      goalTaskRef: await provisionRoleModelRecommendationTask(wiring, organizationId),
    },
    run,
  );
  return { recommendation, proposal };
}

export async function proposeRoleModelRecommendation(
  wiring: Wiring,
  run: ApiContext["run"],
  identityId: string,
  input: { organizationId: string; figure: string; admiredFor: string },
) {
  const source = await researchPublicFigure(input.figure);
  const recommendation: RoleModelRecommendation = {
    kind: "learning_recommendation",
    title: `Practice ${input.admiredFor} deliberately`,
    summary:
      `Once a week, choose one upcoming decision and write how "${input.admiredFor}" should change ` +
      "your preparation or communication. Review the outcome before repeating it.",
    documentedContext: source.extract.split(/\n|(?<=\.)\s+/).slice(0, 2).join(" "),
    interpretation:
      `The public source documents ${source.title}; the link to "${input.admiredFor}" is your stated preference, not a claim about the person's whole character.`,
    citation: { label: source.title, url: source.url },
    cadence: "weekly",
    stopCondition: "Pause or remove it whenever it stops being useful.",
  };
  const result = await stageRoleModelRecommendation(
    wiring,
    run,
    identityId,
    input.organizationId,
    recommendation,
  );
  const existing = await wiring.memoryStore.retrieve(
    { limit: 100 },
    { organizationId: input.organizationId, userId: identityId },
  );
  if (!existing.some((row) => parseLearningMemory(row.content)?.kind === "onboarding_preference")) {
    await wiring.memoryStore.write({
      id: uuidv7(),
      organizationId: input.organizationId,
      type: "preference",
      scope: "private",
      content: JSON.stringify({
        kind: "onboarding_preference",
        figure: input.figure,
        admiredFor: input.admiredFor,
      }),
      confidence: 1,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: identityId,
      ownerUserId: identityId,
    });
  }
  return result;
}

export async function latestApprovedRoleModelRecommendation(
  wiring: Wiring,
  organizationId: string,
  ownerUserId: string,
): Promise<RoleModelRecommendation | null> {
  const pageSize = 100;
  const maxRows = 1_000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await wiring.ledger.listHistory(organizationId, {
      limit: pageSize,
      offset,
      privateOwnerUserId: ownerUserId,
    });
    for (const entry of page.items) {
      if (
        entry.refLedgerId
        || entry.actorType !== "agent"
        || entry.actorId !== LEARNING_AGENT
        || entry.onBehalfOfType !== "user"
        || entry.onBehalfOfId !== ownerUserId
        || entry.action !== "write"
        || entry.resourceType !== "signal"
        || entry.dataScope !== "private"
        || entry.trustOrigin !== "untrusted_external"
        || typeof entry.inputs !== "object"
        || entry.inputs === null
        || Array.isArray(entry.inputs)
        || "commonsInvocation" in entry.inputs
      ) {
        continue;
      }
      const parsed = roleModelRecommendationSchema.safeParse(entry.inputs);
      if (!parsed.success) continue;
      const citation = new URL(parsed.data.citation.url);
      if (citation.protocol !== "https:" || citation.origin !== "https://en.wikipedia.org") {
        continue;
      }
      const decision = await wiring.ledger.decisionFor(entry.id);
      if (decision?.userDecision === "approve" || decision?.userDecision === "edit") {
        return parsed.data;
      }
    }
    if (offset + page.items.length >= page.total) return null;
  }
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Too many Learning recommendations exist to resolve the approved local source safely",
  });
}

/** AGS1 (TASK-007 closure) — Help Offer drafting is LEARNING_AGENT's Task. */
export async function provisionHelpRequestAnswerTask(wiring: Wiring, organizationId: string): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    organizationId,
    RELATIONSHIP_HELP_ROUTING_GOAL_TYPE,
    "Relationship Help Request routing and Help Offer drafting",
    DRAFT_HELP_OFFER_TASK_TYPE,
    LEARNING_AGENT,
  );
}

/** AGS1 (TASK-007 closure) — a raw human capture is modeled as Learning
 * "observing authorized evidence" (its stated mandate). */
export async function provisionCaptureTask(wiring: Wiring, organizationId: string): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    organizationId,
    RELATIONSHIP_CAPTURE_GOAL_TYPE,
    "Relationship evidence capture",
    STAGE_CAPTURE_TASK_TYPE,
    LEARNING_AGENT,
  );
}

/** TASK-010 review round-4 item 6 — resolve and validate a red-flag anchor's
 * TARGET server-side rather than trusting an unchecked client-supplied
 * string. `moduleId` must be one of the modules this function actually knows
 * how to verify existence for; a record-shaped target (`cell.recordId`,
 * `bullet.target.type === "record"`) is checked against THAT module's own
 * store — never accepted merely because it is a non-empty string — and must
 * belong to `organizationId` (never leaks cross-organization existence: a foreign-
 * organization record and a nonexistent one are indistinguishable, both
 * NOT_FOUND). `file`/`result` bullet targets have no backing existence store
 * yet (no currently-wired bullet surface uses one) — documented, bounded
 * limitation: accepted structurally, not existence-checked, until those
 * stores exist. An unrecognized `moduleId` fails closed rather than being
 * silently accepted as an existence-proof-free anchor. Switches on
 * `canonicalModuleId` (review round-5 item 6) so an alias (`"job-pilot"`,
 * `"record"`, `"people"`, `"communities"`) is validated identically to
 * its canonical spelling — never a SEPARATE, accidentally-more-permissive
 * code path. */
export async function validateAnchorTarget(wiring: Wiring, organizationId: string, viewerUserId: string, anchor: RedFlagAnchor): Promise<void> {
  const recordId = anchor.kind === "cell" ? anchor.recordId : anchor.target.type === "record" ? anchor.target.recordId : null;
  if (recordId === null) return; // file/result — documented limitation above

  switch (canonicalModuleId(anchor.moduleId)) {
    case "jobpilot": {
      const application = await wiring.jobpilotStore.getApplication(recordId, organizationId);
      if (!application) throw new TRPCError({ code: "NOT_FOUND", message: "target record does not exist in this organization" });
      return;
    }
    case "dealpilot": {
      const record = await wiring.graphStore.getRecord(recordId);
      if (!record || record.organizationId !== organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "target record does not exist in this organization" });
      }
      return;
    }
    case "event": {
      const event = await wiring.graphStore.getEvent(organizationId, recordId);
      if (!event) throw new TRPCError({ code: "NOT_FOUND", message: "target record does not exist in this organization" });
      return;
    }
    case "person": {
      const person = await wiring.graphStore.getPerson(organizationId, viewerUserId, recordId);
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "target record does not exist in this organization" });
      return;
    }
    case "community": {
      const community = await wiring.graphStore.getCommunity(organizationId, viewerUserId, recordId);
      if (!community) throw new TRPCError({ code: "NOT_FOUND", message: "target record does not exist in this organization" });
      return;
    }
    default:
      throw new TRPCError({ code: "NOT_FOUND", message: `unrecognized module "${anchor.moduleId}" — cannot validate its target` });
  }
}

/** TASK-010 review round-4 item 2 — a proposal is PRIVATE when its `inputs`
 * carries `visibility: "private"` (set once, at `pipeline.propose` call time
 * — never client-toggleable afterward since `inputs` is immutable ledger
 * content). A private proposal is visible/decidable ONLY to the user it was
 * raised `onBehalfOf` — team-visible semantics are completely unchanged for
 * every OTHER (non-private) proposal shape in this organization. */
export function isPrivateProposalInputs(inputs: unknown): boolean {
  return typeof inputs === "object" && inputs !== null && !Array.isArray(inputs) && (inputs as Record<string, unknown>).visibility === "private";
}

export function isProposalVisibleTo(proposal: { request: { inputs: unknown; onBehalfOf?: { id: string } } }, viewerId: string): boolean {
  if (!isPrivateProposalInputs(proposal.request.inputs)) return true;
  return proposal.request.onBehalfOf?.id === viewerId;
}

/** TASK-010 review round-4 item 1 — resolves the flag's own evidence Memory
 * UNDER OWNER AUTHORIZATION (a scoped `memoryStore.get`, never a bypass) and
 * synthesizes it into a real, structured, owner-private PreferenceAdjustment
 * record — scope+target (the anchor), a concrete proposed change, a
 * rationale, and this evidence back-reference — rather than the governed
 * step being a no-op echo of its own opaque ledger inputs. Idempotent create
 * via `casSupersede`/`expectedCurrentId: null`: a retry that reaches this a
 * second time (the lineage already exists) fetches the existing row instead
 * of throwing a duplicate-id error. */
export async function synthesizePreferenceAdjustment(
  wiring: Wiring,
  organizationId: string,
  ownerId: string,
  params: { preferenceAdjustmentId: string; flagMemoryId: string; anchor: RedFlagAnchor; reason: string | undefined; proposalId: string },
): Promise<MemoryEntry> {
  const evidence = await wiring.memoryStore.get(params.flagMemoryId, { organizationId, userId: ownerId });
  if (!evidence) {
    throw new Error("cannot synthesize a preference adjustment: the flagged evidence is not readable under owner authorization");
  }
  const rationale = params.reason?.trim() || "Owner flagged this value as incorrect without additional detail.";
  const content: LearningMemoryContent = {
    kind: "preference_adjustment",
    flagMemoryId: params.flagMemoryId,
    anchor: params.anchor,
    proposedChange: { type: "suppress_value" },
    rationale,
    proposalId: params.proposalId,
    status: "proposed",
  };
  const created = await wiring.memoryStore.casSupersede({
    organizationId,
    ownerUserId: ownerId,
    lineageKey: params.preferenceAdjustmentId,
    expectedCurrentId: null,
    next: {
      id: params.preferenceAdjustmentId,
      organizationId,
      type: "preference",
      subjectRecordId: params.preferenceAdjustmentId,
      scope: "private",
      content: JSON.stringify(content),
      sourceRefType: "feedback",
      trustOrigin: "user_content",
      confidence: 1,
      plane: "local",
      createdBy: ownerId,
      ownerUserId: ownerId,
      createdAt: monotonicRedFlagNowISO(),
    },
  });
  if (created) return created;
  const existing = await wiring.memoryStore.currentForLineage(organizationId, ownerId, params.preferenceAdjustmentId);
  if (!existing) throw new Error("preference adjustment lineage disappeared between create and re-read");
  return existing;
}

/** TASK-010 (review remediation item 3 — saga/idempotency) — one durable
 * Goal for the organization's platform red-flag learning, one bounded Task per
 * flag-create OPERATION (not per call): `taskId` is caller-supplied and
 * deterministic from the client's idempotency key, so a retried `create`
 * reuses the SAME Task instead of accumulating one per attempt. Unlike the
 * generic `provisionGoalTask` helper (which always inserts a fresh Task),
 * this checks for an existing Task at that id FIRST and is safe against the
 * persistent adapter's unique-id constraint racing a concurrent retry too.
 *
 * Review round-5 item 10 — the Goal lookup itself was NOT race-safe: it
 * used `listGoals` + `.find(...)`, a check-then-act pattern with a
 * NON-deterministic Goal id (`createGoal` fell back to a random
 * `seam.nextId()`). Two genuinely concurrent callers (different processes,
 * e.g. two API server instances handling two retries of the same flag-
 * create at once) could BOTH see no matching Goal yet and BOTH insert a
 * SEPARATE one — either silently duplicating the organization's "platform
 * red-flag learning" Goal, or throwing an unhandled unique-constraint error
 * if one ever gets added. The Goal id is now DETERMINISTIC (one per
 * organization, derived the same way every other red-flag id in this file is)
 * and looked up by that EXACT id via `getGoal` — mirroring the Task logic
 * immediately below: check first, then create with a catch-and-recheck
 * fallback so a losing concurrent insert recovers to the WINNER's Goal
 * rather than erroring. */
export async function provisionRedFlagLearningTask(
  wiring: Wiring,
  organizationId: string,
  taskId: string,
): Promise<{ goalId: string; taskId: string }> {
  const seam = { nextId: () => uuidv7(), nowISO: () => new Date().toISOString() };
  const goalId = deterministicUuid(`redflag-learning-goal:${organizationId}`);
  let goal = await wiring.goalTasks.getGoal(organizationId, goalId);
  if (!goal) {
    try {
      goal = await wiring.goalTasks.createGoal(
        { id: goalId, organizationId, type: PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE, title: "Platform red-flag correction learning" },
        seam,
      );
    } catch (err) {
      // A concurrent call (a different process/instance provisioning the
      // SAME organization's Goal at once) may have created it between our
      // check above and this insert — re-check rather than propagating a
      // duplicate-key error as a genuine failure (review round-5 item 10:
      // "treat as CAS loss/reconcile, not 500").
      const retryGoal = await wiring.goalTasks.getGoal(organizationId, goalId);
      if (!retryGoal) throw err;
      goal = retryGoal;
    }
  }
  const existingTask = await wiring.goalTasks.getTask(organizationId, taskId);
  if (existingTask) return { goalId: goal.id, taskId: existingTask.id };
  try {
    const task = await wiring.goalTasks.createTask(
      { id: taskId, organizationId, goalId: goal.id, type: PROPOSE_PREFERENCE_ADJUSTMENT_TASK_TYPE, assignedAgentId: LEARNING_AGENT },
      seam,
    );
    return { goalId: goal.id, taskId: task.id };
  } catch (err) {
    // A concurrent retry (same idempotency key) may have created it between
    // our check above and this insert — re-check rather than propagating a
    // duplicate-key error as a genuine failure.
    const retryFetch = await wiring.goalTasks.getTask(organizationId, taskId);
    if (retryFetch) return { goalId: goal.id, taskId: retryFetch.id };
    throw err;
  }
}

/** TASK-010 (review remediation item 2 — ledger privacy/withdrawal). Clear
 * and forget both call this so a still-pending governed proposal citing a
 * withdrawn/deleted flag can never later be approved into an actual
 * preference/ranking change. Swallows `AlreadyResolvedError`/
 * `NotPendingProposalError` — those mean "nothing left to withdraw," not a
 * failure of the withdrawal itself. Any actor authorized to clear/forget
 * their OWN flag may veto its own cited proposal — the same authority model
 * every other `action.decide` call in this router already uses (no
 * additional gate is invented here).
 *
 * Review round-5 item 4 — a CONFIRMED-ABSENT ledger entry (checked directly,
 * never inferred) must ALSO resolve as "already withdrawn," not an error:
 * `pipeline.decide` throws a bare `Error` (not one of the two typed
 * exceptions above) for an id the ledger has never seen at all. That is
 * exactly the shape a flag from BEFORE this fix could still carry (a
 * `proposalId` persisted despite the governed step having thrown before ever
 * reaching ledger append) — this makes clear/forget/reopen tolerant of that
 * historical shape instead of throwing an unhandled 500 on it. */
export async function withdrawPendingRedFlagProposal(wiring: Wiring, run: RunCtx, proposalId: string, actorId: string): Promise<void> {
  const entry = await wiring.ledger.get(proposalId);
  if (!entry) return; // confirmed absent — nothing was ever pending, treat as already withdrawn
  try {
    await wiring.pipeline.decide(proposalId, "veto", { type: "user", id: actorId }, run, undefined, "Red flag correction withdrawn by its owner");
  } catch (err) {
    if (err instanceof AlreadyResolvedError || err instanceof NotPendingProposalError) return;
    throw err;
  }
}

/** TASK-010 review round-4 item 1 — permanently blocks a preference
 * adjustment from ever being (re-)enacted, called by `clear`/`forget`
 * (whether the underlying proposal is still pending OR was already
 * approved+applied) so a withdrawn/deleted flag's correction can never take
 * effect later. Idempotent: a lineage already `"revoked"` is left alone. */
export async function revokePreferenceAdjustmentPermanently(
  wiring: Wiring,
  organizationId: string,
  ownerId: string,
  preferenceAdjustmentId: string,
): Promise<void> {
  // `preferenceAdjustmentId` is the STABLE lineage key (its own original
  // id) — `currentForLineage` must be used to resolve whatever it has
  // become (e.g. already "applied" by a prior enactCorrection, which
  // supersedes it to a NEW row id), never a plain `.get()` by that original
  // id, which would only ever return the frozen "proposed" row it started
  // as (the exact class of bug review round 3 already caught once for the
  // red-flag lineage itself).
  const current = await wiring.memoryStore.currentForLineage(organizationId, ownerId, preferenceAdjustmentId);
  const value = current && parseLearningMemory(current.content);
  if (!current || !isPreferenceAdjustmentContent(value) || value.status === "revoked") return;
  await wiring.memoryStore.casSupersede({
    organizationId,
    ownerUserId: ownerId,
    lineageKey: current.subjectRecordId!,
    expectedCurrentId: current.id,
    next: {
      ...current,
      id: uuidv7(),
      content: JSON.stringify({ ...value, status: "revoked", revokedAt: new Date().toISOString() } satisfies LearningMemoryContent),
      trustOrigin: "user_content",
      createdBy: ownerId,
      createdAt: monotonicRedFlagNowISO(),
    },
  });
  // A CAS loss here means another concurrent action already moved this
  // lineage forward (e.g. a racing revoke/enact) — not an error; whatever
  // it landed on, it is no longer "proposed"/"applied" under OUR write, and
  // the caller (clear/forget) does not need this call's own return value.
}

/**
 * TASK-010's ONE governed-learning step, shared by `redFlag.create` (seeded
 * by the client's `operationId`) and `redFlag.reopen` (review round-4 item
 * 4: "reopen after veto/withdraw must create a NEW proposal for the new
 * active version" — seeded by the freshly-reopened row's own id, so it
 * NEVER reuses/resurrects a prior, permanently-resolved proposal). Every id
 * this attempts (the governed Task, the ledger proposal, the private
 * PreferenceAdjustment) is deterministically derived from `seed`, so a
 * retry of the SAME logical attempt converges instead of duplicating rows —
 * see the inline comments below for the crash-recovery reconciliation
 * (review item 3).
 */
export async function attemptGovernedLearningStep(
  wiring: Wiring,
  run: RunCtx,
  organizationId: string,
  ownerId: string,
  currentRow: MemoryEntry,
  flagMemoryId: string,
  seed: string,
): Promise<MemoryEntry> {
  const currentValue = parseLearningMemory(currentRow.content);
  if (!isRedFlagContent(currentValue)) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "red flag memory content was not the expected shape" });
  }
  // review round-4 item 3: "failed" must be retryable too — only a
  // successfully-recorded outcome ("proposed"/"applied"/"dismissed") should
  // skip re-attempting the governed step. Leaving "failed" out of this skip
  // list was itself a bug: it made a genuinely failed attempt permanently
  // un-retryable.
  if (currentValue.learningStatus !== "none" && currentValue.learningStatus !== "failed") {
    return currentRow;
  }
  const anchorKey = currentRow.subjectRecordId!;
  const taskId = deterministicUuid(`redflag-task:${seed}`);
  const proposalId = deterministicUuid(`redflag-proposal:${seed}`);
  const preferenceAdjustmentId = deterministicUuid(`redflag-preference:${seed}`);
  let learningStatus: "proposed" | "failed" = "failed";
  let learningFailureReason: string | undefined;
  // TASK-010 review round-5 item 4 — must start `undefined`, NEVER the
  // deterministic `proposalId` guess: that id is only a *candidate* seed for
  // `pipeline.propose`'s own ledger append (or a value to reconcile against
  // an EARLIER attempt's append) — it does not itself prove a ledger row
  // exists. Every branch below sets this ONLY once ledger existence is
  // actually confirmed (the `existingLedgerEntry` check, or the real
  // `Proposal.id` `pipeline.propose` hands back once it has genuinely
  // appended — `#reject`'s rejected-path entry gets its OWN id via
  // `ctx.ids.next()`, never the requested `proposalId`, so `proposal.id` is
  // always the ledger's actual id either way). If `synthesizePreferenceAdjustment`
  // or `pipeline.propose` itself THROWS before returning, nothing was ever
  // confirmed to exist — this must stay `undefined`, or `clear`/`forget`
  // would later try to withdraw a proposal the ledger never actually has.
  let resolvedProposalId: string | undefined;
  let resolvedPreferenceAdjustmentId: string | undefined;

  // review round-4 item 3: reconcile the deterministic proposalId against
  // the ledger BEFORE proposing again. A prior attempt of this SAME seed
  // may have already appended the ledger entry and then crashed before the
  // outcome CAS below ran — without this check, a retry would either
  // re-throw the ledger's own duplicate-id append-only violation
  // (misreported as "failed" even though the proposal genuinely exists and
  // is pending review) or, worse, silently attempt to run the governed
  // Skill a second time. "The proposal already exists" always means "the
  // governed step already succeeded" (a rejected/thrown attempt never
  // reaches append), so recovery is always to "proposed," never "failed."
  const existingLedgerEntry = await wiring.ledger.get(proposalId);
  if (existingLedgerEntry) {
    learningStatus = "proposed";
    resolvedProposalId = proposalId;
    resolvedPreferenceAdjustmentId = (await wiring.memoryStore.currentForLineage(organizationId, ownerId, preferenceAdjustmentId))?.id ?? preferenceAdjustmentId;
  } else {
    try {
      const adjustment = await synthesizePreferenceAdjustment(wiring, organizationId, ownerId, {
        preferenceAdjustmentId,
        flagMemoryId,
        anchor: currentValue.anchor,
        reason: currentValue.reason,
        proposalId,
      });
      resolvedPreferenceAdjustmentId = adjustment.id;

      const goalTaskRef = await provisionRedFlagLearningTask(wiring, organizationId, taskId);
      const proposal = await wiring.pipeline.propose(
        {
          organizationId,
          actor: { type: "agent", id: LEARNING_AGENT },
          onBehalfOf: { type: "user", id: ownerId },
          action: "write",
          resourceType: "signal",
          skill: "learning.proposePreferenceAdjustment",
          trustOrigin: "user_content",
          goalTaskRef,
          // PRIVACY (review item 2): the ledger is a organization-wide-
          // readable audit spine (any member may query pending proposals
          // via action.listPending/decide). It must NEVER carry this
          // flag's anchor/renderedValue/reason/rationale — only OPAQUE,
          // owner-scoped Memory references and a non-sensitive summary.
          // `visibility: "private"` (review round-4 item 2) additionally
          // hides this proposal from every OTHER member's
          // action.listPending/decide entirely — not merely "the detail
          // is opaque," but "only its own owner can even see or resolve
          // it."
          inputs: {
            kind: "red_flag_correction_proposal",
            flagMemoryId,
            preferenceAdjustmentId: resolvedPreferenceAdjustmentId,
            visibility: "private",
            governed: true,
            applied: false,
            summary: "A platform red-flag correction was synthesized into a preference adjustment for governed review.",
          },
        },
        run,
        { proposalId },
      );
      // `proposal.id` is ALWAYS the id the ledger actually used for this
      // append — the deterministic `proposalId` on the success/pending path
      // (options.proposalId), or `ctx.ids.next()` on #reject's rejected
      // path — either way it is now CONFIRMED to exist, safe to persist.
      resolvedProposalId = proposal.id;
      if (proposal.status === "pending_review") {
        learningStatus = "proposed";
      } else {
        learningStatus = "failed";
        learningFailureReason = proposal.rejectionReason ?? `unexpected proposal status "${proposal.status}"`;
      }
    } catch (err) {
      // Nothing reconciled here is confirmed to exist in the ledger —
      // `resolvedProposalId` stays `undefined` (its initialized value).
      learningStatus = "failed";
      learningFailureReason = err instanceof Error ? err.message : String(err);
    }
  }

  // Omit any stale `learningFailureReason` from a prior "failed" attempt
  // this retry is now superseding — `exactOptionalPropertyTypes` forbids
  // setting it to `undefined` explicitly, so it must be left out of the
  // base spread entirely rather than nulled afterward.
  const { learningFailureReason: _staleFailureReason, ...currentValueBase } = currentValue;
  const updated = await wiring.memoryStore.casSupersede({
    organizationId,
    ownerUserId: ownerId,
    lineageKey: anchorKey,
    expectedCurrentId: currentRow.id,
    next: {
      ...currentRow,
      // A FRESH random id, never a deterministic one derived from `seed`:
      // unlike the Memory/proposal/preference-adjustment ids above (each
      // meant to exist EXACTLY ONCE across retries), this row is a VERSION
      // marker for "the outcome as of this attempt" — clear/reopen/
      // updateReason already mint a fresh `uuidv7()` for their own new
      // versions, and this must too. A deterministic id here was a genuine
      // bug an independent review's own repro caught: once one outcome
      // version had been written for a given seed, ANY later attempt that
      // reached this write again (e.g. a "failed" attempt retried into a
      // genuine "proposed" success) collided on the memories table's
      // primary key instead of appending a new version.
      id: uuidv7(),
      content: JSON.stringify({
        ...currentValueBase,
        learningStatus,
        ...(resolvedProposalId ? { proposalId: resolvedProposalId } : {}),
        ...(resolvedPreferenceAdjustmentId ? { preferenceAdjustmentId: resolvedPreferenceAdjustmentId } : {}),
        ...(learningFailureReason ? { learningFailureReason } : {}),
      } satisfies LearningMemoryContent),
      trustOrigin: "user_content",
      createdBy: ownerId,
      createdAt: monotonicRedFlagNowISO(),
    },
  });
  if (!updated) {
    // Another concurrent call (a genuine retry racing itself) already
    // recorded the outcome — re-read rather than erroring.
    const latest = await wiring.memoryStore.currentForLineage(organizationId, ownerId, anchorKey);
    return latest ?? currentRow;
  }
  return updated;
}


export async function provisionOutreachDraftTask(
  wiring: Wiring,
  organizationId: string,
): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    organizationId,
    RELATIONSHIP_OUTREACH_GOAL_TYPE,
    "Relationship outreach drafting",
    DRAFT_OUTREACH_TASK_TYPE,
    OUTREACH_AGENT,
  );
}

/** TASK-011 (JP3B) — one durable culture-research Goal per organization; one bounded
 * research Task per company, assigned to LEARNING_AGENT (the source-gathering half). */
export async function provisionCultureResearchTask(wiring: Wiring, organizationId: string): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    organizationId,
    JOBPILOT_CULTURE_RESEARCH_GOAL_TYPE,
    "JobPilot company-culture research",
    RESEARCH_CULTURE_SOURCE_TASK_TYPE,
    LEARNING_AGENT,
  );
}

/** TASK-011 (JP3B) — the synthesis half, assigned to INTERNAL_STRATEGIST_AGENT,
 * sharing the SAME durable culture-research Goal (one Goal, two Task types). */
export async function provisionCultureSynthesisTask(wiring: Wiring, organizationId: string): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    organizationId,
    JOBPILOT_CULTURE_RESEARCH_GOAL_TYPE,
    "JobPilot company-culture research",
    SYNTHESIZE_CULTURE_PROFILE_TASK_TYPE,
    INTERNAL_STRATEGIST_AGENT,
  );
}

/**
 * SEC-6: a organization-scoped procedure must confirm the caller is actually a MEMBER
 * of the organization, not merely that the id is the pilot organization. `assertPilotOrganization`
 * stays as the first (single-tenancy) layer; this membership check is the second, so
 * the guarantee survives multi-tenancy. `ctx.identity` is server-resolved, never
 * client-asserted. Applied to the membership surface (invite / listMembers / help route)
 * now; extend to every organization-scoped procedure as the test harness seeds member
 * identities for its fixtures (see docs/raw/decisions-log.md, SEC-6).
 */
export async function assertMembership(
  organizationStore: Wiring["organizationStore"],
  organizationId: string,
  userId: string,
): Promise<void> {
  if (!(await organizationStore.isMember(organizationId, userId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `actor "${userId}" is not a member of organization "${organizationId}"`,
    });
  }
}

/**
 * The guard every Organization-scoped procedure used to repeat inline: the
 * single-tenant pilot check and the membership check on `input.organizationId`.
 * Chain it AFTER `.input()` so zod has already validated the shape and the
 * error precedence is exactly what the inline pair produced.
 */
export const organizationGuard = t.middleware(async ({ ctx, input, next }) => {
  const { organizationId } = input as { organizationId: string };
  assertPilotOrganization(organizationId);
  await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
  return next();
});

export const dealpilotProcedure = procedure.use(async ({ ctx, next }) => {
  const authenticationRequired =
    ctx.verifying || ctx.wiring.persistent || process.env.NODE_ENV === "production";
  if (authenticationRequired && !ctx.authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required for DealPilot" });
  }
  await assertMembership(ctx.wiring.organizationStore, PILOT_ORGANIZATION, ctx.identity.id);
  return next();
});

export const devpilotProcedure = procedure.use(async ({ ctx, next }) => {
  const authenticationRequired =
    ctx.verifying || ctx.wiring.persistent || process.env.NODE_ENV === "production";
  if (authenticationRequired && !ctx.authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required for DevPilot" });
  }
  await assertMembership(ctx.wiring.organizationStore, PILOT_ORGANIZATION, ctx.identity.id);
  return next();
});

/**
 * Gate for Settings surfaces that handle raw secrets (today: model-provider API
 * keys). Same authentication + membership floor as `dealpilotProcedure`, plus
 * an explicit Human check — an Agent, Automation, or team principal must never
 * be able to install or remove a credential on the user's behalf, which is the
 * rule `SourceCredentialService` already enforces for DealPilot.
 */
export const credentialSettingsProcedure = procedure.use(async ({ ctx, next }) => {
  const authenticationRequired =
    ctx.verifying || ctx.wiring.persistent || process.env.NODE_ENV === "production";
  if (authenticationRequired && !ctx.authenticated) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "authentication required to manage credentials",
    });
  }
  if (ctx.identity.type !== "user") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only an authenticated Human can manage stored credentials",
    });
  }
  await assertMembership(ctx.wiring.organizationStore, PILOT_ORGANIZATION, ctx.identity.id);
  return next();
});

export function assertModelProviderKeyId(value: string): ModelProviderKeyId {
  if (!isModelProviderKeyId(value)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `"${value}" is not a configurable model provider`,
    });
  }
  return value;
}

/** Key bytes are Local Plane only — the public cloud API refuses to hold them. */
export function assertModelProviderKeyStorage(wiring: Pick<Wiring, "publicCloudOnly">): void {
  if (wiring.publicCloudOnly) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Model-provider API keys are stored on the Bridge desktop app (the Local Plane) and are not accepted by the public cloud API.",
    });
  }
}

export const actionEnum = z.enum(["read", "write", "execute", "share", "archive"]);
export const actorTypeEnum = z.enum(["user", "team", "agent"]);
export const resourceTypeEnum = z.enum([
  "person",
  "community",
  "event",
  "record",
  "automation",
  "module",
  "module_installation",
  "organization_definition",
  "file",
  "signal",
  "policy",
  "policy_param",
  "skill",
  "capability",
  "agent",
  "role",
  "permission",
  "ledger",
  "delegation",
  "integration",
  "network_graph:full",
  "external:send",
  "external:fetch",
]);

/** The access dropdown: which data tier this action/agent/step may touch. */
export const dataScopeEnum = z.enum(["all", "public", "private"]);

/** Shared list-endpoint shape (dealpilot.list/integration.list/action.listPending
 * convention) — organizationId + limit/offset. */
export const paginatedInput = z.object({
  organizationId: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
/** The local-first gate plane an actor runs on. Absent = local (private-first). */
export const planeEnum = z.enum(["local", "cloud"]);

export const actorSchema = z.object({ type: actorTypeEnum, id: z.string().min(1), plane: planeEnum.optional() });
export const onBehalfOfSchema = z.object({
  type: z.enum(["user", "team"]),
  id: z.string().min(1),
  delegationId: z.string().optional(),
});

export const proposeInput = z.object({
  organizationId: z.string().min(1),
  actor: actorSchema,
  onBehalfOf: onBehalfOfSchema.optional(),
  action: actionEnum,
  resourceType: resourceTypeEnum,
  resourceId: z.string().uuid().optional(),
  inputs: z.unknown(),
  skill: z.literal(KERNEL_PASSTHROUGH_SKILL).optional(),
  dataScope: dataScopeEnum.optional(),
  context: z
    .object({
      type: z.enum(["record", "community", "automation", "child_agent_run"]),
      id: z.string().min(1),
      runId: z.string().optional(),
    })
    .optional(),
  seed: z.string().optional(),
  /** AGS1 (TASK-007) — binds this proposal to a resolved Goal/Task assignment.
   * Required only for skills that have a registered SkillManifest; see
   * `PipelineDeps.skillManifests`'s doc comment in @bridge/core's pipeline.ts. */
  goalTaskRef: z.object({ goalId: z.string().min(1), taskId: z.string().min(1) }).optional(),
});

export const decideInput = z.object({
  proposalId: z.string().min(1),
  decision: z.enum(["approve", "veto", "edit"]),
  editedOutput: z.unknown().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  chatThreadId: z.string().uuid().optional(),
  chatTurnId: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  if ((value.chatThreadId === undefined) !== (value.chatTurnId === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "chatThreadId and chatTurnId must be supplied together",
    });
  }
});

export const relationshipNodeTypeEnum = z.enum(["person", "community", "signal", "event"]);
export const relationshipSignalEvidenceInput = relationshipSignalEvidencePayloadSchema
  .omit({ kind: true })
  .extend({
    organizationId: z.string().uuid().transform((value) => value.toLowerCase()),
  });
/** D10 — the View grammar's sort/row-filter shapes, shared by the Blueprint
 * View config (`blueprintViewInput.config` below) and the paginated
 * Relationship list endpoints so a View's server-side query uses the exact
 * same vocabulary its client-side `DataViews` display layer does. */
export const viewSortSpecInput = z.object({ id: z.string(), dir: z.enum(["asc", "desc"]) });
export const viewRowFilterInput = z.object({
  field: z.string(),
  op: z.enum(["contains", "is", "is_not", "is_empty", "is_not_empty", "starts_with"]),
  value: z.string(),
});
export const humanInteractionFieldsSchema = interactionCreateFieldsSchema.omit({
  source: true,
  sourceRecordId: true,
});
export const captureProposalInputSchema = z.object({
  local_media_id: z.string().trim().min(1).max(500),
}).passthrough();
export const captureProposalOutputSchema = z.object({
  type: z.literal("event"),
  text: z.string().trim().min(1).max(5_000),
  local_media_id: z.string().trim().min(1).max(500),
  notes: z.string().max(20_000).optional(),
  link: z.object({
    type: z.enum(["person", "memory", "event"]),
    id: z.string().trim().min(1).max(500),
  }).optional(),
}).passthrough();
export const captureReviewEnvelopeSchema = z.object({
  kind: z.literal("capture_review_envelope"),
  localMediaId: z.string().trim().min(1).max(500),
  ownerUserId: z.string().trim().min(1).max(500),
  capturedAt: z.string().datetime({ offset: true }),
  receivedAt: z.string().datetime({ offset: true }),
  status: z.enum(["staging", "pending_review", "applied", "rejected"]),
  proposalId: z.string().trim().min(1).optional(),
  decisionLedgerId: z.string().trim().min(1).optional(),
});
export const CAPTURE_REVIEW_BODY_SOURCE = "capture-review";

export function isCaptureProposal(proposal: LedgerEntry): boolean {
  return (
    proposal.resourceType === "event" &&
    proposal.dataScope === "private" &&
    captureProposalInputSchema.safeParse(proposal.inputs).success &&
    captureProposalOutputSchema.safeParse(proposal.proposedOutput).success
  );
}

export const captureStageLocks = new Map<string, Promise<void>>();

export async function withCaptureStageLock<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = captureStageLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  captureStageLocks.set(key, current);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (captureStageLocks.get(key) === current) captureStageLocks.delete(key);
  }
}

export async function findPendingCaptureProposal(
  wiring: Wiring,
  organizationId: string,
  ownerUserId: string,
  localMediaId: string,
): Promise<LedgerEntry | null> {
  const pageSize = 100;
  const maxRows = 1_000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await wiring.ledger.listPending(organizationId, {
      limit: pageSize,
      offset,
      privateOwnerUserId: ownerUserId,
    });
    const match = page.items.find((entry) => {
      const parsed = captureProposalInputSchema.safeParse(entry.inputs);
      return parsed.success && parsed.data.local_media_id === localMediaId;
    });
    if (match) return match;
    if (offset + page.items.length >= page.total) return null;
  }
  throw new Error(
    "Capture cannot be staged safely while more than 1,000 proposals await review",
  );
}

export function pendingProposalFromLedger(entry: LedgerEntry): Proposal {
  return {
    id: entry.id,
    status: "pending_review",
    request: {
      organizationId: entry.organizationId,
      actor: { type: entry.actorType, id: entry.actorId, plane: "local" },
      ...(entry.onBehalfOfType && entry.onBehalfOfId
        ? { onBehalfOf: { type: entry.onBehalfOfType, id: entry.onBehalfOfId } }
        : {}),
      action: entry.action,
      resourceType: entry.resourceType,
      ...(entry.resourceId ? { resourceId: entry.resourceId } : {}),
      inputs: entry.inputs,
      skill: "stageCapture",
      ...(entry.dataScope ? { dataScope: entry.dataScope } : {}),
      ...(entry.seed ? { seed: entry.seed } : {}),
    },
    authority: {
      allowed: true,
      reason: "Persisted governed proposal",
      basis: "role",
      dataScope: "private",
    },
    policyResults: entry.policyResults,
    ...(entry.proposedOutput !== undefined
      ? { output: { proposedOutput: entry.proposedOutput } }
      : {}),
  };
}

export async function putCaptureReviewEnvelope(
  wiring: Wiring,
  organizationId: string,
  envelope: z.infer<typeof captureReviewEnvelopeSchema>,
): Promise<void> {
  await wiring.localPlane.bodies.put({
    organizationId,
    source: CAPTURE_REVIEW_BODY_SOURCE,
    sourceRecordId: envelope.localMediaId,
    dataScope: "private",
    content: envelope,
    capturedAt: envelope.receivedAt,
  });
}

export async function getCaptureReviewEnvelope(
  wiring: Wiring,
  organizationId: string,
  localMediaId: string,
): Promise<z.infer<typeof captureReviewEnvelopeSchema> | null> {
  const body = await wiring.localPlane.bodies.get(
    organizationId,
    CAPTURE_REVIEW_BODY_SOURCE,
    localMediaId,
  );
  if (!body) return null;
  return captureReviewEnvelopeSchema.parse(body.content);
}

export function assertPrivateProposalOwner(
  proposal: LedgerEntry,
  identity: { type: ActorType; id: string },
  google: ApiContext["wiring"]["google"],
): void {
  const inputs =
    typeof proposal.inputs === "object" &&
    proposal.inputs !== null &&
    !Array.isArray(proposal.inputs)
      ? proposal.inputs as Record<string, unknown>
      : {};
  const googleProposal =
    "directive" in inputs ||
    inputs.integrationId === google.integrationId ||
    (
      typeof inputs.input === "object" &&
      inputs.input !== null &&
      !Array.isArray(inputs.input) &&
      (inputs.input as Record<string, unknown>).integrationId === google.integrationId
    );
  if (
    (
      isOwnerScopedLedgerEntry(proposal) ||
      isRelationshipMutation(proposal.inputs) ||
      googleProposal
    ) &&
    (
      identity.type !== "user" ||
      relationshipOwnerFromLedger(proposal) !== identity.id ||
      (googleProposal && (
        proposal.organizationId !== google.organizationId ||
        identity.id !== google.ownerUserId
      ))
    )
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
  }
}

export async function assertGoogleIntegrationOwner(
  ctx: Pick<ApiContext, "wiring" | "identity">,
): Promise<void> {
  await assertMembership(
    ctx.wiring.organizationStore,
    ctx.wiring.google.organizationId,
    ctx.identity.id,
  );
  if (
    ctx.identity.type !== "user" ||
    ctx.identity.id !== ctx.wiring.google.ownerUserId
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "integration not found" });
  }
}

export async function proposeRelationshipMutation(
  ctx: Pick<ApiContext, "wiring" | "identity" | "run">,
  organizationId: string,
  payload: RelationshipMutationPayload,
) {
  if (ctx.identity.type !== "user") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Relationship changes require a Human user principal",
    });
  }
  const resourceType =
    payload.kind === "relationship_interaction_create"
      ? "event"
      : payload.kind === "relationship_record_mutation"
        ? payload.recordType
        : payload.kind === "relationship_memory_mutation"
          ? "person"
          : "relation";
  const resourceId =
    payload.kind === "relationship_interaction_create" ||
    payload.kind === "relationship_record_mutation"
      ? payload.recordId
      : payload.kind === "relationship_memory_mutation"
        ? payload.personId
        : payload.kind === "relationship_commitment_mutation"
          ? payload.commitmentId
          : payload.introductionId;
  const action =
    payload.kind === "relationship_record_mutation" &&
    payload.operation === "archive"
      ? "archive"
      : "write";
  const proposal = await ctx.wiring.pipeline.propose(
    {
      organizationId,
      actor: { type: "user", id: ctx.identity.id, plane: "local" },
      action,
      resourceType,
      resourceId,
      inputs: payload,
      skill: "stageMutation",
      dataScope: "private",
      seed: resourceId,
    },
    ctx.run,
  );
  if (proposal.status !== "applied") {
    return {
      proposal,
      materialization: {
        status: proposal.status === "pending_review" ? "pending_approval" as const : "rejected" as const,
      },
    };
  }
  const ledgerEntry = await ctx.wiring.ledger.get(proposal.id);
  if (!ledgerEntry) {
    throw new Error("Applied Relationship proposal has no ledger entry");
  }
  const value = await materializeRelationshipMutation(
    ctx.wiring.graphStore,
    ledgerEntry,
    ledgerEntry,
    ctx.wiring.memoryStore,
  );
  return {
    proposal,
    materialization: { status: "applied" as const, value },
  };
}

/**
 * Archive ONE Relationship Record — the single-Record form, and the only one.
 *
 * TASK-086's constraint: a bulk action obeys the same governance as its
 * single-Record form, never a second thinner write path. Rather than assert
 * that by hand, `archivePerson`, `archiveCommunity` and the bulk
 * `archiveRecords` all call THIS: the ownership check and the governed proposal
 * are written once, so N Records in a bulk call produce N ledger decisions
 * indistinguishable from N separate single calls. There is no batch write for a
 * batch to drift onto.
 */
export async function archiveRelationshipRecord(
  ctx: Pick<ApiContext, "wiring" | "identity" | "run">,
  organizationId: string,
  recordType: "person" | "community",
  id: string,
) {
  const record =
    recordType === "person"
      ? await ctx.wiring.graphStore.getPerson(organizationId, ctx.identity.id, id)
      : await ctx.wiring.graphStore.getCommunity(organizationId, ctx.identity.id, id);
  if (!record?.isOwner) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: recordType === "person" ? "Person not found" : "Community not found",
    });
  }
  const payload = relationshipMutationPayloadSchema.parse({
    kind: "relationship_record_mutation",
    recordType,
    operation: "archive",
    recordId: id,
  });
  return proposeRelationshipMutation(ctx, organizationId, payload);
}

export async function materializeApprovedCapture(
  wiring: Wiring,
  original: LedgerEntry,
  resolved: Proposal,
  run: RunCtx,
): Promise<string> {
  if (resolved.status !== "applied") {
    throw new Error("Capture materialization requires an applied decision");
  }
  const inputs = captureProposalInputSchema.parse(original.inputs);
  const output = captureProposalOutputSchema.parse(
    resolved.output?.proposedOutput,
  );
  if (output.local_media_id !== inputs.local_media_id) {
    throw new Error("Capture review cannot retarget Local Media");
  }
  const ownerUserId = relationshipOwnerFromLedger(original);
  if (!ownerUserId) {
    throw new Error("Capture materialization requires a Human owner");
  }
  const envelope = await getCaptureReviewEnvelope(
    wiring,
    original.organizationId,
    inputs.local_media_id,
  );
  const eventId =
    `capture:${original.organizationId}:${inputs.local_media_id}`;
  if (
    envelope?.status === "applied" &&
    envelope.ownerUserId === ownerUserId &&
    envelope.proposalId === original.id &&
    envelope.decisionLedgerId === resolved.id
  ) {
    return eventId;
  }
  if (
    !envelope ||
    envelope.ownerUserId !== ownerUserId ||
    envelope.localMediaId !== inputs.local_media_id ||
    envelope.proposalId !== original.id ||
    envelope.status !== "pending_review"
  ) {
    throw new Error(
      "Capture materialization requires its owner-bound pending Local metadata envelope",
    );
  }
  const media = await wiring.localMedia.get(inputs.local_media_id);
  if (media && media.organizationId !== original.organizationId) {
    throw new Error("Capture Local Media belongs to a different organization");
  }
  if (media?.status === "archived" || media?.archivedAt) {
    throw new Error("Archived Local Media cannot be materialized");
  }
  if (media?.status === "committed" && media.ledgerId !== resolved.id) {
    throw new Error("Capture Local Media was committed by a different decision");
  }
  const occurredAt = envelope.capturedAt;
  await wiring.localPlane.graph.commitEntity({
    id: eventId,
    organizationId: original.organizationId,
    kind: "event",
    ...(output.link?.type === "person"
      ? { personId: output.link.id }
      : {}),
    payload: {
      interactionKind: "capture",
      subject: output.text,
      occurredAt,
      localMediaId: inputs.local_media_id,
      ...(output.notes ? { notes: output.notes } : {}),
      ...(output.link ? { link: output.link } : {}),
      ownerUserId,
      visibility: "private",
      decisionLedgerId: resolved.id,
    },
    source: "capture",
    sourceRecordId: inputs.local_media_id,
    createdAt: occurredAt,
  });
  if (media && media.status !== "committed") {
    await wiring.localMedia.update(media.id, {
      status: "committed",
      ledgerId: resolved.id,
      linkedEntity: { type: "event", id: eventId },
    });
  }
  await wiring.localPlane.graph.recordExternal({
    organizationId: original.organizationId,
    source: "capture",
    sourceRecordId: inputs.local_media_id,
    entityType: "event",
    entityId: eventId,
    createdAt: run.clock.nowISO(),
  });
  await putCaptureReviewEnvelope(wiring, original.organizationId, {
    ...envelope,
    status: "applied",
    decisionLedgerId: resolved.id,
  });
  return eventId;
}

export async function recordRejectedCapture(
  wiring: Wiring,
  original: LedgerEntry,
  decision: LedgerEntry,
): Promise<void> {
  const inputs = captureProposalInputSchema.parse(original.inputs);
  const ownerUserId = relationshipOwnerFromLedger(original);
  const envelope = await getCaptureReviewEnvelope(
    wiring,
    original.organizationId,
    inputs.local_media_id,
  );
  if (
    !ownerUserId ||
    !envelope ||
    envelope.ownerUserId !== ownerUserId ||
    envelope.proposalId !== original.id ||
    envelope.status !== "pending_review"
  ) {
    throw new Error(
      "Capture rejection requires its owner-bound pending Local metadata envelope",
    );
  }
  await putCaptureReviewEnvelope(wiring, original.organizationId, {
    ...envelope,
    status: "rejected",
    decisionLedgerId: decision.id,
  });
}

export function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function intakeReviewView(
  proposal: Proposal & { createdAt: string },
): {
  proposalId: string;
  source: "gmail" | "google_calendar" | "capture";
  channel: string;
  resource: string;
  match: "ambiguous" | "review";
  reason: string;
  candidateEmail: string | null;
  candidates: Array<{ id: string; name: string | null }>;
  createdAt: string;
} | null {
  const inputs = recordValue(proposal.request.inputs);
  const localMediaId = stringValue(inputs.local_media_id);
  if (localMediaId && stringValue(inputs.kind)) {
    return {
      proposalId: proposal.id,
      source: "capture",
      channel: stringValue(inputs.kind) ?? "Capture",
      resource: "Captured evidence",
      match: "review",
      reason: "Captured evidence requires Human review before it becomes an Event.",
      candidateEmail: null,
      candidates: [],
      createdAt: proposal.createdAt,
    };
  }
  const directive = recordValue(inputs.directive);
  if (!Array.isArray(directive.entities) || !Array.isArray(directive.external)) return null;
  const entities = Array.isArray(directive.entities) ? directive.entities : [];
  const signal = entities
    .map(recordValue)
    .find((entity) => {
      const payload = recordValue(entity.payload);
      return entity.kind === "signal" && payload.type === "possible_duplicate";
    });
  const signalPayload = recordValue(signal?.payload);
  const display = recordValue(inputs.display);
  const external = Array.isArray(directive.external)
    ? directive.external.map(recordValue)[0]
    : undefined;
  const sourceValue = stringValue(external?.source);
  const source = sourceValue === "google:calendar" ? "google_calendar" : "gmail";
  const candidates = Array.isArray(signalPayload.candidates)
    ? signalPayload.candidates
        .map(recordValue)
        .flatMap((candidate) => {
          const id = stringValue(candidate.id);
          if (!id || !z.string().uuid().safeParse(id).success) return [];
          return [{ id, name: stringValue(candidate.name) }];
        })
        .slice(0, 20)
    : [];
  return {
    proposalId: proposal.id,
    source,
    channel: stringValue(display.channel) ?? (source === "gmail" ? "Email" : "Calendar"),
    resource: stringValue(display.resource) ?? "Relationship intake",
    match: signal ? "ambiguous" : "review",
    reason:
      stringValue(signalPayload.reason) ??
      "Sourced Relationship evidence requires Human review before commit.",
    candidateEmail: stringValue(signalPayload.email),
    candidates,
    createdAt: proposal.createdAt,
  };
}

export const outreachDraftInput = z.object({
  organizationId: z.string().min(1),
  sourceId: z.string().trim().min(1).max(500),
  label: z.string().trim().min(1).max(200),
  resource: z.string().trim().min(1).max(500),
  proposed: z.string().trim().min(1).max(20_000),
  channel: z.string().trim().min(1).max(100).optional(),
  prior: z.string().max(20_000).nullable().optional(),
  runId: z.string().trim().min(1).max(500).optional(),
  trace: z.object({
    signals: z.array(z.string().trim().min(1).max(500)).max(50),
    context: z.string().trim().min(1).max(5_000),
    reasoning: z.string().trim().min(1).max(5_000),
  }),
});

// ---------------------------------------------------------------------------
// AGS0-AGS2 (TASK-007) — Goal/Task-bound Skill resolution + bounded child
// Agent Runs. See @bridge/core's goal-task.ts / skill-manifest.ts /
// child-agent-run.ts for the governed primitives these procedures wrap.
// ---------------------------------------------------------------------------
export const goalCreateInput = z.object({
  organizationId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
});

export const taskCreateInput = z.object({
  organizationId: z.string().min(1),
  goalId: z.string().min(1),
  type: z.string().min(1),
  assignedAgentId: z.string().min(1),
});

export const taskReassignInput = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
  assignedAgentId: z.string().min(1),
});

export const resolveSkillInput = z.object({
  organizationId: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1),
  /** The Agent attempting to use a Skill for this Task — server-resolved
   * authority (capabilityScope/plane/dataScope) always comes from
   * `ctx.wiring.agents`, never client-asserted. */
  agentId: z.string().min(1),
  skillId: z.string().min(1).optional(),
  requestedDataScope: dataScopeEnum.optional(),
});

export const automationStep = z.object({
  skill: z.string().min(1),
  action: actionEnum,
  resourceType: resourceTypeEnum,
  resourceId: z.string().uuid().optional(),
  inputs: z.unknown(),
  dataScope: dataScopeEnum.optional(),
  /** AGS1/TASK-007 — see AutomationStepDef.goalTaskRef's doc comment. */
  goalTaskRef: z.object({ goalId: z.string().min(1), taskId: z.string().min(1) }).optional(),
});

export const automationRunByIdInput = z.object({
  organizationId: z.string().min(1),
  automationId: z.string().min(1),
  moduleName: z.string().min(1).optional(),
  onBehalfOf: onBehalfOfSchema.optional(),
  params: z.record(z.unknown()).optional(),
  seed: z.string().optional(),
});

/** Layered, gated agent permissions (least-privilege; cf. Google incremental scopes).
 * `send` is intentionally NOT an egress tier — agents may never send (human-only). */
export const egressTierEnum = z.enum(["none", "read-graph", "draft-graph", "source-internet"]);

export const agentCreateInput = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  roleTemplateId: z.string().min(1),
});

export const agentUpdateInput = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).optional(),
  roleTemplateId: z.string().min(1).optional(),
});

export const automationCreateInput = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  agentId: z.string().min(1),
  steps: z.array(automationStep).min(1),
});

// ---------------------------------------------------------------------------
// Capability Trust Model (docs/wiki/vision.md "Capability Trust Model" +
// "Promotion defaults"). Zod-validated at this seam like every other router
// namespace; governance (approve) routes through the pipeline's decide()
// semantics — human identity from ctx.identity, agents blocked by the floor.
// ---------------------------------------------------------------------------
export const capabilityTypeEnum = z.enum(["skill", "automation", "agent", "integration", "database"]);
export const capabilityOriginEnum = z.enum(["built_in", "template", "community", "ai_generated", "user_code"]);
export const capabilityAudienceEnum = z.enum(["private", "team", "external_visible"]);

export const capabilityPermissionSchema = z.object({
  resourceType: z.string().min(1),
  action: z.enum(["read", "write", "send"]),
  dataScope: z.enum(["public", "private", "all"]),
  egress: z.boolean(),
});
export const capabilityConnectorSchema = z.object({ id: z.string().min(1), externalSend: z.boolean().default(false) });
export const capabilityDependencySchema = z.object({ manifestId: z.string().min(1), versionRange: z.string().min(1) });

export const capabilityRegisterInput = z.object({
  organizationId: z.string().min(1),
  capabilityType: capabilityTypeEnum,
  name: z.string().min(1),
  version: z.string().min(1).default("1.0.0"),
  origin: capabilityOriginEnum.default("user_code"),
  audience: capabilityAudienceEnum.default("private"),
  permissions: z.array(capabilityPermissionSchema).default([]),
  connectors: z.array(capabilityConnectorSchema).default([]),
  dependencies: z.array(capabilityDependencySchema).default([]),
  manifest: z.unknown().optional(),
});

export const capabilityIdInput = z.object({ manifestId: z.string().min(1) });
export const capabilityActivateInput = z.object({
  organizationId: z.string().min(1),
  manifestId: z.string().min(1),
  /** Calendar-day key for the auto-activation budget (UTC "YYYY-MM-DD"). Caller-
   * injected so the router stays a determinism-seam consumer, not a wall-clock reader. */
  todayKey: z.string().min(1),
});

// ---------------------------------------------------------------------------
// P2 Capability modules (docs/raw/capability-module-format.md, ADR-018) — the
// shipping unit above one capability_manifests row. `register` parses+validates
// a raw module.yaml-shaped object (accepts either already-parsed YAML or a
// plain JSON body) and stores it as a `private`-state installation row, no risk
// computed yet (register != propose-for-install, mirrors capability.register's
// "generation only ever creates draft"). `install` computes module risk over
// the full bundled+dependency closure, applies the lethal-trifecta union
// check, and routes through the SAME pipeline propose/decide semantics
// `capability.approve`/`organization.blueprint.activate` use — external band is
// the same non-removable hard floor, no trust grant can shortcut it.
// ---------------------------------------------------------------------------

export const moduleRegisterInput = z.object({
  organizationId: z.string().min(1),
  /** Already-parsed module.yaml (or an equivalent plain object) — parsed+
   * validated by parseModuleManifest at this seam. */
  manifest: z.unknown(),
});

export const moduleIdInput = z.object({ installationId: z.string().min(1) });

export const moduleInstallInput = z.object({
  organizationId: z.string().min(1),
  installationId: z.string().min(1),
  /** Calendar-day key for the auto-activation budget (mirrors capability.activate's todayKey). */
  todayKey: z.string().min(1),
});

export const modulePromoteInput = z.object({
  organizationId: z.string().min(1),
  installationId: z.string().min(1),
});

export const moduleRollbackInput = z.object({
  organizationId: z.string().min(1),
  /** The historical installation row (any state) to fork a new draft from. */
  rollbackTargetId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// P1 Organization Generator — blueprint -> view grammar (docs/wiki/vision.md "View
// grammar"). Blueprint changes are GOVERNED PROPOSALS: propose() writes a DRAFT
// organization_definition (no direct activation), activate() is the governed step
// (routes through the SAME pipeline propose/decide semantics `capability.approve`
// uses — human identity only, agent-floor applies unchanged).
// ---------------------------------------------------------------------------

/** Kernel node-type registry compileBlueprint validates entities against.
 * Reuses `resourceTypeEnum`'s values (the same governed-pipeline vocabulary)
 * plus "edge" — the actual relationship-shaped table in schema.ts (no
 * standalone "relationship" ResourceType/table exists yet; edges IS the
 * relationship data). Kept as a single source of truth here rather than
 * duplicated per-procedure. */
export const BLUEPRINT_NODE_TYPE_REGISTRY = [...resourceTypeEnum.options, "edge"] as const;
export const BLUEPRINT_RELATIONSHIP_NODE_TYPES = ["edge"] as const;

export const blueprintFieldInput = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(BLUEPRINT_FIELD_KINDS),
  options: z.array(z.string()).optional(),
  skillId: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number(), z.boolean()]))]).optional(),
  relationTarget: z.string().min(1).optional(),
  relationParent: z.boolean().optional(),
  hiddenInForm: z.boolean().optional(),
});

export const blueprintEntityInput = z.object({
  nodeType: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(blueprintFieldInput),
});

export const blueprintViewInput = z.object({
  entity: z.string().min(1),
  kind: z.enum(["table", "board", "gallery", "form", "calendar", "map", "graph", "tree", "chatbot", "dashboard", "canvas"]),
  config: z
    .object({
      sorts: z.array(viewSortSpecInput).optional(),
      rowFilters: z.array(viewRowFilterInput).optional(),
      filterMatch: z.enum(["all", "any"]).optional(),
      groupBy: z.string().nullable().optional(),
      dateBy: z.string().optional(),
      locationBy: z.string().optional(),
      relationBy: z.string().optional(),
      parentBy: z.string().optional(),
      graphScope: z.enum(["single_database", "multi_database", "full"]).optional(),
      graphDatabaseIds: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

export const organizationBlueprintInput = z.object({
  vocabulary: z.record(z.string(), z.string()),
  entities: z.array(blueprintEntityInput),
  views: z.array(blueprintViewInput),
  capabilities: z.array(z.string()),
});

/** Strip zod-optional `undefined` keys so the payload satisfies OrganizationBlueprint's
 * exactOptionalPropertyTypes shape (same reasoning as cleanOnBehalfOf/cleanContext
 * above) before it reaches compileBlueprint or the store. */
export function toOrganizationBlueprint(input: z.infer<typeof organizationBlueprintInput>): OrganizationBlueprint {
  return {
    vocabulary: input.vocabulary,
    capabilities: input.capabilities,
    entities: input.entities.map((e) => ({
      nodeType: e.nodeType,
      label: e.label,
      fields: e.fields.map((f) => ({
        id: f.id,
        label: f.label,
        kind: f.kind,
        ...(f.options ? { options: f.options } : {}),
        ...(f.skillId ? { skillId: f.skillId } : {}),
        ...(f.required !== undefined ? { required: f.required } : {}),
        ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
        ...(f.relationTarget ? { relationTarget: f.relationTarget } : {}),
        ...(f.relationParent !== undefined ? { relationParent: f.relationParent } : {}),
        ...(f.hiddenInForm !== undefined ? { hiddenInForm: f.hiddenInForm } : {}),
      })),
    })),
    views: input.views.map((v) => ({
      entity: v.entity,
      kind: v.kind,
      ...(v.config
        ? {
            config: {
              ...(v.config.sorts ? { sorts: v.config.sorts } : {}),
              ...(v.config.rowFilters ? { rowFilters: v.config.rowFilters } : {}),
              ...(v.config.filterMatch ? { filterMatch: v.config.filterMatch } : {}),
              ...(v.config.groupBy !== undefined ? { groupBy: v.config.groupBy } : {}),
              ...(v.config.dateBy ? { dateBy: v.config.dateBy } : {}),
              ...(v.config.locationBy ? { locationBy: v.config.locationBy } : {}),
              ...(v.config.relationBy ? { relationBy: v.config.relationBy } : {}),
              ...(v.config.parentBy ? { parentBy: v.config.parentBy } : {}),
              ...(v.config.graphScope ? { graphScope: v.config.graphScope } : {}),
              ...(v.config.graphDatabaseIds ? { graphDatabaseIds: v.config.graphDatabaseIds } : {}),
            },
          }
        : {}),
    })),
  };
}


// ---------------------------------------------------------------------------
// Chief of Staff v1 (docs/wiki/roadmap.md P1) — the closed registry of
// downstream capabilities it may route ONE turn to (star topology: no peer
// handoffs, so this list is exhaustive and hand-maintained here, mirroring
// BLUEPRINT_NODE_TYPE_REGISTRY's "single source of truth, kept in sync by
// hand" pattern above). Honest about what's routable today — capabilities not
// yet built (e.g. a dedicated recon/helpdesk skill) are deliberately omitted
// rather than listed as routable and then failing at execution time.
// ---------------------------------------------------------------------------
export const CHIEF_OF_STAFF_REGISTRY: RoutableCapability[] = [
  {
    id: "jobpilot",
    description: "track job applications and their stage",
    keywords: ["job", "jobs", "application", "applications", "apply", "interview", "offer"],
  },
  {
    id: "dealpilot",
    description: "browse and score acquisition/deal candidates",
    keywords: ["deal", "deals", "acquisition", "listing", "business", "buy"],
  },
  {
    id: "calendar",
    description: "view or schedule calendar events",
    keywords: ["calendar", "schedule", "meeting", "event", "availability"],
  },
  {
    id: "helpdesk",
    description: "look up or respond to helpdesk tickets",
    keywords: ["ticket", "helpdesk", "support", "issue"],
  },
  {
    id: "resources",
    description: "find a saved resource (book, podcast, vlog)",
    keywords: ["resource", "book", "podcast", "vlog", "read", "watch"],
  },
];

export const MODEL_BINDING_BY_TIER: Readonly<Record<ModelTier, ModelBinding>> = {
  cheap: {
    use: "llm",
    planeDefault: "cloud",
    providers: { local: "ollama", cloud: ["groq", "anthropic"] },
  },
  default: {
    use: "llm",
    planeDefault: "cloud",
    providers: { local: "ollama", cloud: ["anthropic", "groq"] },
  },
  reasoning: {
    use: "llm",
    planeDefault: "cloud",
    providers: { local: "ollama", cloud: ["anthropic"] },
  },
};

export interface PublicCloudModelEgress {
  dataScope: "public";
  userConfirmed: true;
}

export function resolveConfiguredModel(
  models: Wiring["models"],
  tier: ModelTier,
  cloudEgress?: PublicCloudModelEgress,
) {
  const configured = [...models.providers().values()].filter(
    (provider) =>
      provider.id !== "echo" && provider.routingHealth() !== "unavailable",
  );
  if (configured.length === 0) return undefined;
  const binding = cloudEgress
    ? MODEL_BINDING_BY_TIER[tier]
    : { ...MODEL_BINDING_BY_TIER[tier], planeDefault: "local" as const };
  return createModelRouter(configured).resolve(binding, tier);
}

export async function appendIntentModelReceipt(
  ctx: Pick<ApiContext, "run" | "wiring">,
  organizationId: string,
  purpose: string,
  receipt: ModelCallReceipt,
  governance: {
    actor: Actor;
    onBehalfOf?: OnBehalfOf;
    action: Action;
    resourceType: ResourceType;
    authority: AuthorityDecision;
    policyResults: PolicyResult[];
    dataScope: DataScope;
    cloudEgressConfirmed: boolean;
  },
): Promise<string> {
  const id = ctx.run.ids.next();
  await ctx.wiring.ledger.append({
    id,
    organizationId,
    actorType: governance.actor.type,
    actorId: governance.actor.id,
    ...(governance.onBehalfOf
      ? {
          onBehalfOfType: governance.onBehalfOf.type,
          onBehalfOfId: governance.onBehalfOf.id,
          ...(governance.onBehalfOf.delegationId
            ? { delegationId: governance.onBehalfOf.delegationId }
            : {}),
        }
      : {}),
    action: governance.action,
    resourceType: governance.resourceType,
    inputs: {
      operation: "model_completion",
      modelCallRunId: id,
      purpose,
      providerId: receipt.providerId,
      providerPlane: receipt.plane,
      tier: receipt.tier,
      composition: "chief_of_staff",
      cloudEgressConfirmed: governance.cloudEgressConfirmed,
      promptStored: false,
      authority: {
        basis: governance.authority.basis,
        reason: governance.authority.reason,
      },
    },
    proposedOutput: { receipt },
    userDecision: "auto",
    policyResults: governance.policyResults,
    dataScope: governance.dataScope,
    createdAt: ctx.run.clock.nowISO(),
  });
  return id;
}

export async function authorizeModelCompletion(
  ctx: Pick<ApiContext, "identity" | "run" | "wiring">,
  organizationId: string,
  model: ModelProvider,
  purpose: string,
  tier: ModelTier,
  cloudEgress?: PublicCloudModelEgress,
): Promise<{
  actor: Actor;
  onBehalfOf?: OnBehalfOf;
  action: Action;
  resourceType: ResourceType;
  authority: AuthorityDecision;
  policyResults: PolicyResult[];
  dataScope: DataScope;
  cloudEgressConfirmed: boolean;
}> {
  const cloud = model.plane === "cloud";
  let actor: Actor;
  let onBehalfOf: OnBehalfOf | undefined;
  let requestedDataScope: DataScope;
  if (cloud) {
    if (!cloudEgress?.userConfirmed || cloudEgress.dataScope !== "public") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "cloud model execution requires an explicit declaration that this turn contains only public data",
      });
    }
    if (ctx.identity.type !== "user" && ctx.identity.type !== "team") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "cloud model execution requires an attributable user or team principal",
      });
    }
    requestedDataScope = cloudEgress.dataScope;
    actor = { type: "agent", id: EGRESS_AGENT, plane: "cloud" };
    onBehalfOf = { type: ctx.identity.type, id: ctx.identity.id };
  } else {
    requestedDataScope = "all";
    actor = { ...ctx.identity, plane: "local" };
  }
  const action: Action = "read";
  const resourceType: ResourceType = cloud ? "external:fetch" : "module";
  const authority = await resolveAuthority(
    {
      organizationId,
      actor,
      action,
      resourceType,
      ...(onBehalfOf ? { onBehalfOf } : {}),
      requestedDataScope,
    },
    {
      roles: ctx.wiring.roles,
      agents: ctx.wiring.agents,
      ephemeral: ctx.wiring.ephemeral,
      nowISO: ctx.run.clock.nowISO(),
    },
  );
  if (!authority.allowed || authority.dataScope === "none") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `model execution denied by Authority: ${authority.reason}`,
    });
  }
  const policyInputs = {
    operation: "model_completion",
    purpose,
    providerId: model.id,
    providerPlane: model.plane,
    tier,
    dataScope: requestedDataScope,
    cloudEgressConfirmed: cloud,
    promptStored: false,
  };
  const policyResults = await ctx.wiring.policies.evaluate({
    organizationId,
    actor,
    action,
    resourceType,
    resourceId: undefined,
    phase: "pre",
    inputs: policyInputs,
    ...(ctx.run.taint ? { taint: ctx.run.taint } : {}),
  });
  const stoppingPolicy = policyResults.find(
    (result) => result.effect === "block" || result.effect === "require_approval",
  );
  if (stoppingPolicy) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `model execution denied by policy "${stoppingPolicy.policyId}": ${stoppingPolicy.reason}`,
    });
  }
  return {
    actor,
    ...(onBehalfOf ? { onBehalfOf } : {}),
    action,
    resourceType,
    authority,
    policyResults,
    dataScope: authority.dataScope,
    cloudEgressConfirmed: cloud,
  };
}

export function createGovernedModelProvider(
  ctx: Pick<ApiContext, "identity" | "run" | "wiring">,
  organizationId: string,
  model: ModelProvider,
  purpose: string,
  cloudEgress?: PublicCloudModelEgress,
): { provider: ModelProvider; receiptLedgerId: () => string | null } {
  let receiptLedgerId: string | null = null;
  const provider: ModelProvider = {
    id: model.id,
    plane: model.plane,
    tiers: model.tiers,
    models: model.models,
    routingHealth: () => model.routingHealth(),
    ...(model.pricing ? { pricing: model.pricing } : {}),
    async complete(request) {
      assertModelCompletionRequest(request, "governed model completion");
      const governance = await authorizeModelCompletion(
        ctx,
        organizationId,
        model,
        purpose,
        request.tier,
        cloudEgress,
      );
      const completion = await model.complete(request);
      assertModelOutputTaint(request, completion);
      const receipt = createModelCallReceipt(model, completion, request.tier);
      receiptLedgerId = await appendIntentModelReceipt(
        ctx,
        organizationId,
        purpose,
        receipt,
        governance,
      );
      return completion;
    },
  };
  return { provider, receiptLedgerId: () => receiptLedgerId };
}

export const chiefOfStaffConverseInput = z.object({
  organizationId: z.string().min(1),
  message: z.string().min(1),
  cloudModelEgress: z
    .object({
      dataScope: z.literal("public"),
      userConfirmed: z.literal(true),
    })
    .strict()
    .optional(),
  /** How many routing hops this conversation has already taken — the caller
   * (frontend chat panel) tracks this per-conversation and passes it back each
   * turn so the hard chain-depth cap (assertChainDepth) can be enforced
   * server-side, not just trusted client-side. Defaults to 0 (a fresh
   * conversation's first turn). */
  chainDepth: z.number().int().min(0).default(0),
});

export const chatSurfaceInput = z.object({
  kind: z.enum(["chat_panel", "chief_of_staff_page", "avatar_overlay", "task_manager"]),
  id: z.string().trim().min(1).max(200).optional(),
}).strict();

export const chatAssistantEnvelopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    text: z.string().trim().min(1).max(8_000),
  }).strict(),
  z.object({
    kind: z.literal("clarification"),
    text: z.string().trim().min(1).max(2_000),
  }).strict(),
  z.object({
    kind: z.literal("create_task"),
    text: z.string().trim().min(1).max(2_000),
    title: z.string().trim().min(1).max(160),
    outcome: z.string().trim().min(1).max(2_000),
    exitTest: z.string().trim().min(1).max(2_000),
  }).strict(),
]);

export const CHAT_ASSISTANT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "title", "outcome", "exitTest", "text"],
  properties: {
    kind: { type: "string", enum: ["answer", "clarification", "create_task"] },
    title: { type: "string" },
    outcome: { type: "string" },
    exitTest: { type: "string" },
    text: { type: "string" },
  },
} as const;

export const CHAT_PUBLIC_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text"],
  properties: {
    kind: { type: "string", enum: ["answer", "clarification"] },
    text: { type: "string", minLength: 1, maxLength: 2_000 },
  },
} as const;

export const CHAT_LLAMA_PUBLIC_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text"],
  properties: {
    kind: { type: "string", enum: ["answer", "clarification"] },
    text: { type: "string" },
  },
} as const;

export const chatSendInput = z.object({
  organizationId: z.string().uuid(),
  threadId: z.string().uuid(),
  clientRequestId: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(16_000),
  surface: chatSurfaceInput.optional(),
  cloudGrantId: z.string().uuid().optional(),
  retryTurnId: z.string().uuid().optional(),
}).strict();

/** A parent Task the deterministic matcher put forward, carried into the
 * review card WITH the terms that produced it so the reviewer can judge it
 * (AP-021 / "explain before automating" — never a silent auto-parenting). */
export const chatTaskParentCandidateSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(400),
  score: z.number().min(0).max(1),
}).strict();

export const chatCreateTaskOutputSchema = z.object({
  kind: z.literal("task_create"),
  /** "append" continues the Task node this Chat thread already owns; "create"
   * mints a new node. Defaulted so proposals staged before ADR-183 still
   * parse as the create-a-new-node shape they were. */
  mode: z.enum(["create", "append"]).default("create"),
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  outcome: z.string().trim().min(1).max(2_000),
  exitTest: z.string().trim().min(1).max(2_000),
  /** The reviewer's parent decision — suggested by the matcher, editable and
   * clearable before approval. */
  parentTaskId: z.string().uuid().nullable().default(null),
  parentRationale: z.string().trim().min(1).max(400).nullable().default(null),
  parentCandidates: z.array(chatTaskParentCandidateSchema).max(5).default([]),
  status: z.literal("proposed"),
}).strict();

/** Build the core `CapabilityManifest` shape (risk-computation input) from a
 * `capabilityRegisterInput`-validated payload + the id assigned at creation. */
export function toCoreManifest(id: string, input: z.infer<typeof capabilityRegisterInput>): CapabilityManifest {
  return {
    id,
    name: input.name,
    version: input.version,
    capabilityType: input.capabilityType,
    origin: input.origin,
    audience: input.audience,
    permissions: input.permissions,
    connectors: input.connectors,
    dependencies: input.dependencies,
  };
}

/** Resolve a dependency manifest id to its core `CapabilityManifest` shape via
 * the store — the seam computeRisk()'s `ResolveDependency` needs. Synchronous
 * by contract (risk.ts is pure/sync), so callers pre-fetch the closure's rows
 * before invoking computeRisk (single round trip per registration/re-risk). */
export function resolverFrom(rows: Map<string, CapabilityManifestRow>): (id: string) => CapabilityManifest | undefined {
  return (id: string) => {
    const row = rows.get(id);
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      capabilityType: row.capabilityType,
      origin: row.origin,
      audience: row.audience,
      permissions: (row.manifest as { permissions?: CapabilityManifest["permissions"] } | null)?.permissions ?? [],
      connectors: (row.manifest as { connectors?: CapabilityManifest["connectors"] } | null)?.connectors ?? [],
      dependencies: row.dependencies,
    };
  };
}

export function moduleInstallIdFromProposal(entry: LedgerEntry): string | undefined {
  if (typeof entry.inputs !== "object" || entry.inputs === null || Array.isArray(entry.inputs)) return undefined;
  const inputs = entry.inputs as Record<string, unknown>;
  if (inputs.operation !== "module_install" || typeof inputs.installationId !== "string") return undefined;
  if (
    entry.resourceId !==
    moduleInstallationLedgerResourceId(entry.organizationId, inputs.installationId)
  ) return undefined;
  if (entry.id !== stableModuleInstallProposalId(entry.organizationId, inputs.installationId)) return undefined;
  return inputs.installationId;
}

export async function findPendingProposalById(
  wiring: Wiring,
  organizationId: string,
  proposalId: string,
): Promise<(Proposal & { createdAt: string }) | null> {
  let offset = 0;
  while (true) {
    const page = await wiring.pipeline.listPending(organizationId, { limit: 200, offset });
    const found = page.items.find((proposal) => proposal.id === proposalId);
    if (found) return found;
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return null;
  }
}

export async function assertCurrentCommonsAttachment(
  wiring: Wiring,
  installation: ModuleInstallationRow,
): Promise<CommonsModuleEntry | null> {
  const attachment = installation.moduleAttachment;
  if (!attachment && !installation.commonsSource) return null;
  if (installation.commonsSource) {
    const entry = await wiring.commonsRegistry.getVersion(
      installation.moduleName,
      installation.moduleVersion,
    );
    if (
      !entry ||
      entry.integrity.value !== installation.commonsSource.contentHash ||
      canonicalizeJson(entry) !== canonicalizeJson(installation.commonsSource.entry)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Commons root Module no longer matches its pinned signed source",
      });
    }
    try {
      assertCommonsEntryContentTrusted(entry);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : "Commons root Module failed trust verification",
      });
    }
    const parsed = parseModuleManifest({ module: entry.manifest });
    if (
      canonicalizeManifest(parsed) !== canonicalizeManifest(installation.manifest) ||
      `sha256:${createHash("sha256").update(canonicalizeManifest(parsed)).digest("hex")}` !==
        installation.commonsSource.manifestHash
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Commons root Module normalized manifest no longer matches the installation",
      });
    }
    const privacyPaths = findOrganizationDataPaths(entry.manifest);
    if (privacyPaths.length > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Commons root Module contains Organization data (${privacyPaths.join(", ")})`,
      });
    }
    return entry;
  }
  if (!attachment) return null;
  const ownerModule = await wiring.moduleStore.getAvailable(
    installation.organizationId,
    attachment.ownerModuleName,
  );
  if (!ownerModule || ownerModule.status !== "installed" || !ownerModule.manifest.module) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `owning Module "${attachment.ownerModuleName}" is no longer installed`,
    });
  }
  const need = ownerModule.manifest.module.commonsNeeds?.find(
    (candidate) => candidate.id === attachment.needId,
  );
  if (!need || need.agentId !== attachment.agentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Commons capability need is no longer owned by the attached Module Agent",
    });
  }
  const entry = await wiring.commonsRegistry.getVersion(
    installation.moduleName,
    installation.moduleVersion,
  );
  if (!entry || entry.integrity.value !== attachment.contentHash) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Commons installation no longer matches its pinned root result",
    });
  }
  try {
    assertCommonsEntryContentTrusted(entry);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Commons root result failed trust verification",
    });
  }
  if (entry.kind !== need.kind || !need.tags.every((tag) => entry.tags.includes(tag))) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Commons module no longer satisfies the declared Module need",
    });
  }
  if (
    entry.manifest.capabilities.length === 0 ||
    entry.manifest.capabilities.some((capability) => capability.capabilityType !== "skill")
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only Skill modules can remain attached beneath a Module Agent",
    });
  }
  return entry;
}

export async function verifiedCommonsDependencyInstallations(
  wiring: Wiring,
  root: ModuleInstallationRow,
  rootEntry: CommonsModuleEntry | null,
): Promise<ModuleInstallationRow[]> {
  if (!rootEntry) return [];
  const { items } = await wiring.moduleStore.list(root.organizationId, { limit: 10_000, offset: 0 });
  const verifiedPins = new Map<string, string>();
  const found = new Map<string, ModuleInstallationRow>();
  const visited = new Set<string>();
  const visit = async (entry: CommonsModuleEntry): Promise<void> => {
    const parentPins = new Map<string, string>(
      (entry.securityScan.dependencyPins ?? []).map(
        (pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const,
      ),
    );
    for (const dependency of entry.manifest.dependencies) {
      const key = `${dependency.manifestId}@${dependency.version}`;
      const expectedHash = parentPins.get(key);
      const priorHash = verifiedPins.get(key);
      if (priorHash && priorHash !== expectedHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Commons dependency "${key}" has conflicting signed content-hash pins`,
        });
      }
      if (visited.has(key)) continue;
      visited.add(key);
      const dependencyEntry = await wiring.commonsRegistry.getVersion(
        dependency.manifestId,
        dependency.version,
      );
      if (!dependencyEntry || !expectedHash || dependencyEntry.integrity.value !== expectedHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Commons dependency "${key}" does not match its signed content-hash pin`,
        });
      }
      verifiedPins.set(key, expectedHash);
      try {
        assertCommonsEntryContentTrusted(dependencyEntry);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : `Commons dependency "${key}" failed trust verification`,
        });
      }
      const local = items.find((candidate) => {
        if (
          candidate.moduleName !== dependency.manifestId ||
          candidate.moduleVersion !== dependency.version
        ) return false;
        if (root.moduleAttachment) {
          return (
            candidate.moduleAttachment?.source === "commons" &&
            candidate.moduleAttachment.ownerModuleName === root.moduleAttachment.ownerModuleName &&
            candidate.moduleAttachment.agentId === root.moduleAttachment.agentId &&
            candidate.moduleAttachment.needId === root.moduleAttachment.needId &&
            candidate.moduleAttachment.contentHash === expectedHash
          );
        }
        return candidate.commonsSource?.contentHash === expectedHash;
      });
      if (!local || !["private", "promoted", "available"].includes(local.state)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Commons dependency "${key}" is not staged in an activatable state`,
        });
      }
      found.set(local.id, local);
      await visit(dependencyEntry);
    }
  };
  await visit(rootEntry);
  return [...found.values()];
}

export async function activateApprovedModuleInstallation(
  wiring: Wiring,
  organizationId: string,
  installationId: string,
): Promise<ModuleInstallationRow> {
  let installation = await wiring.moduleStore.get(installationId);
  if (!installation || installation.organizationId !== organizationId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "unknown module installation" });
  }
  const rootEntry = await assertCurrentCommonsAttachment(wiring, installation);
  const dependencies = await verifiedCommonsDependencyInstallations(wiring, installation, rootEntry);
  for (const dependency of dependencies) {
    await wiring.moduleStore.setComputedRisk(
      dependency.id,
      maxRisk(dependency.computedRisk, installation.computedRisk),
    );
    await wiring.moduleStore.setStatus(dependency.id, "installed");
    let current = (await wiring.moduleStore.get(dependency.id))!;
    if (current.state === "private") current = await wiring.moduleStore.setState(current.id, "promoted");
    if (current.state === "promoted") {
      const available = await wiring.moduleStore.getAvailable(
        organizationId,
        current.moduleName,
        current.moduleAttachment,
      );
      const promotion = promoteToAvailable(current, available);
      await wiring.moduleStore.setState(promotion.promoted.installationId, promotion.promoted.nextState);
      if (promotion.demoted) {
        await wiring.moduleStore.setState(promotion.demoted.installationId, promotion.demoted.nextState);
      }
    } else if (current.state !== "available") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Commons dependency cannot activate from state "${current.state}"`,
      });
    }
  }
  if (installation.status !== "installed") {
    installation = await wiring.moduleStore.setStatus(installation.id, "installed");
  }
  if (installation.state === "private") {
    installation = await wiring.moduleStore.setState(installation.id, "promoted");
  } else if (installation.state !== "promoted" && installation.state !== "available") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `module installation cannot activate from state "${installation.state}"`,
    });
  }
  return installation;
}

export async function validateDealPilotDiscoveryOutput(wiring: Wiring, inputs: unknown, output: unknown) {
  const request = inputs as {
    kind?: unknown;
    organizationId?: unknown;
    thesisId?: unknown;
  };
  if (request.kind !== "thesis_source_discovery") return null;
  const proposed = output as ThesisSourceDiscoveryProposal | undefined;
  if (
    proposed?.kind !== "thesis_source_discovery" ||
    typeof request.organizationId !== "string" ||
    typeof request.thesisId !== "string" ||
    proposed.organizationId !== request.organizationId ||
    proposed.thesisId !== request.thesisId ||
    !Array.isArray(proposed.relations)
  ) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "DealPilot discovery proposal binding is invalid" });
  }
  const thesis = await wiring.dealpilot.store.get("thesis", request.organizationId, request.thesisId);
  if (!thesis || thesis.kind !== "thesis") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "DealPilot discovery Thesis is unavailable" });
  }
  const authorizedRelations: ThesisSourceDiscoveryProposal["relations"] = [];
  for (const relation of proposed.relations) {
    if (
      typeof relation !== "object" ||
      relation === null ||
      relation.thesisId !== request.thesisId ||
      typeof relation.sourceId !== "string"
    ) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "DealPilot discovery Relation is invalid" });
    }
    const source = await wiring.dealpilot.store.get("source", request.organizationId, relation.sourceId);
    if (!source || source.kind !== "source" || source.rightsState !== "attested") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Source "${relation.sourceId}" is no longer authorized for discovery`,
      });
    }
    authorizedRelations.push({
      sourceId: source.id,
      thesisId: thesis.id,
      confidence: 0,
      provenance: "authorized_source_inventory",
      reason: "Authorized Source inventory candidate; Thesis fit is not scored",
    });
  }
  return {
    kind: "thesis_source_discovery",
    organizationId: request.organizationId,
    thesisId: request.thesisId,
    relations: authorizedRelations,
  } satisfies ThesisSourceDiscoveryProposal;
}

export async function validateDealPilotDecision(
  wiring: Wiring,
  proposalId: string,
  decision: "approve" | "veto" | "edit",
  editedOutput?: unknown,
) {
  if (decision === "veto") return;
  const original = await wiring.ledger.get(proposalId);
  if (!original) return;
  await validateDealPilotDiscoveryOutput(
    wiring,
    original.inputs,
    decision === "edit" ? editedOutput : original.proposedOutput,
  );
}

export async function materializeDealPilotApproval(wiring: Wiring, proposal: Proposal) {
  const validated = await validateDealPilotDiscoveryOutput(
    wiring,
    proposal.request.inputs,
    proposal.output?.proposedOutput,
  );
  if (!validated) return [];
  return applyThesisSourceDiscovery(wiring.dealpilot.store, validated);
}

/**
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects review,
 * issue 9) — a STRICT output schema for `jobpilot.synthesizeCultureProfile`.
 * `synthesisResult` parses the persisted ledger row's `proposedOutput`
 * through this before ever rendering it: an arbitrary APPROVED proposal (of
 * ANY skill) whose output happens to be object-shaped, or a
 * `jobpilot.researchCultureSource` fetch-intent output, must be REJECTED
 * (never rendered) rather than blindly cast and served to the client. This
 * is in addition to, not instead of, cross-validating `resourceType`/
 * `action`/`parentRunId`/result provenance at the call site.
 */
export const cultureEvidenceSchema = z.object({
  id: z.string().min(1),
  claimType: z.enum(["fact", "opinion", "theme", "contradiction", "inference"]),
  claimText: z.string(),
  sourceLabel: z.string(),
  sourceUrl: z.string(),
  // TASK-011 remediation (2026-07-19 coordinator distributed-defects
  // RE-review, issue 10) — `internal_derived_synthesis` is the distinct
  // provenance marker `groundClaims` now assigns to theme/inference/
  // contradiction evidence (never a real fetchable source type); the
  // strict output schema must accept it or every synthesis containing a
  // derived claim would be wrongly rejected as malformed.
  sourceType: z.enum(["company_official_page", "public_blog_or_press", "reddit", "google_reviews", "glassdoor", "internal_derived_synthesis"]),
  retrievedAt: z.string(),
  authorContext: z.string().nullable(),
  agentInference: z.boolean(),
  contradicts: z.array(z.string()).optional(),
});

export const synthesizeCultureProfileOutputSchema = z.object({
  parentRunId: z.string().min(1),
  resultHashes: z.array(z.object({ sourceId: z.string().min(1), contentHash: z.string().min(1) })),
  partition: z.object({
    facts: z.array(cultureEvidenceSchema),
    opinions: z.array(cultureEvidenceSchema),
    themes: z.array(cultureEvidenceSchema),
    contradictions: z.array(cultureEvidenceSchema),
    inferences: z.array(cultureEvidenceSchema),
  }),
  disclosure: z.object({
    used: z.array(z.object({ sourceLabel: z.string(), sourceUrl: z.string(), sourceType: z.string(), retrievedAt: z.string() })),
    skipped: z.array(z.object({ sourceLabel: z.string(), sourceType: z.string(), reason: z.string() })),
  }),
});

/**
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects RE-review
 * round 2, issue 6) — the generic `action.decide` fail-closed backstop: a
 * ledger row that is SHAPED like a culture-research or culture-synthesis
 * proposal (by its distinctive `resourceType`/`context`/`inputs`
 * combination — the ONLY code paths in this router that produce these exact
 * shapes are `jobpilot.cultureResearch.propose`/`.synthesize` themselves)
 * must have a durable binding that agrees with the ledger row's OWN id
 * before a human decision may resolve it. Since propose() now preallocates
 * and binds BEFORE ever creating a real ledger row (see the `propose`
 * handler above), a legitimate proposal ALWAYS satisfies this; a proposal
 * that fails it can only be a corrupted/forged/out-of-band row that never
 * went through the real propose() path — reject it rather than letting
 * `pipeline.decide` (which has no knowledge of this binding at all) resolve
 * it anyway.
 */
export async function assertCultureProposalBindingValid(wiring: Wiring, original: LedgerEntry): Promise<void> {
  if (original.resourceType === "external:fetch" && original.context?.type === "child_agent_run") {
    const childRunId = original.context.id;
    const record = await wiring.cultureFetchStore.get(original.organizationId, childRunId);
    if (!record || record.proposalId !== original.id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `culture-research proposal "${original.id}" lacks a valid durable binding to its culture-fetch intent record — refusing to decide`,
      });
    }
    return;
  }
  const inputs = original.inputs as { parentRunId?: unknown; claims?: unknown } | null;
  if (original.resourceType === "signal" && original.action === "write" && typeof inputs?.parentRunId === "string" && Array.isArray(inputs.claims)) {
    const pointer = await wiring.cultureSynthesisPointerStore.getForParentRun(original.organizationId, inputs.parentRunId);
    if (!pointer || pointer.proposalId !== original.id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `culture-synthesis proposal "${original.id}" lacks a valid durable binding to its synthesis pointer record — refusing to decide`,
      });
    }
  }
}

export function relationshipEffectView(effect: RelationMaterializationEffect) {
  return {
    proposalId: effect.proposalLedgerId,
    decisionId: effect.decisionLedgerId,
    status: effect.status,
    attempts: effect.attemptCount,
    maxAttempts: effect.maxAttempts,
    leaseRecoveries: effect.leaseRecoveryCount,
    maxLeaseRecoveries: effect.maxLeaseRecoveries,
    relationCount: effect.relationCount,
    lastError: effect.lastError,
    nextRetryAt: effect.nextRetryAt?.toISOString() ?? null,
    leaseExpiresAt: effect.leaseExpiresAt?.toISOString() ?? null,
    lastAttemptAt: effect.lastAttemptedAt?.toISOString() ?? null,
    appliedAt: effect.appliedAt?.toISOString() ?? null,
    createdAt: effect.createdAt.toISOString(),
    updatedAt: effect.updatedAt.toISOString(),
  };
}

export async function approvedRelationshipResolution(
  ctx: Pick<ApiContext, "wiring" | "identity" | "run">,
  organizationId: string,
  proposalId: string,
): Promise<{ original: LedgerEntry; decision: LedgerEntry; ownerUserId: string }> {
  const original = await ctx.wiring.ledger.get(proposalId);
  if (
    !original ||
    original.organizationId !== organizationId ||
    (
      !(
        original.resourceType === "relation" &&
        isRelationshipSignalEvidence(original.inputs)
      ) &&
      !isRelationshipMutation(original.inputs) &&
      !(
        original.dataScope === "private" &&
        isGoogleLinkedInteractionIntake(original.inputs)
      )
    )
  ) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Relationship proposal not found",
    });
  }
  const ownerUserId = relationshipOwnerFromLedger(original);
  if (!ownerUserId || ownerUserId !== ctx.identity.id) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Relationship proposal not found",
    });
  }
  const decision = await ctx.wiring.ledger.decisionFor(proposalId);
  if (
    !decision ||
    (decision.userDecision !== "approve" && decision.userDecision !== "edit")
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Relationship proposal has no approved resolution to reconcile",
    });
  }
  return { original, decision, ownerUserId };
}

export async function retryApprovedRelationship(
  ctx: Pick<ApiContext, "wiring" | "identity" | "run">,
  organizationId: string,
  proposalId: string,
) {
  const { original, decision, ownerUserId } =
    await approvedRelationshipResolution(ctx, organizationId, proposalId);
  try {
    const result = await applyApprovedRelationshipMaterialization(
      ctx.wiring.graphStore,
      ctx.wiring.relationMaterializations,
      original,
      decision,
      new Date(ctx.run.clock.nowISO()),
      { allowExhausted: true },
      ctx.wiring.memoryStore,
    );
    if (result.effect.status !== "applied") {
      return {
        status: result.effect.status,
        effect: relationshipEffectView(result.effect),
        error:
          result.effect.lastError ??
          (result.effect.leaseExpiresAt
            ? "Relationship application is already in progress"
            : "Relationship application is ready to retry"),
        retryable: true,
      };
    }
    const materialization = result.materialization;
    const confirmed = {
      status: "confirmed" as const,
      effect: relationshipEffectView(result.effect),
    };
    if (isRelationshipSignalEvidence(original.inputs)) {
      return {
        ...confirmed,
        ...((materialization as RelationshipMaterialization | null) ?? {}),
      };
    }
    return {
      ...confirmed,
      ...(materialization !== null ? { materialization } : {}),
    };
  } catch (cause) {
    const effect = await ctx.wiring.relationMaterializations.getByProposal(
      organizationId,
      ownerUserId,
      proposalId,
    );
    if (!effect) throw cause;
    if (effect.status === "applied") {
      return {
        status: "confirmed" as const,
        effect: relationshipEffectView(effect),
      };
    }
    return {
      status: effect.status,
      effect: relationshipEffectView(effect),
      error:
        effect.lastError ??
        (cause instanceof Error ? cause.message : String(cause)),
      retryable: true,
    };
  }
}

/**
 * D8 (BUGS.md "approved external effects have no durable retry executor",
 * OPEN 2026-07-16) — a durable, idempotent retry for the OTHER approved
 * `action.decide` post-decision effect classes: plain Google `external:send`
 * egress (Gmail draft / Calendar create/update/delete — NOT the private
 * Google interaction-intake shape `relationship.reconcileApproved` already
 * covers) and DealPilot `thesis_source_discovery` materialization. Relation
 * materialization has its own dedicated `relationship.reconcileApproved`/
 * `retryMaterialization` (plus the background
 * `reconcileOrganizationRelationshipMaterializations` sweep), and Module
 * installs have `packages.reconcileApproved` — both explicitly rejected here
 * so callers use the correct, already-durable surface instead of a
 * no-op-shaped success from this one.
 *
 * Reuses the ORIGINAL approval unchanged: `proposalFromResolvedRelationshipLedger`
 * replays the exact persisted request/authority/policyResults/output the human
 * decision already produced, and this NEVER calls `pipeline.decide()` — so it
 * cannot create a second review decision. The effects themselves carry their
 * own idempotency keys (egress's `hasExternal(organizationId, "egress",
 * proposalId)` guard against double-send; DealPilot's relation-key upsert), so
 * replaying them is safe even if the original attempt partially succeeded.
 * A failure here appends the same shape of append-only audit evidence
 * `action.decide` does on a post-decision effect failure.
 */
export async function reconcileApprovedExternalEffect(
  ctx: Pick<ApiContext, "wiring" | "identity" | "run">,
  proposalId: string,
) {
  const original = await ctx.wiring.ledger.get(proposalId);
  if (!original) {
    throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
  }
  if (moduleInstallIdFromProposal(original)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "module install approvals reconcile through modules.reconcileApproved",
    });
  }
  if (
    (original.resourceType === "relation" && isRelationshipSignalEvidence(original.inputs)) ||
    isRelationshipMutation(original.inputs) ||
    (original.dataScope === "private" && isGoogleLinkedInteractionIntake(original.inputs))
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Relationship approvals reconcile through relationship.reconcileApproved",
    });
  }
  if (
    original.resourceType !== "relation" &&
    isPrivateProposalInputs(original.inputs) &&
    original.onBehalfOfId !== ctx.identity.id
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This proposal is private to its own owner" });
  }
  assertPrivateProposalOwner(original, ctx.identity, ctx.wiring.google);
  const decision = await ctx.wiring.ledger.decisionFor(proposalId);
  if (!decision || (decision.userDecision !== "approve" && decision.userDecision !== "edit")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "proposal is not approved" });
  }
  const resolved = proposalFromResolvedRelationshipLedger(original, decision);
  try {
    const effects = await ctx.wiring.google.onApproved(proposalId, resolved, ctx.run);
    if (effects.materialized) await emitGoogleCaptureSignals(ctx.wiring, resolved);
    const dealPilotEffects = await materializeDealPilotApproval(ctx.wiring, resolved);
    return {
      proposalId,
      effects,
      dealPilotEffects,
      effectsStatus: "confirmed" as const,
    };
  } catch (cause) {
    const effectsError = cause instanceof Error ? cause.message : String(cause);
    let effectsAuditId: string | undefined;
    try {
      const auditId = ctx.run.ids.next();
      await ctx.wiring.ledger.append({
        id: auditId,
        organizationId: original.organizationId,
        actorType: original.actorType,
        actorId: original.actorId,
        ...(original.onBehalfOfType ? { onBehalfOfType: original.onBehalfOfType } : {}),
        ...(original.onBehalfOfId ? { onBehalfOfId: original.onBehalfOfId } : {}),
        action: original.action,
        resourceType: original.resourceType,
        ...(original.resourceId ? { resourceId: original.resourceId } : {}),
        inputs: {
          originalProposalId: proposalId,
          display: {
            actor: `${original.actorType} · ${original.actorId}`,
            resource: `${original.resourceType}${original.resourceId ? ` · ${original.resourceId}` : ""}`,
            policy: "Reconcile of approved effect failed",
          },
        },
        proposedOutput: {
          text: `Reconcile of approved effect failed: ${effectsError}`,
          executed: false,
          error: effectsError,
        },
        userDecision: "auto",
        policyResults: [],
        diff: { executionFailed: effectsError },
        refLedgerId: decision.id,
        createdAt: ctx.run.clock.nowISO(),
      });
      effectsAuditId = auditId;
    } catch (auditCause) {
      // Same fail-open rationale as action.decide's post-decision audit append:
      // an already-persisted approval plus a failed effect must stay visible
      // even when the failure-audit append itself also fails.
      console.error("action.reconcileApproved: failed to append effect-retry audit", auditCause);
    }
    return {
      proposalId,
      effects: { materialized: false, sent: false },
      dealPilotEffects: [],
      effectsStatus: "failed" as const,
      effectsError,
      ...(effectsAuditId ? { effectsAuditId } : {}),
    };
  }
}

export const taskOutcomeInput = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  measure: z.string().trim().min(1),
  target: z.string().trim().min(1),
  current: z.string().optional(),
  indicatorKind: z.enum(["leading", "lagging"]),
  northStar: z.boolean().optional(),
});

export const taskRecordStatusInput = z.enum([
  "candidate",
  "committed",
  "pending",
  "in_progress",
  "blocked",
  "done",
  "parked",
  "abandoned",
  "archived",
]);

export function normalizeTaskOutcomes(outcomes: z.infer<typeof taskOutcomeInput>[]): TaskOutcome[] {
  return outcomes.map((outcome) => ({
    id: outcome.id,
    title: outcome.title,
    measure: outcome.measure,
    target: outcome.target,
    indicatorKind: outcome.indicatorKind,
    ...(outcome.current !== undefined ? { current: outcome.current } : {}),
    ...(outcome.northStar !== undefined ? { northStar: outcome.northStar } : {}),
  }));
}

export const taskRestructureInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("promote"), taskId: z.string().uuid() }),
  z.object({ kind: z.literal("re_parent"), taskId: z.string().uuid(), parentTaskId: z.string().uuid() }),
  z.object({ kind: z.literal("reorder"), taskId: z.string().uuid(), sortOrder: z.number().int().positive() }),
  z.object({
    kind: z.literal("insert_ancestor_above"),
    taskId: z.string().uuid(),
    ancestor: z.object({
      id: z.string().uuid().optional(),
      title: z.string().trim().min(1),
      ownerType: z.enum(["human", "agent"]),
      ownerId: z.string().uuid(),
      isGoal: z.boolean().optional(),
      outcomes: z.array(taskOutcomeInput).optional(),
      exitTest: z.string().trim().min(1).optional(),
    }),
  }),
]);

export const TASK_MANAGER_PROJECTION_FILE = "tasks.md";

/**
 * Run one Task Manager Automation as its owning Agent and return the governed
 * proposal (ADR-203).
 *
 * The three Event-fired Automations this replaces already raised a governed
 * proposal that halted for Human review, so the gap was never governance — it
 * was ATTRIBUTION. Each proposal's actor was the Human who happened to trigger
 * it and its skill was `KERNEL_PASSTHROUGH_SKILL`, so the analysis Internal
 * Strategist supposedly performed had no Agent Run behind it and no Skill
 * invocation to point at. Routing them through the executor makes the Agent
 * the actor, runs the real Skill, and records the Run — and, because an Agent
 * actor is subject to the allow-list and capability scope a Human bypasses,
 * it is strictly MORE governed than what it replaces, not a convenience.
 */
export async function runTaskManagerAgentAutomation(
  // Structurally typed to exactly the three fields it uses rather than the
  // whole `ApiContext`: tRPC narrows the context per procedure, and requiring
  // the full shape would only force call sites to widen it back.
  ctx: { wiring: Wiring; run: RunCtx; identity: Actor },
  args: {
    organizationId: string;
    automationId: string;
    name: string;
    agentId: string;
    skill: string;
    action: Action;
    params: Record<string, unknown>;
    runId: string;
    /** Shared with the queue-side row so one Human decision resolves both —
     * the pairing `projection_reconcile` and `archive_sweep` established. */
    proposalId?: string;
    taintKey: string;
  },
): Promise<{ runId: string; proposal: Proposal }> {
  await ensureTaskManagerAutomation(ctx.wiring, args.organizationId, {
    automationId: args.automationId,
    name: args.name,
    agentId: args.agentId,
    skill: args.skill,
    action: args.action,
  }, ctx.run);
  const run = await ctx.wiring.automationExecutor.runById({
    organizationId: args.organizationId,
    automationId: args.automationId,
    onBehalfOf: { type: "user", id: ctx.identity.id },
    params: args.params,
    seed: args.runId,
    runId: args.runId,
    ...(args.proposalId ? { proposalId: args.proposalId } : {}),
  }, withHumanInputTaint(ctx.run, args.taintKey, { automationId: args.automationId }));
  const governed = run.proposals[0];
  if (!governed || governed.status === "rejected") {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${args.name} did not run (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
    });
  }
  return { runId: args.runId, proposal: governed };
}

/** How far back the approval gate reads its own track record. Bounded because
 * `listHistory` is paginated and an unbounded scan of the ledger to answer one
 * gate question would grow without limit. */
export const TASK_CHANGE_HISTORY_LIMIT = 200;

/**
 * Count the vetted Human approve/veto decisions on THIS change kind (ADR-202).
 *
 * The calibration input has to be real history. `taskManager.approvalBand`,
 * the read-only query that predates the gate, takes `approvals`/`vetoes` as
 * client inputs — so anything calling it could hand itself a calibrated
 * verdict, and a gate that trusts the caller's account of its own track record
 * is not a gate.
 *
 * Only the gate's own prior proposals count. A decision on some other kind of
 * proposal says nothing about whether this Human's reschedules have been
 * sound, which is the only thing calibration is entitled to conclude.
 */
export async function countTaskChangeDecisions(
  wiring: Wiring,
  organizationId: string,
  kind: "route" | "reschedule",
): Promise<{ approvals: number; vetoes: number }> {
  const history = await wiring.ledger.listHistory(organizationId, {
    limit: TASK_CHANGE_HISTORY_LIMIT,
    offset: 0,
  });
  let approvals = 0;
  let vetoes = 0;
  for (const entry of history.items) {
    // `skill` is the capability-attribution key, so matching on it is what
    // makes "this gate's own history" a fact rather than a guess about which
    // rows happened to carry a `changeKind`.
    if (entry.skill !== "task-manager.change-gate") continue;
    const inputs = entry.inputs as { changeKind?: unknown } | null | undefined;
    if (!inputs || inputs.changeKind !== kind) continue;
    if (entry.userDecision === "approve") approvals += 1;
    else if (entry.userDecision === "veto") vetoes += 1;
  }
  return { approvals, vetoes };
}

/**
 * Run the Governance approval gate for one proposed change (ADR-202).
 *
 * Extracted from `taskManager.runChangeGate` when ADR-207 gave the gate a
 * second caller. One implementation on purpose: a gate with two copies is two
 * gates, and the moment they differ the looser one is the real policy.
 */
export async function runTaskChangeGate(
  ctx: { wiring: Wiring; run: RunCtx; identity: Actor },
  args: {
    organizationId: string;
    kind: "route" | "reschedule";
    deltaDays?: number;
    candidateCount?: number;
    crossesModule?: boolean;
    idempotencyKey: string;
  },
): Promise<{
  runId: string;
  proposal: Proposal;
  band: unknown;
  decision: unknown;
  calibration: { approvals: number; vetoes: number; source: "decision ledger" };
}> {
  const automationId = args.kind === "reschedule"
    ? TASK_MANAGER_RESCHEDULE_GATE_AUTOMATION_ID
    : TASK_MANAGER_ROUTING_GATE_AUTOMATION_ID;
  await ensureTaskManagerAutomation(ctx.wiring, args.organizationId, {
    automationId,
    name: args.kind === "reschedule"
      ? "Task Manager reschedule approval gate"
      : "Task Manager routing approval gate",
    agentId: GOVERNANCE_AGENT,
    skill: "task-manager.change-gate",
    action: "read",
  }, ctx.run);

  const history = await countTaskChangeDecisions(ctx.wiring, args.organizationId, args.kind);
  const runId = idempotentUuid(
    `${args.organizationId}:change_gate_run:${args.kind}:${args.idempotencyKey}`,
  );
  const run = await ctx.wiring.automationExecutor.runById({
    organizationId: args.organizationId,
    automationId,
    onBehalfOf: { type: "user", id: ctx.identity.id },
    params: {
      changeKind: args.kind,
      ...(args.deltaDays !== undefined ? { deltaDays: args.deltaDays } : {}),
      ...(args.candidateCount !== undefined ? { candidateCount: args.candidateCount } : {}),
      ...(args.crossesModule !== undefined ? { crossesModule: args.crossesModule } : {}),
      approvals: history.approvals,
      vetoes: history.vetoes,
      // The identity that ASKED. An Agent-proposed change always needs a
      // Human whatever the history says — calibration widens what a Human
      // may do unattended, never what an Agent may.
      actorType: ctx.identity.type === "user" ? "human" : "agent",
    },
    seed: args.idempotencyKey,
    runId,
  }, withHumanInputTaint(
    ctx.run,
    `task-manager:${args.kind}-approval-gate:${ctx.identity.id}:${runId}`,
    { kind: args.kind },
  ));
  const governed = run.proposals[0];
  if (!governed || governed.status === "rejected") {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${args.kind} approval gate did not decide (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
    });
  }
  const output = (governed.output?.proposedOutput ?? {}) as Record<string, unknown>;
  return {
    runId,
    proposal: governed,
    band: output["band"],
    decision: output["decision"],
    calibration: { ...history, source: "decision ledger" as const },
  };
}

/**
 * One entry of a human's edited planning plan (ADR-200).
 *
 * The union of every field any planning kind materializes from, and `.strict()`
 * so an edit cannot introduce a key of its own. That matters most for `kind`,
 * which is what decides WHICH branch of the materializer runs: it is absent
 * here and read from the staged draft, so a reviewer can correct a plan but
 * never convert a reviewed pre-mortem into an unreviewed decomposition.
 * `mergeEditedPlanningPayload` then re-validates the whole set against the
 * kind, and the materializer validates every entry again on the way to the
 * queue — this schema is the outer bound, not the only check.
 */
export const EDITED_PLANNING_ITEM = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  exitTest: z.string().trim().min(1).max(2_000).optional(),
  measure: z.string().trim().min(1).max(2_000).optional(),
  target: z.string().trim().min(1).max(2_000).optional(),
  indicatorKind: z.enum(["leading", "lagging"]).optional(),
  proposedTitle: z.string().trim().min(1).max(160).optional(),
  taskId: z.string().uuid().optional(),
}).strict();

export function sha256Content(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function idempotentUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function requireInstalledTaskManager(wiring: Wiring, organizationId: string) {
  const installation = await wiring.moduleStore.getAvailable(organizationId, "task-manager");
  if (!installation || installation.status !== "installed" || !installation.manifest.module) {
    throw new TRPCError({ code: "NOT_FOUND", message: "installed Task Manager Module not found" });
  }

  return installation;
}

/**
 * The one place a Module's local-Files folder label is decided (TASK-081).
 *
 * `~/Documents/Bridge/<Organization>/<label>/` holds the owner's own documents,
 * so this expression cannot be spelled out at each call site: two sites that
 * disagree put a Module's Files in two directories, and the one the user is
 * not looking at appears empty. The precedence is
 * `displayNameOverride` (what this Organization renamed it to) -> the
 * manifest's display name -> the canonical Module name.
 *
 * `modules.rename` is the only writer of the override, and it MOVES the folder
 * in the same call — see `renameModuleFolder`.
 */
export function moduleFolderLabel(installation: ModuleInstallationRow): string {
  return installation.displayNameOverride
    ?? installation.manifest.module?.displayName
    ?? installation.moduleName;
}

export async function requireOrganizationNameForFiles(
  wiring: Wiring,
  organizationId: string,
  userId: string,
): Promise<string> {
  const organization = (await wiring.organizationStore.listOrganizations(userId))
    .find((candidate) => candidate.id === organizationId);
  if (!organization) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found" });
  }
  return organization.name;
}

export async function replaceTaskProjectionFile(
  wiring: Wiring,
  organizationName: string,
  moduleName: string,
  expectedHash: string | null,
  content: string,
) {
  try {
    return await replaceModuleFileContent(
      organizationName,
      moduleName,
      TASK_MANAGER_PROJECTION_FILE,
      expectedHash,
      Buffer.from(content, "utf8"),
      wiring.moduleFilesBridgeRoot,
    );
  } catch (error) {
    if (error instanceof ModuleFileContentConflictError) {
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    }
    throw error;
  }
}

export const CHAT_TASK_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000f9";
export const CHAT_TASK_SKILL_ID = "task-manager.create-task";
export const CHAT_MODEL_TIER: ModelTier = "default";
export const CHAT_TURN_STALE_AFTER_MS = 10 * 60_000;
export const chatTurnAbortControllers = new Map<string, AbortController>();
export const chatTurnProposalStaging = new Set<string>();

export function chatOwnerScope(
  organizationId: string,
  ownerUserId: string,
): ChatOwnerScope {
  return { organizationId, ownerUserId };
}

export function chatHumanTaint(
  thread: ChatThread,
  ref: string,
  value: unknown,
) {
  return labelAtSource("human_input", {
    ref,
    valueHash: hashTaintValue(value),
    sensitivity: thread.dataScope,
    instructionRisk: "instruction_like",
  });
}

export function withHumanInputTaint(
  run: RunCtx,
  ref: string,
  value: unknown,
): RunCtx {
  const inputLabel = labelAtSource("human_input", {
    ref,
    valueHash: hashTaintValue(value),
    sensitivity: "organization",
    instructionRisk: "instruction_like",
  });
  const ambientLabel =
    run.taintLabel ??
    (run.taint
      ? labelFromLegacyTrustOrigin(run.taint, `${ref}:ambient`)
      : null);
  return {
    ...run,
    taintLabel: ambientLabel
      ? joinTaintLabels(ambientLabel, inputLabel)
      : inputLabel,
  };
}

export function resolveChatModel(wiring: Wiring, plane: "local" | "cloud"): ModelProvider | null {
  const candidates = [...wiring.models.providers().values()]
    .filter((provider) => provider.id !== "echo")
    .filter((provider) => provider.plane === plane)
    .filter((provider) => provider.tiers.includes(CHAT_MODEL_TIER))
    .sort((left, right) => {
      const localOrder = [MANAGED_LLAMA_PROVIDER_ID, "ollama"];
      if (plane === "local") {
        const leftIndex = localOrder.indexOf(left.id);
        const rightIndex = localOrder.indexOf(right.id);
        const leftRank = leftIndex === -1 ? localOrder.length : leftIndex;
        const rightRank = rightIndex === -1 ? localOrder.length : rightIndex;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      return left.id.localeCompare(right.id);
    });
  return candidates[0] ?? null;
}

/**
 * The conversation so far, rendered for an engine that was not part of it.
 *
 * Deliberately bounded and deliberately plain: the most recent completed turns
 * as `User:`/`Assistant:` lines, oldest first, capped so a long thread cannot
 * blow the receiving agent's context on turn one. The user's OWN words are
 * carried verbatim (a paraphrase would put words in their mouth); assistant
 * turns are truncated, since what matters is what was decided, not every word
 * of how it was said. Returns null when there is nothing to carry.
 */
export async function priorTurnsTranscript(
  wiring: Wiring,
  scope: ChatOwnerScope,
  threadId: string,
): Promise<string | null> {
  const CARRY_TURNS = 20;
  const CARRY_CHARS = 12_000;
  const recent = await wiring.chatStore.listRecentTurns(scope, threadId, CARRY_TURNS);
  const lines: string[] = [];
  for (const turn of recent) {
    if (turn.state !== "completed" || turn.content.trim().length === 0) continue;
    const speaker = turn.role === "user" ? "User" : "Assistant";
    const body =
      turn.role === "user" ? turn.content : turn.content.slice(0, 1_500);
    lines.push(`${speaker}: ${body}`);
  }
  if (lines.length === 0) return null;
  let transcript = lines.join("\n\n");
  while (transcript.length > CARRY_CHARS && lines.length > 1) {
    lines.shift();
    transcript = lines.join("\n\n");
  }
  return `Earlier in this conversation:\n\n${transcript}`;
}

export async function chatCanCreateTask(
  wiring: Wiring,
  organizationId: string,
): Promise<boolean> {
  const page = await wiring.moduleStore.list(organizationId, { limit: 10_000, offset: 0 });
  const installed = page.items.some(
    (module) => module.moduleName === "task-manager" && module.status === "installed",
  );
  const manifests = wiring.skillManifests.forSkill(organizationId, CHAT_TASK_SKILL_ID);
  const completeManifest = manifests.some(
    (manifest) => manifest.inputSchema !== undefined && manifest.outputSchema !== undefined,
  );
  return (
    installed &&
    completeManifest &&
    (await wiring.agents.organizationId(INTERNAL_STRATEGIST_AGENT)) === organizationId &&
    await wiring.agents.isActive(INTERNAL_STRATEGIST_AGENT) &&
    (await wiring.agents.allowedSkills(INTERNAL_STRATEGIST_AGENT)).includes(CHAT_TASK_SKILL_ID)
  );
}

export function resolvedChatSurface(
  surface: z.infer<typeof chatSurfaceInput> | undefined,
) {
  const kind = surface?.kind ?? "chat_panel";
  const labels: Record<typeof kind, string> = {
    chat_panel: "Right Chat Panel",
    chief_of_staff_page: "Chief of Staff",
    avatar_overlay: "Avatar Chat",
    task_manager: "Task Manager",
  };
  return {
    kind,
    id: surface?.id ?? kind,
    label: labels[kind],
  };
}

export async function assembleChatCompletion(
  ctx: Pick<ApiContext, "identity" | "run" | "wiring">,
  thread: ChatThread,
  message: string,
  surface: z.infer<typeof chatSurfaceInput> | undefined,
  provider: ModelProvider,
  excludeTurnIds: readonly string[] = [],
) {
  const scope = chatOwnerScope(thread.organizationId, thread.ownerUserId);
  const historyLimit = 24;
  const excluded = new Set(excludeTurnIds);
  const recent = await ctx.wiring.chatStore.listRecentTurns(
    scope,
    thread.id,
    historyLimit + excluded.size,
  );
  const stableTurns = recent
    .filter((turn) => !excluded.has(turn.id))
    .filter((turn) => turn.role === "user" || turn.role === "assistant" || turn.role === "skill")
    .filter((turn) => turn.state === "completed" || turn.state === "awaiting_decision")
    .slice(-historyLimit);
  const exchanges: ChatTurn[][] = [];
  for (const turn of stableTurns) {
    if (turn.role === "user" || exchanges.length === 0) exchanges.push([]);
    exchanges.at(-1)!.push(turn);
  }
  const selectedExchanges: ChatTurn[][] = [];
  let selectedCharacters = 0;
  for (const exchange of [...exchanges].reverse()) {
    const exchangeCharacters = exchange.reduce(
      (total, turn) => total + turn.content.length,
      0,
    );
    if (selectedCharacters + exchangeCharacters > 64_000) break;
    selectedCharacters += exchangeCharacters;
    selectedExchanges.unshift(exchange);
  }
  const history = selectedExchanges
    .flat()
    .map((turn) => ({
      role: turn.role as "user" | "assistant" | "skill",
      content: turn.content,
      dataScope: thread.dataScope,
      taintLabel: turn.taintLabel,
    }));

  const isCloud = provider.plane === "cloud";
  const profileRow = isCloud
    ? null
    : await ctx.wiring.onboardingProfileStore.get(thread.organizationId);
  const profile = profileRow ? profileFromRow(profileRow) : undefined;
  const persona = buildChiefOfStaffPersona(
    profile ?? { organizationId: thread.organizationId, source: "onboarding" },
  );
  const canCreateTask = !isCloud &&
    await chatCanCreateTask(ctx.wiring, thread.organizationId);
  const responseSchema = canCreateTask
    ? CHAT_ASSISTANT_RESPONSE_SCHEMA
    : provider.id === MANAGED_LLAMA_PROVIDER_ID
      ? CHAT_LLAMA_PUBLIC_RESPONSE_SCHEMA
      : CHAT_PUBLIC_RESPONSE_SCHEMA;

  // LA5 retrieval fusion (flight-gated, Local Plane only): the memory slot
  // is filled by structured+vector+graph RRF fusion instead of the naive
  // newest-8 slice. Flight off → the pre-fusion behavior below, unchanged.
  const fusion = !isCloud && ctx.wiring.retrievalFusionEnabled
    ? await fusedChatMemory({
        memoryStore: ctx.wiring.memoryStore,
        vectorIndex: ctx.wiring.vectorIndex,
        graphStore: ctx.wiring.graphStore,
        // K3: accepted claims join the graph lane, flight-gated separately so
        // the substrate can be killed without touching fusion (and vice versa).
        ...(ctx.wiring.claimSubstrateEnabled ? { claimStore: ctx.wiring.claimStore } : {}),
        organizationId: thread.organizationId,
        ownerUserId: thread.ownerUserId,
        query: message,
        ...(ctx.wiring.semanticEmbedder ? { embedder: ctx.wiring.semanticEmbedder } : {}),
      })
    : null;
  const memoryRows = isCloud || fusion
    ? []
    : await ctx.wiring.memoryStore.retrieve(
        { limit: 8 },
        { organizationId: thread.organizationId, userId: thread.ownerUserId },
      );
  const selectedMemory = memoryRows
    .filter((entry) => entry.plane === "local")
    // Learning-loop rows are stored as JSON machinery (signals, suggestion
    // lineages, minted preferences) — never prompt-ready text. Preferences
    // reach the model below as statements; signals/suggestions never do.
    .filter((entry) => !isLearningObservationEntry(entry))
    .slice(0, 5);
  const memory = fusion
    ? fusion.snippets
    : selectedMemory.map((entry) => ({
        source: `memory:${entry.id}`,
        text: entry.content.slice(0, 4_000),
        score: entry.confidence,
        trustOrigin: entry.trustOrigin,
      }));
  // TASK-032 prototype-test clause "accepting mints one preference whose
  // statement reaches projectToSystemPrompt output" — accepted preferences
  // (the ONLY rows acceptSuggestion mints, Human-gated) project into the
  // run-context memory slot. Flight-gated and Local-Plane only: the flight
  // off means learned preferences influence nothing, and the cloud consent
  // boundary never sees them.
  const learnedPreferences = isCloud || !ctx.wiring.learningObservationEnabled
    ? []
    : (await retrieveLearnedPreferences(
        ctx.wiring.memoryStore,
        { organizationId: thread.organizationId, userId: thread.ownerUserId },
      )).slice(0, 5);
  const preferenceSnippets = preferencesToMemorySnippets(learnedPreferences);
  const combinedMemory = [...preferenceSnippets, ...memory];

  const runContext = assembleRunContext(
    {
      persona,
      request: message,
      surface: resolvedChatSurface(surface),
      disclosedCapabilities: canCreateTask
        ? [{
            manifestId: CHAT_TASK_SKILL_ID,
            name: "Create a Task",
            capabilityType: "skill",
            audience: "private",
            reason:
              "The installed Task Manager exposes a schema-complete create-Task Skill owned by the active Internal Strategist.",
          }]
        : [],
      governance: {
        approvalRequirement: "explicit_human",
        trustGrants: [],
      },
      memory: combinedMemory,
      conversationHistory: history,
      outputContract: {
        description: canCreateTask
         ? "Return one JSON object matching the supplied schema. All five keys are required. kind MUST be create_task whenever the person gives you work to do — an instruction, a request to build, change, fix, find, arrange, follow up on, or remember something, whether or not they use the word Task. Wanting it done later, or delegated, still counts. kind MUST be answer when they are only asking a question, and clarification when you cannot tell what the work is and one question would settle it — never use clarification to avoid capturing work you already understand. For create_task, text MUST explain that the Task proposal is ready for review, and title, outcome, and exitTest MUST describe the work they asked for: title is the work in their own terms, outcome is what is true when it is done, exitTest is how anyone checks that. Never put the Task title in text instead of title. For answer and clarification, put the response in text and set title, outcome, and exitTest to empty strings. Creating a Task is a proposal and must not be described as already completed."
          : "Return one JSON object matching the supplied schema. Answer directly or ask one clarification. No mutation capability is available in this context.",
        schema: responseSchema,
      },
    },
    ctx.run,
  );
  const currentTaint = chatHumanTaint(
    thread,
    `chat:${thread.id}:request`,
    message,
  );
  const memoryTaints = fusion
    ? fusion.taints
    : selectedMemory.map(
        (entry) =>
          entry.taintLabel ??
          labelFromLegacyTrustOrigin(entry.trustOrigin, `memory:${entry.id}`),
      );
  // acceptSuggestion always writes preferences with trustOrigin
  // "user_content" and no explicit label, so the legacy mapping here is
  // exactly what the stored rows carry.
  const preferenceTaints = learnedPreferences.map((preference) =>
    labelFromLegacyTrustOrigin("user_content", `memory:${preference.memoryId}`),
  );
  const taintLabel = joinTaintLabels(
    currentTaint,
    ...history.map((segment) => segment.taintLabel),
    ...memoryTaints,
    ...preferenceTaints,
  );
  const system = projectToSystemPrompt(runContext);
  const request = {
    system,
    prompt: message,
    maxTokens: 1_024,
    tier: CHAT_MODEL_TIER,
    cache: { strategy: "stable_system_prefix" as const, ttl: "5m" as const },
    responseFormat: {
      type: "json_schema" as const,
      name: "BridgeChatTurn",
      schema: responseSchema,
      strict: true,
    },
    taintLabel,
  };
  const contextDigest = hashTaintValue({
    version: 1,
    threadId: thread.id,
    providerId: provider.id,
    providerPlane: provider.plane,
    tier: CHAT_MODEL_TIER,
    request,
  });
  return {
    request,
    contextDigest,
    canCreateTask,
    disclosure: {
      providerId: provider.id,
      providerPlane: provider.plane,
      modelTier: CHAT_MODEL_TIER,
      system: request.system,
      currentMessage: message,
      history: history.map(({ role, content, dataScope }) => ({ role, content, dataScope })),
      memory: combinedMemory.map(({ source, text }) => ({ source, text })),
      surface: resolvedChatSurface(surface),
    },
  };
}

export function parseChatAssistantEnvelope(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("chat model returned invalid JSON");
  }
  const wireResult = z.object({
    kind: z.enum(["answer", "clarification", "create_task"]),
    text: z.string(),
    title: z.string().optional(),
    outcome: z.string().optional(),
    exitTest: z.string().optional(),
  }).strict().safeParse(parsed);
  if (!wireResult.success) {
    throw new Error("chat model returned an invalid response envelope");
  }
  const candidate = wireResult.data.kind === "create_task"
    ? wireResult.data
    : {
        kind: wireResult.data.kind,
        text: wireResult.data.text,
      };
  const result = chatAssistantEnvelopeSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error("chat model returned an invalid response envelope");
  }
  return result.data;
}

export async function addChatTurnRef(
  wiring: Wiring,
  scope: ChatOwnerScope,
  threadId: string,
  turnId: string,
  kind: ChatTurnRef["kind"],
  refId: string,
): Promise<void> {
  await wiring.chatStore.addTurnRef(scope, {
    id: idempotentUuid(`${turnId}:${kind}:${refId}`),
    threadId,
    turnId,
    kind,
    refId,
  });
}

/**
 * Records the files an agentic backend changed on this turn. The backend edits
 * the user's Bridge folder directly, so without this the only evidence of a
 * write is the model's own prose — and prose is not a receipt. One ledger row
 * per turn, referenced from the turn, listing paths only (never contents).
 */
export async function appendChatBackendChangedFiles(
  ctx: Pick<ApiContext, "run" | "wiring">,
  thread: ChatThread,
  assistantTurnId: string,
  changedPaths: readonly string[],
): Promise<string> {
  const id = idempotentUuid(`${assistantTurnId}:backend-changed-files`);
  await ctx.wiring.ledger.append({
    id,
    organizationId: thread.organizationId,
    actorType: "agent",
    // The ledger's actor column is a uuid, and an agentic backend editing the
    // user's folder IS the Builder acting — the engine that did it is named in
    // `inputs.backend`.
    actorId: BUILDER_AGENT_RUNTIME_ID,
    action: "write",
    resourceType: "record",
    inputs: {
      operation: "chat_backend_changed_files",
      threadId: thread.id,
      assistantTurnId,
      backend: thread.backend,
      fileCount: changedPaths.length,
    },
    proposedOutput: { changedPaths: [...changedPaths] },
    userDecision: "auto",
    policyResults: [],
    dataScope: thread.dataScope,
    taintLabel: chatHumanTaint(
      thread,
      `chat:${assistantTurnId}:backend-changed-files`,
      { changedPaths: [...changedPaths] },
    ),
    createdAt: ctx.run.clock.nowISO(),
  });
  return id;
}

export async function appendChatRoutingDecision(
  ctx: Pick<ApiContext, "run" | "wiring">,
  thread: ChatThread,
  assistantTurnId: string,
  decision: {
    kind: "direct_answer" | "clarification" | "skill";
    selectedSkillId?: string;
    selectedAgentId?: string;
    alternativesRejected?: readonly unknown[];
  },
): Promise<string> {
  const id = idempotentUuid(`${assistantTurnId}:routing-decision`);
  await ctx.wiring.ledger.append({
    id,
    organizationId: thread.organizationId,
    actorType: "agent",
    actorId: decision.selectedAgentId ?? INTERNAL_STRATEGIST_AGENT,
    action: "read",
    resourceType: "record",
    inputs: {
      operation: "chat_route",
      threadId: thread.id,
      assistantTurnId,
      promptStored: false,
    },
    proposedOutput: decision,
    userDecision: "auto",
    policyResults: [],
    dataScope: thread.dataScope,
    taintLabel: chatHumanTaint(
      thread,
      `chat:${assistantTurnId}:routing-decision`,
      decision,
    ),
    createdAt: ctx.run.clock.nowISO(),
  });
  return id;
}

export async function resolveChatCreateTaskSkill(
  wiring: Wiring,
  organizationId: string,
  goalTaskRef: { goalId: string; taskId: string },
) {
  const [goal, task, organization, active, capabilityScope, dataScope] =
    await Promise.all([
      wiring.goalTasks.getGoal(organizationId, goalTaskRef.goalId),
      wiring.goalTasks.getTask(organizationId, goalTaskRef.taskId),
      wiring.agents.organizationId(INTERNAL_STRATEGIST_AGENT),
      wiring.agents.isActive(INTERNAL_STRATEGIST_AGENT),
      wiring.agents.capabilityScope(INTERNAL_STRATEGIST_AGENT),
      wiring.agents.dataScope(INTERNAL_STRATEGIST_AGENT),
    ]);
  if (!goal || !task) throw new Error("chat dispatch could not resolve its Goal/Task");
  const candidates = wiring.skillManifests.forSkill(organizationId, CHAT_TASK_SKILL_ID);
  const resolution = await resolveSkillForTask(candidates, {
    goal,
    task,
    agent: {
      id: INTERNAL_STRATEGIST_AGENT,
      organizationId: organization,
      active,
      capabilityScope,
      plane: "local",
      dataScope,
    },
    skillId: CHAT_TASK_SKILL_ID,
    requestedDataScope: "private",
  });
  if (!resolution.ok || !resolution.manifest) {
    throw new Error(
      `chat dispatch denied ${CHAT_TASK_SKILL_ID}: ${resolution.detail ?? resolution.reason ?? "no eligible Skill"}`,
    );
  }
  if (
    resolution.manifest.inputSchema === undefined ||
    resolution.manifest.outputSchema === undefined
  ) {
    throw new Error(`chat dispatch denied ${CHAT_TASK_SKILL_ID}: incomplete schema`);
  }
  return { ...resolution, manifest: resolution.manifest };
}

/** How far back a thread is scanned for the Task node it already owns. Bounded
 * on purpose (CLAUDE.md: bounded reads) — one page of turns, one cheap
 * deterministic ledger lookup per assistant turn, no extra table. */
export const CHAT_TASK_ANCHOR_SCAN_TURNS = 100;

/** Every Task node this Chat thread has staged, with the Human decision on it.
 * The thread -> Task reference is the one that already exists: the proposal id
 * is derived from the turn id, and the proposal's own inputs name the Task. */
export async function chatThreadTaskNodes(
  wiring: Wiring,
  scope: ChatOwnerScope,
  threadId: string,
): Promise<ChatTaskAnchorCandidate[]> {
  const page = await wiring.chatStore.listTurns(scope, threadId, {
    limit: CHAT_TASK_ANCHOR_SCAN_TURNS,
  });
  const staged = await Promise.all(
    page.items
      .filter((turn) => turn.role === "assistant")
      .map(async (turn) => {
        const entry = await wiring.ledger.get(idempotentUuid(`${turn.id}:proposal`));
        if (!entry || entry.organizationId !== scope.organizationId) return null;
        const input = chatTaskProposalInput(entry);
        if (
          !input ||
          input.chatThreadId !== threadId ||
          input.chatTurnId !== turn.id ||
          entry.onBehalfOfId !== scope.ownerUserId
        ) {
          return null;
        }
        const decision = await wiring.ledger.decisionFor(entry.id);
        return {
          turnId: turn.id,
          sequence: turn.sequence,
          taskId: input.taskId,
          accepted:
            decision?.userDecision === "approve" || decision?.userDecision === "edit",
        } satisfies ChatTaskAnchorCandidate;
      }),
  );
  return staged.filter((candidate): candidate is ChatTaskAnchorCandidate => candidate !== null);
}

/** Open Tasks this owner may legitimately see, shaped for the parent matcher.
 * Another member's private Task is never a suggestion. */
export function chatTaskParentCandidates(
  tasks: readonly TaskRecord[],
  ownerUserId: string,
): ParentCandidateTask[] {
  return tasks
    .filter((task) => task.visibility === "organization" || task.ownerId === ownerUserId)
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      ...(task.outcomes[0]?.target ? { outcome: task.outcomes[0].target } : {}),
      status: task.status,
    }));
}

export async function stageChatTaskProposal(
  ctx: Pick<ApiContext, "identity" | "run" | "wiring">,
  thread: ChatThread,
  assistantTurnId: string,
  envelope: Extract<z.infer<typeof chatAssistantEnvelopeSchema>, { kind: "create_task" }>,
) {
  const scope = chatOwnerScope(thread.organizationId, thread.ownerUserId);
  const proposalId = idempotentUuid(`${assistantTurnId}:proposal`);
  const runId = idempotentUuid(`${assistantTurnId}:automation-run`);
  const goalTaskRef = await ensureTaskManagerAutomation(
    ctx.wiring,
    thread.organizationId,
    {
      automationId: CHAT_TASK_AUTOMATION_ID,
      name: "Chat Task proposal",
      agentId: INTERNAL_STRATEGIST_AGENT,
      skill: CHAT_TASK_SKILL_ID,
      action: "write",
    },
    ctx.run,
  );
  const resolution = await resolveChatCreateTaskSkill(
    ctx.wiring,
    thread.organizationId,
    goalTaskRef,
  );
  const newTaskId = idempotentUuid(`${assistantTurnId}:task`);
  // The user's directive: one Task node per Chat thread, follow-ups continue
  // it. The node is found from the refs/ledger the thread already has — the
  // parent suggestion is computed deterministically and stays a suggestion.
  const anchor = resolveChatThreadTaskAnchor(
    (await chatThreadTaskNodes(ctx.wiring, scope, thread.id)).filter(
      (candidate) => candidate.turnId !== assistantTurnId,
    ),
  );
  const anchorTask = anchor
    ? await ctx.wiring.taskManager.get(thread.organizationId, anchor.taskId)
    : null;
  const plan = planChatTaskNode({
    title: envelope.title,
    outcome: envelope.outcome,
    ...(anchorTask ? { anchor: { taskId: anchorTask.id, status: anchorTask.status } } : {}),
    candidates: chatTaskParentCandidates(
      await ctx.wiring.taskManager.list(thread.organizationId),
      thread.ownerUserId,
    ),
    newTaskId,
  });
  const taskId = plan.mode === "append" ? plan.taskId : newTaskId;
  const existingProposal = await ctx.wiring.ledger.get(proposalId);
  if (existingProposal) {
    const existingInput = chatTaskProposalInput(existingProposal);
    if (
      !existingInput ||
      existingInput.chatThreadId !== thread.id ||
      existingInput.chatTurnId !== assistantTurnId ||
      !chatLedgerEntryIsProposal(existingProposal)
    ) {
      throw new Error(`Chat proposal ${proposalId} conflicts with its deterministic turn binding`);
    }
    return {
      proposal: { id: existingProposal.id, status: "pending_review" as const },
      runId,
      resolution: {
        selectedSkillId: resolution.manifest.skillId,
        selectedAgentId: INTERNAL_STRATEGIST_AGENT,
        alternativesRejected: resolution.alternativesRejected,
      },
    };
  }
  await Promise.all([
    addChatTurnRef(
      ctx.wiring,
      scope,
      thread.id,
      assistantTurnId,
      "proposal",
      proposalId,
    ),
    addChatTurnRef(
      ctx.wiring,
      scope,
      thread.id,
      assistantTurnId,
      "automation_run",
      runId,
    ),
    ctx.wiring.automationRunRecorder.start(
      {
        runId,
        automationId: CHAT_TASK_AUTOMATION_ID,
        organizationId: thread.organizationId,
        agentId: INTERNAL_STRATEGIST_AGENT,
        taskId: goalTaskRef.taskId,
      },
      ctx.run,
    ),
  ]);
  const proposal = await ctx.wiring.pipeline.propose(
    {
      organizationId: thread.organizationId,
      actor: { type: "agent", id: INTERNAL_STRATEGIST_AGENT },
      onBehalfOf: { type: "user", id: thread.ownerUserId },
      action: "write",
      resourceType: "record",
      resourceId: taskId,
      dataScope: "private",
      inputs: {
        kind: "task_create",
        mode: plan.mode,
        taskId,
        title: envelope.title,
        outcome: envelope.outcome,
        exitTest: envelope.exitTest,
        parentTaskId: plan.mode === "create" ? plan.parent?.taskId ?? null : null,
        parentRationale: plan.mode === "create" ? plan.parent?.reason ?? null : null,
        parentCandidates: plan.mode === "create" ? [...plan.parentCandidates] : [],
        visibility: "private",
        chatThreadId: thread.id,
        chatTurnId: assistantTurnId,
      },
      skill: CHAT_TASK_SKILL_ID,
      trustOrigin: "user_content",
      taintLabel: chatHumanTaint(thread, `chat:${assistantTurnId}:task`, {
        title: envelope.title,
        outcome: envelope.outcome,
        exitTest: envelope.exitTest,
      }),
      goalTaskRef,
    },
    ctx.run,
    { proposalId, requireHumanReview: true },
  );
  return {
    proposal,
    runId,
    resolution: {
      selectedSkillId: resolution.manifest.skillId,
      selectedAgentId: INTERNAL_STRATEGIST_AGENT,
      alternativesRejected: resolution.alternativesRejected,
    },
  };
}

export async function findChatRetryUser(
  wiring: Wiring,
  scope: ChatOwnerScope,
  threadId: string,
  assistant: ChatTurn,
): Promise<ChatTurn | null> {
  const assistantSuffix = ":assistant";
  if (!assistant.clientRequestId.endsWith(assistantSuffix)) return null;
  const clientRequestId = assistant.clientRequestId.slice(
    0,
    -assistantSuffix.length,
  );
  const expectedAssistantId = idempotentUuid(
    `${threadId}:${clientRequestId}:assistant`,
  );
  const userTurnId = idempotentUuid(`${threadId}:${clientRequestId}:user`);
  const user = await wiring.chatStore.getTurn(scope, threadId, userTurnId);
  if (
    assistant.id !== expectedAssistantId ||
    !user ||
    user.role !== "user" ||
    user.clientRequestId !== clientRequestId ||
    user.sequence >= assistant.sequence
  ) {
    return null;
  }
  return user;
}

export async function resolveChatRetryPair(
  wiring: Wiring,
  scope: ChatOwnerScope,
  threadId: string,
  assistantTurnId: string,
) {
  const assistant = await wiring.chatStore.getTurn(
    scope,
    threadId,
    assistantTurnId,
  );
  if (!assistant || assistant.role !== "assistant") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Failed Chat turn not found",
    });
  }
  if (assistant.state !== "failed") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Chat turn is ${assistant.state}, not failed`,
    });
  }
  const user = await findChatRetryUser(wiring, scope, threadId, assistant);
  if (!user) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The failed Chat turn has no matching user request",
    });
  }
  return { assistant, user };
}

export async function completeDecidedChatTurn(
  wiring: Wiring,
  scope: ChatOwnerScope,
  threadId: string,
  turn: ChatTurn,
): Promise<ChatTurn> {
  let current = turn;
  try {
    if (current.state === "queued") {
      current = await wiring.chatStore.updateTurn(scope, {
        threadId,
        turnId: current.id,
        expectedState: "queued",
        state: "processing",
      });
    }
    if (current.state === "processing" || current.state === "awaiting_decision") {
      current = await wiring.chatStore.updateTurn(scope, {
        threadId,
        turnId: current.id,
        expectedState: current.state,
        state: "completed",
        ...(current.content
          ? {}
          : { content: "This Task proposal was reviewed and recorded." }),
      });
    }
    return current;
  } catch (error) {
    if (!(error instanceof ChatStoreConflictError)) throw error;
    return (await wiring.chatStore.getTurn(scope, threadId, turn.id)) ?? current;
  }
}

export async function recordChatTaskResult(
  wiring: Wiring,
  scope: ChatOwnerScope,
  input: { chatThreadId: string; chatTurnId: string },
  runId: string,
): Promise<void> {
  const turn = await wiring.chatStore.getTurn(
    scope,
    input.chatThreadId,
    input.chatTurnId,
  );
  if (!turn) return;
  try {
    await addChatTurnRef(
      wiring,
      scope,
      input.chatThreadId,
      input.chatTurnId,
      "result",
      runId,
    );
    await completeDecidedChatTurn(
      wiring,
      scope,
      input.chatThreadId,
      turn,
    );
  } catch (error) {
    if (!(error instanceof ChatStoreNotFoundError)) throw error;
  }
}

export async function loadChatThreadView(
  wiring: Wiring,
  scope: ChatOwnerScope,
  threadId: string,
  run: RunCtx,
  cursor?: { sequence: number },
) {
  const thread = await wiring.chatStore.getThread(scope, threadId);
  if (!thread) throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
  const page = await wiring.chatStore.listTurns(scope, threadId, {
    limit: 100,
    ...(cursor ? { cursor } : {}),
  });
  const now = Date.now();
  const turns = await Promise.all(
    page.items.map(async (turn) => {
      let refs = await wiring.chatStore.listTurnRefs(scope, threadId, turn.id);
      const proposalRef = refs.find((ref) => ref.kind === "proposal");
      const linkedProposal = proposalRef
        ? await wiring.ledger.get(proposalRef.refId)
        : null;
      const proposal =
        linkedProposal &&
        linkedProposal.organizationId === scope.organizationId &&
        chatLedgerEntryIsProposal(linkedProposal)
          ? linkedProposal
          : null;
      const decision = proposal
        ? await wiring.ledger.decisionFor(proposal.id)
        : null;
      const taskInput = proposal ? chatTaskProposalInput(proposal) : null;
      let reconciled = turn;

      if (
        proposal &&
        !decision &&
        (reconciled.state === "queued" || reconciled.state === "processing")
      ) {
        try {
          if (reconciled.state === "queued") {
            reconciled = await wiring.chatStore.updateTurn(scope, {
              threadId,
              turnId: reconciled.id,
              expectedState: "queued",
              state: "processing",
            });
          }
          reconciled = await wiring.chatStore.updateTurn(scope, {
            threadId,
            turnId: reconciled.id,
            expectedState: "processing",
            state: "awaiting_decision",
            ...(reconciled.content
              ? {}
              : { content: "This Task proposal is ready for your review." }),
          });
        } catch (error) {
          if (!(error instanceof ChatStoreConflictError)) throw error;
          reconciled =
            (await wiring.chatStore.getTurn(scope, threadId, turn.id)) ?? reconciled;
        }
      }

      if (
        taskInput &&
        decision &&
        (decision.userDecision === "approve" ||
          decision.userDecision === "edit" ||
          decision.userDecision === "veto")
      ) {
        const taskResult = await finishChatTaskDecision(
          wiring,
          proposal!,
          taskInput,
          decision.proposedOutput,
          decision.userDecision,
          scope.ownerUserId,
          run,
        );
        if (taskResult) {
          await addChatTurnRef(
            wiring,
            scope,
            threadId,
            turn.id,
            "result",
            taskResult.runId,
          );
          refs = await wiring.chatStore.listTurnRefs(scope, threadId, turn.id);
          reconciled = await completeDecidedChatTurn(
            wiring,
            scope,
            threadId,
            reconciled,
          );
        }
      }

      if (
        (reconciled.state === "queued" || reconciled.state === "processing") &&
        !chatTurnAbortControllers.has(reconciled.id)
      ) {
        const updatedAt = Date.parse(reconciled.updatedAt);
        if (
          !Number.isFinite(updatedAt) ||
          now - updatedAt >= CHAT_TURN_STALE_AFTER_MS
        ) {
          try {
            reconciled = await wiring.chatStore.updateTurn(scope, {
              threadId,
              turnId: reconciled.id,
              expectedState: reconciled.state,
              state: "failed",
              content:
                "This turn was interrupted before it finished. You can retry it safely.",
              errorCode: "interrupted",
            });
          } catch (error) {
            if (!(error instanceof ChatStoreConflictError)) throw error;
            reconciled =
              (await wiring.chatStore.getTurn(scope, threadId, turn.id)) ??
              reconciled;
          }
        }
      }

      const runRef = refs.find((ref) => ref.kind === "automation_run");
      const automationRun = runRef
        ? await wiring.automationRunRecorder.get(scope.organizationId, runRef.refId)
        : null;
      const task =
        taskInput &&
        decision &&
        (decision.userDecision === "approve" || decision.userDecision === "edit")
          ? await wiring.taskManager.get(scope.organizationId, taskInput.taskId)
          : null;
      const retryUser =
        reconciled.role === "assistant" && reconciled.state === "failed"
          ? await findChatRetryUser(wiring, scope, threadId, reconciled)
          : null;
      return {
        ...reconciled,
        refs,
        proposal,
        decision,
        automationRun,
        retryRequest: retryUser
          ? {
              clientRequestId: retryUser.clientRequestId,
              content: retryUser.content,
            }
          : null,
        result:
          automationRun && automationRun.status !== "running"
            ? { output: automationRun.output ?? null, task }
            : null,
      };
    }),
  );
  return { thread, turns, nextCursor: page.nextCursor ?? null };
}

export function chatLedgerEntryIsProposal(entry: LedgerEntry): boolean {
  return (
    entry.refLedgerId === undefined &&
    entry.userDecision === null &&
    !(
      typeof entry.diff === "object" &&
      entry.diff !== null &&
      !Array.isArray(entry.diff) &&
      "rejected" in entry.diff
    )
  );
}

export function chatTaskProposalInput(entry: LedgerEntry) {
  const parsed = z.object({
    kind: z.literal("task_create"),
    mode: z.enum(["create", "append"]).default("create"),
    taskId: z.string().uuid(),
    title: z.string().trim().min(1),
    outcome: z.string().trim().min(1),
    exitTest: z.string().trim().min(1),
    parentTaskId: z.string().uuid().nullable().default(null),
    parentRationale: z.string().trim().min(1).max(400).nullable().default(null),
    parentCandidates: z.array(chatTaskParentCandidateSchema).max(5).default([]),
    visibility: z.literal("private"),
    chatThreadId: z.string().uuid(),
    chatTurnId: z.string().uuid(),
  }).strict().safeParse(entry.inputs);
  if (!parsed.success) return null;
  const input = parsed.data;
  if (
    entry.actorType !== "agent" ||
    entry.actorId !== INTERNAL_STRATEGIST_AGENT ||
    entry.onBehalfOfType !== "user" ||
    !entry.onBehalfOfId ||
    entry.action !== "write" ||
    entry.resourceType !== "record" ||
    entry.resourceId !== input.taskId ||
    entry.dataScope !== "private" ||
    entry.id !== idempotentUuid(`${input.chatTurnId}:proposal`) ||
    // A new node's id stays derived from its turn. An "append" targets a Task
    // this turn did NOT mint, so the id cannot be checked here — the target is
    // instead re-verified against the thread's own accepted Task nodes in
    // `requireChatTaskProposalBinding` and `finishChatTaskDecision`.
    (input.mode === "create" && input.taskId !== idempotentUuid(`${input.chatTurnId}:task`)) ||
    (input.mode === "append" && input.parentTaskId !== null) ||
    input.parentTaskId === input.taskId ||
    !chatLedgerEntryIsProposal(entry)
  ) {
    return null;
  }
  return input;
}

export function entryClaimsChatTaskProposal(entry: LedgerEntry): boolean {
  return (
    typeof entry.inputs === "object" &&
    entry.inputs !== null &&
    !Array.isArray(entry.inputs) &&
    "kind" in entry.inputs &&
    entry.inputs.kind === "task_create"
  );
}

export async function requireChatTaskProposalBinding(
  wiring: Wiring,
  entry: LedgerEntry,
  ownerUserId: string,
) {
  const input = chatTaskProposalInput(entry);
  if (!input || entry.onBehalfOfId !== ownerUserId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Chat Task proposal provenance is invalid",
    });
  }
  const scope = chatOwnerScope(entry.organizationId, ownerUserId);
  const thread = await wiring.chatStore.getThread(scope, input.chatThreadId);
  const turn = thread
    ? await wiring.chatStore.getTurn(
        scope,
        input.chatThreadId,
        input.chatTurnId,
      )
    : null;
  const refs = turn
    ? await wiring.chatStore.listTurnRefs(
        scope,
        input.chatThreadId,
        input.chatTurnId,
      )
    : [];
  if (
    !thread ||
    thread.plane !== "local" ||
    thread.dataScope !== "private" ||
    !turn ||
    turn.role !== "assistant" ||
    turn.actorType !== "agent" ||
    turn.actorId !== INTERNAL_STRATEGIST_AGENT ||
    !refs.some((ref) => ref.kind === "proposal" && ref.refId === entry.id)
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Chat Task proposal is not bound to a genuine Chat turn",
    });
  }
  return input;
}

export async function finishChatTaskDecision(
  wiring: Wiring,
  original: LedgerEntry,
  input: NonNullable<ReturnType<typeof chatTaskProposalInput>>,
  resolvedOutput: unknown,
  decision: "approve" | "edit" | "veto",
  ownerUserId: string,
  run: RunCtx,
) {
  const runId = idempotentUuid(`${input.chatTurnId}:automation-run`);
  const existingRun = await wiring.automationRunRecorder.get(
    original.organizationId,
    runId,
  );
  if (decision === "veto") {
    if (!existingRun || existingRun.status === "running") {
      await wiring.automationRunRecorder.finish(
        {
          runId,
          organizationId: original.organizationId,
          status: "halted",
          output: { proposalId: original.id, decision: "veto" },
        },
        run,
      );
    }
    return { runId, task: null };
  }
  const output = chatCreateTaskOutputSchema.parse(resolvedOutput);
  if (output.taskId !== input.taskId || output.mode !== input.mode) {
    throw new Error("Chat Task review cannot retarget the proposed Task");
  }
  if (output.mode === "append" && output.parentTaskId !== null) {
    throw new Error("A Chat follow-up appends to its Task node and cannot re-parent it");
  }
  if (output.parentTaskId === output.taskId) {
    throw new Error("A Task cannot be its own parent");
  }
  if (existingRun && existingRun.status !== "running") {
    return {
      runId,
      task: await wiring.taskManager.get(original.organizationId, output.taskId),
    };
  }
  const seam = { nextId: () => run.ids.next(), nowISO: () => run.clock.nowISO() };
  // Follow-up in a thread that already owns a Task node: continue THAT node.
  // The target is re-verified here (the mutation choke point) against the
  // thread's own accepted nodes, so an "append" can never be pointed at an
  // arbitrary record by a forged proposal.
  if (output.mode === "append") {
    const chatScope = chatOwnerScope(original.organizationId, ownerUserId);
    const nodes = await chatThreadTaskNodes(wiring, chatScope, input.chatThreadId);
    if (!nodes.some((node) => node.accepted && node.taskId === output.taskId)) {
      throw new Error(
        `Chat Task ${output.taskId} is not a Task node this Chat thread already owns`,
      );
    }
    const anchorTask = await wiring.taskManager.get(
      original.organizationId,
      output.taskId,
    );
    if (!anchorTask) throw new Error(`Chat Task ${output.taskId} no longer exists`);
    const appended = await wiring.taskManager.appendOutcome(
      original.organizationId,
      output.taskId,
      {
        id: idempotentUuid(`${input.chatTurnId}:outcome`),
        title: output.title,
        measure: "Completion",
        target: output.outcome,
        indicatorKind: "lagging",
        northStar: false,
      },
      seam,
    );
    if (!existingRun || existingRun.status === "running") {
      await wiring.automationRunRecorder.finish(
        {
          runId,
          organizationId: original.organizationId,
          status: "completed",
          output: {
            kind: "result",
            proposalId: original.id,
            taskId: appended.id,
            mode: "append",
          },
        },
        run,
      );
    }
    return { runId, task: appended };
  }
  // The reviewer may keep, clear, or change the suggested parent — but only to
  // a Task that really exists and that this owner may see.
  if (output.parentTaskId) {
    const parent = await wiring.taskManager.get(
      original.organizationId,
      output.parentTaskId,
    );
    if (
      !parent ||
      (parent.visibility !== "organization" && parent.ownerId !== ownerUserId)
    ) {
      throw new Error(`Parent Task ${output.parentTaskId} is not available to this owner`);
    }
  }
  const createInput = {
    id: output.taskId,
    organizationId: original.organizationId,
    title: output.title,
    taskType: "execution",
    outcomes: [{
      id: idempotentUuid(`${output.taskId}:outcome`),
      title: output.outcome,
      measure: "Completion",
      target: output.outcome,
      indicatorKind: "lagging" as const,
      northStar: true,
    }],
    ...(output.parentTaskId ? { parentTaskId: output.parentTaskId } : {}),
    exitTest: output.exitTest,
    status: "committed" as const,
    priority: "P1" as const,
    ownerType: "human" as const,
    ownerId: ownerUserId,
    assignedAgentId: INTERNAL_STRATEGIST_AGENT,
    requiredSkillId: CHAT_TASK_SKILL_ID,
    visibility: "private" as const,
  };
  let task = await wiring.taskManager.get(original.organizationId, output.taskId);
  if (!task) {
    try {
      task = (
        await wiring.taskManager.create(
          createInput,
          { nextId: () => run.ids.next(), nowISO: () => run.clock.nowISO() },
        )
      ).task;
    } catch (error) {
      let taskIdConflict = false;
      for (
        let candidate: unknown = error, depth = 0;
        candidate && typeof candidate === "object" && depth < 6;
        depth += 1
      ) {
        const databaseError = candidate as {
          code?: unknown;
          constraint?: unknown;
          message?: unknown;
          cause?: unknown;
        };
        if (databaseError.code === "23505") {
          const detail = `${String(databaseError.constraint ?? "")} ${String(
            databaseError.message ?? "",
          )}`;
          taskIdConflict = detail.includes("tasks_pkey");
          break;
        }
        candidate = databaseError.cause;
      }
      if (
        error instanceof Error &&
        error.message === `task-manager: duplicate Task id ${output.taskId}`
      ) {
        taskIdConflict = true;
      }
      if (!taskIdConflict) throw error;
      task = await wiring.taskManager.get(original.organizationId, output.taskId);
      if (!task) throw error;
    }
  }
  if (
    task.taskType !== "execution" ||
    task.ownerId !== ownerUserId ||
    task.assignedAgentId !== INTERNAL_STRATEGIST_AGENT ||
    task.requiredSkillId !== CHAT_TASK_SKILL_ID ||
    task.visibility !== "private"
  ) {
    throw new Error(`Chat Task ${output.taskId} conflicts with its deterministic proposal`);
  }
  if (!existingRun || existingRun.status === "running") {
    await wiring.automationRunRecorder.finish(
      {
        runId,
        organizationId: original.organizationId,
        status: "completed",
        output: {
          kind: "result",
          proposalId: original.id,
          taskId: task.id,
        },
      },
      run,
    );
  }
  return { runId, task };
}

export async function ensureTaskManagerAutomation(
  wiring: Wiring,
  organizationId: string,
  input: {
    automationId: string;
    name: string;
    agentId: string;
    skill: string;
    action: Action;
  },
  run: RunCtx,
  /** Which Goal the anchor Task hangs under. Defaults to the Task Manager's
   *  own guard Goal; TASK-094's Capability Builder Runs pass their own, so a
   *  Builder Run is not filed as a Task Manager guard. */
  goalType = "task-manager",
): Promise<{ goalId: string; taskId: string }> {
  const seam = { nextId: () => run.ids.next(), nowISO: () => run.clock.nowISO() };
  const goals = await wiring.goalTasks.listGoals(organizationId);
  const goal =
    goals.find((candidate) => candidate.type === goalType) ??
    await wiring.goalTasks.createGoal({
      organizationId,
      type: goalType,
      title: goalType === "task-manager"
        ? "Task Manager guard Automations"
        : "Capability Builder Automations",
    }, seam);
  const existing = (await wiring.goalTasks.listTasksByGoal(organizationId, goal.id))
    .find((task) => task.type === "task" && task.assignedAgentId === input.agentId);
  const task = existing ?? await wiring.goalTasks.createTask({
    organizationId,
    goalId: goal.id,
    type: "task",
    assignedAgentId: input.agentId,
    exitTest: `${input.name} produces attributable governed evidence`,
  }, seam);
  await wiring.automationRegistry.save({
    id: input.automationId,
    name: input.name,
    organizationId,
    agentId: input.agentId,
    agentPlane: "local",
    steps: [{
      skill: input.skill,
      action: input.action,
      resourceType: "record",
      dataScope: "all",
      goalTaskRef: { goalId: goal.id, taskId: task.id },
    }],
  });
  return { goalId: goal.id, taskId: task.id };
}

/**
 * TASK-094 — the Capability Builder acts as ITSELF.
 *
 * Both Builder lanes (rung 3's `proposeSteps`, rung 4's `proposeStructure`)
 * used to execute as whichever human pressed the button. The agent identity
 * existed — `CAPABILITY_BUILDER_AGENT` with `role-capability-builder`, a
 * `signal:write` scope and seeded governance in both wirings — and nothing
 * referenced it, so the Builder's own work left nothing attributable behind.
 * That is a live gap against "only an attributable allowed Agent invokes
 * them": you could not ask what the Builder had done, or stop it by narrowing
 * its scope, because as far as the system was concerned it had never acted.
 *
 * This wrapper closes it in the two places it is true, with the same two
 * mechanisms the rest of the codebase uses:
 *
 *  1. **Authority first.** `resolveAuthority` for the Builder as actor, on
 *     behalf of the requesting human. Narrow the agent's scope and the lane
 *     stops working — which is the point: an attribution you cannot revoke is
 *     a label, not an authority.
 *  2. **An Agent Run around the work.** Start before, finish after, `halted`
 *     with the error when the derivation throws. `automation_runs` carries a
 *     composite FK to `automations`, so the Run needs a real Automation row
 *     for this Agent — hence the ensure call, exactly as the chat Task lane
 *     does for the Internal Strategist.
 *
 * What it deliberately does NOT add: a propose/decide gate. Drafting is not
 * the governed moment in either rung — activation is (rung 3) and
 * materialization would be (rung 4). Inserting a human approval in front of
 * "show me what you derived" would gate the explanation instead of the action.
 */
/** The rung-3 lane's own result union. Written out because inference across
 *  the Run wrapper's callback collapses it to whichever branch it sees first,
 *  and the refusal branch is half of this lane's contract. */
export type BuilderStepsLaneResult =
  | { proposed: false; reason: BuilderRefusalReason; detail: string }
  | {
      proposed: true;
      automationId: string;
      steps: ReturnType<typeof parseAutomationSteps>;
      evidence: Extract<BuilderStepsResult, { proposed: true }>["evidence"];
      status: "draft";
    };

export const CAPABILITY_BUILDER_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000f8";
export const CAPABILITY_BUILDER_SKILL_ID = "capability-builder.draft";

export async function runAsCapabilityBuilder<T>(
  ctx: { wiring: Wiring; run: RunCtx; identity: { type: string; id: string } },
  organizationId: string,
  lane: string,
  work: () => Promise<{ result: T; output: Record<string, unknown> }>,
): Promise<{ result: T; runId: string }> {
  const authority = await resolveAuthority(
    {
      organizationId,
      actor: { type: "agent", id: CAPABILITY_BUILDER_AGENT, plane: "local" },
      onBehalfOf: { type: "user", id: ctx.identity.id },
      action: "write",
      resourceType: "signal",
      requestedDataScope: "private",
    },
    {
      roles: ctx.wiring.roles,
      agents: ctx.wiring.agents,
      ephemeral: ctx.wiring.ephemeral,
      nowISO: ctx.run.clock.nowISO(),
    },
  );
  if (!authority.allowed || authority.dataScope === "none") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `the Capability Builder is not authorized to act here: ${authority.reason}`,
    });
  }
  const anchor = await ensureTaskManagerAutomation(
    ctx.wiring,
    organizationId,
    {
      automationId: CAPABILITY_BUILDER_AUTOMATION_ID,
      name: "Capability Builder drafting",
      agentId: CAPABILITY_BUILDER_AGENT,
      skill: CAPABILITY_BUILDER_SKILL_ID,
      action: "write",
    },
    ctx.run,
    "capability-builder",
  );
  const runId = ctx.run.ids.next();
  await ctx.wiring.automationRunRecorder.start(
    {
      runId,
      automationId: CAPABILITY_BUILDER_AUTOMATION_ID,
      organizationId,
      agentId: CAPABILITY_BUILDER_AGENT,
      taskId: anchor.taskId,
    },
    ctx.run,
  );
  try {
    const { result, output } = await work();
    await ctx.wiring.automationRunRecorder.finish(
      { runId, organizationId, status: "completed", output: { lane, ...output } },
      ctx.run,
    );
    return { result, runId };
  } catch (error) {
    // A halted Run is the honest record of a Builder that tried and failed.
    // Swallowing the finish would leave a Run that never ends, which reads as
    // "still working" forever.
    await ctx.wiring.automationRunRecorder.finish(
      { runId, organizationId, status: "halted", output: { lane, error: String(error) } },
      ctx.run,
    );
    throw error;
  }
}

/** TASK-032 flight gate — every `learning.*` procedure except `status` fails
 * closed when the flight is off. `PRECONDITION_FAILED` (not `FORBIDDEN`): the
 * caller's authority is fine; the capability is deliberately not active. */
export function assertLearningFlightEnabled(ctx: { wiring: Pick<Wiring, "learningObservationEnabled"> }): void {
  if (!ctx.wiring.learningObservationEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "learning observation flight is disabled (BRIDGE_LEARNING_OBSERVATION)",
    });
  }
}

export function assertDevpilotFlightEnabled(ctx: { wiring: Pick<Wiring, "devpilotEnabled"> }): void {
  if (!ctx.wiring.devpilotEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DevPilot flight is disabled (BRIDGE_DEVPILOT)",
    });
  }
}

export function assertClaimFlightEnabled(ctx: { wiring: Pick<Wiring, "claimSubstrateEnabled"> }): void {
  if (!ctx.wiring.claimSubstrateEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "claim substrate flight is disabled (BRIDGE_CLAIM_SUBSTRATE)",
    });
  }
}

export function assertHumanIdentity(ctx: { identity: { type: string } }, what: string): void {
  if (ctx.identity.type !== "user") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${what} is a Human decision — only a user identity may do it`,
    });
  }
}

export function assertRetrievalFlightEnabled(ctx: { wiring: Pick<Wiring, "retrievalFusionEnabled"> }): void {
  if (!ctx.wiring.retrievalFusionEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "retrieval fusion flight is disabled (BRIDGE_RETRIEVAL_FUSION)",
    });
  }
}

/** HONEST METRIC LABEL (ADR-174): every surface showing these numbers must
 * carry it. The eval measures whether retrieval finds the organization's own
 * notes again (self-retrieval consistency) — it is NOT human-judged
 * relevance, and dashboards must never present it as such. */
export const RETRIEVAL_EVAL_METRIC = "self_retrieval" as const;
export const RETRIEVAL_EVAL_METRIC_NOTE =
  "Self-retrieval consistency: how reliably retrieval finds this organization's own notes again. " +
  "Not human-judged relevance.";

/** Commons-archetype procedures need BOTH flights: the learning loop (the
 * rows being generalized/seeded are its rows) AND the archetypes flight. */
export function assertArchetypesFlightEnabled(
  ctx: { wiring: Pick<Wiring, "learningObservationEnabled" | "commonsArchetypesEnabled"> },
): void {
  assertLearningFlightEnabled(ctx);
  if (!ctx.wiring.commonsArchetypesEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "commons archetypes flight is disabled (BRIDGE_COMMONS_ARCHETYPES)",
    });
  }
}

/** Map the learning loop's typed error strings onto tRPC codes: an unknown/
 * unauthorized row is `NOT_FOUND` (indistinguishable by design), a repeated
 * accept/reject of an already-transitioned suggestion is `CONFLICT`. Anything
 * else is a genuine server fault and rethrows unchanged. */
export function learningActionError(error: unknown): unknown {
  if (error instanceof Error) {
    if (error.message.includes("unknown or unauthorized")) {
      return new TRPCError({ code: "NOT_FOUND", message: "suggestion not found" });
    }
    if (error.message.includes("already") || error.message.includes("concurrently modified")) {
      return new TRPCError({ code: "CONFLICT", message: error.message });
    }
  }
  return error;
}

/**
 * TableSpecs for the Accounting/D2C Modules (TASK-074). Unlike JobPilot/
 * DevPilot's specs — which live in their own domain packages — these are
 * inline here: `@bridge/accounting`/`@bridge/d2c` are pure domain layers
 * imported from their donor repos and were never given a `@bridge/tables`
 * dependency (ADR-246 keeps them unrewritten). The shape only needs to
 * structurally match `TableSpec`; tRPC infers it from the return value.
 */
export const ACCOUNTING_CLIENTS_SPEC = {
  id: "accounting.books",
  columns: [
    { id: "name", label: "Client", kind: "text" as const, editable: false },
    { id: "legalName", label: "Legal name", kind: "text" as const, editable: false },
    { id: "stage", label: "Stage", kind: "text" as const, editable: false },
    { id: "industry", label: "Industry", kind: "text" as const, editable: false },
    { id: "owner", label: "Owner", kind: "text" as const, editable: false },
    { id: "createdAt", label: "Created", kind: "date" as const, editable: false },
  ],
};

export const ACCOUNTING_REPORTS_SPEC = {
  id: "accounting.reports",
  columns: [
    { id: "label", label: "Metric", kind: "text" as const, editable: false },
    /**
     * TASK-084's formula column. The cell's own field holds the computed VALUE
     * (unknown until facts are imported — `null`, never a fabricated figure),
     * and `expressionField` names the field holding the EXPRESSION the fx
     * affordance toggles to. This is a real formula, stored in
     * `accountingSchema.formulas.expression` and evaluated by the Module's own
     * engine — not a demonstration column.
     */
    {
      id: "value",
      label: "Value",
      kind: "formula" as const,
      expressionField: "expression",
      editable: true,
    },
    { id: "unit", label: "Unit", kind: "text" as const, editable: false },
    { id: "description", label: "Description", kind: "text" as const, editable: false },
    { id: "version", label: "Version", kind: "number" as const, editable: false },
    { id: "active", label: "Active", kind: "checkbox" as const, editable: false },
  ],
};

export const D2C_ORDERS_SPEC = {
  id: "d2c.commerce.orders",
  columns: [
    { id: "orderNo", label: "Order #", kind: "text" as const, editable: false },
    { id: "customerName", label: "Customer", kind: "text" as const, editable: false },
    { id: "source", label: "Source", kind: "text" as const, editable: false },
    { id: "status", label: "Status", kind: "text" as const, editable: false },
    { id: "placedAt", label: "Placed", kind: "date" as const, editable: false },
    { id: "transportCharge", label: "Transport", kind: "number" as const, editable: false },
    { id: "discountAmount", label: "Discount", kind: "number" as const, editable: false },
  ],
};

export const D2C_INVENTORY_SPEC = {
  id: "d2c.commerce.inventory",
  columns: [
    { id: "itemType", label: "Item type", kind: "text" as const, editable: false },
    { id: "itemId", label: "Item", kind: "text" as const, editable: false },
    { id: "batchNo", label: "Batch #", kind: "text" as const, editable: false },
    { id: "quantityOnHand", label: "Qty on hand", kind: "number" as const, editable: false },
    { id: "unitCost", label: "Unit cost", kind: "number" as const, editable: false },
    { id: "mfgDate", label: "Mfg date", kind: "date" as const, editable: false },
    { id: "expiryDate", label: "Expiry", kind: "date" as const, editable: false },
  ],
};

export const D2C_RESEARCH_SPEC = {
  id: "d2c.research.plants",
  columns: [
    { id: "commonName", label: "Common name", kind: "text" as const, editable: false },
    { id: "botanicalName", label: "Botanical name", kind: "text" as const, editable: false },
    { id: "summary", label: "Summary", kind: "text" as const, editable: false },
  ],
};

export const D2C_NOTES_SPEC = {
  id: "d2c.notes.documents",
  columns: [
    { id: "title", label: "Title", kind: "text" as const, editable: false },
    { id: "createdAt", label: "Created", kind: "date" as const, editable: false },
    { id: "updatedAt", label: "Updated", kind: "date" as const, editable: false },
  ],
};

// ── Governed schema mutation: the shipped specs it knows (TASK-084) ──────────
//
// The capability is only offered for a table whose SHIPPED spec this process
// holds, because a rename has to be validated against the real column list and
// a dependency preview has to read the real column. Every other table reports
// the capability unavailable with that reason, and its column menu disables
// against that answer instead of shipping items that fail at the server
// (ADR-001 keeps them visible; ADR-247 keeps them honest).
export const SCHEMA_MUTABLE_SPECS: Record<string, TableSpec> = Object.fromEntries(
  [
    ACCOUNTING_CLIENTS_SPEC,
    ACCOUNTING_REPORTS_SPEC,
    D2C_ORDERS_SPEC,
    D2C_INVENTORY_SPEC,
    D2C_RESEARCH_SPEC,
    D2C_NOTES_SPEC,
  ].map((spec) => [spec.id, spec as TableSpec]),
);

/** Mirrors `ColumnKind` in @bridge/tables. Listed rather than derived because a
 * Zod enum needs the literals; the typecheck below fails if the two drift. */
export const COLUMN_KINDS = [
  "text",
  "number",
  "select",
  "multiselect",
  "date",
  "checkbox",
  "url",
  "relation",
  "formula",
  "skill",
  "location",
] as const satisfies readonly ColumnKind[];

/** The shipped spec, the user's overlay, and the spec the surface should render
 * — plus whether the capability exists here at all. */
export async function readTableSchemaCapability(
  wiring: Pick<Wiring, "localPlane">,
  organizationId: string,
  specId: string,
): Promise<{
  available: boolean;
  reason: string | null;
  spec: TableSpec | null;
  overlay: ColumnOverlay | null;
  canUndo: boolean;
}> {
  const base = SCHEMA_MUTABLE_SPECS[specId];
  if (!base) {
    return {
      available: false,
      reason: `Unavailable: no governed schema-mutation capability is installed for ${specId}`,
      spec: null,
      overlay: null,
      canUndo: false,
    };
  }
  const stored = readStoredTableSchema(
    await wiring.localPlane.state.read(organizationId, `${TABLE_SCHEMA_NAMESPACE_PREFIX}${specId}`),
  );
  return {
    available: true,
    reason: null,
    spec: applyColumnOverlay(base, stored.overlay),
    overlay: hasOverlay(stored.overlay) ? stored.overlay : null,
    canUndo: stored.previous !== null,
  };
}

// ── Module governance overlay (TASK-088, ADR-248/ADR-178) ────────────────────
//
// The Governance Section has been engine-READ since ADR-248, but nothing could
// write it: manifests are immutable, so `module.governance.userEdited` was
// parsed and rendered with no code path able to set it. The overlay is that
// path — the user's own policy, keyed by Organization + Module, resolved over
// the manifest's declared default by `resolveModuleGovernance` in @bridge/core.
//
// LOCAL PLANE by residency and by trust. It rides the same organization-scoped
// atomic state store as the learning consent + WhatsApp automation policies
// above, for the same two reasons: it is one Organization's private policy, and
// writing it moves a trust boundary — which is exactly why `deployment-boundary`
// closes the whole `moduleGovernance.` namespace to the public cloud shell.
export const MODULE_GOVERNANCE_NAMESPACE_PREFIX = "module:governance:";

/** The manifest's DECLARED policy for a Module — the seeded default an overlay
 * is resolved over. Never mutated; ADR-178 makes manifests immutable. */
export function declaredModuleGovernance(moduleName: string): ModuleGovernancePolicy | undefined {
  return BUILT_IN_MODULES.find((entry) => entry.manifest.name === moduleName)?.manifest.governance;
}

/** Declared policy + stored overlay + the resolved policy the engine enforces. */
export async function readResolvedModuleGovernance(
  wiring: Pick<Wiring, "localPlane">,
  organizationId: string,
  moduleName: string,
): Promise<{
  declared: ModuleGovernancePolicy | null;
  resolved: ModuleGovernancePolicy | null;
  userEdited: boolean;
  updatedAt: string | null;
}> {
  const declared = declaredModuleGovernance(moduleName);
  const overlay = readModuleGovernanceOverlay(
    await wiring.localPlane.state.read(
      organizationId,
      `${MODULE_GOVERNANCE_NAMESPACE_PREFIX}${moduleName}`,
    ),
  );
  return {
    declared: declared ?? null,
    resolved: resolveModuleGovernance(declared, overlay) ?? null,
    userEdited: overlay !== null,
    updatedAt: overlay?.updatedAt || null,
  };
}

/** A typo'd Module name would store an overlay nothing ever reads, and the user
 * would believe they had governed something. Say so instead. */
export function assertKnownModule(moduleName: string): void {
  if (!BUILT_IN_MODULES.some((entry) => entry.manifest.name === moduleName)) {
    throw new TRPCError({ code: "NOT_FOUND", message: `No installed Module named ${moduleName}` });
  }
}

/** One rule as the editor sends it. Same contract the manifest parser enforces:
 * a rule that cannot explain itself is a rule the user cannot audit, and the
 * refusal message quotes this text back to them verbatim. */
export const moduleGovernanceRuleInput = z.object({
  action: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(500),
});

// ---------------------------------------------------------------------------
// Chat composer capability (TASK-082)
//
// The paperclip and the mic both need something the process may not have: the
// local Bridge File tree, and a Groq key. Canon says a control that cannot act
// stays VISIBLE and disabled with a stated reason (ADR-001, rulebook §3a), so
// the reason is computed HERE and carried to the control rather than being
// discovered as a failed request after the user has already recorded or picked
// a file.
// ---------------------------------------------------------------------------

/** The Module chat attachments land in — Chief of Staff's own Module, which is
 * also the Module a Chat turn proposes Tasks into. Files land under
 * `~/Documents/Bridge/<Organization>/TaskManager/` through `modules.addFile`,
 * the one Module File path (ADR-125/178). */
export const CHAT_ATTACHMENT_MODULE = "task-manager";

export interface ComposerCapability {
  available: boolean;
  reason: string | null;
}

export function composerCapability(input: {
  publicCloudOnly: boolean;
  groqKeySaved: boolean;
}): { attachments: ComposerCapability; voice: ComposerCapability } {
  const attachments: ComposerCapability = input.publicCloudOnly
    ? {
        available: false,
        // Not a missing feature — a residency boundary. Module Files live in
        // the user's own Documents folder, which a shared cloud shell has no
        // access to.
        reason: "Attachments are saved to this device — use the Bridge desktop app",
      }
    : { available: true, reason: null };
  const voice: ComposerCapability = input.publicCloudOnly
    ? {
        available: false,
        reason: "Voice input runs on this device — use the Bridge desktop app",
      }
    : input.groqKeySaved
      ? { available: true, reason: null }
      : {
          available: false,
          reason: "Voice input needs a Groq key (Settings → API Keys)",
        };
  return { attachments, voice };
}

/**
 * The transcription key: the environment wins, exactly as it does at boot
 * (`wiring.ts`), otherwise the governed vault Settings → API Keys writes to.
 * The value is used for one Authorization header and never returned.
 */
export async function transcriptionApiKey(
  wiring: Wiring,
  organizationId: string,
): Promise<string | null> {
  const fromEnvironment = process.env.GROQ_API_KEY?.trim();
  if (fromEnvironment) return fromEnvironment;
  if (wiring.publicCloudOnly) return null;
  return wiring.modelProviderKeys.read(organizationId, "groq");
}

/** Normalize a persisted state row's `evidence` jsonb into the core
 * `CapabilityEvidence` shape lifecycle.ts's guards expect (defaults for any
 * field not yet recorded). */
export function toEvidence(evidence: {
  activeRunCount?: number | undefined;
  successRate?: number | undefined;
  violationCount?: number | undefined;
  ageDays?: number | undefined;
}): {
  activeRunCount: number;
  successRate: number;
  violationCount: number;
  ageDays: number;
} {
  return {
    activeRunCount: evidence.activeRunCount ?? 0,
    successRate: evidence.successRate ?? 0,
    violationCount: evidence.violationCount ?? 0,
    ageDays: evidence.ageDays ?? 0,
  };
}
