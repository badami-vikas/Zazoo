/**
 * FormView — first-class standard view that collects a new row via one input per
 * spec column and calls `onInsert(draft)` on submit. The caller routes the draft
 * through the governed pipeline (action.propose → Learning Agent enrichment →
 * approve/auto), so the write process is identical to every other DB write.
 *
 * Design references:
 *  - docs/wiki/ui-architecture.md "Form view — one input/field, collects new row,
 *    direct insert + Learning Agent applies same standard process other DB writes get"
 *  - OSS precedent (code diligence 2026-07-13): Baserow/NocoDB treat Form as a
 *    first-class view type with submission = ordinary row insert; view-type is
 *    registered, not a separate widget.
 *
 * Field mapping:
 *  - text / url          → <Input type="text|url">
 *  - number              → <Input type="number">
 *  - date                → <Input type="date">
 *  - select              → <Select> single choice from col.options
 *  - multiselect         → checkbox list from col.options (comma-joined on submit)
 *  - checkbox            → <Checkbox>
 *  - location            → <Input type="text"> (label or local coordinates)
 *  - relation / formula / skill → read-only note; computed/relational fields are
 *    excluded from user input — the backend fills them (same as every other write path)
 *
 * Locked or non-editable columns are skipped; formula/skill columns are skipped
 * because their values are computed server-side.
 */
import { useEffect, useMemo, useState } from "react";
import { formatLocationInput, type ColumnSpec } from "@bridge/tables";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import type { DataViewProps, DataRow } from "../types.js";

const EXCLUDED_KINDS = new Set<ColumnSpec["kind"]>(["formula", "skill"]);

function isFormEditable(col: ColumnSpec): boolean {
  if (col.locked) return false;
  if (col.editable === false) return false;
  if (col.hiddenInForm) return false;
  if (EXCLUDED_KINDS.has(col.kind)) return false;
  return true;
}

function FieldInput({
  col,
  value,
  onChange,
}: {
  col: ColumnSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const strVal =
    col.kind === "location"
      ? formatLocationInput(value)
      : value == null
        ? ""
        : String(value);

  if (col.kind === "select" && col.options && col.options.length > 0) {
    return (
      <Select value={strVal} onValueChange={(v) => onChange(v)}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder={`Select ${col.label}…`} />
        </SelectTrigger>
        <SelectContent>
          {col.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (col.kind === "multiselect" && col.options && col.options.length > 0) {
    const selected = new Set(
      Array.isArray(value)
        ? value.map(String)
        : strVal
          ? strVal.split(",").map((item) => item.trim())
          : [],
    );
    return (
      <div className="flex flex-wrap gap-3">
        {col.options.map((opt) => (
          <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
            <Checkbox
              checked={selected.has(opt)}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(opt);
                else next.delete(opt);
                onChange([...next]);
              }}
            />
            {opt}
          </label>
        ))}
      </div>
    );
  }

  if (col.kind === "checkbox") {
    return (
      <Checkbox
        checked={value === true || value === "true"}
        onCheckedChange={(checked) => onChange(Boolean(checked))}
        className="mt-1"
      />
    );
  }

  if (col.kind === "number") {
    return (
      <Input
        type="number"
        value={strVal}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="h-8 text-sm"
        placeholder={col.label}
      />
    );
  }

  if (col.kind === "date") {
    return (
      <Input
        type="date"
        value={strVal}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-8 text-sm"
      />
    );
  }

  if (col.kind === "url") {
    return (
      <Input
        type="url"
        value={strVal}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-8 text-sm"
        placeholder={`https://…`}
      />
    );
  }

  if (col.kind === "relation") {
    return (
      <Input
        type="text"
        value={strVal}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="h-8 text-sm"
        placeholder={`${col.relationTarget ?? "Record"} ID`}
      />
    );
  }

  return (
    <Input
      type="text"
      value={strVal}
      onChange={(e) => onChange(e.target.value || undefined)}
      className="h-8 text-sm"
      placeholder={
        col.kind === "location"
          ? "Place label or Label | latitude, longitude"
          : col.label
      }
    />
  );
}

function initialDraft(
  columns: ColumnSpec[],
  defaults: Record<string, unknown> | undefined,
  record: DataRow | null | undefined,
): Partial<DataRow> {
  const values: Partial<DataRow> = {};
  for (const column of columns) {
    const value = record?.[column.id] ?? defaults?.[column.id] ?? column.defaultValue;
    if (value !== undefined) values[column.id] = value;
  }
  return values;
}

export function FormView({ spec, view, onInsert, onUpdate, formRecord }: DataViewProps) {
  const editableColumns = useMemo(
    () => spec.columns.filter(isFormEditable),
    [spec.columns],
  );
  const resetDraft = useMemo(
    () => initialDraft(editableColumns, view.formDefaults, formRecord),
    [editableColumns, formRecord, view.formDefaults],
  );
  const [draft, setDraft] = useState<Partial<DataRow>>(resetDraft);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDraft(resetDraft);
    setSubmitError(null);
    setSubmitSuccess(null);
  }, [resetDraft]);

  if (editableColumns.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground border rounded-md">
        No editable fields in this spec — all columns are locked, computed, or relational.
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const rowId =
      typeof formRecord?.["id"] === "string" || typeof formRecord?.["id"] === "number"
        ? String(formRecord["id"])
        : null;
    if (rowId ? !onUpdate : !onInsert) return;
    const missing = editableColumns.find((column) => {
      const value = draft[column.id];
      return (
        column.required &&
        (value === undefined ||
          value === null ||
          value === "" ||
          (Array.isArray(value) && value.length === 0))
      );
    });
    if (missing) {
      setSubmitError(`${missing.label} is required.`);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      if (rowId) await onUpdate?.(rowId, draft);
      else await onInsert?.(draft);
      setSubmitSuccess(rowId ? "Changes saved." : "Row added.");
      if (!rowId) setDraft(resetDraft);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The row could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg border rounded-md p-5">
      {editableColumns.map((col) => (
        <div key={col.id} className="space-y-1.5">
          <Label htmlFor={`form-field-${col.id}`} className="text-sm font-medium">
            {col.label}
            {col.required && <span aria-hidden="true" className="text-destructive"> *</span>}
          </Label>
          <div id={`form-field-${col.id}`}>
            <FieldInput
              col={col}
              value={draft[col.id]}
              onChange={(v) => setDraft((prev) => ({ ...prev, [col.id]: v }))}
            />
          </div>
        </div>
      ))}

      <Button
        type="submit"
        size="sm"
        disabled={submitting || (formRecord ? !onUpdate : !onInsert)}
      >
        {submitting ? "Saving…" : formRecord ? "Save changes" : "Add row"}
      </Button>

      {!formRecord && !onInsert && (
        <p className="text-xs text-muted-foreground">
          This Database is read-only because no insert handler is connected.
        </p>
      )}
      {submitError && (
        <p className="text-xs text-red-600" role="alert">
          {submitError}
        </p>
      )}
      {submitSuccess && (
        <p className="text-xs text-emerald-700" role="status">
          {submitSuccess}
        </p>
      )}
    </form>
  );
}
