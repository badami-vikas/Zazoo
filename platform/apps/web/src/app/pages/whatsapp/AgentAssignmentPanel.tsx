/**
 * Agent Assignment — who is answerable for a chat.
 *
 * This panel is deliberately the plainest of the three, because what it does is
 * consequential and rarely done: it names the Agent an Automation is allowed to
 * start a Run of. Nothing automated happens on a chat with no assignment, so an
 * empty list here is a meaningful, honest state rather than a setup step to
 * hurry past.
 *
 * Every row shows the human who assigned it and when. Removing is one click and
 * keeps the record — the trail below the active list is the history, including
 * assignments that were replaced or withdrawn.
 */
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { trpc } from "../../lib/trpc";
import {
  agentLabel,
  chatLabel,
  useAutomationState,
  whenLabel,
  type AgentAssignmentRow,
} from "./automation-store";

export function AgentAssignmentPanel() {
  const { state, loading, error, run, busy } = useAutomationState();
  const [chatId, setChatId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  if (loading) {
    return <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>Reading assignments…</p>;
  }
  if (!state) {
    return (
      <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>
        {error ?? "Assignments could not be read."}
      </p>
    );
  }

  const active = state.assignments.filter((row) => !row.unassignedAt);
  const past = state.assignments.filter((row) => row.unassignedAt);
  const agents = state.agents;

  async function assign() {
    if (!chatId || !agentId) return;
    const ok = await run(() =>
      trpc.whatsapp.automation.assignAgent.mutate({
        subject: { kind: "chat", key: chatId },
        agentId,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    );
    if (ok) {
      setChatId("");
      setNote("");
    }
  }

  return (
    <div className="space-y-5">
      {state.chats.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
          No chats have been synced yet, so there is nothing to assign an Agent to. Sync your
          messages on the Chats Page first — an Agent needs the conversation to answer for it.
        </p>
      ) : (
        <div
          className="space-y-3 rounded-md border p-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <label className="block space-y-1 text-sm">
            <span style={{ color: "var(--color-navy-mid)" }}>Chat</span>
            <select
              className="w-full rounded-md border px-2 py-1 text-sm"
              style={{ borderColor: "var(--color-border)" }}
              value={chatId}
              onChange={(event) => setChatId(event.target.value)}
            >
              <option value="">Choose a synced chat…</option>
              {state.chats.map((chat) => (
                <option key={chat.chatId} value={chat.chatId}>
                  {chatLabel(state.chats, chat.chatId)}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span style={{ color: "var(--color-navy-mid)" }}>Agent</span>
            <select
              className="w-full rounded-md border px-2 py-1 text-sm"
              style={{ borderColor: "var(--color-border)" }}
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              <option value="">Choose an Agent…</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
            <span className="block text-xs" style={{ color: "var(--color-navy-mid)" }}>
              Only Agents this Module declares can be assigned, and only the assigned Agent may be
              started by an Automation on this chat.
            </span>
          </label>

          <label className="block space-y-1 text-sm">
            <span style={{ color: "var(--color-navy-mid)" }}>Why (optional)</span>
            <input
              className="w-full rounded-md border px-2 py-1 text-sm"
              style={{ borderColor: "var(--color-border)" }}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Kept for the record, never invented"
            />
          </label>

          <Button size="sm" onClick={() => void assign()} disabled={busy || !chatId || !agentId}>
            Assign
          </Button>
        </div>
      )}

      {error ? (
        <p className="text-sm" style={{ color: "var(--color-danger, #b42318)" }}>{error}</p>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
          Assigned now
        </h3>
        {active.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
            No Agent is assigned to any chat. Nothing automated will run until one is.
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((row) => (
              <li
                key={row.id}
                className="flex items-start justify-between gap-3 rounded-md border p-3"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm" style={{ color: "var(--color-navy)" }}>
                    {agentLabel(agents, row.agentId)} · {chatLabel(state.chats, row.subject.key)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                    Assigned by {row.assignedBy} on {whenLabel(row.assignedAt)}
                    {row.note ? ` — ${row.note}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      trpc.whatsapp.automation.unassignAgent.mutate({
                        subject: { kind: "chat", key: row.subject.key },
                      }),
                    )
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section className="space-y-2">
          <button
            type="button"
            className="text-sm underline"
            style={{ color: "var(--color-navy-mid)" }}
            onClick={() => setShowHistory((open) => !open)}
          >
            {showHistory ? "Hide" : "Show"} {past.length} past assignment
            {past.length === 1 ? "" : "s"}
          </button>
          {showHistory ? (
            <ul className="space-y-1">
              {past.map((row) => (
                <li key={row.id} className="text-xs" style={{ color: "var(--color-navy-mid)" }}>
                  {agentLabel(agents, row.agentId)} · {chatLabel(state.chats, row.subject.key)} —{" "}
                  {pastLabel(row)}
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
 * Replaced and withdrawn read differently on purpose. "Removed" implies the
 * owner withdrew it; a row that ended because a new Agent took over did not.
 */
function pastLabel(row: AgentAssignmentRow): string {
  return row.supersededBy
    ? `replaced on ${whenLabel(row.unassignedAt)}`
    : `removed by ${row.unassignedBy ?? "an unrecorded person"} on ${whenLabel(row.unassignedAt)}`;
}
