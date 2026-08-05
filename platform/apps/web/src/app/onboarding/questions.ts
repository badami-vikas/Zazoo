/**
 * Onboarding pop-up — adaptive question set (docs/wiki/clients.md: "Onboarding
 * = pop-up screen, not a separate page/app"; user decision 2026-07-06). Pure,
 * framework-free question flow + blueprint-building logic, kept separate from
 * the React component (OnboardingDialog.tsx) so the branching/compile logic is
 * independently testable without a DOM.
 *
 * ADAPTIVE means later questions branch on earlier answers — this module models
 * that as a small explicit decision graph (`next(answers)`), not a fixed list.
 *
 * E1 (2026-07-09): LinkedIn login and phone OTP verification REJECTED — removed
 * from this module. Flow is now profession-led: the first question captures the
 * user's role so that downstream questions can be contextualised.
 *
 * E2 (2026-07-10, user correction): the "solo or team?" question REJECTED —
 * every organization is a team organization (solo = a team of one).
 *
 * E3 (2026-08-05, user correction — "most onboarding questions are irrelevant.
 * Limit to the questions I had shared earlier which you had documented"): the
 * user-facing manual set is now EXACTLY the five documented in
 * docs/raw/bridge-foundational-agents-onboarding-2026-07.md step 6:
 *   1. profession (+ hobbies)
 *   2. up to 3 "what fills your workday" picks (profession-templated options)
 *   3. one adaptive contextual question keyed to profession
 *   4. "where does most of your work live" (profession-customized list)
 *   5. "where would you like me to begin" (multi-select outcomes)
 * `avatar_style` is spec STEP 3 ("Choose your Chief of Staff"), a separate step
 * that is deliberately NOT counted among the five.
 *
 * Four previously-asked questions were removed from the user-facing flow. None
 * of their blueprint inputs were dropped — each is now DERIVED or DEFAULTED:
 *   - `domain`            -> inferDomain() from profession + workday picks
 *   - `vocab_name`        -> derivedVocabName() from the profession template
 *   - `view_style`        -> derivedViewStyle() from the domain + begin picks
 *   - `organization_name` -> defaultOrganizationName() from the signed-in email
 * An explicitly-supplied answer still wins for every one of them, so Settings
 * ("Re-enter onboarding") or a future advanced flow can set them directly.
 *
 * `role_model` / `role_model_why` belong to a DIFFERENT approved requirement
 * (docs/raw/requirement-role-model-learning-dealpilot-ui-2026-07-14.md). They
 * are GATED OUT of the default flow rather than deleted — pass
 * `{ includeRoleModel: true }` to `nextQuestion`/`isComplete` to restore them.
 * The submit path in OnboardingDialog still honours the answers when present.
 *
 * E4 (2026-08-05, user directive — "group them" + "let them just type" instead
 * of picking an animal): two presentation changes, no change to what is asked
 * or what feeds the blueprint.
 *   - `questionGroups()` batches the six questions into three topical SCREENS
 *     (Companion; Your work; Getting started) instead of one question per
 *     screen. `nextQuestion()` (single-question) is UNCHANGED and still used
 *     by `isComplete`/`answeredCount`/tests — the grouping is a pure
 *     presentation layer over the same adaptive graph, so an unanswered
 *     question inside an otherwise-complete group still blocks completion.
 *   - `Q_AVATAR_STYLE` changed from `single_select` (click one of 16 animal
 *     buttons) to `text` (type a name for the companion). The typed text
 *     becomes `avatarName` in full; `resolveAvatarStyleFromText()` matches any
 *     one of the 16 real, hand-drawn styles (AVATAR_STYLES) as a WHOLE WORD in
 *     what was typed and, only on a match, also sets the render style —
 *     honesty (AP-021): Bridge cannot render an arbitrary typed creature, only
 *     these 16, so an unmatched name keeps the current/default style and the
 *     dialog SAYS so rather than silently ignoring the word.
 */
import type { OrganizationBlueprint } from "@bridge/core";
import { AVATAR_STYLES, type AvatarStyle } from "../avatar/avatar-store";

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
  /** Multi-select only: hard cap on how many options may be picked. */
  maxSelections?: number;
}

export type OnboardingAnswers = Record<string, string | string[] | undefined>;

export interface QuestionFlowOptions {
  /** Restores the separately-approved role-model pair (default: off). */
  includeRoleModel?: boolean;
}

// ---------------------------------------------------------------------------
// Profession templating — spec step 6 requires questions 2, 3 and 4 to be
// "profession-templated" / "keyed to profession" / "profession-customized".
// Classification is a bounded keyword match over the free-text profession, with
// an honest generic fallback; it never guesses beyond these buckets.
// ---------------------------------------------------------------------------

export type ProfessionKind =
  | "sales"
  | "recruiting"
  | "support"
  | "investing"
  | "teaching"
  | "building"
  | "operating";

export function professionKind(profession: string | undefined): ProfessionKind {
  const text = (profession ?? "").toLowerCase();
  if (/(sales|account exec|business development|revenue|quota|seller)/.test(text)) return "sales";
  if (/(recruit|talent|hiring|people ops|\bhr\b|candidate|job search|job hunt)/.test(text)) return "recruiting";
  if (/(support|helpdesk|help desk|customer success|service desk|success manager)/.test(text)) return "support";
  if (/(investor|investing|venture|\bvc\b|private equity|search fund|acquisition|analyst)/.test(text)) return "investing";
  if (/(teach|professor|lecturer|educat|tutor|school|faculty)/.test(text)) return "teaching";
  if (/(engineer|developer|programmer|designer|scientist|architect|researcher)/.test(text)) return "building";
  return "operating";
}

/** Shared closed vocabulary for workday picks — profession templates choose
 * which of these to offer and how to label them, but the VALUES stay stable so
 * `inferDomain` stays deterministic and the saved profile stays comparable. */
type WorkdayValue = "pipeline" | "people" | "requests" | "research" | "planning" | "making" | "admin";

/** Shared closed vocabulary for the adaptive contextual question. Each value
 * maps to exactly one starter column on the generated entity, so this question
 * has a real, visible blueprint effect. */
type ContextValue = "next_step_date" | "owner" | "amount" | "priority";

/** Shared closed vocabulary for "where does most of your work live". Stored in
 * the onboarding profile to plan which sources to offer connecting later
 * (spec's Layer 2). Honest note: it does NOT feed the compiled blueprint. */
type WorkLivesValue =
  | "email"
  | "calendar"
  | "chat"
  | "docs"
  | "crm"
  | "notebook"
  | "in_person"
  | "phone";

interface ProfessionTemplate {
  domain: string;
  /** Word this profession already uses for the thing it tracks, when it
   * differs from the domain's canonical Record label. */
  vocabName?: string;
  workday: { value: WorkdayValue; label: string }[];
  context: {
    prompt: string;
    helpText: string;
    options: { value: ContextValue; label: string }[];
  };
  workLives: { value: WorkLivesValue; label: string }[];
}

/** The subset of BlueprintColumnSpec this onboarding flow ever emits. */
interface StarterField {
  id: string;
  label: string;
  kind: "text" | "number" | "select" | "date";
  options?: string[];
}

const CONTEXT_FIELD: Record<ContextValue, StarterField> = {
  next_step_date: { id: "next_step_date", label: "Next step date", kind: "date" },
  owner: { id: "owner", label: "Owner", kind: "text" },
  amount: { id: "amount", label: "Value", kind: "number" },
  priority: { id: "priority", label: "Priority", kind: "select", options: ["high", "medium", "low"] },
};

const GENERIC_WORK_LIVES: { value: WorkLivesValue; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "calendar", label: "Calendar" },
  { value: "chat", label: "Chat / messaging" },
  { value: "docs", label: "Documents" },
  { value: "notebook", label: "A paper notebook" },
  { value: "in_person", label: "In-person conversations" },
];

const PROFESSION_TEMPLATES: Record<ProfessionKind, ProfessionTemplate> = {
  sales: {
    domain: "sales_deals",
    workday: [
      { value: "pipeline", label: "Moving deals forward" },
      { value: "people", label: "Talking to buyers" },
      { value: "research", label: "Researching accounts" },
      { value: "planning", label: "Forecasting and planning" },
      { value: "admin", label: "Updating the CRM" },
    ],
    context: {
      prompt: "On a live deal, what do you need in front of you first?",
      helpText: "Whichever you pick becomes a starting column on your Deals.",
      options: [
        { value: "next_step_date", label: "The next step and when it's due" },
        { value: "amount", label: "The value on the table" },
        { value: "owner", label: "Who owns it" },
      ],
    },
    workLives: [
      { value: "email", label: "Email" },
      { value: "crm", label: "A CRM" },
      { value: "calendar", label: "Calendar" },
      { value: "chat", label: "Chat / messaging" },
      { value: "phone", label: "Calls" },
      { value: "in_person", label: "In-person meetings" },
    ],
  },
  recruiting: {
    domain: "job_search",
    vocabName: "Candidate",
    workday: [
      { value: "people", label: "Talking to candidates" },
      { value: "pipeline", label: "Moving people through stages" },
      { value: "research", label: "Sourcing and research" },
      { value: "planning", label: "Coordinating interviews" },
      { value: "admin", label: "Writing up notes" },
    ],
    context: {
      prompt: "When you open someone's record, what do you need to see first?",
      helpText: "Whichever you pick becomes a starting column.",
      options: [
        { value: "next_step_date", label: "The next conversation and when" },
        { value: "owner", label: "Who's running the process" },
        { value: "priority", label: "How strong a fit they are" },
      ],
    },
    workLives: [
      { value: "email", label: "Email" },
      { value: "calendar", label: "Calendar" },
      { value: "crm", label: "An ATS or CRM" },
      { value: "chat", label: "Chat / messaging" },
      { value: "docs", label: "Documents" },
      { value: "in_person", label: "In-person interviews" },
    ],
  },
  support: {
    domain: "support",
    vocabName: "Case",
    workday: [
      { value: "requests", label: "Answering incoming requests" },
      { value: "people", label: "Following up with customers" },
      { value: "research", label: "Digging into causes" },
      { value: "planning", label: "Triaging the queue" },
      { value: "admin", label: "Documenting fixes" },
    ],
    context: {
      prompt: "On an open case, what matters most at a glance?",
      helpText: "Whichever you pick becomes a starting column.",
      options: [
        { value: "priority", label: "How urgent it is" },
        { value: "next_step_date", label: "When it's due back" },
        { value: "owner", label: "Who's handling it" },
      ],
    },
    workLives: [
      { value: "email", label: "Email" },
      { value: "chat", label: "Chat / messaging" },
      { value: "docs", label: "A help centre or docs" },
      { value: "crm", label: "A ticketing tool" },
      { value: "phone", label: "Calls" },
      { value: "in_person", label: "In-person conversations" },
    ],
  },
  investing: {
    domain: "sales_deals",
    vocabName: "Opportunity",
    workday: [
      { value: "research", label: "Researching companies and markets" },
      { value: "people", label: "Talking to founders and operators" },
      { value: "pipeline", label: "Working live opportunities" },
      { value: "planning", label: "Diligence and decisions" },
      { value: "admin", label: "Writing memos" },
    ],
    context: {
      prompt: "On an opportunity you're tracking, what do you check first?",
      helpText: "Whichever you pick becomes a starting column.",
      options: [
        { value: "next_step_date", label: "The next step and when it's due" },
        { value: "amount", label: "The size of the opportunity" },
        { value: "priority", label: "How much conviction you have" },
      ],
    },
    workLives: [
      { value: "email", label: "Email" },
      { value: "calendar", label: "Calendar" },
      { value: "docs", label: "Documents and memos" },
      { value: "crm", label: "A pipeline tool" },
      { value: "notebook", label: "A paper notebook" },
      { value: "in_person", label: "In-person meetings" },
    ],
  },
  teaching: {
    domain: "relationships",
    workday: [
      { value: "people", label: "Time with students" },
      { value: "planning", label: "Preparing sessions" },
      { value: "making", label: "Building materials" },
      { value: "requests", label: "Answering questions" },
      { value: "admin", label: "Marking and admin" },
    ],
    context: {
      prompt: "When you look someone up, what do you need to remember?",
      helpText: "Whichever you pick becomes a starting column.",
      options: [
        { value: "next_step_date", label: "When you next see them" },
        { value: "priority", label: "How much support they need" },
        { value: "owner", label: "Which group they're in" },
      ],
    },
    workLives: [
      { value: "email", label: "Email" },
      { value: "calendar", label: "Calendar" },
      { value: "docs", label: "Documents and slides" },
      { value: "chat", label: "Chat / messaging" },
      { value: "notebook", label: "A paper notebook" },
      { value: "in_person", label: "In the room" },
    ],
  },
  building: {
    domain: "relationships",
    workday: [
      { value: "making", label: "Building things" },
      { value: "research", label: "Investigating problems" },
      { value: "people", label: "Working with other people" },
      { value: "planning", label: "Planning what's next" },
      { value: "requests", label: "Responding to requests" },
    ],
    context: {
      prompt: "When something needs picking back up, what tells you where you were?",
      helpText: "Whichever you pick becomes a starting column.",
      options: [
        { value: "next_step_date", label: "The date it's due" },
        { value: "priority", label: "How important it is" },
        { value: "owner", label: "Who else is involved" },
      ],
    },
    workLives: [
      { value: "docs", label: "Documents and code" },
      { value: "chat", label: "Chat / messaging" },
      { value: "email", label: "Email" },
      { value: "calendar", label: "Calendar" },
      { value: "notebook", label: "A paper notebook" },
      { value: "in_person", label: "In-person conversations" },
    ],
  },
  operating: {
    domain: "relationships",
    workday: [
      { value: "people", label: "Time with people" },
      { value: "planning", label: "Planning and prioritising" },
      { value: "requests", label: "Handling incoming requests" },
      { value: "research", label: "Finding things out" },
      { value: "making", label: "Producing work" },
    ],
    context: {
      prompt: "When you come back to something, what do you need to see first?",
      helpText: "Whichever you pick becomes a starting column.",
      options: [
        { value: "next_step_date", label: "When the next step is due" },
        { value: "priority", label: "How important it is" },
        { value: "owner", label: "Who else is involved" },
      ],
    },
    workLives: GENERIC_WORK_LIVES,
  },
};

function templateFor(answers: OnboardingAnswers): ProfessionTemplate {
  return PROFESSION_TEMPLATES[professionKind(answers.profession as string | undefined)];
}

// ---------------------------------------------------------------------------
// The five documented manual questions (+ the separate Avatar step).
// ---------------------------------------------------------------------------

/** Spec step 3 — "Choose your Chief of Staff" — merged with spec step 7's
 * "What would you like to call me?" into one typed answer (E4): the user
 * types a name; `resolveAvatarStyleFromText` looks for one of the 16 real
 * animal styles as a whole word inside it and only then changes the look.
 * Asked first, because the companion is present from launch. */
const Q_AVATAR_STYLE: OnboardingQuestion = {
  id: "avatar_style",
  kind: "text",
  prompt: "What would you like to call your companion?",
  helpText: `Type any name. Mention an animal — ${AVATAR_STYLES.map((o) => o.label).join(", ")} — and that becomes its look; otherwise it keeps its current one.`,
  why: "A name makes the companion feel like yours, not a default.",
  consequence: "What changes: the avatar's name, and its look only if you named one of the animals above. Permissions and communication style never change. You can change either later in Settings.",
  placeholder: "e.g. Luna, or \"Rex the Fox\"",
};

/** E4: matches a real, renderable animal style as a WHOLE WORD inside typed
 * text (case-insensitive). Returns undefined rather than guessing when
 * nothing matches — the caller must then leave the existing/default style
 * alone rather than claim a look Bridge cannot actually render (AP-021). */
export function resolveAvatarStyleFromText(text: string): AvatarStyle | undefined {
  const lower = text.toLowerCase();
  for (const option of AVATAR_STYLES) {
    if (new RegExp(`\\b${option.value}\\b`).test(lower)) return option.value;
  }
  return undefined;
}

/** Manual question 1 — profession + hobbies, captured in one step as the spec
 * lists them. Both live in the single free-text answer; there is no separate
 * structured hobbies field yet. */
const Q_PROFESSION: OnboardingQuestion = {
  id: "profession",
  kind: "text",
  prompt: "What do you do — and what do you do for fun?",
  helpText: "E.g. 'Sales lead at a SaaS startup; I run and cook'. Both parts help; one is enough.",
  why: "Your role keeps Bridge's suggestions relevant, and what you enjoy keeps them human.",
  consequence: "What changes: your answer shapes the next questions and the setup you review. You can correct or delete it later.",
  placeholder: "e.g. Sales lead at a SaaS startup; I run and cook",
};

/** Manual question 2 — up to 3 "what fills your workday" picks. */
function questionWorkday(answers: OnboardingAnswers): OnboardingQuestion {
  return {
    id: "workday",
    kind: "multi_select",
    prompt: "What fills most of your workday?",
    helpText: "Pick up to three.",
    why: "The shape of your day is a better guide than a job title alone.",
    consequence: "What changes: these picks decide what Bridge proposes to organize first. Nothing is created until you approve the preview.",
    options: templateFor(answers).workday,
    maxSelections: 3,
  };
}

/** Manual question 3 — one adaptive contextual question keyed to profession. */
function questionWorkContext(answers: OnboardingAnswers): OnboardingQuestion {
  const template = templateFor(answers);
  return {
    id: "work_context",
    kind: "single_select",
    prompt: template.context.prompt,
    helpText: template.context.helpText,
    why: "One well-chosen column is worth more than a form full of fields you never fill in.",
    consequence: "What changes: this adds one starting column to the setup you review. You can add or remove columns later.",
    options: template.context.options,
  };
}

/** Manual question 4 — "where does most of your work live". */
function questionWorkLives(answers: OnboardingAnswers): OnboardingQuestion {
  return {
    id: "work_lives",
    kind: "multi_select",
    prompt: "Where does most of your work live?",
    helpText: "Digital or not — pick everything that applies.",
    why: "Knowing where your work already lives tells Bridge what would be worth connecting later.",
    consequence: "What changes: this is recorded in your profile only. It connects nothing and grants no access — every connection is a separate, explicit step.",
    options: templateFor(answers).workLives,
  };
}

/** Manual question 5 — "where would you like me to begin" (outcomes). Keeps the
 * `watch_first` id and values because the blueprint compiler already reads
 * them; only the framing changed to the spec's outcome wording. */
const Q_BEGIN: OnboardingQuestion = {
  id: "watch_first",
  kind: "multi_select",
  prompt: "Where would you like me to begin?",
  helpText: "You can change this later — this just seeds your first views.",
  why: "Starting where you actually want help beats starting where a template says to.",
  consequence: "What changes: your first Views reflect these choices. This does not grant permission to act.",
  options: [
    { value: "track_stage", label: "Keep track of where things stand" },
    { value: "surface_signals", label: "Surface what needs a response" },
    { value: "calendar", label: "Keep an eye on what's coming up" },
  ],
};

/** Separately-approved requirement (role-model learning) — gated OUT of the
 * default flow by `QuestionFlowOptions.includeRoleModel`, not deleted. */
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
 * next question to ask, or null when onboarding is complete.
 *
 * Order (E3 2026-08-05):
 *   0. avatar_style   — spec step 3, not one of the five
 *   1. profession (+ hobbies)
 *   2. workday        — up to 3, profession-templated
 *   3. work_context   — adaptive, keyed to profession
 *   4. work_lives     — profession-customized
 *   5. watch_first    — "where would you like me to begin"
 *   (role_model / role_model_why only when includeRoleModel is set)
 */
export function nextQuestion(
  answers: OnboardingAnswers,
  options: QuestionFlowOptions = {},
): OnboardingQuestion | null {
  if (answers.avatar_style === undefined) return Q_AVATAR_STYLE;
  if (answers.profession === undefined) return Q_PROFESSION;
  if (answers.workday === undefined) return questionWorkday(answers);
  if (answers.work_context === undefined) return questionWorkContext(answers);
  if (answers.work_lives === undefined) return questionWorkLives(answers);
  if (answers.watch_first === undefined) return Q_BEGIN;
  if (options.includeRoleModel) {
    if (answers.role_model === undefined) return Q_ROLE_MODEL;
    if (answers.role_model && answers.role_model_why === undefined) return Q_ROLE_MODEL_WHY;
  }
  return null;
}

/** Resolves a static or answers-dependent question definition by id — the
 * single place `nextQuestion` and `nextQuestionGroup` both draw from, so the
 * two can never describe a different question for the same id. */
function questionById(id: string, answers: OnboardingAnswers): OnboardingQuestion {
  switch (id) {
    case "avatar_style": return Q_AVATAR_STYLE;
    case "profession": return Q_PROFESSION;
    case "workday": return questionWorkday(answers);
    case "work_context": return questionWorkContext(answers);
    case "work_lives": return questionWorkLives(answers);
    case "watch_first": return Q_BEGIN;
    case "role_model": return Q_ROLE_MODEL;
    case "role_model_why": return Q_ROLE_MODEL_WHY;
    default: throw new Error(`Unknown onboarding question id: ${id}`);
  }
}

export interface QuestionGroup {
  title: string;
  questions: OnboardingQuestion[];
}

/** E4 ("group them"): the same six ids `nextQuestion` walks one at a time,
 * batched into three topical screens. A group is presented WHOLE — every
 * question on it is shown together — but the group boundary still respects
 * the adaptive graph: group 2/3 questions are only computed (via
 * `questionById`, which reads `answers.profession`) once group 1 is fully
 * committed, so `templateFor(answers)` never sees an unanswered profession. */
const QUESTION_GROUPS: { title: string; ids: string[] }[] = [
  { title: "Your companion", ids: ["avatar_style", "profession"] },
  { title: "Your work", ids: ["workday", "work_context"] },
  { title: "Getting started", ids: ["work_lives", "watch_first"] },
];

/** Group-batched counterpart to `nextQuestion` — same completion semantics
 * (returns null exactly when `nextQuestion`/`isComplete` would), but returns
 * every question on the next incomplete SCREEN rather than one question. */
export function nextQuestionGroup(
  answers: OnboardingAnswers,
  options: QuestionFlowOptions = {},
): QuestionGroup | null {
  for (const group of QUESTION_GROUPS) {
    if (group.ids.some((id) => answers[id] === undefined)) {
      return { title: group.title, questions: group.ids.map((id) => questionById(id, answers)) };
    }
  }
  if (options.includeRoleModel) {
    if (answers.role_model === undefined) return { title: "One more thing", questions: [Q_ROLE_MODEL] };
    if (answers.role_model && answers.role_model_why === undefined) {
      return { title: "One more thing", questions: [Q_ROLE_MODEL_WHY] };
    }
  }
  return null;
}

/** Denominator for the setup-progress indicator: the Avatar step plus the five
 * documented manual questions. */
export const MAX_QUESTIONS = 6;

/** Number of completed answers used by the real setup-progress indicator. */
export function answeredCount(answers: OnboardingAnswers): number {
  return Object.values(answers).filter((v) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .length;
}

/**
 * Derives a default organization name from an email address per spec-organization-naming.md:
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
export function organizationNameFromEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return `${toTitleCase(local ?? 'My')}'s Organization`;
  const genericDomains = ['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'me', 'mac', 'proton', 'protonmail'];
  const domainBase = domain.split('.')[0] ?? '';
  if (genericDomains.includes(domainBase.toLowerCase())) {
    return `${toTitleCase(local ?? 'My')}'s Organization`;
  }
  return toTitleCase(domainBase);
}

/** DEFAULTED (E3): the Organization name is no longer asked. It comes from the
 * signed-in email, falling back to a neutral name when no email is available.
 * Renaming stays available on the Organization page. */
export function defaultOrganizationName(email?: string): string {
  const derived = email ? organizationNameFromEmail(email).trim() : "";
  return derived || "My Organization";
}

function toTitleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Node type + starter fields per domain — the entities a fresh organization
 * starts with. Kept to kernel-registered node types only (compileBlueprint
 * rejects anything else) — vocabulary overrides (not new node types) are how
 * a domain's own naming shows through. */
// Display labels use the domain's canonical Record name while legacy nodeType
// identifiers remain time-boxed under VOCAB2.
const DOMAIN_ENTITY: Record<string, { nodeType: string; label: string }> = {
  sales_deals: { nodeType: "record", label: "Deal" },
  job_search: { nodeType: "record", label: "Application" },
  support: { nodeType: "event", label: "Support Event" },
  relationships: { nodeType: "person", label: "Person" },
};

/** DERIVED (E3): the "what kind of work" question is no longer asked. The
 * domain comes from the profession bucket, with the workday picks able to
 * override a generic classification. An explicit `domain` answer still wins. */
export function inferDomain(answers: OnboardingAnswers): string {
  const explicit = answers.domain as string | undefined;
  if (explicit && DOMAIN_ENTITY[explicit]) return explicit;
  const template = templateFor(answers);
  const workday = (answers.workday as string[] | undefined) ?? [];
  if (template.domain === "relationships") {
    if (workday.includes("requests")) return "support";
    if (workday.includes("pipeline")) return "sales_deals";
  }
  return template.domain;
}

/** DERIVED (E3): the "what do you call it" question is no longer asked. The
 * profession template supplies the word when it differs from the domain's
 * canonical Record label. An explicit `vocab_name` answer still wins. */
export function derivedVocabName(answers: OnboardingAnswers): string | undefined {
  const explicit = (answers.vocab_name as string | undefined)?.trim();
  if (explicit) return explicit;
  return templateFor(answers).vocabName;
}

/** DERIVED (E3): the "list or board" question is no longer asked. Pipeline-
 * shaped work (or explicitly asking Bridge to track where things stand) starts
 * on a board; everything else starts as a list. An explicit `view_style`
 * answer still wins, and the View can be switched at any time. */
export function derivedViewStyle(answers: OnboardingAnswers): "table" | "board" {
  const explicit = answers.view_style as string | undefined;
  if (explicit === "board" || explicit === "kanban") return "board";
  if (explicit === "table") return "table";
  const domain = inferDomain(answers);
  const watchFirst = (answers.watch_first as string[] | undefined) ?? [];
  const workday = (answers.workday as string[] | undefined) ?? [];
  if (domain === "sales_deals" || domain === "job_search") return "board";
  if (watchFirst.includes("track_stage") || workday.includes("pipeline")) return "board";
  return "table";
}

/**
 * Compile the collected answers into a `OrganizationBlueprint` — the exact shape
 * `organization.blueprint.propose` accepts (packages/core/src/blueprint.ts). Pure
 * function, no I/O; the caller (OnboardingDialog) is responsible for calling
 * compileBlueprint() to preview it and organization.blueprint.propose to submit
 * it as a governed draft.
 */
export function buildBlueprintFromAnswers(answers: OnboardingAnswers): OrganizationBlueprint {
  const domain = inferDomain(answers);
  const entityDef = DOMAIN_ENTITY[domain] ?? DOMAIN_ENTITY.relationships!;
  const watchFirst = (answers.watch_first as string[] | undefined) ?? [];
  const viewStyle = derivedViewStyle(answers);
  const vocabName = derivedVocabName(answers);
  const workContext = answers.work_context as ContextValue | undefined;

  const wantsCalendar = watchFirst.includes("calendar");
  const wantsSignals = watchFirst.includes("surface_signals");

  const fields: StarterField[] = [
    { id: "name", label: "Name", kind: "text" as const },
    ...(watchFirst.includes("track_stage") || viewStyle === "board"
      ? [{ id: "stage", label: "Stage", kind: "select" as const, options: ["new", "active", "closed"] }]
      : []),
    // "Keep an eye on what's coming up" (watch_first: "calendar") was collected
    // but never read — see docs/BUGS.md "onboarding drops watch_first: calendar
    // answer". A calendar VIEW needs a date column to group by (CalendarView.tsx
    // falls back to "no date column" otherwise), so this adds one whenever the
    // user asked for it.
    ...(wantsCalendar ? [{ id: "next_step_date", label: "Next step date", kind: "date" as const }] : []),
  ];

  // The adaptive contextual answer (manual question 3) adds exactly one starter
  // column, skipped when an earlier rule already produced a column with that id.
  if (workContext && CONTEXT_FIELD[workContext]) {
    const spec = CONTEXT_FIELD[workContext];
    if (!fields.some((field) => field.id === spec.id)) {
      fields.push({
        id: spec.id,
        label: spec.label,
        kind: spec.kind,
        ...(spec.options ? { options: spec.options } : {}),
      });
    }
  }

  const vocabulary: Record<string, string> = {};
  if (vocabName && vocabName !== entityDef.label) {
    vocabulary[entityDef.label] = vocabName;
  }

  return {
    vocabulary,
    entities: [
      { nodeType: entityDef.nodeType, label: entityDef.label, fields },
      ...(wantsSignals && entityDef.nodeType !== "event"
        ? [{
            nodeType: "event",
            label: "Signal Event",
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
        // When the generated entity has a stage field and the derived view
        // style is Board, group by it so the board renders grouped instead of
        // one flat unlabeled column. Lives under `config.groupBy`, per
        // blueprint.ts's BlueprintViewSpec shape (mirrors CompiledViewConfig).
        ...(viewStyle === "board"
          ? { config: { groupBy: "stage" } }
          : {}),
      },
      ...(wantsCalendar ? [{ entity: entityDef.nodeType, kind: "calendar" as const }] : []),
      ...(wantsSignals && entityDef.nodeType !== "event"
        ? [{ entity: "event", kind: "table" as const }]
        : []),
    ],
    capabilities: [],
  };
}

/** True once `nextQuestion` would return null — used by the dialog to know
 * when to show the compiled preview instead of another question. */
export function isComplete(answers: OnboardingAnswers, options: QuestionFlowOptions = {}): boolean {
  return nextQuestion(answers, options) === null;
}
