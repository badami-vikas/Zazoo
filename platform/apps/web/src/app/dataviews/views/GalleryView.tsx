/**
 * GalleryView — a card grid over TableSpec/ViewConfig. Registered under kind
 * "gallery" in registry.ts.
 *
 * What makes it a gallery rather than a card-shaped list (2026-09-06): a card
 * SIZE, a chosen PREVIEW field that renders as a cover image when the value is
 * one, and a picker for which properties the card carries. Before this it
 * printed the title and the first four non-empty fields, which is a list with
 * borders.
 *
 * `cardSize` and `cardPreviewField` are persisted `ViewConfig` fields, so both
 * survive a reload through the shell's save path. The property selection is
 * LOCAL — `ViewConfig` has no field for it, and the columns arriving here are
 * already the ones the shell's own column picker left visible.
 *
 * Mobile-width-safe: `grid-cols-1` at the base breakpoint (375px = one card per
 * row, no horizontal scroll needed) widening at `sm:`/`lg:`.
 */
import { useState } from "react";
import { applyFilters, applySorts, isMetadataColumn, type ViewConfig } from "@bridge/tables";
import { Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";
import { StandardDropdown } from "../../components/shared/StandardDropdown.js";
import { renderCell } from "../cell-format.js";
import type { DataViewProps } from "../types.js";

type CardSize = NonNullable<ViewConfig["cardSize"]>;

/** Card size is a GRID density, not a font size — Notion's small/medium/large
 * changes how many cards fit a row and how tall the cover is. */
const SIZE_GRID: Record<CardSize, string> = {
  small: "grid-cols-1 sm:grid-cols-3 lg:grid-cols-5",
  medium: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  large: "grid-cols-1 lg:grid-cols-2",
};

const SIZE_COVER: Record<CardSize, string> = {
  small: "h-24",
  medium: "h-36",
  large: "h-56",
};

/** Properties shown on a card before the user picks otherwise. */
const DEFAULT_PROPERTY_LIMIT = 4;

/** Is this value something the card can show as a picture rather than as text? */
function imageUrl(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url) && !url.startsWith("data:image/")) return null;
  return url.startsWith("data:image/") || /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(url)
    ? url
    : null;
}

export function GalleryView({ spec, view, data, onViewChange, onInsert, onOpenRecord }: DataViewProps) {
  const sorted = applySorts(applyFilters(data, view.rowFilters, view.filterMatch), view.sorts);

  const size: CardSize = view.cardSize ?? "medium";
  const titleColumn = spec.columns.find((column) => column.kind === "text") ?? spec.columns[0];
  const bodyColumns = spec.columns.filter(
    (column) => column.id !== titleColumn?.id && !isMetadataColumn(column.kind),
  );
  const previewColumn = spec.columns.find((column) => column.id === view.cardPreviewField);

  const [shown, setShown] = useState<Set<string>>(
    () => new Set(bodyColumns.slice(0, DEFAULT_PROPERTY_LIMIT).map((column) => column.id)),
  );
  const propertyColumns = bodyColumns.filter(
    (column) => shown.has(column.id) && column.id !== previewColumn?.id,
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-md border bg-background p-0.5">
        {(["small", "medium", "large"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={size === value ? "secondary" : "ghost"}
            className="h-7 capitalize"
            onClick={() => onViewChange({ ...view, cardSize: value })}
          >
            {value}
          </Button>
        ))}
      </div>
      <StandardDropdown
        ariaLabel="Card preview"
        placeholder="No preview"
        activeId={view.cardPreviewField ?? ""}
        options={[
          { id: "", label: "No preview" },
          ...bodyColumns.map((column) => ({ id: column.id, label: `Preview: ${column.label}` })),
        ]}
        onSelect={(id) =>
          onViewChange({ ...view, cardPreviewField: id === "" ? undefined : id })
        }
      />
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-7">
            <SlidersHorizontal className="size-3.5" /> Properties ({propertyColumns.length})
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 space-y-1 p-2">
          {bodyColumns.length === 0 && (
            <p className="p-1 text-sm text-muted-foreground">This Database has no other fields.</p>
          )}
          {bodyColumns.map((column) => (
            <label key={column.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
              <Checkbox
                checked={shown.has(column.id)}
                onCheckedChange={(checked) =>
                  setShown((current) => {
                    const next = new Set(current);
                    if (checked) next.add(column.id);
                    else next.delete(column.id);
                    return next;
                  })
                }
              />
              <span className="truncate">{column.label}</span>
            </label>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );

  if (sorted.length === 0) {
    return (
      <div className="space-y-3">
        {toolbar}
        <div className="space-y-3 rounded-md border p-6 text-center text-sm text-muted-foreground">
          <div>No {spec.id} records yet.</div>
          {onInsert && (
            <Button size="sm" variant="outline" onClick={() => onViewChange({ ...view, kind: "form" })}>
              <Plus className="size-3.5" /> Add record
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {toolbar}
      <div className={`grid gap-3 ${SIZE_GRID[size]}`}>
        {sorted.map((row, index) => {
          const preview = previewColumn ? row[previewColumn.id] : null;
          const cover = imageUrl(preview);
          return (
            <button
              type="button"
              key={String(row["id"] ?? index)}
              className="overflow-hidden rounded-md border text-left hover:bg-muted/30 disabled:cursor-default"
              disabled={!onOpenRecord}
              onClick={() => onOpenRecord?.(row)}
            >
              {previewColumn &&
                (cover ? (
                  <img
                    src={cover}
                    alt=""
                    loading="lazy"
                    className={`w-full object-cover ${SIZE_COVER[size]}`}
                  />
                ) : (
                  <div
                    className={`flex w-full items-center justify-center bg-muted/40 px-3 text-center text-sm text-muted-foreground ${SIZE_COVER[size]}`}
                  >
                    {renderCell(previewColumn, preview)}
                  </div>
                ))}
              <div className="space-y-2 p-3">
                <div className="truncate font-semibold">
                  {renderCell(titleColumn!, row[titleColumn?.id ?? "id"])}
                </div>
                {propertyColumns.map((column) => (
                  <div key={column.id} className="text-sm">
                    <span className="text-muted-foreground">{column.label}: </span>
                    {renderCell(column, row[column.id])}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
