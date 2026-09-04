import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowUp,
  Check,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Link } from "react-router";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { tauriInvoke, tauriInvokeJob } from "../avatar/tauri-internals";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";
import {
  AskSessionView,
  ResearchSessionView,
  researchRunLabel,
  type ResearchRunRow,
} from "./SessionHistoryView";
import {
  ASK_HISTORY_EVENT,
  askSessionLabel,
  isAskHistoryStorageKey,
  readAskSessions,
  type AskHistorySession,
} from "./ask-history";
import { isNearChatBottom } from "./chat-state.mjs";
import { type ChatSurfaceKind, type ChatTurn, useChat } from "./useChat";

const RECORDER_MIME_PREFERENCE = ["audio/mp4", "audio/webm", "audio/ogg"];

/** Chat attachments ride `modules.addFile` — the one Module File path — into
 * Chief of Staff's own Module, landing under
 * `~/Documents/Bridge/<Organization>/TaskManager/` (ADR-125/178). Mirrors
 * `CHAT_ATTACHMENT_MODULE` in the API router. */
const ATTACHMENT_MODULE = "task-manager";

/** The same 10 MB ceiling `modules.addFile` enforces server-side, checked here
 * so a too-large file is refused before it is base64-encoded. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** "let's play a game" / "catch me if you can" starts the chase game
 * (`chase.rs`) — the companion's own on-screen pointer flees the real
 * cursor across the desktop until caught. "stop the game" ends it early. */
const CHASE_GAME_TRIGGER = /play (a |)game|catch me if you can/i;
const CHASE_GAME_STOP_TRIGGER = /stop (the |)game|stop chasing|stop playing/i;

/** "point at/to the settings button" locates a named UI element on screen
 * (`point.rs` — same two-stage vision locator `companion_ask` uses) and both
 * spotlights it and glides the avatar there. Same standing Cloud Plane
 * consent as chat (AP-142/AP-143) — the screenshot goes out with no separate
 * prompt. */
const POINT_AT_TRIGGER = /^point\s+(?:at|to|towards)\s+(.+)/i;

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface ChatViewProps {
  surface: ChatSurfaceKind;
  /** Binds this view to a Module's own conversation (ADR-267e). */
  moduleName?: string;
  compact?: boolean;
  className?: string;
  onOpenTask?: (taskId: string) => void;
  /** Seeds the composer (e.g. text carried over from the avatar's hover
   * input) so the user's keystrokes aren't lost when the panel expands. */
  initialDraft?: string;
  /** Sends `initialDraft` as soon as the thread is ready, once, instead of
   * leaving it in the composer for a second Enter press. */
  autoSend?: boolean;
}

/** A parent Task the server's deterministic matcher put forward, with the WHY
 * it produced. Suggestion only — the reviewer keeps, clears, or swaps it. */
interface TaskParentCandidate {
  taskId: string;
  title: string;
  reason: string;
  score: number;
}

interface TaskDraft {
  kind: "task_create";
  /** "append" continues the Task this Chat thread already created. */
  mode: "create" | "append";
  taskId: string;
  title: string;
  outcome: string;
  exitTest: string;
  parentTaskId: string | null;
  parentRationale: string | null;
  parentCandidates: TaskParentCandidate[];
  status: "proposed";
}

function parentCandidatesFrom(value: unknown): TaskParentCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.taskId !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.reason !== "string" ||
      typeof candidate.score !== "number"
    ) {
      return [];
    }
    return [{
      taskId: candidate.taskId,
      title: candidate.title,
      reason: candidate.reason,
      score: candidate.score,
    }];
  });
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
    mode: candidate.mode === "append" ? "append" : "create",
    taskId: candidate.taskId,
    title: candidate.title,
    outcome: candidate.outcome,
    exitTest: candidate.exitTest,
    parentTaskId: typeof candidate.parentTaskId === "string" ? candidate.parentTaskId : null,
    parentRationale:
      typeof candidate.parentRationale === "string" ? candidate.parentRationale : null,
    parentCandidates: parentCandidatesFrom(candidate.parentCandidates),
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
  if (!state) return null;
  const cloudNote = state.cloud.available
    ? " The Model dropdown above can switch a new Chat to Groq (Cloud) instead."
    : state.cloud.restartRequired
      ? " A Groq key is saved in Settings → API Keys but needs Bridge restarted to activate."
      : (
        <>
          {" "}Or{" "}
          <Link to="/settings?section=api" className="underline">
            add a Groq API key in Settings
          </Link>
          {" "}to chat over the Cloud Plane instead.
        </>
      );
  if (state.local.state === "ready") return null;
  const local = state.local;
  const percentage = local.expectedBytes > 0
    ? Math.min(100, Math.round((local.downloadedBytes / local.expectedBytes) * 100))
    : 0;
  return (
    <div className="mx-3 mt-3 rounded-md border p-3 text-xs space-y-2" role="status">
      <p className="font-medium">Local model: {local.state.replace(/_/g, " ")}</p>
      <p className="text-[var(--color-navy-mid)]">
        Chat uses the managed {local.model} model on this device. The model is downloaded only when you choose.
        {cloudNote}
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

/** Where the new Task node lands in the tree. The match is only ever shown,
 * never applied silently: the reason that produced it is displayed, and the
 * reviewer can keep it, clear it, or pick another candidate before approving. */
function ParentSuggestion({
  draft,
  editable,
  onChange,
}: {
  draft: TaskDraft;
  editable: boolean;
  onChange: (parentTaskId: string | null) => void;
}) {
  const selected = draft.parentCandidates.find(
    (candidate) => candidate.taskId === draft.parentTaskId,
  );
  if (!editable) {
    return (
      <p className="text-xs text-[var(--color-navy-mid)]">
        {selected
          ? `Placed under "${selected.title}".`
          : "Placed at the top level of Task Manager."}
      </p>
    );
  }
  return (
    <div className="rounded border border-dashed p-2 text-xs space-y-1.5">
      <p className="font-medium">
        {draft.parentTaskId ? "Suggested parent Task" : "No parent Task"}
      </p>
      <p className="text-[var(--color-navy-mid)]">
        {draft.parentTaskId
          ? draft.parentRationale ?? "Matched against your open Tasks."
          : draft.parentCandidates.length > 0
            ? "This Task will sit at the top level. You can place it under one of the matches below."
            : "No open Task matched, so this one starts at the top level."}
      </p>
      {draft.parentCandidates.length > 0 && (
        <label className="block font-medium">
          Parent Task
          <select
            className="mt-1 w-full rounded border bg-background px-2 py-1.5 font-normal"
            value={draft.parentTaskId ?? ""}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">No parent (top level)</option>
            {draft.parentCandidates.map((candidate) => (
              <option key={candidate.taskId} value={candidate.taskId}>
                {candidate.title}
              </option>
            ))}
          </select>
        </label>
      )}
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
        <Badge variant="outline">
          {draft.mode === "append" ? "Continue this Chat's Task" : "Create a Task"}
        </Badge>
        <Badge variant="outline">{turn.proposal.dataScope ?? "private"}</Badge>
      </div>
      <p className="text-xs text-[var(--color-navy-mid)]">
        {draft.mode === "append"
          ? "This Chat already created a Task, so this follow-up is added to that same Task as another Outcome. Its exit test stays as it was."
          : "Selected because Task Manager is installed and the active Internal Strategist owns this schema-valid Skill."}
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
          {draft.mode === "create" && (
            <div><dt className="font-medium inline">Exit test: </dt><dd className="inline">{initial.exitTest}</dd></div>
          )}
        </dl>
      )}
      {draft.mode === "create" && (
        <ParentSuggestion
          draft={draft}
          editable={pending}
          onChange={(parentTaskId) =>
            setDraft({
              ...draft,
              parentTaskId,
              parentRationale:
                draft.parentCandidates.find((candidate) => candidate.taskId === parentTaskId)
                  ?.reason ?? null,
            })
          }
        />
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
              {/* A parent chosen in the card is still a Human edit of the
                * proposed output, so it must travel as `edit`, never as a
                * bare `approve` of something the reviewer changed. */}
              <Button
                size="sm"
                onClick={() =>
                  void (draft.parentTaskId === initial.parentTaskId
                    ? onDecide("approve")
                    : onDecide("edit", draft))
                }
              >
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
  moduleName,
  compact = false,
  className = "",
  onOpenTask,
  initialDraft,
  autoSend = false,
}: ChatViewProps) {
  const chat = useChat(surface, moduleName);
  const [draft, setDraft] = useState(initialDraft ?? "");
  // Past companion sessions listed alongside the Chat threads in the history
  // dropdown (user directive 2026-08-16). Selecting one shows a read-only
  // transcript instead of the conversation; `null` means a Chat thread is
  // showing. Research Runs are already durable owner-scoped kernel records, so
  // this is a read of history that exists, not a new store.
  const [researchRuns, setResearchRuns] = useState<ResearchRunRow[]>([]);
  // Ask sessions live on this device only (chat/ask-history.ts), so they are
  // read from local storage rather than the API.
  const [askSessions, setAskSessions] = useState<AskHistorySession[]>(() =>
    typeof window === "undefined" ? [] : readAskSessions(),
  );
  const [openSession, setOpenSession] = useState<
    { kind: "research" | "ask"; id: string } | null
  >(null);
  // TASK-093: one conversation can span several Modules. The thread already
  // carries them server-side (`moduleName` + `attachedModules`); this is the
  // control that puts a second one on, and the list that shows which are on.
  const [installedModules, setInstalledModules] = useState<
    readonly { moduleName: string; displayName: string }[]
  >([]);
  const listRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cloudConfirmRef = useRef<HTMLButtonElement>(null);
  const restoreComposerFocusRef = useRef(false);
  const autoSentRef = useRef(false);
  const lastTurn = chat.view?.turns.at(-1);

  // Installed Modules, for the attach control. Same filter the nav uses, so
  // the list offered here is exactly the list of Modules a user can open.
  useEffect(() => {
    let active = true;
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((result) => {
        if (!active) return;
        setInstalledModules(
          result.items
            .filter(
              (item) =>
                item.state === "available" &&
                item.status === "installed" &&
                item.manifest?.module !== undefined &&
                item.moduleAttachment === undefined,
            )
            .map((item) => ({
              moduleName: item.moduleName,
              displayName:
                item.displayNameOverride ??
                item.manifest?.module?.displayName ??
                item.manifest?.name ??
                item.moduleName,
            })),
        );
      })
      .catch(() => {
        // The attach control simply has nothing to offer; the Chat still works.
        if (active) setInstalledModules([]);
      });
    return () => {
      active = false;
    };
  }, []);

  /** Modules currently on this conversation — the Module that owns the thread
   * first, then everything attached to it. */
  const threadModules = useMemo(() => {
    const thread = chat.view?.thread;
    if (!thread) return [] as string[];
    return [
      ...(thread.moduleName ? [thread.moduleName] : []),
      ...(thread.attachedModules ?? []),
    ];
  }, [chat.view?.thread]);

  const moduleLabel = (name: string) =>
    installedModules.find((module) => module.moduleName === name)?.displayName ?? name;

  // ---- voice input (every surface — `chat.voice.transcribe` is a server
  // procedure, so there is no desktop-only branch left; TASK-082) --------
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [composerNote, setComposerNote] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // ---- attachments (TASK-082) ----------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // An ask answered in the floating companion has to show up in the Chat panel
  // that is already open: same-webview writes announce themselves, and the
  // browser's own storage event carries changes from the other window.
  useEffect(() => {
    const refresh = () => setAskSessions(readAskSessions());
    const onStorage = (event: StorageEvent) => {
      if (isAskHistoryStorageKey(event.key)) refresh();
    };
    refresh();
    window.addEventListener(ASK_HISTORY_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ASK_HISTORY_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Refreshed on mount and whenever the Chat thread list changes (the same
  // moments the dropdown is rebuilt). Failure is silent and leaves the group
  // out: a missing history list must never break the conversation itself.
  useEffect(() => {
    let active = true;
    trpc.agentOrchestration.research.list
      .query({ organizationId: PILOT_ORGANIZATION })
      .then((rows) => {
        if (active) setResearchRuns([...rows]);
      })
      .catch(() => {
        if (active) setResearchRuns([]);
      });
    return () => {
      active = false;
    };
  }, [chat.threads.length]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
      }
    };
  }, []);

  const startRecording = async () => {
    if (recording || transcribing) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setComposerNote("Microphone capture is unavailable here — type instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = RECORDER_MIME_PREFERENCE.find((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blobType = recorder.mimeType.split(";")[0] || "audio/webm";
        const blob = new Blob(chunks, { type: blobType });
        if (streamRef.current) {
          for (const track of streamRef.current.getTracks()) track.stop();
          streamRef.current = null;
        }
        recorderRef.current = null;
        setRecording(false);
        if (blob.size === 0) return;
        setTranscribing(true);
        void (async () => {
          try {
            const { text: transcript } = await trpc.chat.voice.transcribe.mutate({
              organizationId: PILOT_ORGANIZATION,
              audioBase64: await blobToBase64(blob),
              mime: blobType,
            });
            // Dictation fills the composer rather than auto-sending — a Chat
            // turn can trigger governed Task proposals, so the human still
            // reviews the text before it becomes a message (AP-021/AP-105).
            if (transcript) {
              setDraft((current) => (current ? `${current} ${transcript}` : transcript));
              inputRef.current?.focus();
            }
          } catch (raised) {
            setComposerNote(raised instanceof Error ? raised.message : String(raised));
          } finally {
            setTranscribing(false);
          }
        })();
      };
      recorderRef.current = recorder;
      recorder.start();
      setComposerNote(null);
      setRecording(true);
    } catch {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
      setComposerNote("Microphone permission was declined — type instead.");
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      setRecording(false);
    }
  };

  // Both composer controls stay VISIBLE and state their own reason when they
  // cannot act (ADR-001, rulebook §3a). The reason is the SERVER's — a missing
  // Groq key, or a public-cloud shell with no local File tree — so the control
  // never has to guess from the shell it happens to be running in.
  const voiceUnavailableReason = chat.model
    ? chat.model.composer.voice.reason
    : "Checking whether voice input is available…";
  const attachmentUnavailableReason = chat.model
    ? chat.model.composer.attachments.reason
    : "Checking whether attachments can be saved…";

  /** One attachment, through the one Module File path. The saved path is
   * appended to the draft so the message the user sends carries the reference
   * — the Chat turn is plain text, so the reference lives in the text rather
   * than in a second attachment store. */
  const attachFiles = async (chosen: readonly File[]) => {
    if (chosen.length === 0) return;
    setUploading(true);
    setComposerNote(null);
    try {
      const saved: string[] = [];
      for (const file of chosen) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`${file.name} exceeds the 10 MB local File limit.`);
        }
        const stored = await trpc.modules.addFile.mutate({
          organizationId: PILOT_ORGANIZATION,
          moduleName: ATTACHMENT_MODULE,
          fileName: file.name,
          contentBase64: await blobToBase64(file),
        });
        saved.push(stored.path);
      }
      const reference = saved
        .map((path) => `[Attachment: Bridge/TaskManager/${path}]`)
        .join(" ");
      setDraft((current) => (current ? `${current} ${reference}` : reference));
      inputRef.current?.focus();
    } catch (raised) {
      setComposerNote(raised instanceof Error ? raised.message : String(raised));
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const list = listRef.current;
    if (list && nearBottomRef.current) list.scrollTo({ top: list.scrollHeight });
  }, [lastTurn?.id, lastTurn?.state, lastTurn?.content]);

  // Carries a message typed into the avatar's hover input straight into the
  // first turn of the newly-opened panel, instead of requiring the user to
  // retype or press Enter twice.
  useEffect(() => {
    if (!autoSend || autoSentRef.current || !initialDraft?.trim() || chat.loading) return;
    autoSentRef.current = true;
    restoreComposerFocusRef.current = true;
    void chat.send(initialDraft.trim()).then((accepted) => {
      if (accepted) setDraft("");
    });
  }, [autoSend, initialDraft, chat.loading]);

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
    // Easter egg, not a governed action: no data touched, nothing to approve.
    // Fires alongside the normal send — see chase.rs — and no-ops outside the
    // desktop shell (tauriInvoke degrades silently in the browser).
    const pointMatch = POINT_AT_TRIGGER.exec(message);
    if (CHASE_GAME_STOP_TRIGGER.test(message)) void tauriInvoke("stop_chase_game");
    else if (CHASE_GAME_TRIGGER.test(message)) void tauriInvoke("start_chase_game");
    else if (pointMatch) {
      void tauriInvokeJob("point_at_start", "point_at_poll", { target: pointMatch[1].trim() }, {
        valueKey: "done",
        timeoutMs: 20_000,
      }).catch((error: unknown) => console.error("[companion] point-at failed", error));
    }
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

  // A selected read-only session, if any. Resolved from the list so a run that
  // disappears (deleted, or the list failed to load) falls back to the Chat
  // conversation rather than rendering an empty transcript.
  const openRun = openSession?.kind === "research"
    ? researchRuns.find((run) => run.id === openSession.id) ?? null
    : null;
  const openAsk = openSession?.kind === "ask"
    ? askSessions.find((entry) => entry.id === openSession.id) ?? null
    : null;
  const openHistory = openRun ?? openAsk;
  // An agentic thread never touches the managed local model, so the local
  // model's setup state must not gate its composer.
  const agenticThread = Boolean(chat.view && chat.view.thread.backend !== "bridge");
  const localThread = !agenticThread && chat.view?.thread.plane === "local";
  const modelReady = !localThread || chat.model?.local.state === "ready";

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <select
          aria-label="Chat history"
          className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5 text-xs"
          value={
            openSession
              ? `${openSession.kind}:${openSession.id}`
              : chat.view?.thread.id ?? ""
          }
          onChange={(event) => {
            const value = event.target.value;
            for (const kind of ["research", "ask"] as const) {
              if (value.startsWith(`${kind}:`)) {
                setOpenSession({ kind, id: value.slice(kind.length + 1) });
                return;
              }
            }
            setOpenSession(null);
            void chat.selectThread(value);
          }}
        >
          <optgroup label="Chat">
            {/* With no thread to select — the conversation failed to load, or
             * there are none yet — the select would otherwise fall back to
             * DISPLAYING the first session in the list as chosen while the live
             * chat is what is actually on screen. An explicit empty option
             * keeps the label honest about what you are looking at. */}
            {!chat.view && <option value="">No chat selected</option>}
            {chat.threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title ?? `Chat · ${new Date(thread.createdAt).toLocaleDateString()}`}
              </option>
            ))}
          </optgroup>
          {askSessions.length > 0 && (
            <optgroup label="Ask">
              {askSessions.map((session) => (
                <option key={session.id} value={`ask:${session.id}`}>
                  {askSessionLabel(session)}
                </option>
              ))}
            </optgroup>
          )}
          {researchRuns.length > 0 && (
            <optgroup label="Research">
              {researchRuns.map((run) => (
                <option key={run.id} value={`research:${run.id}`}>
                  {researchRunLabel(run)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <Button
          size="icon"
          variant="ghost"
          aria-label="New chat"
          onClick={() => {
            setOpenSession(null);
            void chat.newChat(chat.view?.thread.plane);
          }}
        >
          <Plus className="size-4" />
        </Button>
        {/* Archive and Delete act on the Chat thread. A read-only session
         * transcript is not one, so they are absent rather than present and
         * quietly destroying whichever thread happened to be selected. */}
        {!openHistory && (
          <>
            <Button size="icon" variant="ghost" aria-label="Archive chat" onClick={() => void chat.archive()}>
              <Archive className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Delete chat" onClick={() => void chat.deleteChat()}>
              <Trash2 className="size-4" />
            </Button>
          </>
        )}
      </div>

      {openRun && <ResearchSessionView run={openRun} compact={compact} />}
      {openAsk && <AskSessionView session={openAsk} compact={compact} />}

      {!openHistory && localThread && (
        <ModelSetup
          state={chat.model}
          onInstall={() => void chat.installModel()}
          onCancel={() => void chat.cancelInstall()}
          onStart={() => void chat.startModel()}
        />
      )}

      {!openHistory && (
      <>
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
              : chat.model?.cloud.available
                ? "Set up the local model below, or pick Cloud in the model menu to chat with Groq instead."
                : chat.model?.cloud.restartRequired
                  ? "Set up the local model below. A Groq key is saved in Settings but needs Bridge restarted before Cloud chat is available."
                  : "Set up the local model below to start a private Chat, or add a Groq API key in Settings → API Keys to chat over the Cloud Plane instead."}
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
        className={`border-t ${compact ? "p-2" : "p-3"}`}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div
          className={`flex flex-col gap-1.5 rounded-2xl border bg-background focus-within:ring-1 focus-within:ring-ring ${
            compact ? "p-1.5" : "p-2"
          }`}
        >
          <textarea
            ref={inputRef}
            aria-label="Chat message"
            className="max-h-32 min-h-8 w-full resize-none border-0 bg-transparent px-1.5 py-1 text-sm outline-none focus-visible:outline-none disabled:opacity-50"
            placeholder={
              modelReady
                ? "Ask Chief of Staff…"
                : chat.model?.cloud.available
                  ? "Set up the local model, or pick Cloud in the model menu"
                  : "Set up the local model first"
            }
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
          <div className="flex items-center justify-between gap-1">
            <div className="flex min-w-0 items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  const chosen = [...(event.currentTarget.files ?? [])];
                  event.currentTarget.value = "";
                  void attachFiles(chosen);
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={compact ? "size-7" : "size-8"}
                aria-label="Add attachment"
                title={attachmentUnavailableReason ?? "Add attachment"}
                disabled={Boolean(attachmentUnavailableReason) || uploading || chat.sending}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className={`${compact ? "size-3.5" : "size-4"} animate-spin`} />
                ) : (
                  <Paperclip className={compact ? "size-3.5" : "size-4"} />
                )}
              </Button>
              <select
                aria-label="Chat model"
                className="min-w-0 max-w-[11rem] truncate rounded-full border bg-background px-2 py-1 text-xs disabled:opacity-50"
                value={
                  chat.view && chat.view.thread.backend !== "bridge"
                    ? `backend:${chat.view.thread.backend}`
                    : chat.view?.thread.plane ?? "local"
                }
                disabled={chat.sending}
                onChange={(event) => {
                  const selected = event.target.value;
                  // Switching the model repoints THIS conversation — Bridge
                  // holds the context, so the thread and its turns survive.
                  // An agentic backend picks its own plane server-side, so the
                  // two option families are exclusive rather than combinable.
                  if (selected.startsWith("backend:")) {
                    void chat.switchBackend(
                      selected.slice("backend:".length) as "claude_code",
                    );
                    return;
                  }
                  void chat.switchBackend("bridge", selected === "cloud" ? "cloud" : "local");
                }}
                title="Switches this Chat to the selected model — the conversation is kept"
              >
                <option value="local">Local model</option>
                {chat.model?.cloud.available ? (
                  <option value="cloud">Cloud · {chat.model.cloud.providerId}</option>
                ) : chat.model?.cloud.restartRequired ? (
                  // The key is saved (Settings → API Keys) but this process's
                  // router snapshot predates it (ADR-181) — say so rather
                  // than silently omitting Cloud as if nothing were set up.
                  <option value="cloud" disabled>Cloud — restart to activate</option>
                ) : chat.model?.cloud.configured === false ? (
                  <option value="cloud" disabled>Cloud — add a key in Settings</option>
                ) : null}
                {/* Agentic backends — present only when this deployment
                    actually wired one, so an offered option always runs. */}
                {(chat.model?.backends ?? []).map((backend) => (
                  <option
                    key={backend.id}
                    value={`backend:${backend.id}`}
                    disabled={!backend.ready}
                  >
                    {backend.ready ? backend.label : `${backend.label} — sign in`}
                  </option>
                ))}
              </select>
              {/* TASK-093 — attach another Module to THIS conversation. The
                  thread keeps its own Module; this adds others so one session
                  can span several, the way a coding session spans projects. */}
              <select
                aria-label="Attach a Module"
                className="min-w-0 max-w-[9rem] truncate rounded-full border bg-background px-2 py-1 text-xs disabled:opacity-50"
                value=""
                disabled={chat.sending || !chat.view}
                onChange={(event) => {
                  const chosen = event.target.value;
                  event.target.value = "";
                  if (chosen) void chat.attachModule(chosen);
                }}
                title="Adds a Module to this conversation — nothing is removed"
              >
                <option value="">
                  {threadModules.length > 0
                    ? `Modules · ${threadModules.length}`
                    : "Add a Module"}
                </option>
                {installedModules
                  .filter((module) => !threadModules.includes(module.moduleName))
                  .map((module) => (
                    <option key={module.moduleName} value={module.moduleName}>
                      {module.displayName}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={`${compact ? "size-7" : "size-8"} ${recording ? "text-destructive" : ""}`}
                aria-label={recording ? "Stop recording" : "Voice input"}
                title={voiceUnavailableReason ?? (recording ? "Stop recording" : "Voice input")}
                disabled={Boolean(voiceUnavailableReason) || transcribing || !modelReady || chat.sending}
                onClick={() => (recording ? stopRecording() : void startRecording())}
              >
                {transcribing ? (
                  <Loader2 className={`${compact ? "size-3.5" : "size-4"} animate-spin`} />
                ) : recording ? (
                  <Square className={compact ? "size-3.5" : "size-4"} />
                ) : (
                  <Mic className={compact ? "size-3.5" : "size-4"} />
                )}
              </Button>
              <Button
                type="submit"
                size="icon"
                className={`rounded-full ${compact ? "size-7" : "size-8"}`}
                aria-label="Send message"
                disabled={!modelReady || chat.sending || !draft.trim()}
              >
                {chat.sending ? (
                  <Loader2 className={`${compact ? "size-3.5" : "size-4"} animate-spin`} />
                ) : (
                  <ArrowUp className={compact ? "size-3.5" : "size-4"} />
                )}
              </Button>
            </div>
          </div>
        </div>
        {threadModules.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1 px-1 text-xs text-[var(--color-navy-mid)]">
            <span>On this conversation:</span>
            {threadModules.map((name) => (
              <Badge key={name} variant="secondary" className="text-[0.7rem]">
                {moduleLabel(name)}
              </Badge>
            ))}
          </p>
        )}
        {composerNote && (
          <p className="mt-1 px-1 text-xs text-[var(--color-navy-mid)]" role="status">
            {composerNote}
          </p>
        )}
      </form>
      </>
      )}
    </div>
  );
}
