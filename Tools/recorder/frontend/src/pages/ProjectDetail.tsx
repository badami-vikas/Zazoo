import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type Recording, type Note, type Summary, type Project } from "../lib/api";
import Recorder from "../components/Recorder";
import AudioUpload from "../components/AudioUpload";
import TranscriptPaste from "../components/TranscriptPaste";
import NoteEditor from "../components/NoteEditor";
import SummaryPanel from "../components/SummaryPanel";

type Tab = "capture" | "recordings" | "notes" | "summary";

export default function ProjectDetail() {
  const { projectId = "" } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [tab, setTab] = useState<Tab>("capture");
  const [err, setErr] = useState("");
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.getProject(projectId);
      setProject(d.project);
      setRecordings(d.recordings);
      setNotes(d.notes);
      setSummaries(d.summaries);
    } catch (e) { setErr(String(e)); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Poll while any recording is still transcribing
  useEffect(() => {
    const pending = recordings.some((r) => r.status === "pending" || r.status === "transcribing");
    if (pending && !pollRef.current) {
      pollRef.current = window.setInterval(load, 2500);
    } else if (!pending && pollRef.current) {
      clearInterval(pollRef.current); pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [recordings, load]);

  const deleteRec = async (id: string) => {
    if (!confirm("Delete this recording?")) return;
    await api.deleteRecording(id);
    load();
  };

  if (!project) {
    return <div className="muted">{err || "Loading…"}</div>;
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0 }}>{project.name}</h2>
            <div className="muted">{project.description || "—"}</div>
          </div>
          <Link to="/" className="muted">← All projects</Link>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "capture" ? "active" : ""} onClick={() => setTab("capture")}>Capture</button>
        <button className={tab === "recordings" ? "active" : ""} onClick={() => setTab("recordings")}>
          Recordings ({recordings.length})
        </button>
        <button className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>
          Notes ({notes.length})
        </button>
        <button className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>Summary</button>
      </div>

      {tab === "capture" && (
        <>
          <Recorder projectId={projectId} onSaved={() => { setTab("recordings"); load(); }} />
          <AudioUpload projectId={projectId} onSaved={() => { setTab("recordings"); load(); }} />
          <TranscriptPaste projectId={projectId} onSaved={() => { setTab("recordings"); load(); }} />
        </>
      )}

      {tab === "recordings" && (
        <div className="list">
          {recordings.length === 0 && <div className="muted">No recordings yet.</div>}
          {recordings.map((r) => (
            <div className="card" key={r.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <span className="muted">{new Date(r.created_at).toLocaleString()}</span>
                  <span className="muted"> · {r.source_type}</span>
                  {r.duration_seconds != null && <span className="muted"> · {r.duration_seconds}s</span>}
                </div>
                <div className="row">
                  <span className={`status ${r.status}`}>{r.status}</span>
                  <button className="danger" onClick={() => deleteRec(r.id)}>Delete</button>
                </div>
              </div>
              {r.status === "error" && r.error_message && (
                <div style={{ color: "var(--danger)", marginTop: 8 }}>{r.error_message}</div>
              )}
              {r.transcript && <div className="transcript" style={{ marginTop: 10 }}>{r.transcript}</div>}
              {!r.transcript && r.status === "transcribing" && (
                <div className="muted" style={{ marginTop: 8 }}>Transcribing… (polling every 2.5s)</div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "notes" && <NoteEditor projectId={projectId} notes={notes} onChange={load} />}

      {tab === "summary" && <SummaryPanel projectId={projectId} projectName={project.name} summaries={summaries} onChange={load} />}
    </>
  );
}
