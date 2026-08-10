/**
 * StandardRowMenu — the per-row 3-dots actions menu, shared by BOTH table
 * renderers (ADR-192).
 *
 * WHY IT IS SPLIT THIS WAY: the items used to live inline inside `TableView`,
 * which meant the (since-removed, ADR-194) canvas renderer had no way to show
 * them without re-typing every label, `disabled` condition and AP-021
 * explanation — and a second copy is exactly how two renderers drift. The
 * split outlived the canvas: `StandardRowMenuItems` is the single item list,
 * and `StandardRowMenu` adds the table's trigger button, so any future surface
 * that needs these items gets them without copying the list.
 *
 * The permanently-disabled items keep their titles: canon requires
 * interactive-looking UI to perform OR EXPLAIN a governed action (AP-021), so
 * they must carry a reason rather than grey out silently. Remove a title when a
 * Page wires the matching governed handler.
 */
import { MoreHorizontal } from "lucide-react";
import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import type { DataRow } from "../../dataviews/types.js";

export interface StandardRowMenuProps {
  row: DataRow;
  /** Null when the row has no stable persisted id — Pin cannot target it. */
  stableRecordId: string | null;
  /** The caller's row-level permission check, already resolved. */
  canUpdate: boolean;
  onOpenRecord?: (row: DataRow) => void;
  onEditRecord?: (row: DataRow) => void;
  onDuplicate?: (row: DataRow) => void | Promise<void>;
  onPin?: (rowId: string) => void | Promise<void>;
}

export function StandardRowMenuItems({
  row,
  stableRecordId,
  canUpdate,
  onOpenRecord,
  onEditRecord,
  onDuplicate,
  onPin,
}: StandardRowMenuProps) {
  return (
    <>
      <DropdownMenuItem disabled={!onOpenRecord} onSelect={() => onOpenRecord?.(row)}>
        Open
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!onEditRecord || !canUpdate}
        onSelect={() => canUpdate && onEditRecord?.(row)}
      >
        Edit
      </DropdownMenuItem>
      {/* No Page supplies `onDuplicate`/`onPin` yet, so these are disabled
          everywhere — with a stated reason, per AP-021. */}
      <DropdownMenuItem
        disabled={!onDuplicate}
        title={onDuplicate ? undefined : "Unavailable: duplicating a Record needs a governed insert Action on this Page"}
        onSelect={() => void onDuplicate?.(row)}
      >
        Duplicate
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!onPin || !stableRecordId}
        title={
          onPin
            ? stableRecordId
              ? undefined
              : "Unavailable: this row has no stable Record id to pin"
            : "Unavailable: pinning needs a governed pin Action on this Page"
        }
        onSelect={() => stableRecordId && void onPin?.(stableRecordId)}
      >
        Pin
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled
        variant="destructive"
        title="Unavailable: deletion requires dependency preview and undo support"
      >
        Delete
      </DropdownMenuItem>
    </>
  );
}

/** Trigger + menu, for renderers that have a real DOM cell to put it in. */
export function StandardRowMenu(props: StandardRowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label="Open row actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <StandardRowMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
