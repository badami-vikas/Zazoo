/**
 * The server-side Research Run executor (TASK-028, kernel-executor bridge).
 *
 * Until now the @bridge/research loop only ran inside the desktop overlay
 * webview, so "runs on its own in the background" was true only while the
 * companion panel was open on the user's Mac. This module is the kernel's own
 * executor: the same engine, the same bounds, the same authority model, driven
 * from the API process so a Run started from any surface keeps going.
 *
 * It owns NO governance of its own. Every outside-world edge is a hook the
 * caller supplies from the router's already-governed helpers — search is the
 * pipeline-proposed `web-research` Skill, planning is a receipted
 * ModelProvider call, each step lands as a terminal child Agent Run, and the
 * outcome freezes exactly once. That is what makes this file testable with no
 * network, no model, and no database.
 */
import {
  DEFAULT_RESEARCH_BOUNDS,
  runResearch,
  createChatPlanner,
  type ChatFn,
  type EvidenceEntry,
  type ResearchBounds,
  type ResearchDeps,
  type ResearchOutcome,
  type ResearchPageReader,
  type SearchHit,
  HttpPageReader,
} from "@bridge/research";
import { guardedFetch } from "@bridge/net-guard";
import type { ResearchRunOutcomeUpdate, ResearchStopReason } from "@bridge/core";

/** Bounds the server-side reader owns. Deliberately tighter than net-guard's
 * own 2MB default: a research page that needs more than this is not prose. */
const READER_MAX_BYTES = 512 * 1_024;
const READER_TIMEOUT_MS = 15_000;

/**
 * BR1 reading for the server executor: `HttpPageReader` over the ONE governed
 * network primitive (`guardedFetch`, SSRF/redirect/size guarded), adapted to
 * the `fetch` shape the reader takes. The final redirect URL is not carried
 * back — the reader falls back to the requested URL, which is the URL the
 * step evidence should cite anyway.
 */
export function createGuardedPageReader(): HttpPageReader {
  const fetchImpl = (async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    const result = await guardedFetch(url, {
      method: "GET",
      headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
      maxBytes: READER_MAX_BYTES,
      maxRedirects: 3,
      timeoutMs: READER_TIMEOUT_MS,
    });
    const contentType = result.headers["content-type"];
    return new Response(result.body, {
      status: result.status,
      headers: {
        "content-type": Array.isArray(contentType)
          ? (contentType[0] ?? "")
          : (contentType ?? ""),
      },
    });
  }) as typeof fetch;
  return new HttpPageReader({ fetchImpl, maxBytes: READER_MAX_BYTES, timeoutMs: READER_TIMEOUT_MS });
}

export interface ResearchExecutorHooks {
  /** Governed Tier-1 search (TASK-023 `web-research` Skill). */
  search(objective: string, query: string): Promise<readonly SearchHit[]>;
  /** One chat completion — a governed, receipted ModelProvider call. */
  chat: ChatFn;
  /** BR1 page reading. HTTP-backed here; the overlay uses its webview. */
  reader: ResearchPageReader;
  /** Durable step evidence + the terminal child Agent Run for the step. */
  appendStep(entry: EvidenceEntry): Promise<void>;
  /** BR4 resume: the kernel step ledger, replayed, never re-executed. */
  loadSteps(): Promise<readonly EvidenceEntry[]>;
  /** The cross-surface cooperative interrupt (`stopRequested`), read once per
   * executed step. */
  stopRequested(): Promise<boolean>;
  /** Freeze the outcome exactly once. */
  finish(outcome: ResearchRunOutcomeUpdate): Promise<void>;
  /** Non-fatal executor noise (a lost step record, a failed stop poll). */
  onWarning?(message: string): void;
}

export interface ExecuteResearchRunOptions {
  runId: string;
  objective: string;
  resume?: boolean;
  bounds?: Partial<ResearchBounds>;
}

/** The engine's StopReason decides the Run's terminal status — a bound is a
 * completed Run that stopped honestly, not a failure. */
export function statusForStopReason(
  reason: ResearchStopReason,
): Exclude<ResearchRunOutcomeUpdate["status"], "running"> {
  if (reason === "cancelled") return "cancelled";
  if (reason === "planner_failed" || reason === "executor_error") return "failed";
  return "completed";
}

function outcomeUpdate(outcome: ResearchOutcome): ResearchRunOutcomeUpdate {
  const brief = outcome.brief.trim();
  return {
    status: statusForStopReason(outcome.stopReason),
    stopReason: outcome.stopReason,
    brief: brief.length > 0 ? brief.slice(0, 20_000) : null,
    citations: [...new Set(outcome.citations)]
      .filter((url) => url.length > 0 && url.length <= 2_048)
      .slice(0, 200),
    blockedActions: outcome.blockedActions.map((line) => line.slice(0, 2_000)).slice(0, 50),
    injectionReports: outcome.injectionReports.map((line) => line.slice(0, 2_000)).slice(0, 50),
    stepsTaken: outcome.stepsTaken,
  };
}

/**
 * Run one Research Run to a terminal state. Never rejects: an executor that
 * throws still freezes the Run as `executor_error`, because a Run left
 * "running" with nothing driving it is the one outcome the Page cannot
 * describe honestly.
 */
export async function executeResearchRun(
  options: ExecuteResearchRunOptions,
  hooks: ResearchExecutorHooks,
): Promise<ResearchRunOutcomeUpdate> {
  const signal = { aborted: false };
  // The stop flag is refreshed once per EXECUTED step, immediately after its
  // evidence lands — so the engine's next loop-top check sees it and the Run
  // ends at the very next step edge. A timer would be either laxer (a poll
  // interval of latency) or wasteful (polling a database while a page loads).
  const refreshStop = async (): Promise<void> => {
    try {
      if (await hooks.stopRequested()) signal.aborted = true;
    } catch (caught) {
      hooks.onWarning?.(`stop check failed: ${String(caught)}`);
    }
  };

  const deps: ResearchDeps = {
    signal,
    search: { search: (objective, query) => hooks.search(objective, query) },
    reader: hooks.reader,
    planner: createChatPlanner(hooks.chat),
    ledger: {
      async append(_runId, entry) {
        try {
          await hooks.appendStep(entry);
        } catch (caught) {
          // Losing one durable step record must not kill a live Run; the
          // engine's in-memory evidence still stands and the loss is reported.
          hooks.onWarning?.(`step record failed: ${String(caught)}`);
        }
        await refreshStop();
      },
      load: () => hooks.loadSteps(),
    },
    // No actuator and no proposal channel: green tools only. The engine
    // blocks amber steps honestly rather than this file inventing authority.
  };

  let update: ResearchRunOutcomeUpdate;
  try {
    const outcome = await runResearch(
      {
        runId: options.runId,
        objective: options.objective,
        bounds: { ...DEFAULT_RESEARCH_BOUNDS, ...options.bounds },
        ...(options.resume ? { resume: true } : {}),
      },
      deps,
    );
    update = outcomeUpdate(outcome);
  } catch (caught) {
    update = {
      status: "failed",
      stopReason: "executor_error",
      brief: null,
      citations: [],
      blockedActions: [],
      injectionReports: [],
      stepsTaken: 0,
    };
    hooks.onWarning?.(`executor failed: ${String(caught)}`);
  }

  try {
    await hooks.finish(update);
  } catch (caught) {
    // The Run may have been closed by another surface between our last step
    // and here (complete-once is enforced by the store); that is a race, not
    // a corruption, and the store's record wins.
    hooks.onWarning?.(`could not freeze the outcome: ${String(caught)}`);
  }
  return update;
}
