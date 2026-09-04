/**
 * The Sections an Record page shows below its fields (TASK-083, ADR-261).
 *
 * ONE COMPONENT, so every Record page of a Database agrees about what it
 * shows. The set is chosen per DATABASE from the toolbar's ⋮ → Records, and
 * this reads that choice rather than taking a per-page prop — a page that could
 * decide for itself is how two Records of one Database end up different.
 *
 * A new Record has no id yet. Notes still renders, and says plainly that a
 * note attaches once the Record is saved, rather than offering a box whose
 * contents would go nowhere (AP-021).
 */
import { useCallback, useEffect, useState } from "react";
import { NotebookPen } from "lucide-react";
import { ModuleIntelligenceSection } from "./ModuleIntelligenceSection";
import { ModuleGovernanceSection } from "./ModuleGovernanceSection";
import { useRecordSections } from "../../dataviews/useRecordSections";
import { PILOT_ORGANIZATION, trpc } from "../../lib/trpc";

export function RecordNotesSection({
  specId,
  recordId,
}: {
  specId: string;
  recordId: string | null;
}) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    void (async () => {
      try {
        const note = (await trpc.records.note.query({
          organizationId: PILOT_ORGANIZATION,
          specId,
          recordId,
        })) as { text: string };
        if (cancelled) return;
        setText(note.text);
        setSaved(note.text);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [specId, recordId]);

  const save = useCallback(async () => {
    if (!recordId) return;
    setBusy(true);
    try {
      const note = (await trpc.records.saveNote.mutate({
        organizationId: PILOT_ORGANIZATION,
        specId,
        recordId,
        text,
      })) as { text: string };
      setSaved(note.text);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [specId, recordId, text]);

  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
      <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--color-navy)" }}>
        <NotebookPen className="size-4" /> Notes
      </h3>
      {recordId === null ? (
        <p className="mt-2 text-xs" style={{ color: "var(--color-warm-gray)" }}>
          A note attaches to this Record once it is saved — nothing is written before then.
        </p>
      ) : (
        <>
          <textarea
            aria-label="Record note"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            className="mt-2 w-full rounded-lg border p-2 text-sm"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || text === saved}
              className="rounded-md border px-2.5 py-1 text-[12.5px] font-medium disabled:opacity-60"
              style={{ borderColor: "var(--color-border)", color: "var(--color-navy)" }}
            >
              {busy ? "Saving…" : "Save note"}
            </button>
            {error && (
              <span className="text-xs text-red-600" role="alert">
                {error}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * @param specId  the Database whose Section choice applies.
 * @param moduleName  the Module whose Intelligence/Governance this Record sits in.
 * @param recordId  null while the Record is being created.
 */
export function RecordSections({
  specId,
  moduleName,
  recordId,
}: {
  specId: string;
  moduleName: string;
  recordId: string | null;
}) {
  const { sections } = useRecordSections(specId);
  if (!sections.notes && !sections.intelligence && !sections.governance) return null;
  return (
    <div className="mt-4 space-y-4">
      {sections.notes && <RecordNotesSection specId={specId} recordId={recordId} />}
      {sections.intelligence && <ModuleIntelligenceSection moduleName={moduleName} />}
      {sections.governance && <ModuleGovernanceSection moduleName={moduleName} />}
    </div>
  );
}
