// =====================================================================
// Task dependencies — the `depends_on`/`blocked_by` Relations the plan has
// specified since TM0 and the schema never had.
//
// Every slice since ADR-196 has recorded the same residual in the same words:
// "dependency-aware sequencing still needs `depends_on`/`blocked_by` Relations
// absent from the schema". `proposeQueueSequence` says so in its own doc
// comment, and honoured the `blocked` STATUS instead — which records that
// someone thinks a Task is blocked, but not by what, so nothing can ever tell
// them it stopped being true.
//
// ONE EDGE, NOT TWO. `blocked_by` is not a second relation: it is the same
// edge read from the other end. Storing both directions would let them
// disagree, and a queue whose two halves disagree about what blocks what is
// worse than one that does not model dependencies at all. The stored edge is
// always "A depends on B"; `blockedBy` is a query.
// =====================================================================

import { taskIsOpen } from "./task-planning.js";
import type { TaskRecord } from "./task-manager.js";

/** One directed edge: `taskId` cannot finish until `dependsOnTaskId` does. */
export interface TaskDependency {
  id: string;
  organizationId: string;
  /** The Task that is waiting. */
  taskId: string;
  /** The Task it is waiting on. */
  dependsOnTaskId: string;
  /** Why this edge exists, in the author's words. Optional, because a
   * dependency is often self-evident from the two titles, and demanding prose
   * for an obvious edge produces filler rather than reasons. */
  reason?: string;
  createdAt: string;
}

/**
 * A dependency is SATISFIED when its blocker reaches a closed status.
 *
 * `taskIsOpen` is the shared definition (`done`/`abandoned`/`archived` are
 * closed). `abandoned` counts as satisfied deliberately: a blocker nobody is
 * going to do can no longer block, and leaving the dependent Task waiting on
 * it forever is the failure mode this whole edge exists to make visible.
 */
export function dependencySatisfied(
  dependency: TaskDependency,
  byId: ReadonlyMap<string, TaskRecord>,
): boolean {
  const blocker = byId.get(dependency.dependsOnTaskId);
  // A blocker that no longer exists cannot block. The edge is stale, and
  // treating it as unsatisfied would strand the dependent Task on a row
  // nobody can act on.
  if (!blocker) return true;
  return !taskIsOpen(blocker.status);
}

export interface TaskBlockage {
  taskId: string;
  path: string;
  title: string;
  /** Every blocker still open, so a reader sees the whole wait rather than
   * clearing one and finding another behind it. */
  blockedBy: readonly { taskId: string; path: string; title: string; status: string }[];
}

/** Open Tasks with at least one unsatisfied dependency. */
export function blockedTasks(
  tasks: readonly TaskRecord[],
  dependencies: readonly TaskDependency[],
): readonly TaskBlockage[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const blockages: TaskBlockage[] = [];
  for (const task of tasks) {
    if (!taskIsOpen(task.status)) continue;
    const blockers = dependencies
      .filter((dependency) => dependency.taskId === task.id && !dependencySatisfied(dependency, byId))
      .map((dependency) => byId.get(dependency.dependsOnTaskId))
      .filter((blocker): blocker is TaskRecord => blocker !== undefined)
      .map((blocker) => ({ taskId: blocker.id, path: blocker.path, title: blocker.title, status: blocker.status }));
    if (blockers.length > 0) {
      blockages.push({ taskId: task.id, path: task.path, title: task.title, blockedBy: blockers });
    }
  }
  return blockages;
}

export interface UnblockedFinding {
  taskId: string;
  path: string;
  title: string;
  /** The Task's own status right now — the notifier's whole point is that this
   * is often still `blocked`, set by a Human who has not heard the news. */
  status: string;
  /** What was in the way and is no longer. Named, so the notice is checkable
   * rather than an assertion the reader has to take on trust. */
  clearedBy: readonly { taskId: string; path: string; title: string }[];
}

/**
 * Tasks that HAD dependencies and no longer have an unsatisfied one — what
 * `dependency-unblock-notifier` exists to surface.
 *
 * A Task with no dependencies at all is not "unblocked": it was never blocked,
 * and reporting it would bury the handful of rows that actually changed.
 */
export function unblockedTasks(
  tasks: readonly TaskRecord[],
  dependencies: readonly TaskDependency[],
): readonly UnblockedFinding[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const findings: UnblockedFinding[] = [];
  for (const task of tasks) {
    if (!taskIsOpen(task.status)) continue;
    const own = dependencies.filter((dependency) => dependency.taskId === task.id);
    if (own.length === 0) continue;
    if (own.some((dependency) => !dependencySatisfied(dependency, byId))) continue;
    const clearedBy = own
      .map((dependency) => byId.get(dependency.dependsOnTaskId))
      .filter((blocker): blocker is TaskRecord => blocker !== undefined)
      .map((blocker) => ({ taskId: blocker.id, path: blocker.path, title: blocker.title }));
    findings.push({ taskId: task.id, path: task.path, title: task.title, status: task.status, clearedBy });
  }
  return findings;
}

/** Thrown when an edge would make a Task wait on itself, directly or through
 * a chain. Its own error type so the API can answer 409 rather than 500. */
export class TaskDependencyCycleError extends Error {
  readonly cycle: readonly string[];
  constructor(cycle: readonly string[]) {
    super(`task-manager: this dependency would create a cycle (${cycle.join(" → ")}), and a cycle can never be satisfied`);
    this.name = "TaskDependencyCycleError";
    this.cycle = cycle;
  }
}

/**
 * Refuse an edge that would close a cycle.
 *
 * This is the one rule the model cannot be left to enforce and the UI cannot
 * be trusted to prevent: a cycle is not a bad plan, it is an UNSATISFIABLE
 * one. Every Task in it waits forever, `blockedTasks` reports all of them
 * permanently, and no amount of finishing work clears it. Refusing at write
 * time is the only place the queue can still be honest about it.
 */
export function assertNoDependencyCycle(
  existing: readonly TaskDependency[],
  edge: { taskId: string; dependsOnTaskId: string },
): void {
  if (edge.taskId === edge.dependsOnTaskId) {
    throw new TaskDependencyCycleError([edge.taskId, edge.taskId]);
  }
  // Walk forward from the proposed blocker: if it can already reach the
  // dependent Task, adding this edge closes the loop.
  const outgoing = new Map<string, string[]>();
  for (const dependency of existing) {
    outgoing.set(dependency.taskId, [...(outgoing.get(dependency.taskId) ?? []), dependency.dependsOnTaskId]);
  }
  const seen = new Set<string>();
  const stack: { id: string; path: string[] }[] = [{ id: edge.dependsOnTaskId, path: [edge.taskId, edge.dependsOnTaskId] }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.id === edge.taskId) throw new TaskDependencyCycleError(current.path);
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    for (const next of outgoing.get(current.id) ?? []) {
      stack.push({ id: next, path: [...current.path, next] });
    }
  }
}

/**
 * Rank contribution for dependency-aware sequencing.
 *
 * A Task with an unsatisfied dependency sorts with `blocked` work rather than
 * with ready work, whatever its own status says. That is the difference the
 * edge buys: the `blocked` STATUS records that someone believed a Task was
 * blocked, while an edge records what by — so the queue can sink it without
 * being told, and float it again when the blocker lands.
 */
export function dependencyBlockedTaskIds(
  tasks: readonly TaskRecord[],
  dependencies: readonly TaskDependency[],
): ReadonlySet<string> {
  return new Set(blockedTasks(tasks, dependencies).map((blockage) => blockage.taskId));
}
