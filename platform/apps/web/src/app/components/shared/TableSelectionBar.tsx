/**
 * TableSelectionBar — the multi-select action bar (C-12, TASK-086).
 *
 * SHARED CHROME, NOT A PAGE FEATURE. It lives here and is rendered once, by
 * `TableView`, so every table in the app gets the same bar with the same count,
 * the same Cancel and the same confirmation. A page that wanted its own bulk
 * bar would be the "behaviour only one page implements" divergence the
 * conformance gate exists to catch.
 *
 * IT ONLY EXISTS WHILE SOMETHING IS SELECTED. C-13 forbids a resident delete
 * control; this one is reached by long-press (touch) or the checkbox (pointer),
 * which is exactly the reveal C-13 asks for.
 *
 * THE CONFIRMATION IS A REAL DIALOG. The native browser confirm is banned
 * app-wide (C-23/C-30,
 * and `check:ui-rules` counts it), and C-13 requires the prompt to say what
 * cannot be undone rather than just asking "are you sure".
 */
import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";

export interface TableSelectionBarProps {
  count: number;
  /** Plural noun for what is selected, e.g. "Records". */
  noun?: string;
  onClear: () => void;
  /**
   * Runs the SAME governed delete a single Record uses, once per selected id.
   * Absent when the Page wires no delete path at all — the control then renders
   * disabled with the reason (AP-021), never silently missing.
   */
  onDelete?: () => void | Promise<void>;
  deleteDisabledReason?: string;
}

export function TableSelectionBar({
  count,
  noun = "Records",
  onClear,
  onDelete,
  deleteDisabledReason,
}: TableSelectionBarProps) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (count === 0) return null;

  const reason =
    deleteDisabledReason ??
    "Unavailable: this Database has no governed delete path wired yet, so Records cannot be removed here.";

  async function runDelete() {
    if (!onDelete) return;
    setRunning(true);
    setError(null);
    try {
      await onDelete();
      setConfirming(false);
      onClear();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 rounded-xl border px-3 py-2"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-line-soft)",
          color: "var(--color-navy)",
        }}
      >
        <span className="text-[13px] font-medium">
          {count} selected
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={!onDelete}
            title={onDelete ? undefined : reason}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete {count}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            <X className="size-4" aria-hidden="true" />
            Cancel
          </Button>
        </div>
        {!onDelete && <span className="sr-only">{reason}</span>}
      </div>

      <Dialog open={confirming} onOpenChange={(open) => !running && setConfirming(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {count} {noun.toLowerCase()}?
            </DialogTitle>
            <DialogDescription>
              Each one is deleted through the same governed Action a single delete uses, so
              every deletion is recorded separately and can be reviewed in Approvals. The
              Records themselves cannot be restored from here once the Action applies.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-[13px]" style={{ color: "var(--destructive)" }}>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" disabled={running} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={running} onClick={() => void runDelete()}>
              {running ? `Deleting ${count}…` : `Delete ${count}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
