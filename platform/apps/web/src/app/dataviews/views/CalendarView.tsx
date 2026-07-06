/**
 * CalendarView — a minimal month grid, built from scratch (react-big-calendar
 * is NOT a dependency anywhere in this repo — confirmed by grep before writing
 * this; per the P1 spec, no new calendar dep is added). Registered under kind
 * "calendar" in registry.ts. Groups rows by the first "date"-kind column on the
 * spec (or ViewConfig.groupBy if it names one).
 *
 * Mobile-width-safe: the 7-column grid is hidden below `sm:` and replaced with
 * a single-column agenda list (day -> rows) at 375px — a grid that small
 * cannot show a legible date cell, so this "collapses to agenda list" per the
 * P1 spec rather than squeezing a 7-col grid into a phone width.
 */
import { applyFilters, applySorts } from "@bridge/tables";
import type { DataViewProps } from "../types.js";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toDateKey(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function CalendarView({ spec, view, data }: DataViewProps) {
  const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
  const sorted = applySorts(filtered, view.sorts);

  const dateField = view.groupBy ?? spec.columns.find((c) => c.kind === "date")?.id;
  const titleField = spec.columns.find((c) => c.kind !== "date")?.id ?? spec.columns[0]?.id;

  if (!dateField) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md">
        Calendar needs a date column — none configured for {spec.id}.
      </div>
    );
  }

  const byDay = new Map<string, typeof sorted>();
  for (const row of sorted) {
    const key = toDateKey(row[dateField]);
    if (!key) continue;
    const bucket = byDay.get(key) ?? [];
    bucket.push(row);
    byDay.set(key, bucket);
  }

  if (byDay.size === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md">
        No {spec.id} data with a date yet. Connect an account or add one to see it here.
      </div>
    );
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ day: number; key: string } | null> = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      key: `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
    })),
  ];

  const agendaDays = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="border rounded-md">
      {/* Month grid — desktop/tablet only. */}
      <div className="hidden sm:block p-3">
        <div className="grid grid-cols-7 text-xs font-medium text-muted-foreground mb-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-1 py-1 text-center">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, i) => {
            if (!cell) return <div key={`empty-${i}`} className="min-h-[72px]" />;
            const rows = byDay.get(cell.key) ?? [];
            return (
              <div key={cell.key} className="min-h-[72px] border rounded-md p-1 text-xs overflow-hidden">
                <div className="font-medium">{cell.day}</div>
                {rows.slice(0, 2).map((row, idx) => (
                  <div key={idx} className="truncate text-muted-foreground">
                    {titleField ? String(row[titleField] ?? "") : ""}
                  </div>
                ))}
                {rows.length > 2 && <div className="text-muted-foreground">+{rows.length - 2} more</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Agenda list — mobile (< sm), collapses the grid into a scannable list. */}
      <div className="sm:hidden divide-y">
        {agendaDays.map(([day, rows]) => (
          <div key={day} className="p-3">
            <div className="text-xs font-medium text-muted-foreground mb-1">{day}</div>
            <div className="space-y-1">
              {rows.map((row, i) => (
                <div key={i} className="text-sm">
                  {titleField ? String(row[titleField] ?? "—") : "—"}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
