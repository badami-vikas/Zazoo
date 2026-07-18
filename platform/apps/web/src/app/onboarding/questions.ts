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
 * so "domain of work" can steer which questions appear later without a big
 * if/else scattered through the component. Every question has a real effect
 * on the compiled WorkspaceBlueprint (entities/views/vocabulary) — no filler
 * questions asked just to hit a minimum count.
 *
 * E1 (2026-07-09): LinkedIn login and phone OTP verification REJECTED — removed
 * from this module. Flow is now profession-led: the first question captures the
 * user's role so that downstream questions (domain, vocab) can be contextualised.
 *
 * E2 (2026-07-10, user correction): the "solo or team?" question REJECTED —
 * every workspace is a team workspace (solo = a team of one), so asking never
 * added information; `mode`/`team_size` never fed the compiled blueprint
 * anyway (confirmed: pure UI gating, no downstream consumer). Removed both
 * questions rather than defaulting them silently, since a removed question
 * leaves no dead branch to maintain.
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
  /** Plain-language reason for asking. */
  why: string;
  /** Immediate user-visible effect, including whether it can be changed later. */
  consequence: string;
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
  why: "This keeps Bridge's suggestions relevant to the work you actually do.",
  consequence: "What changes: your role guides later questions and recommendations. You can correct or delete it later.",
  placeholder: "e.g. Sales lead at a SaaS startup",
};

const Q_DOMAIN: OnboardingQuestion = {
  id: "domain",
  kind: "single_select",
  prompt: "What's the main kind of work you want Bridge to organize?",
  helpText: "This decides which entities your Organization starts with.",
  why: "This identifies the first useful area for Bridge to prepare.",
  consequence: "What changes: your answer shapes the proposed Records and Views. Nothing is created until you approve the preview.",
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
  why: "This tells Bridge what would be useful to surface first.",
  consequence: "What changes: your first Views reflect these choices. This does not grant permission to act.",
  options: [
    { value: "track_stage", label: "Track stage/status changes" },
    { value: "surface_signals", label: "Surface signals that need a response" },
    { value: "calendar", label: "Keep an eye on my calendar" },
  ],
};

const Q_VOCAB: OnboardingQuestion = {
  id: "vocab_name",
  kind: "text",
  prompt: "What do you call the thing you're tracking? (e.g. \"Deal\", \"Candidate\", \"Case\")",
  helpText: "Use the word you already use at work.",
  why: "Using your own vocabulary makes the proposed setup easier to understand.",
  consequence: "What changes: Bridge uses this term in the setup you review next. You can rename it later.",
  placeholder: "e.g. Deal",
};

const Q_VIEW_STYLE: OnboardingQuestion = {
  id: "view_style",
  kind: "single_select",
  prompt: "How do you like to see your work — a list, or a board?",
  why: "This makes the first View match how you prefer to scan work.",
  consequence: "What changes: Bridge proposes a list or board as the starting layout. You can switch later.",
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
  why: "A clear Organization name helps you recognize its scope.",
  consequence: "What changes: this name appears in your sidebar. You can change it by re-entering Onboarding later.",
};

/** Spirit animal picker (docs/raw/spec-consolidation-2026-07.md section 3 +
 * build brief item 2): a curated set of six, matching avatar-store.ts's
 * `SPIRIT_ANIMALS`. This answer has NO effect on the compiled blueprint
 * (unlike every other question here) — it only selects which creature the
 * avatar overlay renders as after hatching. Asked early (right after
 * profession) so the egg has something to visually anticipate for the rest
 * of the flow. */
const Q_SPIRIT_ANIMAL: OnboardingQuestion = {
  id: "spirit_animal",
  kind: "single_select",
  prompt: "Pick your avatar's spirit animal.",
  helpText: "Purely cosmetic — you can change this later in Settings.",
  why: "A familiar visual makes the companion easier to spot.",
  consequence: "What changes: only the avatar's appearance. Permissions, authority, and communication style do not change.",
  options: SPIRIT_ANIMALS.map((a) => ({ value: a.value, label: a.label })),
};

const Q_ROLE_MODEL: OnboardingQuestion = {
  id: "role_model",
  kind: "text",
  prompt: "Is there a public figure whose way of working you admire?",
  helpText: "Use a full name so the Learning Agent can find the right person. You can skip this.",
  why: "A public example can ground one useful recommendation in evidence instead of guesswork.",
  consequence: "What changes: Learning checks a bounded public source and drafts one cited recommendation for your approval. You can skip this.",
  placeholder: "e.g. Indra Nooyi",
};

const Q_ROLE_MODEL_WHY: OnboardingQuestion = {
  id: "role_model_why",
  kind: "text",
  prompt: "What do you admire about how they work?",
  helpText: "Describe a behavior or quality, not a blanket endorsement of the person.",
  why: "The specific behavior matters more than blanket admiration of a person.",
  consequence: "What changes: the cited recommendation is limited to this quality and still requires your approval.",
  placeholder: "e.g. They prepare carefully and communicate decisions clearly",
};

/**
 * The adaptive step function: given the answers collected SO FAR, returns the
 * next question to ask, or null when onboarding is complete. This is the
 * "later questions branch on earlier answers" contract — e.g. `vocab_name`
 * is skipped for the "relationships" domain (Bridge's own vocabulary
 * already fits).
 *
 * Question order (E2 2026-07-10 — dropped "solo or team?"):
 *   1. profession (text, always first — context for everything downstream)
 *   2. spirit_animal (cosmetic, stays per spec-avatar.md Day-1 requirement)
 *   3. role_model (optional public figure)
 *   4. role_model_why (only when a figure was supplied)
 *   5. domain (select; profession answer can inform default pre-selection in UI)
 *   6. watch_first (multi-select)
 *   7. vocab_name (only if domain ≠ relationships)
 *   8. view_style
 *   9. workspace_name (auto-populated from email in dialog, still shown for confirmation)
 *
 * Bounded to 5-12 questions per docs/wiki/roadmap.md: the shortest real path
 * (role model skipped + relationships domain) asks 7; the longest (role model
 * supplied + a domain needing a vocabulary override) asks 9.
 */
export function nextQuestion(answers: OnboardingAnswers): OnboardingQuestion | null {
  if (answers.profession === undefined) return Q_PROFESSION;
  if (answers.spirit_animal === undefined) return Q_SPIRIT_ANIMAL;
  if (answers.role_model === undefined) return Q_ROLE_MODEL;
  if (answers.role_model && answers.role_model_why === undefined) return Q_ROLE_MODEL_WHY;
  if (answers.domain === undefined) return Q_DOMAIN;
  if (answers.watch_first === undefined) return Q_WATCH_FIRST;
  if (answers.domain !== "relationships" && answers.vocab_name === undefined) return Q_VOCAB;
  if (answers.view_style === undefined) return Q_VIEW_STYLE;
  if (answers.workspace_name === undefined) return Q_NAME;
  return null;
}

/** Total number of questions in the LONGEST real path. Used only as the denominator for
 * egg-growth progress, never for branching logic itself (that stays in
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
 * - Titlecase the remainder → Organization name
 * - Fallback: "<FirstName>'s Organization" using the local part before @
 *
 * Examples:
 *   alice@acmecorp.com  → "Acmecorp"
 *   bob@stripe.com      → "Stripe"
 *   carol@gmail.com     → "Carol's Organization"
 */
export function workspaceNameFromEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return `${toTitleCase(local ?? 'My')}'s Organization`;
  const genericDomains = ['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'me', 'mac', 'proton', 'protonmail'];
  const domainBase = domain.split('.')[0] ?? '';
  if (genericDomains.includes(domainBase.toLowerCase())) {
    return `${toTitleCase(local ?? 'My')}'s Organization`;
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
// Display labels use the domain's canonical Record name while legacy nodeType
// identifiers remain time-boxed under VOCAB2.
const DOMAIN_ENTITY: Record<string, { nodeType: string; label: string }> = {
  sales_deals: { nodeType: "initiative", label: "Deal" },
  job_search: { nodeType: "initiative", label: "Application" },
  support: { nodeType: "touchpoint", label: "Ticket" },
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
  const wantsSignals = watchFirst.includes("surface_signals");

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
    entities: [
      { nodeType: entityDef.nodeType, label: entityDef.label, fields },
      ...(wantsSignals && entityDef.nodeType !== "signal"
        ? [{
            nodeType: "signal",
            label: "Signal",
            fields: [
              { id: "name", label: "Name", kind: "text" as const },
              { id: "occurred_at", label: "Occurred at", kind: "date" as const },
            ],
          }]
        : []),
    ],
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
      ...(wantsSignals ? [{ entity: "signal", kind: "table" as const }] : []),
    ],
    capabilities: [],
  };
}

/** True once `nextQuestion` would return null — used by the dialog to know
 * when to show the compiled preview instead of another question. */
export function isComplete(answers: OnboardingAnswers): boolean {
  return nextQuestion(answers) === null;
}
