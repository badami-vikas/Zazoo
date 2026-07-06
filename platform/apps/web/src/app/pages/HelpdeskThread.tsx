import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";

type Thread = Awaited<ReturnType<typeof trpc.helpdesk.get.query>>;

/** Agent-side view of one ticket — maps to `helpdesk.get` / `helpdesk.reply`. */
export function HelpdeskThread() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  function refresh() {
    if (!ticketId) return;
    trpc.helpdesk.get
      .query({ workspaceId: PILOT_WORKSPACE, ticketId })
      .then(setThread)
      .catch((e) => setError(String(e)));
  }
  useEffect(refresh, [ticketId]);

  async function send() {
    if (!ticketId || !reply.trim()) return;
    setError(null);
    try {
      await trpc.helpdesk.reply.mutate({ workspaceId: PILOT_WORKSPACE, ticketId, body: reply });
      setReply("");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  if (error) return <div className="p-6 text-red-600 text-sm">{error}</div>;
  if (!thread) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <h1 className="text-lg font-medium">{thread.ticket.subject}</h1>
      <div className="text-sm text-muted-foreground">
        {thread.ticket.submitterEmail} · {thread.ticket.status}
      </div>
      <ul className="space-y-3">
        {thread.messages.map((m) => (
          <li key={m.id} className="text-sm border rounded-md p-3">
            <div className="font-medium">{m.authorType === "agent" ? "You" : thread.ticket.submitterEmail}</div>
            <div className="whitespace-pre-wrap">{m.body}</div>
          </li>
        ))}
      </ul>
      <div className="space-y-2">
        <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" />
        <Button onClick={send}>Send reply</Button>
      </div>
    </div>
  );
}
