import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { applyFilters, applySorts } from "@bridge/tables";
import { Button } from "../../components/ui/button.js";
import type { DataRow, DataViewProps } from "../types.js";

type CalendarMode = "month" | "week" | "day" | "agenda";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateKey(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return dateOnly[1];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date): Date {
  return addDays(date, -date.getDay());
}

function rowColor(row: DataRow, colorField?: string): string {
  const value = String(colorField ? row[colorField] ?? "" : "");
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 45% 90%)`;
}

export function CalendarView({
  spec,
  view,
  data,
  onViewChange,
  onInsert,
  onUpdate,
  onOpenRecord,
}: DataViewProps) {
  const [mode, setMode] = useState<CalendarMode>("month");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const dateField = view.dateBy ?? spec.columns.find((column) => column.kind === "date")?.id;
  const titleField =
    spec.columns.find((column) => column.id !== dateField && column.kind === "text")?.id ??
    spec.columns.find((column) => column.id !== dateField)?.id;
  const colorField = spec.columns.find((column) => column.kind === "select")?.id;
  const sorted = useMemo(
    () => applySorts(applyFilters(data, view.rowFilters, view.filterMatch), view.sorts),
    [data, view.filterMatch, view.rowFilters, view.sorts],
  );
  const firstDate = sorted.map((row) => toDateKey(dateField ? row[dateField] : null)).find(Boolean);
  const [anchor, setAnchor] = useState(() => firstDate ? new Date(`${firstDate}T12:00:00`) : new Date());
  const anchoredFromData = useRef(Boolean(firstDate));

  useEffect(() => {
    if (!firstDate || anchoredFromData.current) return;
    setAnchor(new Date(`${firstDate}T12:00:00`));
    anchoredFromData.current = true;
  }, [firstDate]);

  const byDay = useMemo(() => {
    const buckets = new Map<string, DataRow[]>();
    if (!dateField) return buckets;
    for (const row of sorted) {
      const key = toDateKey(row[dateField]);
      if (key) buckets.set(key, [...(buckets.get(key) ?? []), row]);
    }
    return buckets;
  }, [dateField, sorted]);

  if (!dateField) {
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        Calendar needs a date column.
      </div>
    );
  }

  function createOn(day: string) {
    if (!onInsert) return;
    onViewChange({
      ...view,
      kind: "form",
      formDefaults: { [dateField!]: day },
    });
  }

  async function dropOn(event: DragEvent, day: string) {
    const rowId = event.dataTransfer.getData("text/bridge-calendar-row-id");
    if (!rowId || !onUpdate) return;
    setMutationError(null);
    try {
      await onUpdate(rowId, { [dateField!]: day });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "The row could not be rescheduled.");
    }
  }

  function move(direction: -1 | 1) {
    setAnchor((current) => {
      if (mode === "month") return new Date(current.getFullYear(), current.getMonth() + direction, 1);
      if (mode === "week") return addDays(current, direction * 7);
      return addDays(current, direction);
    });
  }

  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthGridStart = startOfWeek(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index));
  const weekStart = startOfWeek(anchor);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const agendaDays = [...byDay.entries()].sort(([left], [right]) => left.localeCompare(right));
  const heading =
    mode === "month"
      ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : mode === "week"
        ? `${weekDays[0].toLocaleDateString()} – ${weekDays[6].toLocaleDateString()}`
        : anchor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const renderRows = (day: string, limit?: number) => {
    const rows = byDay.get(day) ?? [];
    const displayed = limit ? rows.slice(0, limit) : rows;
    return (
      <>
        {displayed.map((row, index) => {
          const rowId = String(row["id"] ?? `${day}:${index}`);
          return (
            <button
              key={rowId}
              type="button"
              draggable={Boolean(onUpdate)}
              onDragStart={(event) => event.dataTransfer.setData("text/bridge-calendar-row-id", rowId)}
              onClick={(event) => {
                event.stopPropagation();
                onOpenRecord?.(row);
              }}
              disabled={!onOpenRecord}
              className="block w-full truncate rounded px-1.5 py-1 text-left text-xs font-medium disabled:cursor-default"
              style={{ backgroundColor: rowColor(row, colorField) }}
            >
              {String(row[titleField ?? "id"] ?? "Untitled record")}
            </button>
          );
        })}
        {limit && rows.length > limit && (
          <div className="px-1 text-xs text-muted-foreground">+{rows.length - limit} more</div>
        )}
      </>
    );
  };

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-2">
        <Button size="sm" variant="ghost" aria-label="Previous period" onClick={() => move(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => setAnchor(new Date())}>Today</Button>
        <Button size="sm" variant="ghost" aria-label="Next period" onClick={() => move(1)}>
          <ChevronRight className="size-4" />
        </Button>
        <div className="min-w-44 flex-1 text-sm font-semibold">{heading}</div>
        <div className="flex rounded-md border bg-background p-0.5">
          {(["month", "week", "day", "agenda"] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? "secondary" : "ghost"}
              className="h-7 capitalize"
              onClick={() => setMode(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        {mutationError && <p role="alert" className="border-b px-3 py-2 text-xs text-red-600">{mutationError}</p>}
      </div>

      {mode === "month" && (
        <>
          <div className="hidden grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground sm:grid">
            {WEEKDAYS.map((weekday) => <div key={weekday} className="py-1.5">{weekday}</div>)}
          </div>
          <div className="hidden grid-cols-7 sm:grid">
            {monthDays.map((day) => {
              const key = dateKey(day);
              const isCurrentMonth = day.getMonth() === anchor.getMonth();
              return (
                <div
                  key={key}
                  role={onInsert ? "button" : undefined}
                  tabIndex={onInsert ? 0 : undefined}
                  className={`min-h-28 border-b border-r p-1.5 text-left align-top ${onInsert ? "hover:bg-muted/30" : ""}`}
                  onClick={onInsert ? () => createOn(key) : undefined}
                  onKeyDown={(event) => {
                    if (onInsert && (event.key === "Enter" || event.key === " ")) createOn(key);
                  }}
                  onDragOver={(event) => { if (onUpdate) event.preventDefault(); }}
                  onDrop={(event) => dropOn(event, key)}
                >
                  <span className={isCurrentMonth ? "text-xs font-medium" : "text-xs text-muted-foreground"}>
                    {day.getDate()}
                  </span>
                  <span className="mt-1 block space-y-1">{renderRows(key, 3)}</span>
                </div>
              );
            })}
          </div>
          <div className="divide-y sm:hidden">
            {agendaDays.map(([day]) => (
              <div key={day} className="p-3">
                <button type="button" disabled={!onInsert} className="mb-2 text-xs font-medium text-muted-foreground disabled:cursor-default" onClick={() => createOn(day)}>
                  {day} {onInsert && <Plus className="inline size-3" />}
                </button>
                <div className="space-y-1">{renderRows(day)}</div>
              </div>
            ))}
            {agendaDays.length === 0 && (
              <button type="button" disabled={!onInsert} className="w-full p-6 text-sm text-muted-foreground disabled:cursor-default" onClick={() => createOn(dateKey(anchor))}>
                No dated records.{onInsert ? " Add one." : ""}
              </button>
            )}
          </div>
        </>
      )}

      {mode === "week" && (
        <div className="grid grid-cols-1 divide-y sm:grid-cols-7 sm:divide-x sm:divide-y-0">
          {weekDays.map((day) => {
            const key = dateKey(day);
            return (
              <div
                key={key}
                role={onInsert ? "button" : undefined}
                tabIndex={onInsert ? 0 : undefined}
                className={`min-h-40 p-2 text-left ${onInsert ? "hover:bg-muted/30" : ""}`}
                onClick={onInsert ? () => createOn(key) : undefined}
                onKeyDown={(event) => {
                  if (onInsert && (event.key === "Enter" || event.key === " ")) createOn(key);
                }}
                onDragOver={(event) => { if (onUpdate) event.preventDefault(); }}
                onDrop={(event) => dropOn(event, key)}
              >
                <div className="mb-2 text-xs font-medium">{WEEKDAYS[day.getDay()]} {day.getDate()}</div>
                <div className="space-y-1">{renderRows(key)}</div>
              </div>
            );
          })}
        </div>
      )}

      {mode === "day" && (
        <div
          role={onInsert ? "button" : undefined}
          tabIndex={onInsert ? 0 : undefined}
          className={`min-h-64 w-full p-4 text-left ${onInsert ? "hover:bg-muted/30" : ""}`}
          onClick={onInsert ? () => createOn(dateKey(anchor)) : undefined}
          onKeyDown={(event) => {
            if (onInsert && (event.key === "Enter" || event.key === " ")) createOn(dateKey(anchor));
          }}
          onDragOver={(event) => { if (onUpdate) event.preventDefault(); }}
          onDrop={(event) => dropOn(event, dateKey(anchor))}
        >
          <div className="space-y-2">{renderRows(dateKey(anchor))}</div>
          {(byDay.get(dateKey(anchor)) ?? []).length === 0 && (
            <span className="text-sm text-muted-foreground">
              No records.{onInsert ? " Click to add one on this date." : ""}
            </span>
          )}
        </div>
      )}

      {mode === "agenda" && (
        <div className="divide-y">
          {agendaDays.map(([day]) => (
            <div key={day} className="p-3">
              <button type="button" disabled={!onInsert} className="mb-2 text-xs font-medium text-muted-foreground disabled:cursor-default" onClick={() => createOn(day)}>
                {day} {onInsert && <Plus className="inline size-3" />}
              </button>
              <div className="space-y-1">{renderRows(day)}</div>
            </div>
          ))}
          {agendaDays.length === 0 && (
            <button type="button" disabled={!onInsert} className="w-full p-6 text-sm text-muted-foreground disabled:cursor-default" onClick={() => createOn(dateKey(anchor))}>
              No dated records.{onInsert ? " Add one." : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
