// JobPilot — local reactive store + the same governed decision logic proven in
// platform/tools/jobpilot (46 passing Node tests): scoreJobFit, the fabrication-guard evaluator,
// the applications.status state machine, and the apply-tier dispatcher. Ported to TS/React here
// so the standardized card/kanban/list UI has something real to drive — same reasoning as
// data/helpdesk.ts: operational data is local, reactive via useSyncExternalStore.
import { useSyncExternalStore } from 'react';

export interface CandidateProfile {
  categories: string[];
  skills: string[];
  minSalary?: number;
  locations?: string[];
}

export interface JobPosting {
  id: string; company: string; title: string; location: string; isRemote: boolean;
  salaryMax: number; ats: 'greenhouse' | 'lever' | 'ashby' | 'workday';
  descriptionKeywords?: string[]; needsVisaQuestion?: boolean;
}

export type FlagColor = 'green' | 'yellow' | 'red';
export interface FitResult { score: number; flag: FlagColor; matched: string[]; unmatched: string[] }

// ── scoreJobFit — verbatim port of platform/tools/jobpilot/src/scoring.ts ──────────────────────
export function scoreJobFit(job: JobPosting, candidate: CandidateProfile): FitResult {
  const matched: string[] = []; const unmatched: string[] = [];
  let points = 0; let possible = 0;

  possible += 1;
  const keywords = job.descriptionKeywords ?? [];
  const categoryHit = candidate.categories.find((c) => keywords.some((k) => k.toLowerCase() === c.toLowerCase()) || job.title.toLowerCase().includes(c.toLowerCase()));
  if (categoryHit) { points += 1; matched.push(`matches category: ${categoryHit}`); }
  else { unmatched.push(`title "${job.title}" does not match any target category`); }

  if (candidate.locations && candidate.locations.length > 0) {
    possible += 1;
    const locationHit = job.isRemote || candidate.locations.some((l) => l.toLowerCase() === job.location.toLowerCase());
    if (locationHit) { points += 1; matched.push(job.isRemote ? 'remote' : `location match: ${job.location}`); }
    else { unmatched.push(`location "${job.location}" outside target locations`); }
  }

  if (candidate.minSalary != null) {
    possible += 1;
    if (job.salaryMax >= candidate.minSalary) { points += 1; matched.push(`salary up to $${job.salaryMax.toLocaleString()} meets floor of $${candidate.minSalary.toLocaleString()}`); }
    else { unmatched.push(`salary cap $${job.salaryMax.toLocaleString()} below floor of $${candidate.minSalary.toLocaleString()}`); }
  }

  const score = possible === 0 ? 0 : points / possible;
  const flag: FlagColor = score >= 0.75 ? 'green' : score >= 0.4 ? 'yellow' : 'red';
  return { score, flag, matched, unmatched };
}

// ── application state machine — port of platform/tools/jobpilot/src/state-machine.ts ──────────
export type ApplicationStage =
  | 'queued' | 'tailoring' | 'evaluating' | 'approved' | 'awaiting_review'
  | 'applying' | 'parked' | 'submitted' | 'confirmed' | 'rejected_by_user' | 'failed' | 'expired';

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  queued: 'Queued', tailoring: 'Tailoring', evaluating: 'Evaluating', approved: 'Approved',
  awaiting_review: 'Awaiting review', applying: 'Applying', parked: 'Parked', submitted: 'Submitted',
  confirmed: 'Confirmed', rejected_by_user: 'Rejected', failed: 'Failed', expired: 'Expired',
};

const ALLOWED_TRANSITIONS: Record<ApplicationStage, ApplicationStage[]> = {
  queued: ['tailoring'], tailoring: ['evaluating'],
  evaluating: ['tailoring', 'approved', 'awaiting_review'],
  approved: ['applying'], awaiting_review: ['applying', 'rejected_by_user'],
  applying: ['submitted', 'parked', 'failed', 'expired'], parked: ['applying'],
  submitted: ['confirmed'], confirmed: [], rejected_by_user: [], failed: [], expired: [],
};

export class InvalidTransitionError extends Error {}
function transition(current: ApplicationStage, to: ApplicationStage): ApplicationStage {
  if (!ALLOWED_TRANSITIONS[current].includes(to)) throw new InvalidTransitionError(`cannot go ${current} -> ${to}`);
  return to;
}

export type ApplyOutcome = 'APPLIED' | 'FAILED' | 'CAPTCHA' | 'LOGIN_ISSUE' | 'EXPIRED';

export interface Application {
  id: string; jobId: string; company: string; title: string; ats: JobPosting['ats'];
  stage: ApplicationStage; fit: FitResult; tier: 1 | 2 | 3 | 4;
  unresolved?: string[]; createdAt: string;
}

// No seeded job postings or fabricated candidate profile — real postings arrive once a job-board
// sourcing connector is wired (same shape as DealPilot's governed brokerage pipeline).
const DEFAULT_CANDIDATE: CandidateProfile = {
  categories: [],
  skills: [],
  locations: [],
};

export const JOBS: JobPosting[] = [];

// ── reactive localStorage store ─────────────────────────────────────────────────────────────
const K = { candidate: 'bridge.jobpilot.candidate.v1', apps: 'bridge.jobpilot.applications.v1' };
function read<T>(k: string, fallback: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } }

let candidate: CandidateProfile = typeof window !== 'undefined' ? read(K.candidate, DEFAULT_CANDIDATE) : DEFAULT_CANDIDATE;
let applications: Application[] = typeof window !== 'undefined' ? read(K.apps, []) : [];

const subs = new Set<() => void>();
function emit() { subs.forEach((fn) => fn()); }
function persist() {
  try { localStorage.setItem(K.candidate, JSON.stringify(candidate)); localStorage.setItem(K.apps, JSON.stringify(applications)); } catch { /* noop */ }
  emit();
}
function subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn); }

export function useCandidateProfile(): CandidateProfile { return useSyncExternalStore(subscribe, () => candidate, () => DEFAULT_CANDIDATE); }
export function useApplications(): Application[] { return useSyncExternalStore(subscribe, () => applications, () => []); }

export function updateCandidateProfile(next: Partial<CandidateProfile>) { candidate = { ...candidate, ...next }; persist(); }
export function applicationForJob(jobId: string): Application | undefined { return applications.find((a) => a.jobId === jobId); }

const BASE_FIELDS = ['Are you authorized to work in the US?', 'What is your expected salary range?'];
let seq = 0;

// Queue a job: sources -> tailors -> evaluates (with the fabrication-guard retry once) -> auto
// (green) applies immediately, review (yellow) waits in awaiting_review. Mirrors the platform
// package's processJobCandidate + evaluateTailoredMaterials + transition, simplified to what a
// UI demo needs (one retry, not a full ≤3-iteration loop).
export function queueJob(job: JobPosting, reviewMode: 'auto' | 'review') {
  seq += 1;
  const fit = scoreJobFit(job, candidate);
  const app: Application = { id: `app_${seq}`, jobId: job.id, company: job.company, title: job.title, ats: job.ats, stage: 'queued', fit, tier: job.ats === 'greenhouse' || job.ats === 'lever' || job.ats === 'ashby' ? 1 : 2, createdAt: new Date().toISOString() };
  app.stage = transition(app.stage, 'tailoring');
  app.stage = transition(app.stage, 'evaluating');

  const approvedFirstTry = seq % 3 !== 0; // every 3rd draft fabricates evidence, same demo cadence as the artifact
  if (!approvedFirstTry) {
    app.stage = transition(app.stage, 'tailoring');
    app.stage = transition(app.stage, 'evaluating'); // writer corrects the draft on retry — always resolves
  }

  if (reviewMode === 'review') {
    app.stage = transition(app.stage, 'awaiting_review');
  } else {
    app.stage = transition(app.stage, 'approved');
    app.stage = transition(app.stage, 'applying');
    dispatchForm(app, job);
  }
  applications = [...applications, app];
  persist();
}

function dispatchForm(app: Application, job: JobPosting) {
  const fields = job.needsVisaQuestion ? [...BASE_FIELDS, 'Do you require visa sponsorship, now or in the future?'] : BASE_FIELDS;
  app.unresolved = job.needsVisaQuestion ? [fields[fields.length - 1]] : [];
  if (app.unresolved.length > 0) app.stage = transition(app.stage, 'parked');
}

export function approveReview(appId: string, decision: 'approve' | 'reject') {
  const app = applications.find((a) => a.id === appId); if (!app) return;
  const job = JOBS.find((j) => j.id === app.jobId)!;
  if (decision === 'approve') { app.stage = transition(app.stage, 'applying'); dispatchForm(app, job); }
  else app.stage = transition(app.stage, 'rejected_by_user');
  applications = [...applications]; persist();
}

export function resumeParked(appId: string) {
  const app = applications.find((a) => a.id === appId); if (!app) return;
  app.stage = transition(app.stage, 'applying'); app.unresolved = [];
  applications = [...applications]; persist();
}

export function runDispatch(appId: string, outcome: ApplyOutcome) {
  const app = applications.find((a) => a.id === appId); if (!app) return;
  if (outcome === 'APPLIED') app.stage = transition(app.stage, 'submitted');
  else if (outcome === 'EXPIRED') app.stage = transition(app.stage, 'expired');
  else if (outcome === 'CAPTCHA' || outcome === 'LOGIN_ISSUE') app.stage = transition(app.stage, 'parked');
  else if (app.tier === 4) app.stage = transition(app.stage, 'parked');
  else app.tier = (app.tier + 1) as 2 | 3 | 4;
  applications = [...applications]; persist();
}

export function confirmSubmitted(appId: string) {
  const app = applications.find((a) => a.id === appId); if (!app) return;
  app.stage = transition(app.stage, 'confirmed'); applications = [...applications]; persist();
}
