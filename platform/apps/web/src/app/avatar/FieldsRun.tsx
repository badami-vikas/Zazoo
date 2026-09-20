/**
 * FieldsRun — the "Fields" body of the companion panel: copy every labelled
 * control from the app in front, keep it, and later fill another form from
 * it — after the USER has reviewed the mapping and chosen how strict it is.
 *
 * Govern before executing, surfaced at the point of use:
 *  - reading uses the Accessibility tree only (no screenshot, nothing leaves
 *    the machine); passwords are never read;
 *  - nothing is filled until the mapping is shown, a policy is picked, and
 *    "Fill" is pressed; every row can be unticked;
 *  - filling uses the same mouse/keyboard switch and per-app allowlist as Do,
 *    and stops the moment the user moves the mouse.
 */
import { useEffect, useState } from "react";
import { dispatchCaptureEvent, setAvatarStatus } from "./avatar-store";
import { AVATAR_ALLOWED_APPS_KEY, AVATAR_ALLOW_CONTROL_KEY, readAllowControl } from "./DoRun";
import { tauriInvoke, tauriInvokeStrict } from "./tauri-internals";
import { fieldsIntent, planFill, tickedByPolicy, type FillPolicy, type MappingRow, type MatchField } from "./field-match";

interface FieldRecord {
  id: number;
  app: string;
  title: string;
  at: number;
  fields: MatchField[];
}

interface FillResult {
  label: string;
  status: "filled" | "already" | "skipped" | "not_found" | "stopped";
  note: string;
}

const POLICIES: { value: FillPolicy; label: string; hint: string }[] = [
  { value: "exact", label: "Exact matches only", hint: "same label, or a known synonym" },
  { value: "close", label: "Close matches too", hint: "similar labels are pre-ticked; check them" },
  { value: "each", label: "Ask me for each one", hint: "nothing is ticked until you tick it" },
];

function readAllowedApps() {
  try { return localStorage.getItem(AVATAR_ALLOWED_APPS_KEY) ?? ""; } catch { return ""; }
}

export function FieldsRun({
  name,
  accessibility,
  initialText,
  onSaid,
}: {
  name: string;
  accessibility: boolean;
  /** The phrase that opened this mode, so "copy all fields" acts at once. */
  initialText: string;
  onSaid?: (text: string, emotion?: string) => void;
}) {
  const [record, setRecord] = useState<FieldRecord | null>(null);
  const [target, setTarget] = useState<{ app: string; title: string } | null>(null);
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [ticked, setTicked] = useState<boolean[]>([]);
  const [policy, setPolicy] = useState<FillPolicy>("exact");
  const [allowControl, setAllowControl] = useState(readAllowControl);
  const [granted, setGranted] = useState(accessibility);
  const [busy, setBusy] = useState<"idle" | "copying" | "reading" | "filling">("idle");
  const [results, setResults] = useState<FillResult[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setGranted(accessibility); }, [accessibility]);

  useEffect(() => {
    void tauriInvoke("fields_recall").then((value) => {
      if (value && typeof value === "object") setRecord(value as FieldRecord);
    });
    const intent = fieldsIntent(initialText);
    if (intent === "copy") void copy();
    else if (intent === "fill") void prepare();
    // Mount-only on purpose (no react-hooks plugin in this repo's ESLint config).
  }, []);

  function fail(raised: unknown) {
    const typed = raised as { code?: unknown; message?: unknown };
    setError(String(typed?.message ?? raised));
    if (typed?.code === "FIELDS_NO_ACCESSIBILITY") setGranted(false);
  }

  async function refreshAccessibility() {
    const ok = (await tauriInvoke("ax_permission_status")) === true;
    setGranted(ok);
    if (!ok) void tauriInvoke("ax_request_permission");
  }

  async function copy() {
    setBusy("copying"); setError(null); setNote(null); setResults(null); setRows([]); setTarget(null);
    setAvatarStatus("drafting");
    try {
      const copied = (await tauriInvokeStrict("fields_copy")) as FieldRecord;
      setRecord(copied);
      // Every capture creates inspectable Memory, and the blink is the tell.
      dispatchCaptureEvent({ kind: "fields", count: copied.fields.length });
      onSaid?.(`Copied ${copied.fields.length} fields from ${copied.app}.`, "happy");
    } catch (raised) { fail(raised); } finally { setBusy("idle"); setAvatarStatus("idle"); }
  }

  async function prepare() {
    if (!record) { setNote("Nothing copied yet — open the form with the details and press Copy first."); return; }
    setBusy("reading"); setError(null); setNote(null); setResults(null);
    try {
      const live = (await tauriInvokeStrict("fields_read_target")) as { app: string; title: string; fields: MatchField[] };
      const planned = planFill(live.fields, record.fields);
      setTarget({ app: live.app, title: live.title });
      setRows(planned);
      setTicked(tickedByPolicy(planned, policy));
      if (!planned.some((r) => r.source)) setNote(`None of the ${live.fields.length} fields in ${live.app} match what I copied.`);
    } catch (raised) { fail(raised); } finally { setBusy("idle"); }
  }

  function applyPolicy(next: FillPolicy) {
    setPolicy(next);
    setTicked(tickedByPolicy(rows, next));
  }

  async function fill() {
    const entries = rows.filter((row, i) => ticked[i] && row.source).map((row) => ({ label: row.target.label, value: row.source!.value }));
    if (!entries.length) { setNote("Tick at least one field to fill."); return; }
    setBusy("filling"); setError(null); setNote(null);
    setAvatarStatus("drafting");
    try {
      const report = (await tauriInvokeStrict("fields_fill", {
        request: { entries, allowControl, allowedApps: readAllowedApps().split(",").map((a) => a.trim()).filter(Boolean) },
      })) as { app: string; results: FillResult[] };
      setResults(report.results);
      const filled = report.results.filter((r) => r.status === "filled").length;
      onSaid?.(`Filled ${filled} of ${entries.length} fields in ${report.app}. Check them before you submit.`, filled ? "happy" : "thinking");
    } catch (raised) { fail(raised); } finally { setBusy("idle"); setAvatarStatus("idle"); }
  }

  const tickedCount = ticked.filter(Boolean).length;
  const canFill = allowControl && granted && tickedCount > 0 && busy === "idle";

  return (
    <div className="flex flex-col gap-2 p-3 text-sm">
      <p className="text-xs text-muted-foreground">
        {name} reads the labelled fields of the app in front through macOS Accessibility — no screenshot, nothing leaves this Mac — and fills another form from them only after you review the mapping.
      </p>
      {!granted && (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-button)] border border-border px-2 py-2">
          <p className="text-xs text-[var(--color-navy-mid)]">macOS Accessibility permission is not granted yet.</p>
          <button type="button" onClick={() => void refreshAccessibility()} className="whitespace-nowrap rounded-[var(--radius-button)] border border-border px-2 py-1 text-xs hover:bg-[var(--color-surface)]" style={{ color: "var(--color-navy)" }}>
            Grant / re-check
          </button>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-navy)]">
          {record ? `${record.fields.length} fields from ${record.app}${record.title ? ` · ${record.title}` : ""} · ${new Date(record.at).toLocaleString()}` : "Nothing copied yet."}
        </p>
        <div className="flex gap-2">
          {record && (
            <button type="button" disabled={busy !== "idle"} onClick={() => { void tauriInvoke("fields_forget"); setRecord(null); setRows([]); setResults(null); }} className="rounded-[var(--radius-button)] border border-border px-2 py-1 text-xs hover:bg-[var(--color-surface)] disabled:opacity-50" style={{ color: "var(--color-navy)" }}>
              Forget
            </button>
          )}
          <button type="button" disabled={busy !== "idle" || !granted} onClick={() => void copy()} className="rounded-[var(--radius-button)] border border-border bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-3 py-1 hover:opacity-90 disabled:opacity-50">
            {busy === "copying" ? "Copying…" : "Copy the fields in front"}
          </button>
        </div>
      </div>
      {record && rows.length === 0 && (
        <table aria-label="Copied fields" className="w-full text-xs">
          <tbody>
            {record.fields.map((f, i) => (
              <tr key={i} className="align-top">
                <td className="pr-2 text-muted-foreground whitespace-nowrap">{f.label}</td>
                <td className="text-[var(--color-navy)] break-all">{f.value || <span className="text-muted-foreground">(empty)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {record && (
        <div className="rounded-[var(--radius-button)] border border-border px-2 py-2 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input id="fields-allow-control" type="checkbox" checked={allowControl} disabled={busy !== "idle"} onChange={(e) => { setAllowControl(e.target.checked); try { localStorage.setItem(AVATAR_ALLOW_CONTROL_KEY, e.target.checked ? "true" : "false"); } catch { /* per-device convenience */ } }} className="rounded" />
            <label htmlFor="fields-allow-control" className="text-xs font-medium text-[var(--color-navy)]">Let {name} use my mouse and keyboard to fill</label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Open the form to fill, then:</p>
            <button type="button" disabled={busy !== "idle" || !granted} onClick={() => void prepare()} className="rounded-[var(--radius-button)] border border-border px-3 py-1 text-xs hover:bg-[var(--color-surface)] disabled:opacity-50" style={{ color: "var(--color-navy)" }}>
              {busy === "reading" ? "Reading…" : rows.length ? "Re-read this form" : "Match to the form in front"}
            </button>
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <fieldset className="flex flex-col gap-1 text-xs" aria-label="Fill policy">
            <legend className="text-[var(--color-navy-mid)]">Fill in {target?.app}{target?.title ? ` · ${target.title}` : ""}:</legend>
            {POLICIES.map((p) => (
              <label key={p.value} className="flex items-center gap-2 text-[var(--color-navy)]">
                <input type="radio" name="fields-policy" checked={policy === p.value} disabled={busy !== "idle"} onChange={() => applyPolicy(p.value)} />
                {p.label} <span className="text-muted-foreground">— {p.hint}</span>
              </label>
            ))}
          </fieldset>
          <table aria-label="Field mapping" className="w-full text-xs">
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="align-top">
                  <td className="pr-1"><input type="checkbox" aria-label={`Fill ${row.target.label}`} checked={Boolean(ticked[i])} disabled={!row.source || busy !== "idle"} onChange={(e) => setTicked((prev) => prev.map((t, j) => (j === i ? e.target.checked : t)))} /></td>
                  <td className="pr-2 whitespace-nowrap text-[var(--color-navy)]">{row.target.label}</td>
                  <td className="break-all">
                    {row.source ? (
                      <>
                        <span className="text-[var(--color-navy)]">{row.source.value || "(empty)"}</span>
                        <span className="text-muted-foreground"> ← {row.source.label}{row.tier === "close" ? " · close" : ""}</span>
                      </>
                    ) : <span className="text-muted-foreground">no match</span>}
                    {row.target.kind === "popup" && row.source && <span className="text-muted-foreground"> · drop-down, choose by hand</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-end gap-2">
            <button type="button" disabled={!canFill} title={!allowControl ? "Turn on the mouse and keyboard switch first" : undefined} onClick={() => void fill()} className="rounded-[var(--radius-button)] border border-border bg-[var(--color-navy)] text-[var(--color-background)] text-xs px-3 py-1.5 hover:opacity-90 disabled:opacity-50">
              {busy === "filling" ? "Filling…" : `Fill ${tickedCount} ${tickedCount === 1 ? "field" : "fields"}`}
            </button>
          </div>
        </>
      )}
      {results && (
        <ol aria-label="Fill results" className="flex flex-col gap-1 rounded-[var(--radius-button)] border border-border bg-[var(--color-surface)] p-2 text-xs">
          {results.map((r, i) => (
            <li key={i} className="flex gap-2 text-[var(--color-navy)]">
              <span aria-label={r.status}>{r.status === "filled" ? "✓" : r.status === "already" ? "=" : "✕"}</span>
              <span className="flex-1">{r.label}{r.note ? <span className="text-muted-foreground"> — {r.note}</span> : null}</span>
            </li>
          ))}
        </ol>
      )}
      {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
      {error && <div role="alert" className="rounded-[var(--radius-button)] border border-border px-2 py-1.5 text-xs" style={{ color: "var(--color-navy)" }}>{error}</div>}
    </div>
  );
}
