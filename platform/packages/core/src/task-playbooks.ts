// =====================================================================
// Task Manager methodology Playbooks, and the four model-backed planning
// Skills that consume them.
//
// The TM3 slice promised two things that were never built. `TASK_MANAGER_
// PLAYBOOKS` was an id/version/owner list with no content and no consumer —
// five names for five methodologies nobody had written down. And four Skill
// ids (`goal-outcome-framing`, `candidate-task-generation`,
// `premortem-scenario`, `task-decomposition`) were registered as
// `SkillManifest`s whose `run()` echoed its inputs. The two gaps are one gap:
// the plan calls these Skills "methodology-parameterized", so there was
// nothing to parameterize them WITH. This module closes both — the Playbooks
// carry real content, and these Skills are their only consumer.
//
// Model-backed on purpose, unlike `task-planning.ts`. Reconciliation and
// sequencing run on EVERY Task create and must show the reviewer the exact
// terms behind a finding, so they are deterministic (ADR-183/ADR-177). These
// four are the opposite shape: they are invoked deliberately, they generate
// prose a human will read and edit, and there is no deterministic function
// that writes a useful pre-mortem. So they take a model when one is
// configured.
//
// What happens with NO model configured is the load-bearing decision. They do
// NOT fabricate, and they do NOT return an empty result that reads like "the
// methodology found nothing". They return the Playbook's own questions with
// `source: "playbook_scaffold"`, every item list empty, and a `note` saying
// why. The questions are real content the methodology genuinely supplies; the
// ANSWERS are the model's job, and their absence is stated rather than
// papered over. The same degrade catches a model that returns unparseable or
// malformed output — mirroring `classifyIntent`'s "degrading to clarify
// rather than inventing a route" (chief-of-staff.ts).
//
// Everything here PROPOSES. Nothing writes: generated children carry a path
// this module computes (never one the model chose), generated options carry
// `status: "candidate"`, and outcomes carry no `id` — identity and placement
// are assigned on materialize by the pipeline, not by a model.
//
// IP: the techniques below are public-domain planning concepts, named as
// techniques and written from scratch. Two of them are commonly associated
// with trademarked book brands; those brands are deliberately not used as
// names here and none of their text is reproduced (plan §7 IP note).
// =====================================================================

import {
  assertModelOutputTaint,
  createModelCallReceipt,
  type ModelCallReceipt,
  type ModelCompletionRequest,
  type ModelProvider,
} from "./ports.js";
import type { TaskIndicatorKind } from "./task-manager.js";

export type TaskPlanningSkillId =
  | "goal-outcome-framing"
  | "candidate-task-generation"
  | "premortem-scenario"
  | "task-decomposition";

export interface TaskPlaybook {
  id: string;
  version: string;
  ownerAgent: string;
  /** The technique, named as a technique. */
  methodology: string;
  /** What running this Playbook is FOR, shown on the review card. */
  intent: string;
  /** Which planning Skills may run under this Playbook. A Skill invoked with a
   * Playbook that does not list it is refused rather than silently retargeted. */
  skills: readonly TaskPlanningSkillId[];
  /** The questions the technique asks. Returned verbatim in scaffold mode, so
   * these must stand on their own as useful prompts to a human. */
  prompts: readonly string[];
  /** Appended to the Skill's system prompt when a model IS available. */
  guidance: string;
}

export const TASK_PLAYBOOKS: readonly TaskPlaybook[] = [
  {
    id: "outcome-key-results",
    version: "1.0.0",
    ownerAgent: "internal-strategist",
    methodology: "One stated objective, carried by a few measurable results",
    intent:
      "Turn a Task's title into a plainly-stated objective plus the two to four measurements that would move if it succeeded.",
    skills: ["goal-outcome-framing"],
    prompts: [
      "State what is true when this is finished, in one sentence and in your own words.",
      "Which two to four measurements would move if that happened?",
      "For each measurement: where does it stand now, and where must it stand to count as done?",
      "Which single measurement is the north star — the one you would keep if you had to drop the rest?",
      "Which of these move within days (leading), and which only move much later (lagging)?",
    ],
    guidance:
      "Each result needs a measure and a target a stranger could check without asking the author. Prefer a number or a dated state over an adjective. Mark exactly one result as the north star, and only when the set genuinely has a centre. Never invent a baseline that was not supplied — leave the target as the stated aim and say the current value is unknown.",
  },
  {
    id: "backward-planning",
    version: "1.0.0",
    ownerAgent: "internal-strategist",
    methodology: "Work backward from the finished state to the first startable step",
    intent:
      "Derive the chain of preconditions between where the work is now and the state that counts as finished.",
    skills: ["task-decomposition", "candidate-task-generation"],
    prompts: [
      "Describe the finished state as though it already happened.",
      "What had to be true immediately before that?",
      "Keep asking that question until you reach something that could start this week.",
      "Which of those steps is the first one nobody is waiting on?",
    ],
    guidance:
      "Order steps by what each one depends on, not by how obvious they are. Each step needs its own exit test — the fastest honest way to show it did not work. A step nobody could start this week is still too large and should be split rather than listed.",
  },
  {
    id: "clarify-organize",
    version: "1.0.0",
    ownerAgent: "internal-strategist",
    methodology: "Clarify each item down to a single next action",
    intent:
      "Reduce a vague or multi-part item to the specific next physical action, or decide it does not belong in the queue.",
    skills: ["task-decomposition", "candidate-task-generation"],
    prompts: [
      "Is this one action or several? If several, it is not a Task yet.",
      "What is the very next physical action — the thing you would do if you sat down right now?",
      "Who else has to move before this can?",
      "If it is not actionable at all, is it reference, later, or should it leave the queue?",
    ],
    guidance:
      "A good next action names a verb and an object and could be done in one sitting. Reject titles that describe a topic rather than an action. If an item is genuinely not actionable, say so instead of splitting it into busywork.",
  },
  {
    id: "measurable-review",
    version: "1.0.0",
    ownerAgent: "internal-strategist",
    methodology: "Sharpen a stated aim until it is checkable, dated, and reviewable",
    intent:
      "Take a loosely-worded aim and make it something a reviewer could mark true or false on a specific date.",
    skills: ["goal-outcome-framing"],
    prompts: [
      "Restate this so a stranger could tell whether it happened.",
      "By when? A date, not 'soon'.",
      "What evidence would you show?",
      "Is this within your control, or does it depend on a decision someone else makes?",
      "When will you review it, and what would make you change it?",
    ],
    guidance:
      "Prefer a checkable claim over an ambitious one. If the aim depends on someone else's decision, say so in the result rather than writing a target the author cannot move. Do not invent dates that were not supplied — name the missing date as missing.",
  },
  {
    id: "pre-mortem",
    version: "1.0.0",
    ownerAgent: "internal-strategist",
    methodology: "Assume it already failed, then explain why",
    intent:
      "Surface the failure causes worth mitigating now, while changing course is still cheap.",
    skills: ["premortem-scenario"],
    prompts: [
      "It is the end of the horizon and this failed. What is the story of how?",
      "Which of those causes were visible early, and what was the very first sign?",
      "Which cause would you not have seen coming, and what would make it visible sooner?",
      "For each cause: what would you do differently, starting now?",
    ],
    guidance:
      "Write causes as things that happened, not as risks that might. Every cause needs an early signal someone could actually notice and a mitigation someone could actually start. Skip the generic risks that would apply to any work at all; name what is specific to this one.",
  },
];

const PLAYBOOK_BY_ID = new Map(TASK_PLAYBOOKS.map((playbook) => [playbook.id, playbook]));

/** The Playbook a Skill runs under when the caller does not name one. Every
 * Skill has exactly one so an unparameterized invocation is still governed by
 * a named, versioned methodology rather than by an implicit prompt. */
const DEFAULT_PLAYBOOK_BY_SKILL: Readonly<Record<TaskPlanningSkillId, string>> = {
  "goal-outcome-framing": "outcome-key-results",
  "candidate-task-generation": "backward-planning",
  "premortem-scenario": "pre-mortem",
  "task-decomposition": "backward-planning",
};

/**
 * Resolve the Playbook a Skill will run under.
 *
 * A Playbook that does not list the Skill is REFUSED rather than quietly
 * swapped for the default: a caller that asked for a pre-mortem framing of a
 * decomposition has a bug, and silently answering a different question would
 * hide it.
 */
export function resolveTaskPlaybook(skillId: TaskPlanningSkillId, playbookId?: string): TaskPlaybook {
  const requested = playbookId ?? DEFAULT_PLAYBOOK_BY_SKILL[skillId];
  const playbook = PLAYBOOK_BY_ID.get(requested);
  if (!playbook) {
    throw new Error(`task playbook: "${requested}" is not a registered Playbook`);
  }
  if (!playbook.skills.includes(skillId)) {
    throw new Error(`task playbook: "${playbook.id}" does not support ${skillId}`);
  }
  return playbook;
}

// ---------------------------------------------------------------------
// Bounds. A model that returns 200 child Tasks is not more helpful than one
// that returns 7 — it is a review surface nobody reads, so the caps are part
// of the contract rather than a defensive afterthought.
// ---------------------------------------------------------------------
const MAX_DRAFT_OUTCOMES = 5;
const MAX_DRAFT_CANDIDATES = 7;
const MAX_DRAFT_FAILURE_MODES = 7;
const MAX_DRAFT_CHILDREN = 9;
const MAX_DRAFT_LIST_ITEMS = 6;
const MAX_DRAFT_TITLE_CHARS = 160;
const MAX_DRAFT_TEXT_CHARS = 1_000;

/** Planning output is read and acted on by a human, so it runs on the
 * reasoning tier. The cheap tier's failure mode here is a plausible, shallow
 * plan — strictly worse than the honest scaffold, because it looks like work. */
const PLANNING_MODEL_TIER = "reasoning" as const;

export type PlanningResultSource = "model" | "playbook_scaffold";

export interface PlanningSkillEnvelope {
  playbookId: string;
  playbookVersion: string;
  methodology: string;
  source: PlanningResultSource;
  /** The technique's questions. Always present — with a model they explain
   * what shaped the draft; without one they ARE the deliverable. */
  prompts: readonly string[];
  /** Set only when `source` is "playbook_scaffold": why nothing was drafted.
   * Never a substitute for the content itself. */
  note?: string;
  modelReceipt?: ModelCallReceipt;
}

/** A proposed outcome. Carries no `id`: identity is assigned on materialize,
 * never by a model. */
export interface DraftTaskOutcome {
  title: string;
  measure: string;
  target: string;
  indicatorKind: TaskIndicatorKind;
  northStar: boolean;
}

export interface DraftCandidateTask {
  title: string;
  rationale: string;
  stakeholders: readonly string[];
  dependencies: readonly string[];
  risks: readonly string[];
  /** Always "candidate" — the status the plan reserves for a generated option
   * no Human has committed to. Fixed here, never model-chosen. */
  status: "candidate";
}

export interface DraftFailureMode {
  cause: string;
  earlySignal: string;
  mitigation: string;
}

export interface DraftChildTask {
  title: string;
  exitTest: string;
  /** Computed from the parent path and position by `nextChildPaths` — a model
   * never authors a dot-path, because the path is what the queue's identity
   * and ordering are built on. */
  path: string;
  level: number;
  rationale: string;
}

export interface GoalOutcomeFraming extends PlanningSkillEnvelope {
  kind: "goal_outcome_framing";
  outcomes: readonly DraftTaskOutcome[];
  /** `null` means "not assessed" — the scaffold path does not guess, and
   * `false` would read as a considered answer. */
  isGoalProposed: boolean | null;
  reason: string;
}

export interface CandidateTaskGeneration extends PlanningSkillEnvelope {
  kind: "candidate_task_generation";
  candidates: readonly DraftCandidateTask[];
}

export interface PremortemScenario extends PlanningSkillEnvelope {
  kind: "premortem_scenario";
  horizon: string;
  failureModes: readonly DraftFailureMode[];
}

export interface TaskDecomposition extends PlanningSkillEnvelope {
  kind: "task_decomposition";
  parentPath: string;
  children: readonly DraftChildTask[];
}

// ---------------------------------------------------------------------
// Strict parsing. A constrained-output request is a hint to the provider, not
// authority (ports.ts says so explicitly), so everything is re-validated here.
// ---------------------------------------------------------------------

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function boundedList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    const text = boundedText(entry, MAX_DRAFT_TITLE_CHARS);
    if (text) items.push(text);
    if (items.length >= MAX_DRAFT_LIST_ITEMS) break;
  }
  return items;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Parse the completion text into an object.
 *
 * The direct parse is tried first. The slice fallback exists because local
 * models routinely wrap valid JSON in a sentence or a code fence even when a
 * schema was bound; taking the outermost brace pair recovers those without
 * ever loosening what counts as VALID — the recovered text still has to parse
 * and still has to survive every field check below.
 */
function parsePlanningJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const attempt = (candidate: string): Record<string, unknown> | null => {
    try {
      return asRecord(JSON.parse(candidate));
    } catch {
      return null;
    }
  };
  const direct = attempt(trimmed);
  if (direct) return direct;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return attempt(trimmed.slice(start, end + 1));
}

function scaffoldEnvelope(playbook: TaskPlaybook, note: string): PlanningSkillEnvelope {
  return {
    playbookId: playbook.id,
    playbookVersion: playbook.version,
    methodology: playbook.methodology,
    source: "playbook_scaffold",
    prompts: playbook.prompts,
    note,
  };
}

function modelEnvelope(playbook: TaskPlaybook, receipt: ModelCallReceipt): PlanningSkillEnvelope {
  return {
    playbookId: playbook.id,
    playbookVersion: playbook.version,
    methodology: playbook.methodology,
    source: "model",
    prompts: playbook.prompts,
    modelReceipt: receipt,
  };
}

const NO_MODEL_NOTE =
  "No model is configured on the Local Plane, so this Playbook returned its questions instead of a draft. Nothing below was generated.";
const UNUSABLE_OUTPUT_NOTE =
  "The model's response did not match the required shape, so this Playbook returned its questions rather than guessing at one.";

function systemPrompt(playbook: TaskPlaybook, task: string, shape: string): string {
  return [
    `You are Internal Strategist running the "${playbook.methodology}" Playbook.`,
    playbook.intent,
    "",
    "The technique asks:",
    ...playbook.prompts.map((prompt) => `- ${prompt}`),
    "",
    playbook.guidance,
    "",
    `Your job: ${task}`,
    `Reply with one JSON object and nothing else. ${shape}`,
    "Never invent facts that were not supplied. If the input is too thin to answer honestly, return an empty array rather than filling it.",
  ].join("\n");
}

interface PlanningCallResult {
  value: Record<string, unknown>;
  receipt: ModelCallReceipt;
}

async function completePlanningJson(args: {
  model: ModelProvider;
  system: string;
  prompt: string;
  schemaName: string;
  schema: Readonly<Record<string, unknown>>;
  maxTokens: number;
  signal?: AbortSignal | undefined;
}): Promise<PlanningCallResult | null> {
  const request: ModelCompletionRequest = {
    system: args.system,
    prompt: args.prompt,
    maxTokens: args.maxTokens,
    tier: PLANNING_MODEL_TIER,
    cache: { strategy: "stable_system_prefix", ttl: "5m" },
    responseFormat: {
      type: "json_schema",
      name: args.schemaName,
      schema: args.schema,
      strict: true,
    },
    ...(args.signal ? { signal: args.signal } : {}),
  };
  const completion = await args.model.complete(request);
  assertModelOutputTaint(request, completion);
  const value = parsePlanningJson(completion.text);
  if (!value) return null;
  return { value, receipt: createModelCallReceipt(args.model, completion, PLANNING_MODEL_TIER) };
}

const STRING_ARRAY_SCHEMA = {
  type: "array",
  maxItems: MAX_DRAFT_LIST_ITEMS,
  items: { type: "string", maxLength: MAX_DRAFT_TITLE_CHARS },
} as const;

// ---------------------------------------------------------------------
// goal-outcome-framing
// ---------------------------------------------------------------------

export interface FrameGoalOutcomesInput {
  title: string;
  exitTest?: string | undefined;
  /** Existing outcomes, so the Skill proposes what is MISSING rather than
   * restating what the Task already carries. */
  existingOutcomes?: readonly { title: string; measure: string; target: string }[] | undefined;
  playbookId?: string | undefined;
  model?: ModelProvider | undefined;
  signal?: AbortSignal | undefined;
}

const GOAL_OUTCOME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcomes", "isGoal", "reason"],
  properties: {
    outcomes: {
      type: "array",
      maxItems: MAX_DRAFT_OUTCOMES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "measure", "target", "indicatorKind", "northStar"],
        properties: {
          title: { type: "string", maxLength: MAX_DRAFT_TITLE_CHARS },
          measure: { type: "string", maxLength: MAX_DRAFT_TEXT_CHARS },
          target: { type: "string", maxLength: MAX_DRAFT_TEXT_CHARS },
          indicatorKind: { enum: ["leading", "lagging"] },
          northStar: { type: "boolean" },
        },
      },
    },
    isGoal: { type: "boolean" },
    reason: { type: "string", maxLength: MAX_DRAFT_TEXT_CHARS },
  },
} as const;

function parseDraftOutcomes(value: unknown): readonly DraftTaskOutcome[] {
  if (!Array.isArray(value)) return [];
  const outcomes: DraftTaskOutcome[] = [];
  let northStarTaken = false;
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const title = boundedText(record["title"], MAX_DRAFT_TITLE_CHARS);
    const measure = boundedText(record["measure"], MAX_DRAFT_TEXT_CHARS);
    const target = boundedText(record["target"], MAX_DRAFT_TEXT_CHARS);
    // A result without a measure and a target is exactly what this Playbook
    // exists to prevent, so an unmeasurable entry is dropped, not softened.
    if (!title || !measure || !target) continue;
    const indicatorKind: TaskIndicatorKind = record["indicatorKind"] === "leading" ? "leading" : "lagging";
    // At most ONE north star, whatever the model claims — the Playbook's own
    // rule, enforced here rather than hoped for in the prompt.
    const northStar = record["northStar"] === true && !northStarTaken;
    if (northStar) northStarTaken = true;
    outcomes.push({ title, measure, target, indicatorKind, northStar });
    if (outcomes.length >= MAX_DRAFT_OUTCOMES) break;
  }
  return outcomes;
}

export async function frameGoalOutcomes(input: FrameGoalOutcomesInput): Promise<GoalOutcomeFraming> {
  const playbook = resolveTaskPlaybook("goal-outcome-framing", input.playbookId);
  const scaffold = (note: string): GoalOutcomeFraming => ({
    kind: "goal_outcome_framing",
    ...scaffoldEnvelope(playbook, note),
    outcomes: [],
    isGoalProposed: null,
    reason: "",
  });
  if (!input.model) return scaffold(NO_MODEL_NOTE);

  const existing = (input.existingOutcomes ?? [])
    .map((outcome) => `- ${outcome.title} (measure: ${outcome.measure}; target: ${outcome.target})`)
    .join("\n");
  const result = await completePlanningJson({
    model: input.model,
    system: systemPrompt(
      playbook,
      "frame this Task's outcomes and say whether it reads as a standing goal rather than a finishable Task.",
      "Keys: outcomes (each with title, measure, target, indicatorKind of leading|lagging, northStar boolean), isGoal, reason.",
    ),
    prompt: [
      `Task: ${input.title}`,
      input.exitTest ? `Exit test: ${input.exitTest}` : "Exit test: not stated.",
      existing ? `Outcomes it already carries:\n${existing}` : "It carries no outcomes yet.",
    ].join("\n"),
    schemaName: "goal_outcome_framing",
    schema: GOAL_OUTCOME_SCHEMA,
    maxTokens: 1_024,
    signal: input.signal,
  });
  if (!result) return scaffold(UNUSABLE_OUTPUT_NOTE);

  const outcomes = parseDraftOutcomes(result.value["outcomes"]);
  if (outcomes.length === 0) return scaffold(UNUSABLE_OUTPUT_NOTE);
  return {
    kind: "goal_outcome_framing",
    ...modelEnvelope(playbook, result.receipt),
    outcomes,
    isGoalProposed: result.value["isGoal"] === true,
    reason: boundedText(result.value["reason"], MAX_DRAFT_TEXT_CHARS) ?? "",
  };
}

// ---------------------------------------------------------------------
// candidate-task-generation
// ---------------------------------------------------------------------

export interface GenerateCandidateTasksInput {
  parentTitle: string;
  parentOutcomes?: readonly { title: string; measure: string; target: string }[] | undefined;
  parentExitTest?: string | undefined;
  /** Titles already under this parent, so the Skill proposes additions rather
   * than restating work that is already queued. */
  existingChildTitles?: readonly string[] | undefined;
  playbookId?: string | undefined;
  model?: ModelProvider | undefined;
  signal?: AbortSignal | undefined;
}

const CANDIDATE_TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      maxItems: MAX_DRAFT_CANDIDATES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "stakeholders", "dependencies", "risks"],
        properties: {
          title: { type: "string", maxLength: MAX_DRAFT_TITLE_CHARS },
          rationale: { type: "string", maxLength: MAX_DRAFT_TEXT_CHARS },
          stakeholders: STRING_ARRAY_SCHEMA,
          dependencies: STRING_ARRAY_SCHEMA,
          risks: STRING_ARRAY_SCHEMA,
        },
      },
    },
  },
} as const;

export async function generateCandidateTasks(
  input: GenerateCandidateTasksInput,
): Promise<CandidateTaskGeneration> {
  const playbook = resolveTaskPlaybook("candidate-task-generation", input.playbookId);
  const scaffold = (note: string): CandidateTaskGeneration => ({
    kind: "candidate_task_generation",
    ...scaffoldEnvelope(playbook, note),
    candidates: [],
  });
  if (!input.model) return scaffold(NO_MODEL_NOTE);

  const result = await completePlanningJson({
    model: input.model,
    system: systemPrompt(
      playbook,
      "propose the candidate Tasks worth considering under this parent, each with who is involved, what it waits on, and what could go wrong.",
      "Keys: candidates (each with title, rationale, stakeholders, dependencies, risks).",
    ),
    prompt: [
      `Parent Task: ${input.parentTitle}`,
      (input.parentOutcomes ?? []).length > 0
        ? `Its outcomes:\n${(input.parentOutcomes ?? [])
            .map((outcome) => `- ${outcome.title} (measure: ${outcome.measure}; target: ${outcome.target})`)
            .join("\n")}`
        : "It carries no outcomes yet.",
      input.parentExitTest ? `Exit test: ${input.parentExitTest}` : "Exit test: not stated.",
      (input.existingChildTitles ?? []).length > 0
        ? `Already queued beneath it (do not repeat these):\n${(input.existingChildTitles ?? [])
            .map((title) => `- ${title}`)
            .join("\n")}`
        : "Nothing is queued beneath it yet.",
    ].join("\n"),
    schemaName: "candidate_task_generation",
    schema: CANDIDATE_TASK_SCHEMA,
    maxTokens: 2_048,
    signal: input.signal,
  });
  if (!result) return scaffold(UNUSABLE_OUTPUT_NOTE);

  const raw = result.value["candidates"];
  const candidates: DraftCandidateTask[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const record = asRecord(entry);
      if (!record) continue;
      const title = boundedText(record["title"], MAX_DRAFT_TITLE_CHARS);
      const rationale = boundedText(record["rationale"], MAX_DRAFT_TEXT_CHARS);
      // A candidate nobody can explain is noise on a review card.
      if (!title || !rationale) continue;
      candidates.push({
        title,
        rationale,
        stakeholders: boundedList(record["stakeholders"]),
        dependencies: boundedList(record["dependencies"]),
        risks: boundedList(record["risks"]),
        status: "candidate",
      });
      if (candidates.length >= MAX_DRAFT_CANDIDATES) break;
    }
  }
  if (candidates.length === 0) return scaffold(UNUSABLE_OUTPUT_NOTE);
  return { kind: "candidate_task_generation", ...modelEnvelope(playbook, result.receipt), candidates };
}

// ---------------------------------------------------------------------
// premortem-scenario
// ---------------------------------------------------------------------

export interface RunPremortemInput {
  title: string;
  outcomes?: readonly { title: string; measure: string; target: string }[] | undefined;
  exitTest?: string | undefined;
  /** How far out to assume the failure happened. Free text so a caller can say
   * "by the end of the quarter" as easily as "in six weeks". */
  horizon?: string | undefined;
  playbookId?: string | undefined;
  model?: ModelProvider | undefined;
  signal?: AbortSignal | undefined;
}

const DEFAULT_PREMORTEM_HORIZON = "the end of this Task's expected timeline";

const PREMORTEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["failureModes"],
  properties: {
    failureModes: {
      type: "array",
      maxItems: MAX_DRAFT_FAILURE_MODES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["cause", "earlySignal", "mitigation"],
        properties: {
          cause: { type: "string", maxLength: MAX_DRAFT_TEXT_CHARS },
          earlySignal: { type: "string", maxLength: MAX_DRAFT_TEXT_CHARS },
          mitigation: { type: "string", maxLength: MAX_DRAFT_TEXT_CHARS },
        },
      },
    },
  },
} as const;

export async function runPremortem(input: RunPremortemInput): Promise<PremortemScenario> {
  const playbook = resolveTaskPlaybook("premortem-scenario", input.playbookId);
  const horizon = boundedText(input.horizon, MAX_DRAFT_TITLE_CHARS) ?? DEFAULT_PREMORTEM_HORIZON;
  const scaffold = (note: string): PremortemScenario => ({
    kind: "premortem_scenario",
    ...scaffoldEnvelope(playbook, note),
    horizon,
    failureModes: [],
  });
  if (!input.model) return scaffold(NO_MODEL_NOTE);

  const result = await completePlanningJson({
    model: input.model,
    system: systemPrompt(
      playbook,
      "assume this Task has already failed and explain the causes, the first sign of each, and what to do now.",
      "Keys: failureModes (each with cause, earlySignal, mitigation).",
    ),
    prompt: [
      `Task: ${input.title}`,
      (input.outcomes ?? []).length > 0
        ? `Its outcomes:\n${(input.outcomes ?? [])
            .map((outcome) => `- ${outcome.title} (measure: ${outcome.measure}; target: ${outcome.target})`)
            .join("\n")}`
        : "It carries no outcomes yet.",
      input.exitTest ? `Exit test: ${input.exitTest}` : "Exit test: not stated.",
      `Assume the failure is visible by ${horizon}.`,
    ].join("\n"),
    schemaName: "premortem_scenario",
    schema: PREMORTEM_SCHEMA,
    maxTokens: 2_048,
    signal: input.signal,
  });
  if (!result) return scaffold(UNUSABLE_OUTPUT_NOTE);

  const raw = result.value["failureModes"];
  const failureModes: DraftFailureMode[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const record = asRecord(entry);
      if (!record) continue;
      const cause = boundedText(record["cause"], MAX_DRAFT_TEXT_CHARS);
      const earlySignal = boundedText(record["earlySignal"], MAX_DRAFT_TEXT_CHARS);
      const mitigation = boundedText(record["mitigation"], MAX_DRAFT_TEXT_CHARS);
      // A cause with no signal and no mitigation is a worry, not a finding —
      // the Playbook's whole point is that each one is actionable now.
      if (!cause || !earlySignal || !mitigation) continue;
      failureModes.push({ cause, earlySignal, mitigation });
      if (failureModes.length >= MAX_DRAFT_FAILURE_MODES) break;
    }
  }
  if (failureModes.length === 0) return scaffold(UNUSABLE_OUTPUT_NOTE);
  return { kind: "premortem_scenario", ...modelEnvelope(playbook, result.receipt), horizon, failureModes };
}

// ---------------------------------------------------------------------
// task-decomposition
// ---------------------------------------------------------------------

/**
 * The next `count` child dot-paths under `parentPath`, continuing after the
 * highest sibling index already taken.
 *
 * Deliberately not model territory. The dot-path is the queue's identity and
 * ordering, `compareTaskPaths` sorts on it, and restructuring recomputes it
 * atomically over a subtree — a model that invented "2.3.5" could collide with
 * a live Task or silently reorder the queue. So the model proposes titles and
 * exit tests; the position is arithmetic.
 */
export function nextChildPaths(
  parentPath: string,
  existingChildPaths: readonly string[],
  count: number,
): readonly string[] {
  const trimmed = parentPath.trim();
  if (trimmed.length === 0) throw new Error("task decomposition: parentPath is required to place children");
  const prefix = `${trimmed}.`;
  let highest = 0;
  for (const child of existingChildPaths) {
    if (!child.startsWith(prefix)) continue;
    const tail = child.slice(prefix.length);
    // Only DIRECT children set the next index; a grandchild's deeper segments
    // say nothing about how many siblings this level already has.
    if (tail.includes(".")) continue;
    const index = Number(tail);
    if (Number.isSafeInteger(index) && index > highest) highest = index;
  }
  return Array.from({ length: count }, (_, offset) => `${trimmed}.${highest + offset + 1}`);
}

export interface DecomposeTaskInput {
  title: string;
  /** Required: children cannot be placed without knowing where the parent sits. */
  parentPath: string;
  outcomes?: readonly { title: string; measure: string; target: string }[] | undefined;
  exitTest?: string | undefined;
  existingChildPaths?: readonly string[] | undefined;
  existingChildTitles?: readonly string[] | undefined;
  playbookId?: string | undefined;
  model?: ModelProvider | undefined;
  signal?: AbortSignal | undefined;
}

const DECOMPOSITION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["children"],
  properties: {
    children: {
      type: "array",
      maxItems: MAX_DRAFT_CHILDREN,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "exitTest", "rationale"],
        properties: {
          title: { type: "string", maxLength: MAX_DRAFT_TITLE_CHARS },
          exitTest: { type: "string", maxLength: MAX_DRAFT_TEXT_CHARS },
          rationale: { type: "string", maxLength: MAX_DRAFT_TEXT_CHARS },
        },
      },
    },
  },
} as const;

export async function decomposeTask(input: DecomposeTaskInput): Promise<TaskDecomposition> {
  const playbook = resolveTaskPlaybook("task-decomposition", input.playbookId);
  const parentPath = input.parentPath.trim();
  if (parentPath.length === 0) {
    throw new Error("task decomposition: parentPath is required to place children");
  }
  const scaffold = (note: string): TaskDecomposition => ({
    kind: "task_decomposition",
    ...scaffoldEnvelope(playbook, note),
    parentPath,
    children: [],
  });
  if (!input.model) return scaffold(NO_MODEL_NOTE);

  const result = await completePlanningJson({
    model: input.model,
    system: systemPrompt(
      playbook,
      "break this Task into the child Tasks that would finish it, each with its own exit test.",
      "Keys: children (each with title, exitTest, rationale). Do not number them and do not invent identifiers — order is the array order.",
    ),
    prompt: [
      `Task: ${input.title}`,
      (input.outcomes ?? []).length > 0
        ? `Its outcomes:\n${(input.outcomes ?? [])
            .map((outcome) => `- ${outcome.title} (measure: ${outcome.measure}; target: ${outcome.target})`)
            .join("\n")}`
        : "It carries no outcomes yet.",
      input.exitTest ? `Exit test: ${input.exitTest}` : "Exit test: not stated.",
      (input.existingChildTitles ?? []).length > 0
        ? `Children it already has (do not repeat these):\n${(input.existingChildTitles ?? [])
            .map((title) => `- ${title}`)
            .join("\n")}`
        : "It has no children yet.",
    ].join("\n"),
    schemaName: "task_decomposition",
    schema: DECOMPOSITION_SCHEMA,
    maxTokens: 2_048,
    signal: input.signal,
  });
  if (!result) return scaffold(UNUSABLE_OUTPUT_NOTE);

  const raw = result.value["children"];
  const drafted: { title: string; exitTest: string; rationale: string }[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const record = asRecord(entry);
      if (!record) continue;
      const title = boundedText(record["title"], MAX_DRAFT_TITLE_CHARS);
      const exitTest = boundedText(record["exitTest"], MAX_DRAFT_TEXT_CHARS);
      // The exit test is the single most load-bearing field in the plan; a
      // child without one is not a Task this Playbook is willing to propose.
      if (!title || !exitTest) continue;
      drafted.push({
        title,
        exitTest,
        rationale: boundedText(record["rationale"], MAX_DRAFT_TEXT_CHARS) ?? "",
      });
      if (drafted.length >= MAX_DRAFT_CHILDREN) break;
    }
  }
  if (drafted.length === 0) return scaffold(UNUSABLE_OUTPUT_NOTE);

  const paths = nextChildPaths(parentPath, input.existingChildPaths ?? [], drafted.length);
  const level = parentPath.split(".").length + 1;
  const children: DraftChildTask[] = drafted.map((child, index) => ({
    ...child,
    path: paths[index]!,
    level,
  }));
  return { kind: "task_decomposition", ...modelEnvelope(playbook, result.receipt), parentPath, children };
}
