/**
 * ResearchRun — the "Research this" surface (TASK-028).
 *
 * Runs the @bridge/research engine IN THIS OVERLAY WEBVIEW with its ports
 * wired to what the desktop already provides:
 *  - search  → the governed `skill.webResearch` tRPC procedure (TASK-023 —
 *              Tier-1 keyless, quarantined, cited)
 *  - read    → `research_read_page` (contained always-on-bottom webview;
 *              outbound-only text channel)
 *  - find    → `research_locate` (Set-of-Mark grid over the reader window's
 *              own image)
 *  - planner → createChatPlanner over `research_chat` (the Groq key never
 *              enters this webview)
 *
 * KERNEL-RUN MIGRATION (this slice): the Run itself is now a durable,
 * owner-scoped kernel record — `agentOrchestration.research.start` mints it,
 * every executed step lands through `recordStep` as a terminal child Agent
 * Run plus append-only evidence (the engine's ledger port), `requestStop` is
 * honored cross-surface via a light `get` poll, and the outcome freezes
 * exactly once through `complete`. An interrupted Run (executor died) is
 * offered for BR4 resume here, replaying the kernel step ledger without
 * re-executing anything. Still no actuator and no proposal channel: green
 * tools only; the engine blocks amber steps honestly.
 */
import { useEffect, useRef, useState } from "react";
import {
  runResearch,
  createChatPlanner,
  type ChatMessage,
  type EvidenceEntry,
  type ResearchDeps,
  type ResearchOutcome,
  type SearchHit,
} from "@bridge/research";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { tauriInvokeStrict } from "./tauri-internals";
import { setAvatarStatus } from "./avatar-store";

interface PageExtract {
  url: string;
  title: string;
  text: string;
}

interface Located {
  ref: string;
  description: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface KernelRunRef {
  id: string;
  objective: string;
}

/**
 * Shell commands reject with typed {code, message} objects and tRPC with its
 * own error class; normalise BOTH into real Errors so the engine's history —
 * which the planner reads to decide its next step — never says
 * "[object Object]" where the cause should be.
 */
function toError(caught: unknown): Error {
  if (caught instanceof Error) return caught;
  if (caught && typeof caught === "object") {
    const record = caught as Record<string, unknown>;
    if (typeof record.message === "string") {
      return new Error(
        typeof record.code === "string"
          ? `${record.code}: ${record.message}`
          : record.message,
      );
    }
  }
  return new Error(String(caught));
}

/** FNV-1a — same evidence fingerprint the HTTP reader records. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Server-side zod bounds, applied defensively before the wire. */
function cap(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function boundedUrl(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // Truncating a URL corrupts it; a degenerate over-long one is dropped.
  return trimmed.length > 0 && trimmed.length <= 2_048 ? trimmed : null;
}

/**
 * The webResearch mutation returns a governed proposal envelope whose exact
 * nesting belongs to the pipeline; rather than coupling this prototype to it,
 * walk the result for the citations array the output schema guarantees.
 */
function findCitations(value: unknown, depth = 0): SearchHit[] | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const citations = record.citations;
  if (Array.isArray(citations) && citations.length > 0) {
    const hits: SearchHit[] = [];
    for (const entry of citations) {
      if (entry === null || typeof entry !== "object") continue;
      const cite = entry as Record<string, unknown>;
      if (typeof cite.url !== "string" || typeof cite.summary !== "string") continue;
      hits.push({
        url: cite.url,
        title: null,
        excerpt: cite.summary,
        providerId: typeof cite.providerId === "string" ? cite.providerId : "web-research",
        retrievedAt:
          typeof cite.retrievedAt === "string" ? cite.retrievedAt : new Date().toISOString(),
      });
    }
    if (hits.length > 0) return hits;
  }
  for (const child of Object.values(record)) {
    const found = findCitations(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function ResearchRun() {
  const [objective, setObjective] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ResearchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumable, setResumable] = useState<KernelRunRef | null>(null);
  const abortRef = useRef({ aborted: false });
  const kernelRunRef = useRef<string | null>(null);

  function report(line: string) {
    setSteps((prior) => [...prior, line]);
  }

  // BR4 — surface the newest Run whose executor died mid-loop (status still
  // "running" in the kernel with nothing driving it) for an honest resume.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const runs = await trpc.agentOrchestration.research.list.query({
          organizationId: PILOT_ORGANIZATION,
        });
        const interrupted = runs.find((run) => run.status === "running");
        if (!cancelled && interrupted) {
          setResumable({ id: interrupted.id, objective: interrupted.objective });
        }
      } catch {
        // The kernel may be starting up; resume stays unavailable, honestly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function discardResumable() {
    if (!resumable) return;
    try {
      await trpc.agentOrchestration.research.requestStop.mutate({
        organizationId: PILOT_ORGANIZATION,
        researchRunId: resumable.id,
      });
      await trpc.agentOrchestration.research.complete.mutate({
        organizationId: PILOT_ORGANIZATION,
        researchRunId: resumable.id,
        status: "cancelled",
        stopReason: "cancelled",
        brief: null,
        citations: [],
        blockedActions: [],
        injectionReports: [],
        stepsTaken: 0,
      });
    } catch (caught) {
      report(`Could not close the interrupted Run: ${toError(caught).message}`);
    }
    setResumable(null);
  }

  async function start(resume?: KernelRunRef) {
    const trimmed = resume ? resume.objective : objective.trim();
    if (!trimmed || running) return;
    setRunning(true);
    setSteps([]);
    setOutcome(null);
    setError(null);
    abortRef.current = { aborted: false };
    setAvatarStatus("reading_context");

    // The kernel Run record is minted FIRST — no kernel, no Run. Every step
    // below lands against it as an inspectable child Run.
    let kernelRun: KernelRunRef;
    try {
      if (resume) {
        kernelRun = resume;
        report("Resuming the interrupted Run from its kernel ledger…");
      } else {
        const created = await trpc.agentOrchestration.research.start.mutate({
          organizationId: PILOT_ORGANIZATION,
          objective: cap(trimmed, 500),
        });
        kernelRun = { id: created.id, objective: created.objective };
      }
    } catch (caught) {
      setError(`Could not start a kernel Research Run: ${toError(caught).message}`);
      setRunning(false);
      setAvatarStatus("idle");
      return;
    }
    kernelRunRef.current = kernelRun.id;
    setResumable(null);

    // Cross-surface interrupt: the Run detail Page's Stop button raises
    // stopRequested in the kernel; this poll folds it into the engine's
    // cooperative abort signal at the next step edge.
    const stopPoll = setInterval(() => {
      void trpc.agentOrchestration.research.get
        .query({ organizationId: PILOT_ORGANIZATION, researchRunId: kernelRun.id })
        .then((run) => {
          if (run?.stopRequested) abortRef.current.aborted = true;
        })
        .catch(() => undefined);
    }, 3_000);

    const deps: ResearchDeps = {
      signal: abortRef.current,
      ledger: {
        async append(runId, entry) {
          try {
            await trpc.agentOrchestration.research.recordStep.mutate({
              organizationId: PILOT_ORGANIZATION,
              researchRunId: runId,
              stepIndex: entry.stepIndex,
              tool: entry.tool,
              summary: cap(entry.summary, 4_000),
              sourceUrl: boundedUrl(entry.sourceUrl),
              quarantined:
                entry.quarantined && boundedUrl(entry.quarantined.sourceUrl)
                  ? {
                      sourceUrl: boundedUrl(entry.quarantined.sourceUrl) as string,
                      text: cap(entry.quarantined.text, 400_000),
                    }
                  : null,
            });
          } catch (caught) {
            // Losing one kernel step record must not kill a live Run; it is
            // reported, and the engine's own in-memory evidence still stands.
            report(`Step record failed: ${toError(caught).message}`);
          }
        },
        async load(runId) {
          const rows = await trpc.agentOrchestration.research.steps.query({
            organizationId: PILOT_ORGANIZATION,
            researchRunId: runId,
            includeQuarantined: true,
          });
          return rows.map((row) => ({
            stepIndex: row.stepIndex,
            tool: row.tool,
            summary: row.summary,
            sourceUrl: row.sourceUrl,
            ...(row.quarantinedText && row.quarantinedSourceUrl
              ? {
                  quarantined: {
                    trustOrigin: "untrusted_external" as const,
                    taintLabel: "untrusted_external" as const,
                    sourceUrl: row.quarantinedSourceUrl,
                    text: row.quarantinedText,
                  },
                }
              : {}),
          }));
        },
      },
      planner: createChatPlanner(async (messages: readonly ChatMessage[]) => {
        try {
          return (await tauriInvokeStrict("research_chat", {
            messages: messages.map((message) => ({ ...message })),
          })) as string;
        } catch (caught) {
          throw toError(caught);
        }
      }),
      search: {
        async search(runObjective, query) {
          report(`Searching: ${query}`);
          let raw: unknown;
          try {
            raw = await trpc.agentOrchestration.skill.webResearch.mutate({
              organizationId: PILOT_ORGANIZATION,
              objective: runObjective.slice(0, 500),
              scope: "public_web",
              searchQueries: [query.slice(0, 160)],
              budget: {
                maxResults: 5,
                maxResponseBytes: 256 * 1024,
                maxProviderAttempts: 2,
                timeoutMs: 10_000,
              },
            });
          } catch (caught) {
            const normalised = toError(caught);
            report(`Search failed: ${normalised.message}`);
            throw normalised;
          }
          const hits = findCitations(raw) ?? [];
          report(hits.length > 0 ? `Found ${hits.length} result(s)` : "No results");
          return hits;
        },
      },
      reader: {
        async read(url) {
          report(`Reading: ${url}`);
          let page: PageExtract;
          try {
            page = (await tauriInvokeStrict("research_read_page", { url })) as PageExtract;
          } catch (caught) {
            const normalised = toError(caught);
            report(`Read failed: ${normalised.message}`);
            throw normalised;
          }
          return {
            url: page.url,
            title: page.title || null,
            text: page.text,
            retrievedAt: new Date().toISOString(),
            contentHash: fingerprint(page.text),
            bytes: page.text.length,
          };
        },
      },
      locator: {
        async find(description) {
          report(`Locating: ${description}`);
          let located: Located | null;
          try {
            located = (await tauriInvokeStrict("research_locate", {
              description,
            })) as Located | null;
          } catch (caught) {
            const normalised = toError(caught);
            report(`Locate failed: ${normalised.message}`);
            throw normalised;
          }
          return located
            ? { ...located, ref: located.ref, description: located.description }
            : null;
        },
      },
      // No actuator and no proposal channel on purpose: this prototype is
      // green-tools-only, and the engine blocks amber steps honestly.
    };

    try {
      const result = await runResearch(
        { runId: kernelRun.id, objective: trimmed, ...(resume ? { resume: true } : {}) },
        deps,
      );
      setOutcome(result);
      try {
        const brief = result.brief.trim();
        await trpc.agentOrchestration.research.complete.mutate({
          organizationId: PILOT_ORGANIZATION,
          researchRunId: kernelRun.id,
          status:
            result.stopReason === "cancelled"
              ? "cancelled"
              : result.stopReason === "planner_failed"
                ? "failed"
                : "completed",
          stopReason: result.stopReason,
          brief: brief.length > 0 ? cap(brief, 20_000) : null,
          citations: [...new Set(result.citations)]
            .filter((url) => url.length > 0 && url.length <= 2_048)
            .slice(0, 200),
          blockedActions: result.blockedActions.map((line) => cap(line, 2_000)).slice(0, 50),
          injectionReports: result.injectionReports
            .map((line) => cap(line, 2_000))
            .slice(0, 50),
          stepsTaken: Math.min(result.stepsTaken, 999),
        });
      } catch (caught) {
        report(`Outcome record failed: ${toError(caught).message}`);
      }
    } catch (caught) {
      const normalised = toError(caught);
      setError(normalised.message);
      // The executor itself failed — freeze the kernel record honestly so it
      // is never offered for resume as if it were merely interrupted.
      void trpc.agentOrchestration.research.complete
        .mutate({
          organizationId: PILOT_ORGANIZATION,
          researchRunId: kernelRun.id,
          status: "failed",
          stopReason: "executor_error",
          brief: null,
          citations: [],
          blockedActions: [],
          injectionReports: [],
          stepsTaken: 0,
        })
        .catch(() => undefined);
    } finally {
      clearInterval(stopPoll);
      kernelRunRef.current = null;
      setRunning(false);
      setAvatarStatus("idle");
      // The reader window has served its purpose for this Run.
      void tauriInvokeStrict("research_close").catch(() => undefined);
    }
  }

  function stop() {
    abortRef.current.aborted = true;
    const kernelRunId = kernelRunRef.current;
    if (kernelRunId) {
      void trpc.agentOrchestration.research.requestStop
        .mutate({ organizationId: PILOT_ORGANIZATION, researchRunId: kernelRunId })
        .catch(() => undefined);
    }
    report("Stopping after the current step…");
  }

  return (
    <div className="flex flex-col gap-2 p-3 text-sm" style={{ minHeight: 0, overflowY: "auto" }}>
      <p className="text-xs text-[var(--color-navy-mid)]">
        A background Research Run: searches the public web, reads pages in a contained
        always-on-bottom browser window you can watch, and returns a cited brief. It never
        clicks, types, or signs in. Every step is inspectable on the Research Runs page.
      </p>
      {resumable && !running && (
        <div className="flex flex-col gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
          <p className="text-xs">
            An earlier Run was interrupted: <em>{resumable.objective}</em>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void start(resumable)}
              className="rounded bg-[var(--color-navy)] px-2 py-0.5 text-xs text-white"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={() => void discardResumable()}
              className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs"
            >
              Discard
            </button>
          </div>
        </div>
      )}
      <textarea
        value={objective}
        onChange={(event) => setObjective(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void start();
          }
        }}
        placeholder="What should Bridge research?"
        rows={2}
        disabled={running}
        className="w-full rounded border border-[var(--color-border)] bg-white p-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void start()}
          disabled={running || objective.trim().length === 0}
          className="rounded bg-[var(--color-navy)] px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {running ? "Researching…" : "Research this"}
        </button>
        {running && (
          <button
            type="button"
            onClick={stop}
            className="rounded border border-[var(--color-border)] px-3 py-1 text-xs"
          >
            Stop
          </button>
        )}
      </div>
      {steps.length > 0 && (
        <ul className="text-xs text-muted-foreground">
          {steps.map((line, index) => (
            <li key={index}>• {line}</li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {outcome && (
        <div className="flex flex-col gap-1">
          <p className="whitespace-pre-wrap">{outcome.brief}</p>
          <p className="text-xs text-muted-foreground">
            {outcome.stepsTaken} step(s) · stopped: {outcome.stopReason.replace(/_/g, " ")}
          </p>
          {outcome.injectionReports.length > 0 && (
            <div className="text-xs text-amber-700">
              {outcome.injectionReports.map((line, index) => (
                <p key={index}>⚠ {line}</p>
              ))}
            </div>
          )}
          {outcome.blockedActions.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {outcome.blockedActions.map((line, index) => (
                <p key={index}>⛔ {line}</p>
              ))}
            </div>
          )}
          {outcome.citations.length > 0 && (
            <ul className="text-xs text-[var(--color-navy-mid)]">
              {outcome.citations.map((url) => (
                <li key={url} className="truncate">
                  {url}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Evidence view kept minimal on purpose; the Run detail Page owns depth. */
export type { EvidenceEntry };
