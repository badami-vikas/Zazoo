/**
 * Scheduled Actions — the queue, and why each entry waits for when it does.
 *
 * The queue holds pending **Agent Run starts**, not messages. Nothing here
 * sends: when an entry runs, whatever the Agent wants to deliver goes through
 * the consent gate, the send discipline and the desktop shell's enforced
 * ceiling, in that order. The scheduler proposes; the policy disposes.
 *
 * Every row carries the reason its time was chosen — a recipient's local night,
 * a per-recipient cooldown, a full daily cap, or simply pacing so an Agent Run
 * does not start the instant its trigger fired. A queue that showed a time and
 * nothing else would teach the owner to trust it without reading it.
 */
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { trpc } from "../../lib/trpc";
import {
  agentLabel,
  subjectLabel,
  useAutomationState,
  whenLabel,
  type ScheduledActionRow,
} from "./automation-store";

export function ScheduledActionsPanel() {
  const { state, loading, error, run, busy } = useAutomationState();
  const [showDone, setShowDone] = useState(false);

  if (loading) {
    return <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>Reading the queue…</p>;
  }
  if (!state) {
    return (
      <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>
        {error ?? "The queue could not be read."}
      </p>
    );
  }

  const queued = [...state.scheduled]
    .filter((action) => action.status === "queued")
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
  const settled = state.scheduled.filter((action) => action.status !== "queued");
  const ruleName = (ruleId: string | undefined) =>
    state.rules.find((rule) => rule.id === ruleId)?.name;

  return (
    <div className="space-y-5">
      <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
        Each entry is an Agent Run waiting to start, not a message waiting to send. When one runs,
        anything it wants to send still has to pass the consent gate and the sending limits.
      </p>

      {error ? (
        <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>{error}</p>
      ) : null}

      {queued.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
          Nothing is scheduled.
          {state.rules.length === 0
            ? " There are no automation rules yet — a rule is what puts something here."
            : " Use “Check rules now” on the Automation Rules Tool to see whether any rule is due."}
        </p>
      ) : (
        <ul className="space-y-2">
          {queued.map((action) => (
            <li
              key={action.id}
              className="flex items-start justify-between gap-3 rounded-md border p-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm" style={{ color: "var(--color-navy)" }}>
                  {agentLabel(state.agents, action.agentId)} ·{" "}
                  {subjectLabel(state.chats, action.subject)}
                </p>
                <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
                  {action.goal}
                </p>
                <p className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                  {whenLabel(action.scheduledFor)} — {action.reason.explanation}
                </p>
                <p className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                  {originLine(action, ruleName(action.ruleId))}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    trpc.whatsapp.automation.cancelAction.mutate({ actionId: action.id }),
                  )
                }
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}

      {settled.length > 0 ? (
        <section className="space-y-2">
          <button
            type="button"
            className="text-sm underline"
            style={{ color: "var(--color-navy-mid)" }}
            onClick={() => setShowDone((open) => !open)}
          >
            {showDone ? "Hide" : "Show"} {settled.length} finished or cancelled
          </button>
          {showDone ? (
            <ul className="space-y-1">
              {settled.map((action) => (
                <li key={action.id} className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                  {subjectLabel(state.chats, action.subject)} — {settledLine(action)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Where this entry came from. A rule that has since been deleted is said so
 * plainly rather than shown as an orphan with a missing name — deleting a rule
 * cancels its queued actions, so an entry citing a deleted rule is worth
 * noticing.
 */
function originLine(action: ScheduledActionRow, ruleName: string | undefined): string {
  if (!action.ruleId) return `Queued on ${whenLabel(action.queuedAt)}.`;
  return ruleName
    ? `From the rule “${ruleName}”, queued on ${whenLabel(action.queuedAt)}.`
    : `From a rule that has since been deleted, queued on ${whenLabel(action.queuedAt)}.`;
}

function settledLine(action: ScheduledActionRow): string {
  if (action.status === "cancelled") {
    return `cancelled by ${action.cancelledBy ?? "an unrecorded person"} on ${whenLabel(action.cancelledAt)}`;
  }
  return `started on ${whenLabel(action.startedAt)}${action.agentRunId ? ` as Agent Run ${action.agentRunId}` : ""}`;
}
