import type { ApplicationStage } from "./types.js";
import { transition, InvalidTransitionError } from "./state-machine.js";

// Gmail Smart Router (architecture doc S3 `gmail.SmartRouter`: "one cheap-LLM call per email with
// a numbered active-application list -> {bestMatchIndex(1-based), confidence, stageTarget,
// isRelevant}; >=95 auto-advance, 50-94 review, <50 orphan"). The classification call itself is
// injected (the `classify` parameter) exactly like connectors.ts injects a fetcher — no `llm`
// module exists yet to bind a real cheap-tier model to, so this module owns only the ROUTING
// policy (confidence bucketing + the transition-validity guard), never the classification.
// Consumes Module/Skill composition: reuses `transition` from state-machine.ts rather
// than re-validating the stage graph here.

export interface EmailMessage {
  subject: string;
  body: string;
}

export interface ApplicationRef {
  id: string;
  company: string;
  title: string;
  stage: ApplicationStage;
}

export interface Classification {
  bestMatchIndex: number; // 1-based index into the applications list passed to classify, or 0 = no match
  confidence: number; // 0..100
  stageTarget: ApplicationStage;
}

export type EmailClassifier = (email: EmailMessage, applications: ApplicationRef[]) => Classification;

export type EmailDisposition = "auto_linked" | "review" | "orphan";

export interface RouteResult {
  applicationId: string | null;
  confidence: number;
  stageTarget: ApplicationStage | null;
  disposition: EmailDisposition;
}

const AUTO_LINK_THRESHOLD = 95;
const REVIEW_THRESHOLD = 50;

export function routeEmail(email: EmailMessage, applications: ApplicationRef[], classify: EmailClassifier): RouteResult {
  if (applications.length === 0) {
    return { applicationId: null, confidence: 0, stageTarget: null, disposition: "orphan" };
  }

  const result = classify(email, applications);
  const matched = applications[result.bestMatchIndex - 1];

  if (!matched || result.confidence < REVIEW_THRESHOLD) {
    return { applicationId: null, confidence: result.confidence, stageTarget: null, disposition: "orphan" };
  }

  if (result.confidence < AUTO_LINK_THRESHOLD) {
    return { applicationId: matched.id, confidence: result.confidence, stageTarget: result.stageTarget, disposition: "review" };
  }

  // High confidence alone is not enough to auto-advance: the proposed stageTarget must also be a
  // legal transition from the application's current stage, or this downgrades to review rather
  // than silently applying (or worse, throwing) an invalid jump — routing policy never bypasses
  // the state machine's invariants.
  try {
    transition(matched.stage, result.stageTarget, matched.id, "gmail_router");
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return { applicationId: matched.id, confidence: result.confidence, stageTarget: result.stageTarget, disposition: "review" };
    }
    throw err;
  }

  return { applicationId: matched.id, confidence: result.confidence, stageTarget: result.stageTarget, disposition: "auto_linked" };
}
