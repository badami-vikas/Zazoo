/**
 * TimelineView — Records laid on a horizontal date axis, one lane each.
 *
 * A row with only a start date is drawn as a POINT; give the view an end-date
 * column and the same row becomes a bar spanning the two. That is the whole
 * difference between this and the calendar: the calendar answers "what is on
 * the 14th", the timeline answers "what overlaps what".
 *
 * The start column is `view.dateBy`, the same persisted field the calendar
 * drives from, so switching between the two kinds keeps the user's choice. The
 * end column and the zoom are LOCAL state — `ViewConfig` has no field for
 * either, and inventing one here would be a schema change owned elsewhere.
 */
import { useMemo, useState } from "react";
import { applyFilters, applySorts } from "@bridge/tables";
import { Button } from "../../components/ui/button.js";
import { StandardDropdown } from "../../components/shared/StandardDropdown.js";
import type { DataRow, DataViewProps } from "../types.js";

type Zoom = "day" | "week" | "month";

const ZOOM_MS: Record<Zoom, number> = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/** Ticks narrower than this stop being readable, so the track scrolls instead. */
const MIN_TICK_PX = 72;

function toTime(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const at = new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at.getTime();
}

function floorTo(time: number, zoom: Zoom): Date {
  const at = new Date(time);
  at.setHours(0, 0, 0, 0);
  if (zoom === "week") at.setDate(at.getDate() - at.getDay());
  if (zoom === "month") at.setDate(1);
  return at;
}

function stepFrom(date: Date, zoom: Zoom): Date {
  const next = new Date(date);
  if (zoom === "month") next.setMonth(next.getMonth() + 1);
  else next.setDate(next.getDate() + (zoom === "week" ? 7 : 1));
  return next;
}

function tickLabel(date: Date, zoom: Zoom): string {
  if (zoom === "month") return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TimelineView({ spec, view, data, onViewChange, onInsert, onOpenRecord }: DataViewProps) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const [endField, setEndField] = useState<string | null>(null);

  const startField = view.dateBy ?? spec.columns.find((column) => column.kind === "date")?.id;
  const dateColumns = spec.columns.filter((column) => column.kind === "date");
  const titleField =
    spec.columns.find((column) => column.id !== startField && column.kind === "text")?.id ??
    spec.columns.find((column) => column.id !== startField)?.id;

  const rows = useMemo(
    () => applySorts(applyFilters(data, view.rowFilters, view.filterMatch), view.sorts),
    [data, view.filterMatch, view.rowFilters, view.sorts],
  );

  const spans = useMemo(() => {
    if (!startField) return [] as { row: DataRow; start: number; end: number }[];
    return rows
      .map((row) => {
        const start = toTime(row[startField]);
        if (start === null) return null;
        const end = endField ? toTime(row[endField]) : null;
        return { row, start, end: end !== null && end > start ? end : start };
      })
      .filter((span): span is { row: DataRow; start: number; end: number } => span !== null);
  }, [endField, rows, startField]);

  if (!startField) {
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        Timeline needs a date column. {spec.id} has none.
      </div>
    );
  }

  if (spans.length === 0) {
    return (
      <div className="space-y-3 rounded-md border p-6 text-center text-sm text-muted-foreground">
        <div>No dated {spec.id} records yet.</div>
        {onInsert && (
          <Button size="sm" variant="outline" onClick={() => onViewChange({ ...view, kind: "form" })}>
            Add record
          </Button>
        )}
      </div>
    );
  }

  const rangeStart = floorTo(Math.min(...spans.map((span) => span.start)), zoom);
  const lastEnd = Math.max(...spans.map((span) => span.end));
  const ticks: Date[] = [];
  for (let cursor = rangeStart; cursor.getTime() <= lastEnd || ticks.length < 2; cursor = stepFrom(cursor, zoom)) {
    ticks.push(cursor);
    // A pathological range (a year at day zoom) must not build a million ticks.
    if (ticks.length >= 400) break;
  }
  const rangeEnd = stepFrom(ticks[ticks.length - 1]!, zoom).getTime();
  const span = rangeEnd - rangeStart.getTime() || ZOOM_MS[zoom];
  const percent = (time: number) =>
    Math.min(100, Math.max(0, ((time - rangeStart.getTime()) / span) * 100));

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-2">
        <div className="flex rounded-md border bg-background p-0.5">
          {(["day", "week", "month"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={zoom === value ? "secondary" : "ghost"}
              className="h-7 capitalize"
              onClick={() => setZoom(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        {dateColumns.length > 1 && (
          <StandardDropdown
            ariaLabel="End date column"
            placeholder="No end date"
            activeId={endField}
            options={[
              { id: "", label: "No end date" },
              ...dateColumns
                .filter((column) => column.id !== startField)
                .map((column) => ({ id: column.id, label: `Ends: ${column.label}` })),
            ]}
            onSelect={(id) => setEndField(id === "" ? null : id)}
          />
        )}
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: `${Math.max(ticks.length * MIN_TICK_PX, 320)}px` }}>
          <div className="flex border-b bg-muted/20 text-xs text-muted-foreground">
            <div className="sticky left-0 w-44 shrink-0 border-r bg-background px-3 py-1.5 font-medium">
              Record
            </div>
            <div className="relative flex flex-1">
              {ticks.map((tick) => (
                <div key={tick.getTime()} className="flex-1 border-r px-1.5 py-1.5 last:border-r-0">
                  {tickLabel(tick, zoom)}
                </div>
              ))}
            </div>
          </div>

          <div className="divide-y">
            {spans.map(({ row, start, end }, index) => {
              const left = percent(start);
              const width = Math.max(percent(end) - left, 1.2);
              return (
                <div key={String(row["id"] ?? index)} className="flex items-center">
                  <div className="sticky left-0 w-44 shrink-0 truncate border-r bg-background px-3 py-2 text-sm">
                    {String(row[titleField ?? "id"] ?? "Untitled record")}
                  </div>
                  <div className="relative h-9 flex-1">
                    <button
                      type="button"
                      disabled={!onOpenRecord}
                      onClick={() => onOpenRecord?.(row)}
                      title={
                        endField && end !== start
                          ? `${new Date(start).toLocaleDateString()} – ${new Date(end).toLocaleDateString()}`
                          : new Date(start).toLocaleDateString()
                      }
                      className="absolute top-1/2 -translate-y-1/2 rounded-full bg-primary/80 px-2 text-xs text-primary-foreground hover:bg-primary disabled:cursor-default"
                      style={{ left: `${left}%`, width: `${width}%`, minWidth: "0.75rem", height: "1.25rem" }}
                    >
                      <span className="sr-only">
                        {String(row[titleField ?? "id"] ?? "Untitled record")}
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
