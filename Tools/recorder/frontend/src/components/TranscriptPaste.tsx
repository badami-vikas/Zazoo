import { useState } from "react";
import { api } from "../lib/api";

export default function TranscriptPaste({ projectId, onSaved }: { projectId: string; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr("");
    try {
      await api.pasteTranscript(projectId, text.trim());
      setText("");
      onSaved();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>Paste transcript</h4>
      <textarea
        placeholder="Paste a transcript or meeting notes here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={save} disabled={busy || !text.trim()}>
          {busy ? "Saving…" : "Save transcript"}
        </button>
      </div>
      {err && <div className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}
    </div>
  );
}
