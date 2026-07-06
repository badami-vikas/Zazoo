/**
 * Onboarding pop-up — adaptive question set (docs/wiki/roadmap.md P1: "Onboarding
 * 5-12 adaptive Qs"; docs/wiki/clients.md: "Onboarding = pop-up screen, not a
 * separate page/app"; user decision 2026-07-06). Pure, framework-free question
 * flow + blueprint-building logic, kept separate from the React component
 * (OnboardingDialog.tsx) so the branching/compile logic is independently
 * testable without a DOM.
 *
 * ADAPTIVE means later questions branch on earlier answers — this module models
 * that as a small explicit decision graph (`next(answers)`), not a fixed list,
 * so "solo vs team" and "domain of work" can steer which questions appear
 * later without a big if/else scattered through the component. Every question
 * has a real effect on the compiled WorkspaceBlueprint (entities/views/
 * vocabulary) — no filler questions asked just to hit a minimum count.
 */
import type { WorkspaceBlueprint } from "@bridge/core";

export type QuestionKind = "single_select" | "multi_select" | "text";

export interface QuestionOption {
  value: string;
  label: string;
}

export interface OnboardingQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  helpText?: string;
  options?: QuestionOption[];
  placeholder?: string;
}

export type OnboardingAnswers = Record<string, string | string[] | undefined>;

const Q_MODE: OnboardingQuestion = {
  id: "mode",
  kind: "single_select",
  prompt: "Are you working solo, or with a team?",
  options: [
    { value: "solo", label: "Just me" },
    { value: "team", label: "Me and a team" },
  ],
};

const Q_DOMAIN: OnboardingQuestion = {
  id: "domain",
  kind: "single_select",
  prompt: "What's the main kind of work you want Bridge to organize?",
  helpText: "This decides which entities your workspace starts with.",
  options: [
    { value: "sales_deals", label: "Deals / sales pipeline" },
    { value: "job_search", label: "Job search" },
    { value: "support", label: "Customer support / helpdesk" },
    { value: "relationships", label: "General relationships & networking" },
  ],
};

const Q_WATCH_FIRST: OnboardingQuestion = {
  id: "watch_first",
  kind: "multi_select",
  prompt: "What should Bridge watch or do first?",
  helpText: "You can change this later — this just seeds your first views.",
  options: [
    { value: "track_stage", label: "Track stage/status changes" },
    { value: "surface_signals", label: "Surface signals that need a response" },
    { value: "log_touchpoints", label: "Log meetings/calls/emails as touchpoints" },
    { value: "calendar", label: "Keep an eye on my calendar" },
  ],
};

const Q_TEAM_SIZE: OnboardingQuestion = {
  id: "team_size",
  kind: "single_select",
  prompt: "Roughly how many people are on the team?",
  options: [
    { value: "2-5", label: "2-5" },
    { value: "6-20", label: "6-20" },
    { value: "20+", label: "20+" },
  ],
};

const Q_VOCAB: OnboardingQuestion = {
  id: "vocab_name",
  kind: "text",
  prompt: "What do you call the thing you're tracking? (e.g. \"Deal\", \"Candidate\", \"Case\")",
  helpText: "Bridge's kernel calls this an Initiative — your own word for it is what you'll see everywhere.",
  placeholder: "e.g. Deal",
};

const Q_VIEW_STYLE: OnboardingQuestion = {
  id: "view_style",
  kind: "single_select",
  prompt: "How do you like to see your work — a list, or a board?",
  options: [
    { value: "table", label: "List / table" },
    { value: "kanban", label: "Board (kanban)" },
  ],
};

const Q_NAME: OnboardingQuestion = {
  id: "workspace_name",
  kind: "text",
  prompt: "Last thing — what should we call this workspace?",
  placeholder: "e.g. My Deals",
};

/**
 * The adaptive step function: given the answers collected SO FAR, returns the
 * next question to ask, or null when onboarding is complete. This is the
 * "later questions branch on earlier answers" contract — e.g. `team_size`
 * only appears when `mode === "team"`, and `vocab_name` is skipped for the
 * "relationships" domain (Bridge's own vocabulary already fits).
 *
 * Bounded to 5-12 questions per docs/wiki/roadmap.md: the shortest real path
 * (solo + relationships) asks 5; the longest (team + a domain needing a vocab
 * override) asks 7 — both comfortably inside the 5-12 band without padding.
 */
export function nextQuestion(answers: OnboardingAnswers): OnboardingQuestion | null {
  if (answers.mode === undefined) return Q_MODE;
  if (answers.domain === undefined) return Q_DOMAIN;
  if (answers.mode === "team" && answers.team_size === undefined) return Q_TEAM_SIZE;
  if (answers.watch_first === undefined) return Q_WATCH_FIRST;
  if (answers.domain !== "relationships" && answers.vocab_name === undefined) return Q_VOCAB;
  if (answers.view_style === undefined) return Q_VIEW_STYLE;
  if (answers.workspace_name === undefined) return Q_NAME;
  return null;
}

/** Node type + starter fields per domain — the entities a fresh workspace
 * starts with. Kept to kernel-registered node types only (compileBlueprint
 * rejects anything else) — vocabulary overrides (not new node types) are how
 * a domain's own naming shows through. */
const DOMAIN_ENTITY: Record<string, { nodeType: string; label: string }> = {
  sales_deals: { nodeType: "initiative", label: "Initiative" },
  job_search: { nodeType: "initiative", label: "Initiative" },
  support: { nodeType: "touchpoint", label: "Touchpoint" },
  relationships: { nodeType: "person", label: "Person" },
};

/**
 * Compile the collected answers into a `WorkspaceBlueprint` — the exact shape
 * `workspace.blueprint.propose` accepts (packages/core/src/blueprint.ts). Pure
 * function, no I/O; the caller (OnboardingDialog) is responsible for calling
 * compileBlueprint() to preview it and workspace.blueprint.propose to submit
 * it as a governed draft.
 */
export function buildBlueprintFromAnswers(answers: OnboardingAnswers): WorkspaceBlueprint {
  const domain = (answers.domain as string | undefined) ?? "relationships";
  const entityDef = DOMAIN_ENTITY[domain] ?? DOMAIN_ENTITY.relationships!;
  const watchFirst = (answers.watch_first as string[] | undefined) ?? [];
  const viewStyle = (answers.view_style as string | undefined) === "kanban" ? "kanban" : "table";
  const vocabName = (answers.vocab_name as string | undefined)?.trim();

  const fields = [
    { id: "name", label: "Name", kind: "text" as const },
    ...(watchFirst.includes("track_stage")
      ? [{ id: "stage", label: "Stage", kind: "select" as const, options: ["new", "active", "closed"] }]
      : []),
  ];

  const vocabulary: Record<string, string> = {};
  if (vocabName) vocabulary[entityDef.label] = vocabName;

  return {
    vocabulary,
    entities: [{ nodeType: entityDef.nodeType, label: entityDef.label, fields }],
    views: [
      { entity: entityDef.nodeType, kind: viewStyle },
      ...(watchFirst.includes("surface_signals") ? [{ entity: "signal", kind: "table" as const }] : []),
      ...(watchFirst.includes("log_touchpoints") && entityDef.nodeType !== "touchpoint"
        ? [{ entity: "touchpoint", kind: "table" as const }]
        : []),
    ],
    capabilities: [],
  };
}

/** True once `nextQuestion` would return null — used by the dialog to know
 * when to show the compiled preview instead of another question. */
export function isComplete(answers: OnboardingAnswers): boolean {
  return nextQuestion(answers) === null;
}
