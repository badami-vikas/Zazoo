import { useState } from "react";
import { Input } from "../ui/input.js";

/**
 * The cell editor for a `formula` column (TASK-084).
 *
 * A formula cell holds two different things and the old editor could only reach
 * one of them: the VALUE the engine computed, and the EXPRESSION that produced
 * it. **fx** toggles between the two — the same affordance a spreadsheet uses,
 * and the reason the glyph is `fx` rather than an invented one.
 *
 * NO SECOND ENGINE. This component never parses or evaluates anything.
 * `onCommitExpression` goes to `tableSchema.setFormulaExpression`, which calls
 * Accounting's own `validateExpression` (engine.ts) BEFORE the write — so a bad
 * expression is refused by the one place in the repository that understands an
 * expression, and the refusal is shown here with the editor still open. A
 * client-side pre-check would be a second engine that could disagree with the
 * server, and the server has the last word (ADR-247).
 */
export interface FormulaCellEditorProps {
  /** The computed value, already formatted for reading. */
  value: string;
  /** The stored expression. */
  expression: string;
  /** Commits a new expression. Rejects with the validator's message. */
  onCommitExpression: (expression: string) => Promise<void>;
  /** Commits a new VALUE — a metric override. Absent where the surface cannot
   * scope one, in which case `valueDisabledReason` says why. */
  onCommitValue?: (value: string) => Promise<void>;
  valueDisabledReason?: string;
  onCancel: () => void;
}

export function FormulaCellEditor({
  value,
  expression,
  onCommitExpression,
  onCommitValue,
  valueDisabledReason,
  onCancel,
}: FormulaCellEditorProps) {
  const [showExpression, setShowExpression] = useState(false);
  const [draft, setDraft] = useState(value);
  const [expressionDraft, setExpressionDraft] = useState(expression);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const valueReason = onCommitValue
    ? undefined
    : (valueDisabledReason ??
      "Unavailable: this value is computed — override it where a client and period are in scope");

  const commit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (showExpression) await onCommitExpression(expressionDraft.trim());
      else await onCommitValue?.(draft);
      onCancel();
    } catch (failure) {
      // The editor STAYS OPEN on a refusal. Closing would drop the text the
      // person typed and leave them looking at the old value with no
      // explanation of why their edit did not take.
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <span data-stop className="inline-flex w-full flex-col gap-1">
      <span className="inline-flex w-full items-center gap-1">
        <button
          type="button"
          aria-pressed={showExpression}
          aria-label={showExpression ? "Edit the value instead" : "Edit the expression (fx)"}
          title={showExpression ? "Edit the value instead" : "Edit the expression"}
          onClick={() => {
            setError(null);
            setShowExpression((current) => !current);
          }}
          className="rounded px-1 text-xs font-semibold italic hover:bg-black/5 dark:hover:bg-white/10"
          style={{ color: showExpression ? "var(--color-navy)" : "var(--color-warm-gray)" }}
        >
          fx
        </button>
        <Input
          autoFocus
          className="h-7 w-full text-xs"
          // Type-anything: an expression is not a number even when its value is.
          value={showExpression ? expressionDraft : draft}
          disabled={!showExpression && Boolean(valueReason)}
          title={showExpression ? undefined : valueReason}
          onChange={(event) =>
            showExpression ? setExpressionDraft(event.target.value) : setDraft(event.target.value)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") void commit();
            if (event.key === "Escape") onCancel();
          }}
          onBlur={() => {
            // A blur with an unresolved error would silently discard the edit.
            if (!error && !saving) onCancel();
          }}
        />
      </span>
      {error && (
        <span role="alert" className="text-xs" style={{ color: "var(--color-danger)" }}>
          {error}
        </span>
      )}
      {!showExpression && valueReason && !error && (
        <span className="text-xs" style={{ color: "var(--color-warm-gray)" }}>
          {valueReason}
        </span>
      )}
    </span>
  );
}
