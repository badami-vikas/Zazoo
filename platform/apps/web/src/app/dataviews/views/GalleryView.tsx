/**
 * GalleryView — a responsive card grid over TableSpec/ViewConfig, one card per
 * row, showing every column as a label/value pair. Registered under kind
 * "gallery" in registry.ts.
 *
 * Mobile-width-safe: `grid-cols-1` at the base breakpoint (375px = one card per
 * row, no horizontal scroll needed) widening at `sm:`/`lg:`.
 */
import { applyFilters, applySorts } from "@bridge/tables";
import { Plus } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import type { DataViewProps } from "../types.js";

export function GalleryView({ spec, view, data, onViewChange, onInsert, onOpenRecord }: DataViewProps) {
  const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
  const sorted = applySorts(filtered, view.sorts);

  if (sorted.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md space-y-3">
        <div>No {spec.id} records yet.</div>
        {onInsert && (
          <Button size="sm" variant="outline" onClick={() => onViewChange({ ...view, kind: "form" })}>
            <Plus className="size-3.5" /> Add element
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {sorted.map((row, i) => {
        const titleColumn =
          spec.columns.find((column) => column.kind === "text") ?? spec.columns[0];
        const detailColumns = spec.columns
          .filter((column) => column.id !== titleColumn?.id && row[column.id] != null && row[column.id] !== "")
          .slice(0, 4);
        return (
        <button
          type="button"
          key={String(row["id"] ?? i)}
          className="border rounded-md p-3 space-y-2 text-left hover:bg-muted/30 disabled:cursor-default"
          disabled={!onOpenRecord}
          onClick={() => onOpenRecord?.(row)}
        >
          <div className="font-semibold">{formatCell(row[titleColumn?.id ?? "id"])}</div>
          {detailColumns.map((col) => (
            <div key={col.id} className="text-sm">
              <span className="text-muted-foreground">{col.label}: </span>
              {formatCell(row[col.id])}
            </div>
          ))}
        </button>
        );
      })}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
