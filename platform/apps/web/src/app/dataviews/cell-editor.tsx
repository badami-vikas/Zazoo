/**
 * The inline cell editor, one per column KIND (TASK-109).
 *
 * WHAT CHANGED. The table's own `InlineEditor` was a text box for every kind:
 * a number came back as the string "42", a date as free text, a multiselect as
 * a comma soup, and a rollup — which nothing writes to — opened for editing
 * like any other cell. The kind now picks both the control and the type of the
 * value that is committed, so what the grid sends to `onUpdate` matches what the
 * column says it holds.
 *
 * It lives beside `cell-format.tsx` on purpose: rendering a value and editing it
 * are the two halves of one contract, and splitting them across a component and
 * a formatter is how they drifted the first time.
 *
 * NO NATIVE DROPDOWN. The rulebook (C-22) counts every one, and a native
 * dropdown cannot carry a multi-choice state anyway — the single- and
 * multi-choice editors here are the same option list, differing only in whether
 * picking closes it.
 */
import { useEffect, useRef, useState } from "react";
import { isMetadataColumn, type ColumnSpec } from "@bridge/tables";

/**
 * Can this column's cells be edited at all?
 *
 * ONE predicate, because the alternative is what shipped before: each surface
 * deciding for itself, and a rollup opening an editor on the table while the
 * Record page correctly refused. `rollup` is derived from a relation, `button`
 * stores nothing, `autoNumber` is assigned once and never reused, and the four
 * metadata kinds come from the Event log. A `formula` cell holds a computed
 * value; it is editable only through its EXPRESSION field, which the table's
 * `FormulaCellEditor` owns.
 */
export function isCellEditable(col: ColumnSpec): boolean {
  if (col.editable === false || col.locked) return false;
  if (isMetadataColumn(col.kind)) return false;
  switch (col.kind) {
    case "rollup":
    case "button":
    case "autoNumber":
      return false;
    case "formula":
      return Boolean(col.expressionField);
    default:
      return true;
  }
}

/** Why a cell cannot be edited — the honest text a disabled control carries. */
export function uneditableReason(col: ColumnSpec): string {
  if (col.locked) return "This column is locked, so its cells do not accept edits";
  if (col.editable === false) return "This column is read-only on this Database";
  if (isMetadataColumn(col.kind)) {
    return "This value comes from the Event log, so there is nothing here to type into";
  }
  switch (col.kind) {
    case "rollup":
      return "A rollup is calculated from a relation — edit the values it reads, not the result";
    case "button":
      return "A button column stores no value; it runs an Action";
    case "autoNumber":
      return "An auto-number is assigned once and never reused";
    case "formula":
      return "This formula column carries no expression field, so there is nothing to edit";
    default:
      return "This cell cannot be edited here";
  }
}

/**
 * The typed value a kind commits.
 *
 * A number column that stores the STRING "42" sorts as text, sums as nothing
 * and filters with the wrong operators — the bug this function exists to end.
 * An unparseable number commits `null` rather than `NaN`: "unknown" is
 * first-class (ADR-247), `NaN` is a fabricated number.
 */
export function coerceCellValue(col: ColumnSpec, raw: unknown): unknown {
  if (raw === "" || raw === null || raw === undefined) return null;
  switch (col.kind) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case "checkbox":
      return Boolean(raw);
    case "multiselect":
      return Array.isArray(raw) ? raw : [String(raw)];
    default:
      return raw;
  }
}

/** `<input type="date">` speaks yyyy-mm-dd and nothing else. */
function dateInputValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const at = new Date(String(value));
  return Number.isNaN(at.getTime()) ? "" : at.toISOString().slice(0, 10);
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === null || value === undefined || value === "") return [];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const FIELD =
  "w-full rounded-md border px-2 py-1 text-[13px] outline-none";

const fieldStyle = {
  borderColor: "var(--color-steel)",
  background: "var(--color-background)",
  color: "var(--color-navy)",
};

/** The option list, shared by the single- and multi-choice editors. */
function OptionList({
  options,
  chosen,
  multiple,
  onPick,
}: {
  options: string[];
  chosen: string[];
  multiple: boolean;
  onPick: (option: string) => void;
}) {
  return (
    <div
      role={multiple ? "group" : "listbox"}
      className="absolute z-50 mt-1 max-h-56 min-w-[160px] overflow-auto rounded-xl border py-1 shadow-xl"
      style={{ borderColor: "var(--color-border)", background: "var(--popover)" }}
    >
      {options.length === 0 && (
        <p className="px-3 py-1.5 text-[12px]" style={{ color: "var(--color-warm-gray)" }}>
          This column declares no options yet
        </p>
      )}
      {options.map((option) => {
        const picked = chosen.includes(option);
        return (
          <button
            key={option}
            type="button"
            role={multiple ? "checkbox" : "option"}
            aria-checked={multiple ? picked : undefined}
            aria-selected={multiple ? undefined : picked}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(option)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: "var(--popover-foreground)" }}
          >
            <span aria-hidden="true" style={{ width: 12 }}>
              {picked ? "✓" : ""}
            </span>
            {option}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The editor for one cell. Commits a value of the column's own type through
 * `onCommit` — the caller routes that to the governed update path, exactly as
 * the previous text-only editor did.
 */
export function CellEditor({
  col,
  value,
  align,
  onCommit,
  onCancel,
}: {
  col: ColumnSpec;
  value: unknown;
  align: "left" | "right";
  onCommit: (next: unknown) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(() =>
    value === null || value === undefined ? "" : String(value),
  );
  const [picked, setPicked] = useState<string[]>(() => toArray(value));
  /** Blur with nothing typed is a cancel, not an edit — otherwise clicking
   *  through a row would write every cell it passed. */
  const initial = useRef(value === null || value === undefined ? "" : String(value));

  useEffect(() => {
    inputRef.current?.focus();
    // `select()` throws on a date input, and there is no text to select there.
    if (col.kind !== "date") inputRef.current?.select();
    areaRef.current?.focus();
  }, [col.kind]);

  const options = col.options ?? [];

  // The cell menu's "Edit cell" can land here for a checkbox even though the
  // grid toggles it in place — so there is a control here too, rather than a
  // text box asking someone to type "true".
  if (col.kind === "checkbox") {
    return (
      <input
        type="checkbox"
        autoFocus
        aria-label={col.label}
        checked={Boolean(value)}
        onChange={(event) => onCommit(event.target.checked)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className="size-4 accent-current align-middle"
      />
    );
  }

  if (col.kind === "multiselect") {
    return (
      <span className="relative inline-block">
        <button
          type="button"
          className={`${FIELD} text-left`}
          style={fieldStyle}
          onClick={() => onCommit(coerceCellValue(col, picked))}
        >
          {picked.length > 0 ? picked.join(", ") : "Choose"}
        </button>
        <OptionList
          options={options}
          chosen={picked}
          multiple
          onPick={(option) =>
            setPicked((current) =>
              current.includes(option)
                ? current.filter((entry) => entry !== option)
                : [...current, option],
            )
          }
        />
      </span>
    );
  }

  if (col.kind === "select" || col.kind === "status" || options.length > 0) {
    return (
      <span className="relative inline-block">
        <span className={FIELD} style={fieldStyle}>
          {draft || "Choose"}
        </span>
        <OptionList
          options={options}
          chosen={draft ? [draft] : []}
          multiple={false}
          onPick={(option) => onCommit(option)}
        />
      </span>
    );
  }

  if (col.kind === "longText") {
    return (
      <textarea
        ref={areaRef}
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => (draft === initial.current ? onCancel() : onCommit(draft))}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className={FIELD}
        style={fieldStyle}
      />
    );
  }

  const type = col.kind === "date" ? "date" : col.kind === "number" ? "number" : "text";
  const shown = col.kind === "date" ? dateInputValue(draft) : draft;

  return (
    <input
      ref={inputRef}
      type={type}
      value={shown}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() =>
        draft === initial.current ? onCancel() : onCommit(coerceCellValue(col, draft))
      }
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(coerceCellValue(col, draft));
        if (event.key === "Escape") onCancel();
      }}
      className={`${FIELD} min-w-[80px] ${align === "right" ? "text-right" : ""}`}
      style={fieldStyle}
    />
  );
}
