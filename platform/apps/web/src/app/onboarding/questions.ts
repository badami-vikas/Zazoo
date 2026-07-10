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
 *
 * E1 (2026-07-09): LinkedIn login and phone OTP verification REJECTED — removed
 * from this module. Flow is now profession-led: the first question captures the
 * user's role so that downstream questions (domain, vocab) can be contextualised.
 */
import type { WorkspaceBlueprint } from "@bridge/core";
import { SPIRIT_ANIMALS } from "../avatar/avatar-store";

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

/** NEW first question (E1 2026-07-09): captures profession / role so that the
 * domain question's default selection can be made smarter and blueprint
 * vocabulary hints can be seeded without asking a separate "what do you call
 * your deals?" question if the profession already makes it obvious. */
const Q_PROFESSION: OnboardingQuestion = {
  id: "profession",
  kind: "text",
  prompt: "What's your role or profession?",
  helpText: "E.g. 'Sales lead at a SaaS startup', 'Independent investor', 'Customer support manager'",
  placeholder: "e.g. Sales lead at a SaaS startup",
};

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
  helpText: "This decides which entities your Organization starts with.",
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
  helpText: "Bridge calls this an Initiative by default — your own word for it is what you'll see everywhere.",
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
  prompt: "Last thing — what should we call your Organization?",
  placeholder: "e.g. My Deals",
};

/** Spirit animal picker (docs/raw/spec-consolidation-2026-07.md section 3 +
 * build brief item 2): a curated set of six, matching avatar-store.ts's
 * `SPIRIT_ANIMALS`. This answer has NO effect on the compiled blueprint
 * (unlike every other question here) — it only selects which creature the
 * avatar overlay renders as after hatching. Asked early (right after
 * solo/team) so the egg has something to visually anticipate for the rest of
 * the flow. */
const Q_SPIRIT_ANIMAL: OnboardingQuestion = {
  id: "spirit_animal",
  kind: "single_select",
  prompt: "Pick your avatar's spirit animal.",
  helpText: "Purely cosmetic — you can change this later in Settings.",
  options: SPIRIT_ANIMALS.map((a) => ({ value: a.value, label: a.label })),
};

/**
 * The adaptive step function: given the answers collected SO FAR, returns the
 * next question to ask, or null when onboarding is complete. This is the
 * "later questions branch on earlier answers" contract — e.g. `team_size`
 * only appears when `mode === "team"`, and `vocab_name` is skipped for the
 * "relationships" domain (Bridge's own vocabulary already fits).
 *
 * Question order (E1 2026-07-09):
 *   1. profession (text, always first — context for everything downstream)
 *   2. mode (solo/team)
 *   3. spirit_animal (cosmetic, stays per spec-avatar.md Day-1 requirement)
 *   4. domain (select; profession answer can inform default pre-selection in UI)
 *   5. team_size (only if mode=team)
 *   6. watch_first (multi-select)
 *   7. vocab_name (only if domain ≠ relationships)
 *   8. view_style
 *   9. workspace_name (auto-populated from email in dialog, still shown for confirmation)
 *
 * Bounded to 5-12 questions per docs/wiki/roadmap.md: the shortest real path
 * (solo + relationships) asks 7 (incl. spirit animal + profession); the longest
 * (team + a domain needing a vocab override) asks 9 — both comfortably inside
 * the 5-12 band without padding.
 */
export function nextQuestion(answers: OnboardingAnswers): OnboardingQuestion | null {
  if (answers.profession === undefined) return Q_PROFESSION;
  if (answers.mode === undefined) return Q_MODE;
  if (answers.spirit_animal === undefined) return Q_SPIRIT_ANIMAL;
  if (answers.domain === undefined) return Q_DOMAIN;
  if (answers.mode === "team" && answers.team_size === undefined) return Q_TEAM_SIZE;
  if (answers.watch_first === undefined) return Q_WATCH_FIRST;
  if (answers.domain !== "relationships" && answers.vocab_name === undefined) return Q_VOCAB;
  if (answers.view_style === undefined) return Q_VIEW_STYLE;
  if (answers.workspace_name === undefined) return Q_NAME;
  return null;
}

/** Total number of questions in the LONGEST real path (team + vocab-needing
 * domain): profession + mode + spirit_animal + domain + team_size + watch_first
 * + vocab_name + view_style + workspace_name = 9. Used only as the denominator
 * for egg-growth progress, never for branching logic itself (that stays in
 * `nextQuestion`). */
export const MAX_QUESTIONS = 9;

/** How many questions have been answered so far — the egg's "questions
 * answered" progress input (spec section 4, Stage 1-2: egg grows with real
 * step completion, not a fake timer). */
export function answeredCount(answers: OnboardingAnswers): number {
  return Object.values(answers).filter((v) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .length;
}

/**
 * Derives a default workspace name from an email address per spec-workspace-naming.md:
 * - Extract domain after @
 * - Strip common TLDs and generic free-mail providers (gmail, yahoo, hotmail,
 *   outlook, icloud, me, mac, proton, protonmail)
 * - Titlecase the remainder → workspace name
 * - Fallback: "<FirstName>'s Workspace" using the local part before @
 *
 * Examples:
 *   alice@acmecorp.com  → "Acmecorp"
 *   bob@stripe.com      → "Stripe"
 *   carol@gmail.com     → "Carol's Workspace"
 */
export function workspaceNameFromEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return `${toTitleCase(local ?? 'My')}'s Workspace`;
  const genericDomains = ['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'me', 'mac', 'proton', 'protonmail'];
  const domainBase = domain.split('.')[0] ?? '';
  if (genericDomains.includes(domainBase.toLowerCase())) {
    return `${toTitleCase(local ?? 'My')}'s Workspace`;
  }
  return toTitleCase(domainBase);
}

function toTitleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Node type + starter fields per domain — the entities a fresh workspace
 * starts with. Kept to kernel-registered node types only (compileBlueprint
 * rejects anything else) — vocabulary overrides (not new node types) are how
 * a domain's own naming shows through. */
// "label" is display-only text (R-020 vocab sweep: canonical default label is
// "Initiative", matching the kernel nodeType — CLAUDE.md's two-scope vocab rule).
// A user's own `vocab_name` answer still overrides this default via `vocabulary` below.
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
  // profession is a secondary hint for vocabulary: if the user named their work explicitly
  // via vocab_name, that wins. If not, profession is available for future smart-mapping
  // (e.g. "Sales lead" → suggest "Deal") — captured here for future use.
  const profession = (answers.profession as string | undefined)?.trim();

  const wantsCalendar = watchFirst.includes("calendar");

  const fields = [
    { id: "name", label: "Name", kind: "text" as const },
    ...(watchFirst.includes("track_stage")
      ? [{ id: "stage", label: "Stage", kind: "select" as const, options: ["new", "active", "closed"] }]
      : []),
    // "Keep an eye on my calendar" (watch_first: "calendar") was collected but
    // never read — see docs/BUGS.md "onboarding drops watch_first: calendar
    // answer". A calendar VIEW needs a date column to group by (CalendarView.tsx
    // falls back to "no date column" otherwise), so this adds one whenever the
    // user asked for it.
    ...(wantsCalendar ? [{ id: "next_step_date", label: "Next step date", kind: "date" as const }] : []),
  ];

  const vocabulary: Record<string, string> = {};
  if (vocabName) {
    vocabulary[entityDef.label] = vocabName;
  } else if (profession) {
    // profession captured as secondary hint; no auto-mapping applied yet
    // future: map keywords ("sales" → "Deal", "recruiter" → "Candidate", etc.)
    void profession;
  }

  return {
    vocabulary,
    entities: [{ nodeType: entityDef.nodeType, label: entityDef.label, fields }],
    views: [
      {
        entity: entityDef.nodeType,
        kind: viewStyle,
        // "onboarding kanban never sets groupBy" (docs/BUGS.md): when the
        // generated entity has a stage field AND the user picked the kanban
        // view style, group by it so the board renders grouped instead of
        // one flat unlabeled column. Lives under `config.groupBy`, per
        // blueprint.ts's BlueprintViewSpec shape (mirrors CompiledViewConfig).
        ...(viewStyle === "kanban" && watchFirst.includes("track_stage")
          ? { config: { groupBy: "stage" } }
          : {}),
      },
      ...(wantsCalendar ? [{ entity: entityDef.nodeType, kind: "calendar" as const }] : []),
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
