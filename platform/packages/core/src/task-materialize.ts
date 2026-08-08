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
import type { TaskIndicatorKind, TaskOutcome, TaskRecord } from "./task-manager.js";

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
const MAX_MATERIALIZED_TASKS = 9;
const MAX_MATERIALIZED_OUTCOMES = 5;
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
        .map((entry) => {
          const child = record(entry);
          const title = child ? text(child["title"], MAX_TITLE_CHARS) : null;
          if (!title) return null;
          // The exit test is optional HERE even though the drafting Skill
          // requires one, because a human may have edited the payload and a
          // child without one is still a legitimate candidate — it simply
          // cannot enter in_progress until someone writes it (assertTaskTransition).
          return { title, exitTest: child ? text(child["exitTest"], MAX_TEXT_CHARS) ?? undefined : undefined };
        })
        .filter((draft): draft is { title: string; exitTest: string | undefined } => draft !== null);
      addChildren(subject, drafts);
      break;
    }

    case "candidate_task_generation": {
      const drafts = items(input.payload, "candidates")
        .map((entry) => {
          const candidate = record(entry);
          const title = candidate ? text(candidate["title"], MAX_TITLE_CHARS) : null;
          return title ? { title, exitTest: undefined } : null;
        })
        .filter((draft): draft is { title: string; exitTest: undefined } => draft !== null);
      addChildren(subject, drafts);
      break;
    }

    case "opportunity_scan": {
      // Each finding names the Task it was derived from, so the candidate
      // lands under THAT Task rather than all of them piling under whichever
      // Task happened to be the proposal's subject.
      const findings = items(input.payload, "opportunities")
        .map((entry) => {
          const opportunity = record(entry);
          if (!opportunity) return null;
          const title = text(opportunity["proposedTitle"], MAX_TITLE_CHARS);
          const sourceId = text(opportunity["taskId"], MAX_TITLE_CHARS);
          return title && sourceId ? { title, sourceId } : null;
        })
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
        const draft = record(entry);
        if (!draft) continue;
        const title = text(draft["title"], MAX_TITLE_CHARS);
        const measure = text(draft["measure"], MAX_TEXT_CHARS);
        const target = text(draft["target"], MAX_TEXT_CHARS);
        // The Playbook exists to produce measurable outcomes; one without a
        // measure and a target is exactly what it is meant to prevent.
        if (!title || !measure || !target) continue;
        const indicatorKind: TaskIndicatorKind = draft["indicatorKind"] === "leading" ? "leading" : "lagging";
        const outcome: TaskOutcome = { id: input.nextId(), title, measure, target, indicatorKind };
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
      const first = record(items(input.payload, "candidates")[0]);
      const exitTest = first ? text(first["exitTest"], MAX_TEXT_CHARS) : null;
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
