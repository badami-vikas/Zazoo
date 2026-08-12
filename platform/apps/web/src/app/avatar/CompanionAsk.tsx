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
import { tauriInvoke, tauriInvokeJob, tauriInvokeStrict } from "./tauri-internals";
import { ResearchRun } from "./ResearchRun";

export const AVATAR_SHARE_SCREEN_KEY = "bridge:avatar:share_screen";
export const AVATAR_SPEAK_ANSWERS_KEY = "bridge:avatar:speak_answers";

function readShareScreen() {
  try { return localStorage.getItem(AVATAR_SHARE_SCREEN_KEY) !== "false"; } catch { return true; }
}
function readSpeakAnswers() {
  try { return localStorage.getItem(AVATAR_SPEAK_ANSWERS_KEY) !== "false"; } catch { return true; }
}

function isExplicitResearch(text: string) {
  const t = text.trim().toLowerCase();
  return t.startsWith("research ") || t.startsWith("deep research") || t.startsWith("deep dive");
}

interface CompanionCapabilities {
  cloudVision: boolean;
  visionModel: string;
  localModel: boolean;
  cloudStt: boolean;
  tts: boolean;
  screenPermission: boolean;
}

interface CompanionAnswer {
  text: string;
  provider: "groq-vision" | "groq-text" | "local-qwen";
  screenShared: boolean;
  points: number;
  spoke: boolean;
  captureNote: string | null;
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
  onAnswered,
}: {
  name: string;
  /** True while the global push-to-talk shortcut is held. */
  pttActive: boolean;
  /** Fired once per successfully delivered answer — lets the shell play a
   * transient celebration on the avatar rig. Visual-only. */
  onAnswered?: () => void;
}) {
  const [capabilities, setCapabilities] = useState<CompanionCapabilities | null>(null);
  const [question, setQuestion] = useState("");
  const [researchMode, setResearchMode] = useState(false);
  // shareScreen and speakAnswers are persisted in localStorage (Settings → Avatar);
  // the values are read once on mount and stay stable unless the user changes Settings.
  const [shareScreen] = useState(readShareScreen);
  const [speakAnswers] = useState(readSpeakAnswers);
  const [busy, setBusy] = useState<"idle" | "capturing" | "thinking" | "transcribing">("idle");
  const [answer, setAnswer] = useState<CompanionAnswer | null>(null);
  const [error, setError] = useState<AskError | null>(null);
  const [micNote, setMicNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const historyRef = useRef<HistoryTurn[]>([]);
  const lastAskAtRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);

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
        onAnswered?.();
        setAnswer(result);
        setQuestion("");
      } catch (raised) {
        setError(toAskError(raised));
      } finally {
        busyRef.current = false;
        setBusy("idle");
        setAvatarStatus("idle");
      }
    },
    [capabilities, shareScreen, speakAnswers],
  );

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
            if (transcript) {
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

  if (researchMode) {
    return (
      <div className="flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          <button
            type="button"
            onClick={() => setResearchMode(false)}
            className="text-xs text-[var(--color-navy-mid)] hover:text-[var(--color-navy)]"
          >
            ← Back
          </button>
          <span className="text-xs text-[var(--color-navy-mid)]">Deep Research</span>
        </div>
        <ResearchRun />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm" style={{ minHeight: 0, overflowY: "auto" }}>
      <div className="flex flex-col gap-2 p-3">
      {capabilities && canSeeScreen && !capabilities.screenPermission && (
        <p className="text-xs text-muted-foreground">
          macOS Screen Recording permission is not granted yet — screenshots may only show the
          wallpaper (System Settings → Privacy &amp; Security → Screen Recording).
        </p>
      )}

      <textarea
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (isExplicitResearch(question)) {
              setResearchMode(true);
            } else {
              void ask(question);
            }
          }
        }}
        placeholder={
          recording
            ? "Listening… release Fn to ask"
            : "Ask anything… (Enter to send)"
        }
        rows={2}
        disabled={busy !== "idle"}
        className="w-full rounded-[var(--radius-button)] border border-border bg-background px-2 py-1.5 text-sm"
        style={{ resize: "none" }}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {recording ? "● Recording" : "Hold Fn to talk"}
        </p>
        <button
          type="button"
          disabled={busy !== "idle" || !question.trim()}
          onClick={() => {
            if (isExplicitResearch(question)) {
              setResearchMode(true);
            } else {
              void ask(question);
            }
          }}
          className="rounded-[var(--radius-button)] border border-border bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
        >
          Ask
        </button>
      </div>
      {micNote && <p className="text-xs text-muted-foreground">{micNote}</p>}
      {busyLabel && <p className="text-xs text-[var(--color-navy-mid)]">{busyLabel}</p>}

      {error && (
        <div
          role="alert"
          className="rounded-[var(--radius-button)] border border-border px-2 py-1.5 text-xs"
          style={{ color: "var(--color-navy)" }}
        >
          {error.message}
        </div>
      )}

      {answer && (
        <div className="flex flex-col gap-1.5">
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
                onClick={() => void tauriInvoke("companion_stop_speaking")}
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
