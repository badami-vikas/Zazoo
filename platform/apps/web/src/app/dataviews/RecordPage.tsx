/**
 * The new-Record page (TASK-083, C-34 under AP-168/ADR-258).
 *
 * WHAT CHANGED AND WHY. New used to append a blank row to the table and collect
 * the Record cell by cell. C-33 ("table-shaped records are created in the
 * table") was reversed by the user directive behind AP-168: New now opens an
 * Record page showing ALL of that Database's fields — the page as it looks
 * before any input — and nothing is written until Save.
 *
 * EVERY FIELD, INCLUDING THE ONES NOBODY TYPES. A `formula` column, a `skill`
 * column and a locked column are listed and say what fills them, rather than
 * being dropped: a page that shows a subset of the Database is a different page
 * from the one the Record gets after Save, and the point of this row is that
 * they are the same page.
 *
 * A DEFAULT IS NOT A WRITE (ADR-259/AP-169). Column defaults are pre-filled in
 * the draft, which lives in React state; leaving without Save leaves no row, no
 * partial Record and no request.
 */
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { isMetadataColumn, type ColumnSpec, type TableSpec } from "@bridge/tables";
import { Button } from "../components/ui/button.js";
import { Label } from "../components/ui/label.js";
import { RecordSections } from "../components/shared/RecordSections";
import { FieldInput, isFormEditable } from "./views/FormView.js";
import type { DataRow } from "./types.js";

/** Why this field is shown but not typed into. Null means it is editable. */
export function nonEditableReason(column: ColumnSpec): string | null {
  if (isMetadataColumn(column.kind)) {
    return "Derived from the Event log once this Record exists.";
  }
  if (column.kind === "formula") return "Computed from other fields.";
  if (column.kind === "skill") return "Filled by the Skill that runs on this Database.";
  if (column.locked) return "Locked on this Database.";
  if (column.editable === false || column.hiddenInForm) return "Filled by the Module, not by hand.";
  return null;
}

/** Defaults, applied before the page is shown. Nothing is sent anywhere. */
export function initialRecordDraft(columns: readonly ColumnSpec[]): Record<string, unknown> {
  const draft: Record<string, unknown> = {};
  for (const column of columns) {
    if (column.defaultValue !== undefined) draft[column.id] = column.defaultValue;
  }
  return draft;
}

export interface RecordPageProps {
  spec: TableSpec;
  /** The Module this Database belongs to, for its Sections. */
  moduleName: string;
  /** Absent when this surface has no governed create path — Save then states why. */
  onSave?: (draft: Partial<DataRow>) => void | Promise<void>;
  /** Why Save is impossible, when it is. */
  saveDisabledReason?: string;
  onCancel: () => void;
}

export function RecordPage({
  spec,
  moduleName,
  onSave,
  saveDisabledReason,
  onCancel,
}: RecordPageProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    initialRecordDraft(spec.columns),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = useMemo(
    () => spec.id.split(".").pop()?.replace(/[-_]/g, " ") ?? "Record",
    [spec.id],
  );

  async function save() {
    if (!onSave) return;
    const missing = spec.columns.find(
      (column) =>
        column.required &&
        isFormEditable(column) &&
        (draft[column.id] === undefined ||
          draft[column.id] === null ||
          String(draft[column.id]).trim() === ""),
    );
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This Record could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Back without saving"
          className="rounded-md p-1 hover:bg-black/5 dark:hover:bg-white/10"
        >
          <ArrowLeft className="size-4" />
        </button>
        <h2 className="text-lg font-semibold capitalize" style={{ color: "var(--color-navy)" }}>
          New {title}
        </h2>
      </div>
      <p className="mt-1 pl-7 text-xs" style={{ color: "var(--color-warm-gray)" }}>
        Nothing is written until you press Save. Leaving this page leaves no Record behind.
      </p>

      <div className="mt-4 space-y-4 rounded-xl border p-5" style={{ borderColor: "var(--color-border)" }}>
        {spec.columns.map((column) => {
          const reason = nonEditableReason(column);
          return (
            <div key={column.id} className="space-y-1.5">
              <Label htmlFor={`record-field-${column.id}`} className="text-sm font-medium">
                {column.label}
                {column.required && <span aria-hidden="true" className="text-destructive"> *</span>}
              </Label>
              <div id={`record-field-${column.id}`}>
                {reason === null ? (
                  <FieldInput
                    col={column}
                    value={draft[column.id]}
                    onChange={(next) => setDraft((current) => ({ ...current, [column.id]: next }))}
                  />
                ) : (
                  <p
                    className="rounded-lg border border-dashed px-3 py-2 text-xs"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
                  >
                    {reason}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!onSave || saving}
            title={onSave ? undefined : saveDisabledReason}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {!onSave && saveDisabledReason && (
            <span className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
              {saveDisabledReason}
            </span>
          )}
          {error && (
            <span className="text-xs text-red-600" role="alert">
              {error}
            </span>
          )}
        </div>
      </div>

      {/* The same Sections every other Record page of this Database shows. */}
      <RecordSections specId={spec.id} moduleName={moduleName} recordId={null} />
    </div>
  );
}
