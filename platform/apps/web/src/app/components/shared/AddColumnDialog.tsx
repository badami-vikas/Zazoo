/**
 * Adding a column, the way a person expects to add one (TASK-112).
 *
 * User report, 2026-09-07: "Adding a column, just adds column, it doesnt ask me
 * for column type, column name, I want the interface of adding new columns
 * similar to notion."
 *
 * It was true twice over. The toolbar's Add column created a column called
 * "New column" of kind `text` and asked nothing at all; the column menu's own
 * Add column left/right asked for a NAME and nothing else, so every column
 * arrived as text and had to be retyped afterwards.
 *
 * ONE dialog, both entry points. Name, type, and — for the kinds that offer a
 * choice — the choices themselves, which the server has accepted on the add op
 * since TASK-108 and nothing was passing. Nothing is created until Add column
 * is pressed, and an unnamed column is REFUSED with a stated reason rather
 * than silently named for the user: a default name is a decision, and the
 * person is right here to make it.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";

export type ColumnTypeName =
  | "text"
  | "longText"
  | "number"
  | "email"
  | "phone"
  | "person"
  | "files"
  | "status"
  | "rollup"
  | "autoNumber"
  | "button"
  | "select"
  | "multiselect"
  | "date"
  | "checkbox"
  | "url"
  | "relation"
  | "formula"
  | "skill"
  | "location";

/** Every kind the server's `COLUMN_KINDS` enum accepts, in its order. */
export const COLUMN_TYPES: ColumnTypeName[] = [
  "text",
  "longText",
  "number",
  "email",
  "phone",
  "person",
  "files",
  "status",
  "rollup",
  "autoNumber",
  "button",
  "select",
  "multiselect",
  "date",
  "checkbox",
  "url",
  "relation",
  "formula",
  "skill",
  "location",
];

/** The kinds that offer a choice — the only ones an option list means anything
 * on. The server refuses options on any other kind, so this list mirrors its
 * `CHOICE_KINDS` and the editor appears only where the server would accept it. */
export const CHOICE_KINDS: ColumnTypeName[] = ["select", "multiselect", "status"];

export interface ColumnDraft {
  label: string;
  kind: ColumnTypeName;
  /** Empty unless the kind is a choice kind. */
  options: string[];
}

/**
 * The choices a `select`/`multiselect`/`status` column offers.
 *
 * Shared with the RETYPE path in `StandardColumnMenu`: retyping a column to a
 * choice kind with no choices produced a chooser over nothing, which is the
 * same broken control adding one did (ADR-247).
 */
export function ColumnOptionsEditor({
  kind,
  options,
  onChange,
}: {
  kind: ColumnTypeName;
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  if (!CHOICE_KINDS.includes(kind)) return null;

  const add = () => {
    const value = draft.trim();
    if (!value || options.includes(value)) return;
    onChange([...options, value]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <span
            key={option}
            className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
            style={{ borderColor: "var(--color-border)" }}
          >
            {option}
            <button
              type="button"
              aria-label={`Remove option ${option}`}
              onClick={() => onChange(options.filter((entry) => entry !== option))}
              className="opacity-60 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          aria-label="Add option"
          placeholder="Add an option"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
        />
          <Button
            type="button"
            variant="outline"
            disabled={!draft.trim()}
            title={draft.trim() ? undefined : "Type the option first"}
            onClick={add}
          >
            Add
          </Button>
      </div>
    </div>
  );
}

/**
 * The dialog itself. Controlled by its caller so the toolbar and the column
 * menu open the identical thing from two different places.
 */
export function AddColumnDialog({
  open,
  title,
  initialKind = "text",
  confirmLabel = "Add column",
  onCancel,
  onSubmit,
}: {
  open: boolean;
  /** Names WHERE the column lands — "Add a column after “Status”" — because
   * that is the part the two entry points differ on. */
  title: string;
  initialKind?: ColumnTypeName;
  confirmLabel?: string;
  onCancel: () => void;
  onSubmit: (draft: ColumnDraft) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<ColumnTypeName>(initialKind);
  const [options, setOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // A fresh draft each time it opens — a name left over from the last column
  // is a name the person did not choose for this one.
  useEffect(() => {
    if (!open) return;
    setLabel("");
    setKind(initialKind);
    setOptions([]);
    setFailure(null);
  }, [open, initialKind]);

  const blocked = busy
    ? "Working…"
    : !label.trim()
      ? "Name this column first"
      : CHOICE_KINDS.includes(kind) && options.length === 0
        ? "Add at least one option, or choose a type that does not have any"
        : undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent onPointerDown={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={label}
          aria-label="Column name"
          placeholder="Column name"
          onChange={(event) => setLabel(event.target.value)}
        />
        <Select value={kind} onValueChange={(next) => setKind(next as ColumnTypeName)}>
          <SelectTrigger aria-label="Column type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COLUMN_TYPES.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {entry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ColumnOptionsEditor kind={kind} options={options} onChange={setOptions} />
        {failure && (
          <p role="alert" className="text-xs" style={{ color: "var(--color-danger)" }}>
            {failure}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={Boolean(blocked)}
            title={blocked}
            onClick={async () => {
              setBusy(true);
              setFailure(null);
              try {
                await onSubmit({ label: label.trim(), kind, options });
                onCancel();
              } catch (error) {
                // The server has the last word. Its refusal is shown here
                // rather than swallowed by a dialog that closes as if the
                // column had been created.
                setFailure(error instanceof Error ? error.message : String(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
