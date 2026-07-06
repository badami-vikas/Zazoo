import { useEffect, useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";

type Thread = Awaited<ReturnType<typeof trpc.helpdesk.public.getThread.query>>;

/**
 * The genuinely public/unauthenticated surface (frontend-migration-scoping.md
 * gap #5) — routed via `helpdesk.public.*`, which never consults `ctx.identity`.
 * A submitter's only credential is possession of `accessToken`, shown once here
 * after ticket creation (same trust model as a password-reset link) and then
 * kept client-side (localStorage) so returning visitors can reload their thread.
 */
export function PublicHelpdesk() {
  const [token, setToken] = useState(() => localStorage.getItem("dummy_helpdesk_token") ?? "");
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");

  async function submitTicket() {
    if (!subject || !email || !body) return;
    setError(null);
    try {
      const { ticket } = await trpc.helpdesk.public.createTicket.mutate({
        workspaceId: PILOT_WORKSPACE,
        subject,
        submitterEmail: email,
        body,
      });
      localStorage.setItem("dummy_helpdesk_token", ticket.accessToken);
      setToken(ticket.accessToken);
      await loadThread(ticket.accessToken);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadThread(accessToken: string) {
    try {
      const t = await trpc.helpdesk.public.getThread.query({ accessToken });
      setThread(t);
    } catch (e) {
      setError(String(e));
    }
  }

  async function sendReply() {
    if (!token || !reply.trim()) return;
    setError(null);
    try {
      await trpc.helpdesk.public.reply.mutate({ accessToken: token, body: reply });
      setReply("");
      await loadThread(token);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    if (token) loadThread(token);
  }, [token]);

  return (
    <div className="p-6 space-y-6 max-w-lg mx-auto">
      <h1 className="text-lg font-medium">Help</h1>
      {error && <div className="text-sm text-red-600">{error}</div>}

      {!token && (
        <section className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Your email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="body">How can we help?</Label>
            <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <Button onClick={submitTicket}>Submit</Button>
        </section>
      )}

      {token && thread && (
        <section className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Ticket: {thread.ticket.subject} · {thread.ticket.status}
          </div>
          <ul className="space-y-3">
            {thread.messages.map((m) => (
              <li key={m.id} className="text-sm border rounded-md p-3">
                <div className="font-medium">{m.authorType === "agent" ? "Support" : "You"}</div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </li>
            ))}
          </ul>
          <div className="space-y-2">
            <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add a reply…" />
            <Button onClick={sendReply}>Send</Button>
          </div>
        </section>
      )}
    </div>
  );
}
