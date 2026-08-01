/**
 * Research Run records (TASK-028 kernel-Run migration).
 *
 * A Research Run is one bounded background research objective. The @bridge/research
 * engine executes the loop wherever the executor lives (today: the desktop overlay
 * webview, per the user-approved prototype-first path); these records are the
 * KERNEL's durable, inspectable projection of that Run:
 *
 *  - one `ResearchRunRecord` per objective, owner-scoped like Chat threads;
 *  - one `ResearchStepRecord` per executed engine step, each additionally
 *    recorded as a terminal child Agent Run (child-agent-run.ts) so the step
 *    timeline is inspectable through the SAME surface every other delegated
 *    Run uses;
 *  - `stopRequested` is the cross-surface interrupt: the Run detail Page sets
 *    it, the executor polls it and stops cooperatively at the next step edge.
 *
 * The store is a port (in-memory default, Drizzle-backed in persistent mode)
 * so the lifecycle guards here are exercised without a database.
 */

export type ResearchRunStatus = "running" | "completed" | "cancelled" | "failed";

/** Engine StopReasons (@bridge/research) plus `executor_error` — the honest
 * label for "the executor itself threw or died", which the engine can never
 * report about itself. */
export const RESEARCH_STOP_REASONS = [
  "planner_finished",
  "bound_steps",
  "bound_pages",
  "bound_wall_clock",
  "bound_bytes",
  "cancelled",
  "refused_red_action",
  "injection_detected",
  "planner_failed",
  "executor_error",
] as const;
export type ResearchStopReason = (typeof RESEARCH_STOP_REASONS)[number];

export const RESEARCH_STEP_TOOLS = [
  "search",
  "read",
  "find",
  "click",
  "type",
  "note",
] as const;
export type ResearchStepTool = (typeof RESEARCH_STEP_TOOLS)[number];

export interface ResearchRunRecord {
  id: string;
  organizationId: string;
  /** Research Runs are private to the human who started them (Chat-thread rule). */
  ownerUserId: string;
  objective: string;
  status: ResearchRunStatus;
  /** Cross-surface cooperative interrupt; never cleared once set. */
  stopRequested: boolean;
  /** The parent Run envelope id every step child Run hangs under. */
  parentRunId: string;
  goalId: string;
  taskId: string;
  stopReason: ResearchStopReason | null;
  brief: string | null;
  citations: readonly string[];
  blockedActions: readonly string[];
  injectionReports: readonly string[];
  stepsTaken: number;
  startedAt: string;
  endedAt: string | null;
}

export interface ResearchStepRecord {
  id: string;
  runId: string;
  organizationId: string;
  ownerUserId: string;
  stepIndex: number;
  tool: ResearchStepTool;
  /** Engine-authored, trusted summary — never raw page text. */
  summary: string;
  sourceUrl: string | null;
  /** The terminal child Agent Run recorded for this step. */
  childRunId: string | null;
  /** Quarantined external text, kept so a resumed Run replays its evidence.
   * ALWAYS untrusted; consumers must keep it out of instruction channels. */
  quarantinedText: string | null;
  quarantinedSourceUrl: string | null;
  createdAt: string;
}

export interface ResearchRunOutcomeUpdate {
  status: Exclude<ResearchRunStatus, "running">;
  stopReason: ResearchStopReason;
  brief: string | null;
  citations: readonly string[];
  blockedActions: readonly string[];
  injectionReports: readonly string[];
  stepsTaken: number;
}

export class ResearchRunNotFoundError extends Error {
  constructor(id: string) {
    super(`unknown Research Run ${id}`);
    this.name = "ResearchRunNotFoundError";
  }
}

/** A terminal Run's outcome is immutable, and a terminal Run takes no more steps. */
export class ResearchRunAlreadyTerminalError extends Error {
  constructor(id: string, status: ResearchRunStatus) {
    super(`Research Run ${id} is already ${status}`);
    this.name = "ResearchRunAlreadyTerminalError";
  }
}

export interface ResearchRunStore {
  create(run: ResearchRunRecord): Promise<ResearchRunRecord>;
  get(
    organizationId: string,
    ownerUserId: string,
    id: string,
  ): Promise<ResearchRunRecord | null>;
  /** Newest first. */
  list(
    organizationId: string,
    ownerUserId: string,
    limit: number,
  ): Promise<ResearchRunRecord[]>;
  /** Idempotent; allowed on a terminal Run (it is a no-op flag by then). */
  requestStop(
    organizationId: string,
    ownerUserId: string,
    id: string,
  ): Promise<ResearchRunRecord>;
  /** running → terminal, exactly once. */
  complete(
    organizationId: string,
    ownerUserId: string,
    id: string,
    outcome: ResearchRunOutcomeUpdate,
    endedAtISO: string,
  ): Promise<ResearchRunRecord>;
  /** Append-only; refused once the Run is terminal. */
  appendStep(step: ResearchStepRecord): Promise<ResearchStepRecord>;
  /** Ordered by stepIndex, then insertion. */
  listSteps(
    organizationId: string,
    ownerUserId: string,
    runId: string,
  ): Promise<ResearchStepRecord[]>;
}

export class InMemoryResearchRunStore implements ResearchRunStore {
  #runs = new Map<string, ResearchRunRecord>();
  #steps = new Map<string, ResearchStepRecord[]>();

  #owned(
    organizationId: string,
    ownerUserId: string,
    id: string,
  ): ResearchRunRecord | null {
    const run = this.#runs.get(id);
    if (!run) return null;
    if (run.organizationId !== organizationId || run.ownerUserId !== ownerUserId) {
      return null;
    }
    return run;
  }

  async create(run: ResearchRunRecord): Promise<ResearchRunRecord> {
    if (this.#runs.has(run.id)) {
      throw new Error(`Research Run ${run.id} already exists`);
    }
    this.#runs.set(run.id, { ...run });
    this.#steps.set(run.id, []);
    return { ...run };
  }

  async get(
    organizationId: string,
    ownerUserId: string,
    id: string,
  ): Promise<ResearchRunRecord | null> {
    const run = this.#owned(organizationId, ownerUserId, id);
    return run ? { ...run } : null;
  }

  async list(
    organizationId: string,
    ownerUserId: string,
    limit: number,
  ): Promise<ResearchRunRecord[]> {
    return [...this.#runs.values()]
      .filter(
        (run) =>
          run.organizationId === organizationId && run.ownerUserId === ownerUserId,
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((run) => ({ ...run }));
  }

  async requestStop(
    organizationId: string,
    ownerUserId: string,
    id: string,
  ): Promise<ResearchRunRecord> {
    const run = this.#owned(organizationId, ownerUserId, id);
    if (!run) throw new ResearchRunNotFoundError(id);
    const updated = { ...run, stopRequested: true };
    this.#runs.set(id, updated);
    return { ...updated };
  }

  async complete(
    organizationId: string,
    ownerUserId: string,
    id: string,
    outcome: ResearchRunOutcomeUpdate,
    endedAtISO: string,
  ): Promise<ResearchRunRecord> {
    const run = this.#owned(organizationId, ownerUserId, id);
    if (!run) throw new ResearchRunNotFoundError(id);
    if (run.status !== "running") {
      throw new ResearchRunAlreadyTerminalError(id, run.status);
    }
    const updated: ResearchRunRecord = {
      ...run,
      status: outcome.status,
      stopReason: outcome.stopReason,
      brief: outcome.brief,
      citations: [...outcome.citations],
      blockedActions: [...outcome.blockedActions],
      injectionReports: [...outcome.injectionReports],
      stepsTaken: outcome.stepsTaken,
      endedAt: endedAtISO,
    };
    this.#runs.set(id, updated);
    return { ...updated };
  }

  async appendStep(step: ResearchStepRecord): Promise<ResearchStepRecord> {
    const run = this.#owned(step.organizationId, step.ownerUserId, step.runId);
    if (!run) throw new ResearchRunNotFoundError(step.runId);
    if (run.status !== "running") {
      throw new ResearchRunAlreadyTerminalError(step.runId, run.status);
    }
    const steps = this.#steps.get(step.runId);
    if (!steps) throw new ResearchRunNotFoundError(step.runId);
    steps.push({ ...step });
    return { ...step };
  }

  async listSteps(
    organizationId: string,
    ownerUserId: string,
    runId: string,
  ): Promise<ResearchStepRecord[]> {
    const run = this.#owned(organizationId, ownerUserId, runId);
    if (!run) return [];
    const steps = this.#steps.get(runId) ?? [];
    return [...steps]
      .sort((a, b) => a.stepIndex - b.stepIndex || a.createdAt.localeCompare(b.createdAt))
      .map((step) => ({ ...step }));
  }
}
