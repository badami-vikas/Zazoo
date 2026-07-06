/**
 * KanbanView — groups rows by ViewConfig.groupBy (a select/status-shaped
 * column) via @bridge/tables' engine.ts groupBy, one card column per bucket.
 * Registered under kind "kanban" in registry.ts.
 *
 * Mobile-width-safe: `overflow-x-auto` + `snap-x` on the column row means at
 * 375px the board becomes a horizontally swipeable strip of columns instead of
 * squeezing every column onto one screen.
 */
import { applyFilters, applySorts, groupBy } from "@bridge/tables";
import { Badge } from "../../components/ui/badge.js";
import type { DataViewProps } from "../types.js";

export function KanbanView({ spec, view, data }: DataViewProps) {
  const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
  const sorted = applySorts(filtered, view.sorts);

  const groupField = view.groupBy ?? spec.columns.find((c) => c.kind === "select")?.id;
  if (!groupField) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md">
        Kanban needs a group-by column (a select field) — none configured for {spec.id}.
      </div>
    );
  }

  const groups = groupBy(sorted, groupField);
  const titleField = spec.columns.find((c) => c.kind !== "select")?.id ?? spec.columns[0]?.id;

  if (groups.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md">
        No {spec.id} data yet. Connect an account or add one to see it here.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2">
      {groups.map(([key, rows]) => (
        <div
          key={key}
          className="flex-none w-[80vw] max-w-[280px] snap-start border rounded-md bg-muted/30"
        >
          <div className="px-3 py-2 border-b text-sm font-medium flex items-center justify-between gap-2">
            <span className="truncate">{key}</span>
            <Badge variant="secondary">{rows.length}</Badge>
          </div>
          <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
            {rows.map((row, i) => (
              <div key={String(row["id"] ?? i)} className="border rounded-md bg-card p-2 text-sm">
                {titleField ? formatCell(row[titleField]) : "—"}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
