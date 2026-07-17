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
export type { CandidateProfile, JobProfile, FlagColor, FitResult, EvalVerdict, ApplicationStage } from "./types.js";
export { scoreJobFit } from "./scoring.js";
export type { ChangeLogEntry } from "./evaluator.js";
export { evaluateTailoredMaterials } from "./evaluator.js";
export type { JobPipelineResult } from "./pipeline.js";
export { processJobCandidate } from "./pipeline.js";
export { jobsTableSpec, jobsCardFeedView, jobsTrackerView } from "./table.js";
export { createGreenhouseConnector, createAshbyConnector, createLeverConnector } from "./connectors.js";
export type { StageActor, StageEvent } from "./state-machine.js";
export { InvalidTransitionError, transition } from "./state-machine.js";
export type { AnswerSource, AnswerRecord, AnswerBank } from "./answer-bank.js";
export { NeedsHuman, normalizeQuestion, isSensitiveQuestion, createAnswerBank, FUZZY_THRESHOLD } from "./answer-bank.js";
export type { OnboardingInput } from "./onboarding.js";
export { extractSkills, proposeCategories, buildCandidateProfile } from "./onboarding.js";
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
  CultureArtifactRef,
  GroundedClaimInput,
  ClaimGroundingFailureReason,
  ClaimGroundingFailure,
  ClaimGroundingResult,
} from "./culture-research.js";
