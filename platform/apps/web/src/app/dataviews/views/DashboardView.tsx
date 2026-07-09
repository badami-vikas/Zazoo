/**
 * DashboardView — a grid of stat/list widgets over the same TableSpec/rows
 * <DataViews> already has, for blueprint views of kind "dashboard" (the
 * blueprint's non-tabular view surface, docs/wiki/vision.md "View grammar":
 * "table · chatbot · dashboard · canvas"). Not @bridge/tables-backed (no
 * ViewConfig["kind"] === "dashboard" exists — @bridge/tables' grammar is table/
 * gallery/kanban/calendar/map/network only), so this lives OUTSIDE
 * VIEW_COMPONENT_REGISTRY and is rendered directly by <DataViews> when a
 * compiled view's kind is "dashboard".
 *
 * v1 widgets are honest and data-derived only: a total-count stat per numeric/
 * select column distribution, and a most-recent-rows list. No invented KPIs.
 *
 * Mobile-width-safe: stat cards wrap via `flex-wrap`; the list widget is a
 * plain block, no fixed-width overflow risk at 375px.
 */
import type { TableSpec } from "@bridge/tables";
import type { DataRow } from "../types.js";

export interface DashboardViewProps {
  spec: TableSpec;
  data: DataRow[];
}

export function DashboardView({ spec, data }: DashboardViewProps) {
  if (data.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md">
        No {spec.id} data yet. Connect an account or add one to see it here.
      </div>
    );
  }

  const selectColumns = spec.columns.filter((c) => c.kind === "select");
  const titleField = spec.columns.find((c) => c.kind === "text")?.id ?? spec.columns[0]?.id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <div className="border rounded-md p-3 min-w-[120px]">
          <div className="text-2xl font-semibold">{data.length}</div>
          <div className="text-xs text-muted-foreground">total {spec.id}</div>
        </div>
        {selectColumns.map((col) => {
          const distinct = new Set(data.map((r) => String(r[col.id] ?? "")).filter(Boolean));
          return (
            <div key={col.id} className="border rounded-md p-3 min-w-[120px]">
              <div className="text-2xl font-semibold">{distinct.size}</div>
              <div className="text-xs text-muted-foreground">distinct {col.label.toLowerCase()}</div>
            </div>
          );
        })}
      </div>

      <div className="border rounded-md">
        <div className="px-3 py-2 border-b text-sm font-medium">Most recent</div>
        <ul className="divide-y">
          {data.slice(0, 5).map((row, i) => (
            <li key={i} className="px-3 py-2 text-sm">
              {titleField ? String(row[titleField] ?? "—") : "—"}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
