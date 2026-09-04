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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Share2, X } from "lucide-react";
import { formatLocationInput, isMetadataColumn, type ColumnSpec } from "@bridge/tables";
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

export function isFormEditable(col: ColumnSpec): boolean {
  // TASK-063: derived from the Event log, so there is nothing to write to.
  if (isMetadataColumn(col.kind)) return false;
  if (col.locked) return false;
  if (col.editable === false) return false;
  if (col.hiddenInForm) return false;
  if (EXCLUDED_KINDS.has(col.kind)) return false;
  return true;
}

export function FieldInput({
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
      type={col.sensitive ? "password" : "text"}
      autoComplete={col.sensitive ? "new-password" : undefined}
      value={strVal}
      onChange={(e) => onChange(e.target.value || undefined)}
      className="h-8 text-sm"
      placeholder={
        col.kind === "location"
          ? "Place label or Label | latitude, longitude"
          : col.sensitive
            ? `${col.label} (stored in secure vault)`
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
  const [shareOpen, setShareOpen] = useState(false);
  const [shareFormOnly, setShareFormOnly] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDraft(resetDraft);
    setSubmitError(null);
    setSubmitSuccess(null);
  }, [resetDraft]);

  /**
   * CLICK-OUTSIDE AUTOSAVE (§5, TASK-061) — for an EXISTING Record only.
   *
   * A new Record writes nothing until Save (C-34/ADR-259): autosaving one would
   * post a half-typed Record through the pipeline the moment the user's
   * attention moved. Editing a Record that already exists is the opposite case
   * — the row is there, the edit is the change, and losing it to a stray click
   * is the defect. So the rule is scoped by whether there is a row to update.
   */
  const formRef = useRef<HTMLDivElement>(null);
  const editingExisting =
    typeof formRecord?.["id"] === "string" || typeof formRecord?.["id"] === "number";
  const autosave = useCallback(async () => {
    if (!editingExisting || !onUpdate) return;
    const rowId = String(formRecord!["id"]);
    const changed = Object.keys(draft).some(
      (key) => draft[key] !== (resetDraft as Record<string, unknown>)[key],
    );
    if (!changed) return;
    try {
      await onUpdate(rowId, draft);
      setSubmitSuccess("Changes saved.");
      setSubmitError(null);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The row could not be saved.");
    }
  }, [draft, editingExisting, formRecord, onUpdate, resetDraft]);

  useEffect(() => {
    if (!editingExisting) return;
    const onPointerDown = (event: MouseEvent) => {
      const root = formRef.current;
      if (!root || root.contains(event.target as Node)) return;
      void autosave();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [autosave, editingExisting]);

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
      setSubmitSuccess(rowId ? "Changes saved." : "Record added.");
      if (!rowId) setDraft(resetDraft);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The row could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  const formTitle = `${spec.id.split(".").pop()?.replace(/[-_]/g, " ") ?? "Record"} intake form`;

  return (
    <div className="flex h-full min-h-0 gap-4">
      <div ref={formRef} className="min-w-0 flex-1 overflow-auto">
        {/* §5: ONE form. The Build/Preview split was a second surface for the
            same fields — Build only listed what the spec already renders, so it
            could disagree with nothing and cost a click to leave (TASK-061). */}
        <div className="mb-4 flex items-center gap-3">
          <span className="text-[12.5px] capitalize" style={{ color: "var(--color-warm-gray)" }}>
            {formTitle}
          </span>
          <button
            type="button"
            onClick={() => setShareOpen((open) => !open)}
            aria-expanded={shareOpen}
            className="ml-auto flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium"
            style={{ borderColor: "var(--color-border)", color: "var(--color-navy-mid)" }}
          >
            <Share2 className="size-3.5" /> Share
          </button>
        </div>

    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg border rounded-md p-5">
      <div className="border-b pb-3" style={{ borderColor: "var(--color-border)" }}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--color-warm-gray)" }}>
          Intake
        </div>
        <h3 className="mt-1 text-lg font-semibold capitalize" style={{ color: "var(--color-navy)" }}>
          {formTitle}
        </h3>
        <p className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
          Fields marked <span className="text-destructive">*</span> are required.
        </p>
      </div>
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
        {submitting ? "Saving…" : formRecord ? "Save changes" : "Add record"}
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
      </div>

      {shareOpen && (
        <aside
          aria-label="Share form"
          className="w-80 shrink-0 overflow-auto rounded-xl border p-4"
          style={{ borderColor: "var(--color-border)", background: "var(--popover)" }}
        >
          <div className="flex items-center gap-2">
            <Share2 className="size-4" />
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>Share</h3>
            <button
              type="button"
              onClick={() => setShareOpen(false)}
              aria-label="Close share panel"
              className="ml-auto rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="size-4" />
            </button>
          </div>

          <label className="mt-4 flex items-start gap-3 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
            <Checkbox
              checked={shareFormOnly}
              onCheckedChange={(checked) => setShareFormOnly(checked === true)}
            />
            <span>
              <span className="block text-[13px] font-medium" style={{ color: "var(--color-navy)" }}>
                Share form only
              </span>
              <span className="block text-xs" style={{ color: "var(--color-warm-gray)" }}>
                Share the intake form — no Record data exposed.
              </span>
            </span>
          </label>

          {/* The form-specific options appear only once "Share form only" is on,
              which is the whole point of the checkbox: sharing a View and
              sharing a blank intake form have different consequences, and the
              second set of choices is meaningless for the first. */}
          {shareFormOnly && (
            <div className="mt-4 space-y-4">
              <section>
                <h4 className="text-[10px] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--color-warm-gray)" }}>
                  Form link
                </h4>
                {/* No link is shown, because none exists yet. Bridge has one
                    sharing primitive today (helpdeskTickets.accessToken) and it
                    is not wired to Views. Rendering a plausible-looking URL here
                    would be a fabricated capability — AP-021 requires this to
                    explain instead. */}
                {/* The share primitive EXISTS now (TASK-064, `view.share.*`) —
                    what it points at is a SAVED View, and a Form view rendered
                    from a spec is not one. So the honest answer changed: not
                    "no capability", but "nothing saved to point at yet". */}
                <p className="mt-1 rounded-lg border border-dashed px-3 py-2 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
                  Save this View as a List first — a share points at a saved View. The List
                  dropdown's Share panel then issues and revokes the link.
                </p>
              </section>

              <fieldset disabled>
                <legend className="text-[10px] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--color-warm-gray)" }}>
                  Access
                </legend>
                <div className="mt-1 space-y-1 opacity-45">
                  {[
                    ["Private", "Only you"],
                    ["Team", "Anyone in this Organization"],
                    ["Anyone with link", "External respondents"],
                  ].map(([label, hint]) => (
                    <div
                      key={label}
                      title="Access levels are chosen when the link is issued, in the List dropdown's Share panel"
                      className="rounded-lg border px-3 py-2"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <div className="text-[13px]" style={{ color: "var(--color-navy)" }}>{label}</div>
                      <div className="text-xs" style={{ color: "var(--color-warm-gray)" }}>{hint}</div>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset disabled>
                <legend className="text-[10px] font-semibold uppercase tracking-[0.07em]" style={{ color: "var(--color-warm-gray)" }}>
                  On submission
                </legend>
                <div className="mt-1 space-y-2 opacity-45">
                  {[
                    ["Notify Record owner", "Send an Event when the form is submitted"],
                    ["Confirmation to respondent", "Acknowledge receipt automatically"],
                    ["Auto-create Record", "Add to the Database immediately on submit"],
                  ].map(([label, hint]) => (
                    <div
                      key={label}
                      title="Unavailable: on-submission behaviour needs an Automation bound to the shared form"
                      className="flex items-start justify-between gap-3"
                    >
                      <span>
                        <span className="block text-[13px]" style={{ color: "var(--color-navy)" }}>{label}</span>
                        <span className="block text-xs" style={{ color: "var(--color-warm-gray)" }}>{hint}</span>
                      </span>
                      <Checkbox checked={false} />
                    </div>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
