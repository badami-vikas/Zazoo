import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, Loader2, Plus, RotateCcw, Square, Trash2, X } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { isNearChatBottom } from "./chat-state.mjs";
import { type ChatSurfaceKind, type ChatTurn, useChat } from "./useChat";

interface ChatViewProps {
  surface: ChatSurfaceKind;
  compact?: boolean;
  className?: string;
  onOpenTask?: (taskId: string) => void;
}

interface TaskDraft {
  kind: "task_create";
  taskId: string;
  title: string;
  outcome: string;
  exitTest: string;
  status: "proposed";
}

function taskDraftFromTurn(turn: ChatTurn): TaskDraft | null {
  const value = turn.decision?.proposedOutput ?? turn.proposal?.proposedOutput;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind !== "task_create" ||
    typeof candidate.taskId !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.outcome !== "string" ||
    typeof candidate.exitTest !== "string"
  ) {
    return null;
  }
  return {
    kind: "task_create",
    taskId: candidate.taskId,
    title: candidate.title,
    outcome: candidate.outcome,
    exitTest: candidate.exitTest,
    status: "proposed",
  };
}

function ModelSetup({
  state,
  onInstall,
  onCancel,
  onStart,
}: {
  state: ReturnType<typeof useChat>["model"];
  onInstall: () => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  if (!state || state.local.state === "ready") return null;
  const local = state.local;
  const percentage = local.expectedBytes > 0
    ? Math.min(100, Math.round((local.downloadedBytes / local.expectedBytes) * 100))
    : 0;
  return (
    <div className="mx-3 mt-3 rounded-md border p-3 text-xs space-y-2" role="status">
      <p className="font-medium">Local model: {local.state.replace(/_/g, " ")}</p>
      <p className="text-[var(--color-navy-mid)]">
        Chat uses the managed {local.model} model on this device. The model is downloaded only when you choose.
      </p>
      {local.state === "downloading" && (
        <>
          <div className="h-1.5 rounded bg-muted overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${percentage}%` }} />
          </div>
          <div className="flex items-center justify-between">
            <span>{percentage}%</span>
            <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </>
      )}
      {(local.state === "not_installed" || local.state === "failed") && (
        <Button size="sm" onClick={onInstall}>
          {local.state === "failed" ? "Retry model setup" : "Set up local model"}
        </Button>
      )}
      {(local.state === "loading" || local.state === "degraded") && (
        <Button size="sm" variant="outline" onClick={onStart}>Start local model</Button>
      )}
      {local.errorCode && <p className="text-destructive">{local.errorCode}</p>}
    </div>
  );
}

function ProposalCard({
  turn,
  onDecide,
  onOpenTask,
  compact,
}: {
  turn: ChatTurn;
  onDecide: (
    decision: "approve" | "edit" | "veto",
    editedOutput?: unknown,
  ) => Promise<void>;
  onOpenTask?: (taskId: string) => void;
  compact: boolean;
}) {
  const initial = useMemo(() => taskDraftFromTurn(turn), [turn]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TaskDraft | null>(initial);
  const pending = turn.state === "awaiting_decision";
  if (!turn.proposal || !initial || !draft) return null;
  return (
    <div className="mt-2 max-w-full rounded-md border bg-background p-3 text-left space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="secondary">Internal Strategist</Badge>
        <Badge variant="outline">Create a Task</Badge>
        <Badge variant="outline">{turn.proposal.dataScope ?? "private"}</Badge>
      </div>
      <p className="text-xs text-[var(--color-navy-mid)]">
        Selected because Task Manager is installed and the active Internal Strategist owns this schema-valid Skill.
      </p>
      {editing ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium">
            Title
            <input
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label className="block text-xs font-medium">
            Outcome
            <textarea
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              rows={compact ? 2 : 3}
              value={draft.outcome}
              onChange={(event) => setDraft({ ...draft, outcome: event.target.value })}
            />
          </label>
          <label className="block text-xs font-medium">
            Exit test
            <textarea
              className="mt-1 w-full rounded border px-2 py-1.5 font-normal"
              rows={compact ? 2 : 3}
              value={draft.exitTest}
              onChange={(event) => setDraft({ ...draft, exitTest: event.target.value })}
            />
          </label>
        </div>
      ) : (
        <dl className="text-xs space-y-1">
          <div><dt className="font-medium inline">Task: </dt><dd className="inline">{initial.title}</dd></div>
          <div><dt className="font-medium inline">Outcome: </dt><dd className="inline">{initial.outcome}</dd></div>
          <div><dt className="font-medium inline">Exit test: </dt><dd className="inline">{initial.exitTest}</dd></div>
        </dl>
      )}
      {pending ? (
        <div className="flex flex-wrap gap-1.5">
          {editing ? (
            <>
              <Button
                size="sm"
                onClick={() => void onDecide("edit", draft)}
                disabled={!draft.title.trim() || !draft.outcome.trim() || !draft.exitTest.trim()}
              >
                <Check className="size-3.5" /> Save and approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                setDraft(initial);
                setEditing(false);
              }}>
                Cancel edit
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => void onDecide("approve")}>
                <Check className="size-3.5" /> Approve
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant="outline" onClick={() => void onDecide("veto")}>
                <X className="size-3.5" /> Veto
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {turn.decision?.userDecision && (
            <Badge variant="outline">
              Decision: {turn.decision.userDecision}
            </Badge>
          )}
          {turn.automationRun && (
            <Badge variant="outline">
              Run: {turn.automationRun.status}
            </Badge>
          )}
          {turn.result?.task && (
            onOpenTask ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenTask(turn.result!.task!.id)}
              >
                Open Task
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link to={`/task-manager/${turn.result.task.id}`}>
                  Open Task
                </Link>
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function ChatView({
  surface,
  compact = false,
  className = "",
  onOpenTask,
}: ChatViewProps) {
  const chat = useChat(surface);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cloudConfirmRef = useRef<HTMLButtonElement>(null);
  const restoreComposerFocusRef = useRef(false);
  const lastTurn = chat.view?.turns.at(-1);

  useEffect(() => {
    const list = listRef.current;
    if (list && nearBottomRef.current) list.scrollTo({ top: list.scrollHeight });
  }, [lastTurn?.id, lastTurn?.state, lastTurn?.content]);

  useEffect(() => {
    if (chat.cloudDisclosure) {
      restoreComposerFocusRef.current = false;
      cloudConfirmRef.current?.focus();
      return;
    }
    if (!chat.sending && restoreComposerFocusRef.current) {
      restoreComposerFocusRef.current = false;
      inputRef.current?.focus();
    }
  }, [chat.cloudDisclosure, chat.sending]);

  const submit = async () => {
    const message = draft.trim();
    if (!message || chat.sending) return;
    restoreComposerFocusRef.current = true;
    const accepted = await chat.send(message);
    if (accepted) setDraft("");
  };

  if (chat.loading) {
    return (
      <div className={`flex flex-1 items-center justify-center ${className}`} role="status">
        <Loader2 className="size-5 animate-spin" />
        <span className="sr-only">Loading Chat</span>
      </div>
    );
  }

  const localThread = chat.view?.thread.plane === "local";
  const modelReady = !localThread || chat.model?.local.state === "ready";

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <select
          aria-label="Chat history"
          className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5 text-xs"
          value={chat.view?.thread.id ?? ""}
          onChange={(event) => void chat.selectThread(event.target.value)}
        >
          {chat.threads.map((thread) => (
            <option key={thread.id} value={thread.id}>
              {thread.title ?? `Chat · ${new Date(thread.createdAt).toLocaleDateString()}`}
            </option>
          ))}
        </select>
        <Button
          size="icon"
          variant="ghost"
          aria-label="New chat"
          onClick={() => void chat.newChat(chat.view?.thread.plane)}
        >
          <Plus className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Archive chat" onClick={() => void chat.archive()}>
          <Archive className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Delete chat" onClick={() => void chat.deleteChat()}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      {localThread && (
        <ModelSetup
          state={chat.model}
          onInstall={() => void chat.installModel()}
          onCancel={() => void chat.cancelInstall()}
          onStart={() => void chat.startModel()}
        />
      )}

      <div
        ref={listRef}
        className={`flex-1 overflow-auto space-y-3 ${compact ? "p-3" : "p-4"}`}
        onScroll={(event) => {
          nearBottomRef.current = isNearChatBottom(event.currentTarget);
        }}
        aria-live="polite"
        aria-busy={chat.sending}
      >
        {chat.view?.nextCursor && (
          <div className="flex justify-center">
            <Button size="sm" variant="ghost" onClick={() => void chat.loadOlder()}>
              Load older messages
            </Button>
          </div>
        )}
        {chat.view?.turns.length === 0 && (
          <div className="rounded-md border border-dashed p-4 text-sm text-[var(--color-navy-mid)]">
            {modelReady
              ? "This Chat is empty. Ask a question, or ask to create a Task for governed review."
              : "Set up the local model to start a private Chat. No conversation leaves this device."}
          </div>
        )}
        {chat.view?.turns.map((turn) => (
          <div key={turn.id} className={turn.role === "user" ? "text-right" : "text-left"}>
            <div
              className={`inline-block whitespace-pre-wrap break-words rounded-md px-3 py-2 ${
                compact ? "max-w-[92%] text-xs" : "max-w-[85%] text-sm"
              } ${
                turn.role === "user"
                  ? "bg-[var(--color-navy)] text-background"
                  : "bg-muted text-foreground"
              }`}
            >
              {turn.content || (turn.state === "processing" ? "Working…" : "")}
            </div>
            {turn.role === "assistant" && (
              <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                <Badge variant="outline">{turn.state.replace(/_/g, " ")}</Badge>
                {turn.refs.some((ref) => ref.kind === "model_receipt") && (
                  <Badge variant="outline">model receipt</Badge>
                )}
                {turn.refs.some((ref) => ref.kind === "automation_run") && (
                  <Badge variant="secondary">Agent Run</Badge>
                )}
                {turn.refs.some((ref) => ref.kind === "result") && (
                  <Badge variant="secondary">Result</Badge>
                )}
                {turn.state === "processing" && (
                  <Button size="sm" variant="ghost" onClick={() => void chat.cancel(turn)}>
                    <Square className="size-3" /> Stop
                  </Button>
                )}
                {turn.state === "failed" && (
                  <Button size="sm" variant="ghost" onClick={() => void chat.retry(turn)}>
                    <RotateCcw className="size-3" /> Retry
                  </Button>
                )}
              </div>
            )}
            {turn.role === "assistant" && turn.proposal && (
              <ProposalCard
                turn={turn}
                compact={compact}
                {...(onOpenTask ? { onOpenTask } : {})}
                onDecide={(decision, editedOutput) => chat.decide(turn, decision, editedOutput)}
              />
            )}
          </div>
        ))}
      </div>

      {chat.cloudDisclosure && (
        <div
          className="m-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 space-y-2"
          role="alertdialog"
          aria-labelledby="chat-cloud-consent-title"
        >
          <p id="chat-cloud-consent-title" className="font-medium">
            Send this exact public context to {chat.cloudDisclosure.disclosure.providerId}?
          </p>
          <p>Only the disclosed public message and history below will be sent to this model provider. Model consent applies once and expires at {new Date(chat.cloudDisclosure.expiresAt).toLocaleTimeString()}.</p>
          <details className="max-h-48 overflow-auto rounded border border-amber-200 bg-white p-2">
            <summary className="cursor-pointer font-medium">Review exact disclosed context</summary>
            <div className="mt-2 space-y-2">
              <div>
                <p className="font-medium">System instructions</p>
                <pre className="mt-1 whitespace-pre-wrap font-sans">
                  {chat.cloudDisclosure.disclosure.system}
                </pre>
              </div>
              {chat.cloudDisclosure.disclosure.history.length > 0 && (
                <div>
                  <p className="font-medium">Conversation history</p>
                  {chat.cloudDisclosure.disclosure.history.map((item, index) => (
                    <p key={`${item.role}-${index}`} className="mt-1 whitespace-pre-wrap">
                      <span className="font-medium">{item.role}: </span>
                      {item.content}
                    </p>
                  ))}
                </div>
              )}
              <div>
                <p className="font-medium">Current message</p>
                <p className="mt-1 whitespace-pre-wrap">
                  {chat.cloudDisclosure.disclosure.currentMessage}
                </p>
              </div>
            </div>
          </details>
          <div className="flex gap-2">
            <Button
              ref={cloudConfirmRef}
              size="sm"
              onClick={() => {
                const pendingMessage = chat.pendingCloudMessage;
                void chat.confirmCloud()
                  .then((accepted) => {
                    if (accepted && pendingMessage) {
                      setDraft((current) =>
                        current.trim() === pendingMessage ? "" : current,
                      );
                    }
                  })
                  .finally(() => inputRef.current?.focus());
              }}
            >
              Send public context once
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                chat.cancelCloud();
                inputRef.current?.focus();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {chat.error && (
        <div className="px-3 pb-2 text-xs text-destructive" role="alert">
          {chat.error}
        </div>
      )}

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={inputRef}
          aria-label="Chat message"
          className="min-h-10 max-h-32 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm"
          placeholder={modelReady ? "Ask Chief of Staff…" : "Set up the local model first"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          disabled={!modelReady || chat.sending}
          rows={compact ? 1 : 2}
        />
        <Button type="submit" disabled={!modelReady || chat.sending || !draft.trim()}>
          {chat.sending ? <Loader2 className="size-4 animate-spin" /> : "Send"}
        </Button>
      </form>
    </div>
  );
}
