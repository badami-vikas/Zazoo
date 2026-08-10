/**
 * tRPC router — the wire surface over the Universal Action Pipeline.
 *
 * Zod schemas here are the single validate+sanitize chokepoint at the seam
 * (backlog #24): nothing reaches the pipeline unvalidated. Procedures are thin —
 * all governance lives in the pipeline, not here.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
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
  chatCaptureSignalId,
  googleCaptureSignalId,
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
} from "@bridge/core";
import type {
  Action,
  Actor,
  ActorType,
  AuthorityDecision,
  DataScope,
  EgressTier,
  ModelProvider,
  MemoryEntry,
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
  demoteOnDependencyChange,
  suspendOnFailure,
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
  RESEARCH_STEP_TOOLS,
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
  classifyTaskChangeBand,
  calibratedTaskChangeDecision,
  assembleRunContext,
  projectToSystemPrompt,
  ChatCloudGrantError,
  ChatStoreConflictError,
  ChatStoreNotFoundError,
  type ChatOwnerScope,
  type ChatThread,
  type ChatTurn,
  type ChatTurnRef,
} from "@bridge/core";
import { WEB_RESEARCH_SKILL_ID } from "./web-research-skill.js";
import type { ModelBinding } from "@bridge/capability-kit";
import { createModelRouter, MANAGED_LLAMA_PROVIDER_ID } from "@bridge/models";
import { authUrl, CALENDAR_SOURCE, GMAIL_SOURCE, type IntakeDirective } from "@bridge/integrations-google";
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
} from "@bridge/dealpilot";
import {
  acceptAutomationDraft,
  acceptSuggestion as acceptLearningSuggestion,
  detectAutomationDraftCandidates,
  digestSignals as digestLearningSignals,
  generalizeLearnedPreferences,
  isLearningObservationEntry,
  listPromotionSuggestions,
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
  calendarEventCaptureSignal,
  captureAllowed,
  chatTurnCaptureSignal,
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
  type CaptureConsentState,
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
} from "./built-in-modules.js";
import { assertCommonsEntryContentTrusted } from "./commons-client.js";
import {
  listModuleFiles,
  MAX_MODULE_FILE_BYTES,
  ModuleFileContentConflictError,
  ModuleFilesPathError,
  readModuleFileContent,
  replaceModuleFileContent,
  withOrganizationFileOperationLock,
  saveModuleFile,
  OrganizationFilesConflictError,
  OrganizationFilesRecoveryError,
} from "./module-files.js";
import { listProviderIds, oauthScopesFor } from "./social/registry.js";

const t = initTRPC.context<ApiContext>().create();
type OutreachDraftResult =
  | Proposal
  | {
      id: string;
      status: "already_resolved";
      decision: "approve" | "veto" | "edit" | "auto";
    };
const outreachDraftsInFlight = new Map<string, Promise<OutreachDraftResult>>();

// M4: server-side OTP proof — userId → expiry epoch ms. verifyPhoneOtp writes,
// saveProfile consumes. Proof is single-use and expires in 10 min.
const phoneOtpProofs = new Map<string, number>();
function consumePhoneOtpProof(userId: string): boolean {
  const exp = phoneOtpProofs.get(userId);
  if (!exp || exp < Date.now()) return false;
  phoneOtpProofs.delete(userId);
  return true;
}

function stableProposalId(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function stableOutreachProposalId(key: string): string {
  return stableProposalId(key);
}

function stableModuleInstallProposalId(organizationId: string, installationId: string): string {
  return stableProposalId(`module-install:${organizationId}:${installationId}`);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The Module that captured a record. Matches `LocalMessage.source`. */
const WHATSAPP_SOURCE = "whatsapp";

/** Local state-store namespace holding the per-chat message sync cursors. */
const WHATSAPP_SYNC_NAMESPACE = "whatsapp:message-sync";

/** Local state-store namespace holding the K2 per-source capture-consent
 * state (@bridge/core learning/capture-consent). Local Plane by residency:
 * consent to use local data lives beside the data it governs, and the
 * public-cloud shell never evaluates it (every `learning.*` procedure is
 * local-only in deployment-boundary.ts). */
const LEARNING_CAPTURE_CONSENT_NAMESPACE = "learning:capture-consent";

/** Read the current capture-consent state, failing CLOSED: a missing or
 * unreadable row is the default all-off state (the core parser's contract,
 * mutation-checked there). */
async function readCaptureConsentState(
  wiring: Pick<Wiring, "localPlane">,
  organizationId: string,
): Promise<CaptureConsentState> {
  return readCaptureConsent(
    await wiring.localPlane.state.read(organizationId, LEARNING_CAPTURE_CONSENT_NAMESPACE),
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
async function emitGoogleCaptureSignals(
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
async function recordWhatsAppAudit(
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
const whatsAppAutomationSubjectSchema = z.object({
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
function whatsAppModuleAgents(): { id: string; name: string }[] {
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
function requireWhatsAppHuman(identity: { type: string; id: string }): string {
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
async function whatsAppAutomationUpdate(
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

function moduleInstallationLedgerResourceId(
  organizationId: string,
  installationId: string,
): string {
  return UUID_PATTERN.test(installationId)
    ? installationId
    : stableProposalId(`legacy-module-installation:${organizationId}:${installationId}`);
}

const SUPPORTED_RELATIONSHIP_CONTRACT = (() => {
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

function moduleManifestHash(manifest: ModuleManifest): string {
  return `sha256:${createHash("sha256").update(canonicalizeManifest(manifest)).digest("hex")}`;
}

function isSupportedCitedRoleModelManifest(manifest: ModuleManifest): boolean {
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

function isSupportedCitedRoleModelInstallation(
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

async function currentSupportedRelationshipOwner(
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

function stableDealPilotCaptureProposalId(organizationId: string, captureId: string): string {
  return stableProposalId(`dealpilot-capture:${organizationId}:${captureId}`);
}

function isDealPilotCaptureProposal(
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
const withPilotOrganizationGuard = t.middleware(async ({ next }) => {
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

const requireAuthenticatedIdentity = t.middleware(async ({ ctx, next }) => {
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

const enforcePublicCloudBoundary = t.middleware(
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
const procedure = t.procedure
  .use(requireAuthenticatedIdentity)
  .use(enforcePublicCloudBoundary)
  .use(withPilotOrganizationGuard);
const authenticatedProcedure = t.procedure
  .use(requireAuthenticatedIdentity)
  .use(enforcePublicCloudBoundary)
  .use(withPilotOrganizationGuard);
const publicProcedure = t.procedure
  .use(enforcePublicCloudBoundary)
  .use(withPilotOrganizationGuard);

/**
 * TASK-010 (docs/raw/ui-architecture-rules-2026-07.md §5d) — the anchor a Red
 * Flag targets. Mirrors glossary's "Flag target stores Module, Database/
 * Record/Field or File/Result/bullet anchor": `recordId`+`fieldId` addresses a
 * data cell; `bulletPath` addresses a rendered bullet within a Record/Page
 * section or a File/Result (a stable per-item key, the same convention
 * `useLocalEdits`'s `fieldValue` keys already use, e.g. "s2.b1" or
 * "fit.strength.0" — kept legible against that unrelated mechanism even
 * though the two never share storage). At least one of recordId/fileId/
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
interface RedFlagCellAnchor {
  kind: "cell";
  moduleId: string;
  databaseId: string;
  recordId: string;
  fieldId: string;
}
interface RedFlagBulletAnchor {
  kind: "bullet";
  moduleId: string;
  target:
    | { type: "record"; recordId: string }
    | { type: "file"; fileId: string }
    | { type: "result"; resultId: string };
  bulletPath: string;
}
type RedFlagAnchor = RedFlagCellAnchor | RedFlagBulletAnchor;

const redFlagAnchorInput = z.discriminatedUnion("kind", [
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
function canonicalModuleId(moduleId: string): string {
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
function canonicalAnchorString(anchor: RedFlagAnchor): string {
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
let lastIssuedRedFlagTimestampMs = 0;
function monotonicRedFlagNowISO(): string {
  const now = Date.now();
  lastIssuedRedFlagTimestampMs = now > lastIssuedRedFlagTimestampMs ? now : lastIssuedRedFlagTimestampMs + 1;
  return new Date(lastIssuedRedFlagTimestampMs).toISOString();
}

type LearningMemoryContent =
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

function parseLearningMemory(content: string): LearningMemoryContent | null {
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

function isRedFlagContent(value: LearningMemoryContent | null): value is Extract<LearningMemoryContent, { kind: "red_flag" }> {
  return value?.kind === "red_flag";
}

function isPreferenceAdjustmentContent(value: LearningMemoryContent | null): value is Extract<LearningMemoryContent, { kind: "preference_adjustment" }> {
  return value?.kind === "preference_adjustment";
}

/** TASK-010 review round-5 item 1 — the legacy onboarding Memory kinds
 * `onboarding.learningState`/`forgetMemory` are allowed to read/delete.
 * Deliberately excludes `red_flag`/`preference_adjustment`: those are
 * private correction evidence that must only ever be read/deleted through
 * the owner-scoped `redFlag.*` surface (which withdraws/revokes the linked
 * governed proposal before deleting — a bare Memory delete never does). */
type LegacyOnboardingMemoryContent = Extract<LearningMemoryContent, { kind: "onboarding_preference" | "reflection_schedule" | "trust_capture" }>;
function isLegacyOnboardingContent(value: LearningMemoryContent | null): value is LegacyOnboardingMemoryContent {
  return value?.kind === "onboarding_preference" || value?.kind === "reflection_schedule" || value?.kind === "trust_capture";
}

/** Opaque base64url-encoded keyset cursor — `{createdAt, id, lineageRevision}`
 * (review round-4 item 8: total keyset order, immune to a row inserted/
 * superseded between page fetches, unlike the offset this replaced).
 * `lineageRevision` (review round-7) is included so `history`'s single-
 * lineage listing can paginate by the durable per-lineage revision instead
 * of `createdAt` — the cross-lineage `flags` list still orders/paginates by
 * `createdAt` alone and simply ignores the third slot. */
function encodeRedFlagCursor(row: { createdAt: string; id: string; lineageRevision?: number | null }): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id, row.lineageRevision ?? null]), "utf8").toString("base64url");
}
function decodeRedFlagCursor(cursor: string | undefined): { createdAt: string; id: string; lineageRevision?: number | null } | undefined {
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


async function researchPublicFigure(figure: string): Promise<{ title: string; extract: string; url: string }> {
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
function cleanOnBehalfOf(
  o: { type: "user" | "team"; id: string; delegationId?: string | undefined } | undefined,
): OnBehalfOf | undefined {
  if (!o) return undefined;
  return { type: o.type, id: o.id, ...(o.delegationId ? { delegationId: o.delegationId } : {}) };
}

function resolveClientOnBehalfOf(
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

function cleanContext(
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
class NonPilotOrganizationError extends Error {
  constructor(readonly organizationId: string) {
    super(`organizationId "${organizationId}" is not the pilot organization — multi-tenancy is not yet supported`);
    this.name = "NonPilotOrganizationError";
  }
}

function assertPilotOrganization(organizationId: string): void {
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
async function provisionGoalTask(
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

async function provisionRoleModelRecommendationTask(
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

async function provisionWebResearchTask(
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
async function provisionResearchRunTask(
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

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const taintOriginSchema = z.object({
  source: z.enum([
    "operator", "human", "system", "signed_import", "screen", "clipboard",
    "sensor", "email", "google", "web", "mcp", "file_import", "memory",
    "cache", "queue", "mixed", "unknown",
  ]),
  ref: z.string().min(1).max(2_048),
  hash: sha256Schema,
  transform: z.string().min(1).max(200),
}).strict();
const taintLabelSchema = z.object({
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
const webResearchOutputSchema = z.object({
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

async function assertWebResearchModuleBinding(
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

async function persistWebResearchOutcome(
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

interface CommonsSkillInvocation {
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

const roleModelRecommendationSchema = z.object({
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
type RoleModelRecommendation = z.infer<typeof roleModelRecommendationSchema>;

async function stageRoleModelRecommendation(
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

async function proposeRoleModelRecommendation(
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

async function latestApprovedRoleModelRecommendation(
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
async function provisionHelpRequestAnswerTask(wiring: Wiring, organizationId: string): Promise<{ goalId: string; taskId: string }> {
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
async function provisionCaptureTask(wiring: Wiring, organizationId: string): Promise<{ goalId: string; taskId: string }> {
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
async function validateAnchorTarget(wiring: Wiring, organizationId: string, viewerUserId: string, anchor: RedFlagAnchor): Promise<void> {
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
function isPrivateProposalInputs(inputs: unknown): boolean {
  return typeof inputs === "object" && inputs !== null && !Array.isArray(inputs) && (inputs as Record<string, unknown>).visibility === "private";
}

function isProposalVisibleTo(proposal: { request: { inputs: unknown; onBehalfOf?: { id: string } } }, viewerId: string): boolean {
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
async function synthesizePreferenceAdjustment(
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
async function provisionRedFlagLearningTask(
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
async function withdrawPendingRedFlagProposal(wiring: Wiring, run: RunCtx, proposalId: string, actorId: string): Promise<void> {
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
async function revokePreferenceAdjustmentPermanently(
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
async function attemptGovernedLearningStep(
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


async function provisionOutreachDraftTask(
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
async function provisionCultureResearchTask(wiring: Wiring, organizationId: string): Promise<{ goalId: string; taskId: string }> {
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
async function provisionCultureSynthesisTask(wiring: Wiring, organizationId: string): Promise<{ goalId: string; taskId: string }> {
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
async function assertMembership(
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

const dealpilotProcedure = procedure.use(async ({ ctx, next }) => {
  const authenticationRequired =
    ctx.verifying || ctx.wiring.persistent || process.env.NODE_ENV === "production";
  if (authenticationRequired && !ctx.authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required for DealPilot" });
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
const credentialSettingsProcedure = procedure.use(async ({ ctx, next }) => {
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

function assertModelProviderKeyId(value: string): ModelProviderKeyId {
  if (!isModelProviderKeyId(value)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `"${value}" is not a configurable model provider`,
    });
  }
  return value;
}

/** Key bytes are Local Plane only — the public cloud API refuses to hold them. */
function assertModelProviderKeyStorage(wiring: Pick<Wiring, "publicCloudOnly">): void {
  if (wiring.publicCloudOnly) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Model-provider API keys are stored on the Bridge desktop app (the Local Plane) and are not accepted by the public cloud API.",
    });
  }
}

const actionEnum = z.enum(["read", "write", "execute", "share", "archive"]);
const actorTypeEnum = z.enum(["user", "team", "agent"]);
const resourceTypeEnum = z.enum([
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
const dataScopeEnum = z.enum(["all", "public", "private"]);

/** Shared list-endpoint shape (dealpilot.list/integration.list/action.listPending
 * convention) — organizationId + limit/offset. */
const paginatedInput = z.object({
  organizationId: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
/** The local-first gate plane an actor runs on. Absent = local (private-first). */
const planeEnum = z.enum(["local", "cloud"]);

const actorSchema = z.object({ type: actorTypeEnum, id: z.string().min(1), plane: planeEnum.optional() });
const onBehalfOfSchema = z.object({
  type: z.enum(["user", "team"]),
  id: z.string().min(1),
  delegationId: z.string().optional(),
});

const proposeInput = z.object({
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

const decideInput = z.object({
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

const relationshipNodeTypeEnum = z.enum(["person", "community", "signal", "event"]);
const relationshipSignalEvidenceInput = relationshipSignalEvidencePayloadSchema
  .omit({ kind: true })
  .extend({
    organizationId: z.string().uuid().transform((value) => value.toLowerCase()),
  });
/** D10 — the View grammar's sort/row-filter shapes, shared by the Blueprint
 * View config (`blueprintViewInput.config` below) and the paginated
 * Relationship list endpoints so a View's server-side query uses the exact
 * same vocabulary its client-side `DataViews` display layer does. */
const viewSortSpecInput = z.object({ id: z.string(), dir: z.enum(["asc", "desc"]) });
const viewRowFilterInput = z.object({
  field: z.string(),
  op: z.enum(["contains", "is", "is_not", "is_empty", "is_not_empty", "starts_with"]),
  value: z.string(),
});
const relationshipListInput = z.object({
  organizationId: databaseUuidSchema,
  query: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(10_000).default(0),
  // D10 (BUGS.md "paginated Relationship Views filter and sort only the
  // loaded page", OPEN 2026-07-19): the active View's sorts/rowFilters,
  // applied server-side (`packages/db/src/graph-store.ts`'s allowlisted
  // `personViewColumn`/`communityViewColumn`) BEFORE limit/offset, so a
  // filter can match a row on a later page and a sort is global rather than
  // per-page. Bounded arrays — same reasoning as `MAX_VIEW_SORTS`/
  // `MAX_VIEW_ROW_FILTERS` in graph-store.ts.
  sorts: z.array(viewSortSpecInput).max(5).optional(),
  rowFilters: z.array(viewRowFilterInput).max(20).optional(),
  filterMatch: z.enum(["all", "any"]).optional(),
});
const humanInteractionFieldsSchema = interactionCreateFieldsSchema.omit({
  source: true,
  sourceRecordId: true,
});
const captureProposalInputSchema = z.object({
  local_media_id: z.string().trim().min(1).max(500),
}).passthrough();
const captureProposalOutputSchema = z.object({
  type: z.literal("event"),
  text: z.string().trim().min(1).max(5_000),
  local_media_id: z.string().trim().min(1).max(500),
  notes: z.string().max(20_000).optional(),
  link: z.object({
    type: z.enum(["person", "memory", "event"]),
    id: z.string().trim().min(1).max(500),
  }).optional(),
}).passthrough();
const captureReviewEnvelopeSchema = z.object({
  kind: z.literal("capture_review_envelope"),
  localMediaId: z.string().trim().min(1).max(500),
  ownerUserId: z.string().trim().min(1).max(500),
  capturedAt: z.string().datetime({ offset: true }),
  receivedAt: z.string().datetime({ offset: true }),
  status: z.enum(["staging", "pending_review", "applied", "rejected"]),
  proposalId: z.string().trim().min(1).optional(),
  decisionLedgerId: z.string().trim().min(1).optional(),
});
const CAPTURE_REVIEW_BODY_SOURCE = "capture-review";

function isCaptureProposal(proposal: LedgerEntry): boolean {
  return (
    proposal.resourceType === "event" &&
    proposal.dataScope === "private" &&
    captureProposalInputSchema.safeParse(proposal.inputs).success &&
    captureProposalOutputSchema.safeParse(proposal.proposedOutput).success
  );
}

const captureStageLocks = new Map<string, Promise<void>>();

async function withCaptureStageLock<T>(
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

async function findPendingCaptureProposal(
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

function pendingProposalFromLedger(entry: LedgerEntry): Proposal {
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

async function putCaptureReviewEnvelope(
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

async function getCaptureReviewEnvelope(
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

function assertPrivateProposalOwner(
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

async function assertGoogleIntegrationOwner(
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

async function proposeRelationshipMutation(
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

async function materializeApprovedCapture(
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

async function recordRejectedCapture(
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

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function intakeReviewView(
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

const outreachDraftInput = z.object({
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
const goalCreateInput = z.object({
  organizationId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
});

const taskCreateInput = z.object({
  organizationId: z.string().min(1),
  goalId: z.string().min(1),
  type: z.string().min(1),
  assignedAgentId: z.string().min(1),
});

const taskReassignInput = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
  assignedAgentId: z.string().min(1),
});

const resolveSkillInput = z.object({
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

const automationStep = z.object({
  skill: z.string().min(1),
  action: actionEnum,
  resourceType: resourceTypeEnum,
  resourceId: z.string().uuid().optional(),
  inputs: z.unknown(),
  dataScope: dataScopeEnum.optional(),
  /** AGS1/TASK-007 — see AutomationStepDef.goalTaskRef's doc comment. */
  goalTaskRef: z.object({ goalId: z.string().min(1), taskId: z.string().min(1) }).optional(),
});

const automationRunByIdInput = z.object({
  organizationId: z.string().min(1),
  automationId: z.string().min(1),
  moduleName: z.string().min(1).optional(),
  onBehalfOf: onBehalfOfSchema.optional(),
  params: z.record(z.unknown()).optional(),
  seed: z.string().optional(),
});

/** Layered, gated agent permissions (least-privilege; cf. Google incremental scopes).
 * `send` is intentionally NOT an egress tier — agents may never send (human-only). */
const egressTierEnum = z.enum(["none", "read-graph", "draft-graph", "source-internet"]);

const agentCreateInput = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  roleTemplateId: z.string().min(1),
});

const agentUpdateInput = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).optional(),
  roleTemplateId: z.string().min(1).optional(),
});

const automationCreateInput = z.object({
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
const capabilityTypeEnum = z.enum(["skill", "automation", "agent", "integration", "database"]);
const capabilityOriginEnum = z.enum(["built_in", "template", "community", "ai_generated", "user_code"]);
const capabilityAudienceEnum = z.enum(["private", "team", "external_visible"]);

const capabilityPermissionSchema = z.object({
  resourceType: z.string().min(1),
  action: z.enum(["read", "write", "send"]),
  dataScope: z.enum(["public", "private", "all"]),
  egress: z.boolean(),
});
const capabilityConnectorSchema = z.object({ id: z.string().min(1), externalSend: z.boolean().default(false) });
const capabilityDependencySchema = z.object({ manifestId: z.string().min(1), versionRange: z.string().min(1) });

const capabilityRegisterInput = z.object({
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

const capabilityIdInput = z.object({ manifestId: z.string().min(1) });
const capabilitySuspendInput = z.object({ manifestId: z.string().min(1), reason: z.string().min(1) });
const capabilityActivateInput = z.object({
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

const moduleRegisterInput = z.object({
  organizationId: z.string().min(1),
  /** Already-parsed module.yaml (or an equivalent plain object) — parsed+
   * validated by parseModuleManifest at this seam. */
  manifest: z.unknown(),
});

const moduleIdInput = z.object({ installationId: z.string().min(1) });

const moduleInstallInput = z.object({
  organizationId: z.string().min(1),
  installationId: z.string().min(1),
  /** Calendar-day key for the auto-activation budget (mirrors capability.activate's todayKey). */
  todayKey: z.string().min(1),
});

const modulePromoteInput = z.object({
  organizationId: z.string().min(1),
  installationId: z.string().min(1),
});

const moduleRollbackInput = z.object({
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
const BLUEPRINT_NODE_TYPE_REGISTRY = [...resourceTypeEnum.options, "edge"] as const;
const BLUEPRINT_RELATIONSHIP_NODE_TYPES = ["edge"] as const;

const blueprintFieldInput = z.object({
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

const blueprintEntityInput = z.object({
  nodeType: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(blueprintFieldInput),
});

const blueprintViewInput = z.object({
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

const organizationBlueprintInput = z.object({
  vocabulary: z.record(z.string(), z.string()),
  entities: z.array(blueprintEntityInput),
  views: z.array(blueprintViewInput),
  capabilities: z.array(z.string()),
});

/** Strip zod-optional `undefined` keys so the payload satisfies OrganizationBlueprint's
 * exactOptionalPropertyTypes shape (same reasoning as cleanOnBehalfOf/cleanContext
 * above) before it reaches compileBlueprint or the store. */
function toOrganizationBlueprint(input: z.infer<typeof organizationBlueprintInput>): OrganizationBlueprint {
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

const blueprintGetInput = z.object({ organizationId: databaseUuidSchema });
const blueprintGetByIdInput = z.object({
  organizationId: databaseUuidSchema,
  definitionId: databaseUuidSchema,
});
const blueprintProposeInput = z.object({
  organizationId: databaseUuidSchema,
  blueprint: organizationBlueprintInput,
});
const blueprintActivateInput = z.object({
  organizationId: databaseUuidSchema,
  definitionId: databaseUuidSchema,
});

// ---------------------------------------------------------------------------
// Chief of Staff v1 (docs/wiki/roadmap.md P1) — the closed registry of
// downstream capabilities it may route ONE turn to (star topology: no peer
// handoffs, so this list is exhaustive and hand-maintained here, mirroring
// BLUEPRINT_NODE_TYPE_REGISTRY's "single source of truth, kept in sync by
// hand" pattern above). Honest about what's routable today — capabilities not
// yet built (e.g. a dedicated recon/helpdesk skill) are deliberately omitted
// rather than listed as routable and then failing at execution time.
// ---------------------------------------------------------------------------
const CHIEF_OF_STAFF_REGISTRY: RoutableCapability[] = [
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

const MODEL_BINDING_BY_TIER: Readonly<Record<ModelTier, ModelBinding>> = {
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

interface PublicCloudModelEgress {
  dataScope: "public";
  userConfirmed: true;
}

function resolveConfiguredModel(
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

async function appendIntentModelReceipt(
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

async function authorizeModelCompletion(
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

function createGovernedModelProvider(
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

const chiefOfStaffConverseInput = z.object({
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

const chatSurfaceInput = z.object({
  kind: z.enum(["chat_panel", "chief_of_staff_page", "avatar_overlay", "task_manager"]),
  id: z.string().trim().min(1).max(200).optional(),
}).strict();

const chatAssistantEnvelopeSchema = z.discriminatedUnion("kind", [
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

const CHAT_ASSISTANT_RESPONSE_SCHEMA = {
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

const CHAT_PUBLIC_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text"],
  properties: {
    kind: { type: "string", enum: ["answer", "clarification"] },
    text: { type: "string", minLength: 1, maxLength: 2_000 },
  },
} as const;

const CHAT_LLAMA_PUBLIC_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text"],
  properties: {
    kind: { type: "string", enum: ["answer", "clarification"] },
    text: { type: "string" },
  },
} as const;

const chatSendInput = z.object({
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
const chatTaskParentCandidateSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(400),
  score: z.number().min(0).max(1),
}).strict();

const chatCreateTaskOutputSchema = z.object({
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
function toCoreManifest(id: string, input: z.infer<typeof capabilityRegisterInput>): CapabilityManifest {
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
function resolverFrom(rows: Map<string, CapabilityManifestRow>): (id: string) => CapabilityManifest | undefined {
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

function moduleInstallIdFromProposal(entry: LedgerEntry): string | undefined {
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

async function findPendingProposalById(
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

async function assertCurrentCommonsAttachment(
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

async function verifiedCommonsDependencyInstallations(
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

async function activateApprovedModuleInstallation(
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

async function validateDealPilotDiscoveryOutput(wiring: Wiring, inputs: unknown, output: unknown) {
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

async function validateDealPilotDecision(
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

async function materializeDealPilotApproval(wiring: Wiring, proposal: Proposal) {
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
const cultureEvidenceSchema = z.object({
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

const synthesizeCultureProfileOutputSchema = z.object({
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
async function assertCultureProposalBindingValid(wiring: Wiring, original: LedgerEntry): Promise<void> {
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

function relationshipEffectView(effect: RelationMaterializationEffect) {
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

async function approvedRelationshipResolution(
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

async function retryApprovedRelationship(
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
async function reconcileApprovedExternalEffect(
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

const taskOutcomeInput = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  measure: z.string().trim().min(1),
  target: z.string().trim().min(1),
  current: z.string().optional(),
  indicatorKind: z.enum(["leading", "lagging"]),
  northStar: z.boolean().optional(),
});

const taskRecordStatusInput = z.enum([
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

function normalizeTaskOutcomes(outcomes: z.infer<typeof taskOutcomeInput>[]): TaskOutcome[] {
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

const taskRestructureInput = z.discriminatedUnion("kind", [
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

const TASK_MANAGER_PROJECTION_FILE = "tasks.md";

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
async function runTaskManagerAgentAutomation(
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
const TASK_CHANGE_HISTORY_LIMIT = 200;

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
async function countTaskChangeDecisions(
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
async function runTaskChangeGate(
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
const EDITED_PLANNING_ITEM = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  exitTest: z.string().trim().min(1).max(2_000).optional(),
  measure: z.string().trim().min(1).max(2_000).optional(),
  target: z.string().trim().min(1).max(2_000).optional(),
  indicatorKind: z.enum(["leading", "lagging"]).optional(),
  proposedTitle: z.string().trim().min(1).max(160).optional(),
  taskId: z.string().uuid().optional(),
}).strict();

function sha256Content(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function idempotentUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function requireInstalledTaskManager(wiring: Wiring, organizationId: string) {
  const installation = await wiring.moduleStore.getAvailable(organizationId, "task-manager");
  if (!installation || installation.status !== "installed" || !installation.manifest.module) {
    throw new TRPCError({ code: "NOT_FOUND", message: "installed Task Manager Module not found" });
  }

  return installation;
}

async function requireOrganizationNameForFiles(
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

async function replaceTaskProjectionFile(
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

const CHAT_TASK_AUTOMATION_ID = "b0000000-0000-4000-a000-0000000000f9";
const CHAT_TASK_SKILL_ID = "task-manager.create-task";
const CHAT_MODEL_TIER: ModelTier = "default";
const CHAT_TURN_STALE_AFTER_MS = 10 * 60_000;
const chatTurnAbortControllers = new Map<string, AbortController>();
const chatTurnProposalStaging = new Set<string>();

function chatOwnerScope(
  organizationId: string,
  ownerUserId: string,
): ChatOwnerScope {
  return { organizationId, ownerUserId };
}

function chatHumanTaint(
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

function withHumanInputTaint(
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

function resolveChatModel(wiring: Wiring, plane: "local" | "cloud"): ModelProvider | null {
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

async function chatCanCreateTask(
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

function resolvedChatSurface(
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

async function assembleChatCompletion(
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
         ? "Return one JSON object matching the supplied schema. All five keys are required. If the person is not explicitly asking to create a Task, kind MUST be answer or clarification, put the response in text, and set title, outcome, and exitTest to empty strings. If and only if the person explicitly asks to create a Task, kind MUST be create_task, text MUST explain that the Task proposal is ready for review, and the requested Task title, outcome, and exit test MUST be copied into title, outcome, and exitTest. Never put the Task title in text instead of title. Creating a Task is a proposal and must not be described as already completed."
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

function parseChatAssistantEnvelope(text: string) {
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

async function addChatTurnRef(
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

async function appendChatRoutingDecision(
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

async function resolveChatCreateTaskSkill(
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
const CHAT_TASK_ANCHOR_SCAN_TURNS = 100;

/** Every Task node this Chat thread has staged, with the Human decision on it.
 * The thread -> Task reference is the one that already exists: the proposal id
 * is derived from the turn id, and the proposal's own inputs name the Task. */
async function chatThreadTaskNodes(
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
function chatTaskParentCandidates(
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

async function stageChatTaskProposal(
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

async function findChatRetryUser(
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

async function resolveChatRetryPair(
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

async function completeDecidedChatTurn(
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

async function recordChatTaskResult(
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

async function loadChatThreadView(
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

function chatLedgerEntryIsProposal(entry: LedgerEntry): boolean {
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

function chatTaskProposalInput(entry: LedgerEntry) {
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

function entryClaimsChatTaskProposal(entry: LedgerEntry): boolean {
  return (
    typeof entry.inputs === "object" &&
    entry.inputs !== null &&
    !Array.isArray(entry.inputs) &&
    "kind" in entry.inputs &&
    entry.inputs.kind === "task_create"
  );
}

async function requireChatTaskProposalBinding(
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

async function finishChatTaskDecision(
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

async function ensureTaskManagerAutomation(
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
): Promise<{ goalId: string; taskId: string }> {
  const seam = { nextId: () => run.ids.next(), nowISO: () => run.clock.nowISO() };
  const goals = await wiring.goalTasks.listGoals(organizationId);
  const goal =
    goals.find((candidate) => candidate.type === "task-manager") ??
    await wiring.goalTasks.createGoal({
      organizationId,
      type: "task-manager",
      title: "Task Manager guard Automations",
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

/** TASK-032 flight gate — every `learning.*` procedure except `status` fails
 * closed when the flight is off. `PRECONDITION_FAILED` (not `FORBIDDEN`): the
 * caller's authority is fine; the capability is deliberately not active. */
function assertLearningFlightEnabled(ctx: { wiring: Pick<Wiring, "learningObservationEnabled"> }): void {
  if (!ctx.wiring.learningObservationEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "learning observation flight is disabled (BRIDGE_LEARNING_OBSERVATION)",
    });
  }
}

function assertClaimFlightEnabled(ctx: { wiring: Pick<Wiring, "claimSubstrateEnabled"> }): void {
  if (!ctx.wiring.claimSubstrateEnabled) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "claim substrate flight is disabled (BRIDGE_CLAIM_SUBSTRATE)",
    });
  }
}

function assertHumanIdentity(ctx: { identity: { type: string } }, what: string): void {
  if (ctx.identity.type !== "user") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${what} is a Human decision — only a user identity may do it`,
    });
  }
}

function assertRetrievalFlightEnabled(ctx: { wiring: Pick<Wiring, "retrievalFusionEnabled"> }): void {
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
function assertArchetypesFlightEnabled(
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
function learningActionError(error: unknown): unknown {
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

export const appRouter = t.router({
  chat: t.router({
    model: t.router({
      status: authenticatedProcedure
        .input(z.object({ organizationId: z.string().uuid() }).strict())
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          const local = await ctx.wiring.managedModel.status();
          const cloud = resolveChatModel(ctx.wiring, "cloud");
          // Reuse ModelProviderKeyStore.list's own configured/active bits
          // (ADR-181/AP-104) rather than re-deriving "is a key saved" here —
          // this is the same read Settings -> API Keys shows, just folded
          // into the status Chat already polls so the composer can offer
          // Cloud as a real choice instead of only a forced local-model path.
          const keyStatuses = await ctx.wiring.modelProviderKeys.list(input.organizationId, {
            env: process.env,
            activeProviderIds: new Set(ctx.wiring.models.providers().keys()),
          });
          const cloudKey = keyStatuses.find((status) => status.providerId === "groq");
          const cloudKeySaved = Boolean(cloudKey?.configured || cloudKey?.fromEnvironment);
          return {
            local,
            cloud: cloud
              ? {
                  available: true as const,
                  providerId: cloud.id,
                  modelTier: CHAT_MODEL_TIER,
                  configured: true,
                  restartRequired: false,
                }
              : {
                  available: false as const,
                  providerId: null,
                  modelTier: CHAT_MODEL_TIER,
                  // A key can be saved (Settings -> API Keys) but not yet
                  // active in THIS process — `createModelRouter` snapshots
                  // providers at construction (ADR-181). Distinguishing the
                  // two lets Chat say "restart to activate" instead of the
                  // misleading "no key configured" for both cases.
                  configured: cloudKeySaved,
                  restartRequired: cloudKeySaved,
                },
          };
        }),
      install: authenticatedProcedure
        .input(z.object({ organizationId: z.string().uuid() }).strict())
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          return ctx.wiring.managedModel.install();
        }),
      cancelInstall: authenticatedProcedure
        .input(z.object({ organizationId: z.string().uuid() }).strict())
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          return ctx.wiring.managedModel.cancelInstall();
        }),
      start: authenticatedProcedure
        .input(z.object({ organizationId: z.string().uuid() }).strict())
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          await ctx.wiring.managedModel.requestStart();
          return ctx.wiring.managedModel.status();
        }),
      stop: authenticatedProcedure
        .input(z.object({ organizationId: z.string().uuid() }).strict())
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          await ctx.wiring.managedModel.requestStop();
          return ctx.wiring.managedModel.status();
        }),
    }),

    thread: t.router({
      create: authenticatedProcedure
        .input(z.object({
          organizationId: z.string().uuid(),
          plane: z.enum(["local", "cloud"]).optional(),
          title: z.string().trim().min(1).max(200).optional(),
          clientRequestId: z.string().trim().min(1).max(200).optional(),
        }).strict())
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          if (ctx.wiring.publicCloudOnly && input.plane === "local") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "The hosted web deployment cannot create Local Plane Chat threads",
            });
          }
          const plane = ctx.wiring.publicCloudOnly ? "cloud" : input.plane ?? "local";
          const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
          const thread = await ctx.wiring.chatStore.createThread(scope, {
            id: input.clientRequestId
              ? idempotentUuid(
                  `${input.organizationId}:${ctx.identity.id}:chat-thread:${plane}:${input.clientRequestId}`,
                )
              : ctx.run.ids.next(),
            plane,
            dataScope: plane === "local" ? "private" : "public",
            ...(input.title ? { title: input.title } : {}),
          });
          return loadChatThreadView(ctx.wiring, scope, thread.id, ctx.run);
        }),
      list: authenticatedProcedure
        .input(z.object({
          organizationId: z.string().uuid(),
          status: z.enum(["active", "archived"]).optional(),
          cursor: z.object({
            updatedAt: z.string().datetime(),
            id: z.string().uuid(),
          }).strict().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        }).strict())
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          return ctx.wiring.chatStore.listThreads(
            chatOwnerScope(input.organizationId, ctx.identity.id),
            {
              ...(input.status ? { status: input.status } : {}),
              ...(input.cursor ? { cursor: input.cursor } : {}),
              ...(input.limit ? { limit: input.limit } : {}),
            },
          );
        }),
      get: authenticatedProcedure
        .input(z.object({
          organizationId: z.string().uuid(),
          threadId: z.string().uuid(),
          cursor: z.object({
            sequence: z.number().int().positive(),
          }).strict().optional(),
        }).strict())
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          return loadChatThreadView(
            ctx.wiring,
            chatOwnerScope(input.organizationId, ctx.identity.id),
            input.threadId,
            ctx.run,
            input.cursor,
          );
        }),
      archive: authenticatedProcedure
        .input(z.object({
          organizationId: z.string().uuid(),
          threadId: z.string().uuid(),
        }).strict())
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          const archived = await ctx.wiring.chatStore.archiveThread(
            chatOwnerScope(input.organizationId, ctx.identity.id),
            input.threadId,
          );
          if (!archived) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
          }
          return archived;
        }),
      delete: authenticatedProcedure
        .input(z.object({
          organizationId: z.string().uuid(),
          threadId: z.string().uuid(),
        }).strict())
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          const deleted = await ctx.wiring.chatStore.deleteThread(
            chatOwnerScope(input.organizationId, ctx.identity.id),
            input.threadId,
          );
          if (!deleted) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
          }
          return { deleted: true as const };
        }),
    }),

    turn: t.router({
      prepareCloud: authenticatedProcedure
        .input(chatSendInput.omit({ clientRequestId: true, cloudGrantId: true }))
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
          const thread = await ctx.wiring.chatStore.getThread(scope, input.threadId);
          if (!thread) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
          }
          if (thread.plane !== "cloud" || thread.dataScope !== "public") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Cloud consent is available only for a public Cloud Plane thread",
            });
          }
          const provider = resolveChatModel(ctx.wiring, "cloud");
          if (!provider) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "No authorized cloud model provider is configured",
            });
          }
          const retryPair = input.retryTurnId
            ? await resolveChatRetryPair(
                ctx.wiring,
                scope,
                thread.id,
                input.retryTurnId,
              )
            : null;
          if (retryPair && retryPair.user.content !== input.message) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Retry content must match the original user request",
            });
          }
          const prepared = await assembleChatCompletion(
            ctx,
            thread,
            input.message,
            input.surface,
            provider,
            retryPair
              ? [retryPair.user.id, retryPair.assistant.id]
              : [],
          );
          const grantId = ctx.run.ids.next();
          const expiresAt = new Date(
            new Date(ctx.run.clock.nowISO()).getTime() + 5 * 60_000,
          ).toISOString();
          await ctx.wiring.chatStore.createCloudGrant(scope, {
            id: grantId,
            threadId: thread.id,
            contextDigest: prepared.contextDigest,
            providerId: provider.id,
            modelTier: CHAT_MODEL_TIER,
            expiresAt,
          });
          return {
            grantId,
            expiresAt,
            contextDigest: prepared.contextDigest,
            disclosure: prepared.disclosure,
          };
        }),

      send: authenticatedProcedure
        .input(chatSendInput)
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
          const thread = await ctx.wiring.chatStore.getThread(scope, input.threadId);
          if (!thread) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
          }
          const userTurnId = idempotentUuid(
            `${thread.id}:${input.clientRequestId}:user`,
          );
          const assistantTurnId = idempotentUuid(
            `${thread.id}:${input.clientRequestId}:assistant`,
          );
          if (input.retryTurnId) {
            const retryPair = await resolveChatRetryPair(
              ctx.wiring,
              scope,
              thread.id,
              input.retryTurnId,
            );
            if (
              retryPair.assistant.id !== assistantTurnId ||
              retryPair.user.clientRequestId !== input.clientRequestId ||
              retryPair.user.content !== input.message
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Retry must preserve the original Chat turn identity and content",
              });
            }
          }
          const taintLabel = chatHumanTaint(
            thread,
            `chat:${thread.id}:${input.clientRequestId}`,
            input.message,
          );
          await ctx.wiring.chatStore.appendTurn(scope, {
            id: userTurnId,
            threadId: thread.id,
            role: "user",
            actorType: "human",
            actorId: thread.ownerUserId,
            content: input.message,
            state: "completed",
            clientRequestId: input.clientRequestId,
            taintLabel,
          });
          // AI Harness K2 (TASK-046): the owner's own turn becomes an
          // envelope-only learning signal — flight on, LOCAL thread, and the
          // chat source's consent explicitly ON (default off). The mapper's
          // envelope type cannot express `content`, so the message text has
          // no path into the signal row; the deterministic id makes a
          // replayed clientRequestId a no-op. Same durability plane as the
          // turn write above, so no catch: if the Memory store is down the
          // request is already failing.
          if (ctx.wiring.learningObservationEnabled && thread.plane === "local") {
            const consent = await readCaptureConsentState(ctx.wiring, input.organizationId);
            if (captureAllowed(consent, "chat")) {
              const signalId = chatCaptureSignalId(userTurnId);
              const owner = { organizationId: input.organizationId, userId: thread.ownerUserId };
              if (!(await ctx.wiring.memoryStore.get(signalId, owner))) {
                const signal = chatTurnCaptureSignal(
                  {
                    turnId: userTurnId,
                    threadId: thread.id,
                    plane: thread.plane,
                    surface: input.surface?.kind ?? "chat_panel",
                    sentAt: new Date().toISOString(),
                    taintLabel,
                  },
                  owner,
                  signalId,
                );
                if (signal) await recordCaptureSignal(ctx.wiring.memoryStore, signal);
              }
            }
            // AI Harness K6 (TASK-050): commitment detection over the owner's
            // OWN turn on the conversation surface the assistant is already
            // reading — an in-conversation capability, not ambient capture,
            // so it rides the learning flight rather than the K2 chat
            // capture toggle (whose contract is envelope-only SIGNALS; this
            // writes none — it writes a suggestion quoting the user's own
            // sentence back for a human decision, and only acceptance
            // materializes a Commitment through the governed pipeline).
            // Deterministic lineage per normalized sentence + the annoyance
            // cap keep a re-sent message from re-asking. Same durability
            // plane as the turn write, so no catch.
            const candidates = detectCommitmentCandidates(
              input.message,
              new Date().toISOString(),
            );
            if (candidates.length > 0) {
              await proposeCommitmentSuggestions(ctx.wiring.memoryStore, {
                organizationId: input.organizationId,
                ownerUserId: thread.ownerUserId,
                candidates,
                nextId: () => ctx.run.ids.next(),
                lineageIdFor: deterministicUuid,
                taintLabel,
              });
            }
          }
          const assistantTurn = await ctx.wiring.chatStore.appendTurn(scope, {
            id: assistantTurnId,
            threadId: thread.id,
            role: "assistant",
            actorType: "agent",
            actorId: INTERNAL_STRATEGIST_AGENT,
            content: "",
            state: "queued",
            clientRequestId: `${input.clientRequestId}:assistant`,
            taintLabel,
          });
          const loadSendResponse = () =>
            loadChatThreadView(
              ctx.wiring,
              scope,
              thread.id,
              ctx.run,
              input.retryTurnId
                ? { sequence: assistantTurn.sequence + 1 }
                : undefined,
            );
          try {
            if (assistantTurn.state === "queued") {
              await ctx.wiring.chatStore.updateTurn(scope, {
                threadId: thread.id,
                turnId: assistantTurnId,
                expectedState: "queued",
                state: "processing",
              });
            } else if (assistantTurn.state === "failed") {
              await ctx.wiring.chatStore.updateTurn(scope, {
                threadId: thread.id,
                turnId: assistantTurnId,
                expectedState: "failed",
                state: "processing",
                content: "",
                errorCode: null,
              });
            } else {
              return loadSendResponse();
            }
          } catch (error) {
            if (error instanceof ChatStoreConflictError) {
              return loadSendResponse();
            }
            throw error;
          }

          const controller = new AbortController();
          chatTurnAbortControllers.set(assistantTurnId, controller);
          try {
            const provider = resolveChatModel(ctx.wiring, thread.plane);
            if (!provider) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: thread.plane === "local"
                  ? "No local model provider is configured"
                  : "No authorized cloud model provider is configured",
              });
            }
            if (thread.plane === "local") {
              const status = await ctx.wiring.managedModel.status();
              if (
                provider.id === MANAGED_LLAMA_PROVIDER_ID &&
                status.state !== "ready"
              ) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: `The local model is ${status.state}; finish setup before sending`,
                });
              }
              if (input.cloudGrantId) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "A cloud grant cannot be used for a Local Plane thread",
                });
              }
            }

            const prepared = await assembleChatCompletion(
              ctx,
              thread,
              input.message,
              input.surface,
              provider,
              [userTurnId, assistantTurnId],
            );
            let cloudEgress: PublicCloudModelEgress | undefined;
            if (thread.plane === "cloud") {
              if (!input.cloudGrantId) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: "This public cloud turn needs fresh exact-context consent",
                });
              }
              await ctx.wiring.chatStore.consumeCloudGrant(scope, {
                id: input.cloudGrantId,
                threadId: thread.id,
                contextDigest: prepared.contextDigest,
                providerId: provider.id,
                modelTier: CHAT_MODEL_TIER,
              });
              cloudEgress = { dataScope: "public", userConfirmed: true };
            }
            const governed = createGovernedModelProvider(
              ctx,
              thread.organizationId,
              provider,
              "governed_chat_turn",
              cloudEgress,
            );
            const completion = await governed.provider.complete({
              ...prepared.request,
              signal: controller.signal,
            });
            const receiptLedgerId = governed.receiptLedgerId();
            if (receiptLedgerId) {
              await addChatTurnRef(
                ctx.wiring,
                scope,
                thread.id,
                assistantTurnId,
                "model_receipt",
                receiptLedgerId,
              );
            }

            let envelope: z.infer<typeof chatAssistantEnvelopeSchema>;
            try {
              envelope = parseChatAssistantEnvelope(completion.text);
            } catch (parseError) {
              if (thread.plane === "cloud") throw parseError;
              const repair = createGovernedModelProvider(
                ctx,
                thread.organizationId,
                provider,
                "governed_chat_turn_repair",
              );
              const repaired = await repair.provider.complete({
                ...prepared.request,
                prompt:
                  `${input.message}\n\nThe prior output was invalid. Return only one JSON object matching the response schema.`,
                signal: controller.signal,
              });
              const repairReceipt = repair.receiptLedgerId();
              if (repairReceipt) {
                await addChatTurnRef(
                  ctx.wiring,
                  scope,
                  thread.id,
                  assistantTurnId,
                  "model_receipt",
                  repairReceipt,
                );
              }
              envelope = parseChatAssistantEnvelope(repaired.text);
            }

            if (envelope.kind === "create_task") {
              if (!prepared.canCreateTask) {
                throw new Error("The model selected a capability that was not disclosed");
              }
              chatTurnProposalStaging.add(assistantTurnId);
              let staged: Awaited<ReturnType<typeof stageChatTaskProposal>>;
              try {
                staged = await stageChatTaskProposal(
                  ctx,
                  thread,
                  assistantTurnId,
                  envelope,
                );
              } finally {
                chatTurnProposalStaging.delete(assistantTurnId);
              }
              if (staged.proposal.status !== "pending_review") {
                throw new Error("The governed Task proposal did not stop for Human review");
              }
              const routingId = await appendChatRoutingDecision(
                ctx,
                thread,
                assistantTurnId,
                { kind: "skill", ...staged.resolution },
              );
              await Promise.all([
                addChatTurnRef(
                  ctx.wiring,
                  scope,
                  thread.id,
                  assistantTurnId,
                  "routing_decision",
                  routingId,
                ),
                addChatTurnRef(
                  ctx.wiring,
                  scope,
                  thread.id,
                  assistantTurnId,
                  "proposal",
                  staged.proposal.id,
                ),
                addChatTurnRef(
                  ctx.wiring,
                  scope,
                  thread.id,
                  assistantTurnId,
                  "automation_run",
                  staged.runId,
                ),
              ]);
              await ctx.wiring.chatStore.updateTurn(scope, {
                threadId: thread.id,
                turnId: assistantTurnId,
                expectedState: "processing",
                state: "awaiting_decision",
                content: envelope.text,
              });
            } else {
              const routingId = await appendChatRoutingDecision(
                ctx,
                thread,
                assistantTurnId,
                {
                  kind: envelope.kind === "answer" ? "direct_answer" : "clarification",
                },
              );
              await addChatTurnRef(
                ctx.wiring,
                scope,
                thread.id,
                assistantTurnId,
                "routing_decision",
                routingId,
              );
              await ctx.wiring.chatStore.updateTurn(scope, {
                threadId: thread.id,
                turnId: assistantTurnId,
                expectedState: "processing",
                state: "completed",
                content: envelope.text,
              });
            }
            return loadSendResponse();
          } catch (error) {
            const current = await ctx.wiring.chatStore.getTurn(
              scope,
              thread.id,
              assistantTurnId,
            );
            if (current?.state === "cancelled") {
              return loadSendResponse();
            }
            if (current?.state === "processing") {
              const refs = await ctx.wiring.chatStore.listTurnRefs(
                scope,
                thread.id,
                assistantTurnId,
              );
              const proposalRef = refs.find((ref) => ref.kind === "proposal");
              const proposal = proposalRef
                ? await ctx.wiring.ledger.get(proposalRef.refId)
                : null;
              if (proposal && chatLedgerEntryIsProposal(proposal)) {
                await ctx.wiring.chatStore.updateTurn(scope, {
                  threadId: thread.id,
                  turnId: assistantTurnId,
                  expectedState: "processing",
                  state: "awaiting_decision",
                  ...(current.content
                    ? {}
                    : { content: "This Task proposal is ready for your review." }),
                });
                return loadSendResponse();
              }
              await ctx.wiring.chatStore.updateTurn(scope, {
                threadId: thread.id,
                turnId: assistantTurnId,
                expectedState: "processing",
                state: "failed",
                content: "I couldn't complete this turn. You can retry it safely.",
                errorCode: error instanceof ChatCloudGrantError
                  ? "cloud_grant_invalid"
                  : error instanceof DOMException && error.name === "AbortError"
                    ? "cancelled"
                    : "chat_turn_failed",
              });
              const runRef = refs.find((ref) => ref.kind === "automation_run");
              const automationRun = runRef
                ? await ctx.wiring.automationRunRecorder.get(
                    thread.organizationId,
                    runRef.refId,
                  )
                : null;
              if (automationRun?.status === "running") {
                await ctx.wiring.automationRunRecorder.finish(
                  {
                    runId: automationRun.runId,
                    organizationId: thread.organizationId,
                    status: "halted",
                    output: {
                      kind: "error",
                      errorCode: "proposal_staging_failed",
                    },
                  },
                  ctx.run,
                );
              }
            }
            if (error instanceof TRPCError) throw error;
            if (error instanceof ChatCloudGrantError) {
              throw new TRPCError({ code: "FORBIDDEN", message: error.message });
            }
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error instanceof Error ? error.message : "Chat turn failed",
            });
          } finally {
            chatTurnAbortControllers.delete(assistantTurnId);
          }
        }),

      cancel: authenticatedProcedure
        .input(z.object({
          organizationId: z.string().uuid(),
          threadId: z.string().uuid(),
          turnId: z.string().uuid(),
        }).strict())
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
          const turn = await ctx.wiring.chatStore.getTurn(
            scope,
            input.threadId,
            input.turnId,
          );
          if (!turn) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Chat turn not found" });
          }
          if (turn.state !== "processing") {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Chat turn is ${turn.state}, not processing`,
            });
          }
          if (chatTurnProposalStaging.has(turn.id)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This turn is staging a governed proposal and can no longer be stopped",
            });
          }
          const refs = await ctx.wiring.chatStore.listTurnRefs(
            scope,
            input.threadId,
            turn.id,
          );
          const proposalRef = refs.find((ref) => ref.kind === "proposal");
          const proposal = proposalRef
            ? await ctx.wiring.ledger.get(proposalRef.refId)
            : null;
          if (proposal && chatLedgerEntryIsProposal(proposal)) {
            await ctx.wiring.chatStore.updateTurn(scope, {
              threadId: input.threadId,
              turnId: turn.id,
              expectedState: "processing",
              state: "awaiting_decision",
              ...(turn.content
                ? {}
                : { content: "This Task proposal is ready for your review." }),
            });
            return loadChatThreadView(
              ctx.wiring,
              scope,
              input.threadId,
              ctx.run,
            );
          }
          chatTurnAbortControllers.get(turn.id)?.abort(
            new DOMException("Chat turn cancelled", "AbortError"),
          );
          await ctx.wiring.chatStore.updateTurn(scope, {
            threadId: input.threadId,
            turnId: input.turnId,
            expectedState: "processing",
            state: "cancelled",
            content: "Stopped.",
            errorCode: "cancelled",
          });
          return loadChatThreadView(
            ctx.wiring,
            scope,
            input.threadId,
            ctx.run,
          );
        }),
    }),
  }),

  taskManager: t.router({
    list: authenticatedProcedure.input(z.object({ organizationId: z.string().uuid() })).query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      return ctx.wiring.taskManager.list(input.organizationId);
    }),
    get: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      taskId: z.string().uuid(),
    })).query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const task = await ctx.wiring.taskManager.get(input.organizationId, input.taskId);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: `unknown Task ${input.taskId}` });
      return task;
    }),
    create: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      title: z.string().trim().min(1),
      taskType: z.string().trim().min(1).optional(),
      isGoal: z.boolean().optional(),
      outcomes: z.array(taskOutcomeInput).default([]),
      reviewCadence: z.string().trim().min(1).optional(),
      exitTest: z.string().trim().min(1).optional(),
      status: taskRecordStatusInput.optional(),
      priority: z.string().trim().min(1).optional(),
      ownerType: z.enum(["human", "agent"]),
      ownerId: z.string().uuid(),
      assignedAgentId: z.string().uuid().optional(),
      requiredSkillId: z.string().trim().min(1).optional(),
      parentTaskId: z.string().uuid().optional(),
      scheduledFor: z.string().date().optional(),
    })).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const taskId = ctx.run.ids.next();
      const taskInput = {
        id: taskId,
        organizationId: input.organizationId,
        title: input.title,
        outcomes: normalizeTaskOutcomes(input.outcomes),
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        ...(input.taskType ? { taskType: input.taskType } : {}),
        ...(input.isGoal !== undefined ? { isGoal: input.isGoal } : {}),
        ...(input.reviewCadence ? { reviewCadence: input.reviewCadence } : {}),
        ...(input.exitTest ? { exitTest: input.exitTest } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.assignedAgentId ? { assignedAgentId: input.assignedAgentId } : {}),
        ...(input.requiredSkillId ? { requiredSkillId: input.requiredSkillId } : {}),
        ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
        ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
      };
      const populated = (await ctx.wiring.taskManager.list(input.organizationId)).length > 0;
      // ADR-203 — the impact analysis is now Internal Strategist's own Run
      // running the real `impact-fit-analysis` Skill, not a kernel-passthrough
      // proposal wearing the Human's name. The queue-side `impact_fit` row and
      // this pipeline proposal share one id, so one decision resolves both.
      const impactRun = populated
        ? await runTaskManagerAgentAutomation(ctx, {
            organizationId: input.organizationId,
            automationId: TASK_MANAGER_IMPACT_FIT_AUTOMATION_ID,
            name: "Task Manager task-created impact analysis",
            agentId: INTERNAL_STRATEGIST_AGENT,
            skill: "task-manager.impact-fit-analysis",
            action: "write",
            params: {
              queue: await ctx.wiring.taskManager.list(input.organizationId),
              // ADR-204 — the edges make the resequence proposal dependency-aware.
              dependencies: await ctx.wiring.taskManager.listDependencies(input.organizationId),
              taskId,
              title: taskInput.title,
              ...(taskInput.exitTest ? { exitTest: taskInput.exitTest } : {}),
              ...(taskInput.parentTaskId ? { parentTaskId: taskInput.parentTaskId } : {}),
            },
            runId: idempotentUuid(`${input.organizationId}:impact_fit_run:${taskId}`),
            proposalId: idempotentUuid(`${input.organizationId}:impact_fit:${taskId}`),
            taintKey: `task-manager:impact-fit:${ctx.identity.id}:${taskId}`,
          })
        : null;
      const governed = impactRun?.proposal ?? null;
      if (governed && governed.status !== "pending_review") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Task impact analysis did not halt for Human review (${governed.status}: ${governed.rejectionReason ?? "no reason"})`,
        });
      }
      let proposalIdAvailable = Boolean(governed);
      return ctx.wiring.taskManager.create(taskInput, {
        nextId: () => {
          if (governed && proposalIdAvailable) {
            proposalIdAvailable = false;
            return governed.id;
          }
          return ctx.run.ids.next();
        },
        nowISO: () => ctx.run.clock.nowISO(),
      });
    }),
    transition: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      taskId: z.string().uuid(),
      status: taskRecordStatusInput,
    })).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      return ctx.wiring.taskManager.transition(input.organizationId, input.taskId, input.status, {
        nextId: () => ctx.run.ids.next(),
        nowISO: () => ctx.run.clock.nowISO(),
      });
    }),
    verify: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      taskId: z.string().uuid(),
      evidenceRefs: z.array(z.string().trim().min(1)).min(1),
    })).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      return ctx.wiring.taskManager.verify(input.organizationId, input.taskId, {
        verifiedAt: ctx.run.clock.nowISO(),
        verifiedBy: ctx.identity.id,
        evidenceRefs: input.evidenceRefs,
        result: "passed",
      }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });
    }),
    updateOutcomeTarget: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      taskId: z.string().uuid(),
      outcomeId: z.string().min(1),
      target: z.string().trim().min(1),
    })).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const result = await ctx.wiring.taskManager.updateOutcomeTarget(
        input.organizationId,
        input.taskId,
        input.outcomeId,
        input.target,
        { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
      );
      if (result.reopenProposal) {
        // ADR-203 — Internal Strategist's own Run. A moved target is exactly
        // an impact-fit question ("does this Task still fit what we now want"),
        // so the Skill's analysis becomes the REASONING attached to the reopen
        // prompt rather than a prompt with nothing behind it. The Run's
        // proposal shares the reopen proposal's id, so one decision resolves
        // both records.
        const { proposal: governed } = await runTaskManagerAgentAutomation(ctx, {
          organizationId: input.organizationId,
          automationId: TASK_MANAGER_REOPEN_AUTOMATION_ID,
          name: "Task Manager target-change reopen prompt",
          agentId: INTERNAL_STRATEGIST_AGENT,
          skill: "task-manager.impact-fit-analysis",
          action: "write",
          params: {
            queue: await ctx.wiring.taskManager.list(input.organizationId),
            dependencies: await ctx.wiring.taskManager.listDependencies(input.organizationId),
            taskId: input.taskId,
            title: result.task.title,
            ...(result.task.exitTest ? { exitTest: result.task.exitTest } : {}),
            ...(result.task.parentTaskId ? { parentTaskId: result.task.parentTaskId } : {}),
          },
          runId: idempotentUuid(`${input.organizationId}:reopen_run:${result.reopenProposal.id}`),
          proposalId: result.reopenProposal.id,
          taintKey: `task-manager:target-change-reopen:${ctx.identity.id}:${input.taskId}`,
        });
        if (governed.status !== "pending_review") {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Task reopen did not halt for Human review" });
        }
      }
      return result;
    }),
    proposeRestructure: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      operation: taskRestructureInput,
    })).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const operation = input.operation.kind === "insert_ancestor_above"
        ? {
            ...input.operation,
            ancestor: {
              id: input.operation.ancestor.id ?? ctx.run.ids.next(),
              organizationId: input.organizationId,
              title: input.operation.ancestor.title,
              ownerType: input.operation.ancestor.ownerType,
              ownerId: input.operation.ancestor.ownerId,
              ...(input.operation.ancestor.isGoal !== undefined ? { isGoal: input.operation.ancestor.isGoal } : {}),
              ...(input.operation.ancestor.outcomes ? { outcomes: normalizeTaskOutcomes(input.operation.ancestor.outcomes) } : {}),
              ...(input.operation.ancestor.exitTest ? { exitTest: input.operation.ancestor.exitTest } : {}),
            },
          }
        : input.operation;
      // ADR-203 — Internal Strategist's own Run running the real
      // `task-tree-restructure` Skill. The operation is what the Human asked
      // for; what the Skill adds is the recomputed subtree the reviewer is
      // actually approving.
      const { proposal: governed } = await runTaskManagerAgentAutomation(ctx, {
        organizationId: input.organizationId,
        automationId: TASK_MANAGER_RESTRUCTURE_AUTOMATION_ID,
        name: "Task Manager tree restructure proposal",
        agentId: INTERNAL_STRATEGIST_AGENT,
        skill: "task-manager.task-tree-restructure",
        action: "write",
        params: {
          queue: await ctx.wiring.taskManager.list(input.organizationId),
          operation,
        },
        runId: idempotentUuid(`${input.organizationId}:restructure_run:${input.operation.taskId}:${ctx.run.clock.nowISO()}`),
        taintKey: `task-manager:tree-restructure:${ctx.identity.id}:${input.operation.taskId}`,
      });
      if (governed.status !== "pending_review") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Task restructure did not halt for Human review (${governed.status}: ${governed.rejectionReason ?? "no reason"})`,
        });
      }
      let proposalIdAvailable = true;
      return ctx.wiring.taskManager.proposeRestructure(
        input.organizationId,
        operation,
        INTERNAL_STRATEGIST_AGENT,
        {
          nextId: () => {
            if (proposalIdAvailable) {
              proposalIdAvailable = false;
              return governed.id;
            }
            return ctx.run.ids.next();
          },
          nowISO: () => ctx.run.clock.nowISO(),
        },
      );
    }),
    /**
     * Read one Task-side proposal.
     *
     * Added with the edit decision (ADR-200) because editing requires seeing
     * what you are editing: `decideProposal` could always be called, but
     * nothing could fetch the drafted payload to show a reviewer first. The
     * pipeline proposal and this row share an id (ADR-199), so a client that
     * has the ledger entry can read the queue-side draft with the same id.
     */
    proposal: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      proposalId: z.string().uuid(),
    })).query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      return ctx.wiring.taskManager.getProposal(input.organizationId, input.proposalId);
    }),
    decideProposal: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      proposalId: z.string().uuid(),
      decision: z.enum(["approve", "edit", "veto"]),
      editedExternalContent: z.string().max(MAX_MODULE_FILE_BYTES).optional(),
      editedPlanningItems: z.array(EDITED_PLANNING_ITEM).min(1).max(MAX_MATERIALIZED_TASKS).optional(),
    })).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      if (ctx.identity.type !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Only a Human may decide a Task proposal" });
      const taskProposal = await ctx.wiring.taskManager.getProposal(input.organizationId, input.proposalId);
      if (!taskProposal) throw new TRPCError({ code: "NOT_FOUND", message: "Task proposal not found" });
      if (
        taskProposal.status === "pending_review" &&
        taskProposal.expiresAt &&
        Date.parse(taskProposal.expiresAt) <= Date.parse(ctx.run.clock.nowISO())
      ) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Task proposal expired" });
      }
      // ADR-200: `candidate` joins `projection_reconcile` as editable. Every
      // other kind stays approve-or-veto because its payload is a computed
      // PLAN over specific rows and versions (`archive_sweep`'s id/version
      // list, a restructure's operation) — an edited one is a different plan
      // that was never checked for staleness, not a corrected draft.
      if (input.decision === "edit" && !["projection_reconcile", "candidate"].includes(taskProposal.kind)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A ${taskProposal.kind} proposal can be approved or vetoed, not edited`,
        });
      }
      const decidePipeline = async (
        editedPayload?: Readonly<Record<string, unknown>>,
      ): Promise<Readonly<Record<string, unknown>>> => {
        try {
          await ctx.wiring.pipeline.decide(
            input.proposalId,
            input.decision,
            ctx.identity,
            ctx.run,
            editedPayload,
          );
        } catch (error) {
          if (!(error instanceof AlreadyResolvedError)) throw error;
          if (error.existingDecision !== input.decision) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Pipeline proposal was already resolved as ${error.existingDecision ?? "unknown"}`,
            });
          }
        }
        const decisionEntry = await ctx.wiring.ledger.decisionFor(input.proposalId);
        const payload: Readonly<Record<string, unknown>> = {
          ...(editedPayload ?? taskProposal.payload),
          ...(decisionEntry ? { decisionLedgerId: decisionEntry.id } : {}),
        };
        return payload;
      };
      const applyDecision = (payload: Readonly<Record<string, unknown>>) =>
        ctx.wiring.taskManager.decideProposal(
          input.organizationId,
          input.proposalId,
          input.decision,
          ctx.identity.id,
          { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
          payload,
        );

      if (taskProposal.kind === "projection_reconcile") {
        const installation = await requireInstalledTaskManager(ctx.wiring, input.organizationId);
        const organizationName = await requireOrganizationNameForFiles(
          ctx.wiring,
          input.organizationId,
          ctx.identity.id,
        );
        let editedPayload: Readonly<Record<string, unknown>> | undefined;
        if (input.decision === "edit" && taskProposal.status === "pending_review") {
          const externalContent = input.editedExternalContent;
          if (!externalContent) throw new TRPCError({ code: "BAD_REQUEST", message: "editedExternalContent is required" });
          const [tasks, editEdges] = await Promise.all([
            ctx.wiring.taskManager.list(input.organizationId),
            ctx.wiring.taskManager.listDependencies(input.organizationId),
          ]);
          const currentProjection = emitTasksMarkdown(tasks, 10, editEdges);
          const drift = detectTaskProjectionDrift(currentProjection, externalContent, tasks);
          if (!drift.drifted || drift.reason) {
            throw new TRPCError({ code: "CONFLICT", message: drift.reason ?? "Edited projection has no changes" });
          }
          editedPayload = {
            ...taskProposal.payload,
            externalContent,
            externalContentHash: drift.externalContentHash,
            changes: drift.changes,
          };
        }
        const effectivePayload = await decidePipeline(editedPayload);
        const runIdValue = taskProposal.payload["runId"];
        const runId = typeof runIdValue === "string" ? runIdValue : null;
        let effect;
        if (input.decision === "veto") {
          effect = {
            decided: await applyDecision(effectivePayload),
            runId,
            vetoed: true as const,
          };
        } else {
          let projection: { content: string; contentHash: string };
          if (taskProposal.status === "approved") {
            const existingProjection = taskProposal.result?.["projection"];
            if (
              typeof existingProjection !== "object" ||
              existingProjection === null ||
              typeof (existingProjection as { content?: unknown }).content !== "string"
            ) {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Applied projection has no durable result" });
            }
            projection = existingProjection as { content: string; contentHash: string };
          } else {
            const [currentTasks, appliedEdges] = await Promise.all([
              ctx.wiring.taskManager.list(input.organizationId),
              ctx.wiring.taskManager.listDependencies(input.organizationId),
            ]);
            const externalContent = effectivePayload["externalContent"];
            if (typeof externalContent !== "string") {
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Projection proposal has no external content" });
            }
            projection = emitTasksMarkdown(
              applyApprovedTaskProjectionReconciliation(
                currentTasks,
                externalContent,
                ctx.run.clock.nowISO(),
              ),
              10,
              appliedEdges,
            );
          }
          const fileEffect = await withOrganizationFileOperationLock(
            input.organizationId,
            async () => {
              const file = await readModuleFileContent(
                organizationName,
                installation.manifest.module!.displayName,
                TASK_MANAGER_PROJECTION_FILE,
                ctx.wiring.moduleFilesBridgeRoot,
              );
              const proposedFileHash = taskProposal.payload["externalFileHash"];
              const replayFileHash = sha256Content(projection.content);
              if (
                !file ||
                ![proposedFileHash, replayFileHash].some(
                  (candidate) => typeof candidate === "string" && candidate === file.contentHash,
                )
              ) {
                throw new TRPCError({ code: "CONFLICT", message: "tasks.md changed after reconciliation was proposed" });
              }
              const originalContent = Buffer.from(file.content).toString("utf8");
              const written = await replaceTaskProjectionFile(
                ctx.wiring,
                organizationName,
                installation.manifest.module!.displayName,
                file.contentHash,
                projection.content,
              );
              return { written, originalContent };
            },
          );
          let decided;
          try {
            decided = await applyDecision(effectivePayload);
          } catch (error) {
            try {
              await withOrganizationFileOperationLock(
                input.organizationId,
                () => replaceTaskProjectionFile(
                  ctx.wiring,
                  organizationName,
                  installation.manifest.module!.displayName,
                  fileEffect.written.contentHash,
                  fileEffect.originalContent,
                ),
              );
            } catch (rollbackError) {
              throw new AggregateError(
                [error, rollbackError],
                "Projection Database effect failed and tasks.md rollback also failed",
              );
            }
            throw error;
          }
          const durableProjection = decided.result?.["projection"];
          if (
            typeof durableProjection !== "object" ||
            durableProjection === null ||
            (durableProjection as { contentHash?: unknown }).contentHash !== projection.contentHash
          ) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Projection File and Database result diverged" });
          }
          effect = {
            decided,
            runId,
            vetoed: false as const,
            written: fileEffect.written,
            projection,
          };
        }
        if (effect.vetoed) {
          if (effect.runId) {
            await ctx.wiring.automationRunRecorder.finish({
              runId: effect.runId,
              organizationId: input.organizationId,
              status: "completed",
              output: { decision: "veto", proposalId: input.proposalId },
            }, ctx.run);
          }
          return effect.decided;
        }
        const indexed = await ctx.wiring.graphStore.indexModuleFile({
          organizationId: input.organizationId,
          ownerUserId: ctx.identity.id,
          moduleId: installation.id,
          moduleName: installation.moduleName,
          ...effect.written.item,
        });
        if (effect.runId) {
          await ctx.wiring.automationRunRecorder.finish({
            runId: effect.runId,
            organizationId: input.organizationId,
            status: "completed",
            output: {
              decision: input.decision,
              proposalId: input.proposalId,
              resultId: effect.decided.result?.["resultId"] ?? input.proposalId,
              eventId: effect.decided.result?.["eventId"] ?? null,
              fileId: indexed.id,
              fileHash: effect.written.contentHash,
              projectionHash: effect.projection.contentHash,
            },
          }, ctx.run);
        }
        return {
          ...effect.decided,
          evidence: {
            eventType: "task.projection_reconcile.approved",
            eventId: effect.decided.result?.["eventId"] ?? null,
            resultId: effect.decided.result?.["resultId"] ?? input.proposalId,
            fileId: indexed.id,
            runId: effect.runId,
            fileHash: effect.written.contentHash,
            projectionHash: effect.projection.contentHash,
          },
        };
      }

      // A planning draft the reviewer corrected before approving (ADR-200).
      // The merge is an allow-list over the ONE content key this kind
      // materializes from — see `mergeEditedPlanningPayload` for why `kind`,
      // the run id and the model receipt are never taken from the human.
      let editedPlanningPayload: Readonly<Record<string, unknown>> | undefined;
      if (input.decision === "edit" && taskProposal.kind === "candidate") {
        if (!input.editedPlanningItems) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "editedPlanningItems is required to edit a planning proposal" });
        }
        try {
          editedPlanningPayload = mergeEditedPlanningPayload(taskProposal.payload, input.editedPlanningItems);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error instanceof Error ? error.message : "Edited plan is not materializable",
          });
        }
      }
      const decided = await applyDecision(await decidePipeline(editedPlanningPayload));
      // Both kinds' Runs are already recorded `completed` by the executor when
      // the proposal halted for review; finishing again overwrites that output
      // with what the Human actually decided, so the Run record shows the
      // outcome rather than only that a draft was produced.
      if (taskProposal.kind === "archive_sweep" || taskProposal.kind === "candidate") {
        const runId = taskProposal.payload["runId"];
        if (typeof runId === "string") {
          await ctx.wiring.automationRunRecorder.finish({
            runId,
            organizationId: input.organizationId,
            status: "completed",
            output: {
              decision: input.decision,
              proposalId: input.proposalId,
              result: decided.result ?? null,
            },
          }, ctx.run);
        }
      }
      return decided;
    }),
    projection: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      externalContent: z.string().optional(),
    })).query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const [tasks, edges] = await Promise.all([
        ctx.wiring.taskManager.list(input.organizationId),
        ctx.wiring.taskManager.listDependencies(input.organizationId),
      ]);
      const projection = emitTasksMarkdown(tasks, 10, edges);
      return {
        projection,
        ...(input.externalContent ? { drift: detectTaskProjectionDrift(projection, input.externalContent, tasks) } : {}),
        guards: evaluateTaskGuards(tasks),
      };
    }),
    emitProjectionFile: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      expectedFileHash: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable().optional(),
    })).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const installation = await requireInstalledTaskManager(ctx.wiring, input.organizationId);
      const [projectedTasks, projectedEdges] = await Promise.all([
        ctx.wiring.taskManager.list(input.organizationId),
        ctx.wiring.taskManager.listDependencies(input.organizationId),
      ]);
      const projection = emitTasksMarkdown(projectedTasks, 10, projectedEdges);
      const organizationName = await requireOrganizationNameForFiles(
        ctx.wiring,
        input.organizationId,
        ctx.identity.id,
      );
      const written = await withOrganizationFileOperationLock(
        input.organizationId,
        () =>
          replaceTaskProjectionFile(
            ctx.wiring,
            organizationName,
            installation.manifest.module!.displayName,
            input.expectedFileHash ?? null,
            projection.content,
          ),
      );
      const indexed = await ctx.wiring.graphStore.indexModuleFile({
        organizationId: input.organizationId,
        ownerUserId: ctx.identity.id,
        moduleId: installation.id,
        moduleName: installation.moduleName,
        ...written.item,
      });

      // The per-repo agent-ledger template (TM6 deliverable, ADR-209), written
      // beside the projection in the same operation.
      //
      // It ships WITH the projection rather than separately because the two are
      // one artifact: `tasks.md` says what the work is, and this says how to
      // work it. TM6's exit test is another repository's coding agent working a
      // full Task from this folder, and that agent arrives knowing nothing about
      // proposals, drift, or evidence — a projection alone teaches it that this
      // is a file it may simply rewrite.
      //
      // Rendered from the same constants that enforce the rules, so it cannot
      // describe a contract the server would then refuse. Its own hash is not
      // checked against a caller expectation: it is generated, never edited,
      // and a stale copy is simply replaced.
      const template = emitAgentLedgerTemplate({
        moduleDisplayName: installation.manifest.module!.displayName,
        organizationName,
        projectionFileName: TASK_MANAGER_PROJECTION_FILE,
        completedCap: TASK_PROJECTION_COMPLETED_CAP,
        statuses: TASK_RECORD_STATUSES,
      });
      const writtenTemplate = await withOrganizationFileOperationLock(
        input.organizationId,
        async () => {
          // Read the current hash INSIDE the lock and pass it as the
          // expectation. There is no unconditional-overwrite mode, and there
          // should not be: the template is regenerated rather than edited, but
          // a concurrent writer is still a conflict worth refusing rather than
          // clobbering. `null` means "must be absent", which is only true the
          // first time.
          const existing = await readModuleFileContent(
            organizationName,
            installation.manifest.module!.displayName,
            AGENT_LEDGER_TEMPLATE_FILE,
            ctx.wiring.moduleFilesBridgeRoot,
          );
          return replaceModuleFileContent(
            organizationName,
            installation.manifest.module!.displayName,
            AGENT_LEDGER_TEMPLATE_FILE,
            existing?.contentHash ?? null,
            Buffer.from(template, "utf8"),
            ctx.wiring.moduleFilesBridgeRoot,
          );
        },
      );
      const indexedTemplate = await ctx.wiring.graphStore.indexModuleFile({
        organizationId: input.organizationId,
        ownerUserId: ctx.identity.id,
        moduleId: installation.id,
        moduleName: installation.moduleName,
        ...writtenTemplate.item,
      });

      return {
        projection,
        file: written.item,
        fileHash: written.contentHash,
        fileId: indexed.id,
        agentTemplate: {
          file: writtenTemplate.item,
          fileHash: writtenTemplate.contentHash,
          fileId: indexedTemplate.id,
        },
      };
    }),
    proposeProjectionReconcile: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      externalContent: z.string().max(MAX_MODULE_FILE_BYTES),
      expectedFileHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      idempotencyKey: z.string().trim().min(8).max(200),
      expiresAt: z.string().datetime(),
    })).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const expiresAt = Date.parse(input.expiresAt);
      const now = Date.parse(ctx.run.clock.nowISO());
      if (expiresAt <= now || expiresAt > now + 24 * 60 * 60 * 1000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Projection proposal expiry must be within the next 24 hours" });
      }
      const installation = await requireInstalledTaskManager(ctx.wiring, input.organizationId);
      const assignment = await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
        automationId: TASK_MANAGER_DRIFT_AUTOMATION_ID,
        name: "Task Manager ledger drift detector",
        agentId: INTERNAL_STRATEGIST_AGENT,
        skill: "task-manager.ledger-projection",
        action: "write",
      }, ctx.run);
      const organizationName = await requireOrganizationNameForFiles(
        ctx.wiring,
        input.organizationId,
        ctx.identity.id,
      );
      const file = await withOrganizationFileOperationLock(
        input.organizationId,
        () => readModuleFileContent(
            organizationName,
            installation.manifest.module!.displayName,
            TASK_MANAGER_PROJECTION_FILE,
            ctx.wiring.moduleFilesBridgeRoot,
        ),
      );
      if (!file || file.contentHash !== input.expectedFileHash) {
        throw new TRPCError({ code: "CONFLICT", message: "tasks.md does not match expectedFileHash" });
      }
      if (Buffer.from(file.content).toString("utf8") !== input.externalContent) {
        throw new TRPCError({ code: "CONFLICT", message: "Submitted projection is not the current tasks.md File" });
      }
      const [tasks, reconcileEdges] = await Promise.all([
        ctx.wiring.taskManager.list(input.organizationId),
        ctx.wiring.taskManager.listDependencies(input.organizationId),
      ]);
      const projection = emitTasksMarkdown(tasks, 10, reconcileEdges);
      const drift = detectTaskProjectionDrift(projection, input.externalContent, tasks);
      if (!drift.drifted || drift.reason) {
        throw new TRPCError({ code: "CONFLICT", message: drift.reason ?? "tasks.md has no drift" });
      }
      const payload = {
            beforeProjectionHash: projection.contentHash,
            externalContentHash: drift.externalContentHash,
            externalFileHash: input.expectedFileHash,
            recordVersions: projection.recordVersions,
            changes: drift.changes,
            externalContent: input.externalContent,
            assignment,
      };
      const proposalId = idempotentUuid(
            `${input.organizationId}:projection_reconcile:${input.idempotencyKey}`,
      );
      const runId = idempotentUuid(
            `${input.organizationId}:projection_reconcile_run:${input.idempotencyKey}`,
      );
      const staged = await ctx.wiring.taskManager.stageProposal({
            id: proposalId,
            organizationId: input.organizationId,
            kind: "projection_reconcile",
            taskId: drift.changes[0]!.id,
            actorId: INTERNAL_STRATEGIST_AGENT,
            payload: { ...payload, runId },
            idempotencyKey: input.idempotencyKey,
            expiresAt: input.expiresAt,
      }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });
      if (await ctx.wiring.ledger.get(proposalId)) {
        return { proposal: staged, runId, drift };
      }
      const run = await ctx.wiring.automationExecutor.runById({
            organizationId: input.organizationId,
            automationId: TASK_MANAGER_DRIFT_AUTOMATION_ID,
            onBehalfOf: { type: "user", id: ctx.identity.id },
            params: payload,
            seed: input.idempotencyKey,
            runId,
            proposalId,
      }, withHumanInputTaint(
        ctx.run,
        `task-manager:ledger-drift:${ctx.identity.id}:${runId}`,
        payload,
      ));
      const governed = run.proposals[0];
      if (!governed || governed.id !== proposalId || governed.status !== "pending_review") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Ledger drift Automation did not halt for review (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
        });
      }
      return { proposal: staged, runId, drift };
    }),
    /**
     * TM3 planning Playbooks, run as a governed Automation.
     *
     * Human-triggered on purpose. The other Task Manager Automations fire on a
     * cadence or a Task Event; these Skills answer a question somebody asked
     * ("decompose this", "write me an exit test"), so the trigger is a person.
     * It is an Automation anyway so the invocation gets an attributable
     * Internal Strategist Run and a proposal that halts for review — before
     * this, the planning Skills were reachable only through the registry and
     * nothing had ever actually run one.
     *
     * No `TaskChangeProposal` is staged: `projection_reconcile` and
     * `archive_sweep` stage one because approval APPLIES a concrete mutation,
     * and there is nothing to apply here. The pipeline proposal carrying the
     * draft IS the review artifact.
     */
    runPlanningPlaybook: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      taskId: z.string().uuid(),
      skill: z.enum([
        "goal-outcome-framing",
        "candidate-task-generation",
        "premortem-scenario",
        "task-decomposition",
        "exit-test-authoring",
      ]),
      playbookId: z.string().trim().min(1).max(80).optional(),
      horizon: z.string().trim().min(1).max(160).optional(),
      idempotencyKey: z.string().trim().min(8).max(200),
      expiresAt: z.string().datetime(),
    }).strict()).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      await requireInstalledTaskManager(ctx.wiring, input.organizationId);

      const task = await ctx.wiring.taskManager.get(input.organizationId, input.taskId);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      const queue = await ctx.wiring.taskManager.list(input.organizationId);
      const children = queue.filter((candidate) => candidate.parentTaskId === task.id);

      const skillId = `task-manager.${input.skill}`;
      await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
        automationId: TASK_MANAGER_PLANNING_AUTOMATION_ID,
        name: "Task Manager planning Playbook",
        agentId: INTERNAL_STRATEGIST_AGENT,
        skill: skillId,
        action: "write",
      }, ctx.run);

      // Only the fields the chosen Skill can actually use. The Task's own path
      // is the PARENT path for decomposition — children land beneath it — and
      // the existing child paths are what keep generated dot-paths from
      // colliding with live rows.
      const params: Record<string, unknown> = {
        title: task.title,
        outcomes: task.outcomes.map((outcome) => ({
          title: outcome.title,
          measure: outcome.measure,
          target: outcome.target,
        })),
        ...(task.exitTest ? { exitTest: task.exitTest } : {}),
        ...(input.playbookId ? { playbookId: input.playbookId } : {}),
        ...(input.horizon ? { horizon: input.horizon } : {}),
        ...(input.skill === "task-decomposition"
          ? {
              parentPath: task.path,
              existingChildPaths: children.map((child) => child.path),
              existingChildTitles: children.map((child) => child.title),
            }
          : {}),
        ...(input.skill === "candidate-task-generation"
          ? { existingChildTitles: children.map((child) => child.title) }
          : {}),
      };

      const runId = idempotentUuid(
        `${input.organizationId}:planning_playbook_run:${input.skill}:${input.idempotencyKey}`,
      );
      // The model call is governed HERE rather than inside the Skill: this is
      // the only layer with the request context `authorizeModelCompletion`
      // and the receipt append need. Local plane only, matching the Skills'
      // own `plane: "local"` manifests — `resolveLocalPlanningModel` fails
      // closed to `undefined`, and the Skill then returns its Playbook
      // scaffold rather than drafting.
      const planningModel = resolveLocalPlanningModel(ctx.wiring.models);
      const governedModel = planningModel
        ? createGovernedModelProvider(
            ctx,
            input.organizationId,
            planningModel,
            `task-manager:${input.skill}`,
          )
        : undefined;

      // ONE id for both records: the pipeline proposal (ledger) and the
      // Task-Manager-side `candidate` row that approval materializes. That
      // shared id is what lets `taskManager.decideProposal` resolve the
      // pipeline decision and the queue write as a single human decision —
      // the same pairing `projection_reconcile` and `archive_sweep` use.
      const proposalId = idempotentUuid(
        `${input.organizationId}:planning_playbook:${input.skill}:${input.idempotencyKey}`,
      );
      const run = await ctx.wiring.automationExecutor.runById({
        organizationId: input.organizationId,
        automationId: TASK_MANAGER_PLANNING_AUTOMATION_ID,
        onBehalfOf: { type: "user", id: ctx.identity.id },
        params,
        seed: input.idempotencyKey,
        runId,
        proposalId,
      }, {
        ...withHumanInputTaint(
          ctx.run,
          `task-manager:planning-playbook:${ctx.identity.id}:${runId}`,
          params,
        ),
        ...(governedModel ? { modelProvider: governedModel.provider } : {}),
      });
      const governed = run.proposals[0];
      if (!governed || governed.id !== proposalId || governed.status !== "pending_review") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Planning Automation did not halt for review (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
        });
      }

      // Stage the Task-Manager-side proposal that approval materializes
      // (ADR-199). The pipeline proposal above is the governed review record;
      // this is the row `taskManager.decideProposal` turns into Tasks.
      const draft = (governed.output?.proposedOutput ?? {}) as Record<string, unknown>;
      const staged = await ctx.wiring.taskManager.stageProposal({
        id: proposalId,
        organizationId: input.organizationId,
        kind: "candidate",
        taskId: task.id,
        actorId: INTERNAL_STRATEGIST_AGENT,
        payload: { ...draft, runId },
        idempotencyKey: `${input.skill}:${input.idempotencyKey}`,
        expiresAt: input.expiresAt,
      }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });

      return {
        runId,
        skill: skillId,
        taskId: task.id,
        proposal: governed,
        candidateProposal: staged,
        modelReceiptLedgerId: governedModel?.receiptLedgerId() ?? null,
      };
    }),
    /**
     * `proactive-scan-cadence`, given a runtime binding at last. Declared in
     * the Module manifest since TM0 with no Automation id and no procedure
     * behind it — the same declared-not-built gap the planning Skills had.
     *
     * Proposes candidate Tasks and writes none: `scanForOpportunities` reads
     * the queue and every finding names the row it came from, so approval is
     * where a candidate would ever become real.
     */
    runOpportunityScan: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      idempotencyKey: z.string().trim().min(8).max(200),
      expiresAt: z.string().datetime(),
    }).strict()).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      await requireInstalledTaskManager(ctx.wiring, input.organizationId);

      const queue = await ctx.wiring.taskManager.list(input.organizationId);
      await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
        automationId: TASK_MANAGER_SCAN_AUTOMATION_ID,
        name: "Task Manager proactive opportunity scan",
        agentId: INTERNAL_STRATEGIST_AGENT,
        skill: "task-manager.proactive-opportunity-scan",
        action: "write",
      }, ctx.run);

      const params = { queue };
      const runId = idempotentUuid(
        `${input.organizationId}:opportunity_scan_run:${input.idempotencyKey}`,
      );
      const proposalId = idempotentUuid(
        `${input.organizationId}:opportunity_scan:${input.idempotencyKey}`,
      );
      const run = await ctx.wiring.automationExecutor.runById({
        organizationId: input.organizationId,
        automationId: TASK_MANAGER_SCAN_AUTOMATION_ID,
        onBehalfOf: { type: "user", id: ctx.identity.id },
        params,
        seed: input.idempotencyKey,
        runId,
        proposalId,
      }, withHumanInputTaint(
        ctx.run,
        `task-manager:opportunity-scan:${ctx.identity.id}:${runId}`,
        { taskCount: queue.length },
      ));
      const governed = run.proposals[0];
      if (!governed || governed.id !== proposalId || governed.status !== "pending_review") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Opportunity scan Automation did not halt for review (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
        });
      }

      // The scan's findings become candidate Tasks only on approval
      // (ADR-199), and each lands under the Task its finding named.
      const draft = (governed.output?.proposedOutput ?? {}) as Record<string, unknown>;
      const opportunities = Array.isArray(draft["opportunities"]) ? draft["opportunities"] : [];
      if (opportunities.length === 0) {
        // An honest empty scan raises no proposal at all. Staging one would
        // put "approve this nothing" in the review inbox.
        return { runId, proposal: governed, candidateProposal: null };
      }
      // Anchored on the first finding's own Task: `applyApprovedPlanningProposal`
      // re-homes each candidate under the row its finding named, so this only
      // has to be a real Task the proposal can be attached to.
      const subjectId = (opportunities[0] as { taskId?: unknown }).taskId;
      const staged = await ctx.wiring.taskManager.stageProposal({
        id: proposalId,
        organizationId: input.organizationId,
        kind: "candidate",
        taskId: typeof subjectId === "string" ? subjectId : queue[0]!.id,
        actorId: INTERNAL_STRATEGIST_AGENT,
        payload: { ...draft, runId },
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
      }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });

      return { runId, proposal: governed, candidateProposal: staged };
    }),
    /**
     * The two Chief of Staff cadence briefs (ADR-201).
     *
     * Both were declared Automations from TM0 with no runtime id, blocked on
     * the same thing: Chief of Staff had no governed Agent identity, so an
     * Automation it owned had no actor to run as.
     *
     * They REPORT and stop. Neither raises a Task-Manager proposal, because
     * neither proposes a change — a brief's product is what the reader now
     * knows, the same reason an approved pre-mortem writes nothing (ADR-199).
     * They read the queue, so the step's action is `read`: forcing a Human to
     * approve being told about their own Tasks would be governance theatre,
     * and the Run itself is the attributable record.
     *
     * One Skill behind both, on purpose. `progress-synthesis` already answers
     * "what moved and what did not" over a window, and its `stalled` list IS
     * the staleness question asked over a longer one. A nineteenth Skill for
     * the same computation would have been a roster entry, not a capability.
     */
    runQueueBrief: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      brief: z.enum(["standup-brief", "stale-task-review"]),
      /** The window each brief looks back over. Defaults differ because the
       * questions differ: a standup asks "since yesterday", a staleness
       * review asks "what has nobody touched in two weeks". */
      windowDays: z.number().int().min(1).max(90).optional(),
      idempotencyKey: z.string().trim().min(8).max(200),
    }).strict()).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      await requireInstalledTaskManager(ctx.wiring, input.organizationId);

      const isStaleReview = input.brief === "stale-task-review";
      const windowDays = input.windowDays ?? (isStaleReview ? DEFAULT_STALE_AFTER_DAYS : 1);
      const automationId = isStaleReview
        ? TASK_MANAGER_STALE_REVIEW_AUTOMATION_ID
        : TASK_MANAGER_STANDUP_AUTOMATION_ID;

      const queue = await ctx.wiring.taskManager.list(input.organizationId);
      await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
        automationId,
        name: isStaleReview ? "Task Manager stale task review" : "Task Manager standup brief",
        agentId: CHIEF_OF_STAFF_AGENT,
        skill: "task-manager.progress-synthesis",
        action: "read",
      }, ctx.run);

      const until = ctx.run.clock.nowISO();
      const since = new Date(Date.parse(until) - windowDays * 24 * 60 * 60 * 1000).toISOString();
      // `queue` is the dispatcher's authorized-input key for every
      // Task Manager Skill that reads the queue (a Skill invoked without it
      // THROWS rather than reporting an empty brief — ADR-198).
      const params = { queue, since, until };
      const runId = idempotentUuid(
        `${input.organizationId}:queue_brief_run:${input.brief}:${input.idempotencyKey}`,
      );
      const run = await ctx.wiring.automationExecutor.runById({
        organizationId: input.organizationId,
        automationId,
        onBehalfOf: { type: "user", id: ctx.identity.id },
        params,
        seed: input.idempotencyKey,
        runId,
      }, withHumanInputTaint(
        ctx.run,
        `task-manager:${input.brief}:${ctx.identity.id}:${runId}`,
        { taskCount: queue.length, windowDays },
      ));
      const governed = run.proposals[0];
      if (!governed || governed.status === "rejected") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `${input.brief} Automation did not produce a brief (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
        });
      }
      const brief = (governed.output?.proposedOutput ?? null) as Record<string, unknown> | null;
      // A staleness review reports ONLY the stalled section: the rest of the
      // synthesis is a standup's answer to a different question, and shipping
      // it here would bury the one list this Automation exists to surface.
      const stalled = Array.isArray(brief?.["stalled"]) ? brief["stalled"] as unknown[] : [];
      return {
        runId,
        proposal: governed,
        window: { since, until, windowDays },
        brief: isStaleReview
          ? { kind: "stale_task_review" as const, stalled, count: stalled.length, basis: brief?.["basis"] ?? null }
          : brief,
      };
    }),
    /**
     * The two Governance guard Automations (ADR-202).
     *
     * `evaluateTaskGuards` has existed since TM0 but was reachable only as
     * read-only data hanging off the `projection` query, so neither
     * `wip-breach-detector` nor `unverified-done-challenger` had anything to
     * run. They now evaluate the queue as attributable Governance Runs.
     *
     * Each Automation reports ONLY its own finding kind. One guard evaluator
     * with several callers is not the same as one Automation that dumps every
     * finding under whichever name you invoked it by — a WIP breach and an
     * unverified `done` are different problems with different remedies, and
     * merging them would make either one easy to miss.
     */
    runQueueGuard: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      // `goal-review-cadence` is Internal Strategist's, not Governance's
      // (ADR-107's split: whether a goal is due for review is a planning
      // question, not a control question), so it runs as that Agent over the
      // same evaluator.
      guard: z.enum(["wip-breach-detector", "unverified-done-challenger", "goal-review-cadence"]),
      wipLimit: z.number().int().min(1).max(20).optional(),
      idempotencyKey: z.string().trim().min(8).max(200),
    }).strict()).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      await requireInstalledTaskManager(ctx.wiring, input.organizationId);

      const guardBinding = {
        "wip-breach-detector": {
          automationId: TASK_MANAGER_WIP_BREACH_AUTOMATION_ID,
          name: "Task Manager WIP breach detector",
          agentId: GOVERNANCE_AGENT,
          finding: "wip_breach",
        },
        "unverified-done-challenger": {
          automationId: TASK_MANAGER_UNVERIFIED_DONE_AUTOMATION_ID,
          name: "Task Manager unverified done challenger",
          agentId: GOVERNANCE_AGENT,
          finding: "unverified_done",
        },
        "goal-review-cadence": {
          automationId: TASK_MANAGER_GOAL_REVIEW_AUTOMATION_ID,
          name: "Task Manager goal review cadence",
          agentId: INTERNAL_STRATEGIST_AGENT,
          finding: "goal_review_due",
        },
      }[input.guard];
      const automationId = guardBinding.automationId;
      const queue = await ctx.wiring.taskManager.list(input.organizationId);
      await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
        automationId,
        name: guardBinding.name,
        agentId: guardBinding.agentId,
        skill: "task-manager.queue-guard",
        action: "read",
      }, ctx.run);

      const runId = idempotentUuid(
        `${input.organizationId}:queue_guard_run:${input.guard}:${input.idempotencyKey}`,
      );
      const run = await ctx.wiring.automationExecutor.runById({
        organizationId: input.organizationId,
        automationId,
        onBehalfOf: { type: "user", id: ctx.identity.id },
        params: { queue, ...(input.wipLimit !== undefined ? { wipLimit: input.wipLimit } : {}) },
        seed: input.idempotencyKey,
        runId,
      }, withHumanInputTaint(
        ctx.run,
        `task-manager:${input.guard}:${ctx.identity.id}:${runId}`,
        { taskCount: queue.length },
      ));
      const governed = run.proposals[0];
      if (!governed || governed.status === "rejected") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `${input.guard} Automation did not evaluate the queue (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
        });
      }
      const output = (governed.output?.proposedOutput ?? {}) as Record<string, unknown>;
      const all = Array.isArray(output["findings"]) ? output["findings"] as { kind?: unknown }[] : [];
      const findings = all.filter((finding) => finding.kind === guardBinding.finding);
      return {
        runId,
        proposal: governed,
        guard: input.guard,
        findings,
        // A guard reports; it never transitions a Task. An unverified `done`
        // carries `proposedStatus: "pending"` as the guard's SUGGESTION, and
        // reopening it stays a Human's governed act through `transition`.
        breached: findings.length > 0,
      };
    }),
    /**
     * The deterministic approval gate, shared by `reschedule-approval-gate`
     * and `routing-approval-gate` (ADR-107: "reschedule + routing governance
     * share one mechanism"; ADR-073: the KERNEL decides, the Agent explains).
     *
     * The calibration counts come from REAL vetted decision history, not from
     * the caller. `taskManager.approvalBand` — the read-only query that
     * predates this — takes `approvals`/`vetoes` as client inputs, which
     * means anything calling it could hand itself a calibrated verdict. A gate
     * that trusts the caller's account of its own track record is not a gate.
     */
    runChangeGate: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      kind: z.enum(["route", "reschedule"]),
      deltaDays: z.number().int().min(-3650).max(3650).optional(),
      candidateCount: z.number().int().min(0).max(100).optional(),
      crossesModule: z.boolean().optional(),
      idempotencyKey: z.string().trim().min(8).max(200),
    }).strict()).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      await requireInstalledTaskManager(ctx.wiring, input.organizationId);
      return runTaskChangeGate(ctx, {
        organizationId: input.organizationId,
        kind: input.kind,
        ...(input.deltaDays !== undefined ? { deltaDays: input.deltaDays } : {}),
        ...(input.candidateCount !== undefined ? { candidateCount: input.candidateCount } : {}),
        ...(input.crossesModule !== undefined ? { crossesModule: input.crossesModule } : {}),
        idempotencyKey: input.idempotencyKey,
      });
    }),
    /**
     * Task dependency Relations (ADR-204) — the `depends_on` edges the plan
     * has specified since TM0 and the schema never had. Every slice since
     * ADR-196 recorded the same residual: `proposeQueueSequence` honoured the
     * `blocked` STATUS, which says someone believed a Task was blocked but not
     * by what, so nothing could ever tell them it had stopped being true.
     */
    dependencies: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
    })).query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const [queue, edges] = await Promise.all([
        ctx.wiring.taskManager.list(input.organizationId),
        ctx.wiring.taskManager.listDependencies(input.organizationId),
      ]);
      return { dependencies: edges, blocked: blockedTasks(queue, edges) };
    }),
    addDependency: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      taskId: z.string().uuid(),
      dependsOnTaskId: z.string().uuid(),
      reason: z.string().trim().min(1).max(2_000).optional(),
    }).strict()).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      // Both ends must be real Tasks in THIS Organization. The composite FKs
      // enforce it in Postgres; checking here turns a constraint violation
      // into an answer the caller can act on.
      const [task, blocker] = await Promise.all([
        ctx.wiring.taskManager.get(input.organizationId, input.taskId),
        ctx.wiring.taskManager.get(input.organizationId, input.dependsOnTaskId),
      ]);
      if (!task || !blocker) throw new TRPCError({ code: "NOT_FOUND", message: "Both Tasks must exist in this Organization" });
      try {
        return await ctx.wiring.taskManager.addDependency({
          organizationId: input.organizationId,
          taskId: input.taskId,
          dependsOnTaskId: input.dependsOnTaskId,
          ...(input.reason ? { reason: input.reason } : {}),
        }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });
      } catch (error) {
        // A cycle is not a bad plan, it is an UNSATISFIABLE one: every Task in
        // it waits forever and no amount of finishing work clears it. 409, not
        // 500 — the request was well-formed and the answer is "no".
        if (error instanceof TaskDependencyCycleError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        }
        throw error;
      }
    }),
    removeDependency: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      dependencyId: z.string().uuid(),
    }).strict()).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const removed = await ctx.wiring.taskManager.removeDependency(input.organizationId, input.dependencyId);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Dependency not found" });
      return { removed };
    }),
    /**
     * `dependency-unblock-notifier` (ADR-204) — the last Chief of Staff
     * Automation, and the one that was blocked on the SCHEMA rather than on
     * ownership: until now there were no edges whose clearing anyone could
     * notice.
     *
     * It notifies and stops. A blocker landing does not make the dependent
     * Task started, and flipping its status would decide for the Human that
     * the work is now theirs to pick up.
     */
    runDependencyUnblockNotifier: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      idempotencyKey: z.string().trim().min(8).max(200),
    }).strict()).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      await requireInstalledTaskManager(ctx.wiring, input.organizationId);
      const [queue, dependencies] = await Promise.all([
        ctx.wiring.taskManager.list(input.organizationId),
        ctx.wiring.taskManager.listDependencies(input.organizationId),
      ]);
      const { runId, proposal } = await runTaskManagerAgentAutomation(ctx, {
        organizationId: input.organizationId,
        automationId: TASK_MANAGER_DEPENDENCY_AUTOMATION_ID,
        name: "Task Manager dependency unblock notifier",
        agentId: CHIEF_OF_STAFF_AGENT,
        skill: "task-manager.dependency-analysis",
        action: "read",
        params: { queue, dependencies },
        runId: idempotentUuid(`${input.organizationId}:dependency_unblock_run:${input.idempotencyKey}`),
        taintKey: `task-manager:dependency-unblock:${ctx.identity.id}:${input.idempotencyKey}`,
      });
      const output = (proposal.output?.proposedOutput ?? {}) as Record<string, unknown>;
      return {
        runId,
        proposal,
        unblocked: Array.isArray(output["unblocked"]) ? output["unblocked"] : [],
        blocked: Array.isArray(output["blocked"]) ? output["blocked"] : [],
      };
    }),
    runCompletedBaySweep: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      completedCap: z.number().int().min(0).max(100).default(10),
      maxAgeDays: z.number().int().min(0).max(365).default(7),
      idempotencyKey: z.string().trim().min(8).max(200),
      expiresAt: z.string().datetime(),
    })).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const nowIso = ctx.run.clock.nowISO();
      const expiresAt = Date.parse(input.expiresAt);
      const now = Date.parse(nowIso);
      if (expiresAt <= now || expiresAt > now + 24 * 60 * 60 * 1000) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Sweep proposal expiry must be within the next 24 hours" });
      }
      const proposalId = idempotentUuid(
        `${input.organizationId}:archive_sweep:${input.idempotencyKey}`,
      );
      const existingProposal = await ctx.wiring.taskManager.getProposal(
        input.organizationId,
        proposalId,
      );
      if (existingProposal) {
        const runId = existingProposal.payload["runId"];
        return {
          runId: typeof runId === "string" ? runId : null,
          proposal: existingProposal,
          plan: {
            eligibleTaskIds: existingProposal.payload["taskIds"] ?? [],
            expectedVersions: existingProposal.payload["recordVersions"] ?? {},
            policy: existingProposal.payload["policy"] ?? null,
          },
        };
      }
      const tasks = await ctx.wiring.taskManager.list(input.organizationId);
      const plan = planCompletedBaySweep(tasks, nowIso, input.completedCap, input.maxAgeDays);
      if (plan.eligibleTaskIds.length === 0) {
        const runId = idempotentUuid(
          `${input.organizationId}:archive_sweep_noop:${input.idempotencyKey}`,
        );
        const existingRuns = await ctx.wiring.automationRunRecorder.list(
          input.organizationId,
          [TASK_MANAGER_SWEEP_AUTOMATION_ID],
          { limit: 50 },
        );
        if (existingRuns.some((run) => run.runId === runId)) {
          return { runId, proposal: null, plan };
        }
        await ctx.wiring.automationRunRecorder.start({
          runId,
          automationId: TASK_MANAGER_SWEEP_AUTOMATION_ID,
          organizationId: input.organizationId,
          agentId: GOVERNANCE_AGENT,
        }, ctx.run);
        await ctx.wiring.automationRunRecorder.finish({
          runId,
          organizationId: input.organizationId,
          status: "completed",
          output: { eligibleTaskIds: [], policy: plan.policy },
        }, ctx.run);
        return { runId, proposal: null, plan };
      }
      await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
        automationId: TASK_MANAGER_SWEEP_AUTOMATION_ID,
        name: "Task Manager completed bay sweep",
        agentId: GOVERNANCE_AGENT,
        skill: "task-manager.completed-bay-sweep",
        action: "archive",
      }, ctx.run);
      const payload = {
        taskIds: plan.eligibleTaskIds,
        recordVersions: plan.expectedVersions,
        policy: plan.policy,
      };
      const runId = idempotentUuid(
        `${input.organizationId}:archive_sweep_run:${input.idempotencyKey}`,
      );
      const staged = await ctx.wiring.taskManager.stageProposal({
        id: proposalId,
        organizationId: input.organizationId,
        kind: "archive_sweep",
        taskId: plan.eligibleTaskIds[0]!,
        actorId: GOVERNANCE_AGENT,
        payload: { ...payload, runId },
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
      }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });
      if (await ctx.wiring.ledger.get(proposalId)) {
        return { runId, proposal: staged, plan };
      }
      const run = await ctx.wiring.automationExecutor.runById({
        organizationId: input.organizationId,
        automationId: TASK_MANAGER_SWEEP_AUTOMATION_ID,
        onBehalfOf: { type: "user", id: ctx.identity.id },
        params: payload,
        seed: input.idempotencyKey,
        runId,
        proposalId,
      }, withHumanInputTaint(
        ctx.run,
        `task-manager:completed-bay-sweep:${ctx.identity.id}:${runId}`,
        payload,
      ));
      const governed = run.proposals[0];
      if (!governed || governed.id !== proposalId || governed.status !== "pending_review") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Completed-bay Automation did not halt for review (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
        });
      }
      return { runId, proposal: staged, plan };
    }),
    /**
     * `agent-task-routing-on-assign` (ADR-207) — the LAST declared Automation
     * to get a runtime binding, and the reason it stayed unbound through eight
     * slices that bound thirteen others.
     *
     * `routeTaskByRequiredSkill` has existed since TM0 and `taskManager.route`
     * below exposes it. But `route` is a QUERY: it answers "who is eligible"
     * and nothing could ever act on the answer, because no write path set
     * `assignedAgentId` after a Task was created. Binding the Automation to
     * that computation would have produced an attributable Run that decided
     * nothing — the declared-not-built shape this workstream exists to end.
     * So the missing piece was a DECISION surface, and this is it.
     *
     * Three deliberate properties:
     *
     *  - The candidate set is `TASK_ROUTING_CANDIDATE_AGENTS`, resolved here,
     *    not passed in. `route`'s caller-supplied `candidateAgentIds` is
     *    harmless for a what-if, but on a path that WRITES it would turn "who
     *    is eligible" into "who did the caller offer" — a caller naming one
     *    Agent would manufacture the unambiguous answer that ADR-107 forbids
     *    anyone from defaulting to.
     *  - Routing to another Module's Skill is `crossesModule`, so it can never
     *    be minor and always stops for a Human however calibrated they are.
     *  - `human_assignment_required` stages NOTHING. There is no proposal to
     *    approve, because the honest output is "no Agent is eligible for this,
     *    a person has to own it" — offering an approve button there would
     *    invite someone to approve an assignment nobody computed.
     */
    assign: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      taskId: z.string().uuid(),
      idempotencyKey: z.string().trim().min(8).max(200),
      expiresAt: z.string().datetime(),
    }).strict()).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      await requireInstalledTaskManager(ctx.wiring, input.organizationId);

      const task = await ctx.wiring.taskManager.get(input.organizationId, input.taskId);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      const requiredSkillId = task.requiredSkillId;
      if (!requiredSkillId) {
        // Not a failure of routing — routing has nothing to answer. A Task
        // that names no required Skill is Human work by construction.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This Task names no required Skill, so there is nothing to route on — it is Human work until one is set",
        });
      }

      const skills = ctx.wiring.skillManifests.forSkill(input.organizationId, requiredSkillId);
      const candidates = await Promise.all(TASK_ROUTING_CANDIDATE_AGENTS.map(async (id) => ({
        id,
        active: (await ctx.wiring.agents.organizationId(id)) === input.organizationId
          && await ctx.wiring.agents.isActive(id),
        allowedSkills: await ctx.wiring.agents.allowedSkills(id),
        capabilityScope: await ctx.wiring.agents.capabilityScope(id),
        plane: "local" as const,
        dataScope: await ctx.wiring.agents.dataScope(id),
      })));

      // ONE id for the Chief of Staff Run's governed proposal and the
      // queue-side `route` row, the pairing ADR-199 established.
      const proposalId = idempotentUuid(
        `${input.organizationId}:agent_task_routing:${input.taskId}:${input.idempotencyKey}`,
      );
      const runId = idempotentUuid(
        `${input.organizationId}:agent_task_routing_run:${input.taskId}:${input.idempotencyKey}`,
      );
      const { proposal: governed } = await runTaskManagerAgentAutomation(ctx, {
        organizationId: input.organizationId,
        automationId: TASK_MANAGER_ROUTING_AUTOMATION_ID,
        name: "Task Manager agent-task routing on assign",
        agentId: CHIEF_OF_STAFF_AGENT,
        skill: "task-manager.agent-task-routing",
        action: "read",
        params: {
          requiredSkillId,
          agents: candidates,
          skills: skills.map((manifest) => ({
            skillId: manifest.skillId,
            permissions: manifest.permissions,
            plane: manifest.plane,
            dataScopes: manifest.dataScopes,
          })),
        },
        runId,
        proposalId,
        taintKey: `task-manager:agent-task-routing:${ctx.identity.id}:${runId}`,
      });

      const output = (governed.output?.proposedOutput ?? {}) as Record<string, unknown>;
      const routing = output["routing"] as
        | { kind: "assigned"; agentId: string }
        | { kind: "human_assignment_required"; reason: string; candidates: string[] }
        | undefined;
      if (!routing) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Routing Run produced no routing result" });
      }
      if (routing.kind !== "assigned") {
        return {
          runId,
          proposal: governed,
          routing,
          gate: null,
          routeProposal: null,
          assigned: null,
        };
      }

      // `routeTaskByRequiredSkill` returns `assigned` only when EXACTLY one
      // Agent was eligible, so the candidate count the band is classified on
      // is 1 by construction rather than by assertion.
      const crossesModule = !requiredSkillId.startsWith("task-manager.");
      const gate = await runTaskChangeGate(ctx, {
        organizationId: input.organizationId,
        kind: "route",
        candidateCount: 1,
        crossesModule,
        idempotencyKey: `assign:${input.taskId}:${input.idempotencyKey}`,
      });

      const staged = await ctx.wiring.taskManager.stageProposal({
        id: proposalId,
        organizationId: input.organizationId,
        kind: "route",
        taskId: task.id,
        actorId: CHIEF_OF_STAFF_AGENT,
        payload: {
          agentId: routing.agentId,
          requiredSkillId,
          // What the assignment was computed against. `applyApprovedRoutingProposal`
          // refuses if the Task moved on while the proposal sat in review.
          expectedVersion: task.version,
          crossesModule,
          band: gate.band ?? null,
          gateDecision: gate.decision ?? null,
          gateRunId: gate.runId,
          runId,
        },
        idempotencyKey: `agent-task-routing:${input.idempotencyKey}`,
        expiresAt: input.expiresAt,
      }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });

      if (gate.decision !== "auto_apply") {
        return { runId, proposal: governed, routing, gate, routeProposal: staged, assigned: null };
      }

      // The calibrated branch, honoured rather than merely computed. It runs
      // the SAME two steps `taskManager.decideProposal` runs for a clicked
      // approval — the pipeline decision then the queue write — because an
      // auto-applied assignment that skipped either would be a write with no
      // ledger row or a ledger row with no write. What calibration removes is
      // the Human's second click, not the record of the decision, and the
      // payload says so: `calibrated` marks it as standing consent this
      // Human earned, not a decision they made in the moment.
      await ctx.wiring.pipeline.decide(proposalId, "approve", ctx.identity, ctx.run);
      const decisionEntry = await ctx.wiring.ledger.decisionFor(proposalId);
      const decided = await ctx.wiring.taskManager.decideProposal(
        input.organizationId,
        proposalId,
        "approve",
        ctx.identity.id,
        { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
        {
          ...staged.payload,
          calibrated: true,
          calibration: gate.calibration,
          ...(decisionEntry ? { decisionLedgerId: decisionEntry.id } : {}),
        },
      );
      return { runId, proposal: governed, routing, gate, routeProposal: decided.proposal, assigned: decided.result ?? null };
    }),
    route: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      requiredSkillId: z.string().trim().min(1),
      candidateAgentIds: z.array(z.string().uuid()).min(1),
    })).query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const manifests = ctx.wiring.skillManifests.forSkill(input.organizationId, input.requiredSkillId);
      const agents = await Promise.all(input.candidateAgentIds.map(async (id) => ({
        id,
        active: (await ctx.wiring.agents.organizationId(id)) === input.organizationId && await ctx.wiring.agents.isActive(id),
        allowedSkills: await ctx.wiring.agents.allowedSkills(id),
        capabilityScope: await ctx.wiring.agents.capabilityScope(id),
        plane: "local" as const,
        dataScope: await ctx.wiring.agents.dataScope(id),
      })));
      return routeTaskByRequiredSkill(input.requiredSkillId, agents, manifests.map((manifest) => ({
        skillId: manifest.skillId,
        permissions: manifest.permissions,
        plane: manifest.plane,
        dataScopes: manifest.dataScopes,
      })));
    }),
    approvalBand: authenticatedProcedure.input(z.object({
      organizationId: z.string().uuid(),
      kind: z.enum(["route", "reschedule"]),
      deltaDays: z.number().optional(),
      candidateCount: z.number().int().nonnegative().optional(),
      crossesModule: z.boolean().optional(),
      approvals: z.number().int().nonnegative(),
      vetoes: z.number().int().nonnegative(),
    })).query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const band = classifyTaskChangeBand({
        kind: input.kind,
        ...(input.deltaDays !== undefined ? { deltaDays: input.deltaDays } : {}),
        ...(input.candidateCount !== undefined ? { candidateCount: input.candidateCount } : {}),
        ...(input.crossesModule !== undefined ? { crossesModule: input.crossesModule } : {}),
      });
      return { band, decision: calibratedTaskChangeDecision({
        band,
        approvals: input.approvals,
        vetoes: input.vetoes,
        actorType: ctx.identity.type === "user" ? "human" : "agent",
      }) };
    }),
  }),

  health: procedure.query(() => ({ ok: true, service: "bridge-api" })),

  view: t.router({
    geocoderStatus: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(
          ctx.wiring.organizationStore,
          input.organizationId,
          ctx.identity.id,
        );
        const provider = ctx.wiring.geocodingProvider;
        return {
          available: provider !== null,
          providerId: provider?.id ?? null,
          plane: provider?.plane ?? null,
          attribution: provider?.attribution ?? null,
        };
      }),

    resolveLocations: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          labels: z
            .array(z.string().trim().min(1).max(500))
            .min(1)
            .max(20),
          confirmedLocalProvider: z.literal(true),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(
          ctx.wiring.organizationStore,
          input.organizationId,
          ctx.identity.id,
        );
        const provider = ctx.wiring.geocodingProvider;
        if (!provider) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "No private Local Plane geocoder is configured. Enter coordinates directly or configure BRIDGE_LOCAL_GEOCODER_URL.",
          });
        }

        const labels = new Map<string, string>();
        for (const label of input.labels) {
          const trimmed = label.trim();
          const key = trimmed.toLocaleLowerCase("en-US");
          if (!labels.has(key)) labels.set(key, trimmed);
        }

        const results: Array<{
          query: string;
          coordinate: Awaited<ReturnType<typeof provider.geocode>>;
        }> = [];
        for (const query of labels.values()) {
          try {
            results.push({
              query,
              coordinate: await provider.geocode({ query }),
            });
          } catch (error) {
            if (error instanceof LocalGeocodingProviderError) {
              throw new TRPCError({
                code: "BAD_GATEWAY",
                message: error.message,
                cause: error,
              });
            }
            throw error;
          }
        }
        return {
          providerId: provider.id,
          attribution: provider.attribution ?? null,
          results,
        };
      }),
  }),

  action: t.router({
    /** Propose a governed mutation → Proposal (pending_review | applied | rejected). */
    propose: procedure.input(proposeInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      if (ctx.wiring.publicCloudOnly && input.dataScope !== "public") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The public cloud API accepts governed Actions only with explicit public data scope",
        });
      }
      if (input.actor.type === "agent") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Agent proposals must enter through the server-owned Agent runtime",
        });
      }
      // Human identity is SERVER-RESOLVED (ctx.identity), never taken from the request.
      // Agent services invoke the pipeline behind server-owned runtime boundaries rather
      // than allowing a browser to choose an Agent id.
      const actor = {
        type: ctx.identity.type,
        id: ctx.identity.id,
        plane: ctx.wiring.publicCloudOnly ? "cloud" as const : "local" as const,
      };
      const onBehalfOf = resolveClientOnBehalfOf(ctx.identity, input.onBehalfOf);
      return ctx.wiring.pipeline.propose(
        {
          organizationId: input.organizationId,
          actor,
          ...(onBehalfOf ? { onBehalfOf } : {}),
          action: input.action as Action,
          resourceType: input.resourceType as ResourceType,
          ...(input.resourceId ? { resourceId: input.resourceId } : {}),
          inputs: input.inputs,
          taintLabel: labelAtSource("human_input", {
            ref: `action.propose:${ctx.identity.id}:${input.seed ?? "unseeded"}`,
            valueHash: hashTaintValue(input.inputs),
            sensitivity:
              input.dataScope === "public" ? "public" : "organization",
            instructionRisk: "instruction_like",
          }),
          skill: KERNEL_PASSTHROUGH_SKILL,
          ...(input.dataScope ? { dataScope: input.dataScope as DataScope } : {}),
          ...(cleanContext(input.context) ? { context: cleanContext(input.context)! } : {}),
          ...(input.seed ? { seed: input.seed } : {}),
          ...(input.goalTaskRef ? { goalTaskRef: input.goalTaskRef } : {}),
        },
        ctx.run,
      );
    }),

    /** A constrained browser request for the server-owned Outreach Agent to draft
     * one relationship Event. The caller controls the content, never Agent
     * identity, Skill, governed resource/action, or approval policy. */
    proposeOutreachDraft: authenticatedProcedure
      .input(outreachDraftInput)
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only a user can request an Outreach Agent draft",
          });
        }

        const idempotencyKey = `${input.organizationId}:${ctx.identity.id}:${input.sourceId}`;
        const proposalId = stableOutreachProposalId(idempotencyKey);
        const active = outreachDraftsInFlight.get(idempotencyKey);
        if (active) return active;

        const operation = (async (): Promise<OutreachDraftResult> => {
          let offset = 0;
          while (true) {
            const pending = await ctx.wiring.pipeline.listPending(input.organizationId, {
              limit: 200,
              offset,
            });
            const existing = pending.items.find((proposal) => {
              const inputs = proposal.request.inputs;
              return (
                typeof inputs === "object" &&
                inputs !== null &&
                "sourceId" in inputs &&
                inputs.sourceId === input.sourceId &&
                proposal.request.actor.type === "agent" &&
                proposal.request.actor.id === OUTREACH_AGENT &&
                proposal.request.onBehalfOf?.type === "user" &&
                proposal.request.onBehalfOf.id === ctx.identity.id
              );
            });
            if (existing) return existing;
            offset += pending.items.length;
            if (pending.items.length === 0 || offset >= pending.total) break;
          }

          const goalTaskRef = await provisionOutreachDraftTask(
            ctx.wiring,
            input.organizationId,
          );
          try {
            return await ctx.wiring.pipeline.propose(
              {
                organizationId: input.organizationId,
                actor: { type: "agent", id: OUTREACH_AGENT },
                onBehalfOf: { type: "user", id: ctx.identity.id },
                action: "write",
                resourceType: "event",
                inputs: {
                  text: input.proposed,
                  sourceId: input.sourceId,
                  runId: input.runId ?? null,
                  display: {
                    action: input.label,
                    actor: "Outreach Agent",
                    actorKind: "agent",
                    onBehalfOf: "You",
                    resource: input.resource,
                    policy: "Agent-authored relationship drafts require Human approval",
                    channel: input.channel,
                    prior: input.prior ?? null,
                    trace: input.trace,
                  },
                },
                skill: "outreach.stageDraft",
                dataScope: "public",
                goalTaskRef,
                ...(input.runId
                  ? { context: { type: "automation", id: input.runId, runId: input.runId } }
                  : {}),
                seed: input.sourceId,
                trustOrigin: "user_content",
              },
              ctx.run,
              { proposalId },
            );
          } catch (cause) {
            // The ledger primary key is the cross-process idempotency gate. A loser
            // of the insert race returns the winner's pending proposal.
            let offset = 0;
            while (true) {
              const pending = await ctx.wiring.pipeline.listPending(input.organizationId, {
                limit: 200,
                offset,
              });
              const winner = pending.items.find((proposal) => proposal.id === proposalId);
              if (winner) return winner;
              offset += pending.items.length;
              if (pending.items.length === 0 || offset >= pending.total) break;
            }
            const existing = await ctx.wiring.ledger.get(proposalId);
            if (existing) {
              const decision = await ctx.wiring.ledger.decisionFor(proposalId);
              const terminalDecision = decision?.userDecision ?? existing.userDecision;
              if (terminalDecision !== null) {
                return {
                  id: proposalId,
                  status: "already_resolved" as const,
                  decision: terminalDecision,
                };
              }
            }
            throw cause;
          }
        })();
        outreachDraftsInFlight.set(idempotencyKey, operation);
        try {
          return await operation;
        } finally {
          if (outreachDraftsInFlight.get(idempotencyKey) === operation) {
            outreachDraftsInFlight.delete(idempotencyKey);
          }
        }
      }),

    /**
     * Pending proposals awaiting a human decision — backs the Approvals inbox
     * (frontend-migration-scoping.md Phase 2: `action.decide` existed with nothing
     * enumerating what's awaiting approval). Paginated per this repo's list-endpoint
     * convention (dealpilot.list/integration.list). TASK-010 review round-4 item 2:
     * a PRIVATE proposal (`inputs.visibility === "private"`, e.g. a red-flag
     * correction) is filtered out entirely unless it was raised `onBehalfOf`
     * the CALLER — team-visible semantics are completely unchanged for every
     * other (non-private) proposal. Since private-filtering can only be
     * applied after fetching, this loops through the underlying ledger's own
     * pages (the same accumulate-until-exhausted idiom already used by
     * `proposeOutreachDraft`'s idempotency search below) so `total`/`hasMore`
     * describe the CALLER'S actually-visible set, not a page that could
     * under-fill once private proposals exist.
     */
    listPending: authenticatedProcedure
      .input(
        z
          .object({
            organizationId: z.string().min(1),
            limit: z.number().int().min(1).max(200).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .default({ organizationId: PILOT_ORGANIZATION }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        // TASK-010 review round-4 item 2 + TASK-008 RM4: `privateOwnerUserId`
        // is enforced at the STORE level (`privateProposalOwnerScope` in
        // packages/db/src/ledger-store.ts / `ledgerEntryVisibleToPrivateOwner`
        // in packages/core/src/memory/stores.ts) — widened to cover BOTH
        // RM4's relation-resourceType rows AND TASK-010's own
        // `inputs.visibility === "private"` marker (red-flag correction
        // proposals), so a single query-level filter now protects every
        // private proposal shape without the app-side accumulate-and-filter
        // loop this endpoint previously needed.
        const { items, total } = await ctx.wiring.pipeline.listPending(input.organizationId, {
          limit: input.limit,
          offset: input.offset,
          privateOwnerUserId: ctx.identity.id,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    /** Bounded Execution Ledger history through the authenticated server seam.
     * Relation rows retain owner isolation after direct browser table access is revoked;
     * TASK-010 review round-5/6: also the replacement for `apps/web/src/app/data/ledger.ts`'s
     * `loadLedger()` direct-Supabase read (docs/BUGS.md 2026-07-17) — the SAME
     * `privateOwnerUserId` store-level filter protects red-flag correction proposals here too. */
    listHistory: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          limit: z.number().int().min(1).max(100).default(100),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(
          ctx.wiring.organizationStore,
          input.organizationId,
          ctx.identity.id,
        );
        const { items, total } = await ctx.wiring.ledger.listHistory(
          input.organizationId,
          {
            limit: input.limit,
            offset: input.offset,
            privateOwnerUserId: ctx.identity.id,
          },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    /** Read the append-only resolution state for idempotent review reconciliation.
     * TASK-010 review round-4 item 2 (closing a gap a fresh independent review
     * found): a PRIVATE proposal's resolution state/decision must be exactly as
     * invisible to a non-owner as `listPending`/`decide` already make it —
     * otherwise a member could infer a private red-flag correction's existence
     * and eventual approve/veto decision just by guessing/observing its
     * proposalId, even though they could never see or resolve it themselves. */
    resolution: authenticatedProcedure
      .input(z.object({ proposalId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const proposal = await ctx.wiring.ledger.get(input.proposalId);
        if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
        assertPilotOrganization(proposal.organizationId);
        await assertMembership(ctx.wiring.organizationStore, proposal.organizationId, ctx.identity.id);
        assertPrivateProposalOwner(proposal, ctx.identity, ctx.wiring.google);
        const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
        if (decision) {
          return { status: "resolved" as const, decision: decision.userDecision };
        }
        const rejected =
          typeof proposal.diff === "object" &&
          proposal.diff !== null &&
          !Array.isArray(proposal.diff) &&
          "rejected" in proposal.diff;
        if (proposal.refLedgerId !== undefined || proposal.userDecision !== null || rejected) {
          return { status: "terminal" as const, decision: proposal.userDecision };
        }
        return { status: "pending" as const, decision: null };
      }),

    taintTrace: authenticatedProcedure
      .input(z.object({ proposalId: databaseUuidSchema }))
      .query(async ({ input, ctx }) => {
        const proposal = await ctx.wiring.ledger.get(input.proposalId);
        if (!proposal) {
          throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
        }
        assertPilotOrganization(proposal.organizationId);
        await assertMembership(
          ctx.wiring.organizationStore,
          proposal.organizationId,
          ctx.identity.id,
        );
        assertPrivateProposalOwner(proposal, ctx.identity, ctx.wiring.google);
        const label =
          proposal.taintLabel ??
          labelFromLegacyTrustOrigin(
            proposal.trustOrigin,
            `ledger:${proposal.id}`,
          );
        const [sinkTraces, declassifications] = await Promise.all([
          ctx.wiring.taintAudit.listSinkTraces(
            proposal.organizationId,
            proposal.id,
          ),
          ctx.wiring.taintAudit.listDeclassifications(
            proposal.organizationId,
            label.provenanceHash,
          ),
        ]);
        return {
          label,
          sinkTraces,
          declassifications,
          influencedByUntrusted:
            label.trust === "untrusted" || label.trust === "unknown",
        };
      }),

    declassifyInstructionRisk: authenticatedProcedure
      .input(
        z.object({
          proposalId: z.string().uuid(),
          reason: z.string().trim().min(1).max(500),
          evidenceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (ctx.identity.type !== "user") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only an authenticated Human may declassify runtime data",
          });
        }
        const proposal = await ctx.wiring.ledger.get(input.proposalId);
        if (!proposal) {
          throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
        }
        assertPilotOrganization(proposal.organizationId);
        await assertMembership(
          ctx.wiring.organizationStore,
          proposal.organizationId,
          ctx.identity.id,
        );
        assertPrivateProposalOwner(proposal, ctx.identity, ctx.wiring.google);
        const accountableHumanId =
          proposal.onBehalfOfType === "user"
            ? proposal.onBehalfOfId
            : proposal.actorType === "user"
              ? proposal.actorId
              : null;
        if (accountableHumanId !== ctx.identity.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Only the accountable Human for this proposal may declassify it",
          });
        }
        const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
        if (
          !decision ||
          (decision.userDecision !== "approve" &&
            decision.userDecision !== "edit")
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Declassification requires an explicit approved Human Decision",
          });
        }
        const before =
          decision.taintLabel ??
          proposal.taintLabel ??
          labelFromLegacyTrustOrigin(
            decision.trustOrigin ?? proposal.trustOrigin,
            `ledger:${decision.id}`,
          );
        const after = deriveDeclassifiedLabel(before, {
          instructionRisk: "data",
        });
        let record;
        try {
          record = declassifyTaintLabel({
            id: ctx.run.ids.next(),
            organizationId: proposal.organizationId,
            before,
            after,
            reason: input.reason,
            evidenceHash: input.evidenceHash,
            actor: {
              type: "user",
              id: ctx.identity.id,
              decisionLedgerId: decision.id,
            },
            createdAt: ctx.run.clock.nowISO(),
            plane: proposal.dataScope === "public" ? "cloud" : "local",
          });
        } catch (cause) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          });
        }
        await ctx.wiring.taintAudit.appendDeclassification(record);
        return record;
      }),

    /** Resolve a pending proposal: approve | veto | edit. TASK-010 review
     * round-4 item 2: a PRIVATE proposal may only be decided by the user it
     * was raised `onBehalfOf` — a non-owning member (even though they pass
     * the ordinary organization-membership gate) is rejected FORBIDDEN, never
     * merely filtered from a list. */
    decide: authenticatedProcedure.input(decideInput).mutation(async ({ input, ctx }) => {
      // Decider is the SERVER-RESOLVED identity (ctx.identity), never the client's
      // claimed actor — the agent-floor in decide() blocks any agent from approving.
      const original = await ctx.wiring.ledger.get(input.proposalId);
      if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
      assertPilotOrganization(original.organizationId);
      await assertMembership(ctx.wiring.organizationStore, original.organizationId, ctx.identity.id);
      // TASK-011 remediation (2026-07-19 coordinator distributed-defects
      // RE-review round 2, issue 6) — fail-closed backstop BEFORE any
      // decision is resolved: a proposal shaped like a culture-research/
      // synthesis output must carry a valid durable binding.
      await assertCultureProposalBindingValid(ctx.wiring, original);
      // TASK-010: same non-relation-scoped private-proposal guard as
      // `resolution` above — a red-flag correction proposal may only be
      // decided by the user it was raised `onBehalfOf`, even though it
      // passes the ordinary organization-membership gate.
      if (
        original.resourceType !== "relation" &&
        isPrivateProposalInputs(original.inputs) &&
        original.onBehalfOfId !== ctx.identity.id
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This proposal is private to its own owner",
        });
      }
      assertPrivateProposalOwner(original, ctx.identity, ctx.wiring.google);
      const claimsChatTaskProposal = entryClaimsChatTaskProposal(original);
      if (
        claimsChatTaskProposal &&
        (!input.chatThreadId || !input.chatTurnId)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Chat Task decisions require their Chat thread and turn ids",
        });
      }
      const chatTaskInput = claimsChatTaskProposal
        ? await requireChatTaskProposalBinding(
            ctx.wiring,
            original,
            ctx.identity.id,
          )
        : null;
      if (input.chatThreadId && input.chatTurnId) {
        if (
          !chatTaskInput ||
          chatTaskInput.chatThreadId !== input.chatThreadId ||
          chatTaskInput.chatTurnId !== input.chatTurnId
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The Chat lifecycle reference does not match this proposal",
          });
        }
        const chatScope = chatOwnerScope(original.organizationId, ctx.identity.id);
        const refs = await ctx.wiring.chatStore.listTurnRefs(
          chatScope,
          input.chatThreadId,
          input.chatTurnId,
        );
        if (!refs.some((ref) => ref.kind === "proposal" && ref.refId === original.id)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The Chat turn is not linked to this proposal",
          });
        }
      }
      const isSignalEvidenceProposal =
        original.resourceType === "relation" &&
        isRelationshipSignalEvidence(original.inputs);
      const isRecordMutationProposal = isRelationshipMutation(original.inputs);
      const isGoogleInteractionIntakeProposal =
        original.dataScope === "private" &&
        isGoogleLinkedInteractionIntake(original.inputs);
      const isCaptureIntakeProposal = isCaptureProposal(original);
      const isRelationshipProposal =
        isSignalEvidenceProposal ||
        isRecordMutationProposal ||
        isGoogleInteractionIntakeProposal;
      const isRetryablePostDecisionProposal =
        isRelationshipProposal || isCaptureIntakeProposal || chatTaskInput !== null;
      let resolved: Proposal | null = null;
      let postDecisionPipelineError: unknown;
      let relationshipDecision: LedgerEntry | null = null;
      let ownerInitiatedRelationshipRetry = false;
      let recordedDecision = input.decision;
      if (isRetryablePostDecisionProposal) {
        const existingDecision = await ctx.wiring.ledger.decisionFor(
          input.proposalId,
        );
        if (existingDecision) {
          if (
            existingDecision.userDecision !== "approve" &&
            existingDecision.userDecision !== "edit"
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `proposal ${input.proposalId} is already resolved`,
            });
          }
          resolved = proposalFromResolvedRelationshipLedger(
            original,
            existingDecision,
          );
          relationshipDecision = existingDecision;
          recordedDecision = existingDecision.userDecision;
          ownerInitiatedRelationshipRetry = true;
        }
      }
      let committedEditedOutput = input.editedOutput;
      if (input.decision === "edit") {
        const originalInputs =
          typeof original.inputs === "object" &&
          original.inputs !== null &&
          !Array.isArray(original.inputs)
            ? (original.inputs as Record<string, unknown>)
            : null;
        if (originalInputs?.kind === "learning_recommendation") {
          if (
            typeof committedEditedOutput !== "object" ||
            committedEditedOutput === null ||
            Array.isArray(committedEditedOutput) ||
            (committedEditedOutput as Record<string, unknown>).kind !==
              "learning_recommendation"
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "edited Learning output must remain a learning recommendation object",
            });
          }
          const canonical = {
            ...(committedEditedOutput as Record<string, unknown>),
          };
          if (originalInputs.commonsInvocation === undefined) {
            delete canonical.commonsInvocation;
          } else {
            canonical.commonsInvocation = originalInputs.commonsInvocation;
          }
          committedEditedOutput = canonical;
        }
        if (chatTaskInput) {
          const editedTask = chatCreateTaskOutputSchema.safeParse(committedEditedOutput);
          if (!editedTask.success || editedTask.data.taskId !== chatTaskInput.taskId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "edited Chat Task output must satisfy the Task contract and cannot retarget the Task",
            });
          }
          committedEditedOutput = editedTask.data;
        }
      }
      if (
        !resolved &&
        input.decision === "edit" &&
        isSignalEvidenceProposal
      ) {
        try {
          const originalPayload =
            relationshipSignalEvidencePayloadSchema.safeParse(original.inputs);
          const editedPayload =
            relationshipSignalEvidencePayloadSchema.safeParse(input.editedOutput);
          if (!originalPayload.success || !editedPayload.success) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "edited Relationship output must satisfy the Signal evidence Relation contract",
            });
          }
          if (
            editedPayload.data.signalId !== originalPayload.data.signalId ||
            editedPayload.data.sourceEventId !== originalPayload.data.sourceEventId
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "a Relationship review edit cannot retarget the Signal or source Event",
            });
          }
          committedEditedOutput = editedPayload.data;
          const ownerUserId = relationshipOwnerFromLedger(original);
          if (!ownerUserId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "edited Relationship output requires a user-owned proposal",
            });
          }
          const detail = await ctx.wiring.graphStore.getSignalEvidenceAnchor(
            original.organizationId,
            ownerUserId,
            editedPayload.data.signalId,
            editedPayload.data.sourceEventId,
          );
          if (
            !detail?.sourceEvent ||
            detail.sourceEvent.id !== editedPayload.data.sourceEventId ||
            !editedPayload.data.participants.some(
              (participant) =>
                participant.recordType === detail.signal.subjectType &&
                participant.recordId === detail.signal.subjectId,
            )
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "edited Relationship output must retain its accessible Signal subject and source Event",
            });
          }
          const editedParticipantsAccessible =
            await ctx.wiring.graphStore.areRelationshipRecordsAccessible(
              original.organizationId,
              ownerUserId,
              editedPayload.data.participants,
            );
          if (!editedParticipantsAccessible) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "edited Relationship output contains an inaccessible participant",
            });
          }
        } catch (validationCause) {
          const racedDecision = await ctx.wiring.ledger.decisionFor(
            input.proposalId,
          );
          if (
            racedDecision?.userDecision === "approve" ||
            racedDecision?.userDecision === "edit"
          ) {
            resolved = proposalFromResolvedRelationshipLedger(
              original,
              racedDecision,
            );
            relationshipDecision = racedDecision;
            recordedDecision = racedDecision.userDecision;
            ownerInitiatedRelationshipRetry = true;
          } else if (racedDecision) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `proposal ${input.proposalId} is already resolved`,
            });
          } else {
            throw validationCause;
          }
        }
      }
      if (
        !resolved &&
        input.decision === "edit" &&
        isRecordMutationProposal
      ) {
        try {
          committedEditedOutput = validateRelationshipMutationEdit(
            original.inputs,
            input.editedOutput,
          );
        } catch (cause) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: cause instanceof Error
              ? cause.message
              : "Edited Relationship output is invalid",
          });
        }
      }
      if (
        !resolved &&
        input.decision === "edit" &&
        isGoogleInteractionIntakeProposal
      ) {
        try {
          committedEditedOutput = validateGoogleInteractionEdit(
            original.inputs,
            input.editedOutput,
          );
          const edited = parseGoogleLinkedInteractionIntake(
            committedEditedOutput,
          );
          const participant = await ctx.wiring.graphStore.getPerson(
            original.organizationId,
            ctx.identity.id,
            edited.event.personId,
          );
          if (
            !participant &&
            edited.person?.localPersonId !== edited.event.personId
          ) {
            throw new Error(
              "Google intake review requires an accessible Person participant",
            );
          }
        } catch (cause) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              cause instanceof Error
                ? cause.message
                : "Edited Google intake output is invalid",
          });
        }
      }
      if (
        !resolved &&
        input.decision === "edit" &&
        isCaptureIntakeProposal
      ) {
        try {
          const edited = captureProposalOutputSchema.parse(input.editedOutput);
          const originalCapture = captureProposalInputSchema.parse(original.inputs);
          if (edited.local_media_id !== originalCapture.local_media_id) {
            throw new Error("Capture review cannot retarget Local Media");
          }
          committedEditedOutput = edited;
        } catch (cause) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              cause instanceof Error
                ? cause.message
                : "Edited capture output is invalid",
          });
        }
      }
      if (!resolved) {
        await validateDealPilotDecision(
          ctx.wiring,
          input.proposalId,
          input.decision,
          committedEditedOutput,
        );
        try {
          resolved = await ctx.wiring.pipeline.decide(
            input.proposalId,
            input.decision,
            ctx.identity,
            ctx.run,
            committedEditedOutput,
            input.reason,
          );
        } catch (err) {
          if (err instanceof AlreadyResolvedError) {
            const persistedDecision =
              isRetryablePostDecisionProposal
                ? await ctx.wiring.ledger.decisionFor(input.proposalId)
                : null;
            if (
              persistedDecision?.userDecision !== "approve" &&
              persistedDecision?.userDecision !== "edit"
            ) {
              throw new TRPCError({ code: "CONFLICT", message: err.message });
            }
            resolved = proposalFromResolvedRelationshipLedger(
              original,
              persistedDecision,
            );
            relationshipDecision = persistedDecision;
            recordedDecision = persistedDecision.userDecision;
            ownerInitiatedRelationshipRetry = true;
          } else {
            if (err instanceof NotPendingProposalError) {
              throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
            }
            if (err instanceof AgentFloorDeniedError) {
              throw new TRPCError({ code: "FORBIDDEN", message: err.message });
            }
            const persistedDecision =
              isRetryablePostDecisionProposal
                ? await ctx.wiring.ledger.decisionFor(input.proposalId)
                : null;
            if (
              persistedDecision?.userDecision !== "approve" &&
              persistedDecision?.userDecision !== "edit"
            ) {
              throw err;
            }
            resolved = proposalFromResolvedRelationshipLedger(
              original,
              persistedDecision,
            );
            relationshipDecision = persistedDecision;
            recordedDecision = persistedDecision.userDecision;
            postDecisionPipelineError = err;
            ownerInitiatedRelationshipRetry = true;
          }
        }
      }
      if (!resolved) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Action decision did not resolve",
        });
      }
      // Post-approval Google side effects (no-op for unrelated proposals):
      // materialize an intake proposal to the LOCAL graph, or execute an approved
      // external:send through the gate. Runs ONLY after the governed decision.
      let relationshipEffect: Awaited<
        ReturnType<typeof applyApprovedRelationshipMaterialization>
      > | null = null;
      let persistedRelationshipDecision: LedgerEntry | null = null;
      let relationshipApplicationReturned = false;
      let relationshipRecordMaterialization: unknown = null;
      try {
        const relationshipDecisionCandidate =
          isRelationshipProposal
            ? relationshipDecision ??
              await ctx.wiring.ledger.decisionFor(input.proposalId)
            : null;
        if (
          relationshipDecisionCandidate?.userDecision === "approve" ||
          relationshipDecisionCandidate?.userDecision === "edit" ||
          relationshipDecisionCandidate?.userDecision === "veto"
        ) {
          recordedDecision = relationshipDecisionCandidate.userDecision;
        }
        persistedRelationshipDecision =
          relationshipDecisionCandidate?.userDecision === "approve" ||
          relationshipDecisionCandidate?.userDecision === "edit"
            ? relationshipDecisionCandidate
            : null;
        const moduleInstallationId = moduleInstallIdFromProposal(original);
        const moduleInstallation =
          moduleInstallationId && input.decision !== "veto"
            ? await activateApprovedModuleInstallation(
                ctx.wiring,
                original.organizationId,
                moduleInstallationId,
              )
            : undefined;
        relationshipEffect =
          persistedRelationshipDecision && isRelationshipProposal
            ? await applyApprovedRelationshipMaterialization(
                ctx.wiring.graphStore,
                ctx.wiring.relationMaterializations,
                original,
                persistedRelationshipDecision,
                new Date(ctx.run.clock.nowISO()),
                {
                  allowExhausted: ownerInitiatedRelationshipRetry,
                },
                ctx.wiring.memoryStore,
              )
            : null;
        relationshipRecordMaterialization =
          persistedRelationshipDecision && isRecordMutationProposal
            ? relationshipEffect?.materialization ?? null
            : null;
        relationshipApplicationReturned =
          persistedRelationshipDecision !== null && isRelationshipProposal;
        const captureDecisionCandidate =
          isCaptureIntakeProposal
            ? relationshipDecision ??
              await ctx.wiring.ledger.decisionFor(input.proposalId)
            : null;
        if (
          captureDecisionCandidate?.userDecision === "approve" ||
          captureDecisionCandidate?.userDecision === "edit"
        ) {
          recordedDecision = captureDecisionCandidate.userDecision;
          await materializeApprovedCapture(
            ctx.wiring,
            original,
            resolved,
            ctx.run,
          );
        } else if (captureDecisionCandidate?.userDecision === "veto") {
          recordedDecision = "veto";
          await recordRejectedCapture(
            ctx.wiring,
            original,
            captureDecisionCandidate,
          );
        }
        const persistedChatDecision = chatTaskInput
          ? await ctx.wiring.ledger.decisionFor(input.proposalId)
          : null;
        const chatDecision =
          persistedChatDecision?.userDecision === "approve" ||
          persistedChatDecision?.userDecision === "edit" ||
          persistedChatDecision?.userDecision === "veto"
            ? persistedChatDecision.userDecision
            : null;
        const chatTaskResult = chatDecision && chatTaskInput
          ? await finishChatTaskDecision(
              ctx.wiring,
              original,
              chatTaskInput,
              persistedChatDecision?.proposedOutput,
              chatDecision,
              ctx.identity.id,
              ctx.run,
            )
          : null;
        if (chatTaskInput && chatTaskResult) {
          const scope = chatOwnerScope(original.organizationId, ctx.identity.id);
          await recordChatTaskResult(
            ctx.wiring,
            scope,
            chatTaskInput,
            chatTaskResult.runId,
          );
        }
        const effects = await ctx.wiring.google.onApproved(input.proposalId, resolved, ctx.run);
        if (effects.materialized) await emitGoogleCaptureSignals(ctx.wiring, resolved);
        const dealPilotEffects =
          resolved.status === "applied"
            ? await materializeDealPilotApproval(ctx.wiring, resolved)
            : [];
        if (postDecisionPipelineError) throw postDecisionPipelineError;
        if (
          relationshipEffect &&
          relationshipEffect.effect.status !== "applied"
        ) {
          const effectsError =
            relationshipEffect.effect.lastError ??
            "Relationship application is already in progress";
          return {
            ...resolved,
            recordedDecision,
            effects,
            dealPilotEffects,
            ...(chatTaskResult ? { chatTaskResult } : {}),
            effectsStatus: "failed" as const,
            effectsError,
            effectsAuditId: undefined,
            ...(moduleInstallation ? { moduleInstallation } : {}),
            relationshipMaterialization: {
              status: relationshipEffect.effect.status,
              error: effectsError,
              reconcileable: true,
              attempts: relationshipEffect.effect.attemptCount,
              maxAttempts: relationshipEffect.effect.maxAttempts,
              leaseRecoveries:
                relationshipEffect.effect.leaseRecoveryCount,
              maxLeaseRecoveries:
                relationshipEffect.effect.maxLeaseRecoveries,
              nextRetryAt:
                relationshipEffect.effect.nextRetryAt?.toISOString() ?? null,
              leaseExpiresAt:
                relationshipEffect.effect.leaseExpiresAt?.toISOString() ??
                null,
            },
          };
        }
        return {
          ...resolved,
          recordedDecision,
          effects,
          dealPilotEffects,
          ...(chatTaskResult ? { chatTaskResult } : {}),
          effectsStatus: "confirmed" as const,
          ...(moduleInstallation ? { moduleInstallation } : {}),
          ...(relationshipEffect?.effect.status === "applied"
            ? {
                relationshipMaterialization: {
                 status: "confirmed" as const,
                 relationCount: relationshipEffect.effect.relationCount ?? 0,
                },
              }
            : {}),
          ...(relationshipRecordMaterialization !== null
            ? { relationshipRecordMaterialization }
            : {}),
        };
      } catch (cause) {
        const causeMessage = cause instanceof Error ? cause.message : String(cause);
        const pipelineMessage =
          postDecisionPipelineError instanceof Error
            ? postDecisionPipelineError.message
            : postDecisionPipelineError
              ? String(postDecisionPipelineError)
              : null;
        const effectsError =
          pipelineMessage && cause !== postDecisionPipelineError
            ? `Post-decision pipeline failed: ${pipelineMessage}; subsequent approved effect failed: ${causeMessage}`
            : causeMessage;
        const relationshipOwnerUserId = relationshipOwnerFromLedger(original);
        const persistedRelationshipEffect =
          relationshipOwnerUserId &&
          isRelationshipProposal
            ? await ctx.wiring.relationMaterializations.getByProposal(
              original.organizationId,
              relationshipOwnerUserId,
              original.id,
            )
            : null;
        if (
          persistedRelationshipEffect?.status === "applied" &&
          !relationshipApplicationReturned &&
          !postDecisionPipelineError
        ) {
          return {
            ...resolved,
            recordedDecision,
            effects: { materialized: false, sent: false },
            dealPilotEffects: [],
            effectsStatus: "confirmed" as const,
            relationshipMaterialization: {
              status: "confirmed" as const,
              relationCount: persistedRelationshipEffect.relationCount ?? 0,
            },
          };
        }
        let effectsAuditId: string | undefined;
        try {
          const auditId = ctx.run.ids.next();
          await ctx.wiring.ledger.append({
            id: auditId,
            organizationId: resolved.request.organizationId,
            actorType: resolved.request.actor.type,
            actorId: resolved.request.actor.id,
            action: resolved.request.action,
            resourceType: resolved.request.resourceType,
            ...(resolved.request.resourceId ? { resourceId: resolved.request.resourceId } : {}),
            inputs: {
              originalProposalId: input.proposalId,
              display: {
                actor: `${resolved.request.actor.type} · ${resolved.request.actor.id}`,
                resource: `${resolved.request.resourceType}${resolved.request.resourceId ? ` · ${resolved.request.resourceId}` : ""}`,
                policy: "Post-decision effect failed",
              },
            },
            proposedOutput: {
              text: `Approved effect failed: ${effectsError}`,
              executed: false,
              error: effectsError,
            },
            userDecision: "auto",
            policyResults: [],
            diff: { executionFailed: effectsError },
            createdAt: ctx.run.clock.nowISO(),
          });
          effectsAuditId = auditId;
        } catch (auditCause) {
          // An irreversible decision plus a failed effect must stay visible even when
          // the failure-audit append also fails.
          console.error("action.decide: failed to append post-decision effect audit", auditCause);
        }
        return {
          ...resolved,
          recordedDecision,
          effects: { materialized: false, sent: false },
          dealPilotEffects: [],
          effectsStatus: "failed" as const,
          effectsError,
          ...(effectsAuditId ? { effectsAuditId } : {}),
          ...(persistedRelationshipEffect?.status === "applied"
            ? {
                relationshipMaterialization: {
                  status: "confirmed" as const,
                  relationCount: persistedRelationshipEffect.relationCount ?? 0,
                },
              }
            : isRelationshipProposal &&
                persistedRelationshipDecision !== null
              ? {
                  relationshipMaterialization: {
                    status:
                      persistedRelationshipEffect?.status === "pending"
                        ? "pending" as const
                        : "failed" as const,
                    error:
                      persistedRelationshipEffect?.lastError ?? effectsError,
                    reconcileable: true,
                    attempts: persistedRelationshipEffect?.attemptCount ?? 0,
                    maxAttempts: persistedRelationshipEffect?.maxAttempts ?? 5,
                    leaseRecoveries:
                      persistedRelationshipEffect?.leaseRecoveryCount ?? 0,
                    maxLeaseRecoveries:
                      persistedRelationshipEffect?.maxLeaseRecoveries ?? 3,
                    nextRetryAt:
                      persistedRelationshipEffect?.nextRetryAt?.toISOString() ??
                      null,
                    leaseExpiresAt:
                      persistedRelationshipEffect?.leaseExpiresAt?.toISOString() ??
                      null,
                  },
                }
              : {}),
        };
      }
    }),

    /** D8 — durable idempotent retry for a post-decision effect that
     * `action.decide` reported `effectsStatus: "failed"` for, when the
     * proposal is NOT a Relationship approval (`relationship.reconcileApproved`)
     * or a Module install approval (`packages.reconcileApproved`) — see
     * `reconcileApprovedExternalEffect` above for the full rationale. Never
     * creates a second review decision; the human approval is immutable. */
    reconcileApproved: authenticatedProcedure
      .input(z.object({ proposalId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const original = await ctx.wiring.ledger.get(input.proposalId);
        if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
        assertPilotOrganization(original.organizationId);
        await assertMembership(ctx.wiring.organizationStore, original.organizationId, ctx.identity.id);
        return reconcileApprovedExternalEffect(ctx, input.proposalId);
      }),
  }),

  /** Gmail + Google Calendar integration — connect, sync (read), send (write). */
  /** Gmail + Google Calendar — connect, sync (read), draft (write). Distinct from the
   * generic `integration` router below (social providers + governed scopes).
   *
   * Single-tenant note (All fixes.md Phase 3 item 11a): these procedures take NO
   * `organizationId` param at all — they are organization-IMPLICIT, always resolving
   * through `ctx.wiring.google`, which is itself pinned to `PILOT_ORGANIZATION` inside
   * `buildWiring()`. We deliberately did NOT add an optional `organizationId` param here
   * (unlike `dealpilot.list`): no frontend caller (`Design Bridge AI Interface
   * (Copy)/src/app/data/api.ts`) ever attempts to pass a organization context to any
   * `google.*` call, so there is no existing behavior that silently ignores a
   * client-supplied organization id to fix — these procedures never claimed
   * multi-tenancy in the first place. Adding an unused, always-optional param would
   * only add surface area without closing a real gap; if a caller ever needs
   * multi-organization Google integration, that's the same Phase 5 multi-tenancy work
   * the rest of this fix explicitly defers, not a one-off param here. */
  /**
   * AGS1 (TASK-007 closure) — raw human capture (camera tool), migrated off a
   * client-constructed `action.propose` call (which previously sent a raw
   * `actor:{type:"user"}` for `skill:"stageCapture"`) onto a dedicated
   * procedure: the SERVER, never the client, decides the invoking Agent
   * (LEARNING_AGENT — "observes authorized evidence") and provisions the
   * Goal/Task `stageCapture`'s manifest requires (see wiring.ts's
   * STAGE_CAPTURE_SKILL_MANIFEST).
   */
  capture: t.router({
    stage: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          localMediaId: z.string().trim().min(1).max(500),
          kind: z.enum(["photo", "video"]).optional(),
          caption: z.string().trim().max(4_000).optional(),
          ocrText: z.string().max(20_000).optional(),
          capturedAt: z.string().datetime({ offset: true }),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return withCaptureStageLock(
          `${input.organizationId}:${ctx.identity.id}:${input.localMediaId}`,
          async () => {
            const receivedAt = ctx.run.clock.nowISO();
            const existingEnvelope = await getCaptureReviewEnvelope(
              ctx.wiring,
              input.organizationId,
              input.localMediaId,
            );
            if (
              existingEnvelope &&
              existingEnvelope.ownerUserId !== ctx.identity.id
            ) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Local Media not found",
              });
            }
            if (existingEnvelope?.status === "applied") {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Local Media was already materialized",
              });
            }

            let pending = await findPendingCaptureProposal(
              ctx.wiring,
              input.organizationId,
              ctx.identity.id,
              input.localMediaId,
            );
            if (
              !pending &&
              existingEnvelope?.status === "pending_review" &&
              existingEnvelope.proposalId
            ) {
              const candidate = await ctx.wiring.ledger.get(
                existingEnvelope.proposalId,
              );
              if (candidate) {
                const decision = await ctx.wiring.ledger.decisionFor(candidate.id);
                if (decision) {
                  throw new TRPCError({
                    code: "CONFLICT",
                    message:
                      "The recorded capture decision still requires effect reconciliation",
                  });
                }
                pending = candidate;
              }
            }
            if (pending) {
              await putCaptureReviewEnvelope(ctx.wiring, input.organizationId, {
                kind: "capture_review_envelope",
                localMediaId: input.localMediaId,
                ownerUserId: ctx.identity.id,
                capturedAt: existingEnvelope?.capturedAt ?? input.capturedAt,
                receivedAt: existingEnvelope?.receivedAt ?? receivedAt,
                status: "pending_review",
                proposalId: pending.id,
              });
              return pendingProposalFromLedger(pending);
            }

            const stagingEnvelope = {
              kind: "capture_review_envelope" as const,
              localMediaId: input.localMediaId,
              ownerUserId: ctx.identity.id,
              capturedAt: input.capturedAt,
              receivedAt,
              status: "staging" as const,
            };
            await putCaptureReviewEnvelope(
              ctx.wiring,
              input.organizationId,
              stagingEnvelope,
            );
            const goalTaskRef = await provisionCaptureTask(
              ctx.wiring,
              input.organizationId,
            );
            const proposal = await ctx.wiring.pipeline.propose(
              {
                organizationId: input.organizationId,
                actor: { type: "agent", id: LEARNING_AGENT, plane: "local" },
                onBehalfOf: { type: "user", id: ctx.identity.id },
                action: "write",
                resourceType: "event",
                dataScope: "private" as DataScope,
                skill: "stageCapture",
                seed: `capture:${input.organizationId}:${input.localMediaId}`,
                inputs: {
                  local_media_id: input.localMediaId,
                  ...(input.kind ? { kind: input.kind } : {}),
                  ...(input.caption ? { caption: input.caption } : {}),
                  ...(input.ocrText ? { ocrText: input.ocrText } : {}),
                },
                goalTaskRef,
              },
              ctx.run,
            );
            if (proposal.status === "applied") {
              throw new Error(
                "Capture staging bypassed its required review policy",
              );
            }
            await putCaptureReviewEnvelope(ctx.wiring, input.organizationId, {
              ...stagingEnvelope,
              status:
                proposal.status === "pending_review"
                  ? "pending_review"
                  : "rejected",
              proposalId: proposal.id,
            });
            return proposal;
          },
        );
      }),
    status: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().min(1),
        localMediaIds: z.array(z.string().trim().min(1).max(500)).max(100),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(
          ctx.wiring.organizationStore,
          input.organizationId,
          ctx.identity.id,
        );
        const items = await Promise.all(
          input.localMediaIds.map(async (localMediaId) => {
            const envelope = await getCaptureReviewEnvelope(
              ctx.wiring,
              input.organizationId,
              localMediaId,
            );
            if (!envelope || envelope.ownerUserId !== ctx.identity.id) {
              return { localMediaId, status: "not_found" as const };
            }
            return {
              localMediaId,
              status: envelope.status,
              proposalId: envelope.proposalId ?? null,
              decisionLedgerId: envelope.decisionLedgerId ?? null,
            };
          }),
        );
        return { items };
      }),
  }),

  /**
   * WhatsApp Module — staging a Contact Extractor run.
   *
   * Residency: the raw payload and every phone number stay on the LOCAL plane.
   * A WhatsApp address book is a firehose import, so it lands as a local list —
   * a roster — and deliberately creates NO graph entities. Nothing here writes
   * to cloud canonical; promoting an identity is a separate, explicit act.
   */
  whatsapp: t.router({
    stageExtraction: authenticatedProcedure
      .input(
        z.object({
          runId: z.string().min(1).max(128),
          capturedAt: z.string().min(1),
          listName: z.string().min(1).max(120).default("WhatsApp"),
          contacts: z
            .array(
              z.object({
                id: z.string().min(1),
                name: z.string().optional(),
                pushname: z.string().optional(),
                phone: z.string().optional(),
                isMyContact: z.boolean(),
                isGroup: z.boolean(),
              }),
            )
            .max(50_000),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        // Single-tenant by construction, exactly like every other Module
        // surface here (see the PILOT_ORGANIZATION note above).
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const localPlane = ctx.wiring.localPlane;

        // 1. Raw capture → LOCAL body store. Never the cloud plane.
        await localPlane.bodies.put({
          organizationId,
          source: "whatsapp",
          sourceRecordId: `capture:${input.runId}`,
          // Structurally private: these bodies cannot egress.
          dataScope: "private",
          content: { capturedAt: input.capturedAt, contacts: input.contacts },
          capturedAt: input.capturedAt,
        });

        // 2. Map, matching against people this source has seen before.
        const existingRows: { personId: string; dedupeKey: string }[] = [];
        for (const person of await localPlane.graph.listPeople(organizationId)) {
          if (person.dedupeKey) {
            existingRows.push({ personId: person.id, dedupeKey: person.dedupeKey });
          }
        }
        const contacts = input.contacts.map((contact) => ({
          id: contact.id,
          isMyContact: contact.isMyContact,
          isGroup: contact.isGroup,
          ...(contact.name !== undefined ? { name: contact.name } : {}),
          ...(contact.pushname !== undefined ? { pushname: contact.pushname } : {}),
          ...(contact.phone !== undefined ? { phone: contact.phone } : {}),
        }));
        const result = mapWhatsAppExtraction(
          { kind: "contacts", runId: input.runId, capturedAt: input.capturedAt, contacts },
          whatsAppPersonIndexFrom(existingRows),
        );

        // 3. Commit the roster locally. Ambiguous matches produced no proposal
        //    at all — they are Signals for a human, not rows to guess at.
        const list = await localPlane.graph.ensurePersonList({
          id: uuidv7(),
          organizationId,
          name: input.listName,
          source: "whatsapp",
          createdAt: new Date().toISOString(),
        });

        const memberIds: string[] = [];
        for (const proposal of result.people) {
          const personId = proposal.matchedPersonId ?? uuidv7();
          await localPlane.graph.upsertPerson({
            id: personId,
            organizationId,
            ...(proposal.displayName ? { fullName: proposal.displayName } : {}),
            emails: [],
            // Absent for every LID identity — a hidden number is never invented.
            ...(proposal.phoneE164 ? { phones: [proposal.phoneE164] } : {}),
            dedupeKey: proposal.dedupeKey,
          });
          memberIds.push(personId);
        }
        await localPlane.graph.addPeopleToList(list.id, memberIds);

        // 4. File the ambiguous ones as Signals for a human to resolve.
        //
        //    These were previously computed and thrown away, which made the
        //    "never auto-merge" rule invisible: the run refused to guess, said
        //    so in a counter, and left no way to act on it. A Signal is the
        //    reviewable artefact that refusal is supposed to produce.
        //
        //    The id is deterministic on the identity key, so re-running an
        //    extraction over the same address book re-commits the same rows
        //    (`commitEntity` is a no-op on conflict) instead of minting a fresh
        //    Signal per run. `personId` is deliberately left unset — the whole
        //    point of this Signal is that nobody knows which Person it is.
        for (const signal of result.signals) {
          await localPlane.graph.commitEntity({
            id: whatsAppDuplicateSignalId(signal.dedupeKey),
            organizationId,
            kind: "signal",
            payload: whatsAppPossibleDuplicatePayload(
              signal,
              whatsAppIdentityKindOfDedupeKey(signal.dedupeKey),
            ),
            source: WHATSAPP_SOURCE,
            sourceRecordId: `possible_duplicate:${signal.dedupeKey}`,
            createdAt: new Date().toISOString(),
          });
        }

        // Bridge did something; the audit log records it. Counts only —
        // no name, no number, no body ever enters an audit row.
        await recordWhatsAppAudit(localPlane, organizationId, {
          id: uuidv7(),
          kind: "extraction_run",
          at: new Date().toISOString(),
          detail: {
            runId: input.runId,
            listName: list.name,
            staged: result.people.length,
            ambiguous: result.signals.length,
          },
        });

        return {
          runId: input.runId,
          listId: list.id,
          listName: list.name,
          staged: {
            people: result.people.length,
            withPhone: result.people.filter((person) => person.phoneE164).length,
            numberHidden: result.people.filter((person) => !person.phoneE164).length,
            ambiguous: result.signals.length,
            skipped: contacts.length - result.people.length - result.signals.length,
          },
        };
      }),

    // ── Message capture (TASK-030, ADR-158 under AP-091) ────────────────────
    //
    // RESIDENCY, stated once and applying to every procedure below: a WhatsApp
    // message body is another person's private content. It is written to the
    // LOCAL plane and to nowhere else. There is no dual-write, no promote path,
    // and no cloud canonical destination for any of it — unlike an identity
    // fact, which `stageExtraction` above may surface outward. The sync cursor
    // lives in the local state store beside it.

    /**
     * Store one chat's newly-read messages and advance its cursor.
     *
     * Idempotent by construction: the store's upsert is keyed on
     * (source, messageId), and `newMessagesSince` re-applies the watermark
     * here so an inclusive read op cannot re-write what is already stored.
     *
     * The cursor moves only AFTER the write succeeds. A failed write therefore
     * leaves the watermark where it was and the next run re-reads the same
     * window, which costs a round trip and loses nothing — the opposite order
     * would skip those messages permanently.
     */
    ingestMessages: authenticatedProcedure
      .input(
        z.object({
          chatId: z.string().min(1).max(128),
          /** Display label only. Never an identifier. */
          chatName: z.string().max(300).optional(),
          isGroup: z.boolean().optional(),
          capturedAt: z.string().min(1),
          /** The watermark this read was made against, in epoch seconds. */
          since: z.number().int().min(0).default(0),
          messages: z
            .array(
              z.object({
                id: z.string().min(1),
                chatId: z.string().min(1),
                fromMe: z.boolean(),
                timestamp: z.number(),
                author: z.string().optional(),
                from: z.string().optional(),
                body: z.string().optional(),
                type: z.string().optional(),
                ack: z.number().optional(),
                mimetype: z.string().optional(),
                filename: z.string().optional(),
                size: z.number().optional(),
              }),
            )
            .max(1_000),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const localPlane = ctx.wiring.localPlane;

        // Mapping decides identity. `senderOf` never turns a Linked ID into a
        // phone number, and the store's `assertMessageShape` re-checks the same
        // rule at its own boundary — two independent guards on the path that
        // once fabricated 4,203 phone numbers.
        const mapped = mapWhatsAppMessages(input.messages as RawWhatsAppMessage[]);
        const fresh = newWhatsAppMessagesSince(mapped.messages, input.since);

        await localPlane.graph.putMessages(
          fresh.map((message) => ({
            organizationId,
            source: WHATSAPP_SOURCE,
            messageId: message.messageId,
            chatId: message.chatId,
            ...(message.senderKey !== undefined ? { senderKey: message.senderKey } : {}),
            senderKind: message.senderKind,
            direction: message.direction,
            sentAt: message.sentAt,
            body: message.body,
            ...(message.attachment ? { attachment: message.attachment } : {}),
            ack: message.ack,
            capturedAt: input.capturedAt,
          })),
        );

        const cursor = await localPlane.state.update(
          organizationId,
          WHATSAPP_SYNC_NAMESPACE,
          readWhatsAppSyncState(null),
          (current) => {
            const next = advanceWhatsAppCursor(
              readWhatsAppSyncState(current),
              input.chatId,
              fresh,
              input.capturedAt,
              {
                ...(input.chatName !== undefined ? { name: input.chatName } : {}),
                ...(input.isGroup !== undefined ? { isGroup: input.isGroup } : {}),
              },
            );
            return { state: next, result: next.chats[input.chatId] ?? null };
          },
        );

        // One row per sync pass that actually stored something. A pass that
        // found nothing new is not recorded: it is the common case, and logging
        // it would bury the passes that mattered under polling noise.
        // `skipped` is per-reason; the audit row carries the total plus each
        // non-zero reason, so "the sync keeps refusing things" stays diagnosable
        // without the row growing a column per reason that never occurs.
        const refusedByReason = Object.entries(mapped.skipped).filter(([, count]) => count > 0);
        const refusedTotal = refusedByReason.reduce((sum, [, count]) => sum + count, 0);
        if (fresh.length > 0 || refusedTotal > 0) {
          await recordWhatsAppAudit(localPlane, organizationId, {
            id: uuidv7(),
            kind: "sync_run",
            at: new Date().toISOString(),
            subjectKey: `chat:${input.chatId}`,
            detail: {
              stored: fresh.length,
              refused: refusedTotal,
              ...Object.fromEntries(refusedByReason.map(([reason, count]) => [`refused_${reason}`, count])),
            },
          });
        }

        // AI Harness K2 (TASK-046): the owner's own OUTBOUND messages become
        // envelope-only learning signals — flight on and the whatsapp
        // source's consent explicitly ON (default off). Inbound is someone
        // else's act and never emits (the mapper enforces it; the loop skips
        // it early to avoid pointless id derivations). The mapper's envelope
        // type cannot express `body`, so message text has no path into a
        // signal row; deterministic ids make a re-ingested window a no-op.
        // Bounded by construction: `fresh` is capped by the input's own
        // 1,000-message ceiling.
        if (ctx.wiring.learningObservationEnabled) {
          const consent = await readCaptureConsentState(ctx.wiring, organizationId);
          if (captureAllowed(consent, "whatsapp")) {
            const owner = { organizationId, userId: ctx.identity.id };
            for (const message of fresh) {
              if (message.direction !== "outbound") continue;
              const signalId = whatsAppCaptureSignalId(message.messageId);
              if (await ctx.wiring.memoryStore.get(signalId, owner)) continue;
              const signal = whatsAppMessageCaptureSignal(
                {
                  messageId: message.messageId,
                  chatId: message.chatId,
                  direction: message.direction,
                  isGroup: input.isGroup ?? false,
                  sentAt: message.sentAt,
                  capturedAt: input.capturedAt,
                  // Taint-labeled at source: the owner's own outbound act,
                  // hashed over envelope facts only — never the body.
                  taintLabel: labelAtSource("human_input", {
                    ref: `whatsapp:${message.chatId}:${message.messageId}`,
                    valueHash: hashTaintValue({
                      messageId: message.messageId,
                      direction: message.direction,
                    }),
                    sensitivity: "private",
                    instructionRisk: "data",
                  }),
                },
                owner,
                signalId,
              );
              if (signal) await recordCaptureSignal(ctx.wiring.memoryStore, signal);
            }
          }
        }

        return {
          chatId: input.chatId,
          stored: fresh.length,
          // Reported, not swallowed: a read op that keeps producing unmappable
          // entries is drift worth seeing.
          refused: mapped.skipped,
          cursor,
        };
      }),

    /** Which threads have been synced, and how much history is actually held. */
    syncState: authenticatedProcedure.query(async ({ ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const state = readWhatsAppSyncState(
        await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_SYNC_NAMESPACE),
      );
      return {
        threads: whatsAppSyncedThreads(state),
        progress: summarizeWhatsAppSync(state),
        capabilities: await ctx.wiring.localPlane.graph.messageSearchCapabilities(),
      };
    }),

    /** One thread, oldest first — what the message list renders. */
    thread: authenticatedProcedure
      .input(
        z.object({
          chatId: z.string().min(1).max(128),
          limit: z.number().int().min(1).max(20_000).default(5_000),
        }),
      )
      .query(async ({ input, ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const messages = await ctx.wiring.localPlane.graph.listMessages(
          organizationId,
          WHATSAPP_SOURCE,
          input.chatId,
          input.limit,
        );
        return {
          chatId: input.chatId,
          messages,
          // The consent facts the send gate reads, surfaced so the composer can
          // explain itself rather than silently refusing.
          activity: await ctx.wiring.localPlane.graph.getThreadActivity(
            organizationId,
            WHATSAPP_SOURCE,
            input.chatId,
          ),
        };
      }),

    /** Full-text (or fuzzy) search across captured message bodies. */
    searchMessages: authenticatedProcedure
      .input(
        z.object({
          text: z.string().trim().min(1).max(500),
          chatId: z.string().max(128).optional(),
          mode: z.enum(["fulltext", "fuzzy"]).default("fulltext"),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .query(async ({ input, ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const hits = await ctx.wiring.localPlane.graph.searchMessages({
          organizationId,
          source: WHATSAPP_SOURCE,
          text: input.text,
          mode: input.mode,
          limit: input.limit,
          ...(input.chatId ? { chatId: input.chatId } : {}),
        });
        return {
          hits,
          // Reported rather than assumed: fuzzy search needs pg_trgm, which the
          // store may not have loaded, and a silently degraded search that
          // returns nothing looks identical to "no matches".
          capabilities: await ctx.wiring.localPlane.graph.messageSearchCapabilities(),
        };
      }),

    // ── Relationship links (TASK-030, ADR-159) ──────────────────────────────
    //
    // "Whose chat is this?" — the seam between this Module and the Relationship
    // Module. Both procedures below are READ-ONLY and commit nothing: resolving
    // a link is a lookup, and a lookup must not have the side effect of writing
    // a Person. Ambiguity discovered here is reported, not filed; the Signal is
    // written by `stageExtraction`, which is the run the user actually asked for.
    //
    // RESIDENCY: identity keys embed phone numbers, and every read here is
    // against the LOCAL plane. Nothing in this section touches cloud canonical
    // and no message body is returned by either procedure.

    /**
     * The Relationship subject for every synced chat, with its link state.
     *
     * Returns real rows or an empty list — a chat with no Person reads as
     * `unlinked`, never as a placeholder Person.
     */
    relationshipLinks: authenticatedProcedure.query(async ({ ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const localPlane = ctx.wiring.localPlane;

      const people = await localPlane.graph.listPeople(organizationId);
      const index = whatsAppPersonIndexFrom(
        people.flatMap((person) =>
          person.dedupeKey ? [{ personId: person.id, dedupeKey: person.dedupeKey }] : [],
        ),
      );
      // Names come from the local People rows, so a linked chat can be labelled
      // with the Person Bridge knows rather than the name WhatsApp reports.
      const nameById = new Map(people.map((person) => [person.id, person.fullName ?? ""]));

      const state = readWhatsAppSyncState(
        await localPlane.state.read(organizationId, WHATSAPP_SYNC_NAMESPACE),
      );
      const links = whatsAppSyncedThreads(state).map((thread) => {
        const link = resolveWhatsAppChatLink(thread.chatId, index);
        return {
          chatId: thread.chatId,
          // A label, never an identifier — see `ChatSyncCursor.name`.
          ...(thread.name !== undefined ? { chatName: thread.name } : {}),
          messageCount: thread.messageCount,
          link,
          ...(link.state === "linked"
            ? { personName: nameById.get(link.personId) || undefined }
            : {}),
        };
      });

      // Counted per state so the surface can lead with the honest headline
      // ("142 chats, 38 linked") instead of implying the rest matched.
      const counts = links.reduce<Record<string, number>>((acc, row) => {
        acc[row.link.state] = (acc[row.link.state] ?? 0) + 1;
        return acc;
      }, {});
      return { links, counts, totalChats: links.length, knownPeople: people.length };
    }),

    /** The Relationship subject for one chat. */
    chatLink: authenticatedProcedure
      .input(z.object({ chatId: z.string().min(1).max(128) }))
      .query(async ({ input, ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const localPlane = ctx.wiring.localPlane;
        const people = await localPlane.graph.listPeople(organizationId);
        const link = resolveWhatsAppChatLink(
          input.chatId,
          whatsAppPersonIndexFrom(
            people.flatMap((person) =>
              person.dedupeKey ? [{ personId: person.id, dedupeKey: person.dedupeKey }] : [],
            ),
          ),
        );
        const person =
          link.state === "linked" ? people.find((row) => row.id === link.personId) : undefined;
        return {
          chatId: input.chatId,
          link,
          // Identity-grade fields only. No phone number is returned here: the
          // surface needs to know WHO, not how to dial them.
          ...(person ? { person: { id: person.id, fullName: person.fullName } } : {}),
        };
      }),

    // ── Tags and internal notes (TASK-030) ──────────────────────────────────
    //
    // Bridge's OWN data about a subject. Nothing below reads or writes any
    // WhatsApp surface: a tag and a note are things the owner wrote, held on
    // the LOCAL plane, invisible to the counterparty and with no promote path.

    /** Everything annotated, plus the tag vocabulary actually in use. */
    annotations: authenticatedProcedure.query(async ({ ctx }) => {
      const organizationId = PILOT_ORGANIZATION;
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      const state = readAnnotationState(
        await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_ANNOTATIONS_NAMESPACE),
      );
      // An empty store returns empty arrays. The surface says "nothing yet"
      // rather than showing an example row.
      return { subjects: listWhatsAppAnnotations(state), tags: whatsAppTagCounts(state) };
    }),

    /** Add one or more tags to a subject. Idempotent. */
    addTags: authenticatedProcedure
      .input(
        z.object({
          kind: z.enum(["chat", "person", "community"]),
          id: z.string().min(1).max(300),
          tags: z.array(z.string().min(1).max(48)).min(1).max(25),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const at = new Date().toISOString();
        return ctx.wiring.localPlane.state.update(
          organizationId,
          WHATSAPP_ANNOTATIONS_NAMESPACE,
          readAnnotationState(null),
          (current) => {
            const next = addWhatsAppTags(
              readAnnotationState(current),
              { kind: input.kind, id: input.id },
              input.tags,
              at,
            );
            return { state: next, result: { subjects: listWhatsAppAnnotations(next), tags: whatsAppTagCounts(next) } };
          },
        );
      }),

    removeTag: authenticatedProcedure
      .input(
        z.object({
          kind: z.enum(["chat", "person", "community"]),
          id: z.string().min(1).max(300),
          tag: z.string().min(1).max(48),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const at = new Date().toISOString();
        return ctx.wiring.localPlane.state.update(
          organizationId,
          WHATSAPP_ANNOTATIONS_NAMESPACE,
          readAnnotationState(null),
          (current) => {
            const next = removeWhatsAppTag(
              readAnnotationState(current),
              { kind: input.kind, id: input.id },
              input.tag,
              at,
            );
            return { state: next, result: { subjects: listWhatsAppAnnotations(next), tags: whatsAppTagCounts(next) } };
          },
        );
      }),

    /**
     * Write an internal note. The author is the AUTHENTICATED identity, never a
     * client-supplied field — a note's provenance is the one thing about it a
     * caller must not be able to choose.
     */
    addNote: authenticatedProcedure
      .input(
        z.object({
          kind: z.enum(["chat", "person", "community"]),
          id: z.string().min(1).max(300),
          body: z.string().trim().min(1).max(4_096),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const at = new Date().toISOString();
        const noteId = uuidv7();
        const authorId = ctx.identity.id;
        return ctx.wiring.localPlane.state.update(
          organizationId,
          WHATSAPP_ANNOTATIONS_NAMESPACE,
          readAnnotationState(null),
          (current) => {
            const next = addWhatsAppNote(
              readAnnotationState(current),
              { kind: input.kind, id: input.id },
              { id: noteId, body: input.body, authorId },
              at,
            );
            return { state: next, result: { subjects: listWhatsAppAnnotations(next), tags: whatsAppTagCounts(next) } };
          },
        );
      }),

    removeNote: authenticatedProcedure
      .input(
        z.object({
          kind: z.enum(["chat", "person", "community"]),
          id: z.string().min(1).max(300),
          noteId: z.string().min(1).max(128),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const at = new Date().toISOString();
        return ctx.wiring.localPlane.state.update(
          organizationId,
          WHATSAPP_ANNOTATIONS_NAMESPACE,
          readAnnotationState(null),
          (current) => {
            const next = removeWhatsAppNote(
              readAnnotationState(current),
              { kind: input.kind, id: input.id },
              input.noteId,
              at,
            );
            return { state: next, result: { subjects: listWhatsAppAnnotations(next), tags: whatsAppTagCounts(next) } };
          },
        );
      }),

    // ── Analytics and audit (TASK-030) ──────────────────────────────────────

    /**
     * Record the outcome of one attempted send.
     *
     * This is the seam, not the send. The gate itself lives in the renderer's
     * engine (`performAutomatedSend` → the Rust ceiling) and is untouched by
     * this Tool; the call site simply hands the OUTCOME here afterwards so the
     * audit log holds it. Deliberately not a send procedure: adding one would
     * be a second write path to WhatsApp, which the ordered gate exists to
     * prevent.
     *
     * The status is what the gate decided, so a caller cannot report a refusal
     * as a success — but it also cannot use this to send anything, because
     * nothing here touches a transport.
     */
    recordSendOutcome: authenticatedProcedure
      .input(
        z.object({
          recipientKey: z.string().min(1).max(300),
          status: z.enum(["sent", "refused", "deferred", "needs_approval"]),
          reason: z.string().max(1_000).optional(),
          /** The policy or shell rule that decided it. */
          code: z.string().max(120).optional(),
          delaySeconds: z.number().int().min(0).max(86_400).optional(),
          earliestAtMs: z.number().int().min(0).optional(),
          subjectKey: z.string().max(300).optional(),
          ruleId: z.string().max(128).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);

        // Rebuilt as the outcome shape so the row is produced by the same
        // mapping the Module tests cover, rather than a second hand-written one.
        const outcome =
          input.status === "sent"
            ? ({
                status: "sent",
                request: {
                  targetKind: "person",
                  targetId: "",
                  recipientKey: input.recipientKey,
                  body: "",
                },
                delaySeconds: input.delaySeconds ?? 0,
              } as const)
            : input.status === "needs_approval"
              ? ({
                  status: "needs_approval",
                  request: {
                    targetKind: "person",
                    targetId: "",
                    recipientKey: input.recipientKey,
                    body: "",
                  },
                  reason: input.reason ?? "",
                } as const)
              : input.status === "refused"
                ? ({
                    status: "refused",
                    reason: input.reason ?? "",
                    ...(input.code !== undefined ? { code: input.code } : {}),
                  } as const)
                : ({
                    status: "deferred",
                    reason: input.reason ?? "",
                    ...(input.code !== undefined ? { code: input.code } : {}),
                    ...(input.earliestAtMs !== undefined
                      ? { earliestAtMs: input.earliestAtMs }
                      : {}),
                  } as const);

        await recordWhatsAppAudit(
          ctx.wiring.localPlane,
          organizationId,
          auditEventFromOutcome(uuidv7(), new Date().toISOString(), input.recipientKey, outcome, {
            ...(input.subjectKey !== undefined ? { subjectKey: input.subjectKey } : {}),
            ...(input.ruleId !== undefined ? { ruleId: input.ruleId } : {}),
          }),
        );
        return { recorded: true };
      }),

    /**
     * What Bridge itself has done, and the rollup over it.
     *
     * Built ONLY from rows Bridge wrote as it acted. Nothing here reads the
     * WhatsApp account — there is no scraped engagement metric, no per-contact
     * message count, and no backfill, because there would be nothing honest to
     * backfill from.
     */
    auditLog: authenticatedProcedure
      .input(
        z
          .object({
            kinds: z
              .array(
                z.enum([
                  "send_attempted",
                  "send_sent",
                  "send_refused",
                  "send_deferred",
                  "send_needs_approval",
                  "sync_run",
                  "extraction_run",
                  "rule_fired",
                  "rule_skipped",
                  "automation_halted",
                  "automation_rearmed",
                ]),
              )
              .optional(),
            sinceIso: z.string().min(1).optional(),
            limit: z.number().int().min(1).max(500).default(100),
          })
          .default({ limit: 100 }),
      )
      .query(async ({ input, ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const state = readAuditState(
          await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_AUDIT_NAMESPACE),
        );
        return {
          events: listAuditEvents(state, {
            limit: input.limit,
            ...(input.kinds ? { kinds: input.kinds as WhatsAppAuditEventKind[] } : {}),
            ...(input.sinceIso ? { sinceIso: input.sinceIso } : {}),
          }),
          // The rollup deliberately spans the whole retained log, not the
          // truncated page above it, so the counts do not silently mean "of the
          // first 100 rows".
          summary: summarizeAudit(state, {
            ...(input.sinceIso ? { sinceIso: input.sinceIso } : {}),
          }),
        };
      }),
    // ── Automation: rules, schedule, assignment (TASK-030, ADR-158/AP-091) ──
    //
    // RESIDENCY: all three ledgers live in ONE `LocalStateStore` namespace,
    // which is Local Plane by construction. Rules name chats, assignments name
    // humans and Agents, scheduled actions name goals. None of it dual-writes
    // and none of it has a promote path.
    //
    // SEND DISCIPLINE: nothing in this section sends, and nothing in it can.
    // A rule starts an Agent Run; whatever that Run wants to deliver goes
    // through `performAutomatedSend` — policy refusals, then `decideSend`,
    // then the Rust-enforced ceiling. There is no second write path here.
    //
    // ATTRIBUTION: every mutation below requires `identity.type === "user"`.
    // An Agent may not author its own rules, assign itself, or re-arm anything;
    // that is what makes the audit trail mean something.
    automation: t.router({
      /** Every ledger, plus what the panels need to render honest choices. */
      state: authenticatedProcedure.query(async ({ ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const state = readWhatsAppAutomationState(
          await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_AUTOMATION_NAMESPACE),
        );
        const sync = readWhatsAppSyncState(
          await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_SYNC_NAMESPACE),
        );
        return {
          rules: state.rules,
          assignments: state.assignments,
          scheduled: state.scheduled,
          // The manifest is the authority on which Agents exist. Sending the
          // list means the panel offers real Agents rather than free text.
          agents: whatsAppModuleAgents(),
          // Real synced threads only. A chat the store has never seen is not
          // offered as a subject, because a rule pointed at one could never
          // have the consent facts it needs.
          chats: whatsAppSyncedThreads(sync).map((thread) => ({
            chatId: thread.chatId,
            ...(thread.name !== undefined ? { name: thread.name } : {}),
            ...(thread.isGroup !== undefined ? { isGroup: thread.isGroup } : {}),
          })),
        };
      }),

      createRule: authenticatedProcedure
        .input(
          z.object({
            name: z.string().trim().min(1).max(120),
            subject: whatsAppAutomationSubjectSchema,
            trigger: z.discriminatedUnion("kind", [
              z.object({
                kind: z.literal("inbound_message"),
                bodyContains: z.string().trim().max(200).optional(),
              }),
              z.object({
                kind: z.literal("thread_quiet"),
                quietDays: z.number().int().min(1).max(365),
              }),
            ]),
            goal: z.string().trim().min(1).max(600),
            /**
             * Only ever tightening — `tightenLimits` takes the stricter of each
             * field, so these bounds are a usability guard, not the protection.
             */
            limitOverrides: z
              .object({
                dailyCap: z.number().int().min(1).max(30).optional(),
                recipientCooldownDays: z.number().int().min(7).max(365).optional(),
                businessHourStart: z.number().int().min(9).max(23).optional(),
                businessHourEnd: z.number().int().min(1).max(21).optional(),
                requireRecipientInitiated: z.boolean().optional(),
              })
              .optional(),
            enabled: z.boolean().default(true),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const who = requireWhatsAppHuman(ctx.identity);
          const now = new Date().toISOString();
          const rule = draftWhatsAppRule({
            id: uuidv7(),
            name: input.name,
            subject: input.subject,
            // Rebuilt field by field rather than spread: the package builds
            // with `exactOptionalPropertyTypes`, and an absent `bodyContains`
            // must be absent rather than present-and-undefined.
            trigger:
              input.trigger.kind === "inbound_message"
                ? {
                    kind: "inbound_message" as const,
                    ...(input.trigger.bodyContains
                      ? { bodyContains: input.trigger.bodyContains }
                      : {}),
                  }
                : { kind: "thread_quiet" as const, quietDays: input.trigger.quietDays },
            goal: input.goal,
            createdBy: who,
            now,
            enabled: input.enabled,
            // Undefined entries are dropped rather than passed through, for the
            // same `exactOptionalPropertyTypes` reason as the trigger above.
            // `tightenLimits` would ignore them either way — it only ever takes
            // the stricter of each field against the shipped discipline.
            ...(input.limitOverrides
              ? {
                  limitOverrides: Object.fromEntries(
                    Object.entries(input.limitOverrides).filter(
                      ([, value]) => value !== undefined,
                    ),
                  ),
                }
              : {}),
          });
          await whatsAppAutomationUpdate(ctx, (state) =>
            whatsAppWithLedgers(state, {
              rules: addWhatsAppRule(whatsAppRuleLedger(state), rule),
            }),
          );
          return { rule };
        }),

      setRuleEnabled: authenticatedProcedure
        .input(
          z.object({
            ruleId: z.string().min(1).max(128),
            enabled: z.boolean(),
            reason: z.string().trim().max(300).optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const who = requireWhatsAppHuman(ctx.identity);
          const now = new Date().toISOString();
          await whatsAppAutomationUpdate(ctx, (state) =>
            whatsAppWithLedgers(state, {
              rules: setWhatsAppRuleEnabled(
                whatsAppRuleLedger(state),
                input.ruleId,
                input.enabled,
                who,
                now,
                input.reason,
              ),
            }),
          );
          return { ruleId: input.ruleId, enabled: input.enabled };
        }),

      /**
       * Delete a rule, and cancel everything it had already queued.
       *
       * Both halves in ONE atomic state update. Deleting the rule while leaving
       * its queued Agent Runs behind would leave the owner watching actions
       * fire from an automation they believe they removed.
       */
      deleteRule: authenticatedProcedure
        .input(z.object({ ruleId: z.string().min(1).max(128) }))
        .mutation(async ({ input, ctx }) => {
          const who = requireWhatsAppHuman(ctx.identity);
          const now = new Date().toISOString();
          // Assigned inside the reducer, which may be retried under contention;
          // a plain assignment (not an accumulation) is safe to redo.
          let cancelledActions = 0;
          await whatsAppAutomationUpdate(ctx, (state) => {
            const swept = cancelWhatsAppActionsForRule(
              whatsAppScheduleLedger(state),
              input.ruleId,
              who,
              now,
            );
            cancelledActions = swept.cancelled;
            return whatsAppWithLedgers(state, {
              rules: deleteWhatsAppRule(whatsAppRuleLedger(state), input.ruleId),
              schedule: swept.ledger,
            });
          });
          return { ruleId: input.ruleId, cancelledActions };
        }),

      assignAgent: authenticatedProcedure
        .input(
          z.object({
            subject: whatsAppAutomationSubjectSchema,
            agentId: z.string().min(1).max(128),
            note: z.string().trim().max(300).optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const who = requireWhatsAppHuman(ctx.identity);
          const now = new Date().toISOString();
          await whatsAppAutomationUpdate(ctx, (state) =>
            whatsAppWithLedgers(state, {
              assignments: assignWhatsAppAgent(whatsAppAssignmentLedger(state), {
                id: uuidv7(),
                subject: input.subject,
                agentId: input.agentId,
                assignedBy: who,
                assignedAt: now,
                // The manifest decides which Agents exist. Never a client list.
                allowedAgentIds: whatsAppModuleAgents().map((agent) => agent.id),
                ...(input.note ? { note: input.note } : {}),
              }).ledger,
            }),
          );
          return { subject: input.subject, agentId: input.agentId };
        }),

      unassignAgent: authenticatedProcedure
        .input(z.object({ subject: whatsAppAutomationSubjectSchema }))
        .mutation(async ({ input, ctx }) => {
          const who = requireWhatsAppHuman(ctx.identity);
          const now = new Date().toISOString();
          await whatsAppAutomationUpdate(ctx, (state) =>
            whatsAppWithLedgers(state, {
              assignments: unassignWhatsAppAgent(
                whatsAppAssignmentLedger(state),
                input.subject,
                who,
                now,
              ).ledger,
            }),
          );
          return { subject: input.subject };
        }),

      cancelAction: authenticatedProcedure
        .input(z.object({ actionId: z.string().min(1).max(128) }))
        .mutation(async ({ input, ctx }) => {
          const who = requireWhatsAppHuman(ctx.identity);
          const now = new Date().toISOString();
          await whatsAppAutomationUpdate(ctx, (state) =>
            whatsAppWithLedgers(state, {
              schedule: cancelWhatsAppAction(
                whatsAppScheduleLedger(state),
                input.actionId,
                who,
                now,
              ).ledger,
            }),
          );
          return { actionId: input.actionId };
        }),

      /**
       * Evaluate every enabled rule against what the message store actually
       * holds, and queue whatever is due.
       *
       * This is a USER-CLICKED check, not a background loop — the same posture
       * the read Tools take. It reads only stored Local Plane facts, so it
       * touches the WhatsApp session not at all, and it queues Agent Runs
       * rather than sending anything.
       *
       * Every rule that did not produce an action reports WHY, including the
       * ones blocked by the consent gate. A rule pointed at a thread the
       * recipient has never written in can never fire, and the owner should
       * learn that from this check rather than from silence.
       */
      check: authenticatedProcedure.mutation(async ({ ctx }) => {
        const organizationId = PILOT_ORGANIZATION;
        await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
        const now = new Date().toISOString();

        const state = readWhatsAppAutomationState(
          await ctx.wiring.localPlane.state.read(organizationId, WHATSAPP_AUTOMATION_NAMESPACE),
        );

        // Consent facts, per subject, read from the store rather than assumed.
        const activity = new Map<string, Awaited<ReturnType<typeof ctx.wiring.localPlane.graph.getThreadActivity>>>();
        for (const rule of state.rules) {
          if (rule.subject.kind !== "chat" || activity.has(rule.subject.key)) continue;
          activity.set(
            rule.subject.key,
            await ctx.wiring.localPlane.graph.getThreadActivity(
              organizationId,
              WHATSAPP_SOURCE,
              rule.subject.key,
            ),
          );
        }

        const outcomes: {
          ruleId: string;
          ruleName: string;
          status: string;
          explanation: string;
          actionId?: string;
        }[] = [];
        const queued: { id: string; ruleId: string; scheduledFor: string }[] = [];

        await whatsAppAutomationUpdate(ctx, (current) => {
          let schedule = whatsAppScheduleLedger(current);
          outcomes.length = 0;
          queued.length = 0;

          for (const rule of current.rules) {
            const thread = activity.get(rule.subject.key) ?? {
              chatId: rule.subject.key,
              inboundCount: 0,
              outboundCount: 0,
            };
            // A Person-subject rule has no single thread to read consent from,
            // so it is reported honestly rather than run against a guess.
            if (rule.subject.kind !== "chat") {
              outcomes.push({
                ruleId: rule.id,
                ruleName: rule.name,
                status: "blocked",
                explanation:
                  "This rule watches a Person rather than one chat, and consent is a per-thread fact. Point it at a chat.",
              });
              continue;
            }

            const plan = planWhatsAppAutomationRun(rule, {
              now,
              assignments: whatsAppAssignmentLedger(current),
              thread,
            });

            if (plan.status !== "start_agent_run") {
              // Said plainly rather than left as "not due": this check is a
              // SWEEP over stored facts, so it can evaluate a quiet thread but
              // has no arriving message to hand an `inbound_message` rule. Such
              // a rule is not broken and is not due — it is waiting for a hook
              // that does not exist yet, and the owner should be told that
              // rather than pressing this button again next week.
              const sweepBlind =
                plan.status === "not_due" && rule.trigger.kind === "inbound_message";
              outcomes.push({
                ruleId: rule.id,
                ruleName: rule.name,
                status: sweepBlind ? "waiting" : plan.status,
                explanation: sweepBlind
                  ? "This rule fires when a message arrives. This check only sweeps what is already stored, so it cannot fire one — that needs the message-arrival hook, which is not built yet."
                  : plan.status === "blocked"
                    ? plan.explanation
                    : plan.reason,
              });
              continue;
            }

            // A trigger match is not a licence to act now. The action is queued
            // and paced; when it runs, the send gate speaks again.
            const id = uuidv7();
            const outcome = scheduleWhatsAppFromPolicy(schedule, {
              id,
              ruleId: rule.id,
              agentId: plan.agentId,
              subject: plan.subject,
              goal: plan.goal,
              ...(plan.skillId ? { skillId: plan.skillId } : {}),
              now,
              decision: { status: "allowed", delaySeconds: 0 },
              limits: plan.limits,
              jitterDraw: Math.random(),
            });
            if (outcome.status === "refused") {
              outcomes.push({
                ruleId: rule.id,
                ruleName: rule.name,
                status: "refused",
                explanation: outcome.reason,
              });
              continue;
            }
            schedule = outcome.ledger;
            queued.push({ id, ruleId: rule.id, scheduledFor: outcome.action.scheduledFor });
            outcomes.push({
              ruleId: rule.id,
              ruleName: rule.name,
              status: "queued",
              explanation: `${plan.because} ${outcome.action.reason.explanation}`,
              actionId: id,
            });
          }

          return whatsAppWithLedgers(current, { schedule });
        });

        return { checkedAt: now, outcomes, queued };
      }),
    }),
  }),

  google: t.router({
    /** Connection + manifest surfaces for the Integrations UI. */
    list: authenticatedProcedure.query(async ({ ctx }) => {
      await assertGoogleIntegrationOwner(ctx);
      const info = await ctx.wiring.google.connectionInfo();
      const m = ctx.wiring.googleManifest;
      return {
        oauthConfigured: ctx.wiring.googleOAuth !== null,
        gatewayKind: ctx.wiring.googleGatewayKind,
        integrationId: ctx.wiring.google.integrationId,
        connection: info,
        surfaces: [
          { provider: "gmail", name: "Gmail" },
          { provider: "google-calendar", name: "Google Calendar" },
        ],
        manifest: { capabilities: m.capabilities, output_contract: m.output_contract, intake_policy: m.intake_policy },
      };
    }),

    /** The Google consent URL (read AND write scopes, offline). */
    connectUrl: authenticatedProcedure.mutation(async ({ ctx }) => {
      await assertGoogleIntegrationOwner(ctx);
      if (!ctx.wiring.googleOAuth) {
        return { url: null as string | null, error: "oauth_not_configured" as const };
      }
      const { state, codeChallenge } =
        await ctx.wiring.googleOAuthStates.issue(
        PILOT_ORGANIZATION,
        ctx.wiring.google.integrationId,
        ctx.identity.id,
      );
      return {
        url: authUrl(ctx.wiring.googleOAuth, state, codeChallenge),
      };
    }),

    /** Revoke locally (delete the local token). */
    disconnect: authenticatedProcedure.mutation(async ({ ctx }) => {
      await assertGoogleIntegrationOwner(ctx);
      await ctx.wiring.google.disconnect();
      return { ok: true };
    }),

    /** Source Gmail through the gate → propose Events/Memories/Signals. */
    syncGmail: authenticatedProcedure
      .input(z.object({ maxResults: z.number().int().positive().max(100).optional(), query: z.string().optional() }).optional())
      .mutation(async ({ input, ctx }) => {
        await assertGoogleIntegrationOwner(ctx);
        return ctx.wiring.google.syncGmail(ctx.run, {
          ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input?.query ? { query: input.query } : {}),
        });
      }),

    /** Source Calendar through the gate → propose Events. */
    syncCalendar: authenticatedProcedure
      .input(
        z
          .object({
            maxResults: z.number().int().positive().max(100).optional(),
            timeMin: z.string().optional(),
            timeMax: z.string().optional(),
          })
          .optional(),
      )
      .mutation(async ({ input, ctx }) => {
        await assertGoogleIntegrationOwner(ctx);
        return ctx.wiring.google.syncCalendar(ctx.run, {
          ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input?.timeMin ? { timeMin: input.timeMin } : {}),
          ...(input?.timeMax ? { timeMax: input.timeMax } : {}),
        });
      }),

    /** Read-only projection: FULL Calendar events for the Calendar surface (gated
     * external:fetch, auto-approved as the user's own view). No Event proposals. */
    listEvents: authenticatedProcedure
      .input(
        z
          .object({
            maxResults: z.number().int().positive().max(250).optional(),
            timeMin: z.string().optional(),
            timeMax: z.string().optional(),
          })
          .optional(),
      )
      .mutation(async ({ input, ctx }) => {
        await assertGoogleIntegrationOwner(ctx);
        const events = await ctx.wiring.google.listCalendarEvents(ctx.run, {
          ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input?.timeMin ? { timeMin: input.timeMin } : {}),
          ...(input?.timeMax ? { timeMax: input.timeMax } : {}),
        });
        return { events };
      }),

    /** Compose an outbound email/event as a DRAFT → external:send proposal (>= L2).
     * For calendar, `action` = create (default) | update | delete. The real Google
     * write runs in the EgressExecutor only after a human approves. */
    proposeSend: authenticatedProcedure
      .input(
        z.object({
          kind: z.enum(["email", "calendar"]),
          action: z.enum(["create", "update", "delete"]).optional(),
          envelope: z.record(z.unknown()),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await assertGoogleIntegrationOwner(ctx);
        return ctx.wiring.google.proposeSend(ctx.run, {
          kind: input.kind,
          ...(input.action ? { action: input.action } : {}),
          envelope: input.envelope as never,
        });
      }),
  }),

  /** Agent governance — create/update an agent from SERVER-OWNED role templates only.
   * Escalating capability (external:send, governance, full-graph, '*') is still
   * stripped at the seam as defense in depth; agents can never be created able to
   * send or approve, nor may callers name arbitrary capability or skill bundles. */
  agent: t.router({
    create: procedure.input(agentCreateInput).mutation(async ({ input, ctx }) => {
      // TASK-011 remediation (2026-07-18 coordinator final review, issue 5) —
      // membership/authority checks apply to agent creation like every other
      // organization-scoped mutation; a caller may not mint an Agent into a
      // organization they don't belong to.
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const mem = ctx.wiring.memory;
      if (!mem) throw new Error("agent.create: in-memory governance store required (persistent agent CRUD pending)");
      const template = resolveAuthorizedAgentRoleTemplate(input.organizationId, input.roleTemplateId);
      if (!template) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `unknown or unauthorized agent role template "${input.roleTemplateId}" for this organization`,
        });
      }
      const built = buildAgentCapability({
        capabilityScope: [...template.capabilityScope],
        egressTier: template.egressTier as EgressTier,
      });
      const agentId = ctx.run.ids.next();
      mem.roles.roleGrants.set(template.roleId, [...template.roleGrants]);
      mem.agents.scope.set(agentId, built.scope);
      mem.agents.tiers.set(agentId, template.dataScope as DataScope);
      mem.agents.skills.set(agentId, [...template.allowedSkills]);
      mem.agents.assumed.set(agentId, template.roleId);
      // TASK-011 remediation (2026-07-18 final review, issue 5) — `AgentQuery`
      // now requires `organizationId`/`isActive` (added alongside relationship-
      // module trust boundaries; `InMemoryAgentStore`'s own implementation is
      // fail-closed: unset = unknown organization / inactive). Before this fix,
      // an agent created here was PERMANENTLY unusable — it could never pass
      // the AGS1 organization-match check, nor any "must be active" gate — a
      // silent, total break of `agent.create`'s own contract. A freshly
      // created agent is bound to the organization it was created in and made
      // active immediately (this endpoint IS the explicit, governed creation
      // act — there is no separate "activate" step for API-created agents
      // elsewhere in this codebase); unknown/paused/retired agents remain
      // fail-closed exactly as before.
      mem.agents.organizations.set(agentId, input.organizationId);
      mem.agents.statuses.set(agentId, "active");
      return {
        agentId,
        name: input.name,
        roleTemplateId: template.id,
        scope: built.scope,
        allowedSkills: [...template.allowedSkills],
        dropped: built.dropped, // escalating tokens we refused to grant (shown in UI)
        dataScope: template.dataScope,
        egressTier: template.egressTier,
        // Non-removable, always-true facts about an in-platform agent:
        floor: { canSend: false, canApprove: false },
      };
    }),

    update: procedure.input(agentUpdateInput).mutation(async ({ input, ctx }) => {
      const mem = ctx.wiring.memory;
      if (!mem) throw new Error("agent.update: in-memory governance store required (persistent agent CRUD pending)");
      if (!mem.agents.scope.has(input.agentId)) throw new Error(`agent.update: unknown agent ${input.agentId}`);
      const organizationId = await ctx.wiring.agents.organizationId(input.agentId);
      if (!organizationId) throw new Error(`agent.update: agent ${input.agentId} has no organization binding`);
      assertPilotOrganization(organizationId);
      await assertMembership(ctx.wiring.organizationStore, organizationId, ctx.identity.id);
      let dropped: string[] = [];
      let roleTemplateId: string | undefined;
      let allowedSkills = mem.agents.skills.get(input.agentId) ?? [];
      let egressTier: EgressTier | undefined;
      if (input.roleTemplateId !== undefined) {
        const template = resolveAuthorizedAgentRoleTemplate(organizationId, input.roleTemplateId);
        if (!template) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `unknown or unauthorized agent role template "${input.roleTemplateId}" for this organization`,
          });
        }
        const built = buildAgentCapability({
          capabilityScope: [...template.capabilityScope],
          egressTier: template.egressTier as EgressTier,
        });
        mem.roles.roleGrants.set(template.roleId, [...template.roleGrants]);
        mem.agents.assumed.set(input.agentId, template.roleId);
        mem.agents.scope.set(input.agentId, built.scope);
        mem.agents.tiers.set(input.agentId, template.dataScope as DataScope);
        mem.agents.skills.set(input.agentId, [...template.allowedSkills]);
        dropped = built.dropped;
        roleTemplateId = template.id;
        allowedSkills = [...template.allowedSkills];
        egressTier = template.egressTier as EgressTier;
      }
      return {
        agentId: input.agentId,
        ...(roleTemplateId ? { roleTemplateId } : {}),
        scope: mem.agents.scope.get(input.agentId) ?? [],
        allowedSkills,
        dropped,
        dataScope: mem.agents.tiers.get(input.agentId) ?? "all",
        ...(egressTier ? { egressTier } : {}),
        floor: { canSend: false, canApprove: false },
      };
    }),
  }),

  automation: t.router({
    /** Create an Automation only when every Skill step fits its owning Agent. */
    create: procedure.input(automationCreateInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const [agentOrganizationId, agentActive, agentScope, agentDataScope] =
        await Promise.all([
          ctx.wiring.agents.organizationId(input.agentId),
          ctx.wiring.agents.isActive(input.agentId),
          ctx.wiring.agents.capabilityScope(input.agentId),
          ctx.wiring.agents.dataScope(input.agentId),
        ]);
      if (agentOrganizationId !== input.organizationId || !agentActive) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Automation owner must be an active Agent in the Organization",
        });
      }
      const agentView = {
        id: input.agentId,
        scope: agentScope,
        dataScope: agentDataScope,
      };
      const violations = validateAutomationWithinAgents(
        input.steps.map((s) => ({
          action: s.action as Action,
          resourceType: s.resourceType as ResourceType,
          ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
        })),
        [agentView],
      );
      if (violations.length > 0) {
        return { ok: false as const, violations, reason: "Automation exceeds its owning Agent's authority" };
      }
      const automationId = ctx.run.ids.next();
      await ctx.wiring.automationRegistry.save({
        id: automationId,
        name: input.name,
        organizationId: input.organizationId,
        agentId: input.agentId,
        agentPlane: "local",
        steps: input.steps.map((s) => ({
          skill: s.skill,
          action: s.action as Action,
          resourceType: s.resourceType as ResourceType,
          ...(s.resourceId ? { resourceId: s.resourceId } : {}),
          ...(s.inputs !== undefined ? { inputs: s.inputs as Record<string, unknown> } : {}),
          ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
          ...(s.goalTaskRef ? { goalTaskRef: s.goalTaskRef } : {}),
        })),
      });
      return { ok: true as const, automationId, agentId: input.agentId };
    }),

    /** Start the stored owning Agent's Run; callers cannot provide an actor or steps. */
    runById: procedure.input(automationRunByIdInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const onBehalfOf = resolveClientOnBehalfOf(ctx.identity, input.onBehalfOf);
      if (isModuleRuntimeAutomationId(input.automationId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Module Automations must run through their manifest key and Module binding",
        });
      }
      let automationId = input.automationId;
      if (input.moduleName) {
        const moduleInstallation = await ctx.wiring.moduleStore.getAvailable(
          input.organizationId,
          input.moduleName,
        );
        const automation = moduleInstallation?.manifest.module?.automations.find(
          (candidate) => candidate.automationId === input.automationId,
        );
        const runtimeAgentId = automation
          ? resolveModuleAgentRuntimeId(input.moduleName, automation.agentId)
          : undefined;
        const runtimeAutomationId = resolveModuleAutomationRuntimeId(input.moduleName, input.automationId);
        const definition = runtimeAutomationId
          ? await ctx.wiring.automationRegistry.load(input.organizationId, runtimeAutomationId)
          : null;
        if (!automation || !runtimeAgentId || !runtimeAutomationId || definition?.agentId !== runtimeAgentId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Module Automation has no verified runtime binding",
          });
        }
        automationId = runtimeAutomationId;
      }
      return ctx.wiring.automationExecutor.runById(
        {
          organizationId: input.organizationId,
          automationId,
          ...(onBehalfOf ? { onBehalfOf } : {}),
          ...(input.params ? { params: input.params } : {}),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        withHumanInputTaint(
          ctx.run,
          `automation:${automationId}:${ctx.identity.id}`,
          input.params ?? {},
        ),
      );
    }),
  }),

  /**
   * Dedicated Relation surface. Public callers can only stage Signal evidence
   * proposals here; owner, provenance, source Module, and approval behavior are
   * all assigned by the server and materialized only after a Human decision.
   */
  relationship: t.router({
    listPeople: authenticatedProcedure
      .input(relationshipListInput)
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const { items, total } = await ctx.wiring.graphStore.listPeople(
          input.organizationId,
          ctx.identity.id,
          {
            limit: input.limit,
            offset: input.offset,
            ...(input.query ? { query: input.query } : {}),
            ...(input.sorts ? { sorts: input.sorts } : {}),
            ...(input.rowFilters ? { rowFilters: input.rowFilters } : {}),
            ...(input.filterMatch ? { filterMatch: input.filterMatch } : {}),
          },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getPerson: authenticatedProcedure
      .input(z.object({ organizationId: databaseUuidSchema, id: databaseUuidSchema }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return ctx.wiring.graphStore.getPerson(input.organizationId, ctx.identity.id, input.id);
      }),

    createPerson: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid(), values: personCreateFieldsSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const recordId = ctx.run.ids.next();
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_record_mutation",
          recordType: "person",
          operation: "create",
          recordId,
          values: input.values,
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    updatePerson: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        id: z.string().uuid(),
        values: personUpdateFieldsSchema,
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const person = await ctx.wiring.graphStore.getPerson(
          input.organizationId,
          ctx.identity.id,
          input.id,
        );
        if (!person?.isOwner) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
        }
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_record_mutation",
          recordType: "person",
          operation: "update",
          recordId: input.id,
          values: input.values,
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    archivePerson: authenticatedProcedure
      .input(z.object({ organizationId: databaseUuidSchema, id: databaseUuidSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const person = await ctx.wiring.graphStore.getPerson(
          input.organizationId,
          ctx.identity.id,
          input.id,
        );
        if (!person?.isOwner) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
        }
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_record_mutation",
          recordType: "person",
          operation: "archive",
          recordId: input.id,
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    listCommunities: authenticatedProcedure
      .input(relationshipListInput)
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const { items, total } = await ctx.wiring.graphStore.listCommunities(
          input.organizationId,
          ctx.identity.id,
          {
            limit: input.limit,
            offset: input.offset,
            ...(input.query ? { query: input.query } : {}),
            ...(input.sorts ? { sorts: input.sorts } : {}),
            ...(input.rowFilters ? { rowFilters: input.rowFilters } : {}),
            ...(input.filterMatch ? { filterMatch: input.filterMatch } : {}),
          },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getCommunity: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid(), id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return ctx.wiring.graphStore.getCommunity(input.organizationId, ctx.identity.id, input.id);
      }),

    createCommunity: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid(), values: communityCreateFieldsSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const recordId = ctx.run.ids.next();
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_record_mutation",
          recordType: "community",
          operation: "create",
          recordId,
          values: input.values,
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    updateCommunity: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        id: z.string().uuid(),
        values: communityUpdateFieldsSchema,
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const community = await ctx.wiring.graphStore.getCommunity(
          input.organizationId,
          ctx.identity.id,
          input.id,
        );
        if (!community?.isOwner) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Community not found" });
        }
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_record_mutation",
          recordType: "community",
          operation: "update",
          recordId: input.id,
          values: input.values,
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    archiveCommunity: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid(), id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const community = await ctx.wiring.graphStore.getCommunity(
          input.organizationId,
          ctx.identity.id,
          input.id,
        );
        if (!community?.isOwner) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Community not found" });
        }
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_record_mutation",
          recordType: "community",
          operation: "archive",
          recordId: input.id,
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    createInteraction: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid(), values: humanInteractionFieldsSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const participantsAccessible =
          await ctx.wiring.graphStore.areRelationshipRecordsAccessible(
            input.organizationId,
            ctx.identity.id,
            input.values.participants,
          );
        if (!participantsAccessible) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Every Interaction participant must be an accessible Relationship Record",
          });
        }
        const recordId = ctx.run.ids.next();
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_interaction_create",
          recordId,
          values: { ...input.values, source: "user" },
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    memories: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
        snapshotAt: z.string().datetime({ offset: true }).optional(),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Relationship Memory requires a Human user principal" });
        }
        const person = await ctx.wiring.graphStore.getPerson(
          input.organizationId,
          ctx.identity.id,
          input.personId,
        );
        if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
        const snapshotAt = input.snapshotAt ?? ctx.run.clock.nowISO();
        const rows = await ctx.wiring.memoryStore.retrieve(
          {
            subjectRecordId: input.personId,
            snapshotAt,
            limit: input.limit + 1,
            offset: input.offset,
          },
          { organizationId: input.organizationId, userId: ctx.identity.id },
        );
        return {
          items: rows.slice(0, input.limit),
          nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
          hasMore: rows.length > input.limit,
          snapshotAt,
        };
      }),

    addMemory: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        type: z.enum(["episodic", "semantic", "procedural", "preference"]).default("semantic"),
        content: z.string().trim().min(1).max(5_000),
        scope: z.enum(["private", "organization"]).default("private"),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const person = await ctx.wiring.graphStore.getPerson(
          input.organizationId,
          ctx.identity.id,
          input.personId,
        );
        if (!person?.isOwner) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_memory_mutation",
          operation: "create",
          personId: input.personId,
          memoryId: ctx.run.ids.next(),
          values: {
            type: input.type,
            content: input.content,
            scope: input.scope,
          },
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    correctMemory: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        memoryId: z.string().uuid(),
        content: z.string().trim().min(1).max(5_000),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Relationship Memory changes require a Human user principal" });
        }
        const [person, memory] = await Promise.all([
          ctx.wiring.graphStore.getPerson(input.organizationId, ctx.identity.id, input.personId),
          ctx.wiring.memoryStore.get(input.memoryId, {
            organizationId: input.organizationId,
            userId: ctx.identity.id,
          }),
        ]);
        if (
          !person?.isOwner ||
          !memory ||
          memory.subjectRecordId !== input.personId ||
          memory.ownerUserId !== ctx.identity.id
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Relationship Memory not found" });
        }
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_memory_mutation",
          operation: "correct",
          personId: input.personId,
          memoryId: input.memoryId,
          replacementMemoryId: ctx.run.ids.next(),
          values: { content: input.content },
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    forgetMemory: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        memoryId: z.string().uuid(),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Relationship Memory changes require a Human user principal" });
        }
        const [person, memory] = await Promise.all([
          ctx.wiring.graphStore.getPerson(input.organizationId, ctx.identity.id, input.personId),
          ctx.wiring.memoryStore.get(input.memoryId, {
            organizationId: input.organizationId,
            userId: ctx.identity.id,
          }),
        ]);
        if (
          !person?.isOwner ||
          !memory ||
          memory.subjectRecordId !== input.personId ||
          memory.ownerUserId !== ctx.identity.id
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Relationship Memory not found" });
        }
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_memory_mutation",
          operation: "forget",
          personId: input.personId,
          memoryId: input.memoryId,
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    commitments: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
        includeArchived: z.boolean().default(false),
        snapshotAt: z.string().datetime({ offset: true }).optional(),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const snapshotAt = input.snapshotAt ?? ctx.run.clock.nowISO();
        const page = await ctx.wiring.graphStore.listCommitments(
          input.organizationId,
          ctx.identity.id,
          input.personId,
          {
            limit: input.limit,
            offset: input.offset,
            includeArchived: input.includeArchived,
            snapshotAt: new Date(snapshotAt),
          },
        );
        return {
          items: page.items.map((item) => ({
            ...item,
            dueAt: item.dueAt?.toISOString() ?? null,
            occurredAt: item.occurredAt.toISOString(),
            createdAt: item.createdAt.toISOString(),
          })),
          total: page.total,
          hasMore: input.offset + page.items.length < page.total,
          snapshotAt,
        };
      }),

    createCommitment: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        text: z.string().trim().min(1).max(2_000),
        dueAt: relationshipDateTimeSchema.nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const person = await ctx.wiring.graphStore.getPerson(
          input.organizationId,
          ctx.identity.id,
          input.personId,
        );
        if (!person?.isOwner) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
        const commitmentId = ctx.run.ids.next();
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_commitment_mutation",
          operation: "create",
          commitmentId,
          transitionEventId: commitmentId,
          personId: input.personId,
          values: {
            text: input.text,
            dueAt: input.dueAt ?? null,
            status: "pending",
          },
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    updateCommitment: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        commitmentId: z.string().uuid(),
        text: z.string().trim().min(1).max(2_000),
        dueAt: relationshipDateTimeSchema.nullable().optional(),
        status: z.enum(["pending", "completed", "cancelled"]),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const current = await ctx.wiring.graphStore.listCommitments(
          input.organizationId,
          ctx.identity.id,
          input.personId,
          {
            limit: 1,
            offset: 0,
            includeArchived: true,
            commitmentId: input.commitmentId,
          },
        );
        if (current.items.length !== 1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Commitment not found" });
        }
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_commitment_mutation",
          operation: "update",
          commitmentId: input.commitmentId,
          transitionEventId: ctx.run.ids.next(),
          personId: input.personId,
          sourceEventId: current.items[0]!.sourceEventId,
          values: {
            text: input.text,
            dueAt: input.dueAt ?? null,
            status: input.status,
          },
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    archiveCommitment: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        commitmentId: z.string().uuid(),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const current = await ctx.wiring.graphStore.listCommitments(
          input.organizationId,
          ctx.identity.id,
          input.personId,
          {
            limit: 1,
            offset: 0,
            includeArchived: true,
            commitmentId: input.commitmentId,
          },
        );
        const commitment = current.items[0];
        if (!commitment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Commitment not found" });
        }
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_commitment_mutation",
          operation: "archive",
          commitmentId: input.commitmentId,
          transitionEventId: ctx.run.ids.next(),
          personId: input.personId,
          sourceEventId: commitment.sourceEventId,
          values: {
            text: commitment.text,
            dueAt: commitment.dueAt?.toISOString() ?? null,
            status: "archived",
          },
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    introductions: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
        snapshotAt: z.string().datetime({ offset: true }).optional(),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const snapshotAt = input.snapshotAt ?? ctx.run.clock.nowISO();
        const page = await ctx.wiring.graphStore.listIntroductions(
          input.organizationId,
          ctx.identity.id,
          input.personId,
          {
            limit: input.limit,
            offset: input.offset,
            snapshotAt: new Date(snapshotAt),
          },
        );
        const items = await Promise.all(page.items.map(async (item) => {
          const counterpartId = item.sourcePersonId === input.personId
            ? item.targetPersonId
            : item.sourcePersonId;
          const counterpart = await ctx.wiring.graphStore.getPerson(
            input.organizationId,
            ctx.identity.id,
            counterpartId,
          );
          return {
            ...item,
            counterpart: counterpart
              ? { id: counterpart.id, displayName: counterpart.displayName }
              : null,
            occurredAt: item.occurredAt.toISOString(),
            createdAt: item.createdAt.toISOString(),
          };
        }));
        return {
          items,
          total: page.total,
          hasMore: input.offset + page.items.length < page.total,
          snapshotAt,
        };
      }),

    createIntroduction: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        sourcePersonId: z.string().uuid(),
        targetPersonId: z.string().uuid(),
      }).refine((input) => input.sourcePersonId !== input.targetPersonId, {
        message: "An Introduction requires two different People",
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const [sourcePerson, targetPerson] = await Promise.all([
          ctx.wiring.graphStore.getPerson(input.organizationId, ctx.identity.id, input.sourcePersonId),
          ctx.wiring.graphStore.getPerson(input.organizationId, ctx.identity.id, input.targetPersonId),
        ]);
        if (!sourcePerson?.isOwner || !targetPerson) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Introduction People not found" });
        }
        const introductionId = ctx.run.ids.next();
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_introduction_mutation",
          operation: "create",
          introductionId,
          transitionEventId: introductionId,
          sourcePersonId: input.sourcePersonId,
          targetPersonId: input.targetPersonId,
          values: {
            initiatorConsent: true,
            recipientConsent: false,
            status: "awaiting_consents",
          },
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    recordIntroductionConsent: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        introductionId: z.string().uuid(),
        party: z.enum(["initiator", "recipient"]),
        decision: z.enum(["consent", "decline"]),
        declineReason: z.string().trim().min(1).max(1_000).optional(),
      }).superRefine((input, refinementCtx) => {
        if (input.decision === "decline" && !input.declineReason) {
          refinementCtx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "A private decline reason is required",
            path: ["declineReason"],
          });
        }
        if (input.decision === "consent" && input.declineReason) {
          refinementCtx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "A decline reason is only valid for a decline",
            path: ["declineReason"],
          });
        }
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const page = await ctx.wiring.graphStore.listIntroductions(
          input.organizationId,
          ctx.identity.id,
          input.personId,
          { limit: 1, offset: 0, introductionId: input.introductionId },
        );
        const current = page.items[0];
        if (!current || ["declined", "cancelled", "introduced"].includes(current.status)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Introduction not actionable" });
        }
        const initiatorConsent = input.party === "initiator"
          ? input.decision === "consent"
          : current.initiatorConsent;
        const recipientConsent = input.party === "recipient"
          ? input.decision === "consent"
          : current.recipientConsent;
        const status = input.decision === "decline"
          ? "declined"
          : initiatorConsent && recipientConsent
            ? "ready"
            : "awaiting_consents";
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_introduction_mutation",
          operation: "consent",
          introductionId: current.id,
          transitionEventId: ctx.run.ids.next(),
          sourcePersonId: current.sourcePersonId,
          targetPersonId: current.targetPersonId,
          values: {
            initiatorConsent,
            recipientConsent,
            status,
            declineReason: input.declineReason ?? null,
          },
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    transitionIntroduction: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        introductionId: z.string().uuid(),
        transition: z.enum(["cancel", "complete"]),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const page = await ctx.wiring.graphStore.listIntroductions(
          input.organizationId,
          ctx.identity.id,
          input.personId,
          { limit: 1, offset: 0, introductionId: input.introductionId },
        );
        const current = page.items[0];
        if (
          !current ||
          ["declined", "cancelled", "introduced"].includes(current.status) ||
          (input.transition === "complete" && current.status !== "ready")
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Introduction not actionable" });
        }
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_introduction_mutation",
          operation: input.transition,
          introductionId: current.id,
          transitionEventId: ctx.run.ids.next(),
          sourcePersonId: current.sourcePersonId,
          targetPersonId: current.targetPersonId,
          values: {
            initiatorConsent: current.initiatorConsent,
            recipientConsent: current.recipientConsent,
            status: input.transition === "complete" ? "introduced" : "cancelled",
          },
        });
        return proposeRelationshipMutation(ctx, input.organizationId, payload);
      }),

    meetingPrep: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        personId: z.string().uuid(),
        limit: z.number().int().min(1).max(25).default(10),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Meeting preparation requires a Human user principal" });
        }
        const person = await ctx.wiring.graphStore.getPerson(
          input.organizationId,
          ctx.identity.id,
          input.personId,
        );
        if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
        const [timeline, memories, commitments, pendingCommitments] = await Promise.all([
          ctx.wiring.graphStore.listTimeline(
            input.organizationId,
            ctx.identity.id,
            "person",
            input.personId,
            { limit: input.limit },
          ),
          ctx.wiring.memoryStore.retrieve(
            { subjectRecordId: input.personId, limit: input.limit },
            { organizationId: input.organizationId, userId: ctx.identity.id },
          ),
          ctx.wiring.graphStore.listCommitments(
            input.organizationId,
            ctx.identity.id,
            input.personId,
            { limit: input.limit, offset: 0 },
          ),
          ctx.wiring.graphStore.listCommitments(
            input.organizationId,
            ctx.identity.id,
            input.personId,
            { limit: 5, offset: 0, status: "pending" },
          ),
        ]);
        return {
          person: {
            id: person.id,
            displayName: person.displayName,
            currentTitle: person.currentTitle,
          },
          generatedAt: ctx.run.clock.nowISO(),
          context: {
            memories,
            recentEvents: timeline.items.map((item) => ({
              ...item,
              occurredAt: item.occurredAt.toISOString(),
              createdAt: item.createdAt.toISOString(),
            })),
            commitments: commitments.items.map((item) => ({
              ...item,
              dueAt: item.dueAt?.toISOString() ?? null,
              occurredAt: item.occurredAt.toISOString(),
              createdAt: item.createdAt.toISOString(),
            })),
          },
          recommendedActions: pendingCommitments.items.map((item) => ({
            kind: "log_follow_up" as const,
            commitmentId: item.id,
            label: `Log follow-up: ${item.text}`,
          })),
        };
      }),

    timeline: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        recordType: z.enum(["person", "community"]),
        recordId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
        cursor: z.object({
          occurredAt: z.string().datetime(),
          id: z.string().uuid(),
        }).optional(),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const page = await ctx.wiring.graphStore.listTimeline(
          input.organizationId,
          ctx.identity.id,
          input.recordType,
          input.recordId,
          {
            limit: input.limit,
            ...(input.cursor
              ? {
                  cursor: {
                    occurredAt: new Date(input.cursor.occurredAt),
                    id: input.cursor.id,
                  },
                }
              : {}),
          },
        );
        return {
          items: page.items.map((item) => ({
            ...item,
            occurredAt: item.occurredAt.toISOString(),
            createdAt: item.createdAt.toISOString(),
          })),
          nextCursor: page.nextCursor
            ? {
                occurredAt: page.nextCursor.occurredAt.toISOString(),
                id: page.nextCursor.id,
              }
            : null,
          hasMore: page.nextCursor !== null,
        };
      }),

    /**
     * WhatsApp activity for one Relationship Record, for its Timeline (ADR-159).
     *
     * ── Why this is a SEPARATE procedure from `timeline` ─────────────────────
     * `timeline` reads cloud Events. This reads the LOCAL plane. They are not
     * merged server-side and the WhatsApp rows are never written into `events`,
     * because that would copy Local-Plane facts into cloud canonical storage —
     * the one thing the residency rule forbids. The join happens at RENDER time
     * in the client, which is what keeps the two planes separate on disk while
     * still giving the user one Timeline to read.
     *
     * ── What crosses the wire ────────────────────────────────────────────────
     * Activity FACTS only: counts, timestamps, direction. No message body, no
     * phone number, no identity key. Bodies stay in the WhatsApp Module's own
     * thread surface, which the client links to.
     *
     * ── The identity bridge, stated honestly ─────────────────────────────────
     * A cloud Person id and a Local Plane person id are different key spaces.
     * The only bridge that exists today is ID EQUALITY — the Google intake and
     * Capture paths mint one uuid and write it as both `people.id` and
     * `local_people.id`. This procedure relies on that same bridge and invents
     * no new one. A Person whose local row was created by the WhatsApp Contact
     * Extractor has NO cloud row at all, so their chats cannot appear on a
     * cloud Person page until an explicit promote exists. That is reported as
     * `linkage: "no_local_record"`, not disguised as "no activity".
     */
    whatsappTimeline: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid(),
          recordType: z.enum(["person", "community"]),
          recordId: z.string().uuid(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const organizationId = PILOT_ORGANIZATION;
        const localPlane = ctx.wiring.localPlane;

        // A WhatsApp group maps to a Community identity key, but the Local
        // Plane has no Community store and nothing stages WhatsApp groups as
        // Communities yet. Say so, rather than returning an empty list that
        // would read as "this Community has no WhatsApp activity".
        if (input.recordType === "community") {
          return { linkage: "community_unsupported" as const, entries: [] };
        }

        const people = await localPlane.graph.listPeople(organizationId);
        const local = people.find((person) => person.id === input.recordId);
        if (!local) return { linkage: "no_local_record" as const, entries: [] };
        if (!local.dedupeKey?.startsWith("whatsapp")) {
          // A local Person exists, but nothing has tied a WhatsApp identity to
          // them. Distinct from "no messages": there is no channel to read.
          return { linkage: "no_whatsapp_identity" as const, entries: [] };
        }

        const index = whatsAppPersonIndexFrom(
          people.flatMap((person) =>
            person.dedupeKey ? [{ personId: person.id, dedupeKey: person.dedupeKey }] : [],
          ),
        );
        const state = readWhatsAppSyncState(
          await localPlane.state.read(organizationId, WHATSAPP_SYNC_NAMESPACE),
        );
        const threads = whatsAppSyncedThreads(state);
        const mine = new Set(
          whatsAppChatsLinkedToPerson(
            input.recordId,
            threads.map((thread) => thread.chatId),
            index,
          ),
        );

        const entries = [];
        for (const thread of threads) {
          if (!mine.has(thread.chatId)) continue;
          const activity = await localPlane.graph.getThreadActivity(
            organizationId,
            WHATSAPP_SOURCE,
            thread.chatId,
          );
          entries.push({
            chatId: thread.chatId,
            // A label WhatsApp reported, never an identifier.
            ...(thread.name !== undefined ? { chatName: thread.name } : {}),
            messageCount: thread.messageCount,
            inboundCount: activity.inboundCount,
            outboundCount: activity.outboundCount,
            ...(activity.firstInboundAt ? { firstInboundAt: activity.firstInboundAt } : {}),
            ...(activity.lastInboundAt ? { lastInboundAt: activity.lastInboundAt } : {}),
            ...(activity.lastOutboundAt ? { lastOutboundAt: activity.lastOutboundAt } : {}),
            // Sort key for the merged Timeline: the most recent thing that
            // happened in this thread, whichever direction it went.
            occurredAt:
              [activity.lastInboundAt, activity.lastOutboundAt]
                .filter((at): at is string => Boolean(at))
                .sort()
                .at(-1) ?? null,
          });
        }
        entries.sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""));
        return { linkage: "linked" as const, entries };
      }),

    listSignals: authenticatedProcedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const { items, total } = await ctx.wiring.graphStore.listSignals(
          input.organizationId,
          ctx.identity.id,
          { limit: input.limit, offset: input.offset },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getSignalDetail: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), signalId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return ctx.wiring.graphStore.getSignalDetail(input.organizationId, ctx.identity.id, input.signalId);
      }),

    proposeSignalAction: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), signalId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const detail = await ctx.wiring.graphStore.getSignalDetail(input.organizationId, ctx.identity.id, input.signalId);
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found" });
        }
        if (
          !detail.sourceEvent ||
          !detail.participants.some(
            (participant) => participant.relationType === "participant" && participant.relationId,
          )
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "A governed Relationship Action requires an accessible participant Relation and source Event.",
          });
        }
        const proposal = await ctx.wiring.pipeline.propose(
          {
            organizationId: input.organizationId,
            actor: { type: ctx.identity.type, id: ctx.identity.id, plane: "local" },
            action: "write",
            resourceType: "signal",
            resourceId: detail.signal.id,
            inputs: {
              kind: "relationship_signal_action",
              signalId: detail.signal.id,
              sourceEventId: detail.sourceEvent.id,
              participantRefs: detail.participants.map((participant) => ({
                relationId: participant.relationId,
                recordType: participant.recordType,
                recordId: participant.recordId,
              })),
              recommendation: detail.signal.recommendedAction,
            },
            skill: "stageMutation",
            dataScope: "private",
            seed: detail.sourceEvent.id,
          },
          ctx.run,
        );
        if (proposal.status !== "rejected") {
          await ctx.wiring.graphStore.recordSignalAction({
            organizationId: input.organizationId,
            signalId: input.signalId,
            userId: ctx.identity.id,
            verb: "act",
          });
        }
        return proposal;
      }),

    recordSignalAction: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          signalId: z.string().uuid(),
          verb: z.enum(["act", "dismiss", "save"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const detail = await ctx.wiring.graphStore.getSignalDetail(input.organizationId, ctx.identity.id, input.signalId);
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found or not accessible" });
        }
        await ctx.wiring.graphStore.recordSignalAction({
          organizationId: input.organizationId,
          signalId: input.signalId,
          userId: ctx.identity.id,
          verb: input.verb,
        });
        return { ok: true };
      }),

    intakeReview: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const page = await ctx.wiring.pipeline.listPending(input.organizationId, {
          limit: input.limit,
          offset: input.offset,
          privateOwnerUserId: ctx.identity.id,
        });
        return {
          items: page.items.flatMap((proposal) => {
            const item = intakeReviewView(proposal);
            return item ? [item] : [];
          }),
          scanned: page.items.length,
          nextOffset:
            input.offset + page.items.length < page.total
              ? input.offset + page.items.length
              : null,
          hasMore: input.offset + page.items.length < page.total,
        };
      }),

    nodeTypeOwner: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid(), nodeType: relationshipNodeTypeEnum }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return ctx.wiring.graphStore.getNodeTypeOwner(input.nodeType);
      }),

    graph: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid(),
          limit: z.number().int().min(1).max(500).default(200),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const nodeLimit = Math.min(input.limit, 100);
        const [personPage, communityPage, relationPage] = await Promise.all([
          ctx.wiring.graphStore.listPeople(
            input.organizationId,
            ctx.identity.id,
            { limit: nodeLimit, offset: 0 },
          ),
          ctx.wiring.graphStore.listCommunities(
            input.organizationId,
            ctx.identity.id,
            { limit: nodeLimit, offset: 0 },
          ),
          ctx.wiring.graphStore.listGraphRelations(
            input.organizationId,
            ctx.identity.id,
            { limit: input.limit, nodeTypes: ["person", "community"] },
          ),
        ]);
        const personNodes = personPage.items.map((person) => ({
          id: `person:${person.id}`,
          recordId: person.id,
          label: person.displayName ?? "Unnamed Person",
          databaseId: "people",
          databaseLabel: "People",
          moduleId: "relationship",
          recordType: "person",
          subtitle: person.currentTitle ?? person.location ?? undefined,
          recordPath: `/module/relationship/people/${person.id}`,
          provenance: `Person · source ${person.source ?? "relationship"}`,
        }));
        const communityNodes = communityPage.items.map((community) => ({
          id: `community:${community.id}`,
          recordId: community.id,
          label: community.displayName ?? "Unnamed Community",
          databaseId: "communities",
          databaseLabel: "Communities",
          moduleId: "relationship",
          recordType: "community",
          subtitle: community.kind ?? community.location ?? undefined,
          recordPath: `/module/relationship/communities/${community.id}`,
          provenance: `Community · source ${community.source}`,
        }));
        const nodes = [...personNodes, ...communityNodes];
        const nodesById = new Map(nodes.map((node) => [node.id, node]));
        const visibleNodeIds = new Set(nodes.map((node) => node.id));
        const edges = relationPage.items.flatMap((relation) => {
          const sourceId = `${relation.srcType}:${relation.srcId}`;
          const targetId = `${relation.dstType}:${relation.dstId}`;
          if (!visibleNodeIds.has(sourceId) || !visibleNodeIds.has(targetId)) return [];
          const evidenceCount = relation.evidenceRefs.length;
          return [{
            id: relation.id,
            sourceId,
            targetId,
            label: relation.edgeType,
            relationType: relation.edgeType,
            sourceModule: relation.sourceModule,
            recordPath:
              nodesById.get(sourceId)?.recordPath ??
              nodesById.get(targetId)?.recordPath,
            evidence:
              `${evidenceCount} permitted evidence ${evidenceCount === 1 ? "reference" : "references"} · source ${relation.sourceModule}`,
          }];
        });
        return {
          nodes,
          edges,
          databases: [
            { id: "people", label: "People", moduleId: "relationship" },
            { id: "communities", label: "Communities", moduleId: "relationship" },
          ],
          hasMore:
            personPage.total > personPage.items.length ||
            communityPage.total > communityPage.items.length ||
            relationPage.hasMore ||
            edges.length < relationPage.items.length,
        };
      }),

    listRelations: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid(),
          nodeType: relationshipNodeTypeEnum,
          nodeId: z.string().uuid(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z
            .object({
              observedAt: z.string().datetime(),
              createdAt: z.string().datetime(),
              id: z.string().uuid(),
            })
            .optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const { items, total, nextCursor } = await ctx.wiring.graphStore.listRelations(
          input.organizationId,
          ctx.identity.id,
          { nodeType: input.nodeType, nodeId: input.nodeId },
          {
            limit: input.limit,
            ...(input.cursor
              ? {
                  cursor: {
                    observedAt: new Date(input.cursor.observedAt),
                    createdAt: new Date(input.cursor.createdAt),
                    id: input.cursor.id,
                  },
                }
              : {}),
          },
        );
        return {
          items,
          total,
          nextCursor: nextCursor
            ? {
                observedAt: nextCursor.observedAt.toISOString(),
                createdAt: nextCursor.createdAt.toISOString(),
                id: nextCursor.id,
              }
            : null,
          hasMore: nextCursor !== null,
        };
      }),

    findPaths: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        start: z.object({
          nodeType: z.enum(["person", "community"]),
          nodeId: z.string().uuid(),
        }),
        end: z.object({
          nodeType: z.enum(["person", "community"]),
          nodeId: z.string().uuid(),
        }),
        maxDepth: z.number().int().min(1).max(6).default(4),
        maxPaths: z.number().int().min(1).max(5).default(3),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const result = await ctx.wiring.graphStore.findRelationshipPaths(
          input.organizationId,
          ctx.identity.id,
          input.start,
          input.end,
          {
            maxDepth: input.maxDepth,
            maxPaths: input.maxPaths,
            maxVisited: 100,
            maxEdgesPerNode: 50,
          },
        );
        return {
          ...result,
          paths: result.paths.map((path) => ({
            ...path,
            steps: path.steps.map((step) => ({
              ...step,
              relation: {
                ...step.relation,
                observedAt: step.relation.observedAt.toISOString(),
                validFrom: step.relation.validFrom?.toISOString() ?? null,
                validTo: step.relation.validTo?.toISOString() ?? null,
                decisionAt: step.relation.decisionAt?.toISOString() ?? null,
                createdAt: step.relation.createdAt.toISOString(),
              },
            })),
          })),
        };
      }),

    communityOrganization: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        communityId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const community = await ctx.wiring.graphStore.getCommunity(
          input.organizationId,
          ctx.identity.id,
          input.communityId,
        );
        if (!community) throw new TRPCError({ code: "NOT_FOUND", message: "Community not found" });
        const [timeline, relationPage, signalPage, memberPage] = await Promise.all([
          ctx.wiring.graphStore.listTimeline(
            input.organizationId,
            ctx.identity.id,
            "community",
            input.communityId,
            { limit: input.limit },
          ),
          ctx.wiring.graphStore.listRelations(
            input.organizationId,
            ctx.identity.id,
            { nodeType: "community", nodeId: input.communityId },
            { limit: input.limit },
          ),
          ctx.wiring.graphStore.listSignals(
            input.organizationId,
            ctx.identity.id,
            {
              limit: input.limit,
              offset: 0,
              subjectType: "community",
              subjectId: input.communityId,
            },
          ),
          ctx.wiring.graphStore.listCommunityMembers(
            input.organizationId,
            ctx.identity.id,
            input.communityId,
            { limit: input.limit, offset: 0 },
          ),
        ]);
        const directlyRelatedPersonIds = relationPage.items.flatMap((relation) => {
          if (relation.srcType === "person" && relation.dstType === "community") {
            return [relation.srcId];
          }
          if (relation.dstType === "person" && relation.srcType === "community") {
            return [relation.dstId];
          }
          return [];
        });
        const timelinePeople = timeline.items.flatMap((item) =>
          item.participants
            .filter((participant) => participant.recordType === "person")
            .map((participant) => ({
              id: participant.recordId,
              displayName: participant.displayName,
              relationId: participant.relationId,
              source: "timeline" as const,
            })),
        );
        const directPeople = await Promise.all(
          [...new Set(directlyRelatedPersonIds)].map(async (personId) => {
            const person = await ctx.wiring.graphStore.getPerson(
              input.organizationId,
              ctx.identity.id,
              personId,
            );
            return person
              ? {
                  id: person.id,
                  displayName: person.displayName,
                  relationId: relationPage.items.find((relation) =>
                    relation.srcId === person.id || relation.dstId === person.id,
                  )?.id ?? null,
                  source: "relation" as const,
                }
              : null;
          }),
        );
        const people = [
          ...timelinePeople,
          ...directPeople.filter((person): person is NonNullable<typeof person> => person !== null),
          ...memberPage.items.map((person) => ({
            id: person.id,
            displayName: person.displayName,
            relationId: null,
            source: "membership" as const,
            role: person.role,
          })),
        ];
        return {
          community,
          people: [...new Map(people.map((person) => [person.id, person])).values()],
          events: timeline.items.map((item) => ({
            ...item,
            occurredAt: item.occurredAt.toISOString(),
            createdAt: item.createdAt.toISOString(),
          })),
          signals: signalPage.items.map((signal) => ({
            ...signal,
            createdAt: signal.createdAt.toISOString(),
          })),
          files: [],
          bounds: {
            relationTruncated: relationPage.nextCursor !== null,
            eventTruncated: timeline.nextCursor !== null,
            signalTruncated: signalPage.total > signalPage.items.length,
            memberTruncated: memberPage.total > memberPage.items.length,
          },
        };
      }),

    proposeSignalEvidence: authenticatedProcedure
      .input(relationshipSignalEvidenceInput)
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Relationship evidence proposals require a Human user principal",
          });
        }
        const detail = await ctx.wiring.graphStore.getSignalEvidenceAnchor(
          input.organizationId,
          ctx.identity.id,
          input.signalId,
          input.sourceEventId,
        );
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found or not accessible" });
        }
        const participantsAccessible =
          await ctx.wiring.graphStore.areRelationshipRecordsAccessible(
            input.organizationId,
            ctx.identity.id,
            input.participants,
          );
        if (!participantsAccessible) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "every participant must be an accessible Relationship Record",
          });
        }
        if (
          !input.participants.some(
            (participant) =>
              participant.recordType === detail.signal.subjectType &&
              participant.recordId === detail.signal.subjectId,
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Relationship evidence participants must include the Signal subject",
          });
        }

        const proposal = await ctx.wiring.pipeline.propose(
          {
            organizationId: input.organizationId,
            actor: { type: ctx.identity.type, id: ctx.identity.id, plane: "local" },
            action: "write",
            resourceType: "relation",
            inputs: {
              kind: "relationship_signal_evidence",
              signalId: input.signalId,
              sourceEventId: input.sourceEventId,
              visibility: input.visibility,
              userConfirmed: input.userConfirmed,
              participants: input.participants,
            },
            skill: "stageMutation",
            dataScope: "private",
            seed: input.sourceEventId,
          },
          ctx.run,
          { requireHumanReview: true },
        );
        return {
          proposal,
          materialization:
            proposal.status === "pending_review"
              ? { status: "pending_approval" as const }
              : { status: "rejected" as const },
        };
      }),

    materializationStatus: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid(), proposalId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const { ownerUserId } = await approvedRelationshipResolution(
          ctx,
          input.organizationId,
          input.proposalId,
        );
        const effect = await ctx.wiring.relationMaterializations.getByProposal(
          input.organizationId,
          ownerUserId,
          input.proposalId,
        );
        return effect ? relationshipEffectView(effect) : null;
      }),

    outstandingMaterializations: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.object({ id: z.string().uuid() }).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const { items, nextCursor } =
          await ctx.wiring.relationMaterializations.listOutstandingPage(
            input.organizationId,
            ctx.identity.id,
            {
              limit: input.limit,
              ...(input.cursor ? { cursor: input.cursor } : {}),
            },
          );
        return {
          items: items.map(relationshipEffectView),
          nextCursor,
          hasMore: nextCursor !== null,
        };
      }),

    retryMaterialization: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid(), proposalId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return retryApprovedRelationship(ctx, input.organizationId, input.proposalId);
      }),

    reconcileApproved: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid(), proposalId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return retryApprovedRelationship(ctx, input.organizationId, input.proposalId);
      }),

    helpdesk: t.router({
      public: t.router({
        createTicket: publicProcedure
          .input(
            z.object({
              organizationId: z.string().min(1),
              subject: z.string().trim().min(1).max(200),
              submitterEmail: z.string().trim().email().max(320),
              submitterName: z.string().trim().max(120).optional(),
              body: z.string().trim().min(1).max(10_000),
              operationId: z.string().uuid(),
              accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
            }),
          )
          .mutation(async ({ input, ctx }) => {
            assertPilotOrganization(input.organizationId);
            const { ticket, message } = await ctx.wiring.helpdeskStore.createTicket({
              organizationId: input.organizationId,
              subject: input.subject,
              submitterEmail: input.submitterEmail,
              body: input.body,
              operationId: input.operationId,
              accessToken: input.accessToken,
              ...(input.submitterName ? { submitterName: input.submitterName } : {}),
            });
            return { ticket, message };
          }),

        getThread: publicProcedure
          .input(z.object({ accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) }))
          .query(async ({ input, ctx }) => {
            const result = await ctx.wiring.helpdeskStore.getTicketByToken(input.accessToken);
            if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
            return result;
          }),

        reply: publicProcedure
          .input(
            z.object({
              accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
              body: z.string().trim().min(1).max(10_000),
              operationId: z.string().uuid(),
            }),
          )
          .mutation(async ({ input, ctx }) => {
            const message = await ctx.wiring.helpdeskStore.replyByToken(
              input.accessToken,
              input.body,
              input.operationId,
            );
            if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
            return message;
          }),
      }),

      list: authenticatedProcedure
        .input(paginatedInput)
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const { items, total } = await ctx.wiring.helpdeskStore.listTickets(input.organizationId, {
            limit: input.limit,
            offset: input.offset,
          });
          return { items, total, hasMore: input.offset + items.length < total };
        }),

      get: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), ticketId: z.string().uuid() }))
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const result = await ctx.wiring.helpdeskStore.getTicket(input.organizationId, input.ticketId);
          if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
          return result;
        }),

      reply: authenticatedProcedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            ticketId: z.string().uuid(),
            body: z.string().trim().min(1).max(10_000),
            status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const message = await ctx.wiring.helpdeskStore.replyAsAgent(
            input.organizationId,
            input.ticketId,
            ctx.identity.id,
            input.body,
            input.status,
          );
          if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
          return message;
        }),

      route: authenticatedProcedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            subject: z.string().min(1),
            body: z.string().default(""),
            /** WHO to consider — never their topics. Topics are derived
             * server-side from each candidate's own Person record (`skills`),
             * never accepted from the caller (a caller could otherwise stuff
             * arbitrary topics onto someone else's Person to steer routing). */
            candidatePersonIds: z
              .array(z.string().uuid())
              .max(500, "at most 500 candidate People may be routed")
              .optional(),
            limit: z.number().int().min(1).max(10).default(3),
          }),
        )
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const candidates = (
            await Promise.all(
              (input.candidatePersonIds ?? []).map(async (personId) => {
                const person = await ctx.wiring.graphStore.getPerson(
                  input.organizationId,
                  ctx.identity.id,
                  personId,
                );
                return person
                  ? {
                      personId: person.id,
                      displayName: person.displayName ?? "Unnamed person",
                      // Server-side topics ONLY — never caller-supplied. A
                      // Person with no skills contributes no topics (honest
                      // empty state, not a dummy stand-in).
                      topics: person.skills,
                    } satisfies HelpResponderCandidate
                  : null;
              }),
            )
          ).filter((candidate): candidate is HelpResponderCandidate => candidate !== null);
          return {
            routes: routeHelpRequest(
              { subject: input.subject, body: input.body },
              candidates,
              input.limit,
            ),
          };
        }),

      stageAnswer: authenticatedProcedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            subject: z.string().min(1),
            body: z.string().default(""),
            routedToPersonId: z.string().uuid(),
            candidateTopics: z.array(z.string().min(1)).max(50),
            draftBody: z.string().min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const routedPerson = await ctx.wiring.graphStore.getPerson(
            input.organizationId,
            ctx.identity.id,
            input.routedToPersonId,
          );
          if (!routedPerson) {
            throw new TRPCError({ code: "NOT_FOUND", message: "routed Person not found or not accessible" });
          }
          const [route] = routeHelpRequest(
            { subject: input.subject, body: input.body },
            [{
              personId: routedPerson.id,
              displayName: routedPerson.displayName ?? "Unnamed person",
              topics: input.candidateTopics,
            }],
            1,
          );
          if (!route) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "the selected Person no longer matches the supplied routing topics",
            });
          }
          const offer = draftHelpOffer(
            { subject: input.subject, body: input.body },
            route,
            input.draftBody,
          );
          const goalTaskRef = await provisionHelpRequestAnswerTask(ctx.wiring, input.organizationId);
          const proposal = await ctx.wiring.pipeline.propose(
            {
              organizationId: input.organizationId,
              actor: { type: "agent", id: LEARNING_AGENT },
              onBehalfOf: { type: "user", id: ctx.identity.id },
              action: "write",
              resourceType: "signal",
              resourceId: input.routedToPersonId,
              inputs: { ...offer },
              skill: "relationship.help-request.stage-offer",
              goalTaskRef,
            },
            ctx.run,
          );
          return { proposal, offer };
        }),
    }),
  }),

  /**
   * DealPilot — the first Module on the generic manifest intake seam.
   * `source` quarantines through the pipeline as `external:fetch` (audited, policy-gated);
   * `commit` is the human "Add" that materializes ONE quarantined capture into DealPilot's
   * facts + candidate list (capture ≠ commit). Thesis storage is basic get/set, in-memory
   * (wiring.ts) — no thesis-management UI yet, that's a separate future item.
   */
  dealpilot: t.router({
    module: dealpilotProcedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return dealPilotModuleManifest(ctx.wiring.dealpilot.bindings);
      }),

    records: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          page: z.enum(["deals", "sources", "theses"]),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return ctx.wiring.dealpilot.store.list(input.page, input.organizationId, {
          limit: input.limit,
          offset: input.offset,
        });
      }),

    /** Compatibility endpoint for callers migrating from the pre-DP0 candidate feed. */
    list: dealpilotProcedure
      .input(
        z
          .object({
            organizationId: z.string().min(1).optional(),
            limit: z.number().int().min(1).max(200).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .default({}),
      )
      .query(async ({ input, ctx }) => {
        if (input.organizationId) assertPilotOrganization(input.organizationId);
        const organizationId = input.organizationId ?? PILOT_ORGANIZATION;
        const records = await ctx.wiring.dealpilot.store.list("deals", organizationId, {
          limit: input.limit,
          offset: input.offset,
        });
        const items = await Promise.all(
          records.items.map(async (record) => {
            const profile = (await ctx.wiring.dealpilot.store.candidateProfile(organizationId, record.id)) ?? {
              name: record.kind === "deal" ? record.company : record.id,
            };
            return {
              id: record.id,
              profile,
              fit: scoreThesisFit(profile, { industries: [], geo: [] }),
            };
          }),
        );
        return { items, total: records.total, hasMore: records.hasMore };
      }),

    detail: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          kind: z.enum(["deal", "source", "thesis"]),
          id: z.string().min(1),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const detail = await ctx.wiring.dealpilot.store.detail(
          input.kind,
          input.organizationId,
          input.id,
          ctx.wiring.dealpilot.bindings,
        );
        if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: `${input.kind} Record not found` });
        if (detail.record.kind !== "source") return detail;
        // Credential metadata lives in the Local-Plane vault, which refuses reads in
        // public-cloud mode. Serve the Source Record itself in the cloud with no
        // credential projection; on the desktop keep the existing projection (which
        // itself reports per-field "unavailable" when there is no stored credential).
        const credentialProjection = ctx.wiring.publicCloudOnly
          ? null
          : await ctx.wiring.dealpilot.credentials.metadata(
              { organizationId: input.organizationId, sourceId: detail.record.id },
              detail.record.credentialRef,
            );
        return {
          ...detail,
          credentialProjection,
          credentialCleanupAvailable: Boolean(
            detail.record.credentialRef &&
              detail.record.credentialOwnerId === ctx.identity.id &&
              !ctx.wiring.publicCloudOnly,
          ),
        };
      }),

    createDeal: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          company: z.string().trim().min(1).max(300),
          revenue: z.number().nonnegative().optional(),
          ebitda: z.number().optional(),
          sde: z.number().optional(),
          askingPrice: z.number().nonnegative().optional(),
          rag: z.enum(["red", "yellow", "green"]).optional(),
          fitScore: z.number().int().min(0).max(100).optional(),
          evidenceScore: z.number().int().min(0).max(100).optional(),
          p0Flags: z.number().int().min(0).max(999).optional(),
          thesisTag: z.string().trim().max(120).optional(),
          sourceChannel: z.string().trim().max(120).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return ctx.wiring.dealpilot.store.createDeal({
          organizationId: input.organizationId,
          company: input.company,
          ...(input.revenue != null ? { revenue: input.revenue } : {}),
          ...(input.ebitda != null ? { ebitda: input.ebitda } : {}),
          ...(input.sde != null ? { sde: input.sde } : {}),
          ...(input.askingPrice != null ? { askingPrice: input.askingPrice } : {}),
          ...(input.rag != null ? { rag: input.rag } : {}),
          ...(input.fitScore != null ? { fitScore: input.fitScore } : {}),
          ...(input.evidenceScore != null ? { evidenceScore: input.evidenceScore } : {}),
          ...(input.p0Flags != null ? { p0Flags: input.p0Flags } : {}),
          ...(input.thesisTag != null ? { thesisTag: input.thesisTag } : {}),
          ...(input.sourceChannel != null ? { sourceChannel: input.sourceChannel } : {}),
        });
      }),

    createSource: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          name: z.string().trim().min(1).max(300),
          link: z.string().url(),
          connectionType: z.enum(["url", "email_alert", "api", "account"]),
          spendCap: z.number().nonnegative(),
          rightsAttested: z.boolean(),
          userId: z.string().max(500).optional(),
          password: z.string().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const sourceId = ctx.run.ids.next();
        const sourceInput = {
          id: sourceId,
          organizationId: input.organizationId,
          name: input.name,
          link: input.link,
          connectionType: input.connectionType,
          spendCap: input.spendCap,
          rightsState: input.rightsAttested ? "attested" as const : "unattested" as const,
          ...(input.rightsAttested ? { rightsAttestedBy: ctx.identity.id } : {}),
        };
        if (!input.userId && !input.password) {
          return ctx.wiring.dealpilot.store.createSource(sourceInput);
        }
        // A credential-bearing Source writes secret bytes to the Local-Plane
        // vault (ADR-151/AP-083 keep that desktop-only). Record-only Source
        // creation above is served in the cloud; entering a credential is not.
        if (ctx.wiring.publicCloudOnly) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Source credentials are entered on the Bridge desktop app (the Local Plane) and are not accepted by the public cloud API.",
          });
        }
        const scope = { organizationId: input.organizationId, sourceId };
        const credentialRef =
          ctx.wiring.dealpilot.credentialVault.reserve(scope);
        await ctx.wiring.dealpilot.store.prepareCredentialCreate({
          ...sourceInput,
          credentialOwnerId: ctx.identity.id,
          credentialRef,
        });
        try {
          await ctx.wiring.dealpilot.credentialVault.write(
            scope,
            credentialRef,
            {
              ...(input.userId ? { userId: input.userId } : {}),
              ...(input.password ? { password: input.password } : {}),
            },
          );
          return await ctx.wiring.dealpilot.store.completeCredentialCreate(
            input.organizationId,
            sourceId,
            credentialRef,
          );
        } catch (error) {
          const cleanupErrors: unknown[] = [];
          let credentialDeleted = false;
          try {
            await ctx.wiring.dealpilot.credentialVault.delete(
              scope,
              credentialRef,
            );
            credentialDeleted = true;
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
          if (credentialDeleted) {
            try {
              await ctx.wiring.dealpilot.store.discardCredentialCreate(
                input.organizationId,
                sourceId,
                credentialRef,
              );
            } catch (cleanupError) {
              cleanupErrors.push(cleanupError);
            }
          }
          if (cleanupErrors.length > 0) {
            throw new AggregateError(
              [error, ...cleanupErrors],
              "Source creation failed and its pending OS credential operation could not be reconciled",
            );
          }
          throw error;
        }
      }),

    createThesis: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          name: z.string().trim().min(1).max(300),
          focus: z.string().trim().min(1).max(1_000),
          targetCagr: z.number().optional(),
          criteria: z.array(z.string().trim().min(1)).default([]),
          exclusions: z.array(z.string().trim().min(1)).default([]),
          sourcingStrategy: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const thesis = await ctx.wiring.dealpilot.store.createThesis({
          organizationId: input.organizationId,
          name: input.name,
          focus: input.focus,
          criteria: input.criteria,
          exclusions: input.exclusions,
          ...(input.targetCagr != null ? { targetCagr: input.targetCagr } : {}),
          ...(input.sourcingStrategy ? { sourcingStrategy: input.sourcingStrategy } : {}),
        });
        const discoveryTask = await proposeThesisSourceDiscovery(
          ctx.wiring.dealpilot.store,
          input.organizationId,
          thesis.id,
        );
        const discovery = await ctx.wiring.pipeline.propose(
          {
            organizationId: input.organizationId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "read",
            resourceType: "module",
            skill: "stageMutation",
            inputs: discoveryTask,
            // Source-inventory discovery reads only Cloud-Plane Source Records; in
            // public-cloud mode the pipeline requires an explicit public data scope.
            ...(ctx.wiring.publicCloudOnly ? { dataScope: "public" as const } : {}),
          },
          ctx.run,
        );
        return { thesis, discovery };
      }),

    updateDeal: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          id: z.string().min(1),
          company: z.string().trim().min(1).max(300).optional(),
          stage: z
            .enum([
              "sourced",
              "triage",
              "engaged",
              "nda_cim",
              "diligence",
              "ic",
              "loi",
              "closing",
              "portfolio",
              "passed",
            ])
            .optional(),
          revenue: z.number().nonnegative().optional(),
          ebitda: z.number().optional(),
          sde: z.number().optional(),
          askingPrice: z.number().nonnegative().optional(),
          evidenceHealth: z.enum(["unknown", "partial", "supported", "contradicted"]).optional(),
          rag: z.enum(["red", "yellow", "green"]).optional(),
          fitScore: z.number().int().min(0).max(100).optional(),
          evidenceScore: z.number().int().min(0).max(100).optional(),
          p0Flags: z.number().int().min(0).max(999).optional(),
          thesisTag: z.string().trim().max(120).optional(),
          sourceChannel: z.string().trim().max(120).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return ctx.wiring.dealpilot.store.updateDeal(input.id, input.organizationId, {
          ...(input.company !== undefined ? { company: input.company } : {}),
          ...(input.stage !== undefined ? { stage: input.stage } : {}),
          ...(input.revenue !== undefined ? { revenue: input.revenue } : {}),
          ...(input.ebitda !== undefined ? { ebitda: input.ebitda } : {}),
          ...(input.sde !== undefined ? { sde: input.sde } : {}),
          ...(input.askingPrice !== undefined ? { askingPrice: input.askingPrice } : {}),
          ...(input.evidenceHealth !== undefined ? { evidenceHealth: input.evidenceHealth } : {}),
          ...(input.rag !== undefined ? { rag: input.rag } : {}),
          ...(input.fitScore !== undefined ? { fitScore: input.fitScore } : {}),
          ...(input.evidenceScore !== undefined ? { evidenceScore: input.evidenceScore } : {}),
          ...(input.p0Flags !== undefined ? { p0Flags: input.p0Flags } : {}),
          ...(input.thesisTag !== undefined ? { thesisTag: input.thesisTag } : {}),
          ...(input.sourceChannel !== undefined ? { sourceChannel: input.sourceChannel } : {}),
        });
      }),

    /** Edits non-secret Source Record fields. Source credentials are never
     * accepted here — they stay on the Local Plane (ADR-151/AP-083). */
    updateSource: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          id: z.string().min(1),
          name: z.string().trim().min(1).max(300).optional(),
          link: z.string().url().optional(),
          connectionType: z.enum(["url", "email_alert", "api", "account"]).optional(),
          spendCap: z.number().nonnegative().optional(),
          health: z.enum(["ready", "degraded", "paused"]).optional(),
          schedule: z.string().trim().max(500).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        // rightsState is deliberately NOT editable here: attesting data rights is a
        // governed act that must record rightsAttestedAt/By through its own flow, not
        // a generic table edit (attested rights gate Source discovery).
        return ctx.wiring.dealpilot.store.updateSource(input.id, input.organizationId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.link !== undefined ? { link: input.link } : {}),
          ...(input.connectionType !== undefined ? { connectionType: input.connectionType } : {}),
          ...(input.spendCap !== undefined ? { spendCap: input.spendCap } : {}),
          ...(input.health !== undefined ? { health: input.health } : {}),
          ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
        });
      }),

    discoverDeals: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          sourceId: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        let proposal;
        try {
          await ctx.wiring.dealpilot.validateSourceDiscovery(
            input.organizationId,
            input.sourceId,
          );
          const result = await ctx.wiring.automationExecutor.runById(
            {
              organizationId: input.organizationId,
              automationId: DEALPILOT_SOURCE_AUTOMATION_ID,
              onBehalfOf: { type: ctx.identity.type === "team" ? "team" : "user", id: ctx.identity.id },
              params: { organizationId: input.organizationId, sourceId: input.sourceId },
            },
            withHumanInputTaint(
              ctx.run,
              `dealpilot:discover:${ctx.identity.id}:${input.sourceId}`,
              input,
            ),
          );
          proposal = result.proposals[0];
          if (!proposal) throw new Error("DealPilot discovery Automation produced no proposal");
        } catch (error) {
          if (error instanceof SourceDiscoveryGateError) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
          }
          throw new TRPCError({
            code:
              error instanceof Error &&
              (error.message.includes("supports Deal discovery only") || error.message.includes("Source Record not found"))
                ? "PRECONDITION_FAILED"
                : "BAD_GATEWAY",
            message: error instanceof Error ? error.message : "Source connector failed",
          });
        }
        const output = proposal.output?.proposedOutput as {
          spend?: { estimated: number; actual: number; cap: number; exceeded: boolean };
        } | undefined;
        return {
          ...proposal,
          spend: output?.spend ?? { estimated: 0, actual: 0, cap: 0, exceeded: false },
        };
      }),

    captures: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          sourceId: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return ctx.wiring.dealpilot.store.listPendingCaptures(input.organizationId, {
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
          limit: input.limit,
          offset: input.offset,
        });
      }),

    commit: dealpilotProcedure
      .input(z.object({ organizationId: z.string().min(1), captureId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const captureStatus = await ctx.wiring.dealpilot.store.captureStatus(
          input.organizationId,
          input.captureId,
        );
        if (captureStatus === "committed") {
          return { committed: false, alreadyCommitted: true as const };
        }
        if (captureStatus === null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Quarantined capture not found" });
        }
        const capture = await ctx.wiring.dealpilot.store.getCapture(input.organizationId, input.captureId);
        if (!capture) throw new TRPCError({ code: "NOT_FOUND", message: "Quarantined capture not found" });
        const proposalId = stableDealPilotCaptureProposalId(
          input.organizationId,
          input.captureId,
        );
        const request = {
          organizationId: input.organizationId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "write" as const,
          resourceType: "module" as const,
          skill: "stageMutation",
          inputs: { kind: "dealpilot_capture_commit", captureId: input.captureId },
          taintLabel: labelAtSource("email_google_intake", {
            ref: `dealpilot:capture:${input.captureId}`,
            valueHash: hashTaintValue(capture.payload),
            sensitivity: "organization",
            instructionRisk: "data",
          }),
        };
        const materialize = async (proposal?: Proposal) => {
          const committed = await ctx.wiring.dealpilot.store.commitCapture(
            input.organizationId,
            input.captureId,
          );
          if (!committed.committed && committed.alreadyCommitted) {
            return { committed: false, alreadyCommitted: true as const };
          }
          if (!committed.committed) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Quarantined capture not found" });
          }
          return {
            committed: true,
            captureId: input.captureId,
            candidateId: committed.recordId,
            proposal:
              proposal ??
              ({
                id: proposalId,
                status: "applied",
                recovered: true,
              } as const),
          };
        };
        const recoverProposal = async () => {
          const existing = await ctx.wiring.ledger.get(proposalId);
          if (!existing) return null;
          if (!isDealPilotCaptureProposal(existing, input.organizationId, input.captureId)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "DealPilot capture proposal identity collides with a different ledger entry",
            });
          }
          const decision =
            existing.userDecision ??
            (await ctx.wiring.ledger.decisionFor(proposalId))?.userDecision ??
            null;
          if (decision === "auto" || decision === "approve" || decision === "edit") {
            return materialize();
          }
          return {
            committed: false,
            proposal: {
              id: proposalId,
              status: decision === "veto" ? "rejected" : "pending_review",
              recovered: true,
            } as const,
          };
        };

        const recovered = await recoverProposal();
        if (recovered) return recovered;
        let proposal: Proposal;
        try {
          proposal = await ctx.wiring.pipeline.propose(request, ctx.run, { proposalId });
        } catch (cause) {
          const winner = await recoverProposal();
          if (winner) return winner;
          throw cause;
        }
        if (proposal.status !== "applied") return { committed: false, proposal };
        return materialize(proposal);
      }),

    reauthenticateCredential: dealpilotProcedure
      .input(z.object({ organizationId: z.string().min(1), sourceId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const source = await ctx.wiring.dealpilot.store.get("source", input.organizationId, input.sourceId);
        if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Source Record not found" });
        if (source.kind !== "source" || source.credentialOwnerId !== ctx.identity.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Source credential access is not authorized" });
        }
        try {
          return ctx.wiring.dealpilot.credentials.reauthenticate({
            actorType: ctx.identity.type,
            actorId: ctx.identity.id,
            organizationId: input.organizationId,
            sourceId: input.sourceId,
            ...(ctx.reauthenticatedAt != null ? { reauthenticatedAt: ctx.reauthenticatedAt } : {}),
          });
        } catch (error) {
          if (error instanceof CredentialAccessError) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: error.message });
          }
          throw error;
        }
      }),

    accessCredential: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          sourceId: z.string().min(1),
          token: z.string().min(1),
          field: z.enum(["userId", "password"]),
          action: z.enum(["reveal", "copy"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const source = await ctx.wiring.dealpilot.store.get("source", input.organizationId, input.sourceId);
        if (!source || source.kind !== "source") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Source Record not found" });
        }
        if (source.credentialOwnerId !== ctx.identity.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Source credential access is not authorized" });
        }
        try {
          return await ctx.wiring.dealpilot.credentials.access({
            reference: source.credentialRef,
            organizationId: input.organizationId,
            sourceId: source.id,
            actorType: ctx.identity.type,
            actorId: ctx.identity.id,
            token: input.token,
            field: input.field,
            action: input.action,
          });
        } catch (error) {
          if (error instanceof CredentialAccessError) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: error.message });
          }
          throw error;
        }
      }),

    clearCredential: dealpilotProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          sourceId: z.string().min(1),
          token: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const source = await ctx.wiring.dealpilot.store.get(
          "source",
          input.organizationId,
          input.sourceId,
        );
        if (!source || source.kind !== "source") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Source Record not found" });
        }
        if (
          source.credentialOwnerId !== ctx.identity.id ||
          !source.credentialRef
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Source credential revocation is not authorized",
          });
        }
        try {
          const audit =
            ctx.wiring.dealpilot.credentials.authorizeCredentialRevocation({
            reference: source.credentialRef,
            organizationId: input.organizationId,
            sourceId: source.id,
            actorType: ctx.identity.type,
            actorId: ctx.identity.id,
            token: input.token,
          });
          await ctx.wiring.dealpilot.store.prepareCredentialRevocation(
            input.organizationId,
            source.id,
            ctx.identity.id,
            source.credentialRef,
            audit,
          );
          await ctx.wiring.dealpilot.credentialVault.delete(
            { organizationId: input.organizationId, sourceId: source.id },
            source.credentialRef,
          );
          const revocation =
            await ctx.wiring.dealpilot.store.completeCredentialRevocation(
              input.organizationId,
              source.id,
              ctx.identity.id,
              source.credentialRef,
            );
          return {
            revoked: true as const,
            cleared: revocation.cleared,
            credentialProjection:
              await ctx.wiring.dealpilot.credentials.metadata(
                { organizationId: input.organizationId, sourceId: source.id },
                revocation.source.credentialRef,
              ),
          };
        } catch (error) {
          if (error instanceof CredentialAccessError) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: error.message });
          }
          throw error;
        }
      }),
  }),

  /**
   * Integration management — connected providers and their USER-EDITABLE scopes.
   * Backed by the governed integration store on the LOCAL plane. Granting an
   * agent-floor DENY scope (external:send, network_graph:full) is refused here.
   */
  /**
   * Settings → API Keys. Model-provider API keys the user types are secrets, so
   * every procedure here obeys the same rules as DealPilot Source credentials
   * (ADR-181): a Human actor only, key bytes travel INBOUND only, and the store
   * behind them is the Local Plane credential vault. No procedure in this
   * router can return a key — `list` reports existence and age, and the raw
   * value is read exactly once by process wiring at boot.
   */
  modelProviderKey: t.router({
    /** Per-slot status: stored?, active in this process?, set via environment? */
    list: credentialSettingsProcedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return {
          /** Saving a key needs the desktop Local Plane; the cloud API refuses. */
          storageAvailable: !ctx.wiring.publicCloudOnly,
          providers: await ctx.wiring.modelProviderKeys.list(input.organizationId, {
            env: process.env,
            activeProviderIds: new Set(ctx.wiring.models.providers().keys()),
          }),
        };
      }),

    save: credentialSettingsProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          providerId: z.string().min(1),
          apiKey: z.string().trim().min(1).max(2_000),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const providerId = assertModelProviderKeyId(input.providerId);
        assertModelProviderKeyStorage(ctx.wiring);
        await ctx.wiring.modelProviderKeys.save(
          input.organizationId,
          providerId,
          input.apiKey,
        );
        // Deliberately returns no echo of the value, not even masked. The
        // provider is constructed from the vault at boot, so this response
        // states the honest activation requirement rather than implying the
        // key is already routing traffic (AP-021).
        return {
          providerId,
          stored: true,
          activation: ctx.wiring.models.providers().has(providerId)
            ? ("already_active" as const)
            : ("restart_required" as const),
        };
      }),

    clear: credentialSettingsProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          providerId: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const providerId = assertModelProviderKeyId(input.providerId);
        assertModelProviderKeyStorage(ctx.wiring);
        const removed = await ctx.wiring.modelProviderKeys.clear(
          input.organizationId,
          providerId,
        );
        return {
          providerId,
          removed,
          // Removing the stored key does not un-register a provider this
          // process already built from it.
          stillActive: ctx.wiring.models.providers().has(providerId),
        };
      }),
  }),

  integration: t.router({
    /** The platforms Bridge can connect, with their declared OAuth scopes. */
    providers: procedure.query(() =>
      listProviderIds().map((id) => ({ id, oauthScopes: oauthScopesFor(id) })),
    ),

    /**
     * Paginated (offset/limit): `store.list` returns the full connected-integrations
     * array with no store-level pagination support, so the router slices after the
     * fetch. Same shape as `dealpilot.list` (All fixes.md §3 P1 "No pagination on any
     * list surface").
     */
    list: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const all = await ctx.wiring.integrationStore.list(input.organizationId);
        const total = all.length;
        const items = all.slice(input.offset, input.offset + input.limit);
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    connect: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          provider: z.enum(["x", "instagram", "facebook", "linkedin"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return ctx.wiring.integrationStore.connect(
          input.organizationId,
          input.provider,
          oauthScopesFor(input.provider),
        );
      }),

    disconnect: procedure
      .input(z.object({ organizationId: z.string().min(1), integrationId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await ctx.wiring.integrationStore.disconnect(
          input.organizationId,
          input.integrationId,
        );
        return { ok: true };
      }),

    listScopes: procedure
      .input(z.object({ organizationId: z.string().min(1), integrationId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return ctx.wiring.integrationStore.listScopes(
          input.organizationId,
          input.integrationId,
        );
      }),

    grantScope: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          integrationId: z.string().uuid(),
          resourceType: z.string().min(1),
          action: actionEnum,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        try {
          return await ctx.wiring.integrationStore.grantScope({
            organizationId: input.organizationId,
            integrationId: input.integrationId,
            resourceType: input.resourceType,
            action: input.action,
          });
        } catch (err) {
          if (err instanceof IntegrationFloorScopeError) {
            // Agent-floor DENY: surfaced as always-approval, never a standing grant.
            throw new TRPCError({ code: "FORBIDDEN", message: err.message });
          }
          throw err;
        }
      }),

    revokeScope: procedure
      .input(z.object({ organizationId: z.string().min(1), permissionId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await ctx.wiring.integrationStore.revokeScope(
          input.organizationId,
          input.permissionId,
        );
        return { ok: true };
      }),
  }),

  /**
   * Organization + team-member management — plain authenticated CRUD (direct DB
   * writes), NOT a governed pipeline action. Creating a organization or inviting a
   * teammate doesn't have an external effect requiring approval, so this bypasses
   * pipeline.propose() and calls the store directly.
   */
  /**
   * Onboarding (ADR-033/R-030) — the server-side home for onboarding
   * personalization that used to live ONLY in browser localStorage
   * (avatar-store.ts). `verifyPhoneOtp` is an explicit, user-authorized DUMMY
   * flow (2026-07-08 ruling: "use dummy flow for now" — no real SMS provider
   * is wired) — it accepts any 6-digit code and is labeled as demo/test mode
   * in the client copy so it's never presented as a working integration.
   */
  /** K6 (TASK-050) — the morning brief: the day's commitments in three
   * buckets, pending suggestions, approvals nudges, recent capture activity,
   * and deterministic next actions — every section read live from the REAL
   * stores at call time (nothing is cached or fabricated; an empty section is
   * an honest empty state). The commitment buckets and approvals render
   * regardless of the learning flight (they are governed data the owner
   * already holds); only the learning-loop sections gate on it. */
  brief: t.router({
    morning: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid(),
          /** "Brief as of" — tests pin it for determinism; omitted = now. */
          snapshotAt: z.string().datetime({ offset: true }).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const now = input.snapshotAt ?? ctx.run.clock.nowISO();
        const nowDate = new Date(now);
        const sameLocalDay = (a: Date, b: Date) =>
          a.getFullYear() === b.getFullYear() &&
          a.getMonth() === b.getMonth() &&
          a.getDate() === b.getDate();

        const page = await ctx.wiring.graphStore.listCommitmentsForOwner(
          input.organizationId,
          ctx.identity.id,
          { limit: 100, offset: 0, status: "pending", snapshotAt: nowDate },
        );
        const personNames = new Map<string, string | null>();
        const personNameOf = async (personId: string): Promise<string | null> => {
          if (!personNames.has(personId)) {
            const person = await ctx.wiring.graphStore.getPerson(
              input.organizationId, ctx.identity.id, personId,
            );
            personNames.set(personId, person?.displayName ?? null);
          }
          return personNames.get(personId) ?? null;
        };
        type BriefCommitment = {
          id: string;
          personId: string;
          personName: string | null;
          text: string;
          dueAt: string | null;
          occurredAt: string;
        };
        const commitments: Record<"overdue" | "dueToday" | "upcoming", BriefCommitment[]> = {
          overdue: [], dueToday: [], upcoming: [],
        };
        for (const item of page.items) {
          // Due earlier today is still "due today" until midnight; only a
          // strictly-earlier calendar day is overdue. No due date = upcoming.
          const bucket = !item.dueAt
            ? "upcoming"
            : sameLocalDay(item.dueAt, nowDate)
              ? "dueToday"
              : item.dueAt.getTime() < nowDate.getTime()
                ? "overdue"
                : "upcoming";
          commitments[bucket].push({
            id: item.id,
            personId: item.personId,
            personName: await personNameOf(item.personId),
            text: item.text,
            dueAt: item.dueAt?.toISOString() ?? null,
            occurredAt: item.occurredAt.toISOString(),
          });
        }

        const learningEnabled = ctx.wiring.learningObservationEnabled;
        const scope = { organizationId: input.organizationId, userId: ctx.identity.id };
        const commitmentSuggestions = learningEnabled
          ? await listCommitmentSuggestions(ctx.wiring.memoryStore, scope, "proposed")
          : [];
        const learningSuggestions = learningEnabled
          ? await listLearningSuggestions(ctx.wiring.memoryStore, scope, undefined, "proposed")
          : [];
        const claimSuggestions = learningEnabled && ctx.wiring.claimSubstrateEnabled
          ? await listClaimSuggestions(ctx.wiring.memoryStore, scope, "proposed")
          : [];

        const pendingApprovals = await ctx.wiring.pipeline.listPending(input.organizationId, {
          limit: 5, offset: 0, privateOwnerUserId: ctx.identity.id,
        });
        const approvalNudges = pendingApprovals.items.map((item) => {
          const inputs = item.request.inputs;
          const display =
            typeof inputs === "object" && inputs !== null && !Array.isArray(inputs) &&
            typeof (inputs as Record<string, unknown>).display === "object" &&
            (inputs as Record<string, unknown>).display !== null
              ? ((inputs as Record<string, unknown>).display as Record<string, unknown>)
              : null;
          return {
            proposalId: item.id,
            resourceType: item.request.resourceType,
            resource: typeof display?.resource === "string" ? display.resource : null,
            createdAt: item.createdAt,
          };
        });

        // Recent capture activity: observed signals from the last 24 hours,
        // grouped by source module — the K1/K2/K5 lanes made visible.
        const signalRows = await ctx.wiring.memoryStore.retrieve({ limit: 200 }, scope);
        const cutoff = nowDate.getTime() - 24 * 60 * 60 * 1000;
        const activityByModule = new Map<string, { count: number; lastAt: string }>();
        for (const row of signalRows) {
          try {
            const value = JSON.parse(row.content) as {
              anchor?: { kind?: string; moduleId?: string };
              observedAt?: string | null;
            };
            if (value.anchor?.kind !== "observed_signal" || !value.anchor.moduleId) continue;
            const at = value.observedAt ?? row.createdAt;
            const atMs = new Date(at).getTime();
            if (Number.isNaN(atMs) || atMs <= cutoff || atMs > nowDate.getTime()) continue;
            const bucket = activityByModule.get(value.anchor.moduleId);
            if (!bucket) {
              activityByModule.set(value.anchor.moduleId, { count: 1, lastAt: at });
            } else {
              bucket.count += 1;
              if (at > bucket.lastAt) bucket.lastAt = at;
            }
          } catch {
            // not a signal row
          }
        }
        const recentActivity = [...activityByModule.entries()]
          .map(([moduleId, value]) => ({ moduleId, ...value }))
          .sort((a, b) => b.count - a.count);

        // Deterministic next actions — derivations of the sections above,
        // never model output.
        const nextActions: string[] = [];
        if (commitments.overdue.length > 0) {
          nextActions.push(`${commitments.overdue.length} commitment${commitments.overdue.length === 1 ? " is" : "s are"} overdue — complete or reschedule them.`);
        }
        if (commitments.dueToday.length > 0) {
          nextActions.push(`${commitments.dueToday.length} commitment${commitments.dueToday.length === 1 ? " is" : "s are"} due today.`);
        }
        if (commitmentSuggestions.length > 0) {
          nextActions.push(`${commitmentSuggestions.length} commitment suggestion${commitmentSuggestions.length === 1 ? " awaits" : "s await"} your review.`);
        }
        if (learningSuggestions.length + claimSuggestions.length > 0) {
          nextActions.push(`${learningSuggestions.length + claimSuggestions.length} learning suggestion${learningSuggestions.length + claimSuggestions.length === 1 ? " awaits" : "s await"} your review in Settings.`);
        }
        if (pendingApprovals.total > 0) {
          nextActions.push(`${pendingApprovals.total} proposal${pendingApprovals.total === 1 ? " awaits" : "s await"} your decision in Approvals.`);
        }

        return {
          generatedAt: now,
          learningEnabled,
          commitments,
          suggestions: {
            commitments: commitmentSuggestions,
            learning: learningSuggestions.length,
            claims: claimSuggestions.length,
          },
          approvals: { total: pendingApprovals.total, items: approvalNudges },
          recentActivity,
          nextActions,
        };
      }),
  }),

  /** TASK-032 — learning observation loop v1 behind the
   * `learningObservationEnabled` flight. Suggested-then-accepted is preserved
   * end to end: `digest` only proposes; only `suggestions.accept` (an explicit
   * Human mutation) mints a preference. All rows are the caller's private
   * Local-Plane Memories — authority scoping happens in the store. */
  learning: t.router({
    /** Always answerable (flight off included) so clients can honestly hide
     * the surface instead of rendering dead controls. */
    status: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return { enabled: ctx.wiring.learningObservationEnabled };
      }),

    /** K2 (TASK-046) — per-source capture consent. Bridge already HOLDS chat
     * threads and WhatsApp messages locally; emitting learning signals from
     * them is a NEW use, so it gets its own consent surface: default off,
     * per-source, with a kill switch that silences everything without
     * rewriting anyone's choices. Consent is a HUMAN decision — an agent or
     * team identity cannot flip these. */
    capture: t.router({
      /** Always answerable (flight off included), like `learning.status`,
       * so clients can honestly hide the toggles instead of rendering dead
       * controls. */
      status: procedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          const state = await readCaptureConsentState(ctx.wiring, input.organizationId);
          return {
            enabled: ctx.wiring.learningObservationEnabled,
            paused: state.paused,
            pausedChangedAt: state.pausedChangedAt,
            pausedChangedBy: state.pausedChangedBy,
            sources: state.sources,
          };
        }),

      setSource: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            source: z.enum(CAPTURE_SOURCES),
            enabled: z.boolean(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          if (ctx.identity.type !== "user") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Capture consent is a Human decision — only a user identity may change it",
            });
          }
          const changedBy = ctx.identity.id;
          const changedAt = new Date().toISOString();
          const state = await ctx.wiring.localPlane.state.update<CaptureConsentState>(
            input.organizationId,
            LEARNING_CAPTURE_CONSENT_NAMESPACE,
            null,
            (current) => {
              const next = withSourceConsent(
                readCaptureConsent(current),
                input.source,
                input.enabled,
                changedBy,
                changedAt,
              );
              return { state: next, result: next };
            },
          );
          return { paused: state.paused, sources: state.sources };
        }),

      setPaused: procedure
        .input(z.object({ organizationId: z.string().min(1), paused: z.boolean() }))
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          if (ctx.identity.type !== "user") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "The capture kill switch is a Human decision — only a user identity may change it",
            });
          }
          const changedBy = ctx.identity.id;
          const changedAt = new Date().toISOString();
          const state = await ctx.wiring.localPlane.state.update<CaptureConsentState>(
            input.organizationId,
            LEARNING_CAPTURE_CONSENT_NAMESPACE,
            null,
            (current) => {
              const next = withCapturePaused(readCaptureConsent(current), input.paused, changedBy, changedAt);
              return { state: next, result: next };
            },
          );
          return { paused: state.paused, sources: state.sources };
        }),
    }),

    /** K3 (TASK-047, ADR-215) — the knowledge substrate, minimal cut. One
     * substrate, two projections: these procedures are the write path and the
     * human read path over the same entities/claims rows the fusion graph
     * lane retrieves. Claims are born as suggestions (Memory lineage, exactly
     * like preferences) and become knowledge ONLY through Human acceptance,
     * which traverses the governed pipeline before the store materializes
     * anything. Red claim classes are structurally unproposable — the zod
     * enum mirrors the core's closed union, which does not contain them. */
    claims: t.router({
      /** Always answerable, like `learning.status`, so clients honestly hide
       * the surface instead of rendering dead controls. */
      status: procedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .query(({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          return { enabled: ctx.wiring.claimSubstrateEnabled };
        }),

      proposeClaim: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            entity: z.object({
              kind: z.enum(CLAIM_ENTITY_KINDS),
              name: z.string().min(1).max(200),
              refRecordId: z.string().uuid().optional(),
            }),
            field: z.string().min(1).max(80),
            value: z.string().min(1).max(400),
            claimClass: z.enum(PROPOSABLE_CLAIM_CLASSES),
            sensitivity: z.enum(TAINT_SENSITIVITY).default("private"),
            evidence: z
              .array(
                z.object({
                  kind: z.enum(["memory", "ledger"]),
                  id: z.string().min(1),
                  span: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).optional(),
                }),
              )
              .max(8)
              .default([]),
            validFrom: z.string().datetime().optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertClaimFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          assertHumanIdentity(ctx, "Proposing a claim");
          const claim: ClaimProposal = {
            entity: {
              kind: input.entity.kind,
              name: input.entity.name,
              refRecordId: input.entity.refRecordId ?? null,
            },
            field: input.field,
            value: input.value,
            claimClass: input.claimClass,
            sensitivity: input.sensitivity,
            evidence: input.evidence.map(({ kind, id, span }) => ({ kind, id, ...(span ? { span } : {}) })),
            ...(input.validFrom ? { validFrom: input.validFrom } : {}),
            taintLabel: labelAtSource("human_input", {
              ref: `claim:${input.entity.kind}:${input.entity.name}:${input.field}`,
              valueHash: hashTaintValue({ field: input.field, value: input.value }),
              sensitivity: input.sensitivity,
              instructionRisk: "data",
            }),
          };
          const suggestion = await proposeClaimSuggestion(ctx.wiring.memoryStore, {
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            claim,
            nextId: () => ctx.run.ids.next(),
            // The persistent adapter's lineage column is uuid-typed — same
            // mapping the preference digest uses (K0 regression class).
            lineageIdFor: deterministicUuid,
          });
          return suggestion
            ? { proposed: true as const, suggestion }
            : { proposed: false as const, reason: "This exact claim already has a pending, accepted, or rejected proposal." };
        }),

      suggestions: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            status: z.enum(["proposed", "accepted", "rejected"]).optional(),
          }),
        )
        .query(async ({ input, ctx }) => {
          assertClaimFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const scope = { organizationId: input.organizationId, userId: ctx.identity.id };
          return {
            suggestions: await listClaimSuggestions(
              ctx.wiring.memoryStore,
              scope,
              input.status,
            ),
          };
        }),

      /** Human acceptance — the ONLY path that writes the claims table, and
       * it traverses the governed pipeline first: reject there means no CAS
       * transition and no row (the "direct-write fails closed" clause of the
       * TASK-047 prototype test). Contradiction with a live same-(entity,
       * field) claim supersedes by lineage inside the store transaction. */
      acceptClaim: procedure
        .input(z.object({ organizationId: z.string().min(1), suggestionMemoryId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          assertClaimFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          assertHumanIdentity(ctx, "Accepting a claim");
          const scope = { organizationId: input.organizationId, userId: ctx.identity.id };
          const row = await ctx.wiring.memoryStore.get(input.suggestionMemoryId, scope);
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Claim suggestion not found" });
          const parsed = readClaimSuggestion(row);
          if (!parsed) throw new TRPCError({ code: "BAD_REQUEST", message: "Memory row is not a claim suggestion" });
          if (parsed.status !== "proposed") {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Claim suggestion is already ${parsed.status}` });
          }
          let proposal = await ctx.wiring.pipeline.propose(
            {
              organizationId: input.organizationId,
              actor: { type: ctx.identity.type, id: ctx.identity.id, plane: "local" },
              action: "write",
              resourceType: "claim",
              resourceId: input.suggestionMemoryId,
              inputs: {
                kind: "claim_materialize",
                suggestionMemoryId: input.suggestionMemoryId,
                entityKind: parsed.claim.entity.kind,
                entityName: parsed.claim.entity.name,
                field: parsed.claim.field,
                value: parsed.claim.value,
                claimClass: parsed.claim.claimClass,
                sensitivity: parsed.claim.sensitivity,
              },
              skill: "stageMutation",
              dataScope: "private",
              seed: input.suggestionMemoryId,
            },
            ctx.run,
          );
          // The Human clicking "accept" IS the review decision — record it as
          // one, on the ledger, where the K1 miner will read it back as
          // learning input (the spine feeding itself is the point).
          if (proposal.status === "pending_review") {
            proposal = await ctx.wiring.pipeline.decide(
              proposal.id,
              "approve",
              { type: ctx.identity.type, id: ctx.identity.id, plane: "local" },
              ctx.run,
              undefined,
              "Claim accepted by its owner",
            );
          }
          if (proposal.status !== "applied") {
            return { materialized: false as const, proposal: { id: proposal.id, status: proposal.status } };
          }
          const { claim } = await acceptClaimSuggestion(
            ctx.wiring.memoryStore, scope, input.suggestionMemoryId, ctx.identity.id,
            () => ctx.run.ids.next(),
          );
          const materialized = await ctx.wiring.claimStore.materializeClaim({
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            claim,
            decisionRef: proposal.id,
            createdBy: ctx.identity.id,
          });
          return {
            materialized: true as const,
            proposal: { id: proposal.id, status: proposal.status },
            claim: materialized.claim,
            supersededClaimId: materialized.supersededClaimId,
          };
        }),

      rejectClaim: procedure
        .input(z.object({ organizationId: z.string().min(1), suggestionMemoryId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          assertClaimFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          assertHumanIdentity(ctx, "Rejecting a claim");
          const scope = { organizationId: input.organizationId, userId: ctx.identity.id };
          const suggestion = await rejectClaimSuggestion(
            ctx.wiring.memoryStore, scope, input.suggestionMemoryId, ctx.identity.id,
            () => ctx.run.ids.next(),
          );
          return { suggestion };
        }),

      entities: procedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertClaimFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          return {
            entities: await ctx.wiring.claimStore.listEntities(input.organizationId, ctx.identity.id),
          };
        }),

      claims: procedure
        .input(z.object({ organizationId: z.string().min(1), entityId: z.string().uuid().optional() }))
        .query(async ({ input, ctx }) => {
          assertClaimFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          return {
            claims: await ctx.wiring.claimStore.liveClaims(
              input.organizationId, ctx.identity.id,
              input.entityId ? { entityId: input.entityId } : undefined,
            ),
          };
        }),

      /** Supersedence history for one (entity, field) — the Second Brain's
       * "what did Bridge used to believe, and when did that change" view. */
      claimHistory: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            entityId: z.string().uuid(),
            field: z.string().min(1).max(80),
          }),
        )
        .query(async ({ input, ctx }) => {
          assertClaimFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          return {
            history: await ctx.wiring.claimStore.claimHistory(
              input.organizationId, ctx.identity.id, input.entityId, input.field,
            ),
          };
        }),

      /** The user's forget path — the only true delete in the substrate. */
      forgetClaim: procedure
        .input(z.object({ organizationId: z.string().min(1), claimId: z.string().uuid() }))
        .mutation(async ({ input, ctx }) => {
          assertClaimFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          assertHumanIdentity(ctx, "Forgetting a claim");
          const forgotten = await ctx.wiring.claimStore.deleteClaim(
            input.organizationId, ctx.identity.id, input.claimId,
          );
          if (!forgotten) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
          return { forgotten: true as const };
        }),
    }),

    /** K6 (TASK-050) — commitment suggestions mined from the owner's own
     * prose. Suggested-then-accepted: detection (the chat send path) only
     * writes suggestion rows; ACCEPT here is the one path that materializes
     * a Commitment, and it does so through the SAME governed relationship
     * mutation `relationship.createCommitment` uses — the accept click is
     * the Human act the pipeline records. Person linkage is a HUMAN choice
     * at accept time (the detector's counterparty hint is a hint, never an
     * auto-link — the intake rule). */
    commitments: t.router({
      status: procedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .query(({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          return { enabled: ctx.wiring.learningObservationEnabled };
        }),

      suggestions: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            status: z.enum(["proposed", "accepted", "rejected"]).default("proposed"),
          }),
        )
        .query(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const suggestions = await listCommitmentSuggestions(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.status,
          );
          return { suggestions };
        }),

      accept: procedure
        .input(
          z.object({
            organizationId: z.string().uuid(),
            suggestionMemoryId: z.string().uuid(),
            personId: z.string().uuid(),
            /** Optional Human edits at accept time — the suggestion is a draft. */
            text: z.string().trim().min(1).max(2_000).optional(),
            dueAt: relationshipDateTimeSchema.nullable().optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          assertHumanIdentity(ctx, "Accepting a commitment suggestion");
          const person = await ctx.wiring.graphStore.getPerson(
            input.organizationId, ctx.identity.id, input.personId,
          );
          if (!person?.isOwner) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
          // Flip the lineage FIRST (idempotency guard: a second accept of the
          // same suggestion fails there instead of minting a second
          // Commitment), then materialize through the governed pipeline.
          const { candidate } = await acceptCommitmentSuggestion(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.suggestionMemoryId,
            ctx.identity.id,
            () => ctx.run.ids.next(),
          );
          const commitmentId = ctx.run.ids.next();
          const payload = relationshipMutationPayloadSchema.parse({
            kind: "relationship_commitment_mutation",
            operation: "create",
            commitmentId,
            transitionEventId: commitmentId,
            personId: input.personId,
            values: {
              text: input.text ?? candidate.text,
              dueAt: input.dueAt !== undefined ? input.dueAt : candidate.dueAt,
              status: "pending",
            },
          });
          const result = await proposeRelationshipMutation(ctx, input.organizationId, payload);
          return { commitmentId, candidate, ...result };
        }),

      reject: procedure
        .input(z.object({ organizationId: z.string().min(1), suggestionMemoryId: z.string().uuid() }))
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          assertHumanIdentity(ctx, "Rejecting a commitment suggestion");
          const suggestion = await rejectCommitmentSuggestion(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.suggestionMemoryId,
            ctx.identity.id,
            () => ctx.run.ids.next(),
          );
          return { suggestion };
        }),
    }),

    /** Batched mine-and-digest (AI Harness K1, ADR-212) — mines the governed
     * ledger for human decisions FIRST (the generic learning input that
     * replaced the deleted `recordDealDecision` per-module mapping), then
     * proposes suggestions. Never writes a preference. `moduleId` narrows the
     * digest to one Module; omitted, it fans out across every Module with
     * signals — a generic surface names no Module. */
    digest: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          moduleId: z.string().min(1).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertLearningFlightEnabled(ctx);
        assertPilotOrganization(input.organizationId);
        const ownerUserId = ctx.identity.id;
        const minedResult = await mineLedgerSignals(ctx.wiring.memoryStore, ctx.wiring.ledger, {
          organizationId: input.organizationId,
          ownerUserId,
          signalIdFor: ledgerSignalId,
        });
        const moduleIds = input.moduleId
          ? [input.moduleId]
          : [...new Set([
              ...minedResult.moduleIds,
              ...(await listSignalModuleIds(ctx.wiring.memoryStore, { organizationId: input.organizationId, userId: ownerUserId })),
            ])];
        const created: Awaited<ReturnType<typeof digestLearningSignals>> = [];
        for (const moduleId of moduleIds) {
          created.push(
            ...(await digestLearningSignals(ctx.wiring.memoryStore, {
              organizationId: input.organizationId,
              ownerUserId,
              moduleId,
              nextId: () => ctx.run.ids.next(),
              // The persistent adapter's subject_record_id column is uuid-typed;
              // same convention as the red-flag lineage keys.
              lineageIdFor: deterministicUuid,
            })),
          );
        }
        return {
          suggestions: created,
          mined: { signalCount: minedResult.mined.length, moduleIds },
        };
      }),

    suggestions: t.router({
      list: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            // K1: no per-module default — a generic surface omits this and
            // sees every Module's suggestions.
            moduleId: z.string().min(1).optional(),
            status: z.enum(["proposed", "accepted", "rejected"]).optional(),
          }),
        )
        .query(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const suggestions = await listLearningSuggestions(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.moduleId,
            input.status,
          );
          return { suggestions };
        }),

      accept: procedure
        .input(z.object({ organizationId: z.string().min(1), suggestionMemoryId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          try {
            const { suggestion, preference } = await acceptLearningSuggestion(
              ctx.wiring.memoryStore,
              { organizationId: input.organizationId, userId: ctx.identity.id },
              input.suggestionMemoryId,
              ctx.identity.id,
              () => ctx.run.ids.next(),
            );
            return { suggestionMemoryId: suggestion.id, preferenceMemoryId: preference.id };
          } catch (error) {
            throw learningActionError(error);
          }
        }),

      reject: procedure
        .input(z.object({ organizationId: z.string().min(1), suggestionMemoryId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          try {
            const rejected = await rejectLearningSuggestion(
              ctx.wiring.memoryStore,
              { organizationId: input.organizationId, userId: ctx.identity.id },
              input.suggestionMemoryId,
              ctx.identity.id,
              () => ctx.run.ids.next(),
            );
            return { suggestionMemoryId: rejected.id };
          } catch (error) {
            throw learningActionError(error);
          }
        }),
    }),

    preferences: t.router({
      list: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            // K1: no per-module default — omitted means every Module's
            // learned preferences (the same all-modules shape chat retrieves).
            moduleId: z.string().min(1).optional(),
          }),
        )
        .query(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const preferences = await retrieveLearnedPreferences(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.moduleId,
          );
          return { preferences };
        }),
    }),

    /** Commons capability archetypes (roadmap-v2 Phase 4). Contribution is
     * generalize-then-Human-publish: `preview` derives candidates locally
     * and sends NOTHING; only the explicit `contribute` mutation publishes,
     * and the payload is generalized fields only (screened source-side AND
     * by the Commons server's privacy gate). `seed` is the consume half —
     * archetypes become PROPOSED suggestions on the ordinary lineage
     * machinery (suggested-then-accepted holds; a rejection suppresses). */
    archetypes: t.router({
      preview: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            // K1: REQUIRED — an archetype generalizes a named Module's
            // preferences; the old silent "dealpilot" default was the
            // per-module mapping in disguise.
            moduleId: z.string().min(1),
          }),
        )
        .query(async ({ input, ctx }) => {
          assertArchetypesFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const preferences = await retrieveLearnedPreferences(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.moduleId,
          );
          return { candidates: generalizeLearnedPreferences(preferences, input.moduleId) };
        }),

      contribute: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            moduleId: z.string().min(1),
            /** Candidate names the Human approved for publishing. Empty is
             * NOT "publish everything" — contribution is per-archetype
             * explicit. */
            names: z.array(z.string().min(1)).min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertArchetypesFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const publishArchetype = ctx.wiring.commonsRegistry.publishArchetype?.bind(
            ctx.wiring.commonsRegistry,
          );
          if (!publishArchetype) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "the configured Commons deployment does not support archetypes",
            });
          }
          const preferences = await retrieveLearnedPreferences(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.moduleId,
          );
          const candidates = generalizeLearnedPreferences(preferences, input.moduleId);
          const requested = new Set(input.names);
          const selected = candidates.filter((candidate) => requested.has(candidate.name));
          if (selected.length === 0) {
            throw new TRPCError({ code: "NOT_FOUND", message: "no matching archetype candidates" });
          }
          const published: Array<{ name: string; contentHash: string }> = [];
          for (const candidate of selected) {
            try {
              published.push(await publishArchetype(candidate, { tags: [input.moduleId] }));
            } catch (error) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: error instanceof Error ? error.message : "archetype publish failed",
              });
            }
          }
          return { published };
        }),

      seed: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            moduleId: z.string().min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertArchetypesFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const listArchetypes = ctx.wiring.commonsRegistry.listArchetypes?.bind(
            ctx.wiring.commonsRegistry,
          );
          if (!listArchetypes) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "the configured Commons deployment does not support archetypes",
            });
          }
          const { archetypes } = await listArchetypes({ domain: input.moduleId });
          // Most-corroborated first: the annoyance cap should spend its
          // budget on patterns many organizations converged on. Ties break
          // by name for determinism.
          const ranked = [...archetypes].sort(
            (a, b) =>
              ((b.contributions ?? 1) - (a.contributions ?? 1)) ||
              (supportBandRank(b.archetype.supportBand) - supportBandRank(a.archetype.supportBand)) ||
              a.archetype.name.localeCompare(b.archetype.name),
          );
          const seeded = await seedSuggestionsFromArchetypes(ctx.wiring.memoryStore, {
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            moduleId: input.moduleId,
            archetypes: ranked.map((entry) => entry.archetype),
            nextId: () => ctx.run.ids.next(),
            lineageIdFor: deterministicUuid,
          });
          return { seeded };
        }),
    }),

    /** Promotion machinery (roadmap-v2 §Capability Evolution): heavily
     * repeated behavior → an Automation DRAFT. Suggested-then-accepted
     * throughout; an accepted draft is saved with status "draft", which the
     * registry's `load` never returns — the executor cannot start it.
     * Activation is a later explicit, governed step, not part of accept. */
    promotions: t.router({
      propose: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            // K1: no per-module default — omitted fans out across every
            // Module with recorded signals.
            moduleId: z.string().min(1).optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const scope = { organizationId: input.organizationId, userId: ctx.identity.id };
          const moduleIds = input.moduleId
            ? [input.moduleId]
            : await listSignalModuleIds(ctx.wiring.memoryStore, scope);
          const suggestions: Awaited<ReturnType<typeof detectAutomationDraftCandidates>> = [];
          for (const moduleId of moduleIds) {
            suggestions.push(
              ...(await detectAutomationDraftCandidates(ctx.wiring.memoryStore, {
                organizationId: input.organizationId,
                ownerUserId: ctx.identity.id,
                moduleId,
                nextId: () => ctx.run.ids.next(),
                lineageIdFor: deterministicUuid,
              })),
            );
          }
          return { suggestions };
        }),

      list: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            // K1: no per-module default — omitted lists every Module's.
            moduleId: z.string().min(1).optional(),
            status: z.enum(["proposed", "accepted", "rejected"]).optional(),
          }),
        )
        .query(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const suggestions = await listPromotionSuggestions(
            ctx.wiring.memoryStore,
            { organizationId: input.organizationId, userId: ctx.identity.id },
            input.moduleId,
            input.status,
          );
          return { suggestions };
        }),

      accept: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            suggestionMemoryId: z.string().min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          try {
            const { suggestion, draft } = await acceptAutomationDraft(
              ctx.wiring.memoryStore,
              { organizationId: input.organizationId, userId: ctx.identity.id },
              input.suggestionMemoryId,
              ctx.identity.id,
              () => ctx.run.ids.next(),
            );
            // Deterministic id: the same accepted pattern always names the
            // same draft row (re-derivable on any instance).
            const automationId = deterministicUuid(
              `learning:promotion:automation:${input.organizationId}:${draft.moduleId}:${draft.pattern.action}:${draft.pattern.attributeKey}=${draft.pattern.attributeValue}`,
            );
            await ctx.wiring.automationRegistry.save({
              id: automationId,
              organizationId: input.organizationId,
              name: draft.name,
              agentId: LEARNING_AGENT,
              agentPlane: "local",
              steps: draft.steps,
              status: "draft",
            });
            return {
              suggestionMemoryId: suggestion.id,
              automationId,
              status: "draft" as const,
              name: draft.name,
              description: draft.description,
            };
          } catch (error) {
            throw learningActionError(error);
          }
        }),

      reject: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            suggestionMemoryId: z.string().min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertLearningFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          try {
            const rejected = await rejectAutomationDraft(
              ctx.wiring.memoryStore,
              { organizationId: input.organizationId, userId: ctx.identity.id },
              input.suggestionMemoryId,
              ctx.identity.id,
              () => ctx.run.ids.next(),
            );
            return { suggestionMemoryId: rejected.id };
          } catch (error) {
            throw learningActionError(error);
          }
        }),

      /** Draft review + activation (ADR-172 follow-up). Drafts are read
       * through `listByStatus` — never `load`, which stays active-only so
       * the executor's seam cannot see one. Activation is the governed
       * step that makes a draft runnable: Human-explicit (this mutation),
       * statically validated (non-empty canonical steps, every skill
       * registered), and everything DEEPER — agent allow-list, taint,
       * approvals — still binds at run time through the same pipeline
       * gates every Automation goes through. Fabricated steps stay
       * impossible: an empty draft simply cannot activate. */
      drafts: t.router({
        list: procedure
          .input(z.object({ organizationId: z.string().min(1) }))
          .query(async ({ input, ctx }) => {
            assertLearningFlightEnabled(ctx);
            assertPilotOrganization(input.organizationId);
            const drafts = await ctx.wiring.automationRegistry.listByStatus(input.organizationId, "draft");
            return { drafts };
          }),

        update: procedure
          .input(
            z.object({
              organizationId: z.string().min(1),
              automationId: z.string().min(1),
              /** Canonical step shapes — validated by the SAME
               * parseAutomationSteps every registry write goes through. */
              steps: z.array(z.record(z.unknown())).min(1),
            }),
          )
          .mutation(async ({ input, ctx }) => {
            assertLearningFlightEnabled(ctx);
            assertPilotOrganization(input.organizationId);
            const drafts = await ctx.wiring.automationRegistry.listByStatus(input.organizationId, "draft");
            const draft = drafts.find((definition) => definition.id === input.automationId);
            if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "draft not found" });
            let steps;
            try {
              steps = parseAutomationSteps(input.steps);
            } catch (error) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: error instanceof Error ? error.message : "invalid steps",
              });
            }
            for (const step of steps) {
              if (!ctx.wiring.skillRegistry.get(step.skill)) {
                throw new TRPCError({ code: "BAD_REQUEST", message: `unknown skill "${step.skill}"` });
              }
            }
            await ctx.wiring.automationRegistry.save({ ...draft, steps, status: "draft" });
            return { automationId: draft.id, steps: steps.length, status: "draft" as const };
          }),

        activate: procedure
          .input(
            z.object({
              organizationId: z.string().min(1),
              automationId: z.string().min(1),
            }),
          )
          .mutation(async ({ input, ctx }) => {
            assertLearningFlightEnabled(ctx);
            assertPilotOrganization(input.organizationId);
            const drafts = await ctx.wiring.automationRegistry.listByStatus(input.organizationId, "draft");
            const draft = drafts.find((definition) => definition.id === input.automationId);
            if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "draft not found" });
            if (draft.steps.length === 0) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "a draft with no steps cannot activate — give it real governed steps first",
              });
            }
            for (const step of draft.steps) {
              if (!ctx.wiring.skillRegistry.get(step.skill)) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: `draft step targets unregistered skill "${step.skill}"`,
                });
              }
            }
            await ctx.wiring.automationRegistry.save({ ...draft, status: "active" });
            return { automationId: draft.id, status: "active" as const };
          }),
      }),
    }),

    /** Retrieval quality read surface (ADR-174). `status` always answers so
     * clients hide the card honestly while the fusion flight is off; `evals`
     * serves recent scheduled runs WITH the honest metric label — these are
     * self-retrieval consistency numbers, never presented as human-judged
     * relevance. */
    retrieval: t.router({
      status: procedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .query(({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          return { enabled: ctx.wiring.retrievalFusionEnabled };
        }),

      evals: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            limit: z.number().int().min(1).max(50).default(10),
          }),
        )
        .query(async ({ input, ctx }) => {
          assertRetrievalFlightEnabled(ctx);
          assertPilotOrganization(input.organizationId);
          const { items, total } = await ctx.wiring.evalStore.listRuns(RETRIEVAL_EVAL_CAPABILITY_ID, {
            limit: input.limit,
            offset: 0,
          });
          return {
            metric: RETRIEVAL_EVAL_METRIC,
            metricNote: RETRIEVAL_EVAL_METRIC_NOTE,
            total,
            // Store order is oldest-first; the card wants newest-first.
            runs: [...items].reverse().map((run) => ({
              runId: run.id,
              startedAt: run.started_at,
              datasetId: run.dataset_id,
              embeddingModel: run.capability_version,
              cases: run.perCase.length,
              recallAtK: run.aggregate.route_r ?? 0,
              precisionAtK: run.aggregate.route_p ?? 0,
              mrr: run.aggregate.success ?? 0,
            })),
          };
        }),
    }),
  }),

  onboarding: t.router({
    getProfile: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return { profile: await ctx.wiring.onboardingProfileStore.get(input.organizationId) };
      }),

    saveProfile: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          avatarStyle: z.string().min(1),
          // Whitelisted onboarding answer keys. E3 (2026-08-05) trimmed the
          // USER-FACING question set to the five documented manual questions
          // and added `workday` / `work_context` / `work_lives`; the older keys
          // stay accepted because saved profiles still carry them and an
          // explicit answer still overrides the derived value.
          answers: z.object({
            profession: z.string().optional(),
            avatar_style: z.string().optional(),
            workday: z.array(z.string()).optional(),
            work_context: z.string().optional(),
            work_lives: z.array(z.string()).optional(),
            role_model: z.string().optional(),
            role_model_why: z.string().optional(),
            domain: z.string().optional(),
            watch_first: z.array(z.string()).optional(),
            vocab_name: z.string().optional(),
            view_style: z.string().optional(),
            organization_name: z.string().optional(),
          }).strict().default({}),
          // SEC-7: `linkedin` was removed from this trust-bearing enum. There is no
          // real LinkedIn OAuth proof wired, so accepting a client-asserted
          // `verificationMethod:"linkedin"` would let the browser fabricate a
          // verification/trust signal. Only `phone` (the explicitly-dummy OTP flow
          // below) is accepted until a real OAuth proof exists.
          verificationMethod: z.enum(["phone"]).nullable().default(null),
          connectedSourceIds: z.array(z.string()).default([]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const existing = await ctx.wiring.onboardingProfileStore.get(input.organizationId);
        const row = {
          organizationId: input.organizationId,
          avatarStyle: input.avatarStyle,
          answers: { ...input.answers, avatar_style: input.avatarStyle },
          phoneVerified: (input.verificationMethod === "phone" && consumePhoneOtpProof(ctx.identity.id))
            ? true
            : (existing?.phoneVerified ?? false),
          verificationMethod: input.verificationMethod ?? existing?.verificationMethod ?? null,
          connectedSourceIds: input.connectedSourceIds,
          updatedAtISO: new Date().toISOString(),
        };
        await ctx.wiring.onboardingProfileStore.save(row);
        const existingMemories = await ctx.wiring.memoryStore.retrieve(
          { limit: 100 },
          { organizationId: input.organizationId, userId: ctx.wiring.pilotUserId },
        );
        if (!existingMemories.some((memory) => parseLearningMemory(memory.content)?.kind === "reflection_schedule")) {
          await ctx.wiring.memoryStore.write({
            id: uuidv7(),
            organizationId: input.organizationId,
            type: "procedural",
            scope: "private",
            content: JSON.stringify({
              kind: "reflection_schedule",
              dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
              status: "scheduled",
            }),
            confidence: 1,
            trustOrigin: "operator",
            plane: "local",
            createdBy: "learning",
            ownerUserId: ctx.wiring.pilotUserId,
          });
        }
        return { profile: row };
      }),

    /** TASK-010 review round-5 item 1 — this legacy onboarding surface must
     * NEVER leak `red_flag`/`preference_adjustment` content: it now (a)
     * requires authentication + organization membership (was a bare
     * `procedure`, which only gates MUTATIONS, leaving this QUERY reachable
     * unauthenticated), (b) is owner-scoped to the REAL caller
     * (`ctx.identity.id`), never the shared `pilotUserId` constant, and (c)
     * whitelists the returned `kind`s to ONLY the three this surface has
     * ever displayed (`onboarding_preference`/`reflection_schedule`/
     * `trust_capture` — confirmed against SettingsPage.tsx's own
     * `LearningSection`, which never reads anything else from this query) —
     * a red-flag correction or its synthesized preference adjustment must
     * only ever be read through the owner-scoped `redFlag.*` surface. */
    learningState: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const rows = await ctx.wiring.memoryStore.retrieve(
            { limit: 100 },
            { organizationId: input.organizationId, userId: ctx.identity.id },
          );
          return {
            memories: rows
              .map((row) => ({ row, value: parseLearningMemory(row.content) }))
              .filter((item): item is typeof item & { value: LegacyOnboardingMemoryContent } => isLegacyOnboardingContent(item.value)),
          };
        }),

    recordTrustCapture: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          appName: z.string().trim().min(1).max(200),
          bundleId: z.string().trim().min(1).max(300).optional(),
          capturedAt: z.string().datetime(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const memory = await ctx.wiring.memoryStore.write({
          id: uuidv7(),
          organizationId: input.organizationId,
          type: "episodic",
          scope: "private",
          content: JSON.stringify({
            kind: "trust_capture",
            appName: input.appName,
            ...(input.bundleId ? { bundleId: input.bundleId } : {}),
            capturedAt: input.capturedAt,
          }),
          confidence: 1,
          trustOrigin: "untrusted_external",
          plane: "local",
          createdBy: "desktop:apps",
          ownerUserId: ctx.wiring.pilotUserId,
        });
        return { memory };
      }),

    recommendFromRoleModel: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            figure: z.string().trim().min(2).max(120),
            admiredFor: z.string().trim().min(2).max(500),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          return proposeRoleModelRecommendation(
            ctx.wiring,
            ctx.run,
            ctx.identity.id,
            input,
          );
        }),

    correctMemory: procedure
        .input(z.object({ organizationId: z.string().min(1), memoryId: z.string().uuid(), content: z.string().trim().min(1).max(500) }))
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          const auth = { organizationId: input.organizationId, userId: ctx.wiring.pilotUserId };
          const current = await ctx.wiring.memoryStore.get(input.memoryId, auth);
          const value = current && parseLearningMemory(current.content);
          if (!current || value?.kind !== "onboarding_preference") throw new TRPCError({ code: "NOT_FOUND" });
          return ctx.wiring.memoryStore.supersede(input.memoryId, {
            ...current,
            id: uuidv7(),
            content: JSON.stringify({ ...value, admiredFor: input.content }),
            trustOrigin: "user_content",
            createdBy: ctx.identity.id,
          });
        }),

    /** TASK-010 review round-5 item 1 — owner-scoped + kind-whitelisted, the
     * same rationale as `learningState` above: this generic delete must
     * REJECT a `red_flag`/`preference_adjustment` Memory id outright (not
     * silently no-op) so all correction deletion is forced through
     * `redFlag.forget`, which withdraws/revokes the linked governed
     * proposal BEFORE deleting — a bare `memoryStore.forget` here would
     * delete the evidence while leaving an approvable/appliable proposal
     * referencing nothing. */
    forgetMemory: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), memoryId: z.string().uuid() }))
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const auth = { organizationId: input.organizationId, userId: ctx.identity.id };
          const current = await ctx.wiring.memoryStore.get(input.memoryId, auth);
          const value = current && parseLearningMemory(current.content);
          if (current && (isRedFlagContent(value) || isPreferenceAdjustmentContent(value))) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Red-flag corrections must be deleted via redFlag.forget, which withdraws their governed proposal first",
            });
          }
          return {
            forgotten: await ctx.wiring.memoryStore.forget(input.memoryId, auth),
          };
        }),

    setReflection: procedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            memoryId: z.string().uuid(),
            action: z.enum(["snooze", "pause", "resume", "skip"]),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          const auth = { organizationId: input.organizationId, userId: ctx.wiring.pilotUserId };
          const current = await ctx.wiring.memoryStore.get(input.memoryId, auth);
          const value = current && parseLearningMemory(current.content);
          if (!current || value?.kind !== "reflection_schedule") throw new TRPCError({ code: "NOT_FOUND" });
          const status = input.action === "resume" ? "scheduled" : input.action === "snooze" ? "snoozed" : input.action === "pause" ? "paused" : "skipped";
          const dueAt = input.action === "snooze"
            ? new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
            : input.action === "resume"
              ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString()
              : value.dueAt;
          return ctx.wiring.memoryStore.supersede(input.memoryId, {
            ...current,
            id: uuidv7(),
            content: JSON.stringify({ ...value, dueAt, status }),
            trustOrigin: "user_content",
            createdBy: ctx.identity.id,
          });
        }),

    /** DUMMY — see router-level doc comment above. Any 6-digit code passes. */
    verifyPhoneOtp: procedure
      .input(z.object({ phone: z.string().min(3), code: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const verified = /^\d{6}$/.test(input.code.trim());
        if (verified) phoneOtpProofs.set(ctx.identity.id, Date.now() + 600_000);
        return {
          verified,
          dummy: true as const,
          verificationSource: "dummy" as const,
          message: verified
            ? "Demo verification passed — no SMS was actually sent."
            : "Enter any 6-digit code (demo mode — no real SMS is sent).",
        };
      }),
  }),

  /**
   * TASK-010 — platform red-flag correction feedback (docs/raw/ui-
   * architecture-rules-2026-07.md §5d, docs/glossary.md "Red Flag"). One
   * platform-wide feedback primitive, separate from onboarding's learning
   * controls above even though it reuses the exact same MemoryStore
   * mechanism — a Red Flag targets ANY eligible data cell or rendered
   * bullet across Modules, not onboarding-specific state.
   *
   * Every procedure here is `authenticatedProcedure` + `assertMembership` —
   * review remediation item 1: a red flag is always `scope: "private"`, so
   * its owner MUST be the real caller (`ctx.identity.id`), never the
   * pilot/demo constant. `get()`'s own authority-scoped visibility predicate
   * (private → owner-only) is the PRIMARY defense — passing `ctx.identity.id`
   * as the auth-scope `userId` everywhere means a non-owner's `get()` already
   * returns `null` (indistinguishable from "doesn't exist," avoiding an IDOR
   * existence oracle) — and every mutation ALSO explicitly re-asserts
   * `ownerUserId === ctx.identity.id` and the parsed `kind === "red_flag"`
   * before acting, so `forget`/`clear`/`reopen`/`updateReason` can never be
   * pointed at an arbitrary Memory id belonging to someone else or to an
   * unrelated Memory kind.
   *
   * `create` writes the Human's own correction directly via `memoryStore`
   * (never routed through `pipeline.propose`, per TASK-007's TASK-010
   * handoff §1) and ALSO starts the separate, governed learning step in the
   * same request (§2 of that handoff): a `pipeline.propose` call, actor
   * `LEARNING_AGENT`, resolved through a real Goal/Task assignment, that
   * stages a reviewable (never auto-applied) preference-adjustment
   * proposal citing the flag as evidence — but see the PRIVACY note on
   * `create` below (review item 2): the ledger entry itself never carries
   * the flag's private detail.
   */
  redFlag: t.router({
    /**
     * review item 3 (saga/idempotency): `operationId` is a client-generated
     * UUID reused across retries of the SAME logical flagging action.
     * Every id this handler creates (the Memory, the governed Task, the
     * ledger proposal) is DERIVED deterministically from it, so a retried
     * call converges onto the same rows instead of duplicating them. The
     * Human's correction Memory (step 1) and the governed learning attempt
     * (step 2) are tracked as separate idempotent steps: if step 1
     * previously succeeded but step 2 previously failed/never ran
     * (`learningStatus` still `"none"`), a retry RESUMES at step 2 rather
     * than silently reporting stale state — "Memory is Human truth and may
     * survive learning failure," but the learning attempt itself is
     * retryable evidence-bearing state, not silently dropped.
     */
    create: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          operationId: z.string().uuid(),
          anchor: redFlagAnchorInput,
          renderedValue: z.string().max(2000),
          renderedVersion: z.string().max(200).optional(),
          reason: z.string().trim().max(500).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const authScope = { organizationId: input.organizationId, userId: ownerId };
        await validateAnchorTarget(ctx.wiring, input.organizationId, ownerId, input.anchor);
        const anchorKey = anchorLineageKey(input.anchor);
        const memoryId = deterministicUuid(`redflag-memory:${ownerId}:${input.operationId}`);

        // Step 1 (idempotent): the Human's own correction. Never routed
        // through the Agent/Skill pipeline.
        let flagged = await ctx.wiring.memoryStore.get(memoryId, authScope);
        if (flagged) {
          const existingValue = parseLearningMemory(flagged.content);
          if (
            !isRedFlagContent(existingValue) ||
            canonicalAnchorString(existingValue.anchor) !== canonicalAnchorString(input.anchor) ||
            existingValue.renderedValue !== input.renderedValue
          ) {
            throw new TRPCError({ code: "CONFLICT", message: "operationId was already used for a different flag — generate a new one" });
          }
        } else {
          const created = await ctx.wiring.memoryStore.casSupersede({
            organizationId: input.organizationId,
            ownerUserId: ownerId,
            lineageKey: anchorKey,
            expectedCurrentId: null,
            next: {
              id: memoryId,
              organizationId: input.organizationId,
              type: "semantic",
              subjectRecordId: anchorKey,
              scope: "private",
              content: JSON.stringify({
                kind: "red_flag",
                anchor: input.anchor,
                renderedValue: input.renderedValue,
                ...(input.renderedVersion ? { renderedVersion: input.renderedVersion } : {}),
                ...(input.reason ? { reason: input.reason } : {}),
                status: "open",
                learningStatus: "none",
              } satisfies LearningMemoryContent),
              sourceRefType: "feedback",
              trustOrigin: "user_content",
              confidence: 1,
              plane: "local",
              createdBy: ownerId,
              ownerUserId: ownerId,
              createdAt: monotonicRedFlagNowISO(),
            },
          });
          if (!created) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This target already has an open red flag — refresh and use clear/reopen instead of creating a new one",
            });
          }
          flagged = created;
        }

        const currentValue0 = parseLearningMemory(flagged.content);
        if (!isRedFlagContent(currentValue0)) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "red flag memory content was not the expected shape" });
        }

        // Step 2 (idempotent, resumable): the SEPARATE governed learning
        // step, shared with `reopen` (review round-4 item 4: reopening a
        // withdrawn/dismissed flag must also start a FRESH governed review).
        const currentRow = (await ctx.wiring.memoryStore.currentForLineage(input.organizationId, ownerId, anchorKey)) ?? flagged;
        return { memory: await attemptGovernedLearningStep(ctx.wiring, ctx.run, input.organizationId, ownerId, currentRow, flagged.id, `${ownerId}:${input.operationId}`) };
      }),

    /** TASK-010 review round-5 item 4 — "exposes retry for failed
     * pre-proposal state." A `learningStatus: "failed"` flag means the
     * governed learning step itself errored BEFORE ever reaching the
     * ledger (never the Human's own correction, which already succeeded in
     * step 1) — the only prior way to retry it was Clear-then-Reopen, which
     * needlessly forks the flag's own open/cleared history just to retry an
     * unrelated step. This re-attempts the SAME idempotent governed step
     * directly on the CURRENT (still-open-or-cleared) version, seeded by a
     * fresh client-supplied `operationId` (stable across a client's own
     * retry-of-a-retry, mirroring `create`'s idempotency contract) rather
     * than the original attempt's seed — safe because a genuinely "failed"
     * outcome never reached ledger append for its OLD seed (review item 4's
     * `attemptGovernedLearningStep` fix), so there is nothing to reconcile
     * against there; a fresh seed simply starts over cleanly. */
    retryLearning: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid(), operationId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { organizationId: input.organizationId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (value.learningStatus !== "failed") {
          throw new TRPCError({ code: "CONFLICT", message: `Only a failed learning step can be retried (current status: "${value.learningStatus}")` });
        }
        return { memory: await attemptGovernedLearningStep(ctx.wiring, ctx.run, input.organizationId, ownerId, current, current.id, `${ownerId}:retry:${input.flagId}:${input.operationId}`) };
      }),

    /** Reversible: appends a new row tagged "cleared" — the flagged Memory's
     * full history (including the original anchor/value/reason) stays intact,
     * never deleted (glossary: "It never silently changes source data").
     * CAS-protected (review item 4): a stale `flagId` (already superseded by
     * some other action) is rejected with CONFLICT rather than silently
     * forking the lineage. */
    clear: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { organizationId: input.organizationId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        // review round-4 items 1+4: withdraw/revoke BEFORE flipping status —
        // if either throws, NOTHING here has mutated yet (the flag stays
        // exactly as it was), so the caller sees a clean error and can
        // simply retry `clear` again; both helpers are themselves
        // idempotent (swallow "nothing left to withdraw"/"already
        // revoked"), so a retry after a partial failure converges rather
        // than double-acting or erroring. This closes "do not leave a
        // cleared flag with an approvable proposal on withdrawal failure."
        if (value.proposalId) await withdrawPendingRedFlagProposal(ctx.wiring, ctx.run, value.proposalId, ownerId);
        if (value.preferenceAdjustmentId) {
          await revokePreferenceAdjustmentPermanently(ctx.wiring, input.organizationId, ownerId, value.preferenceAdjustmentId);
        }

        const updated = await ctx.wiring.memoryStore.casSupersede({
          organizationId: input.organizationId,
          ownerUserId: ownerId,
          lineageKey: current.subjectRecordId!,
          expectedCurrentId: input.flagId,
          next: {
            ...current,
            id: uuidv7(),
            content: JSON.stringify({
              ...value,
              status: "cleared",
              // review round-4 item 4 ("set accurate learning state"): a
              // withdrawn/revoked correction is no longer actionable —
              // reflect that directly on the flag itself, not only on the
              // ledger/preference-adjustment side an owner would otherwise
              // have to cross-reference to notice.
              ...(value.proposalId || value.preferenceAdjustmentId ? { learningStatus: "dismissed" as const } : {}),
            } satisfies LearningMemoryContent),
            trustOrigin: "user_content",
            createdBy: ownerId,
            createdAt: monotonicRedFlagNowISO(),
          },
        });
        if (!updated) {
          throw new TRPCError({ code: "CONFLICT", message: "This flag was already changed by another action — refresh and try again" });
        }
        return { memory: updated };
      }),

    /** The "undo" for `clear` — symmetric CAS-protected supersede back to
     * "open." Review round-4 item 4: reopening starts a FRESH governed
     * review for this newly-active version — it never resurrects a prior
     * (vetoed/withdrawn/revoked) proposal, which stays permanently resolved
     * exactly as it was. */
    reopen: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { organizationId: input.organizationId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const reopenedId = uuidv7();
        // Reopening starts a FRESH governed review — clear every field the
        // OLD (resolved) proposal/preference-adjustment left behind rather
        // than nulling them (`exactOptionalPropertyTypes` forbids setting
        // an optional field to `undefined` explicitly).
        const { proposalId: _staleProposalId, preferenceAdjustmentId: _staleAdjustmentId, learningFailureReason: _staleFailureReason, ...valueBase } = value;
        const updated = await ctx.wiring.memoryStore.casSupersede({
          organizationId: input.organizationId,
          ownerUserId: ownerId,
          lineageKey: current.subjectRecordId!,
          expectedCurrentId: input.flagId,
          next: {
            ...current,
            id: reopenedId,
            content: JSON.stringify({
              ...valueBase,
              status: "open",
              learningStatus: "none",
            } satisfies LearningMemoryContent),
            trustOrigin: "user_content",
            createdBy: ownerId,
            createdAt: monotonicRedFlagNowISO(),
          },
        });
        if (!updated) {
          throw new TRPCError({ code: "CONFLICT", message: "This flag was already changed by another action — refresh and try again" });
        }
        return {
          memory: await attemptGovernedLearningStep(ctx.wiring, ctx.run, input.organizationId, ownerId, updated, updated.id, `${ownerId}:reopen:${reopenedId}`),
        };
      }),

    /** The "edit" half of inspect/edit/clear (§5d). CAS-protected like
     * clear/reopen above. */
    updateReason: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { organizationId: input.organizationId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (value.reason === input.reason) return { memory: current }; // no-op: nothing changed, don't fork the lineage for free
        const updated = await ctx.wiring.memoryStore.casSupersede({
          organizationId: input.organizationId,
          ownerUserId: ownerId,
          lineageKey: current.subjectRecordId!,
          expectedCurrentId: input.flagId,
          next: {
            ...current,
            id: uuidv7(),
            content: JSON.stringify({ ...value, reason: input.reason } satisfies LearningMemoryContent),
            trustOrigin: "user_content",
            createdBy: ownerId,
            createdAt: monotonicRedFlagNowISO(),
          },
        });
        if (!updated) {
          throw new TRPCError({ code: "CONFLICT", message: "This flag was already changed by another action — refresh and try again" });
        }
        return { memory: updated };
      }),

    /** TASK-010 review round-4 item 1 — the SEPARATE, Human-authorized
     * enactment path: once the flag owner has approved the governed
     * proposal (via `action.decide`), THIS endpoint (never the Agent, never
     * `pipeline.propose`) applies the actual correction — flipping the
     * private PreferenceAdjustment to "applied" and the flag's own
     * `learningStatus` to "applied," the ONLY state where `RedFlagControl`
     * visibly withholds the flagged rendered value. Idempotent (already-
     * applied is a no-op); fully reversible via `revokeCorrection`. */
    enactCorrection: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { organizationId: input.organizationId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (value.learningStatus === "applied") return { memory: current };
        if (!value.proposalId || !value.preferenceAdjustmentId || value.learningStatus !== "proposed") {
          throw new TRPCError({ code: "CONFLICT", message: `This correction cannot be enacted from status "${value.learningStatus}"` });
        }
        const decision = await ctx.wiring.ledger.decisionFor(value.proposalId);
        if (!decision || decision.userDecision !== "approve") {
          throw new TRPCError({ code: "CONFLICT", message: "This correction has not been approved yet — approve it in Approvals first" });
        }
        const adjustment = await ctx.wiring.memoryStore.currentForLineage(input.organizationId, ownerId, value.preferenceAdjustmentId);
        const adjustmentValue = adjustment && parseLearningMemory(adjustment.content);
        if (!adjustment || !isPreferenceAdjustmentContent(adjustmentValue) || adjustment.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "the linked preference adjustment could not be found" });
        }
        if (adjustmentValue.status === "revoked") {
          throw new TRPCError({ code: "CONFLICT", message: "This correction was permanently revoked — reopen the flag to submit a new one" });
        }
        if (adjustmentValue.status !== "applied") {
          const appliedAdjustment = await ctx.wiring.memoryStore.casSupersede({
            organizationId: input.organizationId,
            ownerUserId: ownerId,
            lineageKey: adjustment.subjectRecordId!,
            expectedCurrentId: adjustment.id,
            next: {
              ...adjustment,
              id: uuidv7(),
              content: JSON.stringify({ ...adjustmentValue, status: "applied", appliedAt: new Date().toISOString() } satisfies LearningMemoryContent),
              trustOrigin: "user_content",
              createdBy: ownerId,
              createdAt: monotonicRedFlagNowISO(),
            },
          });
          if (!appliedAdjustment) {
            throw new TRPCError({ code: "CONFLICT", message: "This correction was already changed — refresh and try again" });
          }
        }
        const updatedFlag = await ctx.wiring.memoryStore.casSupersede({
          organizationId: input.organizationId,
          ownerUserId: ownerId,
          lineageKey: current.subjectRecordId!,
          expectedCurrentId: input.flagId,
          next: {
            ...current,
            id: uuidv7(),
            content: JSON.stringify({ ...value, learningStatus: "applied" } satisfies LearningMemoryContent),
            trustOrigin: "user_content",
            createdBy: ownerId,
            createdAt: monotonicRedFlagNowISO(),
          },
        });
        if (!updatedFlag) {
          throw new TRPCError({ code: "CONFLICT", message: "This flag was already changed by another action — refresh and try again" });
        }
        return { memory: updatedFlag };
      }),

    /** The "undo" for `enactCorrection` — proves review round-4 item 1's
     * "behavior changes only after approval and can be undone." Terminally
     * revokes the linked PreferenceAdjustment (never re-enactable — the
     * owner must `clear`+`reopen` to submit a fresh correction) and reverts
     * the flag's `learningStatus` to "dismissed," the same terminal state
     * `clear`'s own withdrawal path uses. */
    revokeCorrection: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { organizationId: input.organizationId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (value.learningStatus !== "applied") {
          throw new TRPCError({ code: "CONFLICT", message: "This flag has no applied correction to revoke" });
        }
        if (value.preferenceAdjustmentId) {
          await revokePreferenceAdjustmentPermanently(ctx.wiring, input.organizationId, ownerId, value.preferenceAdjustmentId);
        }
        const updatedFlag = await ctx.wiring.memoryStore.casSupersede({
          organizationId: input.organizationId,
          ownerUserId: ownerId,
          lineageKey: current.subjectRecordId!,
          expectedCurrentId: input.flagId,
          next: {
            ...current,
            id: uuidv7(),
            content: JSON.stringify({ ...value, learningStatus: "dismissed" } satisfies LearningMemoryContent),
            trustOrigin: "user_content",
            createdBy: ownerId,
            createdAt: monotonicRedFlagNowISO(),
          },
        });
        if (!updatedFlag) {
          throw new TRPCError({ code: "CONFLICT", message: "This flag was already changed by another action — refresh and try again" });
        }
        return { memory: updatedFlag };
      }),

    /** Genuine personal-data deletion — distinct from `clear` (a reversible
     * status change). Rejects arbitrary/foreign/wrong-kind Memory ids
     * (review item 1) and, before deleting, enumerates EVERY version across
     * the full lineage (review round-4 item 5 — `forget` deletes the whole
     * lineage, so a still-pending/applied proposal cited by an OLDER or
     * NEWER version than whichever id the caller happened to pass must
     * still be withdrawn/revoked) and withdraws/revokes every distinct
     * proposal/preference-adjustment id found, so nothing actionable can
     * survive referencing evidence that no longer exists. */
    forget: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), flagId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { organizationId: input.organizationId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        const proposalIds = new Set<string>();
        const preferenceAdjustmentIds = new Set<string>();
        let cursor: { createdAt: string; id: string } | undefined;
        while (true) {
          const page = await ctx.wiring.memoryStore.retrieve(
            { subjectRecordId: current.subjectRecordId!, includeSuperseded: true, order: "asc", limit: 200, ...(cursor ? { cursor } : {}) },
            auth,
          );
          for (const row of page) {
            const v = parseLearningMemory(row.content);
            if (isRedFlagContent(v)) {
              if (v.proposalId) proposalIds.add(v.proposalId);
              if (v.preferenceAdjustmentId) preferenceAdjustmentIds.add(v.preferenceAdjustmentId);
            }
          }
          if (page.length < 200) break;
          const last = page[page.length - 1]!;
          cursor = { createdAt: last.createdAt, id: last.id };
        }
        for (const proposalId of proposalIds) {
          await withdrawPendingRedFlagProposal(ctx.wiring, ctx.run, proposalId, ownerId);
        }
        for (const preferenceAdjustmentId of preferenceAdjustmentIds) {
          await revokePreferenceAdjustmentPermanently(ctx.wiring, input.organizationId, ownerId, preferenceAdjustmentId);
        }
        const forgotten = await ctx.wiring.memoryStore.forget(input.flagId, auth);
        return { forgotten };
      }),

    /** Current (non-superseded) flag for ONE exact anchor — an indexed
     * `subjectRecordId` equality lookup (review items 5+6+7: the
     * deterministic anchor lineage key makes this O(1)-ish instead of a
     * full-table content scan). Powers a single cell/bullet's own
     * hover/focus state when a batched `listForScope` fetch isn't already
     * available. */
    listForAnchor: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), anchor: redFlagAnchorInput }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const rows = await ctx.wiring.memoryStore.retrieve(
          { subjectRecordId: anchorLineageKey(input.anchor), sourceRefType: "feedback", contentPathEquals: [{ path: "kind", equals: "red_flag" }], limit: 1 },
          { organizationId: input.organizationId, userId: ctx.identity.id },
        );
        const flags = rows
          .map((row) => ({ row, value: parseLearningMemory(row.content) }))
          .filter((item): item is { row: (typeof rows)[number]; value: Extract<LearningMemoryContent, { kind: "red_flag" }> } => isRedFlagContent(item.value));
        return { flags };
      }),

    /**
     * Current flags across a whole scope (a Module, optionally narrowed to
     * one Database/table, or one record/file/result's bullets) in ONE call
     * — review item 7: the primitive a `RedFlagProvider` batches an entire
     * visible table/page's worth of cells/bullets through, instead of one
     * `listForAnchor` query per rendered cell. The dominant reducers
     * (`kind: "red_flag"`, `anchor.moduleId`) are pushed into the DB query
     * itself via `contentPathEquals` (review round-4 item 7) rather than
     * scanned app-side over an unbounded/artificially-capped page — the
     * `kind` predicate specifically excludes the SEPARATE
     * `preference_adjustment` Memories the governed step synthesizes (review
     * round-4 item 1), which also carry `sourceRefType: "feedback"` and the
     * SAME `anchor` shape as their originating flag, so without it they'd
     * silently interleave with (and, at the `listAll` cursor boundary,
     * crowd out) the actual red_flag rows a caller asked for. The
     * remaining, finer-grained database/record/file/result narrowing stays
     * app-side over that already-scoped (typically small) result set, since
     * it needs an OR across the cell/bullet shapes a single equality
     * predicate can't express.
     */
    listForScope: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          moduleId: z.string().min(1),
          databaseId: z.string().min(1).optional(),
          recordId: z.string().min(1).optional(),
          fileId: z.string().min(1).optional(),
          resultId: z.string().min(1).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const rows = await ctx.wiring.memoryStore.retrieve(
          {
            sourceRefType: "feedback",
            contentPathEquals: [
              { path: "kind", equals: "red_flag" },
              { path: "anchor.moduleId", equals: input.moduleId },
            ],
          },
          { organizationId: input.organizationId, userId: ctx.identity.id },
        );
        const flags = rows
          .map((row) => ({ row, value: parseLearningMemory(row.content) }))
          .filter((item): item is { row: (typeof rows)[number]; value: Extract<LearningMemoryContent, { kind: "red_flag" }> } => isRedFlagContent(item.value))
          .filter((item) => {
            const a = item.value.anchor;
            if (input.databaseId !== undefined && (a.kind !== "cell" || a.databaseId !== input.databaseId)) return false;
            if (input.recordId !== undefined) {
              const matchesRecord = (a.kind === "cell" && a.recordId === input.recordId) || (a.kind === "bullet" && a.target.type === "record" && a.target.recordId === input.recordId);
              if (!matchesRecord) return false;
            }
            if (input.fileId !== undefined && !(a.kind === "bullet" && a.target.type === "file" && a.target.fileId === input.fileId)) return false;
            if (input.resultId !== undefined && !(a.kind === "bullet" && a.target.type === "result" && a.target.resultId === input.resultId)) return false;
            return true;
          });
        return { flags };
      }),

    /**
     * The audit/inspect surface — "inspect the audit evidence" from the
     * Prototype test. Server-side filtered to `sourceRefType: "feedback"`,
     * `kind: "red_flag"`, AND (when requested) `status` — ALL pushed into
     * the store query BEFORE `limit` (review item 6 + round-4 item 1's
     * preference-adjustment exclusion + round-5 item 9: the `status`
     * predicate was previously applied app-side AFTER the page was already
     * capped, which could silently under-fill or empty a page whenever it
     * happened to be dominated by the OTHER status) — with a REAL keyset
     * `(createdAt, id)` cursor (review round-4 item 8) immune to a flag
     * inserted/superseded between page fetches.
     */
    listAll: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          status: z.enum(["open", "cleared"]).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const cursor = decodeRedFlagCursor(input.cursor);
        const rows = await ctx.wiring.memoryStore.retrieve(
          {
            sourceRefType: "feedback",
            contentPathEquals: [
              { path: "kind", equals: "red_flag" },
              ...(input.status ? [{ path: "status", equals: input.status }] : []),
            ],
            order: "desc",
            limit: input.limit,
            ...(cursor ? { cursor } : {}),
          },
          { organizationId: input.organizationId, userId: ctx.identity.id },
        );
        const flags = rows
          .map((row) => ({ row, value: parseLearningMemory(row.content) }))
          .filter((item): item is { row: (typeof rows)[number]; value: Extract<LearningMemoryContent, { kind: "red_flag" }> } => isRedFlagContent(item.value));
        const lastRow = rows[rows.length - 1];
        const nextCursor = rows.length === input.limit && lastRow ? encodeRedFlagCursor(lastRow) : null;
        return { flags, nextCursor };
      }),

    /** Explicit lineage/history for one flag — every create/clear/reopen/
     * updateReason/learning-outcome version, oldest first, including
     * superseded rows (review item 6's "explicit lineage history"). A REAL
     * keyset cursor (review round-4 item 8) removes the prior 200-version
     * silent cap: a lineage with more versions than one page simply returns
     * a `nextCursor` rather than truncating. */
    history: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          flagId: z.string().uuid(),
          limit: z.number().int().min(1).max(200).default(100),
          cursor: z.string().optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { organizationId: input.organizationId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const cursor = decodeRedFlagCursor(input.cursor);
        const rows = await ctx.wiring.memoryStore.retrieve(
          {
            subjectRecordId: current.subjectRecordId!,
            includeSuperseded: true,
            order: "asc",
            // review round-7: this query is scoped to ONE lineage
            // (`subjectRecordId` above), so `lineageRevision` ordering is
            // valid here (see MemoryQuery.orderBy's doc) and replaces the
            // formerly process-local `monotonicRedFlagNowISO` counter for
            // "which version of THIS lineage came first" — durable across
            // any number of server processes/restarts. A legacy row written
            // before this column existed still sorts oldest (its revision
            // is `null`, always treated as older than any allocated one).
            orderBy: "lineageRevision",
            limit: input.limit,
            ...(cursor ? { cursor } : {}),
          },
          auth,
        );
        const versions = rows
          .map((row) => ({ row, value: parseLearningMemory(row.content) }))
          .filter((item): item is { row: (typeof rows)[number]; value: Extract<LearningMemoryContent, { kind: "red_flag" }> } => isRedFlagContent(item.value));
        const lastRow = rows[rows.length - 1];
        const nextCursor = rows.length === input.limit && lastRow ? encodeRedFlagCursor(lastRow) : null;
        return { versions, nextCursor };
      }),
  }),

  organization: t.router({
    activateSession: authenticatedProcedure.mutation(async ({ ctx }) => {
      if (ctx.identity.id !== ctx.wiring.pilotUserId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This Supabase account is not approved for the pilot Organization",
        });
      }
      await ctx.wiring.organizationStore.ensureMember({
        organizationId: PILOT_ORGANIZATION,
        userId: ctx.identity.id,
        userEmail: ctx.wiring.pilotUserEmail,
      });
      return {
        organizationId: PILOT_ORGANIZATION,
        userId: ctx.identity.id,
      };
    }),

    create: procedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.organizationStore.createOrganization(input.name, ctx.identity.id);
      }),

    list: procedure.query(async ({ ctx }) => {
      return ctx.wiring.organizationStore.listOrganizations(ctx.identity.id);
    }),

    rename: procedure
      .input(z.object({ organizationId: z.string().min(1), name: z.string().trim().min(1).max(120) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        try {
          return await ctx.wiring.organizationStore.renameOrganization(
            input.organizationId,
            input.name,
          );
        } catch (error) {
          if (error instanceof ModuleFilesPathError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
          }
          if (error instanceof OrganizationFilesConflictError) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Rename or merge the existing Organization Files directory first",
              cause: error,
            });
          }
          if (error instanceof OrganizationFilesRecoveryError) {
            throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
          }
          if (error instanceof OrganizationRenameRollbackError) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Organization rename failed and its Files directory could not be restored",
              cause: error,
            });
          }
          if (error instanceof UnknownOrganizationError) {
            throw new TRPCError({ code: "NOT_FOUND", message: "unknown Organization", cause: error });
          }
          throw error;
        }
      }),

    inviteMember: procedure
      .input(z.object({ organizationId: z.string().min(1), email: z.string().email() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return ctx.wiring.organizationStore.inviteMember(input.organizationId, input.email);
      }),

    listMembers: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return ctx.wiring.organizationStore.listMembers(input.organizationId);
      }),

    /**
     * P1 Organization Generator (docs/wiki/vision.md "View grammar" + roadmap.md
     * P1): the blueprint -> view grammar compiler's governed surface. `get`
     * returns the current active organization_definition (or null — no demo/dummy
     * fallback: an un-onboarded organization honestly has none yet). `propose`
     * always writes a DRAFT row (mirrors capability.register's "generation
     * only ever creates draft" — the Capability Lifecycle Platform's core
     * principle: everything is proposed, governed, continuously evolved).
     * `activate` is the governed step: it round-trips through the SAME
     * pipeline propose/decide semantics `capability.approve` uses, so a human
     * decision (never an agent, agent-floor applies unchanged) resolves it and
     * the attempt is audited either way; on approval it bumps the version and
     * archives the prior active row in the same operation (the one place
     * "only one active row" is enforced).
     */
    blueprint: t.router({
      get: procedure.input(blueprintGetInput).query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const active = await ctx.wiring.organizationDefinitionStore.getActive(input.organizationId);
        return { definition: active };
      }),

      /**
       * getById (ADR-023/ADR-024): returns a organization_definition by id
       * REGARDLESS of status (draft/active/archived) — `get` above only ever
       * returns the currently-active row, so a draft that hasn't been
       * activated yet (the common ApprovalsPage diff-preview case) was
       * previously unreachable. Identity-scoped like every sibling endpoint:
       * the row's own `organizationId` must match the caller-supplied
       * `organizationId`, so a definitionId from another organization 404s rather
       * than leaking cross-organization data.
       */
      getById: procedure.input(blueprintGetByIdInput).query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const definition = await ctx.wiring.organizationDefinitionStore.get(input.definitionId);
        if (!definition || definition.organizationId !== input.organizationId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown organization_definition" });
        }
        return { definition };
      }),

      /** Always creates a DRAFT organization_definition — never activates it. The
       * blueprint is validated against the grammar (compileBlueprint) BEFORE
       * being persisted, so an invalid draft is rejected here rather than
       * silently stored and only failing later at activation/render time. */
      propose: procedure.input(blueprintProposeInput).mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const blueprint = toOrganizationBlueprint(input.blueprint);
        try {
          compileBlueprint(blueprint, BLUEPRINT_NODE_TYPE_REGISTRY, BLUEPRINT_RELATIONSHIP_NODE_TYPES);
        } catch (err) {
          if (err instanceof BlueprintCompileError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
          throw err;
        }

        const priorDrafts = await ctx.wiring.organizationDefinitionStore.listDrafts(input.organizationId);
        const active = await ctx.wiring.organizationDefinitionStore.getActive(input.organizationId);
        const nextVersion = 1 + Math.max(active?.version ?? 0, ...priorDrafts.map((d) => d.version), 0);

        const id = ctx.run.ids.next();
        const created = await ctx.wiring.organizationDefinitionStore.create({
          id,
          organizationId: input.organizationId,
          blueprint,
          version: nextVersion,
          status: "draft",
          createdBy: ctx.identity.type === "user" ? ctx.identity.id : null,
        });
        return { definition: created };
      }),

      /**
       * Activate a draft: proposes the activation through the governed
       * pipeline (same round trip capability.approve makes) so an agent can
       * never resolve it and every attempt is ledgered, whether it ends up
       * auto-resolved or parked pending_review. On resolution, flips the draft
       * to `active` and archives whatever was previously active — the only
       * place two rows are ever active for the same organization at once is
       * disallowed.
       */
      activate: procedure.input(blueprintActivateInput).mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const draft = await ctx.wiring.organizationDefinitionStore.get(input.definitionId);
        if (!draft || draft.organizationId !== input.organizationId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown organization_definition draft" });
        }
        if (draft.status !== "draft") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `organization_definition ${draft.id} is "${draft.status}", not "draft"` });
        }

        const proposal = await ctx.wiring.pipeline.propose(
          {
            organizationId: input.organizationId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "approve",
            resourceType: "organization_definition",
            resourceId: input.definitionId,
            inputs: { definitionId: input.definitionId, fromStatus: draft.status },
            skill: "stageMutation",
          },
          ctx.run,
        );
        if (proposal.status === "pending_review") {
          return { activated: false, proposal, definition: draft };
        }
        // Hard-stop mirroring capability.approve above: only an authority-granted,
        // auto-applied decision may archive the prior active definition and
        // activate the draft. A `"rejected"` decision (authority denied, or the
        // agent-floor blocked it) must never reach the mutation below.
        if (proposal.status !== "applied") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: proposal.rejectionReason ?? "approval was not authorized",
          });
        }

        const priorActive = await ctx.wiring.organizationDefinitionStore.getActive(input.organizationId);
        if (priorActive) {
          await ctx.wiring.organizationDefinitionStore.setStatus(priorActive.id, "archived");
        }
        const activated = await ctx.wiring.organizationDefinitionStore.setStatus(draft.id, "active");
        return { activated: true, proposal, definition: activated };
      }),
    }),
  }),

  /** Cross-Module graph and generic Record reads. */
  graph: t.router({
    full: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid(),
          limit: z.number().int().min(1).max(200).default(100),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const loadModuleInstallations = async () => {
          const items = [];
          let offset = 0;
          let total = 0;
          do {
            const page = await ctx.wiring.moduleStore.list(
              input.organizationId,
              { limit: 100, offset },
            );
            total = page.total;
            if (page.items.length === 0 && offset < total) {
              throw new Error("Module installation pagination stopped before reaching the reported total");
            }
            items.push(...page.items);
            offset += page.items.length;
          } while (offset < total);
          return items;
        };
        const [graph, moduleInstallations, taskQueue, taskDependencyEdges] = await Promise.all([
          ctx.wiring.graphStore.listFullGraph(
            input.organizationId,
            ctx.identity.id,
            { limit: input.limit },
          ),
          loadModuleInstallations(),
          // TM5 (ADR-205) — Tasks live in their own Database, not in the graph
          // store's Records, so Second Brain never showed them. Second Brain
          // IS Graph view at full scope (ADR-110), and "full" that silently
          // omits the execution queue is not full.
          ctx.wiring.taskManager.list(input.organizationId),
          ctx.wiring.taskManager.listDependencies(input.organizationId),
        ]);
        const installations = moduleInstallations.filter(
          (installation) =>
            installation.state === "available" &&
            installation.status === "installed" &&
            installation.manifest.module !== undefined &&
            installation.moduleAttachment === undefined,
        );
        const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
        for (const installation of installations) {
          const module = installation.manifest.module!;
          nodes.set(`module:${installation.moduleName}`, {
            id: `module:${installation.moduleName}`,
            recordId: installation.moduleName,
            recordType: "module",
            label:
              module.displayName ??
              installation.manifest.name ??
              installation.moduleName,
            databaseId: "modules",
            databaseLabel: "Modules",
            moduleId: installation.moduleName,
            subtitle: `Module v${installation.moduleVersion}`,
            recordPath: `/module/${installation.moduleName}`,
            provenance: `Module installation · source ${installation.moduleName}`,
          });
          for (const agent of module.agents) {
            const recordId = `${installation.moduleName}:${agent.id}`;
            nodes.set(`agent:${recordId}`, {
              id: `agent:${recordId}`,
              recordId,
              recordType: "agent",
              label: agent.name,
              databaseId: "agents",
              databaseLabel: "Agents",
              moduleId: installation.moduleName,
              subtitle: `${agent.skillIds.length} ${agent.skillIds.length === 1 ? "Skill" : "Skills"}`,
              recordPath: `/module/${installation.moduleName}#agent-${agent.id}`,
              provenance: `Agent binding · source ${installation.moduleName}`,
            });
          }
        }
        // Task nodes, capped by the SAME limit the rest of the graph honours:
        // a queue is the one Database that reliably outgrows every other, and
        // letting it alone ignore the cap would make a large queue crowd out
        // everything Second Brain exists to relate it to. Closed work is
        // dropped first — an archived Task is history, not context.
        const graphTasks = [...taskQueue]
          .sort((a, b) => Number(taskIsOpen(b.status)) - Number(taskIsOpen(a.status)))
          .slice(0, input.limit);
        for (const task of graphTasks) {
          nodes.set(`task:${task.id}`, {
            id: `task:${task.id}`,
            recordId: task.id,
            recordType: "task",
            label: `${task.path} — ${task.title}`,
            databaseId: "task-manager.tasks",
            databaseLabel: "Tasks",
            moduleId: "task-manager",
            subtitle: task.isGoal ? `Goal · ${task.status}` : task.status,
            recordPath: `/task-manager/${task.id}`,
            provenance: `Task Manager queue · ${task.path}`,
          });
        }
        // K3 (TASK-047) — the knowledge region: entities + live claims, the
        // Second Brain projection of the SAME rows the fusion graph lane
        // retrieves. Flight-gated and owner-scoped to the viewer; a "full"
        // graph that hid accepted knowledge would break the one-substrate
        // trust property ("what you see is what the model retrieves").
        const claimEdges: Array<{ sourceId: string; targetId: string; label: string; relationType: string; evidence: string }> = [];
        if (ctx.wiring.claimSubstrateEnabled) {
          const [claimEntities, claimRows] = await Promise.all([
            ctx.wiring.claimStore.listEntities(input.organizationId, ctx.identity.id),
            ctx.wiring.claimStore.liveClaims(input.organizationId, ctx.identity.id),
          ]);
          const claimsByEntity = new Map<string, number>();
          for (const claim of claimRows) {
            claimsByEntity.set(claim.entityId, (claimsByEntity.get(claim.entityId) ?? 0) + 1);
          }
          for (const entity of claimEntities.slice(0, input.limit)) {
            const nodeId = `claim-entity:${entity.id}`;
            const liveCount = claimsByEntity.get(entity.id) ?? 0;
            nodes.set(nodeId, {
              id: nodeId,
              recordId: entity.id,
              recordType: "claim_entity",
              label: entity.name,
              databaseId: "claims.entities",
              databaseLabel: "Claims",
              moduleId: "learning",
              subtitle: `${entity.kind} · ${liveCount} ${liveCount === 1 ? "claim" : "claims"}`,
              provenance: "Claim substrate · governed, Human-accepted",
            });
            // The entity is ABOUT an existing region row — link the regions
            // rather than copying them (the relationship graph becomes one
            // region of the whole, ADR-210).
            const regionNodeId = entity.refRecordId ? `${entity.kind}:${entity.refRecordId}` : null;
            if (regionNodeId && nodes.has(regionNodeId)) {
              claimEdges.push({
                sourceId: nodeId,
                targetId: regionNodeId,
                label: "about",
                relationType: "claim_about",
                evidence: `Claim entity ${entity.name}`,
              });
            }
          }
          for (const claim of claimRows.slice(0, input.limit)) {
            const entityNodeId = `claim-entity:${claim.entityId}`;
            if (!nodes.has(entityNodeId)) continue;
            const nodeId = `claim:${claim.id}`;
            nodes.set(nodeId, {
              id: nodeId,
              recordId: claim.id,
              recordType: "claim",
              label: `${claim.field}: ${claim.value}`,
              databaseId: "claims.rows",
              databaseLabel: "Claims",
              moduleId: "learning",
              subtitle: `${claim.claimClass} · ${claim.sensitivity}`,
              provenance: `Accepted ${new Date(claim.recordedAt).toISOString().slice(0, 10)} · ${claim.evidence.length} evidence ref${claim.evidence.length === 1 ? "" : "s"} · decision ${claim.decisionRef.slice(0, 8)}`,
            });
            claimEdges.push({
              sourceId: nodeId,
              targetId: entityNodeId,
              label: "claim of",
              relationType: "claim_of",
              evidence: `Governed claim · decision ${claim.decisionRef.slice(0, 8)}`,
            });
          }
        }
        for (const [id, node] of nodes) {
          if (node.recordPath || !nodes.has(`module:${node.moduleId}`)) continue;
          nodes.set(id, { ...node, recordPath: `/module/${node.moduleId}` });
        }
        const edges = new Map(graph.edges.map((edge) => {
          const source = nodes.get(edge.sourceId);
          const target = nodes.get(edge.targetId);
          return [edge.id, {
            ...edge,
            ...(source?.recordPath || target?.recordPath
              ? { recordPath: source?.recordPath ?? target?.recordPath }
              : {}),
          }];
        }));
        // Both Task edge kinds, and they are genuinely different questions:
        // the tree says where work SITS, the dependency says what it WAITS ON.
        // Collapsing them into one edge type would make Second Brain unable to
        // answer either.
        const includedTaskIds = new Set(graphTasks.map((task) => task.id));
        for (const task of graphTasks) {
          if (!task.parentTaskId || !includedTaskIds.has(task.parentTaskId)) continue;
          const id = `task-parent:${task.id}`;
          edges.set(id, {
            id,
            sourceId: `task:${task.id}`,
            targetId: `task:${task.parentTaskId}`,
            label: "subtask of",
            relationType: "task_parent",
            sourceModule: "task-manager",
            evidence: `Task tree · ${task.path}`,
            recordPath: `/task-manager/${task.id}`,
          });
        }
        for (const dependency of taskDependencyEdges) {
          if (!includedTaskIds.has(dependency.taskId) || !includedTaskIds.has(dependency.dependsOnTaskId)) continue;
          const id = `task-depends-on:${dependency.id}`;
          edges.set(id, {
            id,
            sourceId: `task:${dependency.taskId}`,
            targetId: `task:${dependency.dependsOnTaskId}`,
            label: "depends on",
            relationType: "task_depends_on",
            sourceModule: "task-manager",
            evidence: dependency.reason ?? "Task dependency Relation",
            recordPath: `/task-manager/${dependency.taskId}`,
          });
        }
        for (const claimEdge of claimEdges) {
          const id = `${claimEdge.relationType}:${claimEdge.sourceId}:${claimEdge.targetId}`;
          edges.set(id, {
            id,
            sourceId: claimEdge.sourceId,
            targetId: claimEdge.targetId,
            label: claimEdge.label,
            relationType: claimEdge.relationType,
            sourceModule: "learning",
            evidence: claimEdge.evidence,
          });
        }
        for (const node of nodes.values()) {
          if (node.recordType === "module") continue;
          const moduleNodeId = `module:${node.moduleId}`;
          if (!nodes.has(moduleNodeId)) continue;
          const id = `source-module:${node.id}:${moduleNodeId}`;
          edges.set(id, {
            id,
            sourceId: node.id,
            targetId: moduleNodeId,
            label: "from",
            relationType: "originates_from",
            sourceModule: node.moduleId,
            evidence: `Source Module ${node.moduleId}`,
            recordPath: nodes.get(moduleNodeId)?.recordPath,
          });
        }
        const composedNodes = [...nodes.values()];
        const databases = new Map(graph.databases.map((database) => [database.id, database]));
        if (composedNodes.some((node) => node.recordType === "module")) {
          databases.set("modules", { id: "modules", label: "Modules", moduleId: "modules" });
        }
        if (composedNodes.some((node) => node.recordType === "agent")) {
          databases.set("agents", { id: "agents", label: "Agents", moduleId: "agents" });
        }
        if (composedNodes.some((node) => node.recordType === "task")) {
          databases.set("task-manager.tasks", {
            id: "task-manager.tasks",
            label: "Tasks",
            moduleId: "task-manager",
          });
        }
        if (composedNodes.some((node) => node.recordType === "claim_entity" || node.recordType === "claim")) {
          databases.set("claims.entities", { id: "claims.entities", label: "Claims", moduleId: "learning" });
          databases.set("claims.rows", { id: "claims.rows", label: "Claims", moduleId: "learning" });
        }
        return {
          nodes: composedNodes,
          edges: [...edges.values()],
          databases: [...databases.values()],
          hasMore: graph.hasMore || graphTasks.length < taskQueue.length,
        };
      }),

    listRecords: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const { items, total } = await ctx.wiring.graphStore.listRecords(input.organizationId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getRecord: procedure.input(z.object({ id: z.string().uuid() })).query(async ({ input, ctx }) => {
      return ctx.wiring.graphStore.getRecord(input.id);
    }),

  }),

  /**
   * JobPilot — wires the pure `@bridge/jobpilot` module (scoring, state-machine,
   * table spec) to real persistence for the first time (frontend-migration-
   * scoping.md Phase 4). Job/application CRUD is organization-authenticated, not
   * routed through the governed pipeline — tracking a job posting has no
   * external effect requiring approval, same tier as organization membership.
   * `transition` validates against @bridge/jobpilot's own state machine BEFORE
   * persisting, so an invalid stage jump is rejected here, not silently written.
   */
  jobpilot: t.router({
    definition: procedure
      .input(z.object({ organizationId: z.string().min(1) }))
      .query(({ input }) => {
        assertPilotOrganization(input.organizationId);
        return jobsTableSpec;
      }),

    create: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          title: z.string().min(1),
          company: z.string().min(1),
          location: z.string().optional(),
          salaryMax: z.number().int().positive().optional(),
          url: z.string().url().optional(),
          source: z.string().optional(),
          isRemote: z.boolean().optional(),
          descriptionKeywords: z.array(z.string()).optional(),
          candidate: z.object({
            categories: z.array(z.string()),
            skills: z.array(z.string()),
            minSalary: z.number().optional(),
            locations: z.array(z.string()).optional(),
          }),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const job: JobProfile = {
          title: input.title,
          company: input.company,
          ...(input.location ? { location: input.location } : {}),
          ...(input.salaryMax != null ? { salaryMax: input.salaryMax } : {}),
          ...(input.isRemote != null ? { isRemote: input.isRemote } : {}),
          ...(input.descriptionKeywords ? { descriptionKeywords: input.descriptionKeywords } : {}),
        };
        const candidate: CandidateProfile = {
          categories: input.candidate.categories,
          skills: input.candidate.skills,
          ...(input.candidate.minSalary != null ? { minSalary: input.candidate.minSalary } : {}),
          ...(input.candidate.locations ? { locations: input.candidate.locations } : {}),
        };
        const fit = scoreJobFit(job, candidate);
        const { job: jobRow, application } = await ctx.wiring.jobpilotStore.createJob({
          organizationId: input.organizationId,
          title: input.title,
          company: input.company,
          ...(input.location ? { location: input.location } : {}),
          ...(input.salaryMax != null ? { salaryMax: input.salaryMax } : {}),
          ...(input.url ? { url: input.url } : {}),
          ...(input.source ? { source: input.source } : {}),
        });
        const scored = await ctx.wiring.jobpilotStore.updateApplication(application.id, { fitScore: fit.score, flag: fit.flag });
        return { job: jobRow, application: scored ?? application, fit };
      }),

    list: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const { items, total } = await ctx.wiring.jobpilotStore.listJobs(input.organizationId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    /** Moves an application's stage — rejects invalid jumps via @bridge/jobpilot's
     * own transition() BEFORE writing (queued->tailoring->evaluating->... only). */
    transition: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          applicationId: z.string().uuid(),
          from: z.string(),
          to: z.string(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const application = await ctx.wiring.jobpilotStore.getApplication(input.applicationId, input.organizationId);
        if (!application) throw new TRPCError({ code: "NOT_FOUND", message: "unknown application" });
        try {
          transition(application.stage as ApplicationStage, input.to as ApplicationStage, application.id, "user");
        } catch (err) {
          if (err instanceof InvalidTransitionError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
          throw err;
        }
        const updated = await ctx.wiring.jobpilotStore.updateApplication(application.id, { stage: input.to });
        return updated;
      }),

    /**
     * JP3B (TASK-011) — cited company-culture research, TWO-PHASE (remediated
     * 2026-07-17, see outputs/2026-07-17-jobpilot-culture-research-task011.md).
     *
     * `propose` resolves ONLY server-owned `sourceId`s (never a client-supplied
     * URL/type/label — see `resolveAuthorizedCultureSource`), gates every
     * non-`permitted` source type before any child Run or network access, and
     * creates a genuinely side-effect-free pipeline proposal per permitted
     * source (the Skill's `run()` is pure). NOTHING is fetched yet.
     *
     * A human decision (`action.decide`) must approve a specific proposal
     * before `materialize` will perform the real, guarded fetch for it — a
     * vetoed or never-decided proposal can never reach the network. `cancel`
     * aborts an in-flight fetch for real (or, before any fetch starts, simply
     * guarantees one never will). `synthesize` only accepts claims that
     * `groundClaims` can verify against the results THIS run actually
     * fetched — an absent/mutated quote or a forged contradiction reference
     * fails the whole batch closed.
     */
    cultureResearch: t.router({
      /** Lists the server-owned authorized sources for a company — the ONLY
       * way a client learns which `sourceId`s exist to propose. Never
       * exposes the underlying URL (irrelevant to the client until fetched
       * and disclosed) — just enough to render a source picker and an
       * honest "why is Glassdoor/Reddit/Google reviews skipped" explanation
       * for ineligible sources, matching the disclosure the propose/synthesize
       * flow already builds server-side. */
      sources: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), company: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          return CULTURE_SOURCE_REGISTRY.filter((s) => s.organizationId === input.organizationId && s.company === input.company).map((s) => {
            const classification = classifyCultureSource(s.sourceType);
            return { id: s.id, sourceLabel: s.sourceLabel, sourceType: s.sourceType, eligibility: classification.eligibility, reason: classification.reason };
          });
        }),

      propose: authenticatedProcedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            company: z.string().min(1),
            sourceIds: z.array(z.string().min(1)).min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);

          // Dedupe before anything else — a caller listing the same id many
          // times must not reserve many times the budget/fan-out.
          const dedupedIds = Array.from(new Set(input.sourceIds));
          if (dedupedIds.length > MAX_CULTURE_SOURCES_PER_RUN) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `at most ${MAX_CULTURE_SOURCES_PER_RUN} sources may be researched per run (received ${dedupedIds.length} distinct ids)`,
            });
          }

          // Resolve every id server-side. ANY unknown, or cross-organization/
          // cross-company, id fails the WHOLE request closed — a forged id in
          // the batch is treated as a misuse signal, not a partial skip.
          const resolved = dedupedIds.map((id) => ({ id, source: resolveAuthorizedCultureSource(input.organizationId, input.company, id) }));
          const unknown = resolved.filter((r) => !r.source);
          if (unknown.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `unknown or unauthorized source id(s) for this organization/company: ${unknown.map((u) => u.id).join(", ")}`,
            });
          }
          const sources = resolved.map((r) => r.source!);

          const permitted = sources.filter((s) => classifyCultureSource(s.sourceType).eligibility === "permitted");
          const skipped = sources
            .filter((s) => classifyCultureSource(s.sourceType).eligibility !== "permitted")
            .map((s) => {
              const classification = classifyCultureSource(s.sourceType);
              return { sourceId: s.id, sourceType: s.sourceType, sourceLabel: s.sourceLabel, eligibility: classification.eligibility, reason: classification.reason };
            });

          const onBehalfOf = { type: (ctx.identity.type === "team" ? "team" : "user") as "user" | "team", id: ctx.identity.id };
          const researchGoalTask = await provisionCultureResearchTask(ctx.wiring, input.organizationId);

          const [learningScope, learningDataScope] = await Promise.all([
            ctx.wiring.agents.capabilityScope(LEARNING_AGENT),
            ctx.wiring.agents.dataScope(LEARNING_AGENT),
          ]);
          const parentRunId = uuidv7();
          // FIXED budget from the server-owned cap — NEVER derived from the
          // caller's request length (TASK-011 remediation #4).
          const parentEnvelope: ParentRunEnvelope = {
            runId: parentRunId,
            agentId: LEARNING_AGENT,
            organizationId: input.organizationId,
            authorityScope: learningScope,
            eligibleSkills: ["jobpilot.researchCultureSource"],
            dataScope: learningDataScope,
            plane: "cloud",
            budgetRemaining: { calls: MAX_CULTURE_SOURCES_PER_RUN, cost: MAX_CULTURE_SOURCES_PER_RUN },
            reviewMode: "approve",
            childRunPolicy: "allowed",
            delegationDepth: 0,
            onBehalfOf,
          };

          const pending: Array<{ proposalId: string; childRunId: string; sourceId: string; sourceType: string; sourceLabel: string }> = [];
          for (const source of permitted) {
            const childRun = await createChildAgentRun(
              { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
              parentEnvelope,
              {
                goalId: researchGoalTask.goalId,
                taskId: researchGoalTask.taskId,
                delegatedScope: ["external:fetch:read"],
                selectedSkills: ["jobpilot.researchCultureSource"],
                budget: { maxCalls: 1, maxCost: 1 },
                deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
                stopCondition: `fetch "${source.sourceLabel}" once, only after human approval, and stop`,
                requestedDataScope: "public",
                touchesExternalRisk: true,
              },
              ctx.run,
            );

            // TASK-011 remediation (2026-07-18 final review, issue 1) —
            // create the DURABLE culture-fetch intent record BEFORE the
            // ledger proposal exists, pinning the canonical URL/redirect-
            // origin allowlist/goal+task/skill/actor from the SERVER-owned
            // registry right now. `materialize`/`cancel` will re-resolve the
            // registry fresh again later and refuse to proceed if it no
            // longer matches — this pin is what a restart or a race can
            // never silently bypass.
            await ctx.wiring.cultureFetchStore.create({
              childRunId: childRun.id,
              parentRunId,
              organizationId: input.organizationId,
              company: input.company,
              sourceId: source.id,
              sourceType: source.sourceType,
              sourceLabel: source.sourceLabel,
              canonicalUrl: source.url,
              allowedRedirectOrigins: source.allowedRedirectOrigins,
              // TASK-011 remediation (2026-07-19, issue 7) — pin the FULL
              // security-policy snapshot, not just the URL, so materialize
              // can detect an eligibility/redirect-origin change at the SAME
              // URL between propose and materialize.
              policySnapshot: {
                registryVersion: computeSourcePolicyHash(source),
                eligibility: classifyCultureSource(source.sourceType).eligibility,
              },
              goalId: researchGoalTask.goalId,
              taskId: researchGoalTask.taskId,
              skill: "jobpilot.researchCultureSource",
              action: "read",
              actorId: LEARNING_AGENT,
            });

            // TASK-011 remediation (2026-07-19 coordinator distributed-
            // defects RE-review round 2, issue 6) — PREALLOCATE the
            // proposal's id and durably BIND it to the intent record BEFORE
            // any real ledger proposal can exist bearing that id. This
            // eliminates the "approvable orphan" crash window entirely
            // (rather than merely arguing a post-hoc window is inert): the
            // ONLY way `pipeline.propose` can produce an approvable
            // (`pending_review`) or auto-applied ledger row is via
            // `#appendLedger`, which honors `options.proposalId` — so by
            // construction, a real ledger row can only ever bear an id this
            // intent record was ALREADY bound to before propose() was even
            // called. `pipeline.propose`'s own internal rejection path
            // (`#reject`) always mints its OWN fresh id and never reaches
            // `pending_review`/`applied`, so a rejection leaves this bound
            // id permanently pointing at nothing — inert dead weight, never
            // approvable, never visible in `action.listPending`.
            const proposalId = ctx.run.ids.next();
            await ctx.wiring.cultureFetchStore.attachProposal(input.organizationId, childRun.id, proposalId);

            // PURE — no network access. Proposing this is genuinely side-effect-free.
            const proposal = await ctx.wiring.pipeline.propose(
              {
                organizationId: input.organizationId,
                actor: { type: "agent", id: LEARNING_AGENT, plane: "cloud" },
                onBehalfOf,
                action: "read" as Action,
                resourceType: "external:fetch" as ResourceType,
                skill: "jobpilot.researchCultureSource",
                dataScope: "public" as DataScope,
                inputs: { sourceId: source.id, organizationId: input.organizationId, company: input.company },
                taintLabel: labelAtSource("system_generated", {
                  ref: `culture-source-intent:${source.id}`,
                  valueHash: hashTaintValue({
                    organizationId: input.organizationId,
                    company: input.company,
                    sourceId: source.id,
                  }),
                  sensitivity: "public",
                  instructionRisk: "none",
                }),
                goalTaskRef: { goalId: researchGoalTask.goalId, taskId: researchGoalTask.taskId },
                context: { type: "child_agent_run", id: childRun.id, runId: parentRunId },
                // TASK-011 remediation (2026-07-19 coordinator distributed-
                // defects RE-review round 2, issue 9) — this Run's whole
                // purpose is to fetch UNTRUSTED external content (a company's
                // own public page, never operator/user-authored) — tag the
                // turn's provenance accordingly (PI-1) so it is threaded
                // through the persisted ledger row and any downstream taint
                // checks, never defaulting to an implicit "trusted" origin.
                trustOrigin: "untrusted_external",
              },
              ctx.run,
              { proposalId },
            );
            if (proposal.status === "rejected") {
              throw new TRPCError({ code: "BAD_REQUEST", message: proposal.rejectionReason ?? "culture-research proposal was rejected" });
            }
            pending.push({ proposalId: proposal.id, childRunId: childRun.id, sourceId: source.id, sourceType: source.sourceType, sourceLabel: source.sourceLabel });
          }

          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 13) — record this run as the LATEST for this
          // company via the durable O(1) pointer, replacing the organization-
          // wide scan `listByCompany` previously used by `latestRun`.
          await ctx.wiring.cultureLatestRunPointerStore.recordLatestRun(input.organizationId, input.company, parentRunId);

          return { parentRunId, pending, skipped };
        }),

      /** Real, guarded fetch — invoked ONLY after `action.decide` has approved
       * `proposalId` (re-checked from the ledger here, never trusted from the
       * caller). Idempotent: re-materializing an already-resolved source
       * returns the stored record instead of refetching. */
      materialize: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), proposalId: z.string().min(1), childRunId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          try {
            const record = await materializeCultureSourceFetch(
              {
                childAgentRuns: ctx.wiring.childAgentRuns,
                ledger: ctx.wiring.ledger,
                fetchStore: ctx.wiring.cultureFetchStore,
                abortControllers: ctx.wiring.cultureFetchAbortControllers,
              },
              input.organizationId,
              input.proposalId,
              input.childRunId,
              ctx.run,
            );
            return record;
          } catch (error) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
          }
        }),

      /** Cancels a pending/in-flight source fetch — aborts a REAL in-flight
       * request when one is running, or guarantees one never starts. */
      cancel: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), proposalId: z.string().min(1), childRunId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          try {
            const record = await cancelCultureSourceFetch(
              {
                childAgentRuns: ctx.wiring.childAgentRuns,
                ledger: ctx.wiring.ledger,
                fetchStore: ctx.wiring.cultureFetchStore,
                abortControllers: ctx.wiring.cultureFetchAbortControllers,
              },
              input.organizationId,
              input.proposalId,
              input.childRunId,
              { type: ctx.identity.type, id: ctx.identity.id },
              ctx.run,
            );
            return record;
          } catch (error) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
          }
        }),

      status: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), proposalId: z.string().min(1), childRunId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const record = await ctx.wiring.cultureFetchStore.getByProposal(input.organizationId, input.proposalId, input.childRunId);
          if (!record) {
            throw new TRPCError({ code: "NOT_FOUND", message: "unknown culture-research proposal" });
          }
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 3) — self-repair any intent/child terminal
          // inconsistency on every read a client polls, not only inside
          // `materialize`'s own retry path.
          await reconcileIntentChildConsistency(ctx.wiring, input.organizationId, record, ctx.run);
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 7) — never serve expired evidence: purge an
          // expired result's raw content on this read (idempotent,
          // metadata-preserving) and return the (possibly just-purged)
          // current record rather than the pre-purge snapshot.
          const purged = await ctx.wiring.cultureFetchStore.purgeExpiredResultContentIfNeeded(input.organizationId, input.childRunId, ctx.run.clock.nowISO());
          return purged ?? record;
        }),

      /**
       * Internal Strategist's synthesis — claims must GROUND against results
       * this run actually fetched (`groundClaims`, invoked inside the Skill).
       * Skipped sources are recomputed SERVER-SIDE from the registry (never
       * trusted from the client) so the disclosure is authoritative.
       */
      synthesize: authenticatedProcedure
        .input(
          z.object({
            organizationId: z.string().min(1),
            company: z.string().min(1),
            /** TASK-011 remediation (2026-07-18 final review, issue 6) — the
             * EXACT parent Agent Run this synthesis is scoped to. Fetched
             * results are resolved ONLY from this run's own child Runs,
             * never pooled across historical/concurrent runs for the same
             * company. */
            parentRunId: z.string().min(1),
            claims: z.array(
              z.object({
                id: z.string().min(1),
                claimType: z.enum(["fact", "opinion", "theme", "contradiction", "inference"]),
                quote: z.string().optional(),
                sourceId: z.string().optional(),
                contentHash: z.string().optional(),
                // TASK-011 remediation (2026-07-19 coordinator distributed-
                // defects RE-review, issue 11) — `authorContext` REMOVED
                // from the accepted input shape entirely. Accepting
                // arbitrary caller text here and rendering it verbatim as
                // "who said it" attribution was a genuine fabrication
                // vector; this slice's Tier-1 sources carry no
                // server-extracted per-claim author metadata to derive it
                // from honestly. `groundClaims` never assigns anything but
                // `null` to this field now regardless.
                supportingClaimIds: z.array(z.string()).optional(),
                contradicts: z.array(z.string()).optional(),
              }),
            ),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);

          // TASK-011 remediation (2026-07-18 final review, issue 6) — resolve
          // fetched results from THIS EXACT parent Run's own child Runs
          // only, via the durable `cultureFetchStore`, never by scanning
          // every fetch this organization/company has ever made (which would
          // silently pool evidence across historical or concurrent runs).
          const childRuns = await ctx.wiring.childAgentRuns.listByParentRun(input.organizationId, input.parentRunId);
          if (childRuns.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `unknown parent Run "${input.parentRunId}" for this organization` });
          }
          const intentRecords = (
            await Promise.all(childRuns.map((childRun) => ctx.wiring.cultureFetchStore.get(input.organizationId, childRun.id)))
          ).filter((r): r is NonNullable<typeof r> => r != null);
          const mismatchedCompany = intentRecords.find((r) => r.company !== input.company);
          if (mismatchedCompany) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `parent Run "${input.parentRunId}" does not belong to company "${input.company}"` });
          }
          const fetchedIntents = intentRecords.filter((r) => r.status === "fetched" && r.result);
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issues 7/8) — an EXPIRED result must never be
          // consumed by a NEW synthesis attempt ("never serve expired
          // evidence" applies to synthesis input, not just direct reads).
          // Treat an expired source as NOT fetched for this purpose —
          // `groundClaims` will then correctly reject any claim citing it
          // as `unknown-source`, rather than confusingly failing quote
          // verification against silently-blanked content.
          const nowISO = ctx.run.clock.nowISO();
          const unexpiredFetchedIntents = fetchedIntents.filter((r) => !isResultExpired(r.result!, nowISO));
          const seenSourceIds = new Set<string>();
          for (const r of unexpiredFetchedIntents) {
            if (seenSourceIds.has(r.sourceId)) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `duplicate fetched result for source "${r.sourceId}" under this run` });
            }
            seenSourceIds.add(r.sourceId);
          }
          const fetchedResults = unexpiredFetchedIntents.map((r) => r.result!);
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 8) — reject an EMPTY submission BEFORE ever
          // calling `pipeline.propose`/recording the synthesis pointer.
          // Without this, a caller could submit zero claims and/or find
          // zero unexpired fetched results, and STILL have a synthesis
          // proposal created and durably pointed to — poisoning the
          // first-write-wins synthesis pointer for this parentRunId with a
          // worthless/empty result BEFORE any real fetch has even
          // completed, permanently blocking a later legitimate synthesis
          // attempt from ever winning that pointer.
          if (input.claims.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "synthesize requires at least one claim — an empty submission is rejected before any proposal is created" });
          }
          if (fetchedResults.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "synthesize requires at least one unexpired fetched result for this parent Run — no claim can ground against zero evidence" });
          }
          const skippedSources = CULTURE_SOURCE_REGISTRY.filter(
            (s) => s.organizationId === input.organizationId && s.company === input.company && classifyCultureSource(s.sourceType).eligibility !== "permitted",
          ).map((s) => {
            const classification = classifyCultureSource(s.sourceType);
            return { sourceLabel: s.sourceLabel, sourceType: s.sourceType, reason: classification.reason };
          });

          const onBehalfOf = { type: (ctx.identity.type === "team" ? "team" : "user") as "user" | "team", id: ctx.identity.id };
          const synthesisGoalTask = await provisionCultureSynthesisTask(ctx.wiring, input.organizationId);

          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review round 2, issue 7) — self-heal a STALE pointer before
          // preallocating a new one. Preallocating the pointer before
          // `propose` (below) closes the "append-without-pointer orphan"
          // window, but introduces its mirror: a genuine process crash
          // strictly BETWEEN `recordProposal` succeeding and `propose` ever
          // creating a real ledger row would otherwise leave a dead pointer
          // that permanently blocks every future synthesis attempt for this
          // parentRunId (recordProposal is first-write-wins and would keep
          // refusing to rebind it). Detect this specific case — a pointer
          // whose proposalId does NOT resolve to any real ledger row at
          // all — and release it before this attempt's own preallocation. A
          // pointer whose proposalId DOES resolve (however that proposal was
          // ultimately decided) is left untouched here; that case is a live,
          // real synthesis and is not this function's concern.
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review round 2, issue 7 — hardened after a fresh independent
          // review found the original inline self-heal check unsafe: a bare
          // "ledger.get returned null" check cannot distinguish a genuinely
          // dead pointer (crash between recordProposal and propose) from a
          // live, in-flight concurrent synthesize() call for the SAME
          // parentRunId that simply hasn't reached #appendLedger yet — the
          // ORIGINAL version could self-heal (release + rebind) a still-live
          // winner's pointer out from under it, permanently orphaning their
          // soon-to-exist valid ledger row against the NEW
          // assertCultureProposalBindingValid backstop. `selfHealDeadSynthesisPointer`
          // additionally requires the pointer to be older than a grace
          // period before ever releasing it — see its own doc comment.
          await selfHealDeadSynthesisPointer(
            { cultureSynthesisPointerStore: ctx.wiring.cultureSynthesisPointerStore, ledger: ctx.wiring.ledger },
            input.organizationId,
            input.parentRunId,
            ctx.run.clock.nowISO(),
          );

          // PREALLOCATE the proposal id and durably record the (parentRunId
          // -> proposalId) pointer BEFORE any real ledger proposal can exist
          // bearing that id — the same preallocation pattern as the research
          // `propose` handler (issue 6). This closes the "append-without-
          // pointer orphan" crash window structurally rather than relying
          // solely on `synthesisResult`'s own self-repair (which still
          // requires a client-supplied proposalId and remains as defense in
          // depth for any pointer later lost/corrupted). `recordProposal` is
          // first-write-wins (`writeIfAbsent`): a losing concurrent
          // `synthesize` call for the SAME parentRunId now fails BEFORE ever
          // creating a real ledger proposal at all, rather than after.
          const proposalId = ctx.run.ids.next();
          try {
            await ctx.wiring.cultureSynthesisPointerStore.recordProposal(input.organizationId, input.parentRunId, input.company, proposalId);
          } catch (error) {
            throw new TRPCError({ code: "CONFLICT", message: error instanceof Error ? error.message : String(error) });
          }

          let synthesisProposal;
          try {
            synthesisProposal = await ctx.wiring.pipeline.propose(
              {
                organizationId: input.organizationId,
                actor: { type: "agent", id: INTERNAL_STRATEGIST_AGENT },
                onBehalfOf,
                action: "write" as Action,
                resourceType: "signal" as ResourceType,
                skill: "jobpilot.synthesizeCultureProfile",
                dataScope: "all" as DataScope,
                // TASK-011 remediation (2026-07-19 coordinator distributed-
                // defects RE-review round 2, issue 8) — NO result bodies
                // here. `req.inputs` is persisted VERBATIM into the
                // immutable ledger row by `pipeline.propose`; the Skill
                // resolves its own results internally (see
                // `createSynthesizeCultureProfileSkill`) so the ledger never
                // durably retains full raw fetched content.
                inputs: { organizationId: input.organizationId, parentRunId: input.parentRunId, claims: input.claims as GroundedClaimInput[], skippedSources },
                taintLabel: labelAtSource("web_search", {
                  ref: `culture-synthesis:${input.parentRunId}`,
                  valueHash: hashTaintValue({
                    claims: input.claims,
                    skippedSources,
                  }),
                  sensitivity: "public",
                  instructionRisk: "data",
                }),
                goalTaskRef: { goalId: synthesisGoalTask.goalId, taskId: synthesisGoalTask.taskId },
                // TASK-011 remediation (2026-07-19 coordinator distributed-
                // defects RE-review round 2, issue 9) — Internal Strategist
                // is reasoning DIRECTLY over untrusted external evidence
                // (the fetched results) here, even though the claims
                // themselves are grounded/validated — the turn's provenance
                // (PI-1) must reflect that, threaded through the persisted
                // ledger row, `action.decide`, and `synthesisResult`'s own
                // response (never silently defaulting to a trusted origin
                // just because the OUTPUT happens to be schema-validated).
                trustOrigin: "untrusted_external",
              },
              ctx.run,
              { proposalId },
            );
          } catch (error) {
            // The Skill threw synchronously (e.g. a claim-grounding failure)
            // BEFORE any real ledger row was ever created — release OUR OWN
            // preallocated pointer binding (never a different, concurrently-
            // won one) so a legitimate retry for this parentRunId is not
            // permanently blocked by a doomed attempt.
            await ctx.wiring.cultureSynthesisPointerStore.releaseIfMatching(input.organizationId, input.parentRunId, proposalId, ctx.wiring.ledger).catch(() => {});
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
          }
          if (synthesisProposal.status === "rejected") {
            // `#reject`'s ledger row bears its OWN auto-generated id, never
            // OUR preallocated one — release it the same way, for the same
            // reason (an authority/policy rejection must not permanently
            // consume the pointer for this parentRunId either).
            await ctx.wiring.cultureSynthesisPointerStore.releaseIfMatching(input.organizationId, input.parentRunId, proposalId, ctx.wiring.ledger).catch(() => {});
            throw new TRPCError({ code: "BAD_REQUEST", message: synthesisProposal.rejectionReason ?? "culture-research synthesis was rejected" });
          }
          return { proposalId: synthesisProposal.id, status: synthesisProposal.status };
        }),

      /**
       * TASK-011 remediation (2026-07-19 coordinator distributed-defects
       * review, issue 13) — the SERVER-AUTHORITATIVE resume query. Returns
       * the latest culture-research parent Run (and its pending sources +
       * synthesis proposal id, if any) for one (organizationId, company),
       * derived entirely from durable server state via
       * `DurableCultureFetchStore.listByCompany` +
       * `DurableCultureSynthesisPointerStore` — NEVER from anything the
       * client supplies. The web UI calls this on every mount and treats its
       * result as authoritative; any local `localStorage` pointer is only a
       * paint-ahead cache, overwritten by whatever this query returns
       * (including `null`, if the server has no record — e.g. storage from a
       * stale/foreign organization). This is what makes "clear storage / change
       * device, still see pending/completed research" possible.
       */
      latestRun: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), company: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 13) — an O(1) durable pointer lookup, NOT a
          // organization-wide scan-then-limit-then-filter (the prior
          // `listByCompany` approach, which could silently hide the real
          // latest run behind enough unrelated Memories at scale). The
          // pointer names the exact `parentRunId`; its pending sources are
          // then resolved via `childAgentRuns.listByParentRun` (already
          // indexed by organization+parentRunId) rather than any broad scan.
          const pointer = await ctx.wiring.cultureLatestRunPointerStore.getLatestRun(input.organizationId, input.company);
          if (!pointer) return null;
          const childRuns = await ctx.wiring.childAgentRuns.listByParentRun(input.organizationId, pointer.parentRunId);
          const intentRecords = (
            await Promise.all(childRuns.map((childRun) => ctx.wiring.cultureFetchStore.get(input.organizationId, childRun.id)))
          ).filter((r): r is NonNullable<typeof r> => r != null && r.company === input.company);
          const pending = intentRecords
            .filter((r) => r.proposalId)
            .map((r) => ({ proposalId: r.proposalId!, childRunId: r.childRunId, sourceId: r.sourceId, sourceType: r.sourceType, sourceLabel: r.sourceLabel }));
          const synthesisPointer = await ctx.wiring.cultureSynthesisPointerStore.getForParentRun(input.organizationId, pointer.parentRunId);
          return {
            parentRunId: pointer.parentRunId,
            pending,
            ...(synthesisPointer ? { synthesisProposalId: synthesisPointer.proposalId } : {}),
          };
        }),

      /**
       * Reads the PERSISTED, APPROVED synthesis result — TASK-011 remediation
       * (2026-07-18 final review, issue 7; hardened 2026-07-19 coordinator
       * distributed-defects review, issue 9). The web UI polls this instead of
       * holding any hand-authored culture data: before a synthesis proposal
       * is approved, this returns `{ status: "not_available" }`, an honest
       * empty state the UI must render as such, never as a placeholder claim.
       * Only an `approve` decision unlocks the real, grounded, cited
       * partition/disclosure the Skill produced — and only if the proposal
       * is GENUINELY a `jobpilot.synthesizeCultureProfile` output bound to
       * the caller's own (organizationId, company, parentRunId): an arbitrary
       * OTHER approved proposal (any skill), or a synthesis proposal for a
       * DIFFERENT run/company, is rejected as `not_available` rather than
       * rendered — never trust `resourceType`/`action`/a loose shape match
       * alone; the strict `synthesizeCultureProfileOutputSchema` AND a
       * re-derivation of the run's real fetched results must both agree.
       */
      synthesisResult: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), company: z.string().min(1), proposalId: z.string().min(1), parentRunId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const proposal = await ctx.wiring.ledger.get(input.proposalId);
          if (!proposal || proposal.organizationId !== input.organizationId) {
            return { status: "not_available" as const };
          }
          // Corroborate the Skill's identity via its declared action/resourceType
          // (LedgerEntry has no `skill` field of its own) — a proposal from ANY
          // other skill that happens to also be action:"write"/resourceType:"signal"
          // is still filtered out below by the strict output-schema parse plus
          // the parentRunId/result cross-check, but this is a cheap first gate.
          if (proposal.action !== "write" || proposal.resourceType !== "signal") {
            return { status: "not_available" as const };
          }
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 8) — the ACTOR must be the real Internal
          // Strategist Agent identity, not merely "some agent that happened
          // to write a signal". Corroborates the "exact persisted actor
          // binding" requirement directly from the immutable ledger row.
          if (proposal.actorType !== "agent" || proposal.actorId !== INTERNAL_STRATEGIST_AGENT) {
            return { status: "not_available" as const };
          }
          const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
          if (!decision || decision.userDecision !== "approve") {
            return { status: "not_available" as const };
          }
          const parsed = synthesizeCultureProfileOutputSchema.safeParse(
            proposal.proposedOutput,
          );
          if (!parsed.success) {
            // NOT a jobpilot.synthesizeCultureProfile output at all (or a
            // malformed/foreign one) — fail closed, never render it.
            return { status: "not_available" as const };
          }
          const result = parsed.data as SynthesizeCultureProfileOutput;
          if (result.parentRunId !== input.parentRunId) {
            return { status: "not_available" as const };
          }
          // Re-derive this run's REAL fetched results and cross-check every
          // `resultHashes` entry against them — a persisted result whose
          // hashes no longer match the run's own durable fetch records (e.g.
          // stale/tampered) must not be rendered as if it were still valid.
          const childRuns = await ctx.wiring.childAgentRuns.listByParentRun(input.organizationId, input.parentRunId);
          const intentRecords = (
            await Promise.all(childRuns.map((childRun) => ctx.wiring.cultureFetchStore.get(input.organizationId, childRun.id)))
          ).filter((r): r is NonNullable<typeof r> => r != null);
          const realCompanyMatch = intentRecords.every((r) => r.company === input.company);
          if (childRuns.length === 0 || !realCompanyMatch) {
            return { status: "not_available" as const };
          }
          const realHashesBySourceId = new Map(
            intentRecords.filter((r) => r.status === "fetched" && r.result).map((r) => [r.sourceId, r.result!.contentHash]),
          );
          const hashesMatch = result.resultHashes.every((a) => realHashesBySourceId.get(a.sourceId) === a.contentHash);
          if (!hashesMatch) {
            return { status: "not_available" as const };
          }
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 5) — self-repair the "propose crashed AFTER the
          // ledger append succeeded but BEFORE recordProposal ever ran"
          // window: this proposal is genuinely valid/approved/well-formed
          // (every check above already passed), so if the durable
          // synthesis-pointer binding for its parentRunId is missing or
          // stale, repair it now rather than leaving `latestRun`'s "resume"
          // flow permanently unable to discover an otherwise-perfectly-good
          // synthesis result. Idempotent and best-effort: a genuine
          // concurrent winner for the SAME parentRunId is left alone.
          const pointer = await ctx.wiring.cultureSynthesisPointerStore.getForParentRun(input.organizationId, input.parentRunId);
          if (!pointer || pointer.proposalId !== input.proposalId) {
            await ctx.wiring.cultureSynthesisPointerStore.recordProposal(input.organizationId, input.parentRunId, input.company, input.proposalId).catch(() => {
              // Another (also valid) proposal already legitimately holds
              // the pointer for this parentRunId — that is a real,
              // resolved outcome, not a bug to surface here; this read
              // path's job is only to REPAIR a missing binding, never to
              // fight over who owns it.
            });
          }
          return { status: "available" as const, proposalId: input.proposalId, approvedAt: decision.createdAt, result, trustOrigin: proposal.trustOrigin ?? null };
        }),
    }),
  }),

  /**
   * Resources — replaces the prototype's Supabase-direct `resources_canonical`
   * read (frontend-migration-scoping.md gap #4) with a governed, organization-
   * scoped catalog. Plain authenticated CRUD, not a pipeline action.
   */
  resources: t.router({
    create: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          title: z.string().min(1),
          kind: z.enum(["book", "podcast", "vlog", "article", "other"]),
          url: z.string().url().optional(),
          notes: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        return ctx.wiring.resourcesStore.create({
          organizationId: input.organizationId,
          title: input.title,
          kind: input.kind,
          ...(input.url ? { url: input.url } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          ...(input.tags ? { tags: input.tags } : {}),
        });
      }),

    list: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        const { items, total } = await ctx.wiring.resourcesStore.list(input.organizationId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),
  }),

  /**
   * Capability Trust Model (docs/wiki/vision.md). Register creates a `draft`
   * manifest with a COMPUTED risk band (never client-declared). Approve routes
   * a lifecycle transition through the pipeline's own decide() semantics — the
   * decider is ctx.identity (server-resolved), never the request body, and the
   * agent-floor blocks any agent from approving, same guarantee action.decide
   * relies on. Activate enforces requiredApproval + the daily auto-activation
   * budgets + the kill switch before flipping active/trusted.
   */
  capability: t.router({
    /** Register a new capability manifest. Always creates state=draft — "generation
     * only ever creates draft" (Capability Builder never activates). */
    register: procedure.input(capabilityRegisterInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const id = ctx.run.ids.next();

      // Pre-fetch the dependency closure's rows so computeRisk's resolver is a
      // plain synchronous lookup (risk.ts is deliberately store-free/pure).
      const depRows = new Map<string, CapabilityManifestRow>();
      for (const dep of input.dependencies) {
        const row = await ctx.wiring.capabilityStore.getManifest(dep.manifestId);
        if (row) depRows.set(dep.manifestId, row);
      }
      const coreManifest = toCoreManifest(id, input);
      const computedRisk = computeRisk(coreManifest, resolverFrom(depRows));

      const created = await ctx.wiring.capabilityStore.createManifest({
        id,
        organizationId: input.organizationId,
        capabilityType: input.capabilityType,
        name: input.name,
        version: input.version,
        origin: input.origin,
        audience: input.audience,
        manifest: input.manifest ?? { permissions: input.permissions, connectors: input.connectors },
        computedRisk,
        dependencies: input.dependencies,
      });
      const state = await ctx.wiring.capabilityStore.upsertState({
        manifestId: created.id,
        organizationId: input.organizationId,
        state: "draft",
        suspended: false,
        evidence: {},
      });
      return { manifest: created, state };
    }),

    /** draft -> validated. A plain forward step; no evidence gate at this stage. */
    submitForValidation: procedure.input(capabilityIdInput).mutation(async ({ input, ctx }) => {
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      try {
        const result = advance(state.state, toEvidence(state.evidence), ctx.run.clock.nowISO(), {
          creationRequiredApproval: false,
        });
        return ctx.wiring.capabilityStore.upsertState({
          manifestId: input.manifestId,
          organizationId: state.organizationId,
          state: result.nextState,
          ...(result.trustedUntil ? { trustedUntil: result.trustedUntil } : {}),
          suspended: state.suspended,
          ...(state.suspendReason ? { suspendReason: state.suspendReason } : {}),
          evidence: state.evidence,
        });
      } catch (err) {
        if (err instanceof CapabilityInvalidTransitionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

    /**
     * The Agent Quality Vector for one capability, computed from the governed
     * episodes it actually produced (A1-R1/F2).
     *
     * Read-only and deterministic: no model call, no write, no promotion side
     * effect. `reliability` and `efficiency` are nullable BY DESIGN — null means
     * "not measured", which is not the same as 0 ("measured and bad"), and callers
     * must render the difference rather than collapsing it.
     */
    quality: procedure
      .input(
        capabilityIdInput.extend({
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        const window = {
          ...(input.from ? { from: input.from } : {}),
          ...(input.to ? { to: input.to } : {}),
        };
        const { records, evidence } = await ctx.wiring.aqvSource.listAqvRecords(
          input.manifestId,
          window,
        );
        const aqv = computeAqv(records, window, evidence ?? {});
        return {
          ...aqv,
          capabilityId: input.manifestId,
          /** How many scored episodes carried an execution snapshot. Lets a caller
           * say "3 of 40 episodes instrumented" instead of implying full coverage. */
          instrumentedEpisodes: records.filter((r) => r.executionSnapshot !== undefined).length,
        };
      }),

    /**
     * Advance validated -> approved -> active -> trusted. This is the governed
     * step: it goes through the SAME pipeline decide() semantics action.decide
     * uses — approve is proposed as a pipeline action so a human decision (never
     * an agent) resolves it, and the attempt is audited either way. Entering
     * `trusted` additionally requires the evidence thresholds (lifecycle.ts);
     * an EvidenceThresholdError maps to 400, not a generic 500.
     */
    approve: procedure.input(capabilityIdInput).mutation(async ({ input, ctx }) => {
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });

      // Agents are blocked from approving a capability the same way they are
      // blocked from resolving any other proposal — resolve via the pipeline's
      // own propose/decide round trip so the agent-floor + audit trail apply
      // unchanged (additive use of the existing pipeline, not a bypass of it).
      const proposal = await ctx.wiring.pipeline.propose(
        {
          organizationId: state.organizationId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "approve",
          resourceType: "capability",
          resourceId: input.manifestId,
          inputs: { manifestId: input.manifestId, fromState: state.state },
          skill: "stageMutation",
        },
        ctx.run,
      );
      if (proposal.status === "pending_review") {
        return { proposal, state };
      }
      // Hard-stop on anything other than an authority-granted, auto-applied
      // decision — notably `"rejected"` (authority denied the action or the
      // agent-floor blocked it). Without this, every non-pending status fell
      // through into the state-advance mutation below, so a DENIED approve
      // still mutated (docs/BUGS.md "capability.approve ... mutate even when
      // the governed decision is rejected"). `ProposalStatus` is exactly
      // `"pending_review" | "applied" | "rejected"`, so this only ever
      // catches `"rejected"` here.
      if (proposal.status !== "applied") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: proposal.rejectionReason ?? "approval was not authorized",
        });
      }

      // EVAL-3 (§4.2): the baseline-vs-candidate "is it better than what we
      // already run?" gate, fired only on the promotion OUT of `validated`.
      // Gates come from policy_params (never hard-coded); the baseline is the
      // active predecessor of the same lineage. Absent a lineage baseline or
      // eval runs on both sides, the gate is not applicable and approve proceeds
      // unchanged (first-of-lineage has nothing to beat).
      let whyBetter: WhyBetterCard | undefined;
      if (state.state === "validated") {
        const manifestRow = await ctx.wiring.capabilityStore.getManifest(input.manifestId);
        const baselineId = manifestRow?.lineageManifestId ?? null;
        if (baselineId) {
          const [candRuns, baseRuns] = await Promise.all([
            ctx.wiring.evalStore.listRuns(input.manifestId, { limit: 1000, offset: 0 }),
            ctx.wiring.evalStore.listRuns(baselineId, { limit: 1000, offset: 0 }),
          ]);
          const candidate = candRuns.items.at(-1);
          const baseline = baseRuns.items.at(-1);
          if (candidate && baseline) {
            const gates = resolveGates(await ctx.wiring.policyParams.get(state.organizationId));
            const comparison = compareRuns(baseline, candidate, gates);
            whyBetter = buildWhyBetterCard(comparison, gates);
            if (comparison.verdict === "reject") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `capability.approve: candidate does not beat baseline — ${whyBetter.headline}`,
                cause: whyBetter,
              });
            }
            if (comparison.verdict !== "promote") {
              // coexist / needs-human: the automated gate declines to auto-advance;
              // the candidate stays validated pending an explicit human decision.
              return { proposal, state, comparison: whyBetter, advanced: false };
            }
          }
        }
      }

      let result;
      try {
        result = advance(state.state, toEvidence(state.evidence), ctx.run.clock.nowISO(), {
          creationRequiredApproval: false,
        });
      } catch (err) {
        if (err instanceof CapabilityInvalidTransitionError || err instanceof EvidenceThresholdError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
      const nextState = await ctx.wiring.capabilityStore.upsertState({
        manifestId: input.manifestId,
        organizationId: state.organizationId,
        state: result.nextState,
        ...(result.trustedUntil ? { trustedUntil: result.trustedUntil } : {}),
        suspended: state.suspended,
        ...(state.suspendReason ? { suspendReason: state.suspendReason } : {}),
        evidence: state.evidence,
      });
      return { proposal, state: nextState, ...(whyBetter ? { comparison: whyBetter } : {}) };
    }),

    /**
     * Activate: enforces requiredApproval (risk band x audience x trust grants)
     * + the daily auto-activation budgets + the organization kill switch before
     * treating an activation as auto-approved. A non-"auto" outcome does NOT
     * activate here — it reports the required approval band back to the
     * caller, which routes to `approve` (governance/explicit_human) or a
     * user-pref confirmation UI, matching "Generation != activation."
     */
    activate: procedure.input(capabilityActivateInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const manifestRow = await ctx.wiring.capabilityStore.getManifest(input.manifestId);
      if (!manifestRow) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest state" });

      const decision = await resolveActivationApproval({
        organizationId: input.organizationId,
        riskBand: manifestRow.computedRisk,
        audience: manifestRow.audience,
        trustGrants: [], // trust_grants lookup is a store-layer follow-up; none in force yet
        killSwitch: ctx.wiring.capabilityKillSwitch,
        budgets: ctx.wiring.capabilityBudgets,
        todayKey: input.todayKey,
      });

      if (decision.requirement !== "auto") {
        return { activated: false, decision, state };
      }

      if (decision.budgeted && (manifestRow.computedRisk === "informational" || manifestRow.computedRisk === "advisory")) {
        await ctx.wiring.capabilityBudgets.recordAutoActivation(input.organizationId, manifestRow.computedRisk, input.todayKey);
      }
      const nextState = await ctx.wiring.capabilityStore.upsertState({
        manifestId: input.manifestId,
        organizationId: input.organizationId,
        state: "active",
        suspended: false,
        evidence: state.evidence,
      });
      return { activated: true, decision, state: nextState };
    }),

    /** Failure -> suspend immediately. No approval needed — safety never queues. */
    suspend: procedure.input(capabilitySuspendInput).mutation(async ({ input, ctx }) => {
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      const result = suspendOnFailure(input.reason);
      return ctx.wiring.capabilityStore.upsertState({
        manifestId: input.manifestId,
        organizationId: state.organizationId,
        state: state.state,
        ...(state.trustedUntil ? { trustedUntil: state.trustedUntil } : {}),
        suspended: result.suspended,
        suspendReason: result.reason,
        evidence: state.evidence,
      });
    }),

    /** A dependency changed — demote trusted -> validated (no-op otherwise). */
    demoteOnDependencyChange: procedure.input(capabilityIdInput).mutation(async ({ input, ctx }) => {
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      const result = demoteOnDependencyChange(state.state, { creationRequiredApproval: false });
      return ctx.wiring.capabilityStore.upsertState({
        manifestId: input.manifestId,
        organizationId: state.organizationId,
        state: result.nextState,
        suspended: state.suspended,
        ...(state.suspendReason ? { suspendReason: state.suspendReason } : {}),
        evidence: state.evidence,
      });
    }),

    list: procedure.input(paginatedInput).query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const { items, total } = await ctx.wiring.capabilityStore.listManifests(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
      return { items, total, hasMore: input.offset + items.length < total };
    }),

    get: procedure.input(capabilityIdInput).query(async ({ input, ctx }) => {
      const manifest = await ctx.wiring.capabilityStore.getManifest(input.manifestId);
      if (!manifest) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      return { manifest, state };
    }),

    /**
     * GOV-1 — the Governance Agent's AUTOMATED approval, gated to the `minor`
     * band ONLY (classifyApprovalBand: the two lowest risk bands AND a built-in/
     * template origin). Moderate/major always route to a human — the Governance
     * Agent never auto-approves them. This encodes the system policy for which
     * capabilities may advance without a human; it does NOT make an agent the
     * ledger decider (the agent-floor forbids that unconditionally — see
     * pipeline.ts). A minor capability advances validated -> approved through the
     * SAME advance()+upsertState the human `approve` path uses.
     */
    governanceAutoApprove: procedure.input(capabilityIdInput).mutation(async ({ input, ctx }) => {
      const manifestRow = await ctx.wiring.capabilityStore.getManifest(input.manifestId);
      if (!manifestRow) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest state" });

      const band = classifyApprovalBand({ risk: manifestRow.computedRisk, origin: manifestRow.origin });
      if (!canGovernanceAutoApprove(band)) {
        // moderate / major → the Governance Agent refuses; a human must decide.
        return { autoApproved: false as const, band, state };
      }

      let result;
      try {
        result = advance(state.state, toEvidence(state.evidence), ctx.run.clock.nowISO(), {
          creationRequiredApproval: false,
        });
      } catch (err) {
        if (err instanceof CapabilityInvalidTransitionError || err instanceof EvidenceThresholdError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
      const nextState = await ctx.wiring.capabilityStore.upsertState({
        manifestId: input.manifestId,
        organizationId: state.organizationId,
        state: result.nextState,
        ...(result.trustedUntil ? { trustedUntil: result.trustedUntil } : {}),
        suspended: state.suspended,
        ...(state.suspendReason ? { suspendReason: state.suspendReason } : {}),
        evidence: state.evidence,
      });
      return { autoApproved: true as const, band, state: nextState };
    }),

    /**
     * GOV-1 — Governance Agent org-health rollup (agent-quality doc §7):
     * autonomy-pressure / trust-debt / approval-load / violation-trend as a pure
     * view over the organization's REAL capability manifests + states. Pending
     * proposals are the capabilities awaiting a governed approve/activate
     * decision (state validated|approved), risk = computedRisk. `violationSeries`
     * is an honest empty until a violation-history view lands (no fabricated
     * data — see CLAUDE.md's no-dummy-data rule). Renders for a organization.
     */
    orgHealth: procedure.input(paginatedInput).query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      const nowMs = Date.parse(ctx.run.clock.nowISO());
      const { items } = await ctx.wiring.capabilityStore.listManifests(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
      });
      const capabilities: CapabilityHealthRecord[] = [];
      const pendingProposals: PendingProposalRecord[] = [];
      for (const manifest of items) {
        const state = await ctx.wiring.capabilityStore.getState(manifest.id);
        if (!state) continue;
        capabilities.push({
          manifestId: manifest.id,
          state: state.state,
          successRate: state.evidence.successRate ?? 1,
          ...(state.trustedUntil
            ? { trustExpiresInDays: Math.ceil((Date.parse(state.trustedUntil) - nowMs) / 86_400_000) }
            : {}),
        });
        if (state.state === "validated" || state.state === "approved") {
          pendingProposals.push({
            proposalId: manifest.id,
            risk: manifest.computedRisk,
            ageHours: Math.max(0, (nowMs - Date.parse(state.updatedAt)) / 3_600_000),
          });
        }
      }
      return rollupOrgHealth({ capabilities, pendingProposals, violationSeries: [] });
    }),
  }),

  /**
   * P2 Capability modules (docs/raw/capability-module-format.md, ADR-018) —
   * the shipping unit ABOVE one capability_manifests row. Mirrors the
   * `capability` router's shape one level up: `register` always creates a
   * `private`-state installation row (generation != activation, same
   * invariant); `install` is the governed step — computes risk over the FULL
   * bundled+dependency closure (computeModuleRisk), applies the lethal-
   * trifecta union check, then routes through the SAME pipeline
   * propose/decide semantics `capability.approve`/`organization.blueprint.activate`
   * use (external band = same non-removable hard floor). `promote`/`rollback`
   * enforce single-live-version-per-organization (packages/core/src/module/
   * lifecycle.ts) — promoting auto-demotes the prior available version;
   * rollback forks a NEW draft from history, never an in-place revert.
   */
  modules: t.router({
    /** Real local-plane File inventory for one installed Module. */
    files: authenticatedProcedure
      .input(z.object({ organizationId: z.string().min(1), moduleName: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const installation = await ctx.wiring.moduleStore.getAvailable(input.organizationId, input.moduleName);
        if (!installation || installation.status !== "installed") {
          throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.moduleName}" not found` });
        }
        try {
          const inventory = await ctx.wiring.organizationStore.withLockedOrganizationFiles(
            input.organizationId,
            (organization) => listModuleFiles(
              organization.name,
              installation.manifest.module?.displayName ?? installation.moduleName,
              200,
              ctx.wiring.moduleFilesBridgeRoot,
            ),
          );
          await Promise.all(inventory.items.map((file) =>
            ctx.wiring.graphStore.indexModuleFile({
              organizationId: input.organizationId,
              ownerUserId: ctx.identity.id,
              moduleId: installation.id,
              moduleName: installation.moduleName,
              ...file,
            }),
          ));
          return inventory;
        } catch (error) {
          if (error instanceof ModuleFilesPathError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          throw error;
        }
      }),

    addFile: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().min(1),
        moduleName: z.string().min(1),
        fileName: z.string().trim().min(1).max(255),
        contentBase64: z.string().max(Math.ceil(MAX_MODULE_FILE_BYTES * 4 / 3) + 4).regex(
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
          "File content must be valid base64",
        ),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const installation = await ctx.wiring.moduleStore.getAvailable(input.organizationId, input.moduleName);
        if (!installation || installation.status !== "installed") {
          throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.moduleName}" not found` });
        }
        const content = Buffer.from(input.contentBase64, "base64");
        if (content.byteLength > MAX_MODULE_FILE_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `File exceeds the ${MAX_MODULE_FILE_BYTES}-byte local File limit`,
          });
        }
        try {
          const file = await ctx.wiring.organizationStore.withLockedOrganizationFiles(
            input.organizationId,
            (organization) => saveModuleFile(
              organization.name,
              installation.manifest.module?.displayName ?? installation.moduleName,
              input.fileName,
              content,
              ctx.wiring.moduleFilesBridgeRoot,
            ),
          );
          await ctx.wiring.graphStore.indexModuleFile({
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            moduleId: installation.id,
            moduleName: installation.moduleName,
            ...file,
          });
          return file;
        } catch (error) {
          if (error instanceof ModuleFilesPathError || error instanceof RangeError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          throw error;
        }
      }),

    /** Register a module manifest. Always creates state=private, status=
     * pending_review — no risk computed yet (that happens at `install`). */
    register: procedure.input(moduleRegisterInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      let manifest: ModuleManifest;
      try {
        manifest = parseModuleManifest(input.manifest);
      } catch (err) {
        if (err instanceof ModuleManifestValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
      const created = await ctx.wiring.moduleStore.create({
        organizationId: input.organizationId,
        moduleName: manifest.name,
        moduleVersion: manifest.version,
        manifest,
        computedRisk: "informational", // not yet computed — install() computes it
        state: "private",
        status: "pending_review",
        lineageManifestId: manifest.lineageManifestId,
      });
      return { installation: created };
    }),

    /**
     * Install = a governed proposal through the EXISTING pipeline, exactly
     * like `capability.approve` (docs/raw/capability-module-format.md §2).
     * Computes risk over the module's own capabilities AND every resolvable
     * module dependency's capabilities, applies the lethal-trifecta union
     * check (private-read + untrusted-ingest + egress ACROSS different bundled
     * capabilities still escalates to `external`), then defers to
     * requiredApproval/resolveActivationApproval via the same pipeline round
     * trip `capability.approve` uses — an agent can never resolve this, and
     * every attempt is audited whether auto-resolved or parked pending_review.
     */
    install: procedure.input(moduleInstallInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const installation = await ctx.wiring.moduleStore.get(input.installationId);
      if (!installation || installation.organizationId !== input.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown module installation" });
      }
      if (installation.state !== "private") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `module installation must be private before install, got ${installation.state}`,
        });
      }
      const currentCommonsEntry = await assertCurrentCommonsAttachment(ctx.wiring, installation);

      // PKG-1 sandbox floor (Month-6): an executable capability may only install
      // when its declared isolation satisfies the sandbox gate — no
      // `isolation: "none"`, and any capability whose sandbox grants network/
      // filesystem needs a real container/VM boundary (process isolation is not
      // a boundary). A half-declared executable is rejected here rather than
      // reaching Active unsandboxed. Declarative capabilities pass trivially.
      for (const cap of installation.manifest.capabilities) {
        const sandbox = evaluateSandboxRequirement(cap);
        if (!sandbox.satisfied) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `capability "${cap.name}" cannot be installed: ${sandbox.reason} (declared isolation "${sandbox.isolation}")`,
          });
        }
      }

      // Resolve capability dependencies (by manifestId, ignoring versionRange —
      // capability-level dependency resolution is unversioned in the existing
      // capability.register path too) via the organization's registered capability
      // manifests, and module dependencies via other installations of this
      // organization's module store (name+version exact match, per the no-ranges rule).
      const capDepRows = new Map<string, CapabilityManifestRow>();
      const bundledCapabilities = new Map<string, CapabilityManifest>();
      for (const capability of installation.manifest.capabilities) {
        bundledCapabilities.set(capability.id, capability);
        bundledCapabilities.set(capability.name, capability);
      }
      for (const cap of installation.manifest.capabilities) {
        for (const dep of cap.dependencies) {
          if (bundledCapabilities.has(dep.manifestId)) continue;
          if (!z.string().uuid().safeParse(dep.manifestId).success) continue;
          const row = await ctx.wiring.capabilityStore.getManifest(dep.manifestId);
          if (row) capDepRows.set(dep.manifestId, row);
        }
      }
      const resolveCapabilityDependency = (id: string): CapabilityManifest | undefined => {
        const bundled = bundledCapabilities.get(id);
        if (bundled) return bundled;
        const row = capDepRows.get(id);
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
      const { items: allInstallations } = await ctx.wiring.moduleStore.list(input.organizationId, { limit: 10000, offset: 0 });
      const verifiedCommonsDependencies = new Map<string, ModuleManifest>();
      const verifiedDependencyInstallations = new Map<string, ModuleInstallationRow>();
      if (installation.moduleAttachment) {
        const rootEntry = currentCommonsEntry!;
        const pins = new Map<string, string>(
          rootEntry.securityScan.dependencyPins
            ?.map((pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const) ?? [],
        );
        const visited = new Set<string>();
        const verifyDependencyClosure = async (manifest: ModuleManifest): Promise<void> => {
          for (const dependency of manifest.dependencies) {
            const key = `${dependency.manifestId}@${dependency.version}`;
            if (visited.has(key)) continue;
            visited.add(key);
            const expectedHash = pins.get(key);
            const entry = await ctx.wiring.commonsRegistry.getVersion(dependency.manifestId, dependency.version);
            if (!entry || !expectedHash || entry.integrity.value !== expectedHash) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" does not match its signed content-hash pin`,
              });
            }
            try {
              assertCommonsEntryContentTrusted(entry);
            } catch (err) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: err instanceof Error ? err.message : `Commons dependency "${key}" failed trust verification`,
              });
            }
            const local = allInstallations.find(
              (candidate) =>
                candidate.moduleName === dependency.manifestId &&
                candidate.moduleVersion === dependency.version &&
                candidate.moduleAttachment?.source === "commons" &&
                candidate.moduleAttachment.ownerModuleName === installation.moduleAttachment?.ownerModuleName &&
                candidate.moduleAttachment.agentId === installation.moduleAttachment?.agentId &&
                candidate.moduleAttachment.needId === installation.moduleAttachment?.needId &&
                candidate.moduleAttachment.contentHash === expectedHash,
            );
            if (!local) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" was not staged from its pinned result`,
              });
            }
            if (!["private", "promoted", "available"].includes(local.state)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" cannot activate from state "${local.state}"`,
              });
            }
            verifiedCommonsDependencies.set(key, entry.manifest);
            verifiedDependencyInstallations.set(key, local);
            for (const pin of entry.securityScan.dependencyPins ?? []) {
              pins.set(`${pin.name}@${pin.version}`, pin.contentHash);
            }
            await verifyDependencyClosure(entry.manifest);
          }
        };
        await verifyDependencyClosure(installation.manifest);
      }
      const installManifests = [installation.manifest, ...verifiedCommonsDependencies.values()];
      const installCapabilities = installManifests.flatMap((manifest) => manifest.capabilities);
      for (const capability of installCapabilities) {
        bundledCapabilities.set(capability.id, capability);
        bundledCapabilities.set(capability.name, capability);
        for (const dependency of capability.dependencies) {
          if (bundledCapabilities.has(dependency.manifestId)) continue;
          if (!z.string().uuid().safeParse(dependency.manifestId).success) continue;
          const row = await ctx.wiring.capabilityStore.getManifest(dependency.manifestId);
          if (row) capDepRows.set(dependency.manifestId, row);
        }
      }
      const resolveModuleDependency = (name: string, version: string) =>
        installation.moduleAttachment
          ? verifiedCommonsDependencies.get(`${name}@${version}`)
          : allInstallations.find((i) => i.moduleName === name && i.moduleVersion === version)?.manifest;

      const computedRisk = computeModuleRisk(
        installation.manifest,
        resolveCapabilityDependency,
        resolveModuleDependency,
      );
      const signedRiskFloor = installation.moduleAttachment
        ? installation.computedRisk
        : "informational";
      const risk = {
        ...computedRisk,
        compositeRisk: maxRisk(computedRisk.compositeRisk, signedRiskFloor),
        effectiveRisk: maxRisk(computedRisk.effectiveRisk, signedRiskFloor),
      };

      // Module-wide audience: the strictest (most-restrictive-raising) audience
      // across its own bundled capabilities — mirrors raiseForAudience's
      // "audience only ever raises, never lowers" contract at the module level.
      const audiences = installCapabilities.map((c) => c.audience);
      const audience = audiences.includes("external_visible")
        ? "external_visible"
        : audiences.includes("team")
          ? "team"
          : "private";

      // PKG-2 community-origin floor input: a module is treated at its
      // LEAST-trusted capability origin — if any bundled capability is
      // community/user_code (untrusted), the whole install is floored there.
      const resolvedTrustGrants: TrustGrantView[] = []; // store-layer follow-up (same gap capability.activate has)
      const floorOrigin: CapabilityOrigin = installCapabilities.some((c) => isUntrustedOrigin(c.origin))
        ? "community"
        : "built_in";

      const decision = await resolveActivationApproval({
        organizationId: input.organizationId,
        riskBand: risk.effectiveRisk,
        audience,
        // PKG-2 community-origin floor: an untrusted origin (community/user_code)
        // never receives trust-grant auto-activation — community is pinned to the
        // same tier as unreviewed local code, so it can never auto-trust above it.
        trustGrants: trustGrantsForOrigin(floorOrigin, resolvedTrustGrants),
        killSwitch: ctx.wiring.capabilityKillSwitch,
        budgets: ctx.wiring.capabilityBudgets,
        todayKey: input.todayKey,
      });

      // Every capability in the module is registered via the EXISTING
      // capability.register path's semantics (draft state, never active) —
      // registration != activation, same invariant capability.register itself
      // enforces. This happens regardless of the approval outcome, mirroring
      // "install_flow.1_propose" in the format doc (registration precedes the
      // approval decision).
      //
      // Idempotency (ADR-024): re-installing a module version whose bundled
      // capability keeps the SAME (name, version) must not collide with
      // `capability_manifests_uq`. Check-before-insert via
      // `getManifestByNameVersion` (the natural key the unique constraint
      // enforces) and reuse the existing manifest row instead of re-creating
      // it — a second install of the identical capability is a no-op
      // re-registration, not a new manifest.
      const registeredManifestIds: string[] = [];
      for (const cap of installCapabilities) {
        const existingManifest = await ctx.wiring.capabilityStore.getManifestByNameVersion(
          input.organizationId,
          cap.name,
          cap.version,
        );
        const capId = existingManifest?.id ?? ctx.run.ids.next();
        if (
          existingManifest &&
          canonicalizeJson({
            capabilityType: existingManifest.capabilityType,
            name: existingManifest.name,
            version: existingManifest.version,
            origin: existingManifest.origin,
            audience: existingManifest.audience,
            manifest: existingManifest.manifest,
            dependencies: existingManifest.dependencies,
          }) !== canonicalizeJson({
            capabilityType: cap.capabilityType,
            name: cap.name,
            version: cap.version,
            origin: cap.origin,
            audience: cap.audience,
            manifest: { permissions: cap.permissions, connectors: cap.connectors },
            dependencies: cap.dependencies,
          })
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `capability "${cap.name}" v${cap.version} already exists with different signed content`,
          });
        }
        if (!existingManifest) {
          await ctx.wiring.capabilityStore.createManifest({
            id: capId,
            organizationId: input.organizationId,
            capabilityType: cap.capabilityType,
            name: cap.name,
            version: cap.version,
            origin: cap.origin,
            audience: cap.audience,
            manifest: { permissions: cap.permissions, connectors: cap.connectors },
            computedRisk: risk.effectiveRisk,
            dependencies: cap.dependencies,
          });
        }
        const existingState = existingManifest
          ? await ctx.wiring.capabilityStore.getState(capId)
          : null;
        if (!existingState) {
          await ctx.wiring.capabilityStore.upsertState({
            manifestId: capId,
            organizationId: input.organizationId,
            state: "draft",
            suspended: false,
            evidence: {},
          });
        }
        registeredManifestIds.push(capId);
      }

      const rerisked = await ctx.wiring.moduleStore.setComputedRisk(installation.id, risk.effectiveRisk);

      if (decision.requirement !== "auto") {
        const proposalId = stableModuleInstallProposalId(input.organizationId, installation.id);
        const priorDecision = await ctx.wiring.ledger.decisionFor(proposalId);
        if (priorDecision) {
          if (priorDecision.userDecision === "approve" || priorDecision.userDecision === "edit") {
            const finalized = await activateApprovedModuleInstallation(
              ctx.wiring,
              input.organizationId,
              installation.id,
            );
            return {
              installed: true,
              decision,
              risk,
              installation: finalized,
              registeredManifestIds,
              reconciled: true as const,
            };
          }
          throw new TRPCError({
            code: "CONFLICT",
            message: "module install proposal was vetoed; stage a new signed module version to retry",
          });
        }
        let proposal: Proposal | null = await findPendingProposalById(
          ctx.wiring,
          input.organizationId,
          proposalId,
        );
        if (!proposal) {
          try {
            proposal = await ctx.wiring.pipeline.propose(
              {
                organizationId: input.organizationId,
                actor: { type: ctx.identity.type, id: ctx.identity.id },
                action: "write",
                resourceType: "module_installation",
                resourceId: moduleInstallationLedgerResourceId(
                  input.organizationId,
                  installation.id,
                ),
                inputs: {
                  operation: "module_install",
                  installationId: installation.id,
                  moduleName: installation.moduleName,
                  effectiveRisk: risk.effectiveRisk,
                },
                skill: "stageMutation",
              },
              ctx.run,
              { proposalId, requireHumanReview: true },
            );
          } catch (cause) {
            proposal = await findPendingProposalById(ctx.wiring, input.organizationId, proposalId);
            if (!proposal) throw cause;
          }
        }
        if (proposal.status !== "pending_review") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: proposal.rejectionReason ?? "module install proposal did not reach Human review",
          });
        }
        return { installed: false, decision, risk, proposal, installation: rerisked, registeredManifestIds };
      }

      if (decision.budgeted && (risk.effectiveRisk === "informational" || risk.effectiveRisk === "advisory")) {
        await ctx.wiring.capabilityBudgets.recordAutoActivation(input.organizationId, risk.effectiveRisk, input.todayKey);
      }

      await assertCurrentCommonsAttachment(ctx.wiring, installation);
      const installed = await ctx.wiring.moduleStore.setStatus(installation.id, "installed");
      const installedWithRisk: ModuleInstallationRow = { ...installed, computedRisk: risk.effectiveRisk };
      for (const dependency of verifiedDependencyInstallations.values()) {
        await ctx.wiring.moduleStore.setComputedRisk(
          dependency.id,
          maxRisk(dependency.computedRisk, risk.effectiveRisk),
        );
        await ctx.wiring.moduleStore.setStatus(dependency.id, "installed");
        let promotable = dependency;
        if (promotable.state === "private") {
          promotable = await ctx.wiring.moduleStore.setState(promotable.id, "promoted");
        }
        if (promotable.state === "promoted") {
          const currentAvailable = await ctx.wiring.moduleStore.getAvailable(
            input.organizationId,
            promotable.moduleName,
            promotable.moduleAttachment,
          );
          const promotion = promoteToAvailable(promotable, currentAvailable);
          await ctx.wiring.moduleStore.setState(
            promotion.promoted.installationId,
            promotion.promoted.nextState,
          );
          if (promotion.demoted) {
            await ctx.wiring.moduleStore.setState(
              promotion.demoted.installationId,
              promotion.demoted.nextState,
            );
          }
        }
      }
      const advanced = await ctx.wiring.moduleStore.setState(installation.id, advanceModuleState(installation.state));
      return {
        installed: true,
        decision,
        risk,
        installation: { ...advanced, computedRisk: risk.effectiveRisk, status: installedWithRisk.status },
        registeredManifestIds,
      };
    }),

    reconcileApproved: authenticatedProcedure
      .input(z.object({ proposalId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const proposal = await ctx.wiring.ledger.get(input.proposalId);
        if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
        assertPilotOrganization(proposal.organizationId);
        await assertMembership(ctx.wiring.organizationStore, proposal.organizationId, ctx.identity.id);
        const installationId = moduleInstallIdFromProposal(proposal);
        if (!installationId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "proposal is not a module install approval" });
        }
        const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
        if (decision?.userDecision !== "approve" && decision?.userDecision !== "edit") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "module install proposal is not approved" });
        }
        const installation = await activateApprovedModuleInstallation(
          ctx.wiring,
          proposal.organizationId,
          installationId,
        );
        return { installation, proposalId: input.proposalId };
      }),

    list: authenticatedProcedure.input(paginatedInput).query(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const { items, total } = await ctx.wiring.moduleStore.list(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
        ...(ctx.wiring.publicCloudOnly ? { installedRootsOnly: true } : {}),
      });
      const itemsWithRuntimeBindings = await Promise.all(
        items.map(async (installation) => {
          const runtimeAutomationIds: string[] = [];
          const runtimeSkillIds: string[] = [];
          const runtimeBindingIssues: string[] = [];
          for (const automation of installation.manifest.module?.automations ?? []) {
            if (!automation.automationId) continue;
            const automationId = resolveModuleAutomationRuntimeId(installation.moduleName, automation.automationId);
            const agentId = resolveModuleAgentRuntimeId(installation.moduleName, automation.agentId);
            const definition = automationId
              ? await ctx.wiring.automationRegistry.load(input.organizationId, automationId)
              : null;
            if (automationId && agentId && definition?.agentId === agentId) {
              runtimeAutomationIds.push(automation.id);
            }
          }
          const attachment = installation.moduleAttachment;
          if (
            attachment
            && isSupportedCitedRoleModelInstallation(installation)
          ) {
            try {
              const currentEntry = await assertCurrentCommonsAttachment(
                ctx.wiring,
                installation,
              );
              if (!currentEntry || !isSupportedCitedRoleModelManifest(currentEntry.manifest)) {
                runtimeBindingIssues.push(
                  "The current signed Commons result no longer matches the supported runtime contract",
                );
              } else if (!await currentSupportedRelationshipOwner(ctx.wiring, installation)) {
                runtimeBindingIssues.push(
                  "The owning Relationship Module no longer matches the supported runtime contract",
                );
              } else {
                runtimeSkillIds.push(
                  LEARNING_RECOMMENDATION_SKILL_ID,
                );
              }
            } catch (error) {
              runtimeBindingIssues.push(
                error instanceof TRPCError
                  ? error.message
                  : "Commons registry is unavailable; the runtime binding could not be revalidated",
              );
            }
          }
          return {
            ...installation,
            runtimeAutomationIds,
            runtimeSkillIds,
            runtimeBindingIssues,
          };
        }),
      );
      return {
        items: itemsWithRuntimeBindings,
        total,
        hasMore: input.offset + itemsWithRuntimeBindings.length < total,
      };
    }),

    recentRuns: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        moduleName: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(10),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const installation = await ctx.wiring.moduleStore.getAvailable(
          input.organizationId,
          input.moduleName,
        );
        if (
          !installation ||
          installation.status !== "installed" ||
          !installation.manifest.module ||
          installation.moduleAttachment
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "installed Module not found" });
        }
        const runtimeAutomations = new Map<string, {
          id: string;
          name: string;
        }>();
        for (const automation of installation.manifest.module.automations) {
          if (!automation.automationId) continue;
          const runtimeId = resolveModuleAutomationRuntimeId(
            installation.moduleName,
            automation.automationId,
          );
          if (runtimeId) {
            runtimeAutomations.set(runtimeId, {
              id: automation.id,
              name: automation.name,
            });
          }
        }
        const runs = await ctx.wiring.automationRunRecorder.list(
          input.organizationId,
          [...runtimeAutomations.keys()],
          { limit: input.limit },
        );
        return {
          items: runs.map((run) => ({
            ...run,
            manifestAutomationId: runtimeAutomations.get(run.automationId)?.id ?? run.automationId,
            automationName: runtimeAutomations.get(run.automationId)?.name ?? run.automationId,
          })),
        };
      }),

    get: authenticatedProcedure.input(moduleIdInput).query(async ({ input, ctx }) => {
      const installation = await ctx.wiring.moduleStore.get(input.installationId);
      if (!installation) throw new TRPCError({ code: "NOT_FOUND", message: "unknown module installation" });
      await assertMembership(ctx.wiring.organizationStore, installation.organizationId, ctx.identity.id);
      return { installation };
    }),

    /**
     * Promote a `promoted`-state installation to `available`, auto-demoting
     * whatever installation is currently `available` for the same module
     * name in this organization — never two live versions side by side
     * (packages/core/src/module/lifecycle.ts's promoteToAvailable).
     */
    promote: procedure.input(modulePromoteInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const target = await ctx.wiring.moduleStore.get(input.installationId);
      if (!target || target.organizationId !== input.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown module installation" });
      }
      const currentCommonsEntry = await assertCurrentCommonsAttachment(ctx.wiring, target);
      await verifiedCommonsDependencyInstallations(ctx.wiring, target, currentCommonsEntry);
      const currentlyAvailable = await ctx.wiring.moduleStore.getAvailable(
        input.organizationId,
        target.moduleName,
        target.moduleAttachment,
      );
      let result;
      try {
        result = promoteToAvailable(target, currentlyAvailable);
      } catch (err) {
        if (err instanceof InvalidModuleTransitionError || err instanceof Error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
      const promoted = await ctx.wiring.moduleStore.setState(result.promoted.installationId, result.promoted.nextState);
      if (result.demoted) {
        await ctx.wiring.moduleStore.setState(result.demoted.installationId, result.demoted.nextState);
      }
      return { installation: promoted };
    }),

    /**
     * Rollback = fork a NEW draft installation from a historical version,
     * never an in-place revert (append-only-ledger invariant, matches every
     * other Bridge mutation). The forked row still needs its own `install` to
     * go live — rollback alone does not activate it.
     */
    rollback: procedure.input(moduleRollbackInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      const rollbackTarget = await ctx.wiring.moduleStore.get(input.rollbackTargetId);
      if (!rollbackTarget || rollbackTarget.organizationId !== input.organizationId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown rollback target installation" });
      }
      const currentAvailable = await ctx.wiring.moduleStore.getAvailable(
        input.organizationId,
        rollbackTarget.moduleName,
        rollbackTarget.moduleAttachment,
      );
      if (!currentAvailable) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `module "${rollbackTarget.moduleName}" has no currently-available version to roll back from` });
      }
      const forked = rollbackFromHistory({ currentAvailable, rollbackTarget });
      const created = await ctx.wiring.moduleStore.create(forked);
      return { installation: created };
    }),
  }),

  // ---------------------------------------------------------------------------
  // CM0 — Universal Commons registry tRPC surface (egg-commons-feature-roadmap
  // §CM0). Wires the CommonsRegistry port (wiring.commonsRegistry, backed by
  // HttpCommonsClient → services/commons :4780) as tRPC procedures so the web
  // app can browse, fetch, and initiate governed installs from the registry
  // without importing HTTP client code directly.
  //
  // Governance notes:
  //  - list/get/getVersion are read queries, no auth guard needed (same policy
  //    as every other .query in this router).
  //  - installPropose is a mutation, so the authenticated procedure gate applies.
  //    It fetches from the registry (PKG-2 verify-on-install via HttpCommonsClient),
  //    registers the manifest in the organization module store (state=private), and
  //    returns the installationId. The caller then calls `modules.install` for the
  //    full governed proposal → pipeline → approval flow — no logic duplication.
  //  - publishBuiltins is a mutation → same auth gate. Pushes curated built-in
  //    modules to the running Commons service. Idempotent:
  //    already-published versions are skipped, not failed.
  //  - ALL protected procedures still go through the authentication middleware and
  //    withPilotOrganizationGuard (error translation).
  // ---------------------------------------------------------------------------

  commons: t.router({
    /** Browse the registry — filterable by kind and/or tag, paginated. */
    list: procedure
      .input(
        z.object({
          kind: z.enum(["organization_definition", "skill", "automation", "agent", "module", "view", "integration_bundle"]).optional(),
          tag: z.string().optional(),
          search: z.string().trim().min(1).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        const query: CommonsListQuery = {};
        if (input.kind !== undefined) query.kind = input.kind;
        if (input.tag !== undefined) query.tag = input.tag;
        if (input.search !== undefined) query.search = input.search;
        if (input.limit !== undefined) query.limit = input.limit;
        if (input.offset !== undefined) query.offset = input.offset;
        return ctx.wiring.commonsRegistry.listAvailable(query);
      }),

    /** Module detail (latest + version history) for one module by name. */
    get: procedure
      .input(z.object({ name: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const detail: CommonsModuleDetail | null = await ctx.wiring.commonsRegistry.get(input.name);
        if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: `commons: module "${input.name}" not found` });
        return detail;
      }),

    /** One exact published version's full entry. */
    getVersion: procedure
      .input(z.object({ name: z.string().min(1), version: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const entry = await ctx.wiring.commonsRegistry.getVersion(input.name, input.version);
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: `commons: ${input.name}@${input.version} not found` });
        }
        return entry;
      }),

    /**
     * Install-from-Commons Step 1: fetch a module from the registry (PKG-2
     * verify-on-install happens inside HttpCommonsClient.get/getVersion), validate
     * its manifest, and register it in the organization module store as a private
     * installation. Returns the installationId so the caller can then drive the
     * governed install flow via `modules.install(installationId, todayKey)`.
     *
     * Separating fetch+register from install keeps the governed proposal logic
     * inside the existing `modules.install` handler — no duplication.
     */
    installPropose: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          name: z.string().min(1),
          /** Omit to install the latest version. */
          version: z.string().optional(),
          ownerModuleName: z.string().min(1).optional(),
          agentId: z.string().min(1).optional(),
          needId: z.string().min(1).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);

        // Fetch from registry — HttpCommonsClient verifies the publisher signature (PKG-2).
        const entry = input.version
          ? await ctx.wiring.commonsRegistry.getVersion(input.name, input.version)
          : await ctx.wiring.commonsRegistry.get(input.name).then((d) => d?.latest ?? null);

        if (!entry) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: input.version
              ? `commons: ${input.name}@${input.version} not found`
              : `commons: module "${input.name}" not found`,
          });
        }
        try {
          assertCommonsEntryContentTrusted(entry);
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err instanceof Error ? err.message : "Commons entry failed install-time trust verification",
          });
        }
        // Re-validate the manifest at this seam (same guard modules.register uses).
        let manifest: ModuleManifest;
        try {
          manifest = parseModuleManifest({ module: entry.manifest });
        } catch (err) {
          if (err instanceof ModuleManifestValidationError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `commons manifest invalid: ${err.message}` });
          }
          throw err;
        }
        const privacyPaths = findOrganizationDataPaths(entry.manifest);
        if (privacyPaths.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Commons manifest contains Organization data (${privacyPaths.join(", ")})`,
          });
        }
        const rootModule = manifest.kind === "organization_definition";
        const attachmentFields = [input.ownerModuleName, input.agentId, input.needId];
        if (rootModule) {
          if (!manifest.module) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Organization-definition Module has no installable Module surface" });
          }
          if (attachmentFields.some((value) => value !== undefined)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Root Module installation cannot attach beneath another Module Agent" });
          }
        } else if (
          manifest.kind !== "skill" ||
          manifest.capabilities.length === 0 ||
          manifest.capabilities.some((capability) => capability.capabilityType !== "skill")
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Commons install supports only a signed Organization-definition root Module or a declared Skill need",
          });
        }
        let ownerModule: ModuleInstallationRow | undefined;
        let need: ModuleCapabilityNeed | undefined;
        if (!rootModule) {
          if (attachmentFields.some((value) => value === undefined)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Skill attachment requires ownerModuleName, agentId, and needId" });
          }
          ownerModule = (await ctx.wiring.moduleStore.getAvailable(input.organizationId, input.ownerModuleName!)) ?? undefined;
          if (!ownerModule || ownerModule.status !== "installed" || !ownerModule.manifest.module) {
            throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.ownerModuleName}" not found` });
          }
          need = ownerModule.manifest.module.commonsNeeds?.find((candidate) => candidate.id === input.needId);
          if (!need || need.agentId !== input.agentId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Commons capability need is not owned by the selected Module Agent" });
          }
          if (entry.kind !== need.kind || !need.tags.every((tag) => entry.tags.includes(tag))) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Commons module does not satisfy the declared Module need" });
          }
        }
        const commonsTaintLabel = labelAtSource("signed_commons_import", {
          ref: `${entry.name}@${entry.version}`,
          valueHash: entry.integrity.value,
          sensitivity: "public",
          instructionRisk: "data",
        });
        const commonsSource = {
          contentHash: entry.integrity.value,
          manifestHash: sha256Content(canonicalizeManifest(manifest)),
          entry,
          taintLabel: commonsTaintLabel,
        };

        const verifiedDependencyPins = new Map<string, string>();
        const staged = new Set<string>();
        const stageDependencies = async (parentEntry: CommonsModuleEntry): Promise<void> => {
          const parentPins = new Map<string, string>(
            (parentEntry.securityScan.dependencyPins ?? []).map(
              (pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const,
            ),
          );
          for (const dependency of parentEntry.manifest.dependencies) {
            const key = `${dependency.manifestId}@${dependency.version}`;
            const expectedHash = parentPins.get(key);
            const priorHash = verifiedDependencyPins.get(key);
            if (priorHash && priorHash !== expectedHash) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" has conflicting signed content-hash pins`,
              });
            }
            if (staged.has(key)) continue;
            staged.add(key);
            const dependencyEntry = await ctx.wiring.commonsRegistry.getVersion(
              dependency.manifestId,
              dependency.version,
            );
            if (!dependencyEntry || !expectedHash || dependencyEntry.integrity.value !== expectedHash) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" does not match its signed content-hash pin`,
              });
            }
            verifiedDependencyPins.set(key, expectedHash);
            try {
              assertCommonsEntryContentTrusted(dependencyEntry);
            } catch (err) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: err instanceof Error ? err.message : `Commons dependency "${key}" failed trust verification`,
              });
            }
            const dependencyManifest = parseModuleManifest({ module: dependencyEntry.manifest });
            const dependencyTaintLabel = labelAtSource(
              "signed_commons_import",
              {
                ref: key,
                valueHash: dependencyEntry.integrity.value,
                sensitivity: "public",
                instructionRisk: "data",
              },
            );
            const dependencyPrivacyPaths = findOrganizationDataPaths(dependencyEntry.manifest);
            if (dependencyPrivacyPaths.length > 0) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" contains Organization data`,
              });
            }
            await ctx.wiring.moduleStore.create({
              organizationId: input.organizationId,
              moduleName: dependencyManifest.name,
              moduleVersion: dependencyManifest.version,
              manifest: dependencyManifest,
              computedRisk: dependencyEntry.securityScan.riskBand,
              state: "private",
              status: "pending_review",
              lineageManifestId: dependencyManifest.lineageManifestId,
              ...(rootModule
                ? {
                    commonsSource: {
                      contentHash: dependencyEntry.integrity.value,
                      manifestHash: sha256Content(canonicalizeManifest(dependencyManifest)),
                      entry: dependencyEntry,
                      taintLabel: dependencyTaintLabel,
                    },
                  }
                : {
                    moduleAttachment: {
                      source: "commons" as const,
                      ownerModuleName: ownerModule!.moduleName,
                      agentId: input.agentId!,
                      needId: input.needId!,
                      contentHash: dependencyEntry.integrity.value,
                      taintLabel: dependencyTaintLabel,
                    },
                  }),
            });
            await stageDependencies(dependencyEntry);
          }
        };
        await stageDependencies(entry);

        if (rootModule) {
          const existing = (await ctx.wiring.moduleStore.listVersions(input.organizationId, manifest.name))
            .find((candidate) => candidate.moduleVersion === manifest.version && !candidate.moduleAttachment);
          if (existing) {
            if (canonicalizeManifest(existing.manifest) !== canonicalizeManifest(manifest)) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Existing root Module version has different immutable normalized content",
              });
            }
            const reconciled = await ctx.wiring.moduleStore.setCommonsSource(existing.id, commonsSource);
            return { installation: reconciled };
          }
        }

        // Register as a private installation — same as modules.register, but the
        // manifest source is the verified Commons entry, not a user-supplied object.
        const created = await ctx.wiring.moduleStore.create({
          organizationId: input.organizationId,
          moduleName: manifest.name,
          moduleVersion: manifest.version,
          manifest,
          computedRisk: entry.securityScan.riskBand,
          state: "private",
          status: "pending_review",
          lineageManifestId: manifest.lineageManifestId,
          ...(rootModule
            ? { commonsSource }
            : {
                moduleAttachment: {
                  source: "commons" as const,
                  ownerModuleName: ownerModule!.moduleName,
                  agentId: input.agentId!,
                  needId: input.needId!,
                  contentHash: entry.integrity.value,
                  taintLabel: commonsTaintLabel,
                },
              }),
        });

        return { installation: created };
      }),

    runInstalledSkill: procedure
      .input(
        z.object({
          organizationId: z.string().min(1),
          installationId: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const installation = await ctx.wiring.moduleStore.get(input.installationId);
        if (!installation || installation.organizationId !== input.organizationId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown Commons installation" });
        }
        if (installation.state !== "available" || installation.status !== "installed") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Commons capability must be installed and available before it can run",
          });
        }
        const attachment = installation.moduleAttachment;
        const entry = await assertCurrentCommonsAttachment(ctx.wiring, installation);
        if (!attachment || !entry) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "capability is not attached from Commons to a Module Agent",
          });
        }
        if (
          !isSupportedCitedRoleModelInstallation(installation)
          || !isSupportedCitedRoleModelManifest(entry.manifest)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "installed Commons Skill does not match its supported signed runtime contract",
          });
        }
        const ownerModule = await currentSupportedRelationshipOwner(ctx.wiring, installation);
        if (!ownerModule) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "installed Commons Skill does not match its supported owning Module contract",
          });
        }
        const skillCapabilities = entry.manifest.capabilities.filter(
          (capability) => capability.capabilityType === "skill",
        );
        if (
          skillCapabilities.length !== 1 ||
          skillCapabilities[0]?.id !== LEARNING_RECOMMENDATION_SKILL_ID
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "installed Commons Skill has no supported runtime binding",
          });
        }
        const runtimeAgentId = resolveModuleAgentRuntimeId(
          attachment.ownerModuleName,
          attachment.agentId,
        );
        if (runtimeAgentId !== LEARNING_AGENT) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "installed Commons Skill is not bound to its attributable runtime Agent",
          });
        }
        const recommendation = await latestApprovedRoleModelRecommendation(
          ctx.wiring,
          input.organizationId,
          ctx.identity.id,
        );
        if (!recommendation) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Approve a cited role-model onboarding recommendation before running this Skill",
          });
        }
        return stageRoleModelRecommendation(
          ctx.wiring,
          ctx.run,
          ctx.identity.id,
          input.organizationId,
          recommendation,
          {
            source: "commons",
            installationId: installation.id,
            moduleName: entry.name,
            moduleVersion: entry.version,
            contentHash: attachment.contentHash,
            moduleInstallationId: ownerModule.id,
            ownerModuleName: attachment.ownerModuleName,
            ownerModuleVersion: ownerModule.moduleVersion,
            ownerModuleManifestHash: moduleManifestHash(ownerModule.manifest),
            ownerModuleAgentId: attachment.agentId,
            runtimeAgentId,
            capabilityId: LEARNING_RECOMMENDATION_SKILL_ID,
          },
        );
      }),

    /**
     * Publish curated built-in modules to the running
     * Commons service. Idempotent: already-published versions are skipped.
     * This is the runtime equivalent of `pnpm --filter @bridge/api publish-builtins`.
     * Requires authentication (mutation guard) to prevent arbitrary callers from
     * flooding the registry.
     */
    publishBuiltins: procedure.mutation(async ({ ctx }) => {
      const published: string[] = [];
      const skipped: string[] = [];
      const failed: { name: string; reason: string }[] = [];

      for (const { manifest: sourceManifest, commons } of COMMONS_BUILT_IN_MODULES) {
        const manifest = parseModuleManifest({ module: sourceManifest });
        try {
          await ctx.wiring.commonsRegistry.publish(manifest, {
            tags: commons.tags,
            provenance: commons.provenance,
          });
          published.push(`${manifest.name}@${manifest.version}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("already published")) {
            const existing = await ctx.wiring.commonsRegistry.getVersion(manifest.name, manifest.version);
            const expectedIdentity = canonicalizeJson({
              manifest,
              tags: normalizeCommonsTags(commons.tags),
              provenance: commons.provenance,
            });
            const existingIdentity = existing
              ? canonicalizeJson({
                  manifest: existing.manifest,
                  tags: normalizeCommonsTags(existing.tags),
                  provenance: existing.provenance,
                })
              : null;
            if (existingIdentity === expectedIdentity) {
              skipped.push(`${manifest.name}@${manifest.version}`);
            } else {
              failed.push({
                name: manifest.name,
                reason: "published version has different immutable manifest, tags, or provenance",
              });
            }
          } else {
            failed.push({ name: manifest.name, reason: message });
          }
        }
      }

      if (failed.length > 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `commons.publishBuiltins: ${failed.length} failure(s) — ${failed.map((f) => `${f.name}: ${f.reason}`).join("; ")}`,
        });
      }

      return { published, skipped };
    }),
  }),

  chiefOfStaff: t.router({
    /**
     * Chief of Staff v1 (docs/wiki/roadmap.md P1) — the default interlocutor.
     * Classifies the message with @bridge/core's classifyIntent (model-backed
     * when a provider is registered, deterministic keyword fallback otherwise
     * — offline/in-memory mode must still answer) and, when it routes, ALWAYS
     * proposes the routed action through the SAME governed pipeline
     * `action.propose` uses — never executes anything directly. Star topology:
     * at most ONE downstream route per turn, hard chain-depth cap enforced via
     * `assertChainDepth` BEFORE attempting to route (falls back to a direct
     * reply, "best-so-far", once the cap is hit rather than erroring the turn).
     */
    converse: procedure.input(chiefOfStaffConverseInput).mutation(async ({ input, ctx }) => {
      assertPilotOrganization(input.organizationId);
      await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
      if (input.cloudModelEgress) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Caller-confirmed cloud egress is retired. Use chat.turn.prepareCloud and a single-use exact-context grant.",
        });
      }

      // Resolve the Chief-of-Staff persona server-side from stored onboarding
      // context. Avatar style is intentionally absent: visual choice never
      // changes an Agent's tone, authority, or behavior.
      const profileRow = await ctx.wiring.onboardingProfileStore.get(input.organizationId);
      const profile = profileRow ? profileFromRow(profileRow) : undefined;
      const cosPersona = buildChiefOfStaffPersona(profile ?? { organizationId: input.organizationId, source: "onboarding" });
      // Additive, display-only projection of the resolved CoS identity so the
      // client/avatar can reflect it — two different profiles yield two different
      // persona cards, observable at the API boundary. Never carries authority.
      const personaCard = { id: cosPersona.id, name: cosPersona.name, ...(cosPersona.tone ? { tone: cosPersona.tone } : {}) };

      // AI Harness K4: retrieval fusion feeds EVERY run through the context
      // door, not just chat.turn.send — the @communications and @agent paths
      // below fill the memory slot K0 reserved. Gated per-run on the flight
      // AND on the resolved provider's plane: local-plane private memory
      // never rides into a cloud model's prompt (the same per-turn provider-
      // plane gate chat.turn.send applies). Best-effort — a run never fails
      // because retrieval did; the Layer B budget is enforced at the door.
      const fusedConverseMemory = async (
        providerPlane: "local" | "cloud" | undefined,
        query: string,
      ): Promise<RetrievedMemorySnippet[]> => {
        if (!ctx.wiring.retrievalFusionEnabled || providerPlane !== "local") return [];
        try {
          const fused = await fusedChatMemory({
            memoryStore: ctx.wiring.memoryStore,
            vectorIndex: ctx.wiring.vectorIndex,
            graphStore: ctx.wiring.graphStore,
            ...(ctx.wiring.claimSubstrateEnabled ? { claimStore: ctx.wiring.claimStore } : {}),
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            query,
            ...(ctx.wiring.semanticEmbedder ? { embedder: ctx.wiring.semanticEmbedder } : {}),
          });
          return fused.snippets;
        } catch {
          return [];
        }
      };

      // A leading "@communications"/"@comms" mention resolves to the
      // Communications SKILL (ADR-046), not an agent — no identity, no
      // capability_scope, just a direct model-backed drafting reply. Checked
      // before the agent-mention branch since the two mention sets are
      // disjoint (COMMUNICATIONS_SKILL.mentions was removed from
      // FOUNDATIONAL_AGENTS' registry).
      const skillMention = parseSkillMention(input.message);
      if (skillMention.skill === "communications") {
        const configuredModel = resolveConfiguredModel(
          ctx.wiring.models,
          "default",
          input.cloudModelEgress,
        );
        const governedModel = configuredModel
          ? createGovernedModelProvider(
              ctx,
              input.organizationId,
              configuredModel,
              "communications_draft",
              input.cloudModelEgress,
            )
          : undefined;
        // AI Harness K0 (ADR-211): the Communications turn assembles a real
        // ModelRunContext — the system prompt is a projection, never a
        // hand-rolled string, so the kernel invariants and the K4 memory
        // slot exist here exactly as they do for every other model run.
        // K4: the Communications run retrieves like every other run — same
        // fusion, same provider-plane gate, same Layer B budget at the door.
        const communicationsMemory = await fusedConverseMemory(
          configuredModel?.plane,
          skillMention.rest || input.message,
        );
        const communicationsContext = assembleRunContext(
          {
            persona: buildCommunicationsPersona(
              { type: ctx.identity.type, id: ctx.identity.id },
              configuredModel?.plane === "cloud" ? undefined : cosPersona.tone,
            ),
            request: skillMention.rest || input.message,
            governance: { approvalRequirement: "explicit_human", trustGrants: [] },
            ...(communicationsMemory.length > 0 ? { memory: communicationsMemory } : {}),
            outputContract: { description: DIRECT_REPLY_OUTPUT_CONTRACT },
          },
          ctx.run,
        );
        const text = governedModel
          ? (
              await governedModel.provider.complete({
                system: projectToSystemPrompt(communicationsContext),
                prompt: communicationsContext.request,
                maxTokens: 512,
                tier: "default",
                cache: { strategy: "stable_system_prefix", ttl: "5m" },
              })
            ).text
          : `${COMMUNICATIONS_SKILL.mission} (offline mode — no model configured, so I can't draft this yet, but I've recorded the request.)`;
        return {
          reply: text,
          decision: { kind: "direct_reply" as const, confidence: 1, reason: "directly addressed via @communications skill", source: "model" as const },
          proposal: null,
          modelReceiptLedgerId: governedModel?.receiptLedgerId() ?? null,
          // Display-only label, not a FoundationalAgentId — Communications
          // has no identity/capability-scope row (ADR-046), this string
          // exists purely so AgentPanel.tsx can badge the reply the same
          // way it badges an actual agent's.
          agent: "communications" as const,
          persona: personaCard,
        };
      }

      // A leading "@agent" mention (ADR-033/046) bypasses star-topology
      // classification for THIS turn only — a human directly addressing one
      // of the three foundational agents, not agent-to-agent handoff.
      // Learning/Governance answer directly (no side effects); Capability
      // Builder always drafts through the same governed pipeline every routed
      // action uses, per its `requiresApproval` flag — it never ships live from
      // a chat reply.
      const { agentId, rest } = parseMention(input.message);
      if (agentId) {
        const agent = findFoundationalAgent(agentId);
        const configuredModel = resolveConfiguredModel(
          ctx.wiring.models,
          "reasoning",
          input.cloudModelEgress,
        );
        const governedModel = configuredModel
          ? createGovernedModelProvider(
              ctx,
              input.organizationId,
              configuredModel,
              `foundational_agent:${agentId}`,
              input.cloudModelEgress,
            )
          : undefined;

        // AGENTS-1: invoke the addressed agent as a first-class peer through the
        // @bridge/core `invokeAgent` seam (system-prompt assembly + model call +
        // offline fallback + the design-constraint check all live in core). The
        // result is a DISCRIMINATED UNION with no "executed" variant, so the
        // strongest thing a chat reply can carry is a draft this procedure must
        // still propose — the "no independent write" guarantee is structural,
        // not a convention re-checked here.
        // K4: an addressed foundational Agent retrieves like every other run —
        // the memory slot K0 reserved on invokeAgent is finally fed.
        const agentMemory = await fusedConverseMemory(
          configuredModel?.plane,
          rest || input.message,
        );
        const result = await invokeAgent({
          agentId,
          message: rest || input.message,
          // The RunCtx rides with the provider (AI Harness K0): invokeAgent
          // assembles its ModelRunContext through the one context door, and
          // cannot be handed a model without the seams to do so.
          ...(governedModel
            ? { model: { provider: governedModel.provider, runCtx: ctx.run } }
            : {}),
          ...(agentMemory.length > 0 ? { memory: agentMemory } : {}),
          ...(cosPersona.tone && configuredModel?.plane !== "cloud"
            ? { tone: cosPersona.tone }
            : {}),
        });
        const modelReceiptLedgerId = governedModel?.receiptLedgerId() ?? null;

        if (result.kind === "information") {
          return {
            reply: result.text,
            decision: { kind: "direct_reply" as const, confidence: 1, reason: `directly addressed via @${agentId}`, source: "model" as const },
            proposal: null,
            modelReceiptLedgerId,
            agent: agentId,
            persona: personaCard,
          };
        }

        // result.kind === "draft" (Capability Builder, `requiresApproval`). The
        // core-computed design-constraint violations are surfaced to the human
        // approver — never a gate, same draft-then-approve pattern as every
        // other governance signal.
        const constraintViolations = result.constraintViolations;
        const replyText = constraintViolations.length
          ? `${result.text}\n\n⚠ Design-constraint check flagged ${constraintViolations.length} item(s) for the approver:\n${constraintViolations.map((v) => `- ${v}`).join("\n")}`
          : result.text;

        const proposal = await ctx.wiring.pipeline.propose(
          {
            organizationId: input.organizationId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "execute",
            resourceType: "skill",
            inputs: {
              agent: agentId,
              message: input.message,
              draft: result.text,
              designConstraintViolations: constraintViolations,
              ...(modelReceiptLedgerId ? { modelReceiptLedgerId } : {}),
            },
            skill: "stageMutation",
          },
          ctx.run,
        );
        return {
          reply: `${replyText}\n\nDrafted via ${agent.name} — proposed for review, not yet executed.`,
          decision: { kind: "route" as const, route: agentId, confidence: 1, reason: `directly addressed via @${agentId}`, source: "model" as const },
          proposal,
          modelReceiptLedgerId,
          agent: agentId,
          persona: personaCard,
        };
      }

      let chainOk = true;
      try {
        assertChainDepth(input.chainDepth);
      } catch {
        chainOk = false;
      }

      // In-memory mode exposes only the deterministic echo adapter, which is not
      // a classifier. A configured deployment resolves the explicit cheap tier;
      // no provider is ever selected by registration position.
      const configuredModel = resolveConfiguredModel(
        ctx.wiring.models,
        "cheap",
        input.cloudModelEgress,
      );
      const governedModel =
        chainOk && configuredModel
          ? createGovernedModelProvider(
              ctx,
              input.organizationId,
              configuredModel,
              "intent_classification",
              input.cloudModelEgress,
            )
          : undefined;

      const decision = chainOk
        ? await classifyIntent({
            message: input.message,
            registry: CHIEF_OF_STAFF_REGISTRY,
            ...(governedModel
              ? { model: { provider: governedModel.provider, runCtx: ctx.run } }
              : {}),
          })
        : {
            kind: "direct_reply" as const,
            confidence: 0,
            reason: `chain depth ${input.chainDepth} hit the hard cap (${MAX_CHAIN_DEPTH}) — replying directly instead of routing further (best-so-far fallback)`,
            source: "keyword_fallback" as const,
          };
      const modelReceiptLedgerId = governedModel?.receiptLedgerId() ?? null;

      if (decision.kind !== "route" || !decision.route) {
        return {
          reply:
            decision.kind === "clarify"
              ? "I'm not confident which capability handles that yet — could you say more about what you're trying to do?"
              : "Noted — I don't have a capability to route that to yet, but I've recorded the request.",
          decision,
          modelReceiptLedgerId,
          proposal: null,
          agent: "chief_of_staff" as const,
          persona: personaCard,
        };
      }

      const target = CHIEF_OF_STAFF_REGISTRY.find((c) => c.id === decision.route);
      const proposal = await ctx.wiring.pipeline.propose(
        {
          organizationId: input.organizationId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "execute",
          resourceType: "skill",
          inputs: {
            route: decision.route,
            message: input.message,
            ...(modelReceiptLedgerId ? { modelReceiptLedgerId } : {}),
          },
          skill: "stageMutation",
        },
        ctx.run,
      );

      return {
        reply: `Routing this to "${decision.route}"${target ? ` (${target.description})` : ""} — proposed for review, not yet executed.`,
        decision,
        modelReceiptLedgerId,
        proposal,
        agent: "chief_of_staff" as const,
        persona: personaCard,
      };
    }),
  }),

  /**
   * AGS0-AGS2 (TASK-007) — typed Goals/Tasks, the fail-closed Goal/Task-bound
   * Skill resolver, and bounded child Agent Runs. `skill.resolve` is a
   * read-only preview (never invokes anything); `skill.invoke` is the real
   * governed call — it goes through the SAME `pipeline.propose` every other
   * mutation uses, so a direct Human/Automation invocation of a governed
   * Skill fails closed there exactly as it would through `action.propose`
   * (see pipeline.ts's AGS1 gate) — this router adds no separate enforcement
   * path, only a more ergonomic Goal/Task-shaped surface over the same gate.
   */
  agentOrchestration: t.router({
    goal: t.router({
      create: authenticatedProcedure.input(goalCreateInput).mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return ctx.wiring.goalTasks.createGoal(
          { organizationId: input.organizationId, type: input.type, title: input.title },
          { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
        );
      }),
      list: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        return ctx.wiring.goalTasks.listGoals(input.organizationId);
      }),
    }),

    task: t.router({
      create: authenticatedProcedure.input(taskCreateInput).mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const goal = await ctx.wiring.goalTasks.getGoal(input.organizationId, input.goalId);
        const [agentOrganizationId, agentActive] = await Promise.all([
          ctx.wiring.agents.organizationId(input.assignedAgentId),
          ctx.wiring.agents.isActive(input.assignedAgentId),
        ]);
        if (!goal) {
          throw new TRPCError({ code: "NOT_FOUND", message: `unknown goal ${input.goalId}` });
        }
        if (agentOrganizationId !== input.organizationId || !agentActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "assigned Agent is not active in this organization" });
        }
        return ctx.wiring.goalTasks.createTask(
          {
            organizationId: input.organizationId,
            goalId: input.goalId,
            type: input.type,
            assignedAgentId: input.assignedAgentId,
          },
          { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
        );
      }),
      listByGoal: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), goalId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          return ctx.wiring.goalTasks.listTasksByGoal(input.organizationId, input.goalId);
        }),
      /** The ONLY thing that changes governed-Skill eligibility for a Task —
       * never a Skill manifest's `defaultAgents` preference list. */
      reassign: authenticatedProcedure.input(taskReassignInput).mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const [agentOrganizationId, agentActive] = await Promise.all([
          ctx.wiring.agents.organizationId(input.assignedAgentId),
          ctx.wiring.agents.isActive(input.assignedAgentId),
        ]);
        if (agentOrganizationId !== input.organizationId || !agentActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "assigned Agent is not active in this organization" });
        }
        return ctx.wiring.goalTasks.reassignTask(
          input.organizationId,
          input.taskId,
          input.assignedAgentId,
        );
      }),
    }),

    skill: t.router({
      webResearch: authenticatedProcedure
        .input(
          z
            .object({
              organizationId: z.string().min(1),
              objective: z.string().trim().min(1).max(500),
              scope: z.literal("public_web"),
              searchQueries: z
                .array(z.string().trim().min(1).max(160))
                .min(1)
                .max(3),
              budget: z.object({
                maxResults: z.number().int().min(1).max(10),
                maxResponseBytes: z
                  .number()
                  .int()
                  .min(1_024)
                  .max(512 * 1_024),
                maxProviderAttempts: z.number().int().min(1).max(3),
                timeoutMs: z.number().int().min(1_000).max(15_000),
              }).strict(),
            })
            .strict(),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(
            ctx.wiring.organizationStore,
            input.organizationId,
            ctx.identity.id,
          );
          await assertWebResearchModuleBinding(
            ctx.wiring,
            input.organizationId,
          );
          const goalTaskRef = await provisionWebResearchTask(
            ctx.wiring,
            input.organizationId,
          );
          try {
            const proposal = await ctx.wiring.pipeline.propose(
              {
                organizationId: input.organizationId,
                actor: {
                  type: "agent",
                  id: LEARNING_AGENT,
                  plane: "cloud",
                },
                onBehalfOf: { type: "user", id: ctx.identity.id },
                action: "read",
                resourceType: "external:fetch",
                inputs: {
                  objective: input.objective,
                  scope: input.scope,
                  searchQueries: input.searchQueries,
                  budget: input.budget,
                },
                taintLabel: labelAtSource("human_input", {
                  ref: `web-research:${ctx.identity.id}:${goalTaskRef.taskId}`,
                  valueHash: hashTaintValue({
                    objective: input.objective,
                    searchQueries: input.searchQueries,
                  }),
                  sensitivity: "public",
                  instructionRisk: "instruction_like",
                }),
                skill: WEB_RESEARCH_SKILL_ID,
                dataScope: "public",
                goalTaskRef,
                context: {
                  type: "record",
                  id: goalTaskRef.taskId,
                  runId: ctx.run.ids.next(),
                },
              },
              ctx.run,
            );
            if (proposal.status === "rejected") {
              throw new TRPCError({
                code: "FORBIDDEN",
                message:
                  proposal.rejectionReason ??
                  "web research was rejected before persistence",
              });
            }
            const resultEvidence = await persistWebResearchOutcome(
              ctx.wiring,
              ctx.run,
              ctx.identity.id,
              input.organizationId,
              goalTaskRef,
              proposal,
            );
            return { ...proposal, resultEvidence };
          } catch (error) {
            if (error instanceof SearchProvidersUnavailableError) {
              const attempts = error.attempts
                .map((attempt) => `${attempt.providerId}:${attempt.status}`)
                .join(", ");
              throw new TRPCError({
                code: "BAD_GATEWAY",
                message: `web research unavailable (${attempts})`,
                cause: error,
              });
            }
            throw error;
          }
        }),

      /** Read-only preview of AGS1 resolution — never invokes the Skill. Lets
       * the UI show WHY an Agent is (or is not) eligible before a real call. */
      resolve: authenticatedProcedure.input(resolveSkillInput).query(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const goal = await ctx.wiring.goalTasks.getGoal(input.organizationId, input.goalId);
        const task = await ctx.wiring.goalTasks.getTask(input.organizationId, input.taskId);
        if (!goal || !task || task.goalId !== goal.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown or mismatched Goal/Task" });
        }
        const [agentScope, agentDataScope, agentOrganizationId, agentActive] = await Promise.all([
          ctx.wiring.agents.capabilityScope(input.agentId),
          ctx.wiring.agents.dataScope(input.agentId),
          ctx.wiring.agents.organizationId(input.agentId),
          ctx.wiring.agents.isActive(input.agentId),
        ]);
        const candidates = input.skillId
          ? ctx.wiring.skillManifests.forSkill(input.organizationId, input.skillId)
          : ctx.wiring.skillManifests.all(input.organizationId);
        const candidatePlanes = new Set(candidates.map((candidate) => candidate.plane));
        const intendedPlane =
          candidatePlanes.size === 1 ? candidates[0]!.plane : "local";
        return resolveSkillForTask(candidates, {
          goal,
          task,
          agent: {
            id: input.agentId,
            organizationId: agentOrganizationId,
            active: agentActive,
            capabilityScope: agentScope,
            // Preview the server-owned workflow plane when the candidate set is
            // unambiguous; actual invocation still enforces its runtime Actor plane.
            plane: intendedPlane,
            dataScope: agentDataScope,
          },
          ...(input.skillId ? { skillId: input.skillId } : {}),
          ...(input.requestedDataScope ? { requestedDataScope: input.requestedDataScope as DataScope } : {}),
        });
      }),
    }),

    /**
     * TASK-028 kernel-Run migration — durable, owner-scoped Research Run
     * records. The @bridge/research engine still EXECUTES wherever the
     * executor lives (today: the desktop overlay, per the user-approved
     * prototype-first path); this surface is the kernel's authoritative
     * projection of that loop: `start` mints the Run + its Goal/Task +
     * parent-Run envelope id, `recordStep` lands each executed step as a
     * TERMINAL child Agent Run (inspectable via `childRun.listByParentRun`
     * like every other delegation) plus an append-only step-evidence row
     * BR4 resume replays, `requestStop` is the cross-surface cooperative
     * interrupt the executor polls, and `complete` freezes the outcome
     * exactly once (enforced by store CAS + the 0035 DB trigger).
     */
    research: t.router({
      start: authenticatedProcedure
        .input(
          z
            .object({
              organizationId: z.string().min(1),
              objective: z.string().trim().min(1).max(500),
            })
            .strict(),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const goalTaskRef = await provisionResearchRunTask(ctx.wiring, input.organizationId);
          return ctx.wiring.researchRuns.create({
            id: ctx.run.ids.next(),
            organizationId: input.organizationId,
            ownerUserId: ctx.identity.id,
            objective: input.objective,
            status: "running",
            stopRequested: false,
            parentRunId: ctx.run.ids.next(),
            goalId: goalTaskRef.goalId,
            taskId: goalTaskRef.taskId,
            stopReason: null,
            brief: null,
            citations: [],
            blockedActions: [],
            injectionReports: [],
            stepsTaken: 0,
            startedAt: ctx.run.clock.nowISO(),
            endedAt: null,
          });
        }),

      recordStep: authenticatedProcedure
        .input(
          z
            .object({
              organizationId: z.string().min(1),
              researchRunId: z.string().min(1),
              stepIndex: z.number().int().min(0).max(999),
              tool: z.enum(RESEARCH_STEP_TOOLS),
              summary: z.string().trim().min(1).max(4_000),
              sourceUrl: z.string().trim().min(1).max(2_048).nullish(),
              /** Untrusted external text this step gathered — kept ONLY so a
               * resumed Run replays its observations; never instructions. */
              quarantined: z
                .object({
                  sourceUrl: z.string().trim().min(1).max(2_048),
                  text: z.string().max(400_000),
                })
                .strict()
                .nullish(),
              /** The executor marks a step whose tool call itself failed. */
              failed: z.boolean().optional(),
            })
            .strict(),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const run = await ctx.wiring.researchRuns.get(
            input.organizationId,
            ctx.identity.id,
            input.researchRunId,
          );
          if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "unknown Research Run" });
          if (run.status !== "running") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Research Run is already ${run.status}`,
            });
          }

          const onBehalfOf = {
            type: (ctx.identity.type === "team" ? "team" : "user") as "user" | "team",
            id: ctx.identity.id,
          };
          const [learningScope, learningDataScope] = await Promise.all([
            ctx.wiring.agents.capabilityScope(LEARNING_AGENT),
            ctx.wiring.agents.dataScope(LEARNING_AGENT),
          ]);
          // The step already executed under the engine's green-tier authority
          // (AP-088): reading the public web is autonomous, so the child Run
          // records at "notify", never a retroactive "approve" that would
          // imply a Human decision existed. Steps run on the user's machine —
          // the LOCAL plane; the quarantined text they carry is untrusted web.
          const parentEnvelope: ParentRunEnvelope = {
            runId: run.parentRunId,
            agentId: LEARNING_AGENT,
            organizationId: input.organizationId,
            authorityScope: learningScope,
            eligibleSkills: [WEB_RESEARCH_SKILL_ID],
            dataScope: learningDataScope,
            plane: "local",
            budgetRemaining: { calls: 1_000, cost: 1_000 },
            reviewMode: "notify",
            childRunPolicy: "allowed",
            delegationDepth: 0,
            onBehalfOf,
            taintLabel: labelAtSource("human_input", {
              ref: `research-run:${run.id}`,
              valueHash: hashTaintValue({ objective: run.objective }),
              sensitivity: "public",
              instructionRisk: "instruction_like",
            }),
          };
          const childRun = await createChildAgentRun(
            { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
            parentEnvelope,
            {
              goalId: run.goalId,
              taskId: run.taskId,
              delegatedScope: ["external:fetch:read"],
              selectedSkills: [WEB_RESEARCH_SKILL_ID],
              budget: { maxCalls: 1, maxCost: 1 },
              deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
              stopCondition: `record one ${input.tool} step of Research Run ${run.id} and stop`,
              requestedDataScope: "public",
              ...(input.quarantined
                ? {
                    requestedTaintLabel: labelAtSource("web_search", {
                      ref: input.quarantined.sourceUrl,
                      valueHash: hashTaintValue({ text: input.quarantined.text }),
                      sensitivity: "public",
                      instructionRisk: "instruction_like",
                    }),
                  }
                : {}),
            },
            ctx.run,
          );
          const transition = input.failed ? failChildAgentRun : completeChildAgentRun;
          await transition(
            { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
            input.organizationId,
            childRun.id,
            { type: "agent", id: LEARNING_AGENT },
            ctx.run,
          );

          try {
            const step = await ctx.wiring.researchRuns.appendStep({
              id: ctx.run.ids.next(),
              runId: run.id,
              organizationId: input.organizationId,
              ownerUserId: ctx.identity.id,
              stepIndex: input.stepIndex,
              tool: input.tool,
              summary: input.summary,
              sourceUrl: input.sourceUrl ?? null,
              childRunId: childRun.id,
              quarantinedText: input.quarantined?.text ?? null,
              quarantinedSourceUrl: input.quarantined?.sourceUrl ?? null,
              createdAt: ctx.run.clock.nowISO(),
            });
            return { step, childRunId: childRun.id };
          } catch (error) {
            if (error instanceof ResearchRunAlreadyTerminalError) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
            }
            if (error instanceof ResearchRunNotFoundError) {
              throw new TRPCError({ code: "NOT_FOUND", message: error.message });
            }
            throw error;
          }
        }),

      requestStop: authenticatedProcedure
        .input(
          z.object({ organizationId: z.string().min(1), researchRunId: z.string().min(1) }).strict(),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          try {
            return await ctx.wiring.researchRuns.requestStop(
              input.organizationId,
              ctx.identity.id,
              input.researchRunId,
            );
          } catch (error) {
            if (error instanceof ResearchRunNotFoundError) {
              throw new TRPCError({ code: "NOT_FOUND", message: error.message });
            }
            throw error;
          }
        }),

      complete: authenticatedProcedure
        .input(
          z
            .object({
              organizationId: z.string().min(1),
              researchRunId: z.string().min(1),
              status: z.enum(["completed", "cancelled", "failed"]),
              stopReason: z.enum(RESEARCH_STOP_REASONS),
              brief: z.string().max(20_000).nullable(),
              citations: z.array(z.string().min(1).max(2_048)).max(200),
              blockedActions: z.array(z.string().min(1).max(2_000)).max(50),
              injectionReports: z.array(z.string().min(1).max(2_000)).max(50),
              stepsTaken: z.number().int().min(0).max(999),
            })
            .strict(),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          try {
            return await ctx.wiring.researchRuns.complete(
              input.organizationId,
              ctx.identity.id,
              input.researchRunId,
              {
                status: input.status,
                stopReason: input.stopReason,
                brief: input.brief,
                citations: input.citations,
                blockedActions: input.blockedActions,
                injectionReports: input.injectionReports,
                stepsTaken: input.stepsTaken,
              },
              ctx.run.clock.nowISO(),
            );
          } catch (error) {
            if (error instanceof ResearchRunAlreadyTerminalError) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
            }
            if (error instanceof ResearchRunNotFoundError) {
              throw new TRPCError({ code: "NOT_FOUND", message: error.message });
            }
            throw error;
          }
        }),

      /** Light poll target for the executor (stopRequested) — run row only. */
      get: authenticatedProcedure
        .input(
          z.object({ organizationId: z.string().min(1), researchRunId: z.string().min(1) }).strict(),
        )
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          return ctx.wiring.researchRuns.get(input.organizationId, ctx.identity.id, input.researchRunId);
        }),

      list: authenticatedProcedure
        .input(
          z
            .object({
              organizationId: z.string().min(1),
              limit: z.number().int().min(1).max(100).default(25),
            })
            .strict(),
        )
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          return ctx.wiring.researchRuns.list(input.organizationId, ctx.identity.id, input.limit);
        }),

      /** Step timeline. Quarantined text stays out of responses unless the
       * caller is the executor resuming a Run (`includeQuarantined`) — the
       * Page renders engine-authored summaries, never raw page text. */
      steps: authenticatedProcedure
        .input(
          z
            .object({
              organizationId: z.string().min(1),
              researchRunId: z.string().min(1),
              includeQuarantined: z.boolean().default(false),
            })
            .strict(),
        )
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          const steps = await ctx.wiring.researchRuns.listSteps(
            input.organizationId,
            ctx.identity.id,
            input.researchRunId,
          );
          if (input.includeQuarantined) return steps;
          return steps.map((step) => ({
            ...step,
            quarantinedText: step.quarantinedText === null ? null : "[quarantined external text withheld]",
          }));
        }),
    }),

    childRun: t.router({
      get: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), childRunId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          return ctx.wiring.childAgentRuns.get(input.organizationId, input.childRunId);
        }),

      listByParentRun: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), parentRunId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotOrganization(input.organizationId);
          await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
          return ctx.wiring.childAgentRuns.listByParentRun(input.organizationId, input.parentRunId);
        }),

      /** Governance/Human may stop any child Run within policy. The acting
       * identity is SERVER-RESOLVED (`ctx.identity`), never client-asserted —
       * same rule every mutation in this router follows.
       *
       * TASK-011 remediation (2026-07-19 coordinator distributed-defects
       * RE-review round 2, issue 5) — a culture-research fetch's cancellation
       * is NOT just a child-Run status flip: it has its OWN durable
       * cancellation mechanism (`DurableCultureFetchStore.requestCancel` +
       * the in-flight `AbortController`) that actually stops the real
       * outbound socket, cross-instance-safe via the durable
       * `cancelRequested` flag `materializeCultureSourceFetch`'s own poll
       * loop watches. Calling `cancelChildAgentRun` directly here (as this
       * generic endpoint used to, unconditionally) would race that
       * mechanism: the child Run could be marked "cancelled" while the
       * underlying fetch keeps running, unaware, eventually landing
       * "fetched"/"failed" against an already-terminal child Run — a
       * fetched/cancelled mismatch this endpoint must not create. Route
       * THROUGH the registered per-operation cancellation for any child Run
       * that IS a culture-research fetch; only fall back to the generic
       * child-Run-only transition for every other (non-culture) child Run.
       */
      cancel: authenticatedProcedure
        .input(z.object({ organizationId: z.string().min(1), childRunId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
        assertPilotOrganization(input.organizationId);
        await assertMembership(ctx.wiring.organizationStore, input.organizationId, ctx.identity.id);
        const cultureFetchRecord = await ctx.wiring.cultureFetchStore.get(input.organizationId, input.childRunId);
        if (cultureFetchRecord && cultureFetchRecord.proposalId) {
          await cancelCultureSourceFetch(
            {
              childAgentRuns: ctx.wiring.childAgentRuns,
              ledger: ctx.wiring.ledger,
              fetchStore: ctx.wiring.cultureFetchStore,
              abortControllers: ctx.wiring.cultureFetchAbortControllers,
            },
            input.organizationId,
            cultureFetchRecord.proposalId,
            input.childRunId,
            { type: ctx.identity.type, id: ctx.identity.id },
            ctx.run,
          );
          // `cancelCultureSourceFetch` already transitions the child Run
          // itself (via its own fenced/lease-aware path) whenever its own
          // durable write actually commits. Whether that happened just now,
          // already happened earlier, or the fetch had already reached a
          // DIFFERENT terminal outcome (fetched/failed) before this request
          // arrived, the child Run's CURRENT, authoritative record is always
          // the correct thing to return here — never a stale optimistic
          // "cancelled" that might not match what the fetch actually
          // resolved to (no fetched/cancelled mismatch is swallowed; the
          // caller sees the real converged state).
          const current = await ctx.wiring.childAgentRuns.get(input.organizationId, input.childRunId);
          if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "unknown child Run" });
          return current;
        }
        return cancelChildAgentRun(
          { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
          input.organizationId,
          input.childRunId,
          { type: ctx.identity.type, id: ctx.identity.id },
          ctx.run,
        );
      }),
    }),
  }),
});

/** Normalize a persisted state row's `evidence` jsonb into the core
 * `CapabilityEvidence` shape lifecycle.ts's guards expect (defaults for any
 * field not yet recorded). */
function toEvidence(evidence: {
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

export type AppRouter = typeof appRouter;
