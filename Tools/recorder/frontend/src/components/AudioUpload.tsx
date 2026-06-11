import { useRef, useState } from "react";
import { api } from "../lib/api";

export default function AudioUpload({ projectId, onSaved }: { projectId: string; onSaved: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true); setErr("");
    try {
      await api.uploadRecording(projectId, f, "upload", f.name);
      onSaved();
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>Upload audio file</h4>
      <input ref={inputRef} type="file" accept="audio/*,video/*" onChange={onPick} disabled={busy} />
      {busy && <div className="muted" style={{ marginTop: 8 }}>Uploading…</div>}
      {err && <div className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}
    </div>
  );
}
