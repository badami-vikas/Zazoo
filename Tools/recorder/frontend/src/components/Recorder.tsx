import { useRef, useState } from "react";
import { api } from "../lib/api";

export default function Recorder({ projectId, onSaved }: { projectId: string; onSaved: () => void }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAt = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<number | null>(null);

  const start = async () => {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const mr = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setBusy(true);
        try {
          await api.uploadRecording(projectId, blob, "mic", `mic-${Date.now()}.webm`);
          onSaved();
        } catch (e) { setErr(String(e)); }
        finally { setBusy(false); }
      };
      mr.start();
      mediaRef.current = mr;
      startedAt.current = Date.now();
      setElapsed(0);
      timer.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 500);
      setRecording(true);
    } catch (e) {
      setErr(`Mic access failed: ${e}`);
    }
  };

  const stop = () => {
    mediaRef.current?.stop();
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setRecording(false);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>Record from mic</h4>
      {!recording ? (
        <button className="primary" onClick={start} disabled={busy}>
          {busy ? "Uploading…" : "Start recording"}
        </button>
      ) : (
        <div className="row">
          <span><span className="rec-dot" />Recording — {fmt(elapsed)}</span>
          <button onClick={stop}>Stop & save</button>
        </div>
      )}
      {err && <div className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}
    </div>
  );
}
