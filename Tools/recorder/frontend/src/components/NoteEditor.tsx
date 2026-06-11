import { useState } from "react";
import { api, type Note } from "../lib/api";

export default function NoteEditor({
  projectId, notes, onChange,
}: { projectId: string; notes: Note[]; onChange: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.addNote(projectId, text.trim());
      setText("");
      onChange();
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    await api.deleteNote(id);
    onChange();
  };

  return (
    <>
      <div className="card">
        <h4 style={{ marginTop: 0 }}>Add context note</h4>
        <textarea
          placeholder="Add background, decisions, attendees, links…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={add} disabled={busy || !text.trim()}>
            {busy ? "Saving…" : "Add note"}
          </button>
        </div>
      </div>

      <div className="list">
        {notes.length === 0 && <div className="muted">No notes yet.</div>}
        {notes.map((n) => (
          <div className="card" key={n.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">{new Date(n.created_at).toLocaleString()}</span>
              <button className="danger" onClick={() => remove(n.id)}>Delete</button>
            </div>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{n.content}</div>
          </div>
        ))}
      </div>
    </>
  );
}
