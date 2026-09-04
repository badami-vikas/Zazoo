/**
 * StandardCellMenu — the cell right-click menu (§5f, user directive 2026-08-10:
 * "Right click of column, right click of cell and 3 dots also need to be
 * standardized" / "instead of flag appearing on hover, let it appear as one of
 * the options on right click. Other options include, delete row, clear cell").
 *
 * ONE definition, every Module. Right-clicking a cell and clicking the row's
 * caret open the SAME item list — the row-scoped commands come from
 * `StandardRowMenuItems`, and this adds the cell-scoped ones above them.
 *
 * WHY THE FLAG MOVED HERE. The hover-reveal glyph put a control in every cell
 * of every table that most users never wanted, and it competed with the cell's
 * own content for space. The flag is now a menu command. The FLAGGED state is
 * still always visible — that is the point of §5d, and `RedFlagControl` keeps
 * drawing the red flag whenever a flag is open. What went away is the
 * invitation, not the indicator.
 *
 * Positioned at the pointer like `StandardColumnMenu`'s panel, so the menu
 * appears where the user clicked rather than anchored to a distant trigger.
 */
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { StandardRowMenuItems, type StandardRowMenuProps } from "./StandardRowMenu.js";

export interface CellTarget {
  /** Column the pointer was over. */
  columnId: string;
  columnLabel: string;
  /** Whether this cell's value can be written by the current actor. */
  editable: boolean;
  /** Current flag state for this cell, if the surface supports flagging. */
  flagState?: "none" | "flagged" | "cleared";
}

export interface StandardCellMenuProps extends StandardRowMenuProps {
  cell: CellTarget;
  /** Screen coordinates of the right-click. */
  position: { x: number; y: number };
  onClose: () => void;
  /** Writes an empty value to this one cell through the ordinary governed
   * update path — never a direct DB write. */
  onClearCell?: () => void | Promise<void>;
  /** Opens inline edit on this cell (same effect as double-click). */
  onEditCell?: () => void;
  /** Copies the rendered cell text to the clipboard. */
  onCopyCell?: () => void | Promise<void>;
  /** Toggles the red flag on this cell (§5d). */
  onToggleFlag?: () => void | Promise<void>;
  /** Deletes the whole row. Absent until a Page wires a governed delete with
   * dependency preview + undo (§5a) — shown disabled with the reason, per AP-021. */
  onDeleteRow?: () => void | Promise<void>;
}

export function StandardCellMenu({
  cell,
  position,
  onClose,
  onClearCell,
  onEditCell,
  onCopyCell,
  onToggleFlag,
  onDeleteRow,
  ...rowProps
}: StandardCellMenuProps) {
  // Radix needs a real anchor: a zero-size element at the pointer.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!open) onClose();
  }, [open, onClose]);

  const flagLabel =
    cell.flagState === "flagged" ? "Remove red flag" : "Flag as incorrect";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          style={{
            position: "fixed",
            left: position.x,
            top: position.y,
            width: 0,
            height: 0,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {/* ── Cell-scoped ─────────────────────────────────── */}
        <DropdownMenuItem
          disabled={!onEditCell || !cell.editable}
          title={cell.editable ? undefined : `Unavailable: ${cell.columnLabel} is not editable here`}
          onSelect={() => onEditCell?.()}
        >
          Edit cell
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!onCopyCell} onSelect={() => void onCopyCell?.()}>
          Copy value
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!onClearCell || !cell.editable}
          title={cell.editable ? undefined : `Unavailable: ${cell.columnLabel} is not editable here`}
          onSelect={() => void onClearCell?.()}
        >
          Clear cell
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!onToggleFlag}
          title={onToggleFlag ? undefined : "Unavailable: this Module does not support red flags on this Database"}
          onSelect={() => void onToggleFlag?.()}
        >
          {flagLabel}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* ── Row-scoped: the SAME items the row caret shows ── */}
        <StandardRowMenuItems {...rowProps} />

        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={!onDeleteRow}
          title={
            onDeleteRow
              ? undefined
              : "Unavailable: deleting a Record needs a governed delete with dependency preview and undo (§5a)"
          }
          onSelect={() => void onDeleteRow?.()}
        >
          Delete row
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
