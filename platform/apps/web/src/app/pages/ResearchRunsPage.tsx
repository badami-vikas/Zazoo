/**
 * ResearchRunsPage (TASK-028) — the Run detail Page the research-agent plan
 * (§5 "Watch"/"Interrupt") names: every background Research Run with its step
 * timeline (tool, engine-authored evidence summary, source, untrusted-external
 * marker, child-Run id), the cited brief, and cross-surface interruption.
 *
 * Stop is COOPERATIVE: it raises `stopRequested` on the kernel record; the
 * executor polls that flag and ends at the next step edge. If the executor
 * died (an interrupted Run stays "running" with nothing driving it), the
 * secondary action closes the record honestly as cancelled — it never
 * fabricates an outcome.
 *
 * Quarantined page text is deliberately absent here: the kernel withholds it
 * unless the resuming executor asks, so this Page renders trusted summaries
 * only — untrusted content is marked, never displayed as prose.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Globe,
  FileSearch,
  MousePointerClick,
  Keyboard,
  StickyNote,
  Search,
  ShieldAlert,
  Radar,
} from "lucide-react";
import { Header } from "../components/shared/Header";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";

interface RunRow {
  id: string;
  objective: string;
  status: "running" | "completed" | "cancelled" | "failed";
  stopRequested: boolean;
  parentRunId: string;
  stopReason: string | null;
  brief: string | null;
  citations: readonly string[];
  blockedActions: readonly string[];
  injectionReports: readonly string[];
  stepsTaken: number;
  startedAt: string;
  endedAt: string | null;
}

interface StepRow {
  id: string;
  stepIndex: number;
  tool: "search" | "read" | "find" | "click" | "type" | "note";
  summary: string;
  sourceUrl: string | null;
  childRunId: string | null;
  quarantinedText: string | null;
  quarantinedSourceUrl: string | null;
  createdAt: string;
}

const TOOL_ICON = {
  search: Search,
  read: Globe,
  find: FileSearch,
  click: MousePointerClick,
  type: Keyboard,
  note: StickyNote,
} as const;

const STATUS_COLOR: Record<RunRow["status"], string> = {
  running: "var(--color-steel)",
  completed: "var(--color-forest, #2e7d32)",
  cancelled: "var(--color-navy-mid)",
  failed: "#b3261e",
};

function StatusBadge({ run }: { run: RunRow }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        color: STATUS_COLOR[run.status],
        backgroundColor: `color-mix(in srgb, ${STATUS_COLOR[run.status]} 12%, transparent)`,
      }}
    >
      {run.status}
      {run.status === "running" && run.stopRequested ? " · stop requested" : ""}
    </span>
  );
}

export function ResearchRunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stepsById, setStepsById] = useState<Record<string, StepRow[]>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = (await trpc.agentOrchestration.research.list.query({
        organizationId: PILOT_ORGANIZATION,
      })) as RunRow[];
      setRuns(rows);
      setLoadError(null);
      setSelectedId((prior) => prior ?? rows[0]?.id ?? null);
    } catch (caught) {
      setLoadError(
        caught instanceof Error ? caught.message : "Research Runs are unavailable",
      );
    }
  }, []);

  const refreshSteps = useCallback(async (runId: string) => {
    try {
      const rows = (await trpc.agentOrchestration.research.steps.query({
        organizationId: PILOT_ORGANIZATION,
        researchRunId: runId,
      })) as StepRow[];
      setStepsById((prior) => ({ ...prior, [runId]: rows }));
    } catch {
      // Selected-run steps refresh is best-effort; the list poll reports errors.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const selected = runs.find((run) => run.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    void refreshSteps(selectedId);
    if (selected?.status !== "running") return;
    const timer = setInterval(() => void refreshSteps(selectedId), 3_000);
    return () => clearInterval(timer);
  }, [selectedId, selected?.status, refreshSteps]);

  async function requestStop(run: RunRow) {
    setActionNote(null);
    try {
      await trpc.agentOrchestration.research.requestStop.mutate({
        organizationId: PILOT_ORGANIZATION,
        researchRunId: run.id,
      });
      setActionNote("Stop requested — the Run ends at its next step edge.");
      await refresh();
    } catch (caught) {
      setActionNote(caught instanceof Error ? caught.message : "Stop request failed");
    }
  }

  async function markInterrupted(run: RunRow) {
    setActionNote(null);
    try {
      await trpc.agentOrchestration.research.complete.mutate({
        organizationId: PILOT_ORGANIZATION,
        researchRunId: run.id,
        status: "cancelled",
        stopReason: "cancelled",
        brief: null,
        citations: [],
        blockedActions: [],
        injectionReports: [],
        stepsTaken: stepsById[run.id]?.length ?? 0,
      });
      setActionNote("Run closed as cancelled.");
      await refresh();
    } catch (caught) {
      setActionNote(
        caught instanceof Error
          ? caught.message
          : "Could not close the Run — it may have just finished on its own",
      );
      await refresh();
    }
  }

  const steps = selected ? (stepsById[selected.id] ?? []) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header tabs={[{ id: "Research Runs", icon: Radar }]} activeTab="Research Runs" onTabChange={() => {}} />
      {actionNote && (
        <div role="status" className="border-b px-4 py-2 text-xs" style={{ color: "var(--color-navy-mid)" }}>
          {actionNote}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r" style={{ borderColor: "var(--color-border)" }}>
          {loadError && (
            <p className="p-3 text-xs" style={{ color: "#b3261e" }}>
              {loadError}
            </p>
          )}
          {!loadError && runs.length === 0 && (
            <p className="p-3 text-xs" style={{ color: "var(--color-navy-mid)" }}>
              No Research Runs yet. Start one from the companion panel's Research tab.
            </p>
          )}
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(run.id)}
                  className="block w-full px-3 py-2 text-left text-sm"
                  style={{
                    backgroundColor: run.id === selectedId ? "var(--color-surface)" : "transparent",
                  }}
                >
                  <span className="line-clamp-2">{run.objective}</span>
                  <span className="mt-1 flex items-center gap-2 text-xs" style={{ color: "var(--color-navy-mid)" }}>
                    <StatusBadge run={run} />
                    {new Date(run.startedAt).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {!selected && (
            <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
              Select a Run to inspect its step timeline.
            </p>
          )}
          {selected && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{selected.objective}</h2>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--color-navy-mid)" }}>
                    <StatusBadge run={selected} />
                    <span>started {new Date(selected.startedAt).toLocaleString()}</span>
                    {selected.endedAt && <span>ended {new Date(selected.endedAt).toLocaleString()}</span>}
                    {selected.stopReason && <span>stopped: {selected.stopReason.replace(/_/g, " ")}</span>}
                  </p>
                </div>
                {selected.status === "running" && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void requestStop(selected)}
                      disabled={selected.stopRequested}
                      className="rounded border px-3 py-1 text-xs disabled:opacity-50"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      {selected.stopRequested ? "Stop requested" : "Stop"}
                    </button>
                    {selected.stopRequested && (
                      <button
                        type="button"
                        onClick={() => void markInterrupted(selected)}
                        className="rounded border px-3 py-1 text-xs"
                        style={{ borderColor: "var(--color-border)" }}
                        title="Close a Run whose executor is gone — records it as cancelled, never fabricates an outcome"
                      >
                        Mark as interrupted
                      </button>
                    )}
                  </div>
                )}
              </div>

              <section>
                <h3 className="mb-2 text-sm font-medium">Step timeline</h3>
                {steps.length === 0 && (
                  <p className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                    No steps recorded yet.
                  </p>
                )}
                <ol className="flex flex-col gap-2">
                  {steps.map((step) => {
                    const Icon = TOOL_ICON[step.tool] ?? StickyNote;
                    return (
                      <li
                        key={step.id}
                        className="rounded border p-2"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <div className="flex items-center gap-2 text-xs" style={{ color: "var(--color-navy-mid)" }}>
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="font-medium">
                            {step.stepIndex + 1} · {step.tool}
                          </span>
                          {step.quarantinedSourceUrl && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5"
                              style={{
                                color: "#8a5a00",
                                backgroundColor: "color-mix(in srgb, #8a5a00 12%, transparent)",
                              }}
                              title="This step gathered untrusted external text. It is quarantined and never shown or obeyed as instructions."
                            >
                              <ShieldAlert className="h-3 w-3" /> untrusted external
                            </span>
                          )}
                          {step.childRunId && (
                            <span title={`child Agent Run ${step.childRunId}`}>
                              run …{step.childRunId.slice(-8)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm">{step.summary}</p>
                        {step.sourceUrl && (
                          <p className="mt-0.5 truncate text-xs" style={{ color: "var(--color-navy-mid)" }}>
                            {step.sourceUrl}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>

              {selected.injectionReports.length > 0 && (
                <section className="text-xs" style={{ color: "#8a5a00" }}>
                  <h3 className="mb-1 text-sm font-medium">Injection attempts reported</h3>
                  {selected.injectionReports.map((line, index) => (
                    <p key={index}>⚠ {line}</p>
                  ))}
                </section>
              )}
              {selected.blockedActions.length > 0 && (
                <section className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                  <h3 className="mb-1 text-sm font-medium">Blocked actions</h3>
                  {selected.blockedActions.map((line, index) => (
                    <p key={index}>⛔ {line}</p>
                  ))}
                </section>
              )}

              {selected.brief && (
                <section>
                  <h3 className="mb-1 text-sm font-medium">Brief</h3>
                  <p className="whitespace-pre-wrap text-sm">{selected.brief}</p>
                </section>
              )}
              {selected.citations.length > 0 && (
                <section>
                  <h3 className="mb-1 text-sm font-medium">
                    Citations ({selected.citations.length})
                  </h3>
                  <ul className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                    {selected.citations.map((url) => (
                      <li key={url} className="truncate">
                        <a href={url} target="_blank" rel="noreferrer noopener">
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
