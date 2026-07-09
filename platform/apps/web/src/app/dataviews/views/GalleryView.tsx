/**
 * GalleryView — a responsive card grid over TableSpec/ViewConfig, one card per
 * row, showing every column as a label/value pair. Registered under kind
 * "gallery" in registry.ts.
 *
 * Mobile-width-safe: `grid-cols-1` at the base breakpoint (375px = one card per
 * row, no horizontal scroll needed) widening at `sm:`/`lg:`.
 */
import { applyFilters, applySorts } from "@bridge/tables";
import type { DataViewProps } from "../types.js";

export function GalleryView({ spec, view, data }: DataViewProps) {
  const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
  const sorted = applySorts(filtered, view.sorts);

  if (sorted.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md">
        No {spec.id} data yet. Connect an account or add one to see it here.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {sorted.map((row, i) => (
        <div key={String(row["id"] ?? i)} className="border rounded-md p-3 space-y-1">
          {spec.columns.map((col) => (
            <div key={col.id} className="text-sm">
              <span className="text-muted-foreground">{col.label}: </span>
              {formatCell(row[col.id])}
            </div>
          ))}
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
