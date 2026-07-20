import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, LifeBuoy, Send } from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "../components/ui/button";
import { Header } from "../components/shared/Header";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { collectAllPages } from "../lib/pagination";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";

type TicketPage = Awaited<ReturnType<typeof trpc.relationship.helpdesk.list.query>>;
type Ticket = TicketPage["items"][number];
type Thread = Awaited<ReturnType<typeof trpc.relationship.helpdesk.get.query>>;

function displayDate(value: string | Date): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

export function RelationshipHelpdeskPage() {
  const [page, setPage] = useState<TicketPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    collectAllPages((offset, limit) =>
      trpc.relationship.helpdesk.list.query({ organizationId: PILOT_ORGANIZATION, limit, offset }),
    )
      .then((items) => setPage({ items, total: items.length, hasMore: false }))
      .catch((cause) => setError(String(cause)));
  }, []);

  const tickets = useMemo(() => {
    if (!page) return [];
    const query = search.trim().toLowerCase();
    return query
      ? page.items.filter((ticket) =>
          `${ticket.subject} ${ticket.submitterName || ""} ${ticket.submitterEmail} ${ticket.status}`
            .toLowerCase()
            .includes(query),
        )
      : page.items;
  }, [page, search]);

  if (error) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (!page) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading Help Requests…</div>;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <Header tabs={[{ id: "Helpdesk", icon: LifeBuoy }]} activeTab="Helpdesk" onTabChange={() => {}} />
      <div className="border-b px-4 py-3 flex items-center gap-3" style={{ borderColor: "var(--color-border)" }}>
        <Link to="/module/relationship" className="inline-flex items-center gap-1 text-sm no-underline hover:underline" style={{ color: "var(--color-steel)" }}>
          <ArrowLeft className="w-4 h-4" /> Relationship
        </Link>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search Help Requests"
          aria-label="Search Help Requests"
          className="ml-auto w-full max-w-xs rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-border)" }}
        />
      </div>
      <div className="flex-1 space-y-8 overflow-auto p-4">
        {tickets.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center" style={{ borderColor: "var(--color-border)" }}>
            <LifeBuoy className="mx-auto w-8 h-8" style={{ color: "var(--color-warm-gray)" }} />
            <p className="mt-3 text-sm font-medium" style={{ color: "var(--color-navy)" }}>No Help Requests yet.</p>
            <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
              Requests submitted through the public Helpdesk endpoint will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {tickets.map((ticket: Ticket) => (
              <Link
                key={ticket.id}
                to={`/module/relationship/helpdesk/${ticket.id}`}
                className="rounded-xl border p-4 no-underline hover:shadow-sm"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>{ticket.subject}</p>
                    <p className="mt-1 text-xs truncate" style={{ color: "var(--color-warm-gray)" }}>
                      {ticket.submitterName || ticket.submitterEmail} · {displayDate(ticket.updatedAt)}
                    </p>
                  </div>
                  <span className="rounded-full border px-2 py-0.5 text-xs capitalize" style={{ borderColor: "var(--color-border)", color: "var(--color-steel)" }}>
                    {ticket.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
        <ModuleFilesSection moduleName="relationship" />
      </div>
    </div>
  );
}

export function RelationshipHelpdeskThreadPage() {
  const { ticketId = "" } = useParams<{ ticketId: string }>();
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);

  async function refresh(expectedTicketId: string, generation: number): Promise<void> {
    try {
      const nextThread = await trpc.relationship.helpdesk.get.query({
        organizationId: PILOT_ORGANIZATION,
        ticketId: expectedTicketId,
      });
      if (requestGeneration.current === generation) {
        setThread(nextThread);
        setError(null);
      }
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    }
  }

  useEffect(() => {
    const generation = ++requestGeneration.current;
    setThread(null);
    setReply("");
    setError(null);
    setBusy(false);
    void refresh(ticketId, generation);
  }, [ticketId]);

  async function sendReply() {
    const body = reply.trim();
    if (!body) return;
    if (!thread || thread.ticket.id !== ticketId) {
      setError("Help Request details are still loading.");
      return;
    }
    const generation = requestGeneration.current;
    const targetTicketId = thread.ticket.id;
    setBusy(true);
    setError(null);
    try {
      await trpc.relationship.helpdesk.reply.mutate({
        organizationId: PILOT_ORGANIZATION,
        ticketId: targetTicketId,
        body,
        status: "pending",
      });
      if (requestGeneration.current === generation) {
        setReply("");
        await refresh(targetTicketId, generation);
      }
    } catch (cause) {
      if (requestGeneration.current === generation) setError(String(cause));
    } finally {
      if (requestGeneration.current === generation) setBusy(false);
    }
  }

  if (error && !thread) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (!thread) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading Help Request…</div>;

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
        <Link to="/module/relationship/helpdesk" className="inline-flex items-center gap-1 text-sm no-underline hover:underline" style={{ color: "var(--color-steel)" }}>
          <ArrowLeft className="w-4 h-4" /> Helpdesk
        </Link>
        <div>
          <p className="text-xs uppercase tracking-wide capitalize" style={{ color: "var(--color-warm-gray)" }}>{thread.ticket.status}</p>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}>{thread.ticket.subject}</h1>
          <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
            {thread.ticket.submitterName || thread.ticket.submitterEmail}
          </p>
        </div>
        <section className="space-y-3">
          {thread.messages.map((message) => (
            <article key={message.id} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
              <p className="text-xs capitalize" style={{ color: "var(--color-warm-gray)" }}>
                {message.authorType} · {displayDate(message.createdAt)}
              </p>
              <p className="mt-2 text-sm whitespace-pre-wrap" style={{ color: "var(--color-navy)" }}>{message.body}</p>
            </article>
          ))}
        </section>
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
          <label className="text-sm font-medium" htmlFor="helpdesk-reply">Reply</label>
          <textarea
            id="helpdesk-reply"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={4}
            className="mt-2 w-full rounded-lg border p-3 text-sm"
            style={{ borderColor: "var(--color-border)" }}
          />
          <Button
            className="mt-3"
            disabled={busy || !reply.trim() || thread.ticket.id !== ticketId}
            onClick={sendReply}
          >
            <Send className="w-4 h-4" /> Send reply
          </Button>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </section>
      </div>
    </div>
  );
}
