/**
 * CompanionAsk — the screen-aware "ask" body of the floating companion
 * (TASK-027, clicky-parity). Rendered inside OverlayApp's ask panel.
 *
 * Loop: question (typed, or push-to-talk transcription) → optional ONE
 * consented screenshot → model answer → typed on-screen pointing marks
 * (Rust-validated, drawn by the click-through annotate window) → optional
 * local spoken answer (macOS `say`).
 *
 * Residency rules surfaced honestly in the UI:
 *  - The screen checkbox is per-session, default OFF, and its copy states
 *    exactly what leaves the machine (one screenshot, to which provider).
 *  - Without a cloud key the ask runs on the managed LOCAL model and the
 *    panel says the companion cannot see the screen in that mode.
 *  - Push-to-talk audio is recorded only while the shortcut is held and is
 *    sent only to the transcription provider; unavailable → typed input.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchCaptureEvent, setAvatarStatus } from "./avatar-store";
import { tauriInvoke, tauriInvokeJob, tauriInvokeStrict, tauriListen } from "./tauri-internals";
import { readAllowControl } from "./DoRun";
import { appendAskTurn } from "../chat/ask-history";
import { ResearchRun } from "./ResearchRun";
import { DoRun } from "./DoRun";

export const AVATAR_SHARE_SCREEN_KEY = "bridge:avatar:share_screen";
export const AVATAR_SPEAK_ANSWERS_KEY = "bridge:avatar:speak_answers";
export const AVATAR_DICTATE_KEY = "bridge:avatar:dictate";

function readDictate() {
  try { return localStorage.getItem(AVATAR_DICTATE_KEY) === "true"; } catch { return false; }
}

export function readAvatarShareScreenPreference() {
  try { return localStorage.getItem(AVATAR_SHARE_SCREEN_KEY) === "true"; } catch { return false; }
}
function readSpeakAnswers() {
  try { return localStorage.getItem(AVATAR_SPEAK_ANSWERS_KEY) !== "false"; } catch { return true; }
}

function isExplicitResearch(text: string) {
  const t = text.trim().toLowerCase();
  return t.startsWith("research ") || t.startsWith("deep research") || t.startsWith("deep dive");
}

/** "do …" / "click …" / "type …" are tasks for the hands, not questions. */
export function isExplicitDo(text: string) {
  const t = text.trim().toLowerCase();
  return ["do ", "click ", "type ", "open ", "go to ", "press "].some((p) => t.startsWith(p));
}

interface CompanionCapabilities {
  cloudVision: boolean;
  visionModel: string;
  localModel: boolean;
  cloudStt: boolean;
  tts: boolean;
  screenPermission: boolean;
  /** macOS Accessibility granted — the hands (Do mode) need it. */
  accessibility: boolean;
}

interface CompanionAnswer {
  text: string;
  provider: "groq-vision" | "groq-text" | "local-qwen";
  screenShared: boolean;
  points: number;
  spoke: boolean;
  captureNote: string | null;
  emotion: string | null;
}

interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
  /** This turn's text came from an answer produced with screen sharing ON —
   * the tag mirrors Rust's `HistoryTurn.screen_derived` and travels with the
   * turn so egress policy can reason about it. */
  screenDerived?: boolean;
}

/** Conversation memory is per-session and idle-bounded: a gap longer than
 * this clears it, matching how a human would treat a stale conversation. */
const HISTORY_IDLE_TTL_MS = 15 * 60_000;

interface AskError {
  code: string;
  message: string;
}

function toAskError(error: unknown): AskError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const typed = error as { code: unknown; message: unknown };
    return { code: String(typed.code), message: String(typed.message) };
  }
  return { code: "COMPANION_UNKNOWN", message: String(error) };
}

const RECORDER_MIME_PREFERENCE = ["audio/mp4", "audio/webm", "audio/ogg"];

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

export function CompanionAsk({
  name,
  pttActive,
  autoQuestion,
  onAutoQuestionConsumed,
  onAnswered,
  onSpeechStopped,
  onTaskDone,
}: {
  name: string;
  /** True while the global push-to-talk shortcut is held. */
  pttActive: boolean;
  /** One-shot screen-aware question supplied by the Observe menu action. */
  autoQuestion?: { text: string; nonce: number } | null;
  onAutoQuestionConsumed?: () => void;
  /** Fired once per successfully delivered answer. Receives the answer text,
   * the model's emotion tag (one of the ZazooEmotion names) so the shell can
   * animate the rig to match the reply's emotional tone, and whether the answer
   * is actually being read aloud right now — the cue the mouth flaps on. */
  onAnswered?: (text: string, emotion?: string, spoke?: boolean) => void;
  /** Speech was cut short — the mouth has to stop with it. */
  onSpeechStopped?: () => void;
  /** Dictation has been typed into the app the user was in — the request is
   * carried out and the panel has nothing more to show. */
  onTaskDone?: () => void;
}) {
  const [capabilities, setCapabilities] = useState<CompanionCapabilities | null>(null);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"ask" | "research" | "do">("ask");
  const researchMode = mode === "research";
  const setResearchMode = (on: boolean) => setMode(on ? "research" : "ask");
  // Shared with Settings → Avatar, but screen egress must also be visible and
  // controllable at the point where the user asks a question.
  const [shareScreen, setShareScreen] = useState(readAvatarShareScreenPreference);
  const [speakAnswers] = useState(readSpeakAnswers);
  /** Dictation: what you say with the shortcut held is TYPED into the app
   * you are in, instead of asked. Needs the same control consent as Do. */
  const [dictate, setDictate] = useState(readDictate);
  const dictateRef = useRef(dictate);
  dictateRef.current = dictate;
  const [dictationNote, setDictationNote] = useState<string | null>(null);
  /** The area the user circled on screen for the next ask. */
  const [focusRegion, setFocusRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [circling, setCircling] = useState(false);
  const [busy, setBusy] = useState<"idle" | "capturing" | "thinking" | "transcribing">("idle");
  const [answer, setAnswer] = useState<CompanionAnswer | null>(null);
  const [error, setError] = useState<AskError | null>(null);
  const [micNote, setMicNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const historyRef = useRef<HistoryTurn[]>([]);
  const lastAskAtRef = useRef(0);
  /** The device-local history session these asks are filed under. Reset by the
   * same idle gap that clears `historyRef`, so a recorded session is exactly
   * what the model treated as one conversation. */
  const sessionRef = useRef<{ id: string; startedAt: string } | null>(null);
  /** History is a convenience, but a silent failure to keep it is not: say so
   * once rather than letting the user believe an answer was filed. */
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const lastAutoQuestionRef = useRef<number | null>(null);
  const responseRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!answer && !error) return;
    const frame = requestAnimationFrame(() => {
      responseRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [answer, error]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void tauriListen<{ x: number; y: number; width: number; height: number }>("bridge:scribble-region", (region) => {
      setCircling(false);
      if (region && Number.isFinite(region.width)) setFocusRegion(region);
    }).then((unlisten) => { stop = unlisten; });
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setCircling(false); void tauriInvoke("annotate_scribble_cancel"); }
    }
    window.addEventListener("keydown", onKey);
    return () => { stop?.(); window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => {
    void tauriInvoke("companion_capabilities").then((value) => {
      if (value && typeof value === "object") {
        setCapabilities(value as CompanionCapabilities);
      }
    });
    return () => {
      // Leaving the panel stops any in-flight speech and releases the mic.
      void tauriInvoke("companion_stop_speaking");
      stopStream();
    };
    // Mount-only on purpose. (No react-hooks plugin is registered in this
    // repo's ESLint config, so a rule-name suppression here would itself be
    // a lint error — see BUGS 2026-07-17.)
  }, []);

  function stopStream() {
    recorderRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current) return;
      busyRef.current = true;
      setError(null);
      setAnswer(null);
      const sharing = shareScreen && Boolean(capabilities?.cloudVision);
      // Stale conversation = new conversation. Lazily enforced on the next
      // ask, mirroring the jobs-table purge-on-start discipline.
      if (Date.now() - lastAskAtRef.current > HISTORY_IDLE_TTL_MS) {
        historyRef.current = [];
        sessionRef.current = null;
      }
      if (!sessionRef.current) {
        sessionRef.current = {
          id: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
        };
      }
      lastAskAtRef.current = Date.now();
      setBusy(sharing ? "capturing" : "thinking");
      setAvatarStatus(sharing ? "reading_context" : "drafting");
      try {
        const result = await tauriInvokeJob<CompanionAnswer>(
          "companion_ask_start",
          "companion_ask_poll",
          {
            request: {
              question: trimmed,
              shareScreenWithCloud: sharing,
              speak: speakAnswers && Boolean(capabilities?.tts),
              history: historyRef.current.slice(-10),
              focusRegion: sharing ? focusRegion : null,
            },
          },
          { valueKey: "answer", timeoutMs: 120_000 },
        );
        if (result.screenShared) dispatchCaptureEvent({ kind: "screen" });
        historyRef.current = [
          ...historyRef.current.slice(-8),
          { role: "user", content: trimmed },
          // Answers produced while sharing carry screen-derived text; the tag
          // keeps that provenance when the turn rides along on a later ask.
          { role: "assistant", content: result.text, screenDerived: result.screenShared },
        ];
        // Filed on this device only (see chat/ask-history.ts) so the Chat
        // panel's history dropdown can read the session back.
        const session = sessionRef.current;
        if (session) {
          const kept = appendAskTurn(session, {
            question: trimmed,
            answer: result.text,
            provider: result.provider,
            screenShared: result.screenShared,
            at: new Date().toISOString(),
          });
          setHistoryNote(kept ? null : "This answer could not be saved to your local history.");
        }
        onAnswered?.(result.text, result.emotion ?? undefined, result.spoke);
        setAnswer(result);
        setQuestion("");
        setFocusRegion(null);
        void tauriInvoke("annotate_scribble_cancel");
      } catch (raised) {
        setError(toAskError(raised));
      } finally {
        busyRef.current = false;
        setBusy("idle");
        setAvatarStatus("idle");
      }
    },
    [capabilities, focusRegion, shareScreen, speakAnswers],
  );

  useEffect(() => {
    if (
      !autoQuestion ||
      !capabilities ||
      lastAutoQuestionRef.current === autoQuestion.nonce
    ) {
      return;
    }
    lastAutoQuestionRef.current = autoQuestion.nonce;
    onAutoQuestionConsumed?.();
    setQuestion(autoQuestion.text);
    if (!shareScreen) {
      setError({
        code: "COMPANION_SCREEN_SHARING_DISABLED",
        message:
          "Observe needs screen sharing. Enable Share screen with questions above, then press Ask.",
      });
      return;
    }
    if (!capabilities.cloudVision) {
      setError({
        code: "COMPANION_NO_VISION_PROVIDER",
        message:
          "Observe needs a Groq API key in Settings → API Keys. The installed local model and Chief of Staff chat model are text-only and cannot analyze screenshots.",
      });
      return;
    }
    void ask(autoQuestion.text);
  }, [ask, autoQuestion, capabilities, onAutoQuestionConsumed, shareScreen]);

  // ---- push-to-talk recording ------------------------------------------
  const startRecording = useCallback(async () => {
    if (recording || busyRef.current) return;
    if (!capabilities?.cloudStt) {
      setMicNote("Voice needs GROQ_API_KEY — type your question instead.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicNote("Microphone capture is unavailable here — type instead.");
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
        stopStream();
        setRecording(false);
        if (blob.size === 0) return;
        setBusy("transcribing");
        setAvatarStatus("listening");
        void (async () => {
          try {
            const base64 = await blobToBase64(blob);
            const transcript = (await tauriInvokeStrict("companion_transcribe", {
              request: { audioBase64: base64, mime: blobType },
            })) as string;
            setBusy("idle");
            setAvatarStatus("idle");
            if (transcript && dictateRef.current) {
              // Dictation: the words go into the app you are in, not to a model.
              try {
                const app = (await tauriInvokeStrict("act_type_text", {
                  request: { text: transcript, allowControl: readAllowControl() },
                })) as string;
                setDictationNote(`Typed into ${app}: “${transcript.slice(0, 80)}${transcript.length > 80 ? "…" : ""}”`);
                onTaskDone?.();
              } catch (raised) {
                setError(toAskError(raised));
              }
            } else if (transcript) {
              setQuestion(transcript);
              await ask(transcript);
            }
          } catch (raised) {
            setBusy("idle");
            setAvatarStatus("idle");
            setError(toAskError(raised));
          }
        })();
      };
      recorderRef.current = recorder;
      recorder.start();
      setMicNote(null);
      setRecording(true);
      setAvatarStatus("listening");
    } catch {
      stopStream();
      setMicNote("Microphone permission was declined — type your question instead.");
    }
  }, [ask, capabilities, recording]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      stopStream();
      setRecording(false);
      setAvatarStatus("idle");
    }
  }, []);

  useEffect(() => {
    if (pttActive) {
      void startRecording();
    } else if (recording) {
      stopRecording();
    }
  }, [pttActive, recording, startRecording, stopRecording]);

  // ---- render -----------------------------------------------------------
  const canSeeScreen = Boolean(capabilities?.cloudVision);
  const busyLabel =
    busy === "capturing"
      ? "Looking at your screen…"
      : busy === "thinking"
        ? "Thinking…"
        : busy === "transcribing"
          ? "Transcribing your voice…"
          : null;
  const modeControls = (
    <div
      aria-label="Companion mode"
      className="flex items-center gap-1 border-b border-border px-3 py-2"
    >
      <button
        type="button"
        aria-pressed={!researchMode}
        disabled={busy !== "idle"}
        onClick={() => setResearchMode(false)}
        className={`rounded-[var(--radius-button)] px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
          !researchMode
            ? "bg-[var(--color-navy)] text-[var(--color-background)]"
            : "text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)]"
        }`}
      >
        Ask
      </button>
      <button
        type="button"
        aria-pressed={researchMode}
        disabled={busy !== "idle"}
        onClick={() => setResearchMode(true)}
        className={`rounded-[var(--radius-button)] px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
          researchMode
            ? "bg-[var(--color-navy)] text-[var(--color-background)]"
            : "text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)]"
        }`}
      >
        Research
      </button>
      <button
        type="button"
        aria-pressed={mode === "do"}
        disabled={busy !== "idle"}
        onClick={() => setMode("do")}
        className={`rounded-[var(--radius-button)] px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
          mode === "do"
            ? "bg-[var(--color-navy)] text-[var(--color-background)]"
            : "text-[var(--color-navy-mid)] hover:bg-[var(--color-surface)]"
        }`}
      >
        Do
      </button>
    </div>
  );

  if (researchMode) {
    return (
      <div className="flex flex-col" style={{ minHeight: 0 }}>
        {modeControls}
        <ResearchRun />
      </div>
    );
  }

  if (mode === "do") {
    return (
      <div className="flex flex-col" style={{ minHeight: 0, overflowY: "auto" }}>
        {modeControls}
        <DoRun
          name={name}
          capabilities={capabilities}
          initialTask={isExplicitDo(question) ? question : ""}
          speak={speakAnswers && Boolean(capabilities?.tts)}
          onSaid={(text, emotion) => onAnswered?.(text, emotion, false)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm" style={{ minHeight: 0, overflowY: "auto" }}>
      {modeControls}
      <div className="flex flex-col gap-2 p-3">
      {/* Says plainly what this surface is, so it stops reading as a second
       * chat: a one-shot screen/voice question on its own pipeline, whose
       * memory is this session only and never reaches the chat thread. */}
      <p className="text-xs text-muted-foreground">
        Screen-and-voice mode — one question at a time. Not part of your chat;
        kept on this device only, readable from the chat history dropdown.
      </p>
      {capabilities && canSeeScreen && !capabilities.screenPermission && (
        <p className="text-xs text-muted-foreground">
          macOS Screen Recording permission is not granted yet. Bridge will refuse a
          wallpaper-only capture and open System Settings when you try.
        </p>
      )}
      {capabilities && !canSeeScreen && (
        <p className="text-xs text-muted-foreground">
          Screenshot analysis needs a Groq API key in Settings → API Keys. The local model remains
          available for text-only questions.
        </p>
      )}

      <div className="rounded-[var(--radius-button)] border border-border px-2 py-2">
        <div className="flex items-center gap-2">
          <input
            id="companion-share-screen"
            type="checkbox"
            checked={shareScreen}
            disabled={busy !== "idle"}
            aria-describedby="companion-share-screen-note"
            onChange={(event) => {
              const enabled = event.target.checked;
              setShareScreen(enabled);
              try {
                localStorage.setItem(AVATAR_SHARE_SCREEN_KEY, enabled ? "true" : "false");
              } catch (storageError) {
                console.error("[companion] could not persist screen-sharing preference", storageError);
                setError({
                  code: "COMPANION_PREFERENCE_NOT_PERSISTED",
                  message:
                    "Screen sharing changed for this panel, but Bridge could not save the choice.",
                });
              }
            }}
            className="rounded"
          />
          <label
            htmlFor="companion-share-screen"
            className="text-xs font-medium text-[var(--color-navy)]"
          >
            Share screen with questions
          </label>
        </div>
        <p
          id="companion-share-screen-note"
          className="mt-1 pl-5 text-xs text-[var(--color-navy-mid)]"
        >
          One screenshot per question is sent to Groq when enabled; turn it off for text-only asks.
        </p>
      </div>

      <textarea
        aria-label="Question for companion"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (isExplicitResearch(question)) {
              setResearchMode(true);
            } else if (isExplicitDo(question)) {
              setMode("do");
            } else {
              void ask(question);
            }
          }
        }}
        placeholder={
          recording
            ? "Listening… release Fn to ask"
            : // Deliberately NOT "Ask anything" — this is the screen-and-voice
              // mode, not the chat. Chat is the composer on the avatar itself,
              // and only that one writes to the conversation (user report
              // 2026-08-16: "3 different chat interfaces in avatar").
              "Ask about what's on your screen… (Enter to send)"
        }
        rows={2}
        disabled={busy !== "idle"}
        className="w-full rounded-[var(--radius-button)] border border-border bg-background px-2 py-1.5 text-sm"
        style={{ resize: "none" }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {recording ? "● Recording" : dictate ? "Hold Fn or ⌘⇧Space to dictate into your app" : "Hold Fn or ⌘⇧Space to talk"}
        </p>
        <label className="flex items-center gap-1 text-xs text-[var(--color-navy-mid)]">
          <input
            type="checkbox"
            checked={dictate}
            disabled={busy !== "idle"}
            onChange={(event) => {
              setDictate(event.target.checked);
              try { localStorage.setItem(AVATAR_DICTATE_KEY, event.target.checked ? "true" : "false"); } catch { /* per-device convenience */ }
            }}
            className="rounded"
          />
          Dictate into my app
        </label>
        <button
          type="button"
          disabled={busy !== "idle" || !shareScreen || !canSeeScreen}
          aria-pressed={circling}
          onClick={() => {
            if (circling) {
              setCircling(false);
              void tauriInvoke("annotate_scribble_cancel");
            } else {
              setCircling(true);
              setFocusRegion(null);
              void tauriInvoke("annotate_scribble_begin");
            }
          }}
          className="rounded-[var(--radius-button)] border border-border px-2 py-1 text-xs hover:bg-[var(--color-surface)] disabled:opacity-50"
          style={{ color: "var(--color-navy)" }}
        >
          {circling ? "Cancel circling" : focusRegion ? "Re-circle an area" : "Circle an area"}
        </button>
        <button
          type="button"
          disabled={busy !== "idle" || !question.trim()}
          onClick={() => {
            if (isExplicitResearch(question)) {
              setResearchMode(true);
            } else if (isExplicitDo(question)) {
              setMode("do");
            } else {
              void ask(question);
            }
          }}
          className="rounded-[var(--radius-button)] border border-border bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
        >
          Ask
        </button>
      </div>
      {focusRegion && (
        <p className="text-xs text-muted-foreground">
          Focusing on the area you circled ({Math.round(focusRegion.width)}×{Math.round(focusRegion.height)}) for the next question.
        </p>
      )}
      {dictationNote && <p role="status" className="text-xs text-muted-foreground">{dictationNote}</p>}
      {micNote && <p className="text-xs text-muted-foreground">{micNote}</p>}
      {historyNote && <p className="text-xs text-muted-foreground">{historyNote}</p>}
      {busyLabel && <p className="text-xs text-[var(--color-navy-mid)]">{busyLabel}</p>}

      {error && (
        <div
          ref={responseRef}
          role="alert"
          className="rounded-[var(--radius-button)] border border-border px-2 py-1.5 text-xs"
          style={{ color: "var(--color-navy)" }}
        >
          {error.message}
        </div>
      )}

      {answer && (
        <div
          ref={responseRef}
          role="status"
          aria-live="polite"
          aria-label={`${name} response`}
          className="flex flex-col gap-1.5 rounded-[var(--radius-button)] border border-border bg-[var(--color-surface)] p-2"
        >
          <p className="text-xs font-medium text-[var(--color-navy-mid)]">{name} says</p>
          <p className="whitespace-pre-wrap text-[var(--color-navy)]">{answer.text}</p>
          {answer.points > 0 && (
            <p className="text-xs text-muted-foreground">
              Pointing at {answer.points} {answer.points === 1 ? "place" : "places"} on your
              screen (marks clear automatically).
            </p>
          )}
          {answer.captureNote && (
            <p className="text-xs text-muted-foreground">{answer.captureNote}</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {answer.provider === "groq-vision"
                ? "Answered by Groq vision — screen shared with your consent"
                : answer.provider === "groq-text"
                  ? "Answered by Groq (text only — no screen view)"
                  : "Answered locally by the managed model — no screen view"}
            </p>
            {answer.spoke && (
              <button
                type="button"
                onClick={() => {
                  void tauriInvoke("companion_stop_speaking");
                  onSpeechStopped?.();
                }}
                className="whitespace-nowrap rounded-[var(--radius-button)] border border-border text-xs px-2 py-1 hover:bg-[var(--color-surface)]"
                style={{ color: "var(--color-navy)" }}
              >
                Stop speaking
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
