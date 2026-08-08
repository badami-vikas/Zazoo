import { TASK_PLAYBOOKS } from "./task-playbooks.js";
import { analyzeTaskImpactFit } from "./task-planning.js";
import { applyApprovedPlanningProposal } from "./task-materialize.js";
import { assertNoDependencyCycle, type TaskDependency } from "./task-dependencies.js";

export type TaskRecordStatus =
  | "candidate"
  | "committed"
  | "pending"
  | "in_progress"
  | "blocked"
  | "done"
  | "parked"
  | "abandoned"
  | "archived";

const TASK_RECORD_STATUSES: readonly TaskRecordStatus[] = [
  "candidate",
  "committed",
  "pending",
  "in_progress",
  "blocked",
  "done",
  "parked",
  "abandoned",
  "archived",
];

export type TaskOwnerType = "human" | "agent";
export type TaskIndicatorKind = "leading" | "lagging";

export interface TaskOutcome {
  id: string;
  title: string;
  measure: string;
  target: string;
  current?: string;
  indicatorKind: TaskIndicatorKind;
  northStar?: boolean;
}

export interface TaskVerification {
  verifiedAt: string;
  verifiedBy: string;
  evidenceRefs: readonly string[];
  result: "passed";
}

export interface TaskRecord {
  id: string;
  organizationId: string;
  path: string;
  level: number;
  sortOrder: number;
  title: string;
  taskType: string;
  isGoal: boolean;
  outcomes: readonly TaskOutcome[];
  anchor: boolean;
  reviewCadence?: string;
  lastReviewedAt?: string;
  exitTest?: string;
  status: TaskRecordStatus;
  priority: string;
  ownerType: TaskOwnerType;
  ownerId: string;
  assignedAgentId?: string;
  requiredSkillId?: string;
  parentTaskId?: string;
  scheduledFor?: string;
  evidenceRefs: readonly string[];
  verification?: TaskVerification;
  visibility: "private" | "organization";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskRecordInput {
  id: string;
  organizationId: string;
  title: string;
  taskType?: string;
  isGoal?: boolean;
  outcomes?: readonly TaskOutcome[];
  anchor?: boolean;
  reviewCadence?: string;
  exitTest?: string;
  status?: TaskRecordStatus;
  priority?: string;
  ownerType: TaskOwnerType;
  ownerId: string;
  assignedAgentId?: string;
  requiredSkillId?: string;
  parentTaskId?: string;
  scheduledFor?: string;
  visibility?: "private" | "organization";
}

export type TaskProposalKind =
  | "impact_fit"
  | "resequence"
  | "promote"
  | "insert_ancestor_above"
  | "re_parent"
  | "reorder"
  | "reopen"
  | "route"
  | "reschedule"
  | "archive_sweep"
  | "projection_reconcile"
  | "candidate";

export interface TaskChangeProposal {
  id: string;
  organizationId: string;
  kind: TaskProposalKind;
  taskId: string;
  actorId: string;
  payload: Readonly<Record<string, unknown>>;
  status: "pending_review" | "approved" | "vetoed";
  idempotencyKey?: string;
  expiresAt?: string;
  result?: Readonly<Record<string, unknown>>;
  createdAt: string;
}

export interface TaskCreateDraft {
  task: TaskRecord;
  impactFitProposal?: TaskChangeProposal;
}

function requireText(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`task-manager: ${name} is required`);
  return normalized;
}

function childrenOf(tasks: readonly TaskRecord[], parentTaskId?: string): TaskRecord[] {
  return tasks
    .filter((task) => task.parentTaskId === parentTaskId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function nextPath(tasks: readonly TaskRecord[], parentTaskId?: string): { path: string; level: number; sortOrder: number } {
  const siblings = childrenOf(tasks, parentTaskId);
  const sortOrder = siblings.length + 1;
  if (!parentTaskId) return { path: String(sortOrder), level: 0, sortOrder };
  const parent = tasks.find((task) => task.id === parentTaskId);
  if (!parent) throw new Error(`task-manager: unknown parent Task ${parentTaskId}`);
  return { path: `${parent.path}.${sortOrder}`, level: parent.level + 1, sortOrder };
}

export function draftTaskCreate(
  input: CreateTaskRecordInput,
  queue: readonly TaskRecord[],
  now: string,
  proposalId: string,
): TaskCreateDraft {
  if (queue.some((task) => task.id === input.id)) throw new Error(`task-manager: duplicate Task id ${input.id}`);
  const location = nextPath(queue, input.parentTaskId);
  const isGoal = input.isGoal ?? input.parentTaskId === undefined;
  const desiredStatus = input.status ?? "pending";
  if (!isGoal && desiredStatus === "in_progress" && !input.exitTest?.trim()) {
    throw new Error("task-manager: a non-goal Task needs an exit test before entering in_progress");
  }
  const task: TaskRecord = {
    id: input.id,
    organizationId: input.organizationId,
    ...location,
    title: requireText(input.title, "title"),
    taskType: input.taskType?.trim() || "task",
    isGoal,
    outcomes: [...(input.outcomes ?? [])],
    anchor: input.anchor ?? false,
    ...(input.reviewCadence ? { reviewCadence: input.reviewCadence } : {}),
    ...(input.exitTest?.trim() ? { exitTest: input.exitTest.trim() } : {}),
    status: queue.length === 0 ? desiredStatus : "candidate",
    priority: input.priority ?? "P2",
    ownerType: input.ownerType,
    ownerId: requireText(input.ownerId, "owner"),
    ...(input.assignedAgentId ? { assignedAgentId: input.assignedAgentId } : {}),
    ...(input.requiredSkillId ? { requiredSkillId: input.requiredSkillId } : {}),
    ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
    ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
    evidenceRefs: [],
    visibility: input.visibility ?? "organization",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  if (queue.length === 0) return { task };
  // TM3: the proposal carries a real reconciliation/placement/resequence
  // analysis. It used to carry `requiresResequenceReview: true` and nothing
  // else, which asked a reviewer to review something the system had not
  // actually worked out. `proposedStatus` stays — the approval path reads it.
  const analysis = analyzeTaskImpactFit({
    taskId: task.id,
    title: task.title,
    ...(task.outcomes.length > 0 ? { outcomes: task.outcomes } : {}),
    exitTest: task.exitTest,
    parentTaskId: task.parentTaskId,
    queue,
  });
  return {
    task,
    impactFitProposal: {
      id: proposalId,
      organizationId: input.organizationId,
      kind: "impact_fit",
      taskId: task.id,
      actorId: "internal-strategist",
      payload: {
        // Stays the REQUESTED parent, which is what `task.path` was computed
        // from. A suggested parent lives in `placement` (labeled, with its
        // reasoning) — putting it here would let a future consumer apply a
        // re-parent the requester never asked for, and would contradict the
        // path on the very Task this proposal describes.
        proposedParentTaskId: task.parentTaskId ?? null,
        proposedPath: task.path,
        proposedStatus: desiredStatus,
        currentQueueHead: queue.find((candidate) => candidate.status === "in_progress")?.id ?? queue[0]?.id,
        // Honest now: only true when the proposed order actually differs.
        requiresResequenceReview: analysis.resequence.changed,
        duplicates: analysis.duplicates,
        duplicateVerdict: analysis.duplicateVerdict,
        placement: analysis.placement,
        resequence: analysis.resequence,
        queueFindings: analysis.queueFindings,
      },
      status: "pending_review",
      createdAt: now,
    },
  };
}

export function assertTaskTransition(task: TaskRecord, status: TaskRecordStatus): void {
  if (status === "in_progress" && !task.isGoal && !task.exitTest?.trim()) {
    throw new Error("task-manager: a non-goal Task needs an exit test before entering in_progress");
  }
  if (status === "done" && !task.verification) {
    throw new Error("task-manager: done requires verification evidence");
  }
}

export function withTaskStatus(task: TaskRecord, status: TaskRecordStatus, now: string): TaskRecord {
  assertTaskTransition(task, status);
  return { ...task, status, version: task.version + 1, updatedAt: now };
}

export function withOutcomeTarget(
  task: TaskRecord,
  outcomeId: string,
  target: string,
  now: string,
): { task: TaskRecord; reopenProposal?: TaskChangeProposal } {
  let changed = false;
  const outcomes = task.outcomes.map((outcome) => {
    if (outcome.id !== outcomeId) return outcome;
    changed = outcome.target !== target;
    return { ...outcome, target };
  });
  if (!changed) return { task };
  const updated = { ...task, outcomes, version: task.version + 1, updatedAt: now };
  if (!["done", "archived", "parked"].includes(task.status)) return { task: updated };
  return {
    task: updated,
    reopenProposal: {
      id: `${task.id}:reopen:${task.version + 1}`,
      organizationId: task.organizationId,
      kind: "reopen",
      taskId: task.id,
      actorId: "internal-strategist",
      payload: { fromStatus: task.status, proposedStatus: "pending", reason: "outcome target changed" },
      status: "pending_review",
      createdAt: now,
    },
  };
}

/** Append an Outcome to an existing Task node. Used when a Chat follow-up
 * continues the node its thread already created instead of minting a sibling:
 * the node accumulates the conversation's Outcomes. Replaying the same
 * Outcome id is a no-op so a decision can be reconciled twice safely. */
export function withAppendedOutcome(
  task: TaskRecord,
  outcome: TaskOutcome,
  now: string,
): TaskRecord {
  if (task.outcomes.some((existing) => existing.id === outcome.id)) return task;
  const appended: TaskOutcome = { ...outcome, northStar: false };
  return {
    ...task,
    outcomes: [...task.outcomes, appended],
    version: task.version + 1,
    updatedAt: now,
  };
}

export type RestructureOperation =
  | { kind: "promote"; taskId: string }
  | { kind: "re_parent"; taskId: string; parentTaskId: string }
  | { kind: "reorder"; taskId: string; sortOrder: number }
  | { kind: "insert_ancestor_above"; taskId: string; ancestor: CreateTaskRecordInput };

function descendants(tasks: readonly TaskRecord[], taskId: string): Set<string> {
  const ids = new Set<string>([taskId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const task of tasks) {
      if (task.parentTaskId && ids.has(task.parentTaskId) && !ids.has(task.id)) {
        ids.add(task.id);
        expanded = true;
      }
    }
  }
  return ids;
}

function recomputePaths(tasks: readonly TaskRecord[]): TaskRecord[] {
  const byParent = new Map<string | undefined, TaskRecord[]>();
  for (const task of tasks) {
    const siblings = byParent.get(task.parentTaskId) ?? [];
    siblings.push(task);
    byParent.set(task.parentTaskId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  }
  const result = new Map<string, TaskRecord>();
  const visit = (parentTaskId: string | undefined, parentPath: string | undefined, level: number) => {
    const siblings = byParent.get(parentTaskId) ?? [];
    siblings.forEach((task, index) => {
      const path = parentPath ? `${parentPath}.${index + 1}` : String(index + 1);
      const next = { ...task, path, level, sortOrder: index + 1 };
      result.set(task.id, next);
      visit(task.id, path, level + 1);
    });
  };
  visit(undefined, undefined, 0);
  if (result.size !== tasks.length) throw new Error("task-manager: cycle or orphan detected while recomputing paths");
  return tasks.map((task) => result.get(task.id)!);
}

export function applyTaskRestructure(
  current: readonly TaskRecord[],
  operation: RestructureOperation,
  now: string,
): TaskRecord[] {
  const target = current.find((task) => task.id === operation.taskId);
  if (!target) throw new Error(`task-manager: unknown Task ${operation.taskId}`);
  let tasks = current.map((task) => ({ ...task }));
  if (operation.kind === "promote") {
    const rootSortOrder = Math.max(0, ...childrenOf(tasks).map((task) => task.sortOrder)) + 1;
    tasks = tasks.map((task) => {
      if (task.id !== target.id) return task;
      const { parentTaskId: _parentTaskId, ...promoted } = task;
      return { ...promoted, sortOrder: rootSortOrder };
    });
  } else if (operation.kind === "re_parent") {
    const parent = tasks.find((task) => task.id === operation.parentTaskId);
    if (!parent) throw new Error(`task-manager: unknown parent Task ${operation.parentTaskId}`);
    if (descendants(tasks, target.id).has(parent.id)) throw new Error("task-manager: re-parent would create a cycle");
    tasks = tasks.map((task) => task.id === target.id ? { ...task, parentTaskId: parent.id } : task);
  } else if (operation.kind === "reorder") {
    if (!Number.isInteger(operation.sortOrder) || operation.sortOrder < 1) {
      throw new Error("task-manager: sibling order must be a positive integer");
    }
    const siblings = childrenOf(tasks, target.parentTaskId).filter((task) => task.id !== target.id);
    const insertionIndex = Math.min(operation.sortOrder - 1, siblings.length);
    siblings.splice(insertionIndex, 0, target);
    const positions = new Map(siblings.map((task, index) => [task.id, index + 1]));
    tasks = tasks.map((task) =>
      positions.has(task.id) ? { ...task, sortOrder: positions.get(task.id)! } : task,
    );
  } else {
    if (tasks.some((task) => task.id === operation.ancestor.id)) {
      throw new Error(`task-manager: duplicate Task id ${operation.ancestor.id}`);
    }
    const ancestor: TaskRecord = {
      id: operation.ancestor.id,
      organizationId: target.organizationId,
      path: target.path,
      level: target.level,
      sortOrder: target.sortOrder,
      title: requireText(operation.ancestor.title, "ancestor title"),
      taskType: operation.ancestor.taskType ?? "task",
      isGoal: operation.ancestor.isGoal ?? false,
      outcomes: [...(operation.ancestor.outcomes ?? [])],
      anchor: operation.ancestor.anchor ?? false,
      ...(operation.ancestor.reviewCadence ? { reviewCadence: operation.ancestor.reviewCadence } : {}),
      ...(operation.ancestor.exitTest ? { exitTest: operation.ancestor.exitTest } : {}),
      status: operation.ancestor.status ?? "pending",
      priority: operation.ancestor.priority ?? target.priority,
      ownerType: operation.ancestor.ownerType,
      ownerId: operation.ancestor.ownerId,
      ...(target.parentTaskId ? { parentTaskId: target.parentTaskId } : {}),
      evidenceRefs: [],
      visibility: operation.ancestor.visibility ?? target.visibility,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    tasks = tasks.map((task) => task.id === target.id ? { ...task, parentTaskId: ancestor.id } : task);
    tasks.push(ancestor);
  }
  const original = new Map(current.map((task) => [task.id, task]));
  return recomputePaths(tasks).map((task) => {
    const before = original.get(task.id);
    if (
      !before ||
      before.path !== task.path ||
      before.level !== task.level ||
      before.sortOrder !== task.sortOrder ||
      before.parentTaskId !== task.parentTaskId
    ) {
      return { ...task, version: (before?.version ?? 0) + 1, updatedAt: now };
    }
    return before;
  });
}

export interface TaskRoutingAgent {
  id: string;
  active: boolean;
  allowedSkills: readonly string[];
  capabilityScope: readonly string[];
  plane: "local" | "cloud";
  dataScope: "public" | "private" | "all";
}

export interface TaskRoutingSkill {
  skillId: string;
  permissions: readonly string[];
  plane: "local" | "cloud";
  dataScopes: readonly ("public" | "private" | "all")[];
}

function permissionCovered(scope: readonly string[], permission: string): boolean {
  if (scope.includes("*") || scope.includes(permission)) return true;
  const split = permission.lastIndexOf(":");
  return split > 0 && (scope.includes(`${permission.slice(0, split)}:*`) || scope.includes(`*:${permission.slice(split + 1)}`));
}

export function routeTaskByRequiredSkill(
  requiredSkillId: string,
  agents: readonly TaskRoutingAgent[],
  skills: readonly TaskRoutingSkill[],
): { kind: "assigned"; agentId: string } | { kind: "human_assignment_required"; reason: string; candidates: string[] } {
  const skill = skills.find((candidate) => candidate.skillId === requiredSkillId);
  if (!skill) return { kind: "human_assignment_required", reason: "no registered SkillManifest", candidates: [] };
  const eligible = agents.filter((agent) =>
    agent.active &&
    (agent.allowedSkills.length === 0 || agent.allowedSkills.includes(requiredSkillId)) &&
    agent.plane === skill.plane &&
    skill.permissions.every((permission) => permissionCovered(agent.capabilityScope, permission)) &&
    (skill.dataScopes.includes("all") || skill.dataScopes.includes(agent.dataScope)),
  );
  if (eligible.length === 1) return { kind: "assigned", agentId: eligible[0]!.id };
  return {
    kind: "human_assignment_required",
    reason: eligible.length === 0 ? "no eligible Agent" : "ambiguous eligible Agents",
    candidates: eligible.map((agent) => agent.id),
  };
}

export type TaskChangeBand = "minor" | "significant" | "ambiguous";

export function classifyTaskChangeBand(input: {
  kind: "route" | "reschedule";
  deltaDays?: number;
  candidateCount?: number;
  crossesModule?: boolean;
}): TaskChangeBand {
  if (input.crossesModule || (input.candidateCount ?? 1) !== 1) return "ambiguous";
  if (input.kind === "reschedule" && Math.abs(input.deltaDays ?? 0) > 2) return "significant";
  return "minor";
}

export function calibratedTaskChangeDecision(input: {
  band: TaskChangeBand;
  approvals: number;
  vetoes: number;
  actorType: "human" | "agent";
  minimumApprovals?: number;
}): "auto_apply" | "approval_required" {
  if (input.actorType === "agent") return "approval_required";
  if (input.band !== "minor") return "approval_required";
  const threshold = input.minimumApprovals ?? 3;
  return input.approvals >= threshold && input.vetoes === 0 ? "auto_apply" : "approval_required";
}

export interface TaskProjection {
  content: string;
  contentHash: string;
  recordVersions: Readonly<Record<string, number>>;
}

export function taskProjectionContentHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function projectionField(value: string | undefined): string {
  return value?.trim() || "none";
}

export function emitTasksMarkdown(tasks: readonly TaskRecord[], completedCap = 10): TaskProjection {
  const active = tasks.filter((task) => !["done", "archived", "abandoned"].includes(task.status));
  const completed = tasks
    .filter((task) => task.status === "done")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, completedCap);
  const render = (task: TaskRecord) => [
    `## ${task.path} — ${task.title}`,
    `- Record ID: ${task.id}`,
    `- Version: ${task.version}`,
    `- Status: ${task.status}`,
    `- Priority: ${task.priority}`,
    `- Goal: ${task.isGoal ? "yes" : "no"}`,
    `- Outcomes: ${task.outcomes.map((outcome) => `${outcome.title} => ${outcome.target}`).join("; ") || "none"}`,
    `- Exit test: ${projectionField(task.exitTest)}`,
    `- Evidence: ${task.evidenceRefs.join("; ") || "none"}`,
    `- Dependencies: none`,
    "",
  ].join("\n");
  const body = [
    "# TASKS — generated Task Manager projection",
    "",
    "Read only in-progress Tasks and the first three pending Tasks to orient; follow links for evidence.",
    "Database is authoritative. External edits require governed reconciliation and are never silently applied.",
    "",
    ...active.map(render),
    "## Recently completed",
    "",
    ...completed.map(render),
  ].join("\n").trimEnd() + "\n";
  return {
    content: body,
    contentHash: taskProjectionContentHash(body),
    recordVersions: Object.fromEntries(tasks.map((task) => [task.id, task.version])),
  };
}

export interface ParsedTaskProjectionEntry {
  id: string;
  path: string;
  title: string;
  version: number;
  status: TaskRecordStatus;
}

export function parseTasksMarkdown(content: string): ParsedTaskProjectionEntry[] {
  const entries: ParsedTaskProjectionEntry[] = [];
  let current: Partial<ParsedTaskProjectionEntry> | undefined;
  const flush = () => {
    if (!current) return;
    if (!current.id || !current.path || !current.title || !current.version || !current.status) {
      throw new Error("task-manager: malformed tasks.md entry");
    }
    entries.push(current as ParsedTaskProjectionEntry);
  };
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^## ([0-9]+(?:\.[0-9]+)*) — (.+)$/);
    if (heading) {
      flush();
      current = { path: heading[1]!, title: heading[2]!.trim() };
      continue;
    }
    if (!current) continue;
    const field = line.match(/^- ([^:]+):\s*(.*)$/);
    if (!field) continue;
    if (field[1] === "Record ID") current.id = field[2]!.trim();
    if (field[1] === "Version") current.version = Number.parseInt(field[2]!, 10);
    if (field[1] === "Status") {
      const status = field[2]!.trim() as TaskRecordStatus;
      if (!TASK_RECORD_STATUSES.includes(status)) {
        throw new Error(`task-manager: invalid projected status "${status}"`);
      }
      current.status = status;
    }
  }
  flush();
  return entries;
}

export function detectTaskProjectionDrift(
  lastProjection: TaskProjection,
  externalContent: string,
  currentTasks: readonly TaskRecord[],
): {
  drifted: boolean;
  externalContentHash: string;
  changes: ParsedTaskProjectionEntry[];
  reason?: string;
} {
  const externalContentHash = taskProjectionContentHash(externalContent);
  if (externalContentHash === lastProjection.contentHash) {
    return { drifted: false, externalContentHash, changes: [] };
  }
  const parsed = parseTasksMarkdown(externalContent);
  for (const entry of parsed) {
    const current = currentTasks.find((task) => task.id === entry.id);
    if (!current) {
      return {
      drifted: true,
      externalContentHash,
      changes: parsed,
      reason: `external projection contains unknown Task ${entry.id}`,
      };
    }
    if (entry.version !== current.version) {
      return {
        drifted: true,
        externalContentHash,
        changes: parsed,
        reason: `Task ${entry.id} version conflict (${entry.version} != ${current.version})`,
      };
    }
  }

  return {
    drifted: true,
    externalContentHash,
    changes: parsed,
  };
}

export function applyApprovedTaskProjectionReconciliation(
  currentTasks: readonly TaskRecord[],
  externalContent: string,
  now: string,
): TaskRecord[] {
  const parsed = parseTasksMarkdown(externalContent);
  const byId = new Map(parsed.map((entry) => [entry.id, entry]));
  const paths = new Set(parsed.map((entry) => entry.path));
  if (paths.size !== parsed.length) throw new Error("task-manager: external projection contains duplicate paths");
  for (const entry of parsed) {
    const current = currentTasks.find((task) => task.id === entry.id);
    if (!current) throw new Error(`task-manager: external projection contains unknown Task ${entry.id}`);
    if (entry.version !== current.version) {
      throw new Error(`task-manager: Task ${entry.id} version conflict (${entry.version} != ${current.version})`);
    }
  }
  return currentTasks.map((task) => {
    const external = byId.get(task.id);
    if (!external) return task;
    const segments = external.path.split(".");
    const parentPath = external.path.includes(".") ? external.path.slice(0, external.path.lastIndexOf(".")) : undefined;
    const parent = parentPath
      ? currentTasks.find((candidate) => {
          const projected = byId.get(candidate.id);
          return projected ? projected.path === parentPath : candidate.path === parentPath;
        })
      : undefined;
    if (parentPath && !parent) {
      throw new Error(`task-manager: external projection parent path ${parentPath} is missing`);
    }
    const level = segments.length - 1;
    const sortOrder = Number.parseInt(segments[segments.length - 1]!, 10);
    const parentTaskId = parent?.id;
    const changed =
      task.title !== external.title ||
      task.status !== external.status ||
      task.path !== external.path ||
      task.level !== level ||
      task.sortOrder !== sortOrder ||
      task.parentTaskId !== parentTaskId;
    if (!changed) return task;
    assertTaskTransition(task, external.status);
    const base = {
      ...task,
      title: external.title,
      status: external.status,
      path: external.path,
      level,
      sortOrder,
      version: task.version + 1,
      updatedAt: now,
    };
    if (parent) return { ...base, parentTaskId: parent.id };
    const { parentTaskId: _parentTaskId, ...root } = base;
    return root;
  });
}

export type TaskGuardFinding =
  | { kind: "unverified_done"; taskId: string; proposedStatus: "pending" }
  | { kind: "wip_breach"; ownerId: string; taskIds: string[] }
  | { kind: "completed_bay_overflow"; taskIds: string[] }
  | { kind: "goal_review_due"; taskId: string }
  /** Live work nobody has touched in `staleAfterDays`. `daysSinceUpdate` is
   * carried so a reviewer sees HOW stale without re-deriving it, and the
   * finding never proposes a status: what a rotting Task needs (finish it,
   * re-scope it, park it, drop it) is a judgement, not a default. */
  | { kind: "stale_task"; taskId: string; daysSinceUpdate: number };

/** Defaults, both overridable by the caller so a policy change is a parameter
 * rather than an edit here. One in-progress Task per owner is the plan's WIP
 * rule ("hot head"); two weeks untouched is the staleness bar. */
export const DEFAULT_WIP_LIMIT = 1;
export const DEFAULT_STALE_AFTER_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Statuses a staleness check may flag.
 *
 * Deliberately narrower than `taskIsOpen`. `candidate` is an option nobody
 * committed to and `parked` is a decision to not do it now — both are
 * SUPPOSED to sit untouched, so flagging them would train the reviewer to
 * ignore the guard. `blocked` IS included: blocked work going quiet is
 * exactly the thing that rots unnoticed.
 */
const STALENESS_ELIGIBLE: readonly TaskRecordStatus[] = ["committed", "pending", "in_progress", "blocked"];

/** Exported so `synthesizeProgress`'s `stalled` list and this guard cannot
 * disagree about which Tasks are supposed to be moving. */
export function isStalenessEligible(status: TaskRecordStatus): boolean {
  return STALENESS_ELIGIBLE.includes(status);
}

export function evaluateTaskGuards(
  tasks: readonly TaskRecord[],
  completedCap = 10,
  options: { now?: string; wipLimit?: number; staleAfterDays?: number } = {},
): TaskGuardFinding[] {
  const wipLimit = options.wipLimit ?? DEFAULT_WIP_LIMIT;
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  // Staleness needs a clock. Without one the check is SKIPPED rather than
  // silently falling back to wall-clock time: this function is pure and its
  // callers pass the Run's clock, and a guard that quietly reads a different
  // clock than the rest of the Run would report findings nobody can reproduce.
  const nowMs = options.now ? Date.parse(options.now) : Number.NaN;
  const findings: TaskGuardFinding[] = [];
  for (const task of tasks) {
    if (task.status === "done" && !task.verification) {
      findings.push({ kind: "unverified_done", taskId: task.id, proposedStatus: "pending" });
    }

    if (task.isGoal && task.reviewCadence && !task.lastReviewedAt) {
      findings.push({ kind: "goal_review_due", taskId: task.id });
    }

    if (Number.isFinite(nowMs) && isStalenessEligible(task.status)) {
      const updatedMs = Date.parse(task.updatedAt);
      if (Number.isFinite(updatedMs)) {
        const daysSinceUpdate = Math.floor((nowMs - updatedMs) / DAY_MS);
        if (daysSinceUpdate >= staleAfterDays) {
          findings.push({ kind: "stale_task", taskId: task.id, daysSinceUpdate });
        }
      }
    }
  }
  const byOwner = new Map<string, string[]>();
  for (const task of tasks.filter((candidate) => candidate.status === "in_progress")) {
    byOwner.set(task.ownerId, [...(byOwner.get(task.ownerId) ?? []), task.id]);
  }
  for (const [ownerId, taskIds] of byOwner) {
    if (taskIds.length > wipLimit) findings.push({ kind: "wip_breach", ownerId, taskIds });
  }
  const completed = tasks
    .filter((task) => task.status === "done")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (completed.length > completedCap) {
    findings.push({ kind: "completed_bay_overflow", taskIds: completed.slice(completedCap).map((task) => task.id) });
  }
  return findings;
}

export interface CompletedBaySweepPlan {
  eligibleTaskIds: readonly string[];
  expectedVersions: Readonly<Record<string, number>>;
  policy: {
    completedCap: number;
    maxAgeDays: number;
    evaluatedAt: string;
  };
}

export function planCompletedBaySweep(
  tasks: readonly TaskRecord[],
  now: string,
  completedCap = 10,
  maxAgeDays = 7,
): CompletedBaySweepPlan {
  if (!Number.isInteger(completedCap) || completedCap < 0) {
    throw new Error("task-manager: completed bay cap must be a non-negative integer");
  }
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0) {
    throw new Error("task-manager: completed bay age must be a non-negative integer");
  }
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("task-manager: sweep evaluation time must be ISO-8601");
  const completed = tasks
    .filter((task) => task.status === "done")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  const overflow = new Set(completed.slice(completedCap).map((task) => task.id));
  const oldestAllowed = nowMs - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const task of completed) {
    const updatedAt = Date.parse(task.updatedAt);
    if (!Number.isFinite(updatedAt)) throw new Error(`task-manager: Task ${task.id} has invalid updatedAt`);
    if (updatedAt < oldestAllowed) overflow.add(task.id);
  }
  const eligibleTaskIds = completed
    .filter((task) => overflow.has(task.id))
    .map((task) => task.id);
  return {
    eligibleTaskIds,
    expectedVersions: Object.fromEntries(
      completed.filter((task) => overflow.has(task.id)).map((task) => [task.id, task.version]),
    ),
    policy: { completedCap, maxAgeDays, evaluatedAt: now },
  };
}

/**
 * The registered Playbook roster: id, version, owner. DERIVED from
 * `TASK_PLAYBOOKS` rather than restated, so the roster and the methodology
 * content behind it cannot drift — this list used to be the ONLY thing that
 * existed, five names with nothing behind them.
 */
export const TASK_MANAGER_PLAYBOOKS: readonly {
  id: string;
  version: string;
  ownerAgent: string;
}[] = TASK_PLAYBOOKS.map((playbook) => ({
  id: playbook.id,
  version: playbook.version,
  ownerAgent: playbook.ownerAgent,
}));

export interface TaskManagerIdClock {
  nextId(): string;
  nowISO(): string;
}

export interface TaskManagerStore {
  list(organizationId: string): Promise<TaskRecord[]>;
  /** Every dependency edge in the Organization (ADR-204). Read whole rather
   * than per Task: the sequencer, the blockage report and the unblock notifier
   * all need the graph, and fetching it edge by edge would make each of them
   * ask a different question of the same data. */
  listDependencies(organizationId: string): Promise<TaskDependency[]>;
  /** Create one `depends_on` edge. Throws `TaskDependencyCycleError` when the
   * edge would close a cycle — a cycle is not a bad plan, it is an
   * unsatisfiable one, and write time is the only place to still say so. */
  addDependency(
    input: { organizationId: string; taskId: string; dependsOnTaskId: string; reason?: string },
    seam: TaskManagerIdClock,
  ): Promise<TaskDependency>;
  removeDependency(organizationId: string, dependencyId: string): Promise<boolean>;
  get(organizationId: string, taskId: string): Promise<TaskRecord | null>;
  create(input: Omit<CreateTaskRecordInput, "id"> & { id?: string }, seam: TaskManagerIdClock): Promise<TaskCreateDraft>;
  transition(
    organizationId: string,
    taskId: string,
    status: TaskRecordStatus,
    seam: TaskManagerIdClock,
  ): Promise<TaskRecord>;
  verify(
    organizationId: string,
    taskId: string,
    verification: TaskVerification,
    seam: TaskManagerIdClock,
  ): Promise<TaskRecord>;
  updateOutcomeTarget(
    organizationId: string,
    taskId: string,
    outcomeId: string,
    target: string,
    seam: TaskManagerIdClock,
  ): Promise<{ task: TaskRecord; reopenProposal?: TaskChangeProposal }>;
  appendOutcome(
    organizationId: string,
    taskId: string,
    outcome: TaskOutcome,
    seam: TaskManagerIdClock,
  ): Promise<TaskRecord>;
  proposeRestructure(
    organizationId: string,
    operation: RestructureOperation,
    actorId: string,
    seam: TaskManagerIdClock,
  ): Promise<TaskChangeProposal>;
  getProposal(organizationId: string, proposalId: string): Promise<TaskChangeProposal | null>;
  stageProposal(
    input: {
      id: string;
      organizationId: string;
      /** `candidate` carries an approved planning Playbook or scan draft —
       * materialized by `applyApprovedPlanningProposal` (ADR-199). */
      kind: "projection_reconcile" | "archive_sweep" | "candidate";
      taskId: string;
      actorId: string;
      payload: Readonly<Record<string, unknown>>;
      idempotencyKey: string;
      expiresAt: string;
    },
    seam: TaskManagerIdClock,
  ): Promise<TaskChangeProposal>;
  decideProposal(
    organizationId: string,
    proposalId: string,
    decision: "approve" | "edit" | "veto",
    deciderId: string,
    seam: TaskManagerIdClock,
    editedPayload?: Readonly<Record<string, unknown>>,
  ): Promise<{ proposal: TaskChangeProposal; tasks: TaskRecord[]; result?: Readonly<Record<string, unknown>> }>;
}

export class InMemoryTaskManagerStore implements TaskManagerStore {
  readonly tasks = new Map<string, TaskRecord>();
  readonly proposals = new Map<string, TaskChangeProposal>();
  readonly dependencies = new Map<string, TaskDependency>();

  async listDependencies(organizationId: string): Promise<TaskDependency[]> {
    return [...this.dependencies.values()].filter((edge) => edge.organizationId === organizationId);
  }

  async addDependency(
    input: { organizationId: string; taskId: string; dependsOnTaskId: string; reason?: string },
    seam: TaskManagerIdClock,
  ): Promise<TaskDependency> {
    const existing = await this.listDependencies(input.organizationId);
    // The same pair twice is not a stronger dependency, and two rows for it
    // would double-report every blockage. Idempotent, matching the unique
    // constraint the Drizzle store relies on.
    const duplicate = existing.find(
      (edge) => edge.taskId === input.taskId && edge.dependsOnTaskId === input.dependsOnTaskId,
    );
    if (duplicate) return duplicate;
    assertNoDependencyCycle(existing, input);
    const edge: TaskDependency = {
      id: seam.nextId(),
      organizationId: input.organizationId,
      taskId: input.taskId,
      dependsOnTaskId: input.dependsOnTaskId,
      ...(input.reason ? { reason: input.reason } : {}),
      createdAt: seam.nowISO(),
    };
    this.dependencies.set(edge.id, edge);
    return edge;
  }

  async removeDependency(organizationId: string, dependencyId: string): Promise<boolean> {
    const edge = this.dependencies.get(dependencyId);
    if (!edge || edge.organizationId !== organizationId) return false;
    this.dependencies.delete(dependencyId);
    return true;
  }

  async list(organizationId: string): Promise<TaskRecord[]> {
    return [...this.tasks.values()]
      .filter((task) => task.organizationId === organizationId)
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  async get(organizationId: string, taskId: string): Promise<TaskRecord | null> {
    const task = this.tasks.get(taskId);
    return task?.organizationId === organizationId ? task : null;
  }

  async create(
    input: Omit<CreateTaskRecordInput, "id"> & { id?: string },
    seam: TaskManagerIdClock,
  ): Promise<TaskCreateDraft> {
    const queue = await this.list(input.organizationId);
    const drafted = draftTaskCreate(
      { ...input, id: input.id ?? seam.nextId() },
      queue,
      seam.nowISO(),
      seam.nextId(),
    );
    this.tasks.set(drafted.task.id, drafted.task);
    if (drafted.impactFitProposal) this.proposals.set(drafted.impactFitProposal.id, drafted.impactFitProposal);
    return drafted;
  }

  async transition(
    organizationId: string,
    taskId: string,
    status: TaskRecordStatus,
    seam: TaskManagerIdClock,
  ): Promise<TaskRecord> {
    const task = await this.get(organizationId, taskId);
    if (!task) throw new Error(`task-manager: unknown Task ${taskId}`);
    const updated = withTaskStatus(task, status, seam.nowISO());
    this.tasks.set(taskId, updated);
    return updated;
  }

  async verify(
    organizationId: string,
    taskId: string,
    verification: TaskVerification,
    seam: TaskManagerIdClock,
  ): Promise<TaskRecord> {
    const task = await this.get(organizationId, taskId);
    if (!task) throw new Error(`task-manager: unknown Task ${taskId}`);
    if (verification.evidenceRefs.length === 0) throw new Error("task-manager: verification needs evidence");
    const updated = { ...task, verification, evidenceRefs: [...new Set([...task.evidenceRefs, ...verification.evidenceRefs])], version: task.version + 1, updatedAt: seam.nowISO() };
    this.tasks.set(task.id, updated);
    return updated;
  }

  async updateOutcomeTarget(
    organizationId: string,
    taskId: string,
    outcomeId: string,
    target: string,
    seam: TaskManagerIdClock,
  ): Promise<{ task: TaskRecord; reopenProposal?: TaskChangeProposal }> {
    const task = await this.get(organizationId, taskId);
    if (!task) throw new Error(`task-manager: unknown Task ${taskId}`);
    const result = withOutcomeTarget(task, outcomeId, target, seam.nowISO());
    this.tasks.set(task.id, result.task);
    if (!result.reopenProposal) return result;
    const reopenProposal = { ...result.reopenProposal, id: seam.nextId() };
    this.proposals.set(reopenProposal.id, reopenProposal);
    return { task: result.task, reopenProposal };
  }

  async appendOutcome(
    organizationId: string,
    taskId: string,
    outcome: TaskOutcome,
    seam: TaskManagerIdClock,
  ): Promise<TaskRecord> {
    const task = await this.get(organizationId, taskId);
    if (!task) throw new Error(`task-manager: unknown Task ${taskId}`);
    const updated = withAppendedOutcome(task, outcome, seam.nowISO());
    this.tasks.set(task.id, updated);
    return updated;
  }

  async proposeRestructure(
    organizationId: string,
    operation: RestructureOperation,
    actorId: string,
    seam: TaskManagerIdClock,
  ): Promise<TaskChangeProposal> {
    if (!(await this.get(organizationId, operation.taskId))) {
      throw new Error(`task-manager: unknown Task ${operation.taskId}`);
    }
    const proposal: TaskChangeProposal = {
      id: seam.nextId(),
      organizationId,
      kind: operation.kind,
      taskId: operation.taskId,
      actorId,
      payload: { operation },
      status: "pending_review",
      createdAt: seam.nowISO(),
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  async getProposal(organizationId: string, proposalId: string): Promise<TaskChangeProposal | null> {
    const found = this.proposals.get(proposalId);
    return found?.organizationId === organizationId ? found : null;
  }

  async stageProposal(
    input: {
      id: string;
      organizationId: string;
      /** `candidate` carries an approved planning Playbook or scan draft —
       * materialized by `applyApprovedPlanningProposal` (ADR-199). */
      kind: "projection_reconcile" | "archive_sweep" | "candidate";
      taskId: string;
      actorId: string;
      payload: Readonly<Record<string, unknown>>;
      idempotencyKey: string;
      expiresAt: string;
    },
    seam: TaskManagerIdClock,
  ): Promise<TaskChangeProposal> {
    const existing = [...this.proposals.values()].find(
      (proposal) =>
        proposal.organizationId === input.organizationId &&
        proposal.kind === input.kind &&
        proposal.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (JSON.stringify(existing.payload) !== JSON.stringify(input.payload)) {
        throw new Error("task-manager: idempotency key conflicts with different proposal content");
      }
      return existing;
    }
    const proposal: TaskChangeProposal = {
      id: input.id,
      organizationId: input.organizationId,
      kind: input.kind,
      taskId: input.taskId,
      actorId: input.actorId,
      payload: input.payload,
      status: "pending_review",
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt,
      createdAt: seam.nowISO(),
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  async decideProposal(
    organizationId: string,
    proposalId: string,
    decision: "approve" | "edit" | "veto",
    deciderId: string,
    seam: TaskManagerIdClock,
    editedPayload?: Readonly<Record<string, unknown>>,
  ): Promise<{ proposal: TaskChangeProposal; tasks: TaskRecord[]; result?: Readonly<Record<string, unknown>> }> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.organizationId !== organizationId) {
      throw new Error(`task-manager: unknown proposal ${proposalId}`);
    }
    if (proposal.status !== "pending_review") {
      return {
        proposal,
        tasks: await this.list(organizationId),
        ...(proposal.result ? { result: proposal.result } : {}),
      };
    }
    if (Date.parse(proposal.expiresAt ?? "9999-12-31T00:00:00.000Z") <= Date.parse(seam.nowISO())) {
      throw new Error(`task-manager: proposal ${proposalId} expired`);
    }
    if (deciderId === proposal.actorId) throw new Error("task-manager: proposal author cannot approve its own change");
    const resolvedStatus = decision === "veto" ? "vetoed" as const : "approved" as const;
    let effectivePayload = editedPayload ?? proposal.payload;
    let tasks = await this.list(organizationId);
    let result: Readonly<Record<string, unknown>> | undefined;
    if (decision !== "veto" && proposal.kind === "projection_reconcile") {
      const externalContent = effectivePayload["externalContent"];
      const externalContentHash = effectivePayload["externalContentHash"];
      const beforeProjectionHash = effectivePayload["beforeProjectionHash"];
      const recordVersions = effectivePayload["recordVersions"];
      if (
        typeof externalContent !== "string" ||
        typeof externalContentHash !== "string" ||
        typeof beforeProjectionHash !== "string" ||
        typeof recordVersions !== "object" ||
        recordVersions === null
      ) {
        throw new Error("task-manager: projection proposal payload is invalid");
      }
      if (taskProjectionContentHash(externalContent) !== externalContentHash) {
        throw new Error("task-manager: projection proposal content hash changed");
      }
      const currentProjection = emitTasksMarkdown(tasks);
      if (currentProjection.contentHash !== beforeProjectionHash) {
        throw new Error("task-manager: projection proposal is stale against the current Database");
      }
      const expected = recordVersions as Record<string, number>;
      for (const task of tasks) {
        if (expected[task.id] !== task.version) {
          throw new Error(`task-manager: projection proposal is stale for Task ${task.id}`);
        }
      }
      tasks = applyApprovedTaskProjectionReconciliation(tasks, externalContent, seam.nowISO());
      for (const task of tasks) this.tasks.set(task.id, task);
      const projection = emitTasksMarkdown(tasks);
      result = { projection, decision };
    } else if (decision !== "veto" && proposal.kind === "archive_sweep") {
      const taskIds = effectivePayload["taskIds"];
      const recordVersions = effectivePayload["recordVersions"];
      if (!Array.isArray(taskIds) || typeof recordVersions !== "object" || recordVersions === null) {
        throw new Error("task-manager: archive sweep proposal payload is invalid");
      }
      const expected = recordVersions as Record<string, number>;
      const archived: string[] = [];
      tasks = tasks.map((task) => {
        if (!taskIds.includes(task.id)) return task;
        if (task.status !== "done" || expected[task.id] !== task.version) {
          throw new Error(`task-manager: sweep proposal is stale for Task ${task.id}`);
        }
        const updated = withTaskStatus(task, "archived", seam.nowISO());
        this.tasks.set(task.id, updated);
        archived.push(task.id);
        return updated;
      });
      result = { archivedTaskIds: archived, decision };
    } else if (decision !== "veto" && proposal.kind === "candidate") {
      // The third step of draft-then-approve (ADR-199). Shared with the
      // Drizzle store through one core function so the two backends cannot
      // materialize an approved plan differently.
      const materialized = applyApprovedPlanningProposal({
        tasks,
        payload: effectivePayload,
        taskId: proposal.taskId,
        organizationId,
        // The APPROVER owns generated Tasks, never the Agent that drafted
        // them — an Agent cannot end up owning queue work it proposed.
        ownerId: deciderId,
        now: seam.nowISO(),
        nextId: () => seam.nextId(),
      });
      tasks = [...materialized.tasks];
      for (const task of tasks) this.tasks.set(task.id, task);
      result = {
        createdTaskIds: materialized.createdTaskIds,
        updatedTaskIds: materialized.updatedTaskIds,
        note: materialized.note,
        decision,
      };
    }
    const resolved = {
      ...proposal,
      payload: effectivePayload,
      status: resolvedStatus,
      ...(result ? { result } : {}),
    };
    this.proposals.set(proposal.id, resolved);
    if (decision === "veto") return { proposal: resolved, tasks };
    const operation = proposal.payload["operation"] as RestructureOperation | undefined;
    if (!operation) {
      const tasks = await this.list(organizationId);
      if (["impact_fit", "reopen"].includes(proposal.kind) && typeof proposal.payload["proposedStatus"] === "string") {
        const task = tasks.find((candidate) => candidate.id === proposal.taskId);
        if (task) this.tasks.set(task.id, withTaskStatus(task, proposal.payload["proposedStatus"] as TaskRecordStatus, seam.nowISO()));
      }
      return { proposal: resolved, tasks: await this.list(organizationId), ...(result ? { result } : {}) };
    }
    const updated = applyTaskRestructure(await this.list(organizationId), operation, seam.nowISO());
    for (const task of updated) this.tasks.set(task.id, task);
    return { proposal: resolved, tasks: updated, ...(result ? { result } : {}) };
  }
}
