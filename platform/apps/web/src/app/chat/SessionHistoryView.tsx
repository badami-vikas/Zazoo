/**
 * SessionHistoryView — a past companion session, rendered READ-ONLY inside the
 * Chat panel.
 *
 * User directive 2026-08-16: *"I just want their session to be visible under
 * 'Chat' in the chat with date section dropdown. just for history of prompts
 * and results. It can be readonly"* — so a Research Run is not a mode you work
 * in here, it is a transcript you look back at. Everything live (start, stop,
 * resume, the step timeline as it unfolds) stays on the Research Runs Page,
 * which owns those actions; this surface has no buttons at all.
 *
 * It renders only what the kernel already recorded and the API already returns:
 * the objective the human typed, the engine-authored step summaries (never raw
 * page text — the server withholds quarantined text unless the executor itself
 * is resuming), the cited brief, and any blocked or injection-flagged steps.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";
import type { AskHistorySession } from "./ask-history";

export type ResearchRunRow = Awaited<
  ReturnType<typeof trpc.agentOrchestration.research.list.query>
>[number];
type StepRow = Awaited<
  ReturnType<typeof trpc.agentOrchestration.research.steps.query>
>[number];

export function researchRunLabel(run: ResearchRunRow): string {
  const when = new Date(run.startedAt).toLocaleDateString();
  const objective = run.objective.length > 48
    ? `${run.objective.slice(0, 48)}…`
    : run.objective;
  return `Research · ${objective} · ${when}`;
}

/**
 * A past Ask session: the screen-and-voice questions and the answers they got,
 * read back from this device's local history. Nothing here was ever sent to the
 * chat store — see `ask-history.ts` for why it stays local.
 */
export function AskSessionView({
  session,
  compact,
}: {
  session: AskHistorySession;
  compact: boolean;
}) {
  return (
    <div
      className={`flex-1 overflow-auto ${compact ? "p-3" : "p-4"} space-y-3 text-sm`}
      aria-label="Ask session history"
    >
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Ask · {new Date(session.startedAt).toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground">
          Screen-and-voice questions, kept on this device only.
        </p>
      </div>
      {session.turns.length === 0 && (
        <p className="text-xs text-muted-foreground">This session recorded no answers.</p>
      )}
      {session.turns.map((turn, index) => (
        <div key={`${turn.at}-${index}`} className="space-y-1 rounded-md border p-3">
          <p className="font-medium" style={{ color: "var(--color-navy)" }}>{turn.question}</p>
          <p className="whitespace-pre-wrap">{turn.answer}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(turn.at).toLocaleTimeString()} · {turn.provider}
            {turn.screenShared ? " · saw your screen" : " · no screen view"}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ResearchSessionView({
  run,
  compact,
}: {
  run: ResearchRunRow;
  compact: boolean;
}) {
  const [steps, setSteps] = useState<StepRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSteps(null);
    setError(null);
    trpc.agentOrchestration.research.steps
      .query({ organizationId: PILOT_ORGANIZATION, researchRunId: run.id })
      .then((rows) => {
        if (active) setSteps([...rows]);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Steps are unavailable");
      });
    return () => {
      active = false;
    };
  }, [run.id]);

  return (
    <div
      className={`flex-1 overflow-auto ${compact ? "p-3" : "p-4"} space-y-3 text-sm`}
      aria-label="Research session history"
    >
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Research · {new Date(run.startedAt).toLocaleString()}
          {run.endedAt ? ` → ${new Date(run.endedAt).toLocaleTimeString()}` : ""}
        </p>
        {/* The prompt, as typed. */}
        <p className="font-medium" style={{ color: "var(--color-navy)" }}>{run.objective}</p>
        <p className="text-xs text-muted-foreground">
          {run.status}
          {run.stopReason ? ` · ${run.stopReason.replace(/_/g, " ")}` : ""}
          {` · ${run.stepsTaken} step${run.stepsTaken === 1 ? "" : "s"}`}
        </p>
      </div>

      {run.brief ? (
        <div className="rounded-md border p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Brief
          </p>
          <p className="whitespace-pre-wrap">{run.brief}</p>
        </div>
      ) : (
        // A Run without a brief is an honest state (cancelled, failed, or still
        // going), not an empty card pretending to hold a result.
        <p className="text-xs text-muted-foreground">
          {run.status === "running"
            ? "This Run is still going — the Research Runs Page shows it live."
            : "This Run ended without a brief."}
        </p>
      )}

      {run.citations.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Citations
          </p>
          <ul className="space-y-0.5">
            {run.citations.map((url) => (
              <li key={url} className="truncate text-xs">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                  style={{ color: "var(--color-steel)" }}
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Steps
        </p>
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        {!error && steps === null && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3 animate-spin" /> Loading steps…
          </p>
        )}
        {steps?.length === 0 && (
          <p className="text-xs text-muted-foreground">No steps were recorded.</p>
        )}
        <ol className="space-y-1">
          {steps?.map((step) => (
            <li key={step.id} className="rounded border px-2 py-1 text-xs">
              <span className="font-medium">{step.stepIndex + 1}. {step.tool}</span>
              {" — "}
              {step.summary}
              {step.sourceUrl && (
                <span className="block truncate text-muted-foreground">{step.sourceUrl}</span>
              )}
            </li>
          ))}
        </ol>
      </div>

      {run.blockedActions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Blocked
          </p>
          <ul className="space-y-0.5 text-xs">
            {run.blockedActions.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}

      {run.injectionReports.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--danger)" }}>
            Injection attempts flagged
          </p>
          <ul className="space-y-0.5 text-xs">
            {run.injectionReports.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
