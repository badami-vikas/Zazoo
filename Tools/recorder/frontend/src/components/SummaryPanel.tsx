import { useState } from "react";
import { api, type Summary } from "../lib/api";
import { addToBridge, buildConversationEnvelope } from "../lib/bridge";

export default function SummaryPanel({
  projectId, projectName, summaries, onChange,
}: { projectId: string; projectName?: string; summaries: Summary[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bridgeMsg, setBridgeMsg] = useState("");

  const generate = async () => {
    setBusy(true); setErr("");
    try {
      await api.generateSummary(projectId, "project");
      onChange();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  };

  const latest = summaries[0];

  const sendToBridge = async () => {
    if (!latest) return;
    setBridgeMsg("Sending…");
    const env = buildConversationEnvelope({
      projectName: projectName || "Conversation",
      summary: latest.summary,
      nextSteps: latest.next_steps,
      provider: latest.llm_provider, model: latest.llm_model,
    });
    const res = await addToBridge(env);
    setBridgeMsg(res.ok
      ? (res.sink === "outbox" ? "Added to Bridge — pending review under Tools" : `Sent to Bridge (${res.sink}) — pending review`)
      : `Add to Bridge failed: ${res.error ?? res.sink}`);
    setTimeout(() => setBridgeMsg(""), 4000);
  };

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h4 style={{ margin: 0 }}>Generate summary + next steps</h4>
          <button className="primary" onClick={generate} disabled={busy}>
            {busy ? "Thinking…" : "Generate"}
          </button>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          Pulls in all project transcripts and notes, then asks the configured LLM for a summary and concrete next steps.
        </div>
        {err && <div className="muted" style={{ color: "var(--danger)", marginTop: 8 }}>{err}</div>}
      </div>

      {latest && (
        <div className="card">
          <div className="muted">
            Generated {new Date(latest.created_at).toLocaleString()} · {latest.llm_provider} / {latest.llm_model}
          </div>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ marginBottom: 0 }}>Summary</h4>
            <button onClick={sendToBridge} title="Send a private Memory + Touchpoints proposal to Bridge (review before it commits)">
              Add to Bridge
            </button>
          </div>
          {bridgeMsg && <div className="muted" style={{ marginTop: 6 }}>{bridgeMsg}</div>}
          <div className="transcript">{latest.summary}</div>
          <h4>Next steps</h4>
          {latest.next_steps.length === 0 ? (
            <div className="muted">No next steps suggested.</div>
          ) : (
            <ul className="next-steps">
              {latest.next_steps.map((s, i) => (
                <li key={i}>
                  <input type="checkbox" style={{ width: "auto", marginRight: 8 }} />
                  {s.text}
                  {s.owner && <span className="muted"> — {s.owner}</span>}
                  {s.due && <span className="muted"> · due {s.due}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {summaries.length > 1 && (
        <details className="card">
          <summary className="muted" style={{ cursor: "pointer" }}>Earlier summaries ({summaries.length - 1})</summary>
          {summaries.slice(1).map((s) => (
            <div key={s.id} style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div className="muted">{new Date(s.created_at).toLocaleString()}</div>
              <div className="transcript">{s.summary}</div>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
