/**
 * ListView — Notion's list is a table with the grid taken away: one line per
 * Record, the title on the left, a few properties trailing on the right.
 *
 * It therefore renders cells through the SHARED `renderCell` (cell-format.tsx),
 * not through a renderer of its own. A second renderer is exactly how the badge
 * glyphs drifted once already (ADR-194), and a list that formatted a currency
 * or a status differently from the table would be the same bug again.
 *
 * The columns it trails are the ones the shell handed it: <DataViews> filters
 * `spec.columns` by the user's column picker before a view ever sees it, so the
 * choice of properties is already the user's and needs no second control here.
 */
import { applyFilters, applySorts, isMetadataColumn } from "@bridge/tables";
import { Plus } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { renderCell } from "../cell-format.js";
import type { DataViewProps } from "../types.js";

/** Properties trailing the title. More than three and the line stops being a line. */
const TRAILING_LIMIT = 3;

export function ListView({ spec, view, data, onViewChange, onInsert, onOpenRecord }: DataViewProps) {
  const rows = applySorts(applyFilters(data, view.rowFilters, view.filterMatch), view.sorts);

  const titleColumn = spec.columns.find((column) => column.kind === "text") ?? spec.columns[0];
  const trailing = spec.columns
    .filter((column) => column.id !== titleColumn?.id && !isMetadataColumn(column.kind))
    .slice(0, TRAILING_LIMIT);

  if (rows.length === 0) {
    return (
      <div className="space-y-3 rounded-md border p-6 text-center text-sm text-muted-foreground">
        <div>No {spec.id} records yet.</div>
        {onInsert && (
          <Button size="sm" variant="outline" onClick={() => onViewChange({ ...view, kind: "form" })}>
            <Plus className="size-3.5" /> Add record
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="divide-y rounded-md border">
      {rows.map((row, index) => (
        <button
          key={String(row["id"] ?? index)}
          type="button"
          disabled={!onOpenRecord}
          onClick={() => onOpenRecord?.(row)}
          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/30 disabled:cursor-default"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {renderCell(titleColumn!, row[titleColumn?.id ?? "id"])}
          </span>
          {trailing.map((column) => (
            <span
              key={column.id}
              className="hidden max-w-40 shrink-0 truncate text-sm text-muted-foreground sm:block"
              title={column.label}
            >
              {renderCell(column, row[column.id])}
            </span>
          ))}
        </button>
      ))}
    </div>
  );
}
