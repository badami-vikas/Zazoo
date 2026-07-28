import type { DataRow } from "./types";

/**
 * Free-text row search used by the DealPilot/JobPilot toolbars: keeps a row when
 * ANY of its values contains the query (case-insensitive). Applied to the rows
 * BEFORE they reach DataViews, so it composes with the view's own column
 * filters/sorts. An empty/whitespace query returns the rows unchanged.
 */
export function filterRowsByQuery(rows: DataRow[], query: string): DataRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    Object.values(row).some((value) => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.some((entry) => String(entry).toLowerCase().includes(q));
      return String(value).toLowerCase().includes(q);
    }),
  );
}
