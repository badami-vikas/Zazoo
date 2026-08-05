/**
 * TableView — the entry point for the `table` view kind, registered under kind
 * "table" in registry.ts. It is still the ONLY component the registry knows
 * about; what changed (ADR-172 / AP-102) is what it renders.
 *
 * ONE RENDERER NOW: `GLIDE_ROW_THRESHOLD` is 0, so every table — including the
 * empty one — is drawn by the canvas `GlideTableView`. The DOM renderer
 * (`DomTableView`, below) is deliberately LEFT IN PLACE but is now unreachable:
 * raising the threshold back above 0 is the single-line revert if the canvas
 * path turns out to regress something in live use. Do not treat the dead code
 * as an accident, and do not add features to it — it is a parachute, not a
 * second surface.
 *
 * WHY THE FLIP IS SAFE NOW. ADR-160 kept DOM as the default because the canvas
 * path was missing the governed affordances only the DOM table carried. All of
 * them have since been reproduced on canvas without forking any component:
 *   - the red-flag control (open flags painted by `drawCell`, the real
 *     `<RedFlagControl>` mounted as a DOM overlay on hover/tap);
 *   - the column header menu (the SAME `StandardColumnMenuPanel`, opened from
 *     Glide's `onHeaderMenuClick`);
 *   - the per-row 3-dots menu (the SAME `StandardRowMenuItems`);
 *   - the Notion-style zero-row state (header + empty body + add row, never a
 *     message box replacing the table — AP-081);
 *   - a trailing "+ New row", present only when a governed insert path exists.
 * Both renderers read the same TableSpec, the same ViewConfig, the same engine
 * filters/sorts and the same cell semantics from `../cell-format.js`, so the
 * flip changes how a table is painted, never what its data means.
 *
 * STILL DOM-ONLY, HONESTLY: a canvas grid is not a semantic <table>, so the
 * `aria-sort` headers and per-cell DOM structure below have no canvas
 * equivalent. Glide supplies its own ARIA grid roles and keyboard navigation;
 * screen-reader parity has NOT been verified in a live browser.
 *
 * Mobile-width-safe: the shadcn Table component already wraps itself in a
 * `overflow-x-auto` container (components/ui/table.tsx), so at 375px the table
 * scrolls horizontally INSIDE its own box rather than blowing out the page.
 * The canvas grid scrolls horizontally inside its own container likewise.
 */
import { applyFilters, applySorts } from "@bridge/tables";
import { Plus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table.js";
import { Button } from "../../components/ui/button.js";
import { StandardColumnMenu } from "../../components/shared/StandardColumnMenu.js";
import { StandardRowMenu } from "../../components/shared/StandardRowMenu.js";
import { RedFlagControl } from "../../components/shared/RedFlagControl.js";
import { RedFlagProvider } from "../../components/shared/RedFlagProvider.js";
import { isFlaggableValue, isSupportedRedFlagModule, moduleIdFromDatabaseId } from "../eligibility.js";
import type { DataViewProps } from "../types.js";
import { formatCell, renderCell } from "../cell-format.js";
import { GlideTableView } from "./GlideTableView.js";

/**
 * Rows above which the canvas renderer takes over. ZERO — i.e. always (AP-102):
 * one table primitive, not two that drift. It is kept as a named constant
 * rather than deleted precisely so the flip is revertible in one line (set it
 * back to e.g. 400 to restore the DOM path for small tables).
 */
export const GLIDE_ROW_THRESHOLD = 0;

export function TableView(props: DataViewProps) {
  const { spec, view, data } = props;
  // Count what will actually be painted, not the unfiltered input. At a
  // threshold of 0 this only matters for the revert case, but `>=` (not `>`)
  // is what makes a ZERO-row table take the canvas path too — the empty state
  // is part of the surface being standardised, not an exception to it.
  const visibleCount = applyFilters(data, view.rowFilters, view.filterMatch).length;
  if (visibleCount >= GLIDE_ROW_THRESHOLD) return <GlideTableView {...props} />;
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
                  <StandardRowMenu
                    row={row}
                    stableRecordId={stableRecordId}
                    canUpdate={rowCanUpdate}
                    onOpenRecord={onOpenRecord}
                    onEditRecord={onEditRecord}
                    onDuplicate={onDuplicate}
                    onPin={onPin}
                  />
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
