import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, LifeBuoy, Send } from "lucide-react";
import { Link, useParams } from "react-router";
import { Button } from "../components/ui/button";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

type PublicThread = Awaited<ReturnType<typeof trpc.helpdesk.public.getThread.query>>;

interface TicketDraft {
  submitterName: string;
  submitterEmail: string;
  subject: string;
  body: string;
}

interface PendingCreate {
  operationId: string;
  accessToken: string;
  draft: TicketDraft;
}

interface PendingReply {
  operationId: string;
  body: string;
}

const EMPTY_DRAFT: TicketDraft = {
  submitterName: "",
  submitterEmail: "",
  subject: "",
  body: "",
};

function displayDate(value: Date | string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function newAccessToken(): string {
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function parsePendingCreate(raw: string | null): PendingCreate | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingCreate>;
    const draft = value.draft as Partial<TicketDraft> | undefined;
    if (
      typeof value.operationId !== "string" ||
      typeof value.accessToken !== "string" ||
      !draft ||
      typeof draft.submitterName !== "string" ||
      typeof draft.submitterEmail !== "string" ||
      typeof draft.subject !== "string" ||
      typeof draft.body !== "string"
    ) {
      return null;
    }
    return {
      operationId: value.operationId,
      accessToken: value.accessToken,
      draft: {
        submitterName: draft.submitterName,
        submitterEmail: draft.submitterEmail,
        subject: draft.subject,
        body: draft.body,
      },
    };
  } catch {
    return null;
  }
}

function parsePendingReply(raw: string | null): PendingReply | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingReply>;
    return typeof value.operationId === "string" && typeof value.body === "string"
      ? { operationId: value.operationId, body: value.body }
      : null;
  } catch {
    return null;
  }
}

export function PublicHelpdesk() {
  const { slug } = useParams<{ slug?: string }>();
  const helpdeskSlug = slug ?? "relationship";
  const supported = helpdeskSlug === "relationship";
  const storageKey = useMemo(
    () => `bridge.helpdesk.submitter-access.${helpdeskSlug}`,
    [helpdeskSlug],
  );
  const pendingCreateKey = `${storageKey}.pending-create`;
  const pendingReplyKey = `${storageKey}.pending-reply`;
  const [draft, setDraft] = useState<TicketDraft>(EMPTY_DRAFT);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [thread, setThread] = useState<PublicThread | null>(null);
  const [reply, setReply] = useState("");
  const [existingKey, setExistingKey] = useState("");
  const [loading, setLoading] = useState(supported);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [keyStored, setKeyStored] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [pendingReply, setPendingReply] = useState<PendingReply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) {
      setLoading(false);
      return;
    }
    let savedToken: string | null = null;
    try {
      const createOperation = parsePendingCreate(window.localStorage.getItem(pendingCreateKey));
      if (createOperation) {
        setPendingCreate(createOperation);
        setDraft(createOperation.draft);
      }
      const replyOperation = parsePendingReply(window.localStorage.getItem(pendingReplyKey));
      if (replyOperation) {
        setPendingReply(replyOperation);
        setReply(replyOperation.body);
      }
      savedToken = window.localStorage.getItem(storageKey);
    } catch (cause) {
      setError(`This browser could not read saved Helpdesk access. Paste your private reply key instead: ${String(cause)}`);
      setLoading(false);
      return;
    }
    if (!savedToken) {
      setLoading(false);
      return;
    }

    let alive = true;
    setKeyStored(true);
    setAccessToken(savedToken);
    trpc.helpdesk.public.getThread
      .query({ accessToken: savedToken })
      .then((nextThread) => {
        if (alive) {
          setThread(nextThread);
          setError(null);
        }
      })
      .catch((cause) => {
        if (alive) {
          setError(`This browser's saved Helpdesk access could not be opened: ${String(cause)}`);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [pendingCreateKey, pendingReplyKey, storageKey, supported]);

  async function createTicket() {
    const subject = draft.subject.trim();
    const submitterEmail = draft.submitterEmail.trim();
    const body = draft.body.trim();
    if (!subject || !submitterEmail || !body) {
      setError("Email, subject, and request details are required.");
      return;
    }

    setBusy(true);
    setError(null);
    const normalizedDraft: TicketDraft = {
      submitterName: draft.submitterName.trim(),
      submitterEmail,
      subject,
      body,
    };
    const operation =
      pendingCreate && JSON.stringify(pendingCreate.draft) === JSON.stringify(normalizedDraft)
        ? pendingCreate
        : {
            operationId: window.crypto.randomUUID(),
            accessToken: newAccessToken(),
            draft: normalizedDraft,
          };
    setPendingCreate(operation);
          let retryProtectionStored = true;
          try {
            window.localStorage.setItem(pendingCreateKey, JSON.stringify(operation));
          } catch {
            retryProtectionStored = false;
          }
    try {
      const created = await trpc.helpdesk.public.createTicket.mutate({
        organizationId: PILOT_ORGANIZATION,
        subject,
        submitterEmail,
        ...(normalizedDraft.submitterName ? { submitterName: normalizedDraft.submitterName } : {}),
        body,
        operationId: operation.operationId,
        accessToken: operation.accessToken,
      });
      const { accessToken: token, ...ticket } = created.ticket;
      setAccessToken(token);
      setThread({ ticket, messages: [created.message] });
      setDraft(EMPTY_DRAFT);
      setPendingCreate(null);
      let pendingOperationCleared = true;
      try {
        window.localStorage.removeItem(pendingCreateKey);
      } catch {
        pendingOperationCleared = false;
      }
      try {
        window.localStorage.setItem(storageKey, token);
        setKeyStored(true);
        setError(
          pendingOperationCleared
            ? null
            : "Request submitted and the private reply key was saved, but stale retry state could not be cleared from this browser.",
        );
      } catch (cause) {
        setKeyStored(false);
        setError(`Request submitted, but this browser could not save the private reply key. Copy it now: ${String(cause)}`);
      }
    } catch (cause) {
      setError(
        `The Help Request was not submitted: ${String(cause)}` +
          (retryProtectionStored ? "" : " This browser could not persist retry protection; keep this page open before retrying."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    const body = reply.trim();
    if (!accessToken || !body) return;

    setBusy(true);
    setError(null);
    const operation =
      pendingReply?.body === body
        ? pendingReply
        : { operationId: window.crypto.randomUUID(), body };
    setPendingReply(operation);
    let retryProtectionStored = true;
    try {
      window.localStorage.setItem(pendingReplyKey, JSON.stringify(operation));
    } catch {
      retryProtectionStored = false;
    }
    try {
      const message = await trpc.helpdesk.public.reply.mutate({
        accessToken,
        body,
        operationId: operation.operationId,
      });
      setThread(current => current
        ? {
            ticket: { ...current.ticket, status: "open", updatedAt: message.createdAt },
            messages: current.messages.some(existing => existing.id === message.id)
              ? current.messages
              : [...current.messages, message],
          }
        : current);
      setReply("");
      setPendingReply(null);
      try {
        window.localStorage.removeItem(pendingReplyKey);
      } catch {
        setError("Reply sent, but stale retry state could not be cleared from this browser.");
      }
    } catch (cause) {
      setError(
        `The reply was not sent: ${String(cause)}` +
          (retryProtectionStored ? "" : " This browser could not persist retry protection; keep this page open before retrying."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryKey() {
    if (!accessToken) return;
    try {
      await navigator.clipboard.writeText(accessToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (cause) {
      setError(`The private reply key could not be copied: ${String(cause)}`);
    }
  }

  async function openExistingRequest() {
    const token = existingKey.trim();
    if (!token) {
      setError("Enter the private reply key for the Help Request.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nextThread = await trpc.helpdesk.public.getThread.query({ accessToken: token });
      setAccessToken(token);
      setThread(nextThread);
      setExistingKey("");
      try {
        window.localStorage.setItem(storageKey, token);
        setKeyStored(true);
      } catch (cause) {
        setKeyStored(false);
        setError(`Request opened, but this browser could not save the private reply key. Copy it now: ${String(cause)}`);
      }
    } catch (cause) {
      setError(`The private reply key could not open a Help Request: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }

  function startAnotherRequest() {
    let storageError: unknown = null;
    try {
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem(pendingCreateKey);
      window.localStorage.removeItem(pendingReplyKey);
    } catch (cause) {
      storageError = cause;
    }
    setAccessToken(null);
    setThread(null);
    setKeyStored(false);
    setPendingCreate(null);
    setPendingReply(null);
    setReply("");
    setError(storageError ? `The saved private reply key could not be removed from this browser: ${String(storageError)}` : null);
  }

  if (!supported) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: "var(--color-background)" }}>
        <div className="max-w-md rounded-2xl border bg-white p-8 text-center" style={{ borderColor: "var(--color-border)" }}>
          <LifeBuoy className="mx-auto h-9 w-9" style={{ color: "var(--color-warm-gray)" }} />
          <h1 className="mt-4 text-xl font-semibold" style={{ color: "var(--color-navy)" }}>Helpdesk not found</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--color-navy-mid)" }}>This public Helpdesk link is not installed.</p>
          <Link to="/help/relationship" className="mt-5 inline-flex items-center gap-1 text-sm hover:underline" style={{ color: "var(--color-steel)" }}>
            Open Relationship Helpdesk
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 sm:p-8" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="mx-auto max-w-3xl">
        <Link to="/" className="inline-flex items-center gap-1 text-sm hover:underline" style={{ color: "var(--color-steel)" }}>
          <ArrowLeft className="h-4 w-4" /> Bridge
        </Link>
        <header className="mt-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border bg-white" style={{ borderColor: "var(--color-border)" }}>
              <LifeBuoy className="h-6 w-6" style={{ color: "var(--color-steel)" }} />
            </span>
            <div>
              <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>Relationship Module</p>
              <h1 className="text-2xl font-semibold" style={{ color: "var(--color-navy)", fontFamily: "var(--font-editorial)" }}>Helpdesk</h1>
            </div>
          </div>
          <p className="mt-3 max-w-xl text-sm" style={{ color: "var(--color-navy-mid)" }}>
            Send a Help Request. Replies stay in this private thread and are available only with your reply key.
          </p>
        </header>

        {error && (
          <div role="alert" className="mt-5 rounded-xl border px-4 py-3 text-sm text-red-700" style={{ borderColor: "color-mix(in srgb, var(--danger) 35%, var(--color-border))" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-8 text-sm" style={{ color: "var(--color-warm-gray)" }}>Opening your Help Request…</div>
        ) : thread && accessToken ? (
          <div className="mt-8 space-y-5">
            <section className="rounded-2xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide capitalize" style={{ color: "var(--color-warm-gray)" }}>{thread.ticket.status}</p>
                  <h2 className="mt-1 text-xl font-semibold" style={{ color: "var(--color-navy)" }}>{thread.ticket.subject}</h2>
                </div>
                <Button variant="outline" onClick={() => void copyRecoveryKey()}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy private reply key"}
                </Button>
              </div>
              <p className="mt-3 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                {keyStored
                  ? "This browser stores the key locally. Keep the copied key private; anyone with it can open and reply to this request."
                  : "This browser could not store the key. Copy it now and keep it private; anyone with it can open and reply to this request."}
              </p>
              {!keyStored && (
                <div className="mt-3">
                  <label htmlFor="public-helpdesk-recovery-key" className="text-xs font-medium" style={{ color: "var(--color-navy)" }}>
                    Private reply key
                  </label>
                  <input
                    id="public-helpdesk-recovery-key"
                    readOnly
                    value={accessToken}
                    onFocus={(event) => event.currentTarget.select()}
                    className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-xs"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-navy)" }}
                  />
                </div>
              )}
            </section>

            <section className="space-y-3">
              {thread.messages.map((message) => (
                <article key={message.id} className="rounded-xl border bg-white p-4" style={{ borderColor: "var(--color-border)" }}>
                  <p className="text-xs capitalize" style={{ color: "var(--color-warm-gray)" }}>
                    {message.authorType === "agent" ? "Bridge" : "You"} · {displayDate(message.createdAt)}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm" style={{ color: "var(--color-navy)" }}>{message.body}</p>
                </article>
              ))}
            </section>

            <section className="rounded-2xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
              <label htmlFor="public-helpdesk-reply" className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>Reply</label>
              <textarea
                id="public-helpdesk-reply"
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={4}
                className="mt-2 w-full rounded-lg border p-3 text-sm"
                style={{ borderColor: "var(--color-border)" }}
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button disabled={busy || !reply.trim()} onClick={() => void sendReply()}>
                  <Send className="h-4 w-4" /> {busy ? "Sending…" : "Send reply"}
                </Button>
                <button type="button" onClick={startAnotherRequest} className="text-sm hover:underline" style={{ color: "var(--color-steel)" }}>
                  Start another Help Request
                </button>
              </div>
            </section>
          </div>
        ) : (
          <section className="mt-8 rounded-2xl border bg-white p-5 sm:p-6" style={{ borderColor: "var(--color-border)" }}>
            <div className="mb-5 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface)" }}>
              <label htmlFor="existing-helpdesk-key" className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                Open an existing Help Request
              </label>
              <p className="mt-1 text-xs" style={{ color: "var(--color-warm-gray)" }}>
                Paste the private reply key you copied when the request was created.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  id="existing-helpdesk-key"
                  type="password"
                  autoComplete="off"
                  value={existingKey}
                  onChange={(event) => setExistingKey(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-border)" }}
                />
                <Button variant="outline" disabled={busy || !existingKey.trim()} onClick={() => void openExistingRequest()}>
                  Open request
                </Button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                Name <span className="font-normal" style={{ color: "var(--color-warm-gray)" }}>(optional)</span>
                <input
                  value={draft.submitterName}
                  onChange={(event) => setDraft(current => ({ ...current, submitterName: event.target.value }))}
                  className="mt-1.5 w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-border)" }}
                  autoComplete="name"
                />
              </label>
              <label className="text-sm font-medium" style={{ color: "var(--color-navy)" }}>
                Email
                <input
                  type="email"
                  required
                  value={draft.submitterEmail}
                  onChange={(event) => setDraft(current => ({ ...current, submitterEmail: event.target.value }))}
                  className="mt-1.5 w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--color-border)" }}
                  autoComplete="email"
                />
              </label>
            </div>
            <label className="mt-4 block text-sm font-medium" style={{ color: "var(--color-navy)" }}>
              Subject
              <input
                required
                value={draft.subject}
                onChange={(event) => setDraft(current => ({ ...current, subject: event.target.value }))}
                className="mt-1.5 w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--color-border)" }}
              />
            </label>
            <label className="mt-4 block text-sm font-medium" style={{ color: "var(--color-navy)" }}>
              What do you need help with?
              <textarea
                required
                value={draft.body}
                onChange={(event) => setDraft(current => ({ ...current, body: event.target.value }))}
                rows={6}
                className="mt-1.5 w-full rounded-lg border p-3 text-sm"
                style={{ borderColor: "var(--color-border)" }}
              />
            </label>
            <Button className="mt-4" disabled={busy} onClick={() => void createTicket()}>
              <Send className="h-4 w-4" /> {busy ? "Submitting…" : "Submit Help Request"}
            </Button>
          </section>
        )}
      </div>
    </main>
  );
}
