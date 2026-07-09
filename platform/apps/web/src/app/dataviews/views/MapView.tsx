/**
 * MapView — registered under kind "map" (ADR-023 item 2: "map when a
 * location-kind column exists"). No mapping library exists anywhere in this
 * repo (confirmed by grep before writing this — Leaflet/Mapbox/Google Maps JS
 * are not dependencies), and the P1 spec is explicit: "do NOT add a heavy map
 * dependency without need." So this renders an honest grouped-by-location
 * list — clearly labeled "map view (list fallback)" rather than pretending to
 * be a real map — grouping rows by the first location-shaped column (see
 * ../eligibility.ts's LOCATION_HINTS heuristic, since @bridge/tables' ColumnKind
 * has no dedicated "location" kind yet). Filed as a BUGS.md gap, not silently
 * shipped as if it were a real map.
 *
 * Mobile-width-safe: single-column stacked groups, no fixed widths.
 */
import { applyFilters, applySorts } from "@bridge/tables";
import type { DataViewProps } from "../types.js";

const LOCATION_HINTS = ["location", "address", "city", "region", "country", "lat", "lng", "latitude", "longitude", "place"];

export function MapView({ spec, view, data }: DataViewProps) {
  const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
  const sorted = applySorts(filtered, view.sorts);

  const locationField =
    view.groupBy ??
    spec.columns.find((c) => LOCATION_HINTS.some((hint) => `${c.id} ${c.label}`.toLowerCase().includes(hint)))?.id;
  const titleField = spec.columns.find((c) => c.id !== locationField)?.id ?? spec.columns[0]?.id;

  if (!locationField) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md">
        Map needs a location column — none configured for {spec.id}.
      </div>
    );
  }

  const byLocation = new Map<string, typeof sorted>();
  for (const row of sorted) {
    const raw = row[locationField];
    const key = raw === null || raw === undefined || raw === "" ? "Unknown location" : String(raw);
    const bucket = byLocation.get(key) ?? [];
    bucket.push(row);
    byLocation.set(key, bucket);
  }

  return (
    <div className="border rounded-md">
      <div className="text-xs text-muted-foreground border-b px-3 py-2 bg-muted/30">
        map view (list fallback) — no map-rendering library in this repo; showing {spec.id} grouped by location instead
        of plotted on a map.
      </div>
      {byLocation.size === 0 ? (
        <div className="p-6 text-sm text-muted-foreground text-center">
          No {spec.id} data with a location yet. Connect an account or add one to see it here.
        </div>
      ) : (
        <div className="divide-y">
          {[...byLocation.entries()].map(([location, rows]) => (
            <div key={location} className="p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">{location}</div>
              <div className="space-y-1">
                {rows.map((row, i) => (
                  <div key={String(row["id"] ?? i)} className="text-sm">
                    {titleField ? String(row[titleField] ?? "—") : "—"}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
