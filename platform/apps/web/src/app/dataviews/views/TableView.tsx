/**
 * TableView — the entry point for the `table` view kind, and the DOM renderer
 * itself: a real <table> driven by TableSpec's columns + ViewConfig's
 * sorts/rowFilters via engine.ts (applyFilters/applySorts), never a hardcoded
 * column list. Registered under kind "table" in registry.ts.
 *
 * TWO RENDERERS, ONE KIND (ADR-160). Past `GLIDE_ROW_THRESHOLD` rows this
 * delegates to the canvas `GlideTableView`, because the DOM path below renders
 * EVERY sorted row — no virtualization — and stalls on the large directories
 * the product is meant to carry. Both renderers read the same TableSpec, the
 * same ViewConfig, the same engine filters/sorts, and the same cell semantics
 * from `../cell-format.js`, so switching is a performance decision, never a
 * change in what the data means. The DOM path stays the default because it is
 * the one that can carry the governed red-flag control and full a11y.
 *
 * Mobile-width-safe: the shadcn Table component already wraps itself in a
 * `overflow-x-auto` container (components/ui/table.tsx), so at 375px the table
 * scrolls horizontally INSIDE its own box rather than blowing out the page.
 */
import { applyFilters, applySorts } from "@bridge/tables";
import { MoreHorizontal, Plus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table.js";
import { Button } from "../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { StandardColumnMenu } from "../../components/shared/StandardColumnMenu.js";
import { RedFlagControl } from "../../components/shared/RedFlagControl.js";
import { RedFlagProvider } from "../../components/shared/RedFlagProvider.js";
import { isFlaggableValue, isSupportedRedFlagModule, moduleIdFromDatabaseId } from "../eligibility.js";
import type { DataViewProps } from "../types.js";
import { formatCell, renderCell } from "../cell-format.js";
import { GlideTableView } from "./GlideTableView.js";

/**
 * Above this many rows the DOM renderer's cost (every row mounted, no
 * virtualization) outweighs the governed affordances it alone can paint, and
 * the canvas renderer takes over. Chosen as the point where a full re-render
 * on a keystroke in the DataViews search box becomes perceptible.
 */
export const GLIDE_ROW_THRESHOLD = 400;

export function TableView(props: DataViewProps) {
  const { spec, view, data } = props;
  // Count what will actually be painted, not the unfiltered input: a 50k-row
  // dataset filtered down to 20 rows should still get the richer DOM path.
  const visibleCount = applyFilters(data, view.rowFilters, view.filterMatch).length;
  if (visibleCount > GLIDE_ROW_THRESHOLD) return <GlideTableView {...props} />;
  return <DomTableView {...props} />;
}

function DomTableView({
  spec,
  view,
  data,
  onViewChange,
  onInsert,
  onOpenRecord,
  onEditRecord,
  canUpdateRow,
  onDuplicate,
  onPin,
  onRequestFilter,
  onHideColumn,
}: DataViewProps) {
  const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
  const sorted = applySorts(filtered, view.sorts);
  const moduleId = moduleIdFromDatabaseId(spec.id);
  // review round-5 item 6: a Module the server can't validate targets for
  // (e.g. "signal" — no backing existence-check store yet) must never even
  // render an interactive-looking flag glyph, since redFlag.create would
  // fail-closed on EVERY attempt — an "interactive-looking" control that
  // always errors is not a working governed Action (AP-021).
  const flaggable = isSupportedRedFlagModule(moduleId);

  const table = (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            {spec.columns.map((col) => {
              const activeSort = view.sorts.find((sort) => sort.id === col.id);
              return (
                <TableHead
                  key={col.id}
                  aria-sort={
                    activeSort
                      ? activeSort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <div className="flex items-center gap-1">
                    <StandardColumnMenu
                      label={col.label}
                      databaseBacked
                      onFilter={() => onRequestFilter?.(col.id)}
                      onSort={(direction) =>
                        onViewChange({
                          ...view,
                          sorts: [{ id: col.id, dir: direction }],
                        })
                      }
                      onHide={
                        onHideColumn ? () => onHideColumn(col.id) : undefined
                      }
                    />
                    {activeSort && (
                      <>
                        <span aria-hidden="true" className="text-xs">
                          {activeSort.dir === "asc" ? "↑" : "↓"}
                        </span>
                        <span className="sr-only">
                          Sorted {activeSort.dir === "asc" ? "ascending" : "descending"}
                        </span>
                      </>
                    )}
                  </div>
                </TableHead>
              );
            })}
            <TableHead className="w-10"><span className="sr-only">Row actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Notion-like empty state: the table (with all its column headers)
              stays visible even with zero rows; the empty note + Add row live
              inside the body rather than replacing the whole grid. */}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={spec.columns.length + 1}>
                <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
                  <span>No {spec.id} records yet.</span>
                  {onInsert && (
                    <Button size="sm" variant="outline" onClick={() => onViewChange({ ...view, kind: "form" })}>
                      <Plus className="size-3.5" /> Add row
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )}
          {sorted.map((row, i) => {
            // review round-4 item 6: a red flag anchor's `recordId` must be
            // a STABLE, persisted record id — never the sorted row's
            // array index, which is meaningless once the table is
            // re-sorted/re-filtered and would silently mis-anchor an
            // existing flag onto a DIFFERENT row. A row without a real
            // `id` field is simply not flaggable (React's own `key` still
            // falls back to the index, same as before — that's a
            // rendering-identity concern, unrelated to anchor identity).
            const stableRecordId = typeof row["id"] === "string" || typeof row["id"] === "number" ? String(row["id"]) : null;
            const rowCanUpdate = !canUpdateRow || canUpdateRow(row);
            return (
              <TableRow
                key={stableRecordId ?? i}
                onDoubleClick={() => onOpenRecord?.(row)}
                className={onOpenRecord ? "cursor-pointer" : undefined}
              >
                {spec.columns.map((col) => {
                  const value = row[col.id];
                  // Plain-text form is always what the red-flag anchor records,
                  // regardless of any richer glyph rendered in the cell.
                  const text = formatCell(value);
                  const rich = renderCell(col, value);
                  return (
                    <TableCell key={col.id}>
                      {flaggable && isFlaggableValue(value) && stableRecordId ? (
                        <RedFlagControl
                          anchor={{ kind: "cell", moduleId, databaseId: spec.id, recordId: stableRecordId, fieldId: col.id }}
                          renderedValue={text}
                        >
                          {rich}
                        </RedFlagControl>
                      ) : (
                        rich
                      )}
                    </TableCell>
                  );
                })}
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" aria-label="Open row actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={!onOpenRecord} onSelect={() => onOpenRecord?.(row)}>
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!onEditRecord || !rowCanUpdate}
                        onSelect={() => rowCanUpdate && onEditRecord?.(row)}
                      >
                        Edit
                      </DropdownMenuItem>
                      {/* No Page supplies `onDuplicate`/`onPin` yet, so these are
                          disabled everywhere. Canon requires interactive-looking UI
                          to perform OR EXPLAIN a governed action (AP-021), so — like
                          the Delete item below — they must carry a reason rather than
                          grey out silently. Remove the title when a Page wires the
                          governed handler. */}
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  // Only pay for the batched listForScope query when this Module can
  // actually be flagged — an unsupported Module never renders a
  // RedFlagControl at all, so a RedFlagProvider around it would be a
  // wasted query.
  return flaggable ? <RedFlagProvider scope={{ moduleId, databaseId: spec.id }}>{table}</RedFlagProvider> : table;
}
