// =====================================================================
// What an APPROVED planning proposal actually does to the queue.
//
// ADR-198 shipped the planning Skills and the Automation that runs them, and
// recorded the honest residual: approval materialized nothing. A reviewer
// could approve a decomposition and no child Tasks appeared; approving a scan
// finding created no candidate Task. The draft-then-approve loop had a draft
// and an approve and no third step.
//
// This module is that third step, and it is PURE: it takes the current queue
// plus an approved payload and returns the queue that should replace it. Both
// the in-memory and the Drizzle `decideProposal` call this one function, so
// the two durability backends cannot materialize differently — the same reason
// `applyApprovedTaskProjectionReconciliation` is shaped this way.
//
// Two rules the whole module is built around:
//
//  1. Generated Tasks land as `status: "candidate"`. That is the status the
//     plan reserves for an option nobody has committed to. Approving a
//     decomposition means "these are worth having in the tree", not "start
//     them" — committing is a separate, later human act.
//
//  2. Dot-paths are RECOMPUTED here, never taken from the payload. The path a
//     Skill drafted was correct against the queue as it stood at draft time;
//     by approval another Task may have taken it. Trusting the drafted path
//     would silently collide two Tasks at one address, and the path is what
//     the queue's identity and ordering are built on.
// =====================================================================

// TYPES ONLY from task-manager. `task-manager.ts` imports this module's
// `applyApprovedPlanningProposal` at runtime for its `decideProposal`, so
// importing anything executable back from it would close a real ESM cycle —
// the same reason `task-planning.ts` is type-only against it.
import type { TaskIndicatorKind, TaskOutcome, TaskRecord, TaskRecordStatus } from "./task-manager.js";

/**
 * Append an outcome, forcing `northStar: false`.
 *
 * Deliberately a local copy of `withAppendedOutcome`'s rule rather than an
 * import (see the note above). The rule itself is the point and is asserted in
 * this module's own tests: promoting an outcome to the north star is a
 * separate, deliberate human edit — an approved draft must not be able to do
 * it on the way in.
 */
function appendOutcome(task: TaskRecord, outcome: TaskOutcome, now: string): TaskRecord {
  if (task.outcomes.some((existing) => existing.id === outcome.id)) return task;
  return {
    ...task,
    outcomes: [...task.outcomes, { ...outcome, northStar: false }],
    version: task.version + 1,
    updatedAt: now,
  };
}

/** Caps mirror the drafting caps in `task-playbooks.ts`/`task-execution.ts`.
 * Re-applied here because the payload is editable before approval, and an
 * edited payload is a human's text, not a validated Skill output. */
export const MAX_MATERIALIZED_TASKS = 9;
export const MAX_MATERIALIZED_OUTCOMES = 5;
const MAX_TITLE_CHARS = 160;
const MAX_TEXT_CHARS = 2_000;

export interface ApprovedPlanningResult {
  /** The full queue after materialization — callers persist this, they do not
   * diff it themselves. */
  tasks: readonly TaskRecord[];
  createdTaskIds: readonly string[];
  updatedTaskIds: readonly string[];
  /** Plain-language record of what approval did, stored on the proposal so the
   * decision is auditable without re-deriving it. */
  note: string;
}

export interface ApplyApprovedPlanningInput {
  tasks: readonly TaskRecord[];
  /** The approved payload — the Skill's own output, possibly human-edited. */
  payload: Readonly<Record<string, unknown>>;
  /** The Task the Playbook ran against. */
  taskId: string;
  organizationId: string;
  /** Owner for generated Tasks. This is the APPROVER, never the Agent that
   * drafted them: an Agent cannot own queue work it proposed to itself. */
  ownerId: string;
  now: string;
  nextId: () => string;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function items(payload: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------
// Entry parsers. One per planning kind, shared by `applyApprovedPlanningProposal`
// (which needs the parsed value) and `mergeEditedPlanningPayload` (which only
// needs to know whether anything survives). Sharing them is the point: an edit
// that this module would silently drop must be rejected at the API boundary
// with a reason, not accepted and then quietly written as nothing.
// ---------------------------------------------------------------------

type ChildDraft = { title: string; exitTest: string | undefined };

function parseChildDraft(entry: unknown): ChildDraft | null {
  const child = record(entry);
  if (!child) return null;
  const title = text(child["title"], MAX_TITLE_CHARS);
  if (!title) return null;
  // The exit test is optional HERE even though the drafting Skill requires
  // one, because a human may have edited the payload and a child without one
  // is still a legitimate candidate — it simply cannot enter in_progress
  // until someone writes it (assertTaskTransition).
  return { title, exitTest: text(child["exitTest"], MAX_TEXT_CHARS) ?? undefined };
}

function parseCandidateDraft(entry: unknown): ChildDraft | null {
  const candidate = record(entry);
  if (!candidate) return null;
  const title = text(candidate["title"], MAX_TITLE_CHARS);
  return title ? { title, exitTest: undefined } : null;
}

function parseFinding(entry: unknown): { title: string; sourceId: string } | null {
  const opportunity = record(entry);
  if (!opportunity) return null;
  const title = text(opportunity["proposedTitle"], MAX_TITLE_CHARS);
  const sourceId = text(opportunity["taskId"], MAX_TITLE_CHARS);
  return title && sourceId ? { title, sourceId } : null;
}

function parseExitTestDraft(entry: unknown): string | null {
  const candidate = record(entry);
  return candidate ? text(candidate["exitTest"], MAX_TEXT_CHARS) : null;
}

function parseOutcomeDraft(
  entry: unknown,
): { title: string; measure: string; target: string; indicatorKind: TaskIndicatorKind } | null {
  const draft = record(entry);
  if (!draft) return null;
  const title = text(draft["title"], MAX_TITLE_CHARS);
  const measure = text(draft["measure"], MAX_TEXT_CHARS);
  const target = text(draft["target"], MAX_TEXT_CHARS);
  // The Playbook exists to produce measurable outcomes; one without a measure
  // and a target is exactly what it is meant to prevent.
  if (!title || !measure || !target) return null;
  return {
    title,
    measure,
    target,
    indicatorKind: draft["indicatorKind"] === "leading" ? "leading" : "lagging",
  };
}

/**
 * Place `count` new children under `parent`, continuing after the highest
 * sort order already taken. Recomputed against the CURRENT queue — see the
 * module header for why the payload's drafted paths are not trusted.
 */
function placeChildren(
  tasks: readonly TaskRecord[],
  parent: TaskRecord | undefined,
  count: number,
): { path: string; level: number; sortOrder: number }[] {
  const siblings = tasks.filter((task) => task.parentTaskId === parent?.id);
  const highest = siblings.reduce((max, task) => Math.max(max, task.sortOrder), 0);
  return Array.from({ length: count }, (_, offset) => {
    const sortOrder = highest + offset + 1;
    return parent
      ? { path: `${parent.path}.${sortOrder}`, level: parent.level + 1, sortOrder }
      : { path: String(sortOrder), level: 0, sortOrder };
  });
}

function candidateTask(args: {
  id: string;
  organizationId: string;
  ownerId: string;
  title: string;
  exitTest?: string | undefined;
  parent: TaskRecord | undefined;
  location: { path: string; level: number; sortOrder: number };
  now: string;
}): TaskRecord {
  return {
    id: args.id,
    organizationId: args.organizationId,
    ...args.location,
    title: args.title,
    taskType: "task",
    // A generated child is never a goal. `is_goal` travels with a row through
    // restructuring and flipping it is a deliberate human act (ADR-106).
    isGoal: false,
    outcomes: [],
    anchor: false,
    ...(args.exitTest ? { exitTest: args.exitTest } : {}),
    // See rule 1 in the module header: approved means "worth having", not
    // "start it".
    status: "candidate",
    priority: args.parent?.priority ?? "P2",
    ownerType: "human",
    ownerId: args.ownerId,
    ...(args.parent ? { parentTaskId: args.parent.id } : {}),
    evidenceRefs: [],
    visibility: args.parent?.visibility ?? "organization",
    version: 1,
    createdAt: args.now,
    updatedAt: args.now,
  };
}

/**
 * The ONE payload key a human edit may replace, per planning kind.
 *
 * `premortem_scenario` is deliberately absent: it has no materializable
 * content, so there is nothing an edit could change about what approval does.
 * `kind` itself is never in this map — an edit that could rewrite the kind
 * would change what approval DOES, turning a reviewed pre-mortem into an
 * unreviewed decomposition.
 *
 * Exported for the review surface (ADR-208), which has to read the SAME key
 * to show a reviewer what they are editing. A surface with its own copy would
 * silently show an empty list the moment a kind is added here — the reviewer
 * would see "this plan proposes nothing" about a plan that proposes plenty.
 */
export const EDITABLE_CONTENT_KEY: Readonly<Record<string, string>> = {
  task_decomposition: "children",
  candidate_task_generation: "candidates",
  exit_test_authoring: "candidates",
  opportunity_scan: "opportunities",
  goal_outcome_framing: "outcomes",
};

function materializableCount(kind: string, entries: readonly unknown[]): number {
  const parse = {
    task_decomposition: parseChildDraft,
    candidate_task_generation: parseCandidateDraft,
    opportunity_scan: parseFinding,
    goal_outcome_framing: parseOutcomeDraft,
    exit_test_authoring: parseExitTestDraft,
  }[kind];
  return parse ? entries.filter((entry) => parse(entry) !== null).length : 0;
}

/**
 * Build the payload an EDITED planning decision materializes from.
 *
 * ADR-199 left a reviewer able to approve or veto a planning draft but not to
 * change it, which forced a whole-plan veto over one bad child title. This is
 * the third decision: approve what the Agent drafted, veto it, or approve a
 * corrected version.
 *
 * It is an allow-list MERGE, not a payload replacement. Only the one content
 * key this kind materializes from is taken from the human; `kind`, the run id,
 * the model receipt and the Playbook's own questions are carried over from the
 * staged draft verbatim. A human editing a plan is changing what gets built,
 * not rewriting the record of what the Agent proposed.
 *
 * Throws (the caller maps this to a 400) rather than silently narrowing, in
 * the two cases where accepting would be dishonest.
 */
export function mergeEditedPlanningPayload(
  staged: Readonly<Record<string, unknown>>,
  editedEntries: readonly unknown[],
): Readonly<Record<string, unknown>> {
  const kind = staged["kind"];
  if (kind === "premortem_scenario") {
    throw new Error(
      "task-manager: a pre-mortem has nothing an edit could change — approving one writes nothing to the queue by design, so approve or veto it",
    );
  }
  const key = typeof kind === "string" ? EDITABLE_CONTENT_KEY[kind] : undefined;
  if (!key || typeof kind !== "string") {
    throw new Error(`task-manager: planning proposal has unknown kind ${String(kind)}`);
  }
  if (materializableCount(kind, editedEntries) === 0) {
    // An approved edit that writes nothing is a veto wearing an approval's
    // clothes: the ledger would record consent to a plan, and the queue would
    // show no plan. Make the reviewer say which one they mean.
    throw new Error(
      "task-manager: the edited plan has no entry this Playbook can materialize — veto the proposal instead of approving an edit that writes nothing",
    );
  }
  return {
    ...staged,
    [key]: editedEntries,
    // What the Agent originally drafted, kept ON the proposal row. The
    // pipeline ledger holds the pre-edit proposal too, but the queue-side row
    // is where a reviewer actually looks, and an edit that erased the model's
    // draft from it would destroy the provenance the whole Playbook exists to
    // produce. A proposal leaves `pending_review` on its first decision, so
    // this is written at most once.
    agentDraft: { [key]: staged[key] ?? [] },
  };
}

/**
 * Apply an approved planning proposal to the queue.
 *
 * Throws when the Task the Playbook ran against is gone — approving a plan for
 * a Task that no longer exists must fail loudly rather than silently creating
 * orphan roots.
 */
export function applyApprovedPlanningProposal(
  input: ApplyApprovedPlanningInput,
): ApprovedPlanningResult {
  const kind = input.payload["kind"];
  const subject = input.tasks.find((task) => task.id === input.taskId);
  if (!subject) {
    throw new Error(`task-manager: planning proposal targets unknown Task ${input.taskId}`);
  }

  const byId = new Map(input.tasks.map((task) => [task.id, task]));
  const created: TaskRecord[] = [];
  const updatedIds: string[] = [];

  const addChildren = (
    parent: TaskRecord,
    drafts: readonly { title: string; exitTest?: string | undefined }[],
  ): void => {
    const capped = drafts.slice(0, MAX_MATERIALIZED_TASKS);
    const locations = placeChildren([...byId.values(), ...created], parent, capped.length);
    capped.forEach((draft, index) => {
      const task = candidateTask({
        id: input.nextId(),
        organizationId: input.organizationId,
        ownerId: input.ownerId,
        title: draft.title,
        exitTest: draft.exitTest,
        parent,
        location: locations[index]!,
        now: input.now,
      });
      created.push(task);
    });
  };

  switch (kind) {
    case "task_decomposition": {
      const drafts = items(input.payload, "children")
        .map(parseChildDraft)
        .filter((draft): draft is ChildDraft => draft !== null);
      addChildren(subject, drafts);
      break;
    }

    case "candidate_task_generation": {
      const drafts = items(input.payload, "candidates")
        .map(parseCandidateDraft)
        .filter((draft): draft is ChildDraft => draft !== null);
      addChildren(subject, drafts);
      break;
    }

    case "opportunity_scan": {
      // Each finding names the Task it was derived from, so the candidate
      // lands under THAT Task rather than all of them piling under whichever
      // Task happened to be the proposal's subject.
      const findings = items(input.payload, "opportunities")
        .map(parseFinding)
        .filter((finding): finding is { title: string; sourceId: string } => finding !== null)
        .slice(0, MAX_MATERIALIZED_TASKS);
      for (const finding of findings) {
        const parent = byId.get(finding.sourceId);
        // A finding whose source Task has since been deleted is dropped, not
        // re-homed: its whole justification was that specific row.
        if (!parent) continue;
        addChildren(parent, [{ title: finding.title, exitTest: undefined }]);
      }
      break;
    }

    case "goal_outcome_framing": {
      let task = subject;
      const drafts = items(input.payload, "outcomes").slice(0, MAX_MATERIALIZED_OUTCOMES);
      for (const entry of drafts) {
        const draft = parseOutcomeDraft(entry);
        if (!draft) continue;
        const outcome: TaskOutcome = { id: input.nextId(), ...draft };
        task = appendOutcome(task, outcome, input.now);
      }
      if (task !== subject) {
        byId.set(task.id, task);
        updatedIds.push(task.id);
      }
      break;
    }

    case "exit_test_authoring": {
      // Ordered cheapest-to-run first by the Skill, and a reviewer who wants a
      // different one reorders or edits the payload before approving — so the
      // first entry is the approved choice, not a guess made here.
      const exitTest = parseExitTestDraft(items(input.payload, "candidates")[0]);
      if (exitTest && exitTest !== subject.exitTest) {
        const updated: TaskRecord = {
          ...subject,
          exitTest,
          version: subject.version + 1,
          updatedAt: input.now,
        };
        byId.set(updated.id, updated);
        updatedIds.push(updated.id);
      }
      break;
    }

    case "premortem_scenario":
      // Nothing to write, and that is the correct outcome rather than a gap.
      // A pre-mortem's product is what the reader now knows; turning its
      // mitigations into Tasks automatically would manufacture queue work
      // nobody chose. Someone who wants a mitigation tracked creates it.
      return {
        tasks: input.tasks,
        createdTaskIds: [],
        updatedTaskIds: [],
        note: "Pre-mortem accepted. Nothing was written to the queue: its findings are for the reader, and turning mitigations into Tasks is a separate choice.",
      };

    default:
      throw new Error(`task-manager: planning proposal has unknown kind ${String(kind)}`);
  }

  const tasks = [...byId.values(), ...created];
  const note = created.length === 0 && updatedIds.length === 0
    ? "Approved, but nothing in the payload was materializable — no Task was created or changed."
    : [
        created.length > 0 ? `${created.length} candidate Task(s) created` : null,
        updatedIds.length > 0 ? `${updatedIds.length} Task(s) updated` : null,
      ].filter(Boolean).join("; ");

  return {
    tasks,
    createdTaskIds: created.map((task) => task.id),
    updatedTaskIds: updatedIds,
    note,
  };
}

// =====================================================================
// What an APPROVED routing proposal does to the queue (ADR-207).
//
// `agent-task-routing-on-assign` was the last Automation declared with no
// runtime binding, and the reason it stayed unbound through eight slices is
// recorded honestly in TASK-021: it needed a decision SURFACE, not a wiring.
// `routeTaskByRequiredSkill` had existed since TM0 and `taskManager.route`
// exposed it — as a query. It answered "who is eligible" and then nothing
// could act on the answer, because no write path set `assignedAgentId` after
// creation. A routing recommendation nobody can accept is not routing.
//
// Same shape and the same reason as `applyApprovedPlanningProposal`: pure,
// and called by BOTH stores so the two durability backends cannot assign
// differently.
// =====================================================================

export interface ApprovedRoutingResult {
  tasks: readonly TaskRecord[];
  assignedTaskId: string;
  agentId: string;
  note: string;
}

/**
 * Assign a Task to the Agent an approved routing proposal named.
 *
 * The staleness check is the load-bearing part. A routing decision is computed
 * against one specific version of one Task — its `requiredSkillId` is what
 * made that Agent eligible at all. If the Task changed between the routing Run
 * and the approval, the Human approved an answer to a question that is no
 * longer being asked, so this refuses rather than assigning against the new
 * shape. That is the same rule `archive_sweep` and `projection_reconcile`
 * apply to their own row versions.
 *
 * It assigns and stops. `assignedAgentId` records WHO may pick the work up;
 * it does not move the Task to `in_progress`, because an Agent having
 * authority to run something is not the same as the work having started.
 */
export function applyApprovedRoutingProposal(input: {
  tasks: readonly TaskRecord[];
  payload: Readonly<Record<string, unknown>>;
  taskId: string;
  now: string;
}): ApprovedRoutingResult {
  const agentId = input.payload["agentId"];
  if (typeof agentId !== "string" || agentId.length === 0) {
    throw new Error("task-manager: routing proposal names no Agent to assign");
  }
  const subject = input.tasks.find((task) => task.id === input.taskId);
  if (!subject) {
    throw new Error(`task-manager: routing proposal targets unknown Task ${input.taskId}`);
  }
  const expectedVersion = input.payload["expectedVersion"];
  if (typeof expectedVersion !== "number") {
    throw new Error("task-manager: routing proposal records no Task version to check against");
  }
  if (subject.version !== expectedVersion) {
    throw new Error(
      `task-manager: routing proposal is stale for Task ${subject.id} (approved against version ${expectedVersion}, now ${subject.version})`,
    );
  }
  // The Skill this Agent was found eligible FOR. If the Task's required Skill
  // has changed, eligibility was decided on a different question — and unlike
  // the version check this one is worth naming separately, because it is the
  // failure a reviewer is most likely to cause themselves by editing the Task
  // while its routing sat in the review inbox.
  const requiredSkillId = input.payload["requiredSkillId"];
  if (typeof requiredSkillId === "string" && subject.requiredSkillId !== requiredSkillId) {
    throw new Error(
      `task-manager: routing proposal was computed for required Skill ${requiredSkillId}, which Task ${subject.id} no longer requires`,
    );
  }
  if (subject.assignedAgentId === agentId) {
    return {
      tasks: input.tasks,
      assignedTaskId: subject.id,
      agentId,
      note: `Task ${subject.path} was already assigned to this Agent. Nothing changed.`,
    };
  }
  const assigned: TaskRecord = {
    ...subject,
    assignedAgentId: agentId,
    version: subject.version + 1,
    updatedAt: input.now,
  };
  return {
    tasks: input.tasks.map((task) => (task.id === assigned.id ? assigned : task)),
    assignedTaskId: assigned.id,
    agentId,
    note: `Task ${assigned.path} assigned to Agent ${agentId}. Assignment grants authority to run it; it does not start it.`,
  };
}

// =====================================================================
// Canonical ledger import (ADR-271).
//
// `draftTaskCreate` forces every Task after the first to `status: "candidate"`
// and stages an impact-fit proposal. That is correct for INTAKE — a new idea
// arrives as an option nobody has committed to. It is wrong for an IMPORT: the
// canonical ledger's 87 Tasks are already decided, already ordered, and 49 of
// them are already done. Round-tripping them through intake would ask a human
// to re-approve, one at a time, work they finished weeks ago.
//
// So this is a separate act with its own rule: an imported Task lands at the
// status the ledger states. Everything else the intake path guarantees is kept
// — dot-paths are recomputed here rather than trusted from the payload (same
// reason as `applyApprovedPlanningProposal`), and the non-goal `in_progress`
// exit-test invariant still holds.
// =====================================================================

export interface CanonicalLedgerEntry {
  /** Stable ledger identity ("TASK-021", "HORIZON-prototype") — carried only
   * so the note and any refusal can name the row a human recognizes. */
  recordId: string;
  /** The deterministic uuid the caller derived from `recordId`. Derived by the
   * caller, not here, because "same ledger row = same Task" is an identity
   * decision the persistence layer owns. */
  taskId: string;
  title: string;
  isGoal: boolean;
  /** Resolved uuid of the parent entry. Parents MUST appear before children. */
  parentTaskId?: string;
  status: TaskRecordStatus;
  priority?: string;
  /** Coarse effort estimate as the ledger states it. Absent stays absent. */
  estimate?: string;
  outcome?: string;
  exitTest?: string;
}

export interface CanonicalLedgerImportPlan {
  /** Tasks to insert, in order — later entries' paths depend on earlier ones. */
  created: readonly TaskRecord[];
  /** Existing Tasks whose ledger status has moved on since the last import. */
  transitions: readonly { taskId: string; status: TaskRecordStatus }[];
  /** Ledger rows already present at the stated status — reported, not silent,
   * so a no-op import says so instead of looking like a failure. */
  unchangedTaskIds: readonly string[];
  /** Entries admitted at `pending` instead of the status they declare, because
   * a non-goal Task may not enter `in_progress` without an exit test. Named
   * individually: a downgrade nobody is told about is a lie about the queue. */
  downgraded: readonly { recordId: string; declared: TaskRecordStatus }[];
  note: string;
}

function importedPath(
  queue: readonly { id: string; path: string; level: number; sortOrder: number; parentTaskId?: string }[],
  parentTaskId: string | undefined,
): { path: string; level: number; sortOrder: number } {
  const siblings = queue.filter((task) => task.parentTaskId === parentTaskId);
  const sortOrder = siblings.length + 1;
  if (!parentTaskId) return { path: String(sortOrder), level: 0, sortOrder };
  const parent = queue.find((task) => task.id === parentTaskId);
  if (!parent) throw new Error(`task-manager: imported parent ${parentTaskId} precedes no entry`);
  return { path: `${parent.path}.${sortOrder}`, level: parent.level + 1, sortOrder };
}

export function draftCanonicalLedgerImport(
  entries: readonly CanonicalLedgerEntry[],
  currentTasks: readonly TaskRecord[],
  opts: { organizationId: string; ownerId: string; now: string },
): CanonicalLedgerImportPlan {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.taskId)) {
      throw new Error(`task-manager: ledger entry ${entry.recordId} appears twice in one import`);
    }
    seen.add(entry.taskId);
  }

  const queue = [...currentTasks];
  const created: TaskRecord[] = [];
  const transitions: { taskId: string; status: TaskRecordStatus }[] = [];
  const unchangedTaskIds: string[] = [];
  const downgraded: { recordId: string; declared: TaskRecordStatus }[] = [];

  for (const entry of entries) {
    const existing = queue.find((task) => task.id === entry.taskId);
    if (existing) {
      // Re-import is an UPDATE of status only. Title, path and parent are left
      // alone: moving a Task somebody has since re-parented in the app, back to
      // where a text file thinks it belongs, is the drift the reconcile path
      // exists to negotiate — not something an import may do unasked.
      if (existing.status === entry.status) unchangedTaskIds.push(entry.taskId);
      else transitions.push({ taskId: entry.taskId, status: entry.status });
      continue;
    }
    const exitTest = entry.exitTest?.trim();
    const needsExitTest = !entry.isGoal && entry.status === "in_progress" && !exitTest;
    if (needsExitTest) downgraded.push({ recordId: entry.recordId, declared: entry.status });
    const location = importedPath(queue, entry.parentTaskId);
    const task: TaskRecord = {
      id: entry.taskId,
      organizationId: opts.organizationId,
      ...location,
      title: entry.title.trim(),
      taskType: "task",
      isGoal: entry.isGoal,
      outcomes: entry.outcome?.trim()
        ? [{
            id: `${entry.taskId}:outcome`,
            title: entry.outcome.trim(),
            measure: "prototype test",
            target: exitTest ?? entry.outcome.trim(),
            indicatorKind: "lagging" as TaskIndicatorKind,
          }]
        : [],
      anchor: false,
      ...(exitTest ? { exitTest } : {}),
      status: needsExitTest ? "pending" : entry.status,
      priority: entry.priority ?? "P2",
      ownerType: "human",
      ownerId: opts.ownerId,
      ...(entry.parentTaskId ? { parentTaskId: entry.parentTaskId } : {}),
      ...(entry.estimate?.trim() ? { estimate: entry.estimate.trim() } : {}),
      evidenceRefs: [],
      visibility: "organization",
      version: 1,
      createdAt: opts.now,
      updatedAt: opts.now,
    };
    queue.push(task);
    created.push(task);
  }

  const parts = [
    `${created.length} created`,
    `${transitions.length} re-stated`,
    `${unchangedTaskIds.length} already current`,
  ];
  if (downgraded.length > 0) {
    parts.push(
      `${downgraded.length} admitted as pending for want of an exit test (${downgraded
        .map((entry) => entry.recordId)
        .join(", ")})`,
    );
  }
  return {
    created,
    transitions,
    unchangedTaskIds,
    downgraded,
    note: `Canonical ledger import: ${parts.join(", ")}.`,
  };
}
