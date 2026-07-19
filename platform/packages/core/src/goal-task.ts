/**
 * Goal/Task primitives (docs/raw/agent-goal-skill-orchestration-plan-2026-07.md
 * AGS1, docs/glossary.md). A Goal is a durable intended outcome used to
 * classify and prioritize related Tasks and eligible Skills; a Task is a
 * bounded unit of work toward a Goal, assigned to exactly one Agent. Skills
 * bind PRIMARILY to Goal/Task type pairs (see skill-manifest.ts's
 * `resolveSkillForTask`) — an Agent's manifest-declared default access is a
 * preference, never ownership, so a Task's `assignedAgentId` is what actually
 * authorizes an eligible Agent to use a matching governed Skill, not the
 * Agent's identity alone.
 *
 * Kept deliberately minimal and store-agnostic (an in-memory port here, same
 * pattern as `AutomationRegistry`/`AgentQuery` in ports.ts) — a Drizzle-backed
 * store is a follow-up slice once this primitive has a settled shape, mirroring
 * how `OrganizationDefinitionStore`/DealPilot's thesis store started in-memory in
 * `apps/api/wiring.ts` before any dedicated schema landed.
 */

/** An open string identifier, e.g. "relationship.learning", "dealpilot.diligence".
 * Kept as a plain string (not a closed enum) because Goal/Task types are a
 * per-Module vocabulary that Modules and Commons modules extend over time —
 * mirrors `ResourceType`'s pattern of being closed at the kernel-governance
 * layer but Goal/Task types are intentionally open, like `Skill.name`. */
export type GoalType = string;
export type TaskType = string;

export type TaskStatus = "open" | "in_progress" | "done" | "blocked" | "cancelled";

export interface Goal {
  id: string;
  organizationId: string;
  type: GoalType;
  title: string;
  createdAt: string;
}

export interface Task {
  id: string;
  organizationId: string;
  goalId: string;
  type: TaskType;
  /**
   * The Agent this Task is currently assigned to. This is the ONLY thing that
   * authorizes an eligible Agent to invoke a matching governed Skill for this
   * Task — a Skill manifest's `defaultAgents` is a preference surfaced to the
   * UI/assignment flow, never a bypass (AGS1 deny_rules: "default Agent access
   * never overrides Goal/Task mismatch"). May be any registered Agent id,
   * including a non-default one, which is exactly the scenario TASK-007's
   * prototype test exercises.
   */
  assignedAgentId: string;
  status: TaskStatus;
  createdAt: string;
}

export interface CreateGoalInput {
  id?: string;
  organizationId: string;
  type: GoalType;
  title: string;
}

export interface CreateTaskInput {
  id?: string;
  organizationId: string;
  goalId: string;
  type: TaskType;
  assignedAgentId: string;
  status?: TaskStatus;
}

/** Minimal determinism seam this store needs — mirrors `RunCtx`'s `ids`/`clock`
 * without requiring a full RunCtx (Goal/Task CRUD is not itself a pipeline
 * mutation; it is the data the pipeline later resolves Skills against). */
export interface GoalTaskIdClock {
  nextId(): string;
  nowISO(): string;
}

export interface GoalTaskStore {
  createGoal(input: CreateGoalInput, seam: GoalTaskIdClock): Promise<Goal>;
  getGoal(organizationId: string, id: string): Promise<Goal | null>;
  listGoals(organizationId: string): Promise<Goal[]>;
  createTask(input: CreateTaskInput, seam: GoalTaskIdClock): Promise<Task>;
  getTask(organizationId: string, id: string): Promise<Task | null>;
  listTasksByGoal(organizationId: string, goalId: string): Promise<Task[]>;
  /** Reassign a Task to a different Agent — the ONLY way eligibility for a
   * governed Skill changes for that Task; never mutated implicitly. */
  reassignTask(organizationId: string, id: string, assignedAgentId: string): Promise<Task>;
  updateTaskStatus(organizationId: string, id: string, status: TaskStatus): Promise<Task>;
}

/** In-memory implementation — dev/test default, same shape as every other
 * `InMemory*Store` in memory/stores.ts. */
export class InMemoryGoalTaskStore implements GoalTaskStore {
  readonly goals = new Map<string, Goal>();
  readonly tasks = new Map<string, Task>();

  async createGoal(input: CreateGoalInput, seam: GoalTaskIdClock): Promise<Goal> {
    const goal: Goal = {
      id: input.id ?? seam.nextId(),
      organizationId: input.organizationId,
      type: input.type,
      title: input.title,
      createdAt: seam.nowISO(),
    };
    this.goals.set(goal.id, goal);
    return goal;
  }

  async getGoal(organizationId: string, id: string): Promise<Goal | null> {
    const goal = this.goals.get(id);
    return goal?.organizationId === organizationId ? goal : null;
  }

  async listGoals(organizationId: string): Promise<Goal[]> {
    return [...this.goals.values()].filter((g) => g.organizationId === organizationId);
  }

  async createTask(input: CreateTaskInput, seam: GoalTaskIdClock): Promise<Task> {
    const goal = this.goals.get(input.goalId);
    if (!goal || goal.organizationId !== input.organizationId) {
      throw new Error(`goal-task: goal ${input.goalId} does not belong to organization ${input.organizationId}`);
    }
    const task: Task = {
      id: input.id ?? seam.nextId(),
      organizationId: input.organizationId,
      goalId: input.goalId,
      type: input.type,
      assignedAgentId: input.assignedAgentId,
      status: input.status ?? "open",
      createdAt: seam.nowISO(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async getTask(organizationId: string, id: string): Promise<Task | null> {
    const task = this.tasks.get(id);
    return task?.organizationId === organizationId ? task : null;
  }

  async listTasksByGoal(organizationId: string, goalId: string): Promise<Task[]> {
    return [...this.tasks.values()].filter((t) => t.organizationId === organizationId && t.goalId === goalId);
  }

  async reassignTask(organizationId: string, id: string, assignedAgentId: string): Promise<Task> {
    const existing = this.tasks.get(id);
    if (!existing || existing.organizationId !== organizationId) throw new Error(`goal-task: unknown task ${id}`);
    const updated: Task = { ...existing, assignedAgentId };
    this.tasks.set(id, updated);
    return updated;
  }

  async updateTaskStatus(organizationId: string, id: string, status: TaskStatus): Promise<Task> {
    const existing = this.tasks.get(id);
    if (!existing || existing.organizationId !== organizationId) throw new Error(`goal-task: unknown task ${id}`);
    const updated: Task = { ...existing, status };
    this.tasks.set(id, updated);
    return updated;
  }
}
