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
