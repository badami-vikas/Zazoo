/**
 * The Automation scheduler host (ADR-179) — the impure half of
 * `@bridge/core`'s `automation-trigger.ts`.
 *
 * Core decides WHICH Automations are due at an instant handed to it. This file
 * owns the things core must not: a real clock, a timer, the registry and run
 * recorder, and the executor. `runSchedulerTick` is exported separately from
 * the timer so the whole behaviour is testable by calling it, without waiting
 * on wall time.
 *
 * What this replaces: one `setInterval(..., 15 * 60_000)` in server.ts wired to
 * a single hardcoded automation id. Any Automation that declared a schedule got
 * nothing. Now the cadence comes from the Automation's own trigger.
 *
 * What it deliberately does NOT do: widen authority. A scheduled Run is started
 * through the same `AutomationExecutor.runById` a human Run uses, so it is
 * proposed as the Automation's own Agent under exactly the scope that Agent
 * already had. A clock cannot buy permission.
 */
import {
  SeededRng,
  SystemClock,
  UuidGen,
  dueAutomations,
  hashTaintValue,
  labelAtSource,
  undispatchedTriggers,
  type AutomationExecutor,
  type AutomationRegistry,
  type AutomationRunRecorder,
  type AutomationScheduleState,
  type RunCtx,
  type UniversalActionPipeline,
  automationProposalKey,
} from "@bridge/core";

export interface AutomationSchedulerDeps {
  registry: AutomationRegistry;
  runRecorder: AutomationRunRecorder;
  executor: AutomationExecutor;
  organizationId: string;
  /** When present, every tick first withdraws stale duplicate proposals (see
   * `supersedeDuplicateProposals`). Optional so isolated tests need no pipeline. */
  pipeline?: Pick<UniversalActionPipeline, "openAutomationProposals" | "supersede">;
  log: {
    info: (obj: unknown, msg: string) => void;
    warn: (obj: unknown, msg: string) => void;
    error: (obj: unknown, msg: string) => void;
  };
}

export interface SchedulerTickResult {
  /** Automation ids started on this tick. */
  started: string[];
  /** Automation ids that were due but whose Run did not complete cleanly. */
  failed: { automationId: string; reason: string }[];
  /** Considered but not due. Reported so a quiet tick is legible in logs. */
  consideredCount: number;
}

/**
 * The RunCtx for a scheduled start. Copied in shape from the hand-rolled one
 * the learning digest used, and now the ONLY place that shape is built, so a
 * second scheduled Automation cannot end up with a subtly different label.
 *
 * The taint label is explicit because the sink gate fails closed on UNKNOWN: a
 * scheduled trigger has no human in the loop and no external content, so it is
 * `system_generated` with `instructionRisk: "data"`.
 */
export function scheduledRunCtx(automationId: string): RunCtx {
  const clock = new SystemClock();
  const seed = clock.nowMs() >>> 0;
  return {
    clock,
    rng: new SeededRng(seed),
    ids: new UuidGen(clock, new SeededRng(seed)),
    taintLabel: labelAtSource("system_generated", {
      ref: `schedule:${automationId}`,
      valueHash: hashTaintValue({ automationId }),
      sensitivity: "organization",
      instructionRisk: "data",
    }),
  };
}

/**
 * Build the scheduling state for every ACTIVE Automation.
 *
 * `lastStartedAt` comes from the durable `automation_runs` rows rather than an
 * in-process memory, so a restart does not re-fire every scheduled Automation.
 * That distinction matters more than it looks: the API restarts on every
 * deploy, and an in-memory cursor would turn "we shipped a fix" into "every
 * Automation in the Organization ran again."
 */
export async function readScheduleStates(
  deps: Pick<AutomationSchedulerDeps, "registry" | "runRecorder" | "organizationId">,
): Promise<AutomationScheduleState[]> {
  const active = await deps.registry.listByStatus(deps.organizationId, "active");
  if (active.length === 0) return [];

  const ids = active.map((definition) => definition.id);
  // One query for the batch; the recorder returns newest-first, so the first
  // row seen per automation id is its most recent start.
  const runs = await deps.runRecorder.list(deps.organizationId, ids, { limit: 500 });
  const lastStartedAt = new Map<string, string>();
  for (const run of runs) {
    const seen = lastStartedAt.get(run.automationId);
    if (seen === undefined || run.startedAt > seen) {
      lastStartedAt.set(run.automationId, run.startedAt);
    }
  }

  return active.map((definition) => ({
    automationId: definition.id,
    organizationId: deps.organizationId,
    trigger: definition.trigger ?? { kind: "manual" as const },
    lastStartedAt: lastStartedAt.get(definition.id),
  }));
}

/**
 * One scheduler pass. Safe to call directly — that is how it is tested.
 *
 * A failing Automation never aborts the batch: each due Run is isolated, so one
 * broken Automation cannot silently stop every other scheduled Automation in
 * the Organization. That is the specific way a scheduler usually fails
 * invisibly, and it is the reason the per-item try/catch is here rather than a
 * single try around the loop.
 */
export async function runSchedulerTick(
  deps: AutomationSchedulerDeps,
  now: Date = new Date(),
): Promise<SchedulerTickResult> {
  if (deps.pipeline) {
    const superseded = await supersedeDuplicateProposals(deps.pipeline, deps.organizationId, scheduledRunCtx("sweep"));
    if (superseded > 0) deps.log.info({ superseded }, "stale duplicate Automation proposals withdrawn");
  }
  const states = await readScheduleStates(deps);
  const due = dueAutomations(states, now);
  const result: SchedulerTickResult = {
    started: [],
    failed: [],
    consideredCount: states.length,
  };

  for (const item of due) {
    try {
      const outcome = await deps.executor.runById(
        { organizationId: item.organizationId, automationId: item.automationId },
        scheduledRunCtx(item.automationId),
      );
      if (outcome.status === "completed") {
        result.started.push(item.automationId);
      } else {
        // A halt is a governed outcome (a step was rejected), not a crash. It
        // still counts as STARTED for scheduling purposes — the interval runs
        // from the attempt, or a rejected Automation would retry every tick.
        result.started.push(item.automationId);
        deps.log.warn(
          { automationId: item.automationId, runId: outcome.runId, status: outcome.status },
          "scheduled Automation halted",
        );
      }
    } catch (err) {
      result.failed.push({
        automationId: item.automationId,
        reason: err instanceof Error ? err.message : String(err),
      });
      deps.log.error({ err, automationId: item.automationId }, "scheduled Automation failed");
    }
  }

  return result;
}

export interface AutomationSchedulerHandle {
  stop(): void;
}

export interface AutomationSchedulerOpts {
  /** How often to evaluate due-ness. Default 60s — the resolution of the
   * schedule, NOT the cadence of any Automation. */
  tickMs?: number;
  /** Delay before the first tick, so boot latency stays flat. */
  bootDelayMs?: number;
}

/**
 * Start the scheduler loop. Returns a handle whose `stop()` is idempotent.
 *
 * At startup it reports every Automation whose declared trigger CANNOT fire
 * with the machinery that exists (today: all `event` triggers). Saying it out
 * loud is the point — a declared trigger that silently never runs is exactly
 * the "docs assert behaviour code lacks" defect this scheduler was built to
 * end, and it would be absurd to close that gap while opening a new one.
 */
export function startAutomationScheduler(
  deps: AutomationSchedulerDeps,
  opts: AutomationSchedulerOpts = {},
): AutomationSchedulerHandle {
  const tickMs = opts.tickMs ?? 60_000;
  const bootDelayMs = opts.bootDelayMs ?? 30_000;
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const result = await runSchedulerTick(deps);
      if (result.started.length > 0 || result.failed.length > 0) {
        deps.log.info(
          {
            started: result.started,
            failed: result.failed,
            considered: result.consideredCount,
          },
          "automation scheduler tick",
        );
      }
    } catch (err) {
      // A failure to READ the schedule must not kill the loop, or one bad
      // query would permanently stop every Automation until the next deploy.
      deps.log.error({ err }, "automation scheduler tick failed");
    } finally {
      running = false;
    }
  };

  void (async () => {
    try {
      const states = await readScheduleStates(deps);
      for (const gap of undispatchedTriggers(states)) {
        deps.log.warn(gap, "Automation declares a trigger that cannot fire yet");
      }
    } catch (err) {
      deps.log.error({ err }, "automation scheduler startup report failed");
    }
  })();

  const bootTimer = setTimeout(() => void tick(), bootDelayMs);
  bootTimer.unref?.();
  const interval = setInterval(() => void tick(), tickMs);
  interval.unref?.();

  return {
    stop() {
      stopped = true;
      clearTimeout(bootTimer);
      clearInterval(interval);
    },
  };
}

/**
 * Collapse every set of identical undecided Automation proposals to its newest
 * member (ADR 2026-09-04 "Approvals belong to Tasks"). The executor no longer
 * creates such duplicates; this clears the ones a Local Plane already holds —
 * on the first tick after upgrade, and again if anything else ever piles up.
 * Returns how many rows were withdrawn.
 */
export async function supersedeDuplicateProposals(
  pipeline: Pick<UniversalActionPipeline, "openAutomationProposals" | "supersede">,
  organizationId: string,
  ctx: RunCtx,
): Promise<number> {
  const pending: { id: string; key: string; createdAt: string }[] = [];
  for (const entry of await pipeline.openAutomationProposals(organizationId)) {
    const key = automationProposalKey(entry);
    if (key) pending.push({ id: entry.id, key, createdAt: entry.createdAt });
  }
  const newestByKey = new Map<string, string>();
  for (const row of [...pending].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (!newestByKey.has(row.key)) newestByKey.set(row.key, row.id);
  }
  let superseded = 0;
  for (const row of pending) {
    const newest = newestByKey.get(row.key);
    if (!newest || newest === row.id) continue;
    await pipeline.supersede(row.id, newest, ctx);
    superseded += 1;
  }
  return superseded;
}
