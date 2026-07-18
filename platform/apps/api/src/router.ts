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
  type RelationMaterializationEffect,
} from "@bridge/db";
import type { ApiContext } from "./context.js";
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
  LEARNING_AGENT,
  OUTREACH_AGENT,
  PILOT_WORKSPACE,
  LEARNING_ROLE_MODEL_GOAL_TYPE,
  PRODUCE_RECOMMENDATION_TASK_TYPE,
  HELPDESK_ROUTING_GOAL_TYPE,
  DRAFT_HELP_OFFER_TASK_TYPE,
  RELATIONSHIP_CAPTURE_GOAL_TYPE,
  STAGE_CAPTURE_TASK_TYPE,
  RELATIONSHIP_OUTREACH_GOAL_TYPE,
  DRAFT_OUTREACH_TASK_TYPE,
  PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE,
  PROPOSE_PREFERENCE_ADJUSTMENT_TASK_TYPE,
  type Wiring,
} from "./wiring.js";
import type {
  Action,
  ActorType,
  DataScope,
  EgressTier,
  MemoryEntry,
  OnBehalfOf,
  ResourceType,
  RitualDefinition,
  RunContext,
} from "@bridge/core";
import {
  AgentFloorDeniedError,
  AlreadyResolvedError,
  NotPendingProposalError,
  buildAgentCapability,
  validateRitualWithinAgents,
  computeRisk,
  advance,
  demoteOnDependencyChange,
  suspendOnFailure,
  resolveActivationApproval,
  compareRuns,
  buildWhyBetterCard,
  resolveGates,
  classifyApprovalBand,
  canGovernanceAutoApprove,
  rollupOrgHealth,
  InvalidTransitionError as CapabilityInvalidTransitionError,
  EvidenceThresholdError,
  compileBlueprint,
  BlueprintCompileError,
  classifyIntent,
  assertChainDepth,
  MAX_CHAIN_DEPTH,
  parseMention,
  parseSkillMention,
  invokeAgent,
  buildCommunicationsSystemPrompt,
  canonicalizeJson,
  normalizeCommonsTags,
  COMMUNICATIONS_SKILL,
  findFoundationalAgent,
  buildChiefOfStaffPersona,
  profileFromRow,
  resolveAnimalTone,
  parsePackageManifest,
  PackageManifestValidationError,
  computePackageRisk,
  maxRisk,
  evaluateSandboxRequirement,
  isUntrustedOrigin,
  trustGrantsForOrigin,
  advancePackageState,
  promoteToAvailable,
  rollbackFromHistory,
  InvalidPackageTransitionError,
  resolveSkillForTask,
  cancelChildAgentRun,
  type CapabilityManifest,
  type CapabilityManifestRow,
  type CapabilityOrigin,
  type TrustGrantView,
  type WhyBetterCard,
  type CapabilityHealthRecord,
  type PendingProposalRecord,
  type Proposal,
  type RunCtx,
  type WorkspaceBlueprint,
  type RoutableCapability,
  type PackageInstallationRow,
  type PackageManifest,
  type CommonsPackageEntry,
  type CommonsListQuery,
  type CommonsPackageDetail,
  type LedgerEntry,
  uuidv7,
} from "@bridge/core";
import { authUrl } from "@bridge/integrations-google";
import { routeHelpRequest, draftHelpOffer, type HelpResponderCandidate } from "@bridge/helpdesk";
import {
  CredentialAccessError,
  SourceDiscoveryGateError,
  applyThesisSourceDiscovery,
  dealPilotModuleManifest,
  proposeThesisSourceDiscovery,
  scoreThesisFit,
  type ThesisSourceDiscoveryProposal,
} from "@bridge/dealpilot";
import { scoreJobFit, transition, InvalidTransitionError, type ApplicationStage, type CandidateProfile, type JobProfile } from "@bridge/jobpilot";
import {
  COMMONS_BUILT_IN_PACKAGES,
  DEALPILOT_SOURCE_RITUAL_ID,
  isModuleRuntimeRitualId,
  resolveModuleAgentRuntimeId,
  resolveModuleRitualRuntimeId,
} from "./built-in-packages.js";
import { assertCommonsEntryContentTrusted } from "./commons-client.js";
import { listModuleFiles, ModuleFilesPathError } from "./module-files.js";
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

function stablePackageInstallProposalId(workspaceId: string, installationId: string): string {
  return stableProposalId(`package-install:${workspaceId}:${installationId}`);
}

function stableDealPilotCaptureProposalId(workspaceId: string, captureId: string): string {
  return stableProposalId(`dealpilot-capture:${workspaceId}:${captureId}`);
}

function isDealPilotCaptureProposal(
  entry: LedgerEntry,
  workspaceId: string,
  captureId: string,
): boolean {
  if (
    entry.id !== stableDealPilotCaptureProposalId(workspaceId, captureId) ||
    entry.workspaceId !== workspaceId ||
    entry.actorType !== "user" ||
    entry.action !== "write" ||
    entry.resourceType !== "tool" ||
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
 * Translate `NonPilotWorkspaceError` → `TRPCError({code:"FORBIDDEN"})` in ONE place
 * (a middleware every procedure below runs through) rather than repeating the
 * `IntegrationFloorScopeError`/`AlreadyResolvedError` try/catch pattern at every one
 * of the dozen-plus call sites that now call `assertPilotWorkspace`. The typed error
 * is still the thing procedures throw (matching the existing pattern); only the
 * translation step is centralized to avoid duplicating the same three-line catch
 * block everywhere.
 */
const withPilotWorkspaceGuard = t.middleware(async ({ next }) => {
  const result = await next();
  // tRPC v11's `next()` does NOT throw when the resolver throws — `callRecursive`
  // catches it internally (converting it to a generic TRPCError via
  // `getTRPCErrorFromUnknown`, which loses the original error's identity) and
  // RETURNS `{ ok: false, error }` instead. A try/catch around `next()` here would
  // never fire; the result's `.ok`/`.error` must be checked explicitly, and the
  // ORIGINAL cause (not the already-generic-wrapped `error`) is what still carries
  // the real `NonPilotWorkspaceError` instance, via `error.cause`.
  if (!result.ok && result.error.cause instanceof NonPilotWorkspaceError) {
    throw new TRPCError({ code: "FORBIDDEN", message: result.error.cause.message });
  }
  return result;
});

/**
 * SEC-1 — every MUTATION must carry a verified identity, closing the silent
 * pilot-user fallback (identity.ts) on any persistent/prod deploy. Queries are left
 * open (read paths are already workspace-scoped and non-mutating); only `type ===
 * "mutation"` is gated, so a single middleware protects all current AND future
 * mutations with zero per-procedure wiring — no mutation can forget to opt in.
 *
 * A request is allowed to mutate iff it is genuinely authenticated, OR the process is
 * pure in-memory dev with no verifier configured (so local/no-auth work keeps flowing):
 *   - verifier + valid token .......... ALLOW  (authenticated)
 *   - verifier + no/again-invalid token REJECT (the anonymous-under-verifier hole)
 *   - no verifier + persistent/prod ... REJECT (the H1 "acts as pilot" hole)
 *   - no verifier + in-memory dev ..... ALLOW  (unchanged local DX)
 * `persistent` folds in NODE_ENV==='production' so a prod boot without DATABASE_URL
 * (already refused by assertProductionEnv) can't widen this either.
 *
 * Chained BEFORE `withPilotWorkspaceGuard` so authentication is checked before
 * workspace authorization — a 401 (who are you?) precedes a 403 (not your workspace).
 */
const requireAuthOnMutation = t.middleware(async ({ ctx, type, next }) => {
  if (type === "mutation") {
    const persistent = ctx.wiring.persistent || process.env.NODE_ENV === "production";
    const allowed = ctx.authenticated || (!ctx.verifying && !persistent);
    if (!allowed) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          "authentication required: this deployment verifies identities (or persists data), " +
          "but the request presented no verified credentials",
      });
    }
  }
  return next();
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
  return next();
});

const procedure = t.procedure.use(requireAuthOnMutation).use(withPilotWorkspaceGuard);
const authenticatedProcedure = t.procedure.use(requireAuthenticatedIdentity).use(withPilotWorkspaceGuard);
const publicProcedure = t.procedure.use(withPilotWorkspaceGuard);

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
 * yields `"jobpilot"` while `JobPilotApplicationDetail.tsx` (and this
 * router's own `validateAnchorTarget`) used the literal `"job-pilot"` —
 * two DIFFERENT strings for the SAME real module would silently split one
 * real-world cell/bullet's correction history into two independent,
 * non-colliding lineages depending on which caller's spelling happened to
 * construct the anchor. Same issue for DealPilot's underlying node type
 * `"initiative"` vs. the module name `"dealpilot"`, and `"person"`/
 * `"people"`, `"community"`/`"communities"`. `validateAnchorTarget`
 * switches on the SAME canonical form this produces, so both are always
 * kept in lockstep. */
function canonicalModuleId(moduleId: string): string {
  switch (moduleId) {
    case "job-pilot":
      return "jobpilot";
    case "initiative":
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
 * `memories.subject_element_id` is a `uuid` column (schema.ts) — this lets
 * `MemoryStore.casSupersede`'s lineage-uniqueness contract (workspaceId,
 * ownerUserId, lineageKey === subjectElementId) work WITHOUT a new "lineage
 * key" schema column (review item 4's "extend MemoryStore... if necessary"
 * is satisfied by reusing this existing, indexed column). Not
 * cryptographically sensitive — only needs to be deterministic and
 * collision-resistant for a bounded per-workspace anchor space, which
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
export function deterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest();
  const bytes = Uint8Array.prototype.slice.call(hash, 0, 16) as Uint8Array;
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
 * transaction, scoped to `(workspace_id, owner_user_id,
 * subject_element_id)` — correct across any number of processes/restarts.
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
       * scoped, never exposed to the workspace-wide ledger. */
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
  c: { type: "initiative" | "community" | "ritual" | "child_agent_run"; id: string; runId?: string | undefined } | undefined,
): RunContext | undefined {
  if (!c) return undefined;
  return { type: c.type, id: c.id, ...(c.runId ? { runId: c.runId } : {}) };
}

/**
 * Interim single-tenant safety fix (All fixes.md Phase 3 item 11a): the platform is
 * single-tenant by construction (`PILOT_WORKSPACE` baked into `buildWiring()`), but
 * several procedures accepted a `workspaceId` param and either silently ignored it
 * (`dealpilot.list`, pre-fix) or never had the param to begin with (`google.*`).
 * Full multi-tenancy is out of scope for this pass (Phase 5, pilot-recruitment-
 * driven) — so instead of threading real per-tenant scoping through every store,
 * every workspace-scoped procedure now EXPLICITLY REJECTS any workspaceId that isn't
 * the pilot workspace, rather than silently proceeding as if it were. This turns a
 * silent cross-tenant leak (if a second workspace id were ever passed) into a loud,
 * typed 403 — an honest reflection of "this platform only serves one workspace right
 * now," not a promise of real isolation.
 */
class NonPilotWorkspaceError extends Error {
  constructor(readonly workspaceId: string) {
    super(`workspaceId "${workspaceId}" is not the pilot workspace — multi-tenancy is not yet supported`);
    this.name = "NonPilotWorkspaceError";
  }
}

function assertPilotWorkspace(workspaceId: string): void {
  if (workspaceId !== PILOT_WORKSPACE) throw new NonPilotWorkspaceError(workspaceId);
}

/**
 * AGS1 (TASK-007) real-catalog migration — `stageLearningRecommendation` is a
 * governed Skill now (see wiring.ts's `LEARNING_RECOMMENDATION_SKILL_MANIFEST`),
 * so every `pipeline.propose` call naming it needs a resolved Goal/Task. This
 * find-or-create helper keeps ONE durable Goal per workspace (reused across
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
  workspaceId: string,
  goalType: string,
  goalTitle: string,
  taskType: string,
  assignedAgentId: string,
): Promise<{ goalId: string; taskId: string }> {
  const seam = { nextId: () => uuidv7(), nowISO: () => new Date().toISOString() };
  const existingGoals = await wiring.goalTasks.listGoals(workspaceId);
  const goal =
    existingGoals.find((g) => g.type === goalType) ??
    (await wiring.goalTasks.createGoal({ workspaceId, type: goalType, title: goalTitle }, seam));
  const task = await wiring.goalTasks.createTask({ workspaceId, goalId: goal.id, type: taskType, assignedAgentId }, seam);
  return { goalId: goal.id, taskId: task.id };
}

async function provisionRoleModelRecommendationTask(
  wiring: Wiring,
  workspaceId: string,
): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    workspaceId,
    LEARNING_ROLE_MODEL_GOAL_TYPE,
    "Role-model deliberate-practice recommendations",
    PRODUCE_RECOMMENDATION_TASK_TYPE,
    LEARNING_AGENT,
  );
}

/** AGS1 (TASK-007 closure) — Help Offer drafting is LEARNING_AGENT's Task. */
async function provisionHelpdeskAnswerTask(wiring: Wiring, workspaceId: string): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    workspaceId,
    HELPDESK_ROUTING_GOAL_TYPE,
    "Helpdesk routing and Help Offer drafting",
    DRAFT_HELP_OFFER_TASK_TYPE,
    LEARNING_AGENT,
  );
}

/** AGS1 (TASK-007 closure) — a raw human capture is modeled as Learning
 * "observing authorized evidence" (its stated mandate). */
async function provisionCaptureTask(wiring: Wiring, workspaceId: string): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    workspaceId,
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
 * belong to `workspaceId` (never leaks cross-workspace existence: a foreign-
 * workspace record and a nonexistent one are indistinguishable, both
 * NOT_FOUND). `file`/`result` bullet targets have no backing existence store
 * yet (no currently-wired bullet surface uses one) — documented, bounded
 * limitation: accepted structurally, not existence-checked, until those
 * stores exist. An unrecognized `moduleId` fails closed rather than being
 * silently accepted as an existence-proof-free anchor. Switches on
 * `canonicalModuleId` (review round-5 item 6) so an alias (`"job-pilot"`,
 * `"initiative"`, `"people"`, `"communities"`) is validated identically to
 * its canonical spelling — never a SEPARATE, accidentally-more-permissive
 * code path. */
async function validateAnchorTarget(wiring: Wiring, workspaceId: string, viewerUserId: string, anchor: RedFlagAnchor): Promise<void> {
  const recordId = anchor.kind === "cell" ? anchor.recordId : anchor.target.type === "record" ? anchor.target.recordId : null;
  if (recordId === null) return; // file/result — documented limitation above

  switch (canonicalModuleId(anchor.moduleId)) {
    case "jobpilot": {
      const application = await wiring.jobpilotStore.getApplication(recordId, workspaceId);
      if (!application) throw new TRPCError({ code: "NOT_FOUND", message: "target record does not exist in this workspace" });
      return;
    }
    case "dealpilot": {
      const initiative = await wiring.graphStore.getInitiative(recordId);
      if (!initiative || initiative.workspaceId !== workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "target record does not exist in this workspace" });
      }
      return;
    }
    case "touchpoint": {
      const touchpoint = await wiring.graphStore.getTouchpoint(workspaceId, recordId);
      if (!touchpoint) throw new TRPCError({ code: "NOT_FOUND", message: "target record does not exist in this workspace" });
      return;
    }
    case "person": {
      const person = await wiring.graphStore.getPerson(workspaceId, viewerUserId, recordId);
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "target record does not exist in this workspace" });
      return;
    }
    case "community": {
      const community = await wiring.graphStore.getCommunity(workspaceId, viewerUserId, recordId);
      if (!community) throw new TRPCError({ code: "NOT_FOUND", message: "target record does not exist in this workspace" });
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
 * every OTHER (non-private) proposal shape in this workspace. */
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
  workspaceId: string,
  ownerId: string,
  params: { preferenceAdjustmentId: string; flagMemoryId: string; anchor: RedFlagAnchor; reason: string | undefined; proposalId: string },
): Promise<MemoryEntry> {
  const evidence = await wiring.memoryStore.get(params.flagMemoryId, { workspaceId, userId: ownerId });
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
    workspaceId,
    ownerUserId: ownerId,
    lineageKey: params.preferenceAdjustmentId,
    expectedCurrentId: null,
    next: {
      id: params.preferenceAdjustmentId,
      workspaceId,
      type: "preference",
      subjectElementId: params.preferenceAdjustmentId,
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
  const existing = await wiring.memoryStore.currentForLineage(workspaceId, ownerId, params.preferenceAdjustmentId);
  if (!existing) throw new Error("preference adjustment lineage disappeared between create and re-read");
  return existing;
}

/** TASK-010 (review remediation item 3 — saga/idempotency) — one durable
 * Goal for the workspace's platform red-flag learning, one bounded Task per
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
 * SEPARATE one — either silently duplicating the workspace's "platform
 * red-flag learning" Goal, or throwing an unhandled unique-constraint error
 * if one ever gets added. The Goal id is now DETERMINISTIC (one per
 * workspace, derived the same way every other red-flag id in this file is)
 * and looked up by that EXACT id via `getGoal` — mirroring the Task logic
 * immediately below: check first, then create with a catch-and-recheck
 * fallback so a losing concurrent insert recovers to the WINNER's Goal
 * rather than erroring. */
async function provisionRedFlagLearningTask(
  wiring: Wiring,
  workspaceId: string,
  taskId: string,
): Promise<{ goalId: string; taskId: string }> {
  const seam = { nextId: () => uuidv7(), nowISO: () => new Date().toISOString() };
  const goalId = deterministicUuid(`redflag-learning-goal:${workspaceId}`);
  let goal = await wiring.goalTasks.getGoal(workspaceId, goalId);
  if (!goal) {
    try {
      goal = await wiring.goalTasks.createGoal(
        { id: goalId, workspaceId, type: PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE, title: "Platform red-flag correction learning" },
        seam,
      );
    } catch (err) {
      // A concurrent call (a different process/instance provisioning the
      // SAME workspace's Goal at once) may have created it between our
      // check above and this insert — re-check rather than propagating a
      // duplicate-key error as a genuine failure (review round-5 item 10:
      // "treat as CAS loss/reconcile, not 500").
      const retryGoal = await wiring.goalTasks.getGoal(workspaceId, goalId);
      if (!retryGoal) throw err;
      goal = retryGoal;
    }
  }
  const existingTask = await wiring.goalTasks.getTask(workspaceId, taskId);
  if (existingTask) return { goalId: goal.id, taskId: existingTask.id };
  try {
    const task = await wiring.goalTasks.createTask(
      { id: taskId, workspaceId, goalId: goal.id, type: PROPOSE_PREFERENCE_ADJUSTMENT_TASK_TYPE, assignedAgentId: LEARNING_AGENT },
      seam,
    );
    return { goalId: goal.id, taskId: task.id };
  } catch (err) {
    // A concurrent retry (same idempotency key) may have created it between
    // our check above and this insert — re-check rather than propagating a
    // duplicate-key error as a genuine failure.
    const retryFetch = await wiring.goalTasks.getTask(workspaceId, taskId);
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
  workspaceId: string,
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
  const current = await wiring.memoryStore.currentForLineage(workspaceId, ownerId, preferenceAdjustmentId);
  const value = current && parseLearningMemory(current.content);
  if (!current || !isPreferenceAdjustmentContent(value) || value.status === "revoked") return;
  await wiring.memoryStore.casSupersede({
    workspaceId,
    ownerUserId: ownerId,
    lineageKey: current.subjectElementId!,
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
  workspaceId: string,
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
  const anchorKey = currentRow.subjectElementId!;
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
    resolvedPreferenceAdjustmentId = (await wiring.memoryStore.currentForLineage(workspaceId, ownerId, preferenceAdjustmentId))?.id ?? preferenceAdjustmentId;
  } else {
    try {
      const adjustment = await synthesizePreferenceAdjustment(wiring, workspaceId, ownerId, {
        preferenceAdjustmentId,
        flagMemoryId,
        anchor: currentValue.anchor,
        reason: currentValue.reason,
        proposalId,
      });
      resolvedPreferenceAdjustmentId = adjustment.id;

      const goalTaskRef = await provisionRedFlagLearningTask(wiring, workspaceId, taskId);
      const proposal = await wiring.pipeline.propose(
        {
          workspaceId,
          actor: { type: "agent", id: LEARNING_AGENT },
          onBehalfOf: { type: "user", id: ownerId },
          action: "write",
          resourceType: "signal",
          skill: "learning.proposePreferenceAdjustment",
          trustOrigin: "user_content",
          goalTaskRef,
          // PRIVACY (review item 2): the ledger is a workspace-wide-
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
    workspaceId,
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
    const latest = await wiring.memoryStore.currentForLineage(workspaceId, ownerId, anchorKey);
    return latest ?? currentRow;
  }
  return updated;
}


async function provisionOutreachDraftTask(
  wiring: Wiring,
  workspaceId: string,
): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    workspaceId,
    RELATIONSHIP_OUTREACH_GOAL_TYPE,
    "Relationship outreach drafting",
    DRAFT_OUTREACH_TASK_TYPE,
    OUTREACH_AGENT,
  );
}

/**
 * SEC-6: a workspace-scoped procedure must confirm the caller is actually a MEMBER
 * of the workspace, not merely that the id is the pilot workspace. `assertPilotWorkspace`
 * stays as the first (single-tenancy) layer; this membership check is the second, so
 * the guarantee survives multi-tenancy. `ctx.identity` is server-resolved, never
 * client-asserted. Applied to the membership surface (invite / listMembers / help route)
 * now; extend to every workspace-scoped procedure as the test harness seeds member
 * identities for its fixtures (see docs/raw/decisions-log.md, SEC-6).
 */
async function assertMembership(
  workspaceStore: Wiring["workspaceStore"],
  workspaceId: string,
  userId: string,
): Promise<void> {
  if (!(await workspaceStore.isMember(workspaceId, userId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `actor "${userId}" is not a member of workspace "${workspaceId}"`,
    });
  }
}

const dealpilotProcedure = procedure.use(async ({ ctx, next }) => {
  const authenticationRequired =
    ctx.verifying || ctx.wiring.persistent || process.env.NODE_ENV === "production";
  if (authenticationRequired && !ctx.authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required for DealPilot" });
  }
  await assertMembership(ctx.wiring.workspaceStore, PILOT_WORKSPACE, ctx.identity.id);
  return next();
});

const actionEnum = z.enum(["read", "write", "execute", "share", "archive"]);
const actorTypeEnum = z.enum(["user", "team", "agent"]);
const resourceTypeEnum = z.enum([
  "person",
  "community",
  "event",
  "initiative",
  "touchpoint",
  "ritual",
  "tool",
  "file",
  "signal",
  "policy",
  "policy_param",
  "skill",
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
 * convention) — workspaceId + limit/offset. */
const paginatedInput = z.object({
  workspaceId: z.string().min(1),
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
  workspaceId: z.string().min(1),
  actor: actorSchema,
  onBehalfOf: onBehalfOfSchema.optional(),
  action: actionEnum,
  resourceType: resourceTypeEnum,
  resourceId: z.string().uuid().optional(),
  inputs: z.unknown(),
  skill: z.string().min(1),
  dataScope: dataScopeEnum.optional(),
  context: z
    .object({
      type: z.enum(["initiative", "community", "ritual", "child_agent_run"]),
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
});

const relationshipNodeTypeEnum = z.enum(["person", "community", "signal", "event"]);
const relationshipSignalEvidenceInput = relationshipSignalEvidencePayloadSchema
  .omit({ kind: true })
  .extend({
    workspaceId: z.string().uuid().transform((value) => value.toLowerCase()),
  });
const relationshipListInput = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).max(10_000).default(0),
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
  workspaceId: string,
  ownerUserId: string,
  localMediaId: string,
): Promise<LedgerEntry | null> {
  const pageSize = 100;
  const maxRows = 1_000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const page = await wiring.ledger.listPending(workspaceId, {
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
      workspaceId: entry.workspaceId,
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
  workspaceId: string,
  envelope: z.infer<typeof captureReviewEnvelopeSchema>,
): Promise<void> {
  await wiring.localPlane.bodies.put({
    workspaceId,
    source: CAPTURE_REVIEW_BODY_SOURCE,
    sourceRecordId: envelope.localMediaId,
    dataScope: "private",
    content: envelope,
    capturedAt: envelope.receivedAt,
  });
}

async function getCaptureReviewEnvelope(
  wiring: Wiring,
  workspaceId: string,
  localMediaId: string,
): Promise<z.infer<typeof captureReviewEnvelopeSchema> | null> {
  const body = await wiring.localPlane.bodies.get(
    workspaceId,
    CAPTURE_REVIEW_BODY_SOURCE,
    localMediaId,
  );
  if (!body) return null;
  return captureReviewEnvelopeSchema.parse(body.content);
}

function assertRelationshipProposalOwner(
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
      proposal.dataScope === "private" ||
      proposal.resourceType === "relation" ||
      isRelationshipMutation(proposal.inputs) ||
      googleProposal
    ) &&
    (
      identity.type !== "user" ||
      relationshipOwnerFromLedger(proposal) !== identity.id ||
      (googleProposal && (
        proposal.workspaceId !== google.workspaceId ||
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
    ctx.wiring.workspaceStore,
    ctx.wiring.google.workspaceId,
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
  workspaceId: string,
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
      workspaceId,
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
    original.workspaceId,
    inputs.local_media_id,
  );
  const eventId =
    `capture:${original.workspaceId}:${inputs.local_media_id}`;
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
  if (media && media.workspaceId !== original.workspaceId) {
    throw new Error("Capture Local Media belongs to a different workspace");
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
    workspaceId: original.workspaceId,
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
    workspaceId: original.workspaceId,
    source: "capture",
    sourceRecordId: inputs.local_media_id,
    entityType: "event",
    entityId: eventId,
    createdAt: run.clock.nowISO(),
  });
  await putCaptureReviewEnvelope(wiring, original.workspaceId, {
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
    original.workspaceId,
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
  await putCaptureReviewEnvelope(wiring, original.workspaceId, {
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
  workspaceId: z.string().min(1),
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
  workspaceId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
});

const taskCreateInput = z.object({
  workspaceId: z.string().min(1),
  goalId: z.string().min(1),
  type: z.string().min(1),
  assignedAgentId: z.string().min(1),
});

const taskReassignInput = z.object({
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
  assignedAgentId: z.string().min(1),
});

const resolveSkillInput = z.object({
  workspaceId: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1),
  /** The Agent attempting to use a Skill for this Task — server-resolved
   * authority (capabilityScope/plane/dataScope) always comes from
   * `ctx.wiring.agents`, never client-asserted. */
  agentId: z.string().min(1),
  skillId: z.string().min(1).optional(),
  requestedDataScope: dataScopeEnum.optional(),
});

const ritualStep = z.object({
  skill: z.string().min(1),
  action: actionEnum,
  resourceType: resourceTypeEnum,
  resourceId: z.string().uuid().optional(),
  inputs: z.unknown(),
  dataScope: dataScopeEnum.optional(),
  /** AGS1/TASK-007 — see RitualStepDef.goalTaskRef's doc comment (@bridge/core's ports.ts). */
  goalTaskRef: z.object({ goalId: z.string().min(1), taskId: z.string().min(1) }).optional(),
});

const ritualRunInput = z.object({
  workspaceId: z.string().min(1),
  ritualId: z.string().min(1),
  actor: actorSchema,
  onBehalfOf: onBehalfOfSchema.optional(),
  steps: z.array(ritualStep).min(1),
  seed: z.string().optional(),
});

const ritualRunByIdInput = z.object({
  workspaceId: z.string().min(1),
  ritualId: z.string().min(1),
  modulePackageName: z.string().min(1).optional(),
  actor: actorSchema.optional(),
  onBehalfOf: onBehalfOfSchema.optional(),
  params: z.record(z.unknown()).optional(),
  seed: z.string().optional(),
});

const toolRunInput = ritualRunByIdInput.extend({ actor: actorSchema });

/** Layered, gated agent permissions (least-privilege; cf. Google incremental scopes).
 * `send` is intentionally NOT an egress tier — agents may never send (human-only). */
const egressTierEnum = z.enum(["none", "read-graph", "draft-graph", "source-internet"]);

const agentCreateInput = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  capabilityScope: z.array(z.string()).default([]),
  allowedSkills: z.array(z.string()).default([]),
  dataScope: dataScopeEnum.default("public"),
  egressTier: egressTierEnum.default("none"),
});

const agentUpdateInput = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).optional(),
  capabilityScope: z.array(z.string()).optional(),
  allowedSkills: z.array(z.string()).optional(),
  dataScope: dataScopeEnum.optional(),
  egressTier: egressTierEnum.optional(),
});

const ritualCreateInput = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  agentIds: z.array(z.string().min(1)).min(1),
  steps: z.array(ritualStep).min(1),
});

// ---------------------------------------------------------------------------
// Capability Trust Model (docs/wiki/vision.md "Capability Trust Model" +
// "Promotion defaults"). Zod-validated at this seam like every other router
// namespace; governance (approve) routes through the pipeline's decide()
// semantics — human identity from ctx.identity, agents blocked by the floor.
// ---------------------------------------------------------------------------
const capabilityTypeEnum = z.enum(["skill", "workflow", "agent", "tool", "integration", "view", "dashboard"]);
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
  workspaceId: z.string().min(1),
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
  workspaceId: z.string().min(1),
  manifestId: z.string().min(1),
  /** Calendar-day key for the auto-activation budget (UTC "YYYY-MM-DD"). Caller-
   * injected so the router stays a determinism-seam consumer, not a wall-clock reader. */
  todayKey: z.string().min(1),
});

// ---------------------------------------------------------------------------
// P2 Capability packages (docs/raw/capability-package-format.md, ADR-018) — the
// shipping unit above one capability_manifests row. `register` parses+validates
// a raw package.yaml-shaped object (accepts either already-parsed YAML or a
// plain JSON body) and stores it as a `private`-state installation row, no risk
// computed yet (register != propose-for-install, mirrors capability.register's
// "generation only ever creates draft"). `install` computes package risk over
// the full bundled+dependency closure, applies the lethal-trifecta union
// check, and routes through the SAME pipeline propose/decide semantics
// `capability.approve`/`workspace.blueprint.activate` use — external band is
// the same non-removable hard floor, no trust grant can shortcut it.
// ---------------------------------------------------------------------------

const packageRegisterInput = z.object({
  workspaceId: z.string().min(1),
  /** Already-parsed package.yaml (or an equivalent plain object) — parsed+
   * validated by parsePackageManifest at this seam. */
  manifest: z.unknown(),
});

const packageIdInput = z.object({ installationId: z.string().min(1) });

const packageInstallInput = z.object({
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  /** Calendar-day key for the auto-activation budget (mirrors capability.activate's todayKey). */
  todayKey: z.string().min(1),
});

const packagePromoteInput = z.object({
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
});

const packageRollbackInput = z.object({
  workspaceId: z.string().min(1),
  /** The historical installation row (any state) to fork a new draft from. */
  rollbackTargetId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// P1 Workspace Generator — blueprint -> view grammar (docs/wiki/vision.md "View
// grammar"). Blueprint changes are GOVERNED PROPOSALS: propose() writes a DRAFT
// workspace_definition (no direct activation), activate() is the governed step
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
  kind: z.enum(["text", "number", "select", "multiselect", "date", "checkbox", "url", "relation", "formula", "tool", "location"]),
  options: z.array(z.string()).optional(),
  toolId: z.string().optional(),
});

const blueprintEntityInput = z.object({
  nodeType: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(blueprintFieldInput),
});

const blueprintViewInput = z.object({
  entity: z.string().min(1),
  kind: z.enum(["table", "gallery", "kanban", "calendar", "map", "network", "chatbot", "dashboard", "canvas"]),
  config: z
    .object({
      sorts: z.array(z.object({ id: z.string(), dir: z.enum(["asc", "desc"]) })).optional(),
      rowFilters: z
        .array(
          z.object({
            field: z.string(),
            op: z.enum(["contains", "is", "is_not", "is_empty", "is_not_empty", "starts_with"]),
            value: z.string(),
          }),
        )
        .optional(),
      filterMatch: z.enum(["all", "any"]).optional(),
      groupBy: z.string().nullable().optional(),
    })
    .optional(),
});

const workspaceBlueprintInput = z.object({
  vocabulary: z.record(z.string(), z.string()),
  entities: z.array(blueprintEntityInput),
  views: z.array(blueprintViewInput),
  capabilities: z.array(z.string()),
});

/** Strip zod-optional `undefined` keys so the payload satisfies WorkspaceBlueprint's
 * exactOptionalPropertyTypes shape (same reasoning as cleanOnBehalfOf/cleanContext
 * above) before it reaches compileBlueprint or the store. */
function toWorkspaceBlueprint(input: z.infer<typeof workspaceBlueprintInput>): WorkspaceBlueprint {
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
        ...(f.toolId ? { toolId: f.toolId } : {}),
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
            },
          }
        : {}),
    })),
  };
}

const blueprintGetInput = z.object({ workspaceId: z.string().min(1) });
const blueprintGetByIdInput = z.object({
  workspaceId: z.string().min(1),
  definitionId: z.string().min(1),
});
const blueprintProposeInput = z.object({
  workspaceId: z.string().min(1),
  blueprint: workspaceBlueprintInput,
});
const blueprintActivateInput = z.object({
  workspaceId: z.string().min(1),
  definitionId: z.string().min(1),
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

const chiefOfStaffConverseInput = z.object({
  workspaceId: z.string().min(1),
  message: z.string().min(1),
  /** How many routing hops this conversation has already taken — the caller
   * (frontend chat panel) tracks this per-conversation and passes it back each
   * turn so the hard chain-depth cap (assertChainDepth) can be enforced
   * server-side, not just trusted client-side. Defaults to 0 (a fresh
   * conversation's first turn). */
  chainDepth: z.number().int().min(0).default(0),
  /** The user's chosen spirit animal (avatar-store.ts SPIRIT_ANIMALS id),
   * client-supplied — client-local preference today, not yet kernel data
   * (ADR-033's open item). Optional and additive: omitting it just means no
   * tone flavoring, never an error. */
  animal: z.string().optional(),
});

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

function packageInstallIdFromProposal(entry: LedgerEntry): string | undefined {
  if (typeof entry.inputs !== "object" || entry.inputs === null || Array.isArray(entry.inputs)) return undefined;
  const inputs = entry.inputs as Record<string, unknown>;
  if (inputs.operation !== "package_install" || typeof inputs.installationId !== "string") return undefined;
  if (entry.resourceId !== inputs.installationId) return undefined;
  if (entry.id !== stablePackageInstallProposalId(entry.workspaceId, inputs.installationId)) return undefined;
  return inputs.installationId;
}

async function findPendingProposalById(
  wiring: Wiring,
  workspaceId: string,
  proposalId: string,
): Promise<(Proposal & { createdAt: string }) | null> {
  let offset = 0;
  while (true) {
    const page = await wiring.pipeline.listPending(workspaceId, { limit: 200, offset });
    const found = page.items.find((proposal) => proposal.id === proposalId);
    if (found) return found;
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return null;
  }
}

async function assertCurrentCommonsAttachment(
  wiring: Wiring,
  installation: PackageInstallationRow,
): Promise<CommonsPackageEntry | null> {
  const attachment = installation.moduleAttachment;
  if (!attachment) return null;
  const ownerModule = await wiring.packageStore.getAvailable(
    installation.workspaceId,
    attachment.modulePackageName,
  );
  if (!ownerModule || ownerModule.status !== "installed" || !ownerModule.manifest.module) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `owning Module "${attachment.modulePackageName}" is no longer installed`,
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
    installation.packageName,
    installation.packageVersion,
  );
  if (!entry || entry.integrity.value !== attachment.contentHash) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Commons installation no longer matches its pinned root artifact",
    });
  }
  try {
    assertCommonsEntryContentTrusted(entry);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Commons root artifact failed trust verification",
    });
  }
  if (entry.kind !== need.kind || !need.tags.every((tag) => entry.tags.includes(tag))) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Commons package no longer satisfies the declared Module need",
    });
  }
  if (
    entry.manifest.capabilities.length === 0 ||
    entry.manifest.capabilities.some((capability) => capability.capabilityType !== "skill")
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only Skill packages can remain attached beneath a Module Agent",
    });
  }
  return entry;
}

async function verifiedCommonsDependencyInstallations(
  wiring: Wiring,
  root: PackageInstallationRow,
  rootEntry: CommonsPackageEntry | null,
): Promise<PackageInstallationRow[]> {
  if (!root.moduleAttachment || !rootEntry) return [];
  const { items } = await wiring.packageStore.list(root.workspaceId, { limit: 10_000, offset: 0 });
  const pins = new Map<string, string>(
    (rootEntry.securityScan.dependencyPins ?? []).map(
      (pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const,
    ),
  );
  const found = new Map<string, PackageInstallationRow>();
  const visited = new Set<string>();
  const visit = async (entry: CommonsPackageEntry): Promise<void> => {
    for (const dependency of entry.manifest.dependencies) {
      const key = `${dependency.manifestId}@${dependency.version}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const expectedHash = pins.get(key);
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
      try {
        assertCommonsEntryContentTrusted(dependencyEntry);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : `Commons dependency "${key}" failed trust verification`,
        });
      }
      const local = items.find(
        (candidate) =>
          candidate.packageName === dependency.manifestId &&
          candidate.packageVersion === dependency.version &&
          candidate.moduleAttachment?.source === "commons" &&
          candidate.moduleAttachment.modulePackageName === root.moduleAttachment?.modulePackageName &&
          candidate.moduleAttachment.agentId === root.moduleAttachment?.agentId &&
          candidate.moduleAttachment.needId === root.moduleAttachment?.needId &&
          candidate.moduleAttachment.contentHash === expectedHash,
      );
      if (!local || !["private", "promoted", "available"].includes(local.state)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Commons dependency "${key}" is not staged in an activatable state`,
        });
      }
      found.set(local.id, local);
      for (const pin of dependencyEntry.securityScan.dependencyPins ?? []) {
        pins.set(`${pin.name}@${pin.version}`, pin.contentHash);
      }
      await visit(dependencyEntry);
    }
  };
  await visit(rootEntry);
  return [...found.values()];
}

async function activateApprovedPackageInstallation(
  wiring: Wiring,
  workspaceId: string,
  installationId: string,
): Promise<PackageInstallationRow> {
  let installation = await wiring.packageStore.get(installationId);
  if (!installation || installation.workspaceId !== workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
  }
  const rootEntry = await assertCurrentCommonsAttachment(wiring, installation);
  const dependencies = await verifiedCommonsDependencyInstallations(wiring, installation, rootEntry);
  for (const dependency of dependencies) {
    await wiring.packageStore.setComputedRisk(
      dependency.id,
      maxRisk(dependency.computedRisk, installation.computedRisk),
    );
    await wiring.packageStore.setStatus(dependency.id, "installed");
    let current = (await wiring.packageStore.get(dependency.id))!;
    if (current.state === "private") current = await wiring.packageStore.setState(current.id, "promoted");
    if (current.state === "promoted") {
      const available = await wiring.packageStore.getAvailable(
        workspaceId,
        current.packageName,
        current.moduleAttachment,
      );
      const promotion = promoteToAvailable(current, available);
      await wiring.packageStore.setState(promotion.promoted.installationId, promotion.promoted.nextState);
      if (promotion.demoted) {
        await wiring.packageStore.setState(promotion.demoted.installationId, promotion.demoted.nextState);
      }
    } else if (current.state !== "available") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Commons dependency cannot activate from state "${current.state}"`,
      });
    }
  }
  if (installation.status !== "installed") {
    installation = await wiring.packageStore.setStatus(installation.id, "installed");
  }
  if (installation.state === "private") {
    installation = await wiring.packageStore.setState(installation.id, "promoted");
  } else if (installation.state !== "promoted" && installation.state !== "available") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `package installation cannot activate from state "${installation.state}"`,
    });
  }
  return installation;
}

async function validateDealPilotDiscoveryOutput(wiring: Wiring, inputs: unknown, output: unknown) {
  const request = inputs as {
    kind?: unknown;
    workspaceId?: unknown;
    thesisId?: unknown;
  };
  if (request.kind !== "thesis_source_discovery") return null;
  const proposed = output as ThesisSourceDiscoveryProposal | undefined;
  if (
    proposed?.kind !== "thesis_source_discovery" ||
    typeof request.workspaceId !== "string" ||
    typeof request.thesisId !== "string" ||
    proposed.workspaceId !== request.workspaceId ||
    proposed.thesisId !== request.thesisId ||
    !Array.isArray(proposed.relations)
  ) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "DealPilot discovery proposal binding is invalid" });
  }
  const thesis = await wiring.dealpilot.store.get("thesis", request.workspaceId, request.thesisId);
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
    const source = await wiring.dealpilot.store.get("source", request.workspaceId, relation.sourceId);
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
    workspaceId: request.workspaceId,
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
  workspaceId: string,
  proposalId: string,
): Promise<{ original: LedgerEntry; decision: LedgerEntry; ownerUserId: string }> {
  const original = await ctx.wiring.ledger.get(proposalId);
  if (
    !original ||
    original.workspaceId !== workspaceId ||
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
  workspaceId: string,
  proposalId: string,
) {
  const { original, decision, ownerUserId } =
    await approvedRelationshipResolution(ctx, workspaceId, proposalId);
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
      workspaceId,
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

export const appRouter = t.router({
  health: procedure.query(() => ({ ok: true, service: "bridge-api" })),

  action: t.router({
    /** Propose a governed mutation → Proposal (pending_review | applied | rejected). */
    propose: procedure.input(proposeInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
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
        plane: "local" as const,
      };
      const onBehalfOf = resolveClientOnBehalfOf(ctx.identity, input.onBehalfOf);
      return ctx.wiring.pipeline.propose(
        {
          workspaceId: input.workspaceId,
          actor,
          ...(onBehalfOf ? { onBehalfOf } : {}),
          action: input.action as Action,
          resourceType: input.resourceType as ResourceType,
          ...(input.resourceId ? { resourceId: input.resourceId } : {}),
          inputs: input.inputs,
          skill: input.skill,
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
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only a user can request an Outreach Agent draft",
          });
        }

        const idempotencyKey = `${input.workspaceId}:${ctx.identity.id}:${input.sourceId}`;
        const proposalId = stableOutreachProposalId(idempotencyKey);
        const active = outreachDraftsInFlight.get(idempotencyKey);
        if (active) return active;

        const operation = (async (): Promise<OutreachDraftResult> => {
          let offset = 0;
          while (true) {
            const pending = await ctx.wiring.pipeline.listPending(input.workspaceId, {
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
            input.workspaceId,
          );
          try {
            return await ctx.wiring.pipeline.propose(
              {
                workspaceId: input.workspaceId,
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
                  ? { context: { type: "ritual", id: input.runId, runId: input.runId } }
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
              const pending = await ctx.wiring.pipeline.listPending(input.workspaceId, {
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
            workspaceId: z.string().min(1),
            limit: z.number().int().min(1).max(200).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .default({ workspaceId: PILOT_WORKSPACE }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        // TASK-010 review round-4 item 2 + TASK-008 RM4: `privateOwnerUserId`
        // is enforced at the STORE level (`privateProposalOwnerScope` in
        // packages/db/src/ledger-store.ts / `ledgerEntryVisibleToPrivateOwner`
        // in packages/core/src/memory/stores.ts) — widened to cover BOTH
        // RM4's relation-resourceType rows AND TASK-010's own
        // `inputs.visibility === "private"` marker (red-flag correction
        // proposals), so a single query-level filter now protects every
        // private proposal shape without the app-side accumulate-and-filter
        // loop this endpoint previously needed.
        const { items, total } = await ctx.wiring.pipeline.listPending(input.workspaceId, {
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
          workspaceId: z.string().min(1),
          limit: z.number().int().min(1).max(100).default(100),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(
          ctx.wiring.workspaceStore,
          input.workspaceId,
          ctx.identity.id,
        );
        const { items, total } = await ctx.wiring.ledger.listHistory(
          input.workspaceId,
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
        assertPilotWorkspace(proposal.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, proposal.workspaceId, ctx.identity.id);
        assertRelationshipProposalOwner(proposal, ctx.identity, ctx.wiring.google);
        // TASK-010: a private red-flag correction proposal (`resourceType`
        // never "relation" — always "signal") gets the SAME "hide existence
        // entirely from a non-owner" treatment RM4's relation rows get above,
        // via TASK-010's own `inputs.visibility === "private"` marker. The
        // `resourceType !== "relation"` guard keeps this from re-interpreting
        // a relation proposal's OWN `visibility` enum value (which can
        // legitimately be `"private"`/`"workspace"`/`"public"` and is already
        // fully handled by `assertRelationshipProposalOwner` above).
        if (proposal.resourceType !== "relation" && isPrivateProposalInputs(proposal.inputs) && proposal.onBehalfOfId !== ctx.identity.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
        }
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

    /** Resolve a pending proposal: approve | veto | edit. TASK-010 review
     * round-4 item 2: a PRIVATE proposal may only be decided by the user it
     * was raised `onBehalfOf` — a non-owning member (even though they pass
     * the ordinary workspace-membership gate) is rejected FORBIDDEN, never
     * merely filtered from a list. */
    decide: authenticatedProcedure.input(decideInput).mutation(async ({ input, ctx }) => {
      // Decider is the SERVER-RESOLVED identity (ctx.identity), never the client's
      // claimed actor — the agent-floor in decide() blocks any agent from approving.
      const original = await ctx.wiring.ledger.get(input.proposalId);
      if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
      assertPilotWorkspace(original.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, original.workspaceId, ctx.identity.id);
      assertRelationshipProposalOwner(original, ctx.identity, ctx.wiring.google);
      // TASK-010: same non-relation-scoped private-proposal guard as
      // `resolution` above — a red-flag correction proposal may only be
      // decided by the user it was raised `onBehalfOf`, even though it
      // passes the ordinary workspace-membership gate.
      if (original.resourceType !== "relation" && isPrivateProposalInputs(original.inputs) && original.onBehalfOfId !== ctx.identity.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This proposal is private to its own owner" });
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
        isRelationshipProposal || isCaptureIntakeProposal;
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
            original.workspaceId,
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
              original.workspaceId,
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
            original.workspaceId,
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
        const packageInstallationId = packageInstallIdFromProposal(original);
        const packageInstallation =
          packageInstallationId && input.decision !== "veto"
            ? await activateApprovedPackageInstallation(
                ctx.wiring,
                original.workspaceId,
                packageInstallationId,
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
        const effects = await ctx.wiring.google.onApproved(input.proposalId, resolved, ctx.run);
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
            effectsStatus: "failed" as const,
            effectsError,
            effectsAuditId: undefined,
            ...(packageInstallation ? { packageInstallation } : {}),
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
          effectsStatus: "confirmed" as const,
          ...(packageInstallation ? { packageInstallation } : {}),
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
              original.workspaceId,
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
            workspaceId: resolved.request.workspaceId,
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
  }),

  /** Gmail + Google Calendar integration — connect, sync (read), send (write). */
  /** Gmail + Google Calendar — connect, sync (read), draft (write). Distinct from the
   * generic `integration` router below (social providers + governed scopes).
   *
   * Single-tenant note (All fixes.md Phase 3 item 11a): these procedures take NO
   * `workspaceId` param at all — they are workspace-IMPLICIT, always resolving
   * through `ctx.wiring.google`, which is itself pinned to `PILOT_WORKSPACE` inside
   * `buildWiring()`. We deliberately did NOT add an optional `workspaceId` param here
   * (unlike `dealpilot.list`): no frontend caller (`Design Bridge AI Interface
   * (Copy)/src/app/data/api.ts`) ever attempts to pass a workspace context to any
   * `google.*` call, so there is no existing behavior that silently ignores a
   * client-supplied workspace id to fix — these procedures never claimed
   * multi-tenancy in the first place. Adding an unused, always-optional param would
   * only add surface area without closing a real gap; if a caller ever needs
   * multi-workspace Google integration, that's the same Phase 5 multi-tenancy work
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
          workspaceId: z.string().min(1),
          localMediaId: z.string().trim().min(1).max(500),
          kind: z.enum(["photo", "video"]).optional(),
          caption: z.string().trim().max(4_000).optional(),
          ocrText: z.string().max(20_000).optional(),
          capturedAt: z.string().datetime({ offset: true }),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return withCaptureStageLock(
          `${input.workspaceId}:${ctx.identity.id}:${input.localMediaId}`,
          async () => {
            const receivedAt = ctx.run.clock.nowISO();
            const existingEnvelope = await getCaptureReviewEnvelope(
              ctx.wiring,
              input.workspaceId,
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
              input.workspaceId,
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
              await putCaptureReviewEnvelope(ctx.wiring, input.workspaceId, {
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
              input.workspaceId,
              stagingEnvelope,
            );
            const goalTaskRef = await provisionCaptureTask(
              ctx.wiring,
              input.workspaceId,
            );
            const proposal = await ctx.wiring.pipeline.propose(
              {
                workspaceId: input.workspaceId,
                actor: { type: "agent", id: LEARNING_AGENT, plane: "local" },
                onBehalfOf: { type: "user", id: ctx.identity.id },
                action: "write",
                resourceType: "event",
                dataScope: "private" as DataScope,
                skill: "stageCapture",
                seed: `capture:${input.workspaceId}:${input.localMediaId}`,
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
            await putCaptureReviewEnvelope(ctx.wiring, input.workspaceId, {
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
        workspaceId: z.string().min(1),
        localMediaIds: z.array(z.string().trim().min(1).max(500)).max(100),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(
          ctx.wiring.workspaceStore,
          input.workspaceId,
          ctx.identity.id,
        );
        const items = await Promise.all(
          input.localMediaIds.map(async (localMediaId) => {
            const envelope = await getCaptureReviewEnvelope(
              ctx.wiring,
              input.workspaceId,
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
        PILOT_WORKSPACE,
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

  /** Agent governance — create/update an agent with LAYERED, least-privilege scopes.
   * Escalating capability (external:send, governance, full-graph, '*') is stripped at
   * the seam; agents can never be created able to send or approve. */
  agent: t.router({
    create: procedure.input(agentCreateInput).mutation(async ({ input, ctx }) => {
      const mem = ctx.wiring.memory;
      if (!mem) throw new Error("agent.create: in-memory governance store required (persistent agent CRUD pending)");
      const built = buildAgentCapability({ capabilityScope: input.capabilityScope, egressTier: input.egressTier as EgressTier });
      const agentId = ctx.run.ids.next();
      mem.agents.scope.set(agentId, built.scope);
      mem.agents.tiers.set(agentId, input.dataScope as DataScope);
      mem.agents.skills.set(agentId, input.allowedSkills);
      mem.agents.assumed.set(agentId, null);
      return {
        agentId,
        name: input.name,
        scope: built.scope,
        dropped: built.dropped, // escalating tokens we refused to grant (shown in UI)
        dataScope: input.dataScope,
        egressTier: input.egressTier,
        // Non-removable, always-true facts about an in-platform agent:
        floor: { canSend: false, canApprove: false },
      };
    }),

    update: procedure.input(agentUpdateInput).mutation(async ({ input, ctx }) => {
      const mem = ctx.wiring.memory;
      if (!mem) throw new Error("agent.update: in-memory governance store required (persistent agent CRUD pending)");
      if (!mem.agents.scope.has(input.agentId)) throw new Error(`agent.update: unknown agent ${input.agentId}`);
      let dropped: string[] = [];
      if (input.capabilityScope !== undefined || input.egressTier !== undefined) {
        const built = buildAgentCapability({
          capabilityScope: input.capabilityScope ?? mem.agents.scope.get(input.agentId) ?? [],
          egressTier: (input.egressTier ?? "none") as EgressTier,
        });
        mem.agents.scope.set(input.agentId, built.scope);
        dropped = built.dropped;
      }
      if (input.dataScope !== undefined) mem.agents.tiers.set(input.agentId, input.dataScope as DataScope);
      if (input.allowedSkills !== undefined) mem.agents.skills.set(input.agentId, input.allowedSkills);
      return {
        agentId: input.agentId,
        scope: mem.agents.scope.get(input.agentId) ?? [],
        dropped,
        dataScope: mem.agents.tiers.get(input.agentId) ?? "all",
        floor: { canSend: false, canApprove: false },
      };
    }),
  }),

  ritual: t.router({
    /** Create a ritual/workflow — REJECTED if any step exceeds its assigned agents'
     * authority (ritual ⊆ agent). The gate cannot be widened by a workflow. */
    create: procedure.input(ritualCreateInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      if (input.agentIds.length !== 1) {
        throw new Error("ritual.create: exactly one owning Agent is required");
      }
      const agentId = input.agentIds[0]!;
      const agentViews = await Promise.all(
        input.agentIds.map(async (id) => ({
          id,
          scope: await ctx.wiring.agents.capabilityScope(id),
          dataScope: await ctx.wiring.agents.dataScope(id),
        })),
      );
      const violations = validateRitualWithinAgents(
        input.steps.map((s) => ({
          action: s.action as Action,
          resourceType: s.resourceType as ResourceType,
          ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
        })),
        agentViews,
      );
      if (violations.length > 0) {
        return { ok: false as const, violations, reason: "ritual exceeds assigned agents' authority (ritual ⊆ agent)" };
      }
      const ritualId = ctx.run.ids.next();
      await ctx.wiring.ritualRegistry.save({
        id: ritualId,
        name: input.name,
        workspaceId: input.workspaceId,
        agentId,
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
      return { ok: true as const, ritualId, agentId, agentIds: [agentId] };
    }),

    /** Run a ritual: ordered, governed steps through the pipeline. */
    run: procedure.input(ritualRunInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      if (input.actor.type !== ctx.identity.type || input.actor.id !== ctx.identity.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "ritual.run actor must match the authenticated workspace member",
        });
      }
      const onBehalfOf = resolveClientOnBehalfOf(ctx.identity, input.onBehalfOf);
      return ctx.wiring.ritualExecutor.run(
        {
          workspaceId: input.workspaceId,
          ritualId: input.ritualId,
          actor: {
            type: input.actor.type as ActorType,
            id: input.actor.id,
            plane: "local",
          },
          ...(onBehalfOf ? { onBehalfOf } : {}),
          steps: input.steps.map((s) => ({
            skill: s.skill,
            action: s.action as Action,
            resourceType: s.resourceType as ResourceType,
            ...(s.resourceId ? { resourceId: s.resourceId } : {}),
            inputs: s.inputs,
            ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
            ...(s.goalTaskRef ? { goalTaskRef: s.goalTaskRef } : {}),
          })),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        ctx.run,
      );
    }),

    /** Run a ritual by id — loads its step config from the registry (P2). */
    runById: procedure.input(ritualRunByIdInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      if (
        input.actor &&
        (input.actor.type !== ctx.identity.type || input.actor.id !== ctx.identity.id)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "ritual.runById actor must match the authenticated workspace member",
        });
      }
      const onBehalfOf = resolveClientOnBehalfOf(ctx.identity, input.onBehalfOf);
      if (isModuleRuntimeRitualId(input.ritualId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Module Automations must run through their manifest Ritual key and package binding",
        });
      }
      let ritualId = input.ritualId;
      if (input.modulePackageName) {
        const moduleInstallation = await ctx.wiring.packageStore.getAvailable(
          input.workspaceId,
          input.modulePackageName,
        );
        const automation = moduleInstallation?.manifest.module?.automations.find(
          (candidate) => candidate.ritualId === input.ritualId,
        );
        const runtimeAgentId = automation
          ? resolveModuleAgentRuntimeId(input.modulePackageName, automation.agentId)
          : undefined;
        const runtimeRitualId = resolveModuleRitualRuntimeId(input.modulePackageName, input.ritualId);
        const definition = runtimeRitualId
          ? await ctx.wiring.ritualRegistry.load(input.workspaceId, runtimeRitualId)
          : null;
        if (!automation || !runtimeAgentId || !runtimeRitualId || definition?.agentId !== runtimeAgentId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Module Automation has no verified runtime binding",
          });
        }
        ritualId = runtimeRitualId;
      }
      return ctx.wiring.ritualExecutor.runById(
        {
          workspaceId: input.workspaceId,
          ritualId,
          ...(input.actor
            ? {
                actor: {
                  type: input.actor.type as ActorType,
                  id: input.actor.id,
                  ...(input.actor.plane ? { plane: input.actor.plane } : {}),
                },
              }
            : {}),
          ...(onBehalfOf ? { onBehalfOf } : {}),
          ...(input.params ? { params: input.params } : {}),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        ctx.run,
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
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, total } = await ctx.wiring.graphStore.listPeople(
          input.workspaceId,
          ctx.identity.id,
          {
            limit: input.limit,
            offset: input.offset,
            ...(input.query ? { query: input.query } : {}),
          },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getPerson: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getPerson(input.workspaceId, ctx.identity.id, input.id);
      }),

    createPerson: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), values: personCreateFieldsSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const recordId = ctx.run.ids.next();
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_record_mutation",
          recordType: "person",
          operation: "create",
          recordId,
          values: input.values,
        });
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    updatePerson: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        id: z.string().uuid(),
        values: personUpdateFieldsSchema,
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const person = await ctx.wiring.graphStore.getPerson(
          input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    archivePerson: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const person = await ctx.wiring.graphStore.getPerson(
          input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    listCommunities: authenticatedProcedure
      .input(relationshipListInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, total } = await ctx.wiring.graphStore.listCommunities(
          input.workspaceId,
          ctx.identity.id,
          {
            limit: input.limit,
            offset: input.offset,
            ...(input.query ? { query: input.query } : {}),
          },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getCommunity: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getCommunity(input.workspaceId, ctx.identity.id, input.id);
      }),

    createCommunity: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), values: communityCreateFieldsSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const recordId = ctx.run.ids.next();
        const payload = relationshipMutationPayloadSchema.parse({
          kind: "relationship_record_mutation",
          recordType: "community",
          operation: "create",
          recordId,
          values: input.values,
        });
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    updateCommunity: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        id: z.string().uuid(),
        values: communityUpdateFieldsSchema,
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const community = await ctx.wiring.graphStore.getCommunity(
          input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    archiveCommunity: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const community = await ctx.wiring.graphStore.getCommunity(
          input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    createInteraction: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), values: humanInteractionFieldsSchema }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const participantsAccessible =
          await ctx.wiring.graphStore.areRelationshipRecordsAccessible(
            input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    memories: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
        snapshotAt: z.string().datetime({ offset: true }).optional(),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Relationship Memory requires a Human user principal" });
        }
        const person = await ctx.wiring.graphStore.getPerson(
          input.workspaceId,
          ctx.identity.id,
          input.personId,
        );
        if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
        const snapshotAt = input.snapshotAt ?? ctx.run.clock.nowISO();
        const rows = await ctx.wiring.memoryStore.retrieve(
          {
            subjectElementId: input.personId,
            snapshotAt,
            limit: input.limit + 1,
            offset: input.offset,
          },
          { workspaceId: input.workspaceId, userId: ctx.identity.id },
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
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        type: z.enum(["episodic", "semantic", "procedural", "preference"]).default("semantic"),
        content: z.string().trim().min(1).max(5_000),
        scope: z.enum(["private", "workspace"]).default("private"),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const person = await ctx.wiring.graphStore.getPerson(
          input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    correctMemory: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        memoryId: z.string().uuid(),
        content: z.string().trim().min(1).max(5_000),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Relationship Memory changes require a Human user principal" });
        }
        const [person, memory] = await Promise.all([
          ctx.wiring.graphStore.getPerson(input.workspaceId, ctx.identity.id, input.personId),
          ctx.wiring.memoryStore.get(input.memoryId, {
            workspaceId: input.workspaceId,
            userId: ctx.identity.id,
          }),
        ]);
        if (
          !person?.isOwner ||
          !memory ||
          memory.subjectElementId !== input.personId ||
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    forgetMemory: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        memoryId: z.string().uuid(),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Relationship Memory changes require a Human user principal" });
        }
        const [person, memory] = await Promise.all([
          ctx.wiring.graphStore.getPerson(input.workspaceId, ctx.identity.id, input.personId),
          ctx.wiring.memoryStore.get(input.memoryId, {
            workspaceId: input.workspaceId,
            userId: ctx.identity.id,
          }),
        ]);
        if (
          !person?.isOwner ||
          !memory ||
          memory.subjectElementId !== input.personId ||
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    commitments: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
        includeArchived: z.boolean().default(false),
        snapshotAt: z.string().datetime({ offset: true }).optional(),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const snapshotAt = input.snapshotAt ?? ctx.run.clock.nowISO();
        const page = await ctx.wiring.graphStore.listCommitments(
          input.workspaceId,
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
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        text: z.string().trim().min(1).max(2_000),
        dueAt: relationshipDateTimeSchema.nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const person = await ctx.wiring.graphStore.getPerson(
          input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    updateCommitment: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        commitmentId: z.string().uuid(),
        text: z.string().trim().min(1).max(2_000),
        dueAt: relationshipDateTimeSchema.nullable().optional(),
        status: z.enum(["pending", "completed", "cancelled"]),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const current = await ctx.wiring.graphStore.listCommitments(
          input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    archiveCommitment: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        commitmentId: z.string().uuid(),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const current = await ctx.wiring.graphStore.listCommitments(
          input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    introductions: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
        snapshotAt: z.string().datetime({ offset: true }).optional(),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const snapshotAt = input.snapshotAt ?? ctx.run.clock.nowISO();
        const page = await ctx.wiring.graphStore.listIntroductions(
          input.workspaceId,
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
            input.workspaceId,
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
        workspaceId: z.string().uuid(),
        sourcePersonId: z.string().uuid(),
        targetPersonId: z.string().uuid(),
      }).refine((input) => input.sourcePersonId !== input.targetPersonId, {
        message: "An Introduction requires two different People",
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const [sourcePerson, targetPerson] = await Promise.all([
          ctx.wiring.graphStore.getPerson(input.workspaceId, ctx.identity.id, input.sourcePersonId),
          ctx.wiring.graphStore.getPerson(input.workspaceId, ctx.identity.id, input.targetPersonId),
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    recordIntroductionConsent: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
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
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const page = await ctx.wiring.graphStore.listIntroductions(
          input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    transitionIntroduction: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        introductionId: z.string().uuid(),
        transition: z.enum(["cancel", "complete"]),
      }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const page = await ctx.wiring.graphStore.listIntroductions(
          input.workspaceId,
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
        return proposeRelationshipMutation(ctx, input.workspaceId, payload);
      }),

    meetingPrep: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        personId: z.string().uuid(),
        limit: z.number().int().min(1).max(25).default(10),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Meeting preparation requires a Human user principal" });
        }
        const person = await ctx.wiring.graphStore.getPerson(
          input.workspaceId,
          ctx.identity.id,
          input.personId,
        );
        if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
        const [timeline, memories, commitments, pendingCommitments] = await Promise.all([
          ctx.wiring.graphStore.listTimeline(
            input.workspaceId,
            ctx.identity.id,
            "person",
            input.personId,
            { limit: input.limit },
          ),
          ctx.wiring.memoryStore.retrieve(
            { subjectElementId: input.personId, limit: input.limit },
            { workspaceId: input.workspaceId, userId: ctx.identity.id },
          ),
          ctx.wiring.graphStore.listCommitments(
            input.workspaceId,
            ctx.identity.id,
            input.personId,
            { limit: input.limit, offset: 0 },
          ),
          ctx.wiring.graphStore.listCommitments(
            input.workspaceId,
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
        workspaceId: z.string().uuid(),
        recordType: z.enum(["person", "community"]),
        recordId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
        cursor: z.object({
          occurredAt: z.string().datetime(),
          id: z.string().uuid(),
        }).optional(),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const page = await ctx.wiring.graphStore.listTimeline(
          input.workspaceId,
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

    intakeReview: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
        offset: z.number().int().min(0).max(10_000).default(0),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const page = await ctx.wiring.pipeline.listPending(input.workspaceId, {
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
      .input(z.object({ workspaceId: z.string().uuid(), nodeType: relationshipNodeTypeEnum }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getNodeTypeOwner(input.nodeType);
      }),

    listRelations: authenticatedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
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
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, total, nextCursor } = await ctx.wiring.graphStore.listRelations(
          input.workspaceId,
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
        workspaceId: z.string().uuid(),
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
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const result = await ctx.wiring.graphStore.findRelationshipPaths(
          input.workspaceId,
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

    communityWorkspace: authenticatedProcedure
      .input(z.object({
        workspaceId: z.string().uuid(),
        communityId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(25),
      }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const community = await ctx.wiring.graphStore.getCommunity(
          input.workspaceId,
          ctx.identity.id,
          input.communityId,
        );
        if (!community) throw new TRPCError({ code: "NOT_FOUND", message: "Community not found" });
        const [timeline, relationPage, signalPage, memberPage] = await Promise.all([
          ctx.wiring.graphStore.listTimeline(
            input.workspaceId,
            ctx.identity.id,
            "community",
            input.communityId,
            { limit: input.limit },
          ),
          ctx.wiring.graphStore.listRelations(
            input.workspaceId,
            ctx.identity.id,
            { nodeType: "community", nodeId: input.communityId },
            { limit: input.limit },
          ),
          ctx.wiring.graphStore.listSignals(
            input.workspaceId,
            ctx.identity.id,
            {
              limit: input.limit,
              offset: 0,
              subjectType: "community",
              subjectId: input.communityId,
            },
          ),
          ctx.wiring.graphStore.listCommunityMembers(
            input.workspaceId,
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
              input.workspaceId,
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
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Relationship evidence proposals require a Human user principal",
          });
        }
        const detail = await ctx.wiring.graphStore.getSignalEvidenceAnchor(
          input.workspaceId,
          ctx.identity.id,
          input.signalId,
          input.sourceEventId,
        );
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found or not accessible" });
        }
        const participantsAccessible =
          await ctx.wiring.graphStore.areRelationshipRecordsAccessible(
            input.workspaceId,
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
            workspaceId: input.workspaceId,
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
      .input(z.object({ workspaceId: z.string().uuid(), proposalId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { ownerUserId } = await approvedRelationshipResolution(
          ctx,
          input.workspaceId,
          input.proposalId,
        );
        const effect = await ctx.wiring.relationMaterializations.getByProposal(
          input.workspaceId,
          ownerUserId,
          input.proposalId,
        );
        return effect ? relationshipEffectView(effect) : null;
      }),

    outstandingMaterializations: authenticatedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.object({ id: z.string().uuid() }).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, nextCursor } =
          await ctx.wiring.relationMaterializations.listOutstandingPage(
            input.workspaceId,
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
      .input(z.object({ workspaceId: z.string().uuid(), proposalId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return retryApprovedRelationship(ctx, input.workspaceId, input.proposalId);
      }),

    reconcileApproved: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), proposalId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return retryApprovedRelationship(ctx, input.workspaceId, input.proposalId);
      }),
  }),

  /**
   * DealPilot — the first tool on the generic manifest intake seam (@bridge/tool-kit).
   * `source` quarantines through the pipeline as `external:fetch` (audited, policy-gated);
   * `commit` is the human "Add" that materializes ONE quarantined capture into DealPilot's
   * facts + candidate list (capture ≠ commit). Thesis storage is basic get/set, in-memory
   * (wiring.ts) — no thesis-management UI yet, that's a separate future item.
   */
  dealpilot: t.router({
    module: dealpilotProcedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .query(({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return dealPilotModuleManifest(ctx.wiring.dealpilot.bindings);
      }),

    records: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          page: z.enum(["deals", "sources", "theses"]),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.dealpilot.store.list(input.page, input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
      }),

    /** Compatibility endpoint for callers migrating from the pre-DP0 candidate feed. */
    list: dealpilotProcedure
      .input(
        z
          .object({
            workspaceId: z.string().min(1).optional(),
            limit: z.number().int().min(1).max(200).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .default({}),
      )
      .query(async ({ input, ctx }) => {
        if (input.workspaceId) assertPilotWorkspace(input.workspaceId);
        const workspaceId = input.workspaceId ?? PILOT_WORKSPACE;
        const records = await ctx.wiring.dealpilot.store.list("deals", workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        const items = await Promise.all(
          records.items.map(async (record) => {
            const profile = (await ctx.wiring.dealpilot.store.candidateProfile(workspaceId, record.id)) ?? {
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
          workspaceId: z.string().min(1),
          kind: z.enum(["deal", "source", "thesis"]),
          id: z.string().min(1),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const detail = await ctx.wiring.dealpilot.store.detail(
          input.kind,
          input.workspaceId,
          input.id,
          ctx.wiring.dealpilot.bindings,
        );
        if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: `${input.kind} Record not found` });
        if (detail.record.kind !== "source") return detail;
        return {
          ...detail,
          credentialProjection: await ctx.wiring.dealpilot.credentials.project(
            { workspaceId: input.workspaceId, sourceId: detail.record.id },
            detail.record.credentialRef,
          ),
          credentialCleanupAvailable: Boolean(
            detail.record.credentialRef &&
              detail.record.credentialOwnerId === ctx.identity.id,
          ),
        };
      }),

    createDeal: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          company: z.string().trim().min(1).max(300),
          revenue: z.number().nonnegative().optional(),
          ebitda: z.number().optional(),
          sde: z.number().optional(),
          askingPrice: z.number().nonnegative().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.dealpilot.store.createDeal({
          workspaceId: input.workspaceId,
          company: input.company,
          ...(input.revenue != null ? { revenue: input.revenue } : {}),
          ...(input.ebitda != null ? { ebitda: input.ebitda } : {}),
          ...(input.sde != null ? { sde: input.sde } : {}),
          ...(input.askingPrice != null ? { askingPrice: input.askingPrice } : {}),
        });
      }),

    createSource: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
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
        assertPilotWorkspace(input.workspaceId);
        const sourceId = ctx.run.ids.next();
        const sourceInput = {
          id: sourceId,
          workspaceId: input.workspaceId,
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
        const scope = { workspaceId: input.workspaceId, sourceId };
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
            input.workspaceId,
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
                input.workspaceId,
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
          workspaceId: z.string().min(1),
          name: z.string().trim().min(1).max(300),
          focus: z.string().trim().min(1).max(1_000),
          targetCagr: z.number().optional(),
          criteria: z.array(z.string().trim().min(1)).default([]),
          exclusions: z.array(z.string().trim().min(1)).default([]),
          sourcingStrategy: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const thesis = await ctx.wiring.dealpilot.store.createThesis({
          workspaceId: input.workspaceId,
          name: input.name,
          focus: input.focus,
          criteria: input.criteria,
          exclusions: input.exclusions,
          ...(input.targetCagr != null ? { targetCagr: input.targetCagr } : {}),
          ...(input.sourcingStrategy ? { sourcingStrategy: input.sourcingStrategy } : {}),
        });
        const discoveryTask = await proposeThesisSourceDiscovery(
          ctx.wiring.dealpilot.store,
          input.workspaceId,
          thesis.id,
        );
        const discovery = await ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "read",
            resourceType: "tool",
            skill: "stageMutation",
            inputs: discoveryTask,
          },
          ctx.run,
        );
        return { thesis, discovery };
      }),

    discoverDeals: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          sourceId: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        let proposal;
        try {
          const result = await ctx.wiring.ritualExecutor.runById(
            {
              workspaceId: input.workspaceId,
              ritualId: DEALPILOT_SOURCE_RITUAL_ID,
              onBehalfOf: { type: ctx.identity.type === "team" ? "team" : "user", id: ctx.identity.id },
              params: { workspaceId: input.workspaceId, sourceId: input.sourceId },
            },
            ctx.run,
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
          workspaceId: z.string().min(1),
          sourceId: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.dealpilot.store.listPendingCaptures(input.workspaceId, {
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
          limit: input.limit,
          offset: input.offset,
        });
      }),

    commit: dealpilotProcedure
      .input(z.object({ workspaceId: z.string().min(1), captureId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const captureStatus = await ctx.wiring.dealpilot.store.captureStatus(
          input.workspaceId,
          input.captureId,
        );
        if (captureStatus === "committed") {
          return { committed: false, alreadyCommitted: true as const };
        }
        if (captureStatus === null) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Quarantined capture not found" });
        }
        const capture = await ctx.wiring.dealpilot.store.getCapture(input.workspaceId, input.captureId);
        if (!capture) throw new TRPCError({ code: "NOT_FOUND", message: "Quarantined capture not found" });
        const proposalId = stableDealPilotCaptureProposalId(
          input.workspaceId,
          input.captureId,
        );
        const request = {
          workspaceId: input.workspaceId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "write" as const,
          resourceType: "tool" as const,
          skill: "stageMutation",
          inputs: { kind: "dealpilot_capture_commit", captureId: input.captureId },
          trustOrigin: capture.trustOrigin ?? "untrusted_external",
        };
        const materialize = async (proposal?: Proposal) => {
          const committed = await ctx.wiring.dealpilot.store.commitCapture(
            input.workspaceId,
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
          if (!isDealPilotCaptureProposal(existing, input.workspaceId, input.captureId)) {
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
      .input(z.object({ workspaceId: z.string().min(1), sourceId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const source = await ctx.wiring.dealpilot.store.get("source", input.workspaceId, input.sourceId);
        if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Source Record not found" });
        if (source.kind !== "source" || source.credentialOwnerId !== ctx.identity.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Source credential access is not authorized" });
        }
        try {
          return ctx.wiring.dealpilot.credentials.reauthenticate({
            actorType: ctx.identity.type,
            actorId: ctx.identity.id,
            workspaceId: input.workspaceId,
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
          workspaceId: z.string().min(1),
          sourceId: z.string().min(1),
          token: z.string().min(1),
          field: z.enum(["userId", "password"]),
          action: z.enum(["reveal", "copy"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const source = await ctx.wiring.dealpilot.store.get("source", input.workspaceId, input.sourceId);
        if (!source || source.kind !== "source") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Source Record not found" });
        }
        if (source.credentialOwnerId !== ctx.identity.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Source credential access is not authorized" });
        }
        try {
          return await ctx.wiring.dealpilot.credentials.access({
            reference: source.credentialRef,
            workspaceId: input.workspaceId,
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
          workspaceId: z.string().min(1),
          sourceId: z.string().min(1),
          token: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const source = await ctx.wiring.dealpilot.store.get(
          "source",
          input.workspaceId,
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
            workspaceId: input.workspaceId,
            sourceId: source.id,
            actorType: ctx.identity.type,
            actorId: ctx.identity.id,
            token: input.token,
          });
          await ctx.wiring.dealpilot.store.prepareCredentialRevocation(
            input.workspaceId,
            source.id,
            ctx.identity.id,
            source.credentialRef,
            audit,
          );
          await ctx.wiring.dealpilot.credentialVault.delete(
            { workspaceId: input.workspaceId, sourceId: source.id },
            source.credentialRef,
          );
          const revocation =
            await ctx.wiring.dealpilot.store.completeCredentialRevocation(
              input.workspaceId,
              source.id,
              ctx.identity.id,
              source.credentialRef,
            );
          return {
            revoked: true as const,
            cleared: revocation.cleared,
            credentialProjection:
              await ctx.wiring.dealpilot.credentials.project(
                { workspaceId: input.workspaceId, sourceId: source.id },
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

  tool: t.router({
    /** Invoke a tool — its composition runs through the pipeline (config → pipeline). */
    run: procedure.input(toolRunInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      if (input.actor.type !== ctx.identity.type || input.actor.id !== ctx.identity.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "tool.run actor must match the authenticated workspace member",
        });
      }
      const onBehalfOf = resolveClientOnBehalfOf(ctx.identity, input.onBehalfOf);
      return ctx.wiring.ritualExecutor.runTool(
        {
          workspaceId: input.workspaceId,
          ritualId: input.ritualId,
          actor: {
            type: input.actor.type as ActorType,
            id: input.actor.id,
            plane: "local",
          },
          ...(onBehalfOf ? { onBehalfOf } : {}),
          ...(input.params ? { params: input.params } : {}),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        ctx.run,
      );
    }),
  }),

  /**
   * Integration management — connected providers and their USER-EDITABLE scopes.
   * Backed by the governed integration store on the LOCAL plane. Granting an
   * agent-floor DENY scope (external:send, network_graph:full) is refused here.
   */
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
          workspaceId: z.string().min(1),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const all = await ctx.wiring.integrationStore.list(input.workspaceId);
        const total = all.length;
        const items = all.slice(input.offset, input.offset + input.limit);
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    connect: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          provider: z.enum(["x", "instagram", "facebook", "linkedin"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.integrationStore.connect(
          input.workspaceId,
          input.provider,
          oauthScopesFor(input.provider),
        );
      }),

    disconnect: procedure
      .input(z.object({ workspaceId: z.string().min(1), integrationId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await ctx.wiring.integrationStore.disconnect(
          input.workspaceId,
          input.integrationId,
        );
        return { ok: true };
      }),

    listScopes: procedure
      .input(z.object({ workspaceId: z.string().min(1), integrationId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.integrationStore.listScopes(
          input.workspaceId,
          input.integrationId,
        );
      }),

    grantScope: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          integrationId: z.string().uuid(),
          resourceType: z.string().min(1),
          action: actionEnum,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        try {
          return await ctx.wiring.integrationStore.grantScope({
            workspaceId: input.workspaceId,
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
      .input(z.object({ workspaceId: z.string().min(1), permissionId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await ctx.wiring.integrationStore.revokeScope(
          input.workspaceId,
          input.permissionId,
        );
        return { ok: true };
      }),
  }),

  /**
   * Workspace + team-member management — plain authenticated CRUD (direct DB
   * writes), NOT a governed pipeline action. Creating a workspace or inviting a
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
  onboarding: t.router({
    getProfile: procedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return { profile: await ctx.wiring.onboardingProfileStore.get(input.workspaceId) };
      }),

    saveProfile: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          animal: z.string().min(1),
          answers: z.record(z.union([z.string(), z.array(z.string())])).default({}),
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
        assertPilotWorkspace(input.workspaceId);
        const existing = await ctx.wiring.onboardingProfileStore.get(input.workspaceId);
        const row = {
          workspaceId: input.workspaceId,
          animal: input.animal,
          answers: input.answers,
          phoneVerified: input.verificationMethod === "phone" ? true : (existing?.phoneVerified ?? false),
          verificationMethod: input.verificationMethod ?? existing?.verificationMethod ?? null,
          connectedSourceIds: input.connectedSourceIds,
          updatedAtISO: new Date().toISOString(),
        };
        await ctx.wiring.onboardingProfileStore.save(row);
        const existingMemories = await ctx.wiring.memoryStore.retrieve(
          { limit: 100 },
          { workspaceId: input.workspaceId, userId: ctx.wiring.pilotUserId },
        );
        if (!existingMemories.some((memory) => parseLearningMemory(memory.content)?.kind === "reflection_schedule")) {
          await ctx.wiring.memoryStore.write({
            id: uuidv7(),
            workspaceId: input.workspaceId,
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
     * requires authentication + workspace membership (was a bare
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
        .input(z.object({ workspaceId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          const rows = await ctx.wiring.memoryStore.retrieve(
            { limit: 100 },
            { workspaceId: input.workspaceId, userId: ctx.identity.id },
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
          workspaceId: z.string().min(1),
          appName: z.string().trim().min(1).max(200),
          bundleId: z.string().trim().min(1).max(300).optional(),
          capturedAt: z.string().datetime(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const memory = await ctx.wiring.memoryStore.write({
          id: uuidv7(),
          workspaceId: input.workspaceId,
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
            workspaceId: z.string().min(1),
            figure: z.string().trim().min(2).max(120),
            admiredFor: z.string().trim().min(2).max(500),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          const source = await researchPublicFigure(input.figure);
          const recommendation = {
            kind: "learning_recommendation" as const,
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
          const proposal = await ctx.wiring.pipeline.propose(
            {
              workspaceId: input.workspaceId,
              actor: { type: "agent", id: LEARNING_AGENT },
              onBehalfOf: { type: "user", id: ctx.identity.id },
              action: "write",
              resourceType: "signal",
              inputs: recommendation,
              skill: "stageLearningRecommendation",
              trustOrigin: "untrusted_external",
              goalTaskRef: await provisionRoleModelRecommendationTask(ctx.wiring, input.workspaceId),
            },
            ctx.run,
          );
          const existing = await ctx.wiring.memoryStore.retrieve(
            { limit: 100 },
            { workspaceId: input.workspaceId, userId: ctx.wiring.pilotUserId },
          );
          if (!existing.some((row) => parseLearningMemory(row.content)?.kind === "onboarding_preference")) {
            await ctx.wiring.memoryStore.write({
              id: uuidv7(),
              workspaceId: input.workspaceId,
              type: "preference",
              scope: "private",
              content: JSON.stringify({ kind: "onboarding_preference", figure: input.figure, admiredFor: input.admiredFor }),
              confidence: 1,
              trustOrigin: "user_content",
              plane: "local",
              createdBy: ctx.identity.id,
              ownerUserId: ctx.wiring.pilotUserId,
            });
          }
          return { recommendation, proposal };
        }),

    correctMemory: procedure
        .input(z.object({ workspaceId: z.string().min(1), memoryId: z.string().uuid(), content: z.string().trim().min(1).max(500) }))
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          const auth = { workspaceId: input.workspaceId, userId: ctx.wiring.pilotUserId };
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
        .input(z.object({ workspaceId: z.string().min(1), memoryId: z.string().uuid() }))
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          const auth = { workspaceId: input.workspaceId, userId: ctx.identity.id };
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
            workspaceId: z.string().min(1),
            memoryId: z.string().uuid(),
            action: z.enum(["snooze", "pause", "resume", "skip"]),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          const auth = { workspaceId: input.workspaceId, userId: ctx.wiring.pilotUserId };
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
      .mutation(async ({ input }) => {
        const verified = /^\d{6}$/.test(input.code.trim());
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
          workspaceId: z.string().min(1),
          operationId: z.string().uuid(),
          anchor: redFlagAnchorInput,
          renderedValue: z.string().max(2000),
          renderedVersion: z.string().max(200).optional(),
          reason: z.string().trim().max(500).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const authScope = { workspaceId: input.workspaceId, userId: ownerId };
        await validateAnchorTarget(ctx.wiring, input.workspaceId, ownerId, input.anchor);
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
            workspaceId: input.workspaceId,
            ownerUserId: ownerId,
            lineageKey: anchorKey,
            expectedCurrentId: null,
            next: {
              id: memoryId,
              workspaceId: input.workspaceId,
              type: "semantic",
              subjectElementId: anchorKey,
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
        const currentRow = (await ctx.wiring.memoryStore.currentForLineage(input.workspaceId, ownerId, anchorKey)) ?? flagged;
        return { memory: await attemptGovernedLearningStep(ctx.wiring, ctx.run, input.workspaceId, ownerId, currentRow, flagged.id, `${ownerId}:${input.operationId}`) };
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
      .input(z.object({ workspaceId: z.string().min(1), flagId: z.string().uuid(), operationId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { workspaceId: input.workspaceId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (value.learningStatus !== "failed") {
          throw new TRPCError({ code: "CONFLICT", message: `Only a failed learning step can be retried (current status: "${value.learningStatus}")` });
        }
        return { memory: await attemptGovernedLearningStep(ctx.wiring, ctx.run, input.workspaceId, ownerId, current, current.id, `${ownerId}:retry:${input.flagId}:${input.operationId}`) };
      }),

    /** Reversible: appends a new row tagged "cleared" — the flagged Memory's
     * full history (including the original anchor/value/reason) stays intact,
     * never deleted (glossary: "It never silently changes source data").
     * CAS-protected (review item 4): a stale `flagId` (already superseded by
     * some other action) is rejected with CONFLICT rather than silently
     * forking the lineage. */
    clear: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), flagId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { workspaceId: input.workspaceId, userId: ownerId };
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
          await revokePreferenceAdjustmentPermanently(ctx.wiring, input.workspaceId, ownerId, value.preferenceAdjustmentId);
        }

        const updated = await ctx.wiring.memoryStore.casSupersede({
          workspaceId: input.workspaceId,
          ownerUserId: ownerId,
          lineageKey: current.subjectElementId!,
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
      .input(z.object({ workspaceId: z.string().min(1), flagId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { workspaceId: input.workspaceId, userId: ownerId };
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
          workspaceId: input.workspaceId,
          ownerUserId: ownerId,
          lineageKey: current.subjectElementId!,
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
          memory: await attemptGovernedLearningStep(ctx.wiring, ctx.run, input.workspaceId, ownerId, updated, updated.id, `${ownerId}:reopen:${reopenedId}`),
        };
      }),

    /** The "edit" half of inspect/edit/clear (§5d). CAS-protected like
     * clear/reopen above. */
    updateReason: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), flagId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { workspaceId: input.workspaceId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (value.reason === input.reason) return { memory: current }; // no-op: nothing changed, don't fork the lineage for free
        const updated = await ctx.wiring.memoryStore.casSupersede({
          workspaceId: input.workspaceId,
          ownerUserId: ownerId,
          lineageKey: current.subjectElementId!,
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
      .input(z.object({ workspaceId: z.string().min(1), flagId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { workspaceId: input.workspaceId, userId: ownerId };
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
        const adjustment = await ctx.wiring.memoryStore.currentForLineage(input.workspaceId, ownerId, value.preferenceAdjustmentId);
        const adjustmentValue = adjustment && parseLearningMemory(adjustment.content);
        if (!adjustment || !isPreferenceAdjustmentContent(adjustmentValue) || adjustment.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "the linked preference adjustment could not be found" });
        }
        if (adjustmentValue.status === "revoked") {
          throw new TRPCError({ code: "CONFLICT", message: "This correction was permanently revoked — reopen the flag to submit a new one" });
        }
        if (adjustmentValue.status !== "applied") {
          const appliedAdjustment = await ctx.wiring.memoryStore.casSupersede({
            workspaceId: input.workspaceId,
            ownerUserId: ownerId,
            lineageKey: adjustment.subjectElementId!,
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
          workspaceId: input.workspaceId,
          ownerUserId: ownerId,
          lineageKey: current.subjectElementId!,
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
      .input(z.object({ workspaceId: z.string().min(1), flagId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { workspaceId: input.workspaceId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        if (value.learningStatus !== "applied") {
          throw new TRPCError({ code: "CONFLICT", message: "This flag has no applied correction to revoke" });
        }
        if (value.preferenceAdjustmentId) {
          await revokePreferenceAdjustmentPermanently(ctx.wiring, input.workspaceId, ownerId, value.preferenceAdjustmentId);
        }
        const updatedFlag = await ctx.wiring.memoryStore.casSupersede({
          workspaceId: input.workspaceId,
          ownerUserId: ownerId,
          lineageKey: current.subjectElementId!,
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
      .input(z.object({ workspaceId: z.string().min(1), flagId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { workspaceId: input.workspaceId, userId: ownerId };
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
            { subjectElementId: current.subjectElementId!, includeSuperseded: true, order: "asc", limit: 200, ...(cursor ? { cursor } : {}) },
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
          await revokePreferenceAdjustmentPermanently(ctx.wiring, input.workspaceId, ownerId, preferenceAdjustmentId);
        }
        const forgotten = await ctx.wiring.memoryStore.forget(input.flagId, auth);
        return { forgotten };
      }),

    /** Current (non-superseded) flag for ONE exact anchor — an indexed
     * `subjectElementId` equality lookup (review items 5+6+7: the
     * deterministic anchor lineage key makes this O(1)-ish instead of a
     * full-table content scan). Powers a single cell/bullet's own
     * hover/focus state when a batched `listForScope` fetch isn't already
     * available. */
    listForAnchor: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), anchor: redFlagAnchorInput }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const rows = await ctx.wiring.memoryStore.retrieve(
          { subjectElementId: anchorLineageKey(input.anchor), sourceRefType: "feedback", contentPathEquals: [{ path: "kind", equals: "red_flag" }], limit: 1 },
          { workspaceId: input.workspaceId, userId: ctx.identity.id },
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
          workspaceId: z.string().min(1),
          moduleId: z.string().min(1),
          databaseId: z.string().min(1).optional(),
          recordId: z.string().min(1).optional(),
          fileId: z.string().min(1).optional(),
          resultId: z.string().min(1).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const rows = await ctx.wiring.memoryStore.retrieve(
          {
            sourceRefType: "feedback",
            contentPathEquals: [
              { path: "kind", equals: "red_flag" },
              { path: "anchor.moduleId", equals: input.moduleId },
            ],
          },
          { workspaceId: input.workspaceId, userId: ctx.identity.id },
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
          workspaceId: z.string().min(1),
          status: z.enum(["open", "cleared"]).optional(),
          limit: z.number().int().min(1).max(100).default(50),
          cursor: z.string().optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
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
          { workspaceId: input.workspaceId, userId: ctx.identity.id },
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
          workspaceId: z.string().min(1),
          flagId: z.string().uuid(),
          limit: z.number().int().min(1).max(200).default(100),
          cursor: z.string().optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const ownerId = ctx.identity.id;
        const auth = { workspaceId: input.workspaceId, userId: ownerId };
        const current = await ctx.wiring.memoryStore.get(input.flagId, auth);
        const value = current && parseLearningMemory(current.content);
        if (!current || !isRedFlagContent(value) || current.ownerUserId !== ownerId) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const cursor = decodeRedFlagCursor(input.cursor);
        const rows = await ctx.wiring.memoryStore.retrieve(
          {
            subjectElementId: current.subjectElementId!,
            includeSuperseded: true,
            order: "asc",
            // review round-7: this query is scoped to ONE lineage
            // (`subjectElementId` above), so `lineageRevision` ordering is
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

  workspace: t.router({
    create: procedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.workspaceStore.createWorkspace(input.name, ctx.identity.id);
      }),

    list: procedure.query(async ({ ctx }) => {
      return ctx.wiring.workspaceStore.listWorkspaces(ctx.identity.id);
    }),

    inviteMember: procedure
      .input(z.object({ workspaceId: z.string().min(1), email: z.string().email() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.workspaceStore.inviteMember(input.workspaceId, input.email);
      }),

    listMembers: procedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.workspaceStore.listMembers(input.workspaceId);
      }),

    /**
     * P1 Workspace Generator (docs/wiki/vision.md "View grammar" + roadmap.md
     * P1): the blueprint -> view grammar compiler's governed surface. `get`
     * returns the current active workspace_definition (or null — no demo/dummy
     * fallback: an un-onboarded workspace honestly has none yet). `propose`
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
        assertPilotWorkspace(input.workspaceId);
        const active = await ctx.wiring.workspaceDefinitionStore.getActive(input.workspaceId);
        return { definition: active };
      }),

      /**
       * getById (ADR-023/ADR-024): returns a workspace_definition by id
       * REGARDLESS of status (draft/active/archived) — `get` above only ever
       * returns the currently-active row, so a draft that hasn't been
       * activated yet (the common ApprovalsPage diff-preview case) was
       * previously unreachable. Identity-scoped like every sibling endpoint:
       * the row's own `workspaceId` must match the caller-supplied
       * `workspaceId`, so a definitionId from another workspace 404s rather
       * than leaking cross-workspace data.
       */
      getById: procedure.input(blueprintGetByIdInput).query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const definition = await ctx.wiring.workspaceDefinitionStore.get(input.definitionId);
        if (!definition || definition.workspaceId !== input.workspaceId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown workspace_definition" });
        }
        return { definition };
      }),

      /** Always creates a DRAFT workspace_definition — never activates it. The
       * blueprint is validated against the grammar (compileBlueprint) BEFORE
       * being persisted, so an invalid draft is rejected here rather than
       * silently stored and only failing later at activation/render time. */
      propose: procedure.input(blueprintProposeInput).mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const blueprint = toWorkspaceBlueprint(input.blueprint);
        try {
          compileBlueprint(blueprint, BLUEPRINT_NODE_TYPE_REGISTRY, BLUEPRINT_RELATIONSHIP_NODE_TYPES);
        } catch (err) {
          if (err instanceof BlueprintCompileError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
          throw err;
        }

        const priorDrafts = await ctx.wiring.workspaceDefinitionStore.listDrafts(input.workspaceId);
        const active = await ctx.wiring.workspaceDefinitionStore.getActive(input.workspaceId);
        const nextVersion = 1 + Math.max(active?.version ?? 0, ...priorDrafts.map((d) => d.version), 0);

        const id = ctx.run.ids.next();
        const created = await ctx.wiring.workspaceDefinitionStore.create({
          id,
          workspaceId: input.workspaceId,
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
       * place two rows are ever active for the same workspace at once is
       * disallowed.
       */
      activate: procedure.input(blueprintActivateInput).mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const draft = await ctx.wiring.workspaceDefinitionStore.get(input.definitionId);
        if (!draft || draft.workspaceId !== input.workspaceId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown workspace_definition draft" });
        }
        if (draft.status !== "draft") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `workspace_definition ${draft.id} is "${draft.status}", not "draft"` });
        }

        const proposal = await ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "approve",
            resourceType: "skill", // workspace_definitions has no dedicated ResourceType yet — same interim token capability.approve uses
            resourceId: input.definitionId,
            inputs: { definitionId: input.definitionId, fromStatus: draft.status },
            skill: "stageMutation",
          },
          ctx.run,
        );
        if (proposal.status === "pending_review") {
          return { activated: false, proposal, definition: draft };
        }

        const priorActive = await ctx.wiring.workspaceDefinitionStore.getActive(input.workspaceId);
        if (priorActive) {
          await ctx.wiring.workspaceDefinitionStore.setStatus(priorActive.id, "archived");
        }
        const activated = await ctx.wiring.workspaceDefinitionStore.setStatus(draft.id, "active");
        return { activated: true, proposal, definition: activated };
      }),
    }),
  }),

  /**
   * Compatibility read surface for legacy Initiative/Touchpoint and canonical
   * Signal routes. Person, Community, and Timeline contracts live only under the
   * manifest-driven `relationship` Module router above.
   */
  graph: t.router({
    listInitiatives: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.graphStore.listInitiatives(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getInitiative: procedure.input(z.object({ id: z.string().uuid() })).query(async ({ input, ctx }) => {
      return ctx.wiring.graphStore.getInitiative(input.id);
    }),

    listTouchpoints: procedure
      .input(paginatedInput.extend({ initiativeId: z.string().uuid().optional() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.graphStore.listTouchpoints(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
          ...(input.initiativeId ? { initiativeId: input.initiativeId } : {}),
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    listSignals: authenticatedProcedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, total } = await ctx.wiring.graphStore.listSignals(
          input.workspaceId,
          ctx.identity.id,
          { limit: input.limit, offset: input.offset },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getSignalDetail: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), signalId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getSignalDetail(input.workspaceId, ctx.identity.id, input.signalId);
      }),

    proposeSignalAction: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), signalId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const detail = await ctx.wiring.graphStore.getSignalDetail(input.workspaceId, ctx.identity.id, input.signalId);
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
            workspaceId: input.workspaceId,
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
            workspaceId: input.workspaceId,
            signalId: input.signalId,
            userId: ctx.identity.id,
            verb: "act",
          });
        }
        return proposal;
      }),

    /** Records the user's reaction to a Signal (act|dismiss|save) — bookkeeping,
     * not a governed mutation; see graph-store.ts's header comment for why this
     * is a direct write rather than routed through action.propose. */
    recordSignalAction: authenticatedProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          signalId: z.string().uuid(),
          verb: z.enum(["act", "dismiss", "save"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const detail = await ctx.wiring.graphStore.getSignalDetail(input.workspaceId, ctx.identity.id, input.signalId);
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found or not accessible" });
        }
        await ctx.wiring.graphStore.recordSignalAction({
          workspaceId: input.workspaceId,
          signalId: input.signalId,
          userId: ctx.identity.id,
          verb: input.verb,
        });
        return { ok: true };
      }),
  }),

  /**
   * JobPilot — wires the pure `@bridge/jobpilot` package (scoring, state-machine,
   * table spec) to real persistence for the first time (frontend-migration-
   * scoping.md Phase 4). Job/application CRUD is workspace-authenticated, not
   * routed through the governed pipeline — tracking a job posting has no
   * external effect requiring approval, same tier as workspace membership.
   * `transition` validates against @bridge/jobpilot's own state machine BEFORE
   * persisting, so an invalid stage jump is rejected here, not silently written.
   */
  jobpilot: t.router({
    create: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
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
        assertPilotWorkspace(input.workspaceId);
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
          workspaceId: input.workspaceId,
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
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.jobpilotStore.listJobs(input.workspaceId, {
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
          workspaceId: z.string().min(1),
          applicationId: z.string().uuid(),
          from: z.string(),
          to: z.string(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const application = await ctx.wiring.jobpilotStore.getApplication(input.applicationId, input.workspaceId);
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
  }),

  /**
   * Helpdesk — the one workspace tool with a genuine public/unauthenticated
   * surface (frontend-migration-scoping.md gap #3). The `public` sub-router's
   * three procedures NEVER read `ctx.identity`; a submitter's only credential
   * is possession of the opaque `accessToken` returned by `createTicket` (the
   * same trust model as a password-reset link) — see helpdesk-store.ts's
   * header comment and docs/raw/decisions-log.md for why this avoided adding a
   * new Actor type / identity-resolution change. The top-level procedures below
   * are the authenticated support-agent inbox (workspace members only).
   */
  helpdesk: t.router({
    public: t.router({
      createTicket: publicProcedure
        .input(
          z.object({
            workspaceId: z.string().min(1),
            subject: z.string().trim().min(1).max(200),
            submitterEmail: z.string().trim().email().max(320),
            submitterName: z.string().trim().max(120).optional(),
            body: z.string().trim().min(1).max(10_000),
            operationId: z.string().uuid(),
            accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          const { ticket, message } = await ctx.wiring.helpdeskStore.createTicket({
            workspaceId: input.workspaceId,
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

    /** Support-agent inbox — workspace-authenticated. */
    list: authenticatedProcedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, total } = await ctx.wiring.helpdeskStore.listTickets(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    get: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), ticketId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const result = await ctx.wiring.helpdeskStore.getTicket(input.workspaceId, input.ticketId);
        if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
        return result;
      }),

    reply: authenticatedProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          ticketId: z.string().uuid(),
          body: z.string().trim().min(1).max(10_000),
          status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const message = await ctx.wiring.helpdeskStore.replyAsAgent(
          input.workspaceId,
          input.ticketId,
          ctx.identity.id,
          input.body,
          input.status,
        );
        if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
        return message;
      }),

    /**
     * Help Request routing (P2 Helpdesk package, ADR-021 — the
     * `helpdesk.capability-routing` capability in tools/helpdesk/package.yaml).
     * Routes a help request over the accessible Relationship graph: candidates
     * are Person Records, not workspace-user identities. Topic tags may be
     * supplied by the caller (the
     * graph carries no per-person topic tags yet — with none supplied the
     * result is an HONEST empty route list, never a fabricated match).
     */
    route: authenticatedProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          subject: z.string().min(1),
          body: z.string().default(""),
          /** Optional per-person topic tags ({personId -> topics[]}) until the
           * graph carries real topic/skill data (see docs/BUGS.md). */
          topicsByPerson: z
            .record(z.array(z.string().min(1)).max(50))
            .refine(
              (value) => Object.keys(value).every((id) => z.string().uuid().safeParse(id).success),
              "candidate Person ids must be UUIDs",
            )
            .refine((value) => Object.keys(value).length <= 500, "at most 500 candidate People may be routed")
            .optional(),
          limit: z.number().int().min(1).max(10).default(3),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const candidates = (
          await Promise.all(
            Object.entries(input.topicsByPerson ?? {}).map(async ([personId, topics]) => {
              const person = await ctx.wiring.graphStore.getPerson(
                input.workspaceId,
                ctx.identity.id,
                personId,
              );
              return person
                ? {
                    personId: person.id,
                    displayName: person.displayName ?? "Unnamed person",
                    topics,
                  } satisfies HelpResponderCandidate
                : null;
            }),
          )
        ).filter((candidate): candidate is HelpResponderCandidate => candidate !== null);
        const routes = routeHelpRequest({ subject: input.subject, body: input.body }, candidates, input.limit);
        return { routes };
      }),

    /**
     * Help Offer staging (the `helpdesk.offer-drafting` capability) — the
     * answer is STAGED as a governed proposal through the SAME pipeline
     * propose/decide path every other draft-then-approve surface uses; this
     * procedure never sends or commits the answer itself. resourceType
     * "signal": a Help Offer is a Signal-shaped recommendation (every Signal
     * -> an action), decided by a human on the approvals surface.
     */
    stageAnswer: authenticatedProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          subject: z.string().min(1),
          body: z.string().default(""),
          routedToPersonId: z.string().uuid(),
          candidateTopics: z.array(z.string().min(1)).max(50),
          draftBody: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const routedPerson = await ctx.wiring.graphStore.getPerson(
          input.workspaceId,
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
        // AGS1 (TASK-007 closure) — a real governed Skill: LEARNING_AGENT drafts
        // the Help Offer, never the Human directly (helpdesk.stageAnswer's own
        // manifest requires it — see wiring.ts's HELPDESK_ANSWER_SKILL_MANIFEST).
        const goalTaskRef = await provisionHelpdeskAnswerTask(ctx.wiring, input.workspaceId);
        const proposal = await ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: "agent", id: LEARNING_AGENT },
            onBehalfOf: { type: "user", id: ctx.identity.id },
            action: "write",
            resourceType: "signal",
            resourceId: input.routedToPersonId,
            inputs: { ...offer },
            skill: "helpdesk.stageAnswer",
            goalTaskRef,
          },
          ctx.run,
        );
        return { proposal, offer };
      }),
  }),

  /**
   * Resources — replaces the prototype's Supabase-direct `resources_canonical`
   * read (frontend-migration-scoping.md gap #4) with a governed, workspace-
   * scoped catalog. Plain authenticated CRUD, not a pipeline action.
   */
  resources: t.router({
    create: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          title: z.string().min(1),
          kind: z.enum(["book", "podcast", "vlog", "article", "other"]),
          url: z.string().url().optional(),
          notes: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.resourcesStore.create({
          workspaceId: input.workspaceId,
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
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.resourcesStore.list(input.workspaceId, {
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
      assertPilotWorkspace(input.workspaceId);
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
        workspaceId: input.workspaceId,
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
        workspaceId: input.workspaceId,
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
          workspaceId: state.workspaceId,
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
          workspaceId: state.workspaceId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "approve",
          resourceType: "skill", // capability rows are not yet their own ResourceType; skill is the closest governed registry token
          resourceId: input.manifestId,
          inputs: { manifestId: input.manifestId, fromState: state.state },
          skill: "stageMutation",
        },
        ctx.run,
      );
      if (proposal.status === "pending_review") {
        return { proposal, state };
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
            const gates = resolveGates(await ctx.wiring.policyParams.get(state.workspaceId));
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
        workspaceId: state.workspaceId,
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
     * + the daily auto-activation budgets + the workspace kill switch before
     * treating an activation as auto-approved. A non-"auto" outcome does NOT
     * activate here — it reports the required approval band back to the
     * caller, which routes to `approve` (governance/explicit_human) or a
     * user-pref confirmation UI, matching "Generation != activation."
     */
    activate: procedure.input(capabilityActivateInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      const manifestRow = await ctx.wiring.capabilityStore.getManifest(input.manifestId);
      if (!manifestRow) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest state" });

      const decision = await resolveActivationApproval({
        workspaceId: input.workspaceId,
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
        await ctx.wiring.capabilityBudgets.recordAutoActivation(input.workspaceId, manifestRow.computedRisk, input.todayKey);
      }
      const nextState = await ctx.wiring.capabilityStore.upsertState({
        manifestId: input.manifestId,
        workspaceId: input.workspaceId,
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
        workspaceId: state.workspaceId,
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
        workspaceId: state.workspaceId,
        state: result.nextState,
        suspended: state.suspended,
        ...(state.suspendReason ? { suspendReason: state.suspendReason } : {}),
        evidence: state.evidence,
      });
    }),

    list: procedure.input(paginatedInput).query(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      const { items, total } = await ctx.wiring.capabilityStore.listManifests(input.workspaceId, {
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
        workspaceId: state.workspaceId,
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
     * view over the workspace's REAL capability manifests + states. Pending
     * proposals are the capabilities awaiting a governed approve/activate
     * decision (state validated|approved), risk = computedRisk. `violationSeries`
     * is an honest empty until a violation-history view lands (no fabricated
     * data — see CLAUDE.md's no-dummy-data rule). Renders for a workspace.
     */
    orgHealth: procedure.input(paginatedInput).query(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      const nowMs = Date.parse(ctx.run.clock.nowISO());
      const { items } = await ctx.wiring.capabilityStore.listManifests(input.workspaceId, {
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
   * P2 Capability packages (docs/raw/capability-package-format.md, ADR-018) —
   * the shipping unit ABOVE one capability_manifests row. Mirrors the
   * `capability` router's shape one level up: `register` always creates a
   * `private`-state installation row (generation != activation, same
   * invariant); `install` is the governed step — computes risk over the FULL
   * bundled+dependency closure (computePackageRisk), applies the lethal-
   * trifecta union check, then routes through the SAME pipeline
   * propose/decide semantics `capability.approve`/`workspace.blueprint.activate`
   * use (external band = same non-removable hard floor). `promote`/`rollback`
   * enforce single-live-version-per-workspace (packages/core/src/package/
   * lifecycle.ts) — promoting auto-demotes the prior available version;
   * rollback forks a NEW draft from history, never an in-place revert.
   */
  packages: t.router({
    /** Real local-plane File inventory for one installed Module. */
    files: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), moduleName: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const installation = await ctx.wiring.packageStore.getAvailable(input.workspaceId, input.moduleName);
        if (!installation || installation.status !== "installed") {
          throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.moduleName}" not found` });
        }
        const workspaces = await ctx.wiring.workspaceStore.listWorkspaces(ctx.identity.id);
        const organization = workspaces.find((workspace) => workspace.id === input.workspaceId);
        if (!organization) {
          throw new TRPCError({ code: "FORBIDDEN", message: "workspace membership required" });
        }
        try {
          return await listModuleFiles(
            organization.name,
            installation.manifest.module?.displayName ?? installation.packageName,
          );
        } catch (error) {
          if (error instanceof ModuleFilesPathError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          throw error;
        }
      }),

    /** Register a package manifest. Always creates state=private, status=
     * pending_review — no risk computed yet (that happens at `install`). */
    register: procedure.input(packageRegisterInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      let manifest: PackageManifest;
      try {
        manifest = parsePackageManifest(input.manifest);
      } catch (err) {
        if (err instanceof PackageManifestValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
      const created = await ctx.wiring.packageStore.create({
        workspaceId: input.workspaceId,
        packageName: manifest.name,
        packageVersion: manifest.version,
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
     * like `capability.approve` (docs/raw/capability-package-format.md §2).
     * Computes risk over the package's own capabilities AND every resolvable
     * package dependency's capabilities, applies the lethal-trifecta union
     * check (private-read + untrusted-ingest + egress ACROSS different bundled
     * capabilities still escalates to `external`), then defers to
     * requiredApproval/resolveActivationApproval via the same pipeline round
     * trip `capability.approve` uses — an agent can never resolve this, and
     * every attempt is audited whether auto-resolved or parked pending_review.
     */
    install: procedure.input(packageInstallInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      const installation = await ctx.wiring.packageStore.get(input.installationId);
      if (!installation || installation.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
      }
      if (installation.state !== "private") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `package installation must be private before install, got ${installation.state}`,
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
      // capability.register path too) via the workspace's registered capability
      // manifests, and package dependencies via other installations of this
      // workspace's package store (name+version exact match, per the no-ranges rule).
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
      const { items: allInstallations } = await ctx.wiring.packageStore.list(input.workspaceId, { limit: 10000, offset: 0 });
      const verifiedCommonsDependencies = new Map<string, PackageManifest>();
      const verifiedDependencyInstallations = new Map<string, PackageInstallationRow>();
      if (installation.moduleAttachment) {
        const rootEntry = currentCommonsEntry!;
        const pins = new Map<string, string>(
          rootEntry.securityScan.dependencyPins
            ?.map((pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const) ?? [],
        );
        const visited = new Set<string>();
        const verifyDependencyClosure = async (manifest: PackageManifest): Promise<void> => {
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
                candidate.packageName === dependency.manifestId &&
                candidate.packageVersion === dependency.version &&
                candidate.moduleAttachment?.source === "commons" &&
                candidate.moduleAttachment.modulePackageName === installation.moduleAttachment?.modulePackageName &&
                candidate.moduleAttachment.agentId === installation.moduleAttachment?.agentId &&
                candidate.moduleAttachment.needId === installation.moduleAttachment?.needId &&
                candidate.moduleAttachment.contentHash === expectedHash,
            );
            if (!local) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" was not staged from its pinned artifact`,
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
      const resolvePackageDependency = (name: string, version: string) =>
        installation.moduleAttachment
          ? verifiedCommonsDependencies.get(`${name}@${version}`)
          : allInstallations.find((i) => i.packageName === name && i.packageVersion === version)?.manifest;

      const computedRisk = computePackageRisk(
        installation.manifest,
        resolveCapabilityDependency,
        resolvePackageDependency,
      );
      const signedRiskFloor = installation.moduleAttachment
        ? installation.computedRisk
        : "informational";
      const risk = {
        ...computedRisk,
        compositeRisk: maxRisk(computedRisk.compositeRisk, signedRiskFloor),
        effectiveRisk: maxRisk(computedRisk.effectiveRisk, signedRiskFloor),
      };

      // Package-wide audience: the strictest (most-restrictive-raising) audience
      // across its own bundled capabilities — mirrors raiseForAudience's
      // "audience only ever raises, never lowers" contract at the package level.
      const audiences = installCapabilities.map((c) => c.audience);
      const audience = audiences.includes("external_visible")
        ? "external_visible"
        : audiences.includes("team")
          ? "team"
          : "private";

      // PKG-2 community-origin floor input: a package is treated at its
      // LEAST-trusted capability origin — if any bundled capability is
      // community/user_code (untrusted), the whole install is floored there.
      const resolvedTrustGrants: TrustGrantView[] = []; // store-layer follow-up (same gap capability.activate has)
      const floorOrigin: CapabilityOrigin = installCapabilities.some((c) => isUntrustedOrigin(c.origin))
        ? "community"
        : "built_in";

      const decision = await resolveActivationApproval({
        workspaceId: input.workspaceId,
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

      // Every capability in the package is registered via the EXISTING
      // capability.register path's semantics (draft state, never active) —
      // registration != activation, same invariant capability.register itself
      // enforces. This happens regardless of the approval outcome, mirroring
      // "install_flow.1_propose" in the format doc (registration precedes the
      // approval decision).
      //
      // Idempotency (ADR-024): re-installing a package version whose bundled
      // capability keeps the SAME (name, version) must not collide with
      // `capability_manifests_uq`. Check-before-insert via
      // `getManifestByNameVersion` (the natural key the unique constraint
      // enforces) and reuse the existing manifest row instead of re-creating
      // it — a second install of the identical capability is a no-op
      // re-registration, not a new manifest.
      const registeredManifestIds: string[] = [];
      for (const cap of installCapabilities) {
        const existingManifest = await ctx.wiring.capabilityStore.getManifestByNameVersion(
          input.workspaceId,
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
            workspaceId: input.workspaceId,
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
            workspaceId: input.workspaceId,
            state: "draft",
            suspended: false,
            evidence: {},
          });
        }
        registeredManifestIds.push(capId);
      }

      const rerisked = await ctx.wiring.packageStore.setComputedRisk(installation.id, risk.effectiveRisk);

      if (decision.requirement !== "auto") {
        const proposalId = stablePackageInstallProposalId(input.workspaceId, installation.id);
        const priorDecision = await ctx.wiring.ledger.decisionFor(proposalId);
        if (priorDecision) {
          if (priorDecision.userDecision === "approve" || priorDecision.userDecision === "edit") {
            const finalized = await activateApprovedPackageInstallation(
              ctx.wiring,
              input.workspaceId,
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
            message: "package install proposal was vetoed; stage a new signed package version to retry",
          });
        }
        let proposal: Proposal | null = await findPendingProposalById(
          ctx.wiring,
          input.workspaceId,
          proposalId,
        );
        if (!proposal) {
          try {
            proposal = await ctx.wiring.pipeline.propose(
              {
                workspaceId: input.workspaceId,
                actor: { type: ctx.identity.type, id: ctx.identity.id },
                action: "write",
                resourceType: "signal", // governed install intent; package_installation is not yet a kernel ResourceType
                resourceId: installation.id,
                inputs: {
                  operation: "package_install",
                  installationId: installation.id,
                  packageName: installation.packageName,
                  effectiveRisk: risk.effectiveRisk,
                },
                skill: "stageMutation",
              },
              ctx.run,
              { proposalId, requireHumanReview: true },
            );
          } catch (cause) {
            proposal = await findPendingProposalById(ctx.wiring, input.workspaceId, proposalId);
            if (!proposal) throw cause;
          }
        }
        if (proposal.status !== "pending_review") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: proposal.rejectionReason ?? "package install proposal did not reach Human review",
          });
        }
        return { installed: false, decision, risk, proposal, installation: rerisked, registeredManifestIds };
      }

      if (decision.budgeted && (risk.effectiveRisk === "informational" || risk.effectiveRisk === "advisory")) {
        await ctx.wiring.capabilityBudgets.recordAutoActivation(input.workspaceId, risk.effectiveRisk, input.todayKey);
      }

      await assertCurrentCommonsAttachment(ctx.wiring, installation);
      const installed = await ctx.wiring.packageStore.setStatus(installation.id, "installed");
      const installedWithRisk: PackageInstallationRow = { ...installed, computedRisk: risk.effectiveRisk };
      for (const dependency of verifiedDependencyInstallations.values()) {
        await ctx.wiring.packageStore.setComputedRisk(
          dependency.id,
          maxRisk(dependency.computedRisk, risk.effectiveRisk),
        );
        await ctx.wiring.packageStore.setStatus(dependency.id, "installed");
        let promotable = dependency;
        if (promotable.state === "private") {
          promotable = await ctx.wiring.packageStore.setState(promotable.id, "promoted");
        }
        if (promotable.state === "promoted") {
          const currentAvailable = await ctx.wiring.packageStore.getAvailable(
            input.workspaceId,
            promotable.packageName,
            promotable.moduleAttachment,
          );
          const promotion = promoteToAvailable(promotable, currentAvailable);
          await ctx.wiring.packageStore.setState(
            promotion.promoted.installationId,
            promotion.promoted.nextState,
          );
          if (promotion.demoted) {
            await ctx.wiring.packageStore.setState(
              promotion.demoted.installationId,
              promotion.demoted.nextState,
            );
          }
        }
      }
      const advanced = await ctx.wiring.packageStore.setState(installation.id, advancePackageState(installation.state));
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
        assertPilotWorkspace(proposal.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, proposal.workspaceId, ctx.identity.id);
        const installationId = packageInstallIdFromProposal(proposal);
        if (!installationId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "proposal is not a package install approval" });
        }
        const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
        if (decision?.userDecision !== "approve" && decision?.userDecision !== "edit") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "package install proposal is not approved" });
        }
        const installation = await activateApprovedPackageInstallation(
          ctx.wiring,
          proposal.workspaceId,
          installationId,
        );
        return { installation, proposalId: input.proposalId };
      }),

    list: authenticatedProcedure.input(paginatedInput).query(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      const { items, total } = await ctx.wiring.packageStore.list(input.workspaceId, {
        limit: input.limit,
        offset: input.offset,
      });
      const itemsWithRuntimeBindings = await Promise.all(
        items.map(async (installation) => {
          const runtimeAutomationIds: string[] = [];
          for (const automation of installation.manifest.module?.automations ?? []) {
            if (!automation.ritualId) continue;
            const ritualId = resolveModuleRitualRuntimeId(installation.packageName, automation.ritualId);
            const agentId = resolveModuleAgentRuntimeId(installation.packageName, automation.agentId);
            const definition = ritualId
              ? await ctx.wiring.ritualRegistry.load(input.workspaceId, ritualId)
              : null;
            if (ritualId && agentId && definition?.agentId === agentId) {
              runtimeAutomationIds.push(automation.id);
            }
          }
          return { ...installation, runtimeAutomationIds };
        }),
      );
      return {
        items: itemsWithRuntimeBindings,
        total,
        hasMore: input.offset + itemsWithRuntimeBindings.length < total,
      };
    }),

    get: authenticatedProcedure.input(packageIdInput).query(async ({ input, ctx }) => {
      const installation = await ctx.wiring.packageStore.get(input.installationId);
      if (!installation) throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
      await assertMembership(ctx.wiring.workspaceStore, installation.workspaceId, ctx.identity.id);
      return { installation };
    }),

    /**
     * Promote a `promoted`-state installation to `available`, auto-demoting
     * whatever installation is currently `available` for the same package
     * name in this workspace — never two live versions side by side
     * (packages/core/src/package/lifecycle.ts's promoteToAvailable).
     */
    promote: procedure.input(packagePromoteInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      const target = await ctx.wiring.packageStore.get(input.installationId);
      if (!target || target.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
      }
      const currentCommonsEntry = await assertCurrentCommonsAttachment(ctx.wiring, target);
      await verifiedCommonsDependencyInstallations(ctx.wiring, target, currentCommonsEntry);
      const currentlyAvailable = await ctx.wiring.packageStore.getAvailable(
        input.workspaceId,
        target.packageName,
        target.moduleAttachment,
      );
      let result;
      try {
        result = promoteToAvailable(target, currentlyAvailable);
      } catch (err) {
        if (err instanceof InvalidPackageTransitionError || err instanceof Error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
      const promoted = await ctx.wiring.packageStore.setState(result.promoted.installationId, result.promoted.nextState);
      if (result.demoted) {
        await ctx.wiring.packageStore.setState(result.demoted.installationId, result.demoted.nextState);
      }
      return { installation: promoted };
    }),

    /**
     * Rollback = fork a NEW draft installation from a historical version,
     * never an in-place revert (append-only-ledger invariant, matches every
     * other Bridge mutation). The forked row still needs its own `install` to
     * go live — rollback alone does not activate it.
     */
    rollback: procedure.input(packageRollbackInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      const rollbackTarget = await ctx.wiring.packageStore.get(input.rollbackTargetId);
      if (!rollbackTarget || rollbackTarget.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown rollback target installation" });
      }
      const currentAvailable = await ctx.wiring.packageStore.getAvailable(
        input.workspaceId,
        rollbackTarget.packageName,
        rollbackTarget.moduleAttachment,
      );
      if (!currentAvailable) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `package "${rollbackTarget.packageName}" has no currently-available version to roll back from` });
      }
      const forked = rollbackFromHistory({ currentAvailable, rollbackTarget });
      const created = await ctx.wiring.packageStore.create(forked);
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
  //  - installPropose is a mutation → requireAuthOnMutation applies (SEC-1).
  //    It fetches from the registry (PKG-2 verify-on-install via HttpCommonsClient),
  //    registers the manifest in the workspace package store (state=private), and
  //    returns the installationId. The caller then calls `packages.install` for the
  //    full governed proposal → pipeline → approval flow — no logic duplication.
  //  - publishBuiltins is a mutation → same auth gate. Pushes curated built-in
  //    packages to the running Commons service. Idempotent:
  //    already-published versions are skipped, not failed.
  //  - ALL mutations still go through requireAuthOnMutation (pipe middleware) and
  //    withPilotWorkspaceGuard (error translation).
  // ---------------------------------------------------------------------------

  commons: t.router({
    /** Browse the registry — filterable by kind and/or tag, paginated. */
    list: procedure
      .input(
        z.object({
          kind: z.enum(["workspace_definition", "skill", "workflow", "agent", "tool", "view", "integration_bundle"]).optional(),
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

    /** Package detail (latest + version history) for one package by name. */
    get: procedure
      .input(z.object({ name: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const detail: CommonsPackageDetail | null = await ctx.wiring.commonsRegistry.get(input.name);
        if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: `commons: package "${input.name}" not found` });
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
     * Install-from-Commons Step 1: fetch a package from the registry (PKG-2
     * verify-on-install happens inside HttpCommonsClient.get/getVersion), validate
     * its manifest, and register it in the workspace package store as a private
     * installation. Returns the installationId so the caller can then drive the
     * governed install flow via `packages.install(installationId, todayKey)`.
     *
     * Separating fetch+register from install keeps the governed proposal logic
     * inside the existing `packages.install` handler — no duplication.
     */
    installPropose: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          name: z.string().min(1),
          /** Omit to install the latest version. */
          version: z.string().optional(),
          modulePackageName: z.string().min(1),
          agentId: z.string().min(1),
          needId: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);

        const ownerModule = await ctx.wiring.packageStore.getAvailable(input.workspaceId, input.modulePackageName);
        if (!ownerModule || ownerModule.status !== "installed" || !ownerModule.manifest.module) {
          throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.modulePackageName}" not found` });
        }
        const need = ownerModule.manifest.module.commonsNeeds?.find((candidate) => candidate.id === input.needId);
        if (!need || need.agentId !== input.agentId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Commons capability need is not owned by the selected Module Agent" });
        }

        // Fetch from registry — HttpCommonsClient verifies the publisher signature (PKG-2).
        const entry = input.version
          ? await ctx.wiring.commonsRegistry.getVersion(input.name, input.version)
          : await ctx.wiring.commonsRegistry.get(input.name).then((d) => d?.latest ?? null);

        if (!entry) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: input.version
              ? `commons: ${input.name}@${input.version} not found`
              : `commons: package "${input.name}" not found`,
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
        if (entry.kind !== need.kind || !need.tags.every((tag) => entry.tags.includes(tag))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Commons package does not satisfy the declared Module need" });
        }

        // Re-validate the manifest at this seam (same guard packages.register uses).
        let manifest: PackageManifest;
        try {
          manifest = parsePackageManifest({ package: entry.manifest });
        } catch (err) {
          if (err instanceof PackageManifestValidationError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `commons manifest invalid: ${err.message}` });
          }
          throw err;
        }
        if (manifest.capabilities.length === 0 || manifest.capabilities.some((capability) => capability.capabilityType !== "skill")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only Skill packages can attach beneath a Module Agent" });
        }

        const dependencyPins = new Map<string, string>(
          (entry.securityScan.dependencyPins ?? []).map(
            (pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const,
          ),
        );
        const staged = new Set<string>();
        const stageDependencies = async (parent: PackageManifest): Promise<void> => {
          for (const dependency of parent.dependencies) {
            const key = `${dependency.manifestId}@${dependency.version}`;
            if (staged.has(key)) continue;
            staged.add(key);
            const dependencyEntry = await ctx.wiring.commonsRegistry.getVersion(
              dependency.manifestId,
              dependency.version,
            );
            const expectedHash = dependencyPins.get(key);
            if (!dependencyEntry || !expectedHash || dependencyEntry.integrity.value !== expectedHash) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" does not match its signed content-hash pin`,
              });
            }
            try {
              assertCommonsEntryContentTrusted(dependencyEntry);
            } catch (err) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: err instanceof Error ? err.message : `Commons dependency "${key}" failed trust verification`,
              });
            }
            await ctx.wiring.packageStore.create({
              workspaceId: input.workspaceId,
              packageName: dependencyEntry.manifest.name,
              packageVersion: dependencyEntry.manifest.version,
              manifest: dependencyEntry.manifest,
              computedRisk: dependencyEntry.securityScan.riskBand,
              state: "private",
              status: "pending_review",
              lineageManifestId: dependencyEntry.manifest.lineageManifestId,
              moduleAttachment: {
                source: "commons",
                modulePackageName: ownerModule.packageName,
                agentId: input.agentId,
                needId: input.needId,
                contentHash: dependencyEntry.integrity.value,
              },
            });
            for (const pin of dependencyEntry.securityScan.dependencyPins ?? []) {
              dependencyPins.set(`${pin.name}@${pin.version}`, pin.contentHash);
            }
            await stageDependencies(dependencyEntry.manifest);
          }
        };
        await stageDependencies(manifest);

        // Register as a private installation — same as packages.register, but the
        // manifest source is the verified Commons entry, not a user-supplied object.
        const created = await ctx.wiring.packageStore.create({
          workspaceId: input.workspaceId,
          packageName: manifest.name,
          packageVersion: manifest.version,
          manifest,
          computedRisk: entry.securityScan.riskBand,
          state: "private",
          status: "pending_review",
          lineageManifestId: manifest.lineageManifestId,
          moduleAttachment: {
            source: "commons",
            modulePackageName: ownerModule.packageName,
            agentId: input.agentId,
            needId: input.needId,
            contentHash: entry.integrity.value,
          },
        });

        return { installation: created };
      }),

    /**
     * Publish curated built-in packages to the running
     * Commons service. Idempotent: already-published versions are skipped.
     * This is the runtime equivalent of `pnpm --filter @bridge/api publish-builtins`.
     * Requires authentication (mutation guard) to prevent arbitrary callers from
     * flooding the registry.
     */
    publishBuiltins: procedure.mutation(async ({ ctx }) => {
      const published: string[] = [];
      const skipped: string[] = [];
      const failed: { name: string; reason: string }[] = [];

      for (const { manifest, commons } of COMMONS_BUILT_IN_PACKAGES) {
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
      assertPilotWorkspace(input.workspaceId);

      // AGENTS-2: resolve the spirit-animal tone + Chief-of-Staff persona
      // SERVER-SIDE from the stored onboarding profile rather than trusting the
      // client-supplied `input.animal`. The persisted profile's animal wins; the
      // client field is only a fallback for a workspace that hasn't saved a
      // profile yet (progressive onboarding). `profileFromRow` maps only what the
      // row actually carries — a missing profile just yields a generic persona,
      // same ZERO-input graceful default the kernel uses everywhere.
      const profileRow = await ctx.wiring.onboardingProfileStore.get(input.workspaceId);
      const profile = profileRow ? profileFromRow(profileRow) : undefined;
      const resolvedAnimalId = profile?.chosenAnimalId ?? input.animal;
      const tone = resolveAnimalTone(resolvedAnimalId);
      const cosPersona = buildChiefOfStaffPersona(profile ?? { workspaceId: input.workspaceId, source: "onboarding" });
      // Additive, display-only projection of the resolved CoS identity so the
      // client/avatar can reflect it — two different profiles yield two different
      // persona cards, observable at the API boundary. Never carries authority.
      const personaCard = { id: cosPersona.id, name: cosPersona.name, ...(cosPersona.tone ? { tone: cosPersona.tone } : {}) };

      // A leading "@communications"/"@comms" mention resolves to the
      // Communications SKILL (ADR-046), not an agent — no identity, no
      // capability_scope, just a direct model-backed drafting reply. Checked
      // before the agent-mention branch since the two mention sets are
      // disjoint (COMMUNICATIONS_SKILL.mentions was removed from
      // FOUNDATIONAL_AGENTS' registry).
      const skillMention = parseSkillMention(input.message);
      if (skillMention.skill === "communications") {
        const registeredModels = [...ctx.wiring.models.providers().values()].filter((p) => p.id !== "echo");
        const model = registeredModels[0];
        const system = buildCommunicationsSystemPrompt(tone);
        const text = model
          ? (await model.complete({ system, prompt: skillMention.rest || input.message, maxTokens: 512 })).text
          : `${COMMUNICATIONS_SKILL.mission} (offline mode — no model configured, so I can't draft this yet, but I've recorded the request.)`;
        return {
          reply: text,
          decision: { kind: "direct_reply" as const, confidence: 1, reason: "directly addressed via @communications skill", source: "model" as const },
          proposal: null,
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
        const registeredModels = [...ctx.wiring.models.providers().values()].filter((p) => p.id !== "echo");
        const model = registeredModels[0];

        // AGENTS-1: invoke the addressed agent as a first-class peer through the
        // @bridge/core `invokeAgent` seam (system-prompt assembly + model call +
        // offline fallback + the design-constraint check all live in core). The
        // result is a DISCRIMINATED UNION with no "executed" variant, so the
        // strongest thing a chat reply can carry is a draft this procedure must
        // still propose — the "no independent write" guarantee is structural,
        // not a convention re-checked here.
        const result = await invokeAgent({ agentId, message: rest || input.message, ...(model ? { model } : {}), ...(tone ? { tone } : {}) });

        if (result.kind === "information") {
          return {
            reply: result.text,
            decision: { kind: "direct_reply" as const, confidence: 1, reason: `directly addressed via @${agentId}`, source: "model" as const },
            proposal: null,
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
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "execute",
            resourceType: "skill",
            inputs: { agent: agentId, message: input.message, draft: result.text, designConstraintViolations: constraintViolations },
            skill: "stageMutation",
          },
          ctx.run,
        );
        return {
          reply: `${replyText}\n\nDrafted via ${agent.name} — proposed for review, not yet executed.`,
          decision: { kind: "route" as const, route: agentId, confidence: 1, reason: `directly addressed via @${agentId}`, source: "model" as const },
          proposal,
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

      // The "echo" provider (in-memory mode's network-free ModelProvider double,
      // @bridge/core's EchoModelProvider) echoes its prompt back verbatim — it is
      // not a real classifier, so classifyIntent's model path would always fail
      // to parse a registered route id from it and degrade to "clarify" on every
      // turn. Excluding it here means in-memory mode genuinely exercises the
      // DETERMINISTIC KEYWORD FALLBACK (the offline-required path) rather than a
      // model path that can never succeed; any other registered provider
      // (Ollama/Anthropic in persistent mode) is used normally.
      const registeredModels = [...ctx.wiring.models.providers().values()].filter((p) => p.id !== "echo");
      const model = registeredModels[0];

      const decision = chainOk
        ? await classifyIntent({ message: input.message, registry: CHIEF_OF_STAFF_REGISTRY, ...(model ? { model } : {}) })
        : {
            kind: "direct_reply" as const,
            confidence: 0,
            reason: `chain depth ${input.chainDepth} hit the hard cap (${MAX_CHAIN_DEPTH}) — replying directly instead of routing further (best-so-far fallback)`,
            source: "keyword_fallback" as const,
          };

      if (decision.kind !== "route" || !decision.route) {
        return {
          reply:
            decision.kind === "clarify"
              ? "I'm not confident which capability handles that yet — could you say more about what you're trying to do?"
              : "Noted — I don't have a capability to route that to yet, but I've recorded the request.",
          decision,
          proposal: null,
          agent: "chief_of_staff" as const,
          persona: personaCard,
        };
      }

      const target = CHIEF_OF_STAFF_REGISTRY.find((c) => c.id === decision.route);
      const proposal = await ctx.wiring.pipeline.propose(
        {
          workspaceId: input.workspaceId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "execute",
          resourceType: "skill",
          inputs: { route: decision.route, message: input.message },
          skill: "stageMutation",
        },
        ctx.run,
      );

      return {
        reply: `Routing this to "${decision.route}"${target ? ` (${target.description})` : ""} — proposed for review, not yet executed.`,
        decision,
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
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.goalTasks.createGoal(
          { workspaceId: input.workspaceId, type: input.type, title: input.title },
          { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
        );
      }),
      list: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.goalTasks.listGoals(input.workspaceId);
      }),
    }),

    task: t.router({
      create: authenticatedProcedure.input(taskCreateInput).mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const goal = await ctx.wiring.goalTasks.getGoal(input.workspaceId, input.goalId);
        const [agentWorkspaceId, agentActive] = await Promise.all([
          ctx.wiring.agents.workspaceId(input.assignedAgentId),
          ctx.wiring.agents.isActive(input.assignedAgentId),
        ]);
        if (!goal) {
          throw new TRPCError({ code: "NOT_FOUND", message: `unknown goal ${input.goalId}` });
        }
        if (agentWorkspaceId !== input.workspaceId || !agentActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "assigned Agent is not active in this workspace" });
        }
        return ctx.wiring.goalTasks.createTask(
          {
            workspaceId: input.workspaceId,
            goalId: input.goalId,
            type: input.type,
            assignedAgentId: input.assignedAgentId,
          },
          { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
        );
      }),
      listByGoal: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), goalId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          return ctx.wiring.goalTasks.listTasksByGoal(input.workspaceId, input.goalId);
        }),
      /** The ONLY thing that changes governed-Skill eligibility for a Task —
       * never a Skill manifest's `defaultAgents` preference list. */
      reassign: authenticatedProcedure.input(taskReassignInput).mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const [agentWorkspaceId, agentActive] = await Promise.all([
          ctx.wiring.agents.workspaceId(input.assignedAgentId),
          ctx.wiring.agents.isActive(input.assignedAgentId),
        ]);
        if (agentWorkspaceId !== input.workspaceId || !agentActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "assigned Agent is not active in this workspace" });
        }
        return ctx.wiring.goalTasks.reassignTask(
          input.workspaceId,
          input.taskId,
          input.assignedAgentId,
        );
      }),
    }),

    skill: t.router({
      /** Read-only preview of AGS1 resolution — never invokes the Skill. Lets
       * the UI show WHY an Agent is (or is not) eligible before a real call. */
      resolve: authenticatedProcedure.input(resolveSkillInput).query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const goal = await ctx.wiring.goalTasks.getGoal(input.workspaceId, input.goalId);
        const task = await ctx.wiring.goalTasks.getTask(input.workspaceId, input.taskId);
        if (!goal || !task || task.goalId !== goal.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown or mismatched Goal/Task" });
        }
        const [agentScope, agentDataScope, agentWorkspaceId, agentActive] = await Promise.all([
          ctx.wiring.agents.capabilityScope(input.agentId),
          ctx.wiring.agents.dataScope(input.agentId),
          ctx.wiring.agents.workspaceId(input.agentId),
          ctx.wiring.agents.isActive(input.agentId),
        ]);
        const candidates = input.skillId
          ? ctx.wiring.skillManifests.forSkill(input.workspaceId, input.skillId)
          : ctx.wiring.skillManifests.all(input.workspaceId);
        return resolveSkillForTask(candidates, {
          goal,
          task,
          agent: {
            id: input.agentId,
            workspaceId: agentWorkspaceId,
            active: agentActive,
            capabilityScope: agentScope,
            plane: "local",
            dataScope: agentDataScope,
          },
          ...(input.skillId ? { skillId: input.skillId } : {}),
          ...(input.requestedDataScope ? { requestedDataScope: input.requestedDataScope as DataScope } : {}),
        });
      }),
    }),

    childRun: t.router({
      get: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), childRunId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          return ctx.wiring.childAgentRuns.get(input.workspaceId, input.childRunId);
        }),

      listByParentRun: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), parentRunId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          return ctx.wiring.childAgentRuns.listByParentRun(input.workspaceId, input.parentRunId);
        }),

      /** Governance/Human may stop any child Run within policy. The acting
       * identity is SERVER-RESOLVED (`ctx.identity`), never client-asserted —
       * same rule every mutation in this router follows. */
      cancel: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), childRunId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return cancelChildAgentRun(
          { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
          input.workspaceId,
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
