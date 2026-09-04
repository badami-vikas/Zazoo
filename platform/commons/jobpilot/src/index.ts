export { jobPilotManifest } from "./manifest.js";
// JP1 — domain foundation: JSON Resume contract, master profile compiler, approval guard
export {
  JsonResumeSchema,
  BasicsSchema,
  WorkEntrySchema,
  EducationEntrySchema,
  SkillSchema,
  PROTECTED_WORK_FIELDS,
  PROTECTED_EDUCATION_FIELDS,
} from "./resume-schema.js";
export type { JsonResume, Basics, WorkEntry, EducationEntry, Skill, Language, Project, Certificate } from "./resume-schema.js";
export type { NeedsHumanReason, NeedsHumanField, ParsedSource, MasterProfile } from "./master-profile.js";
export { compileProfile } from "./master-profile.js";
export type { ApprovedProfile } from "./profile-approval.js";
export { approveProfile, isApprovedProfile, assertApprovedProfile } from "./profile-approval.js";
export type { CandidateProfile, JobProfile, FitRecommendation, FitResult, EvalVerdict, ApplicationStage } from "./types.js";
export { normalizeLegacyFitFlag } from "./types.js";
export { scoreJobFit } from "./scoring.js";
export type { ChangeLogEntry } from "./evaluator.js";
export { evaluateTailoredMaterials } from "./evaluator.js";
export type { JobPipelineResult } from "./pipeline.js";
export { processJobCandidate } from "./pipeline.js";
export { jobsTableSpec, jobsCardFeedView, jobsTrackerView } from "./table.js";
export { createGreenhouseConnector, createAshbyConnector, createLeverConnector } from "./connectors.js";
// Real HTTP fetchers — the supplier connectors.ts always expected and never had.
export type { FetchedPosting } from "./fetchers.js";
export { BoardFetchError, greenhouseFetcher, leverFetcher, ashbyFetcher } from "./fetchers.js";
export type { SourceKind, JobSource } from "./sources.js";
export { SOURCE_CATALOG, findSource, fetcherFor } from "./sources.js";
export type { SweepResult, SweepCandidateResult } from "./sweep.js";
export { selectPostings, postingToJobProfile } from "./sweep.js";
// Curated full-time MBA recruiting targets — deadlines no ATS feed carries.
export type { SponsorshipTier, MbaTarget } from "./mba-targets.js";
export { MBA_FULL_TIME_TARGETS, targetsClosingIn, unverifiedTargets, sponsoringTargets } from "./mba-targets.js";
export type { StageActor, StageEvent } from "./state-machine.js";
export { InvalidTransitionError, transition } from "./state-machine.js";
export type { AnswerSource, AnswerRecord, AnswerBank } from "./answer-bank.js";
export { NeedsHuman, normalizeQuestion, isSensitiveQuestion, createAnswerBank, FUZZY_THRESHOLD } from "./answer-bank.js";
export type { OnboardingInput } from "./onboarding.js";
export { extractSkills, proposeCategories, buildCandidateProfile } from "./onboarding.js";
export type { JobFunction } from "./job-functions.js";
export { JOB_FUNCTIONS } from "./job-functions.js";
export type { EmailMessage, ApplicationRef, Classification, EmailClassifier, EmailDisposition, RouteResult } from "./gmail-router.js";
export { routeEmail } from "./gmail-router.js";
export type { FormField, FormMapping, ApplyOutcome, DispatchAction } from "./apply.js";
export { resolveEntryTier, mapAnswersToForm, nextDispatchAction, assertApprovedForSubmit } from "./apply.js";
export type { PacingLimits, PacingGate } from "./pacing.js";
export { createPacingGate } from "./pacing.js";
// JP3B (TASK-011) — culture-research source classification, evidence separation, disclosure, and
// fabrication guard. Pure logic only; see culture-research.ts's header comment on the `Skill`
// naming collision with resume-schema.ts's export above before importing both in one file.
export {
  CULTURE_SOURCE_CATALOG,
  classifyCultureSource,
  planCultureSources,
  partitionCultureEvidence,
  buildSourceDisclosure,
  assertNoFabricatedAffinityOrInsiderClaim,
  groundClaims,
  MAX_CULTURE_SOURCES_PER_RUN,
} from "./culture-research.js";
export type {
  CultureSourceType,
  CultureSourceEligibility,
  CultureSourceClassification,
  CultureSourceCandidate,
  CulturePermittedSource,
  CultureSkippedSource,
  CultureSourcePlan,
  CultureClaimType,
  CultureEvidence,
  CultureEvidencePartition,
  CultureSourceDisclosure,
  FabricationCheckResult,
  CultureResultRef,
  GroundedClaimInput,
  ClaimGroundingFailureReason,
  ClaimGroundingFailure,
  ClaimGroundingResult,
} from "./culture-research.js";
