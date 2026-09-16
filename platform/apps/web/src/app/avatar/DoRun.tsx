/**
 * DoRun — the "Do" body of the companion panel: give the companion a task
 * and it performs it with the real mouse and keyboard (`act.rs`), narrating
 * every step as it goes and stopping the instant you touch the mouse or
 * press Stop.
 *
 * Govern before executing, surfaced at the point of use:
 *  - the mouse/keyboard switch is explicit, default OFF, persisted per
 *    device, and sent with every request (the shell refuses without it);
 *  - the copy states that one screenshot per step goes to Groq;
 *  - macOS Accessibility is checked first and the grant is one click away.
 */
import { useEffect, useRef, useState } from "react";
import { setAvatarStatus } from "./avatar-store";
import { tauriInvoke, tauriInvokeStrict, tauriListen } from "./tauri-internals";

export const AVATAR_ALLOW_CONTROL_KEY = "bridge:avatar:allow_control";

export const AVATAR_ALLOWED_APPS_KEY = "bridge:avatar:allowed_apps";

export function readAllowControl() {
  try { return localStorage.getItem(AVATAR_ALLOW_CONTROL_KEY) === "true"; } catch { return false; }
}
function readAllowedApps() {
  try { return localStorage.getItem(AVATAR_ALLOWED_APPS_KEY) ?? ""; } catch { return ""; }
}

interface StepEvent {
  index: number;
  say: string;
  action: string;
  target: string;
  status: "planning" | "acting" | "ok" | "failed";
}

interface ActOutcome {
  status: "done" | "failed" | "stopped" | "bounded" | "paused";
  summary: string;
  steps: number;
}

interface PausedSummary {
  task: string;
  steps: number;
  guide: boolean;
}

export function DoRun({
  name,
  capabilities,
  initialTask,
  speak,
  onSaid,
}: {
  name: string;
  capabilities: { cloudVision: boolean; accessibility: boolean } | null;
  initialTask: string;
  speak: boolean;
  onSaid?: (text: string, emotion?: string) => void;
}) {
  const [task, setTask] = useState(initialTask);
  const [allowControl, setAllowControl] = useState(readAllowControl);
  const [allowedApps, setAllowedApps] = useState(readAllowedApps);
  const [guide, setGuide] = useState(false);
  const [accessibility, setAccessibility] = useState(Boolean(capabilities?.accessibility));
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [outcome, setOutcome] = useState<ActOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void tauriListen<StepEvent>("bridge:act-step", (step) => {
      setSteps((prev) => {
        const next = prev.filter((s) => s.index !== step.index);
        next.push(step);
        return next.sort((a, b) => a.index - b.index);
      });
      if (step.status === "acting" && step.say) onSaid?.(step.say, "focused");
    }).then((stop) => { unlisten = stop; });
    return () => unlisten?.();
    // Mount-only on purpose (no react-hooks plugin in this repo's ESLint config).
  }, []);

  useEffect(() => {
    setAccessibility(Boolean(capabilities?.accessibility));
  }, [capabilities]);

  // A run that handed you manual work survives the panel closing: offer
  // Continue again, and a typed "continue" resumes it straight away.
  useEffect(() => {
    void (async () => {
      const paused = (await tauriInvoke("act_paused")) as PausedSummary | null | undefined;
      if (!paused) return;
      setTask(paused.task);
      setGuide(paused.guide);
      setOutcome({ status: "paused", summary: "Your turn — press Continue when you're ready.", steps: paused.steps });
      if (initialTask.trim().toLowerCase() === "continue") void start(paused.guide, true);
    })();
    // Mount-only on purpose.
  }, []);

  async function refreshAccessibility() {
    const granted = (await tauriInvoke("ax_permission_status")) === true;
    setAccessibility(granted);
    if (!granted) void tauriInvoke("ax_request_permission");
  }

  async function start(asGuide = false, resume = false) {
    const trimmed = task.trim();
    if ((!trimmed && !resume) || runningRef.current) return;
    runningRef.current = true;
    setGuide(asGuide);
    setRunning(true);
    setSteps([]);
    setOutcome(null);
    setError(null);
    setAvatarStatus("drafting");
    try {
      const job = (await tauriInvokeStrict("act_start", {
        request: {
          task: trimmed,
          allowControl,
          speak,
          guide: asGuide,
          allowedApps: allowedApps.split(",").map((a) => a.trim()).filter(Boolean),
          resume,
        },
      })) as number;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const poll = (await tauriInvokeStrict("act_poll", { job })) as { done: boolean; outcome?: ActOutcome };
        if (poll.done) {
          setOutcome(poll.outcome ?? null);
          if (poll.outcome?.summary) {
            onSaid?.(poll.outcome.summary, poll.outcome.status === "done" ? "happy" : poll.outcome.status === "paused" ? "curious" : "thinking");
          }
          break;
        }
      }
    } catch (raised) {
      const typed = raised as { code?: unknown; message?: unknown };
      setError(String(typed?.message ?? raised));
      if (typed?.code === "ACT_NO_ACCESSIBILITY") setAccessibility(false);
    } finally {
      runningRef.current = false;
      setRunning(false);
      setAvatarStatus("idle");
    }
  }

  const canRun = Boolean(capabilities?.cloudVision) && allowControl && accessibility;
  const canGuide = Boolean(capabilities?.cloudVision);

  return (
    <div className="flex flex-col gap-2 p-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Hands mode — {name} moves your mouse and types to do a task, one step at a time, and
        stops the moment you move the mouse. One screenshot per step is sent to Groq.
      </p>
      {capabilities && !capabilities.cloudVision && (
        <p className="text-xs text-muted-foreground">
          Doing tasks needs a Groq API key in Settings → API Keys.
        </p>
      )}
      <div className="rounded-[var(--radius-button)] border border-border px-2 py-2">
        <div className="flex items-center gap-2">
          <input
            id="companion-allow-control"
            type="checkbox"
            checked={allowControl}
            disabled={running}
            onChange={(event) => {
              const enabled = event.target.checked;
              setAllowControl(enabled);
              try { localStorage.setItem(AVATAR_ALLOW_CONTROL_KEY, enabled ? "true" : "false"); } catch { /* per-device convenience only */ }
            }}
            className="rounded"
          />
          <label htmlFor="companion-allow-control" className="text-xs font-medium text-[var(--color-navy)]">
            Let {name} use my mouse and keyboard
          </label>
        </div>
        {!accessibility && (
          <div className="mt-1 flex items-center justify-between gap-2 pl-5">
            <p className="text-xs text-[var(--color-navy-mid)]">
              macOS Accessibility permission is not granted yet.
            </p>
            <button
              type="button"
              onClick={() => void refreshAccessibility()}
              className="whitespace-nowrap rounded-[var(--radius-button)] border border-border px-2 py-1 text-xs hover:bg-[var(--color-surface)]"
              style={{ color: "var(--color-navy)" }}
            >
              Grant / re-check
            </button>
          </div>
        )}
      </div>
      <label className="flex flex-col gap-1 text-xs text-[var(--color-navy-mid)]">
        Only act in these apps (comma-separated; empty = any)
        <input
          type="text"
          value={allowedApps}
          disabled={running}
          placeholder="e.g. Notes, Safari"
          onChange={(event) => {
            setAllowedApps(event.target.value);
            try { localStorage.setItem(AVATAR_ALLOWED_APPS_KEY, event.target.value); } catch { /* per-device convenience */ }
          }}
          className="w-full rounded-[var(--radius-button)] border border-border bg-background px-2 py-1 text-sm"
        />
      </label>
      <textarea
        aria-label={`Task for ${name}`}
        value={task}
        onChange={(event) => setTask(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void start();
          }
        }}
        placeholder="What should I do? e.g. open Notes and write a shopping list"
        rows={2}
        disabled={running}
        className="w-full rounded-[var(--radius-button)] border border-border bg-background px-2 py-1.5 text-sm"
        style={{ resize: "none" }}
      />
      <div className="flex items-center justify-end gap-2">
        {running ? (
          <button
            type="button"
            onClick={() => void tauriInvoke("act_stop")}
            className="rounded-[var(--radius-button)] border border-border px-3 py-1.5 text-xs hover:bg-[var(--color-surface)]"
            style={{ color: "var(--color-navy)" }}
          >
            Stop
          </button>
        ) : (
          <>
          {outcome?.status === "paused" && (
            <button
              type="button"
              disabled={guide ? !canGuide : !canRun}
              title="Picks the walkthrough up where it paused — the goal and finished steps are kept"
              onClick={() => void start(guide, true)}
              className="rounded-[var(--radius-button)] border border-border bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
            >
              Continue
            </button>
          )}
          <button
            type="button"
            disabled={!canGuide || !task.trim()}
            title="Points at each step and waits for you to click it — never moves your mouse"
            onClick={() => void start(true)}
            className="rounded-[var(--radius-button)] border border-border px-3 py-1.5 text-xs hover:bg-[var(--color-surface)] disabled:opacity-50"
            style={{ color: "var(--color-navy)" }}
          >
            Show me how
          </button>
          <button
            type="button"
            disabled={!canRun || !task.trim()}
            onClick={() => void start()}
            className="rounded-[var(--radius-button)] border border-border bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
          >
            Do it
          </button>
          </>
        )}
      </div>
      {steps.length > 0 && (
        <ol aria-label="Steps" className="flex flex-col gap-1 rounded-[var(--radius-button)] border border-border bg-[var(--color-surface)] p-2 text-xs">
          {steps.map((step) => (
            <li key={step.index} className="flex gap-2 text-[var(--color-navy)]">
              <span className="text-muted-foreground">{step.index}.</span>
              <span className="flex-1">
                {step.say}
                {step.target && <span className="text-muted-foreground"> — {step.action} “{step.target}”</span>}
              </span>
              <span aria-label={step.status} className="text-muted-foreground">
                {step.status === "ok" ? "✓" : step.status === "failed" ? "✕" : "…"}
              </span>
            </li>
          ))}
        </ol>
      )}
      {error && (
        <div role="alert" className="rounded-[var(--radius-button)] border border-border px-2 py-1.5 text-xs" style={{ color: "var(--color-navy)" }}>
          {error}
        </div>
      )}
      {outcome && (
        <div role="status" aria-live="polite" className="rounded-[var(--radius-button)] border border-border bg-[var(--color-surface)] p-2">
          <p className="text-xs font-medium text-[var(--color-navy-mid)]">
            {outcome.status === "done" ? (guide ? "Walkthrough complete" : "Done") : outcome.status === "paused" ? "Your turn" : outcome.status === "stopped" ? "Stopped" : outcome.status === "bounded" ? "Ran out of steps" : "Could not finish"}
            {" · "}{outcome.steps} {outcome.steps === 1 ? "step" : "steps"}
          </p>
          <p className="whitespace-pre-wrap text-[var(--color-navy)]">{outcome.summary}</p>
        </div>
      )}
    </div>
  );
}
