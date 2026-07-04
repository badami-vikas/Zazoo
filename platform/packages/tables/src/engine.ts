import type { RowFilter, SortSpec } from "./types.js";

// Pure filter/sort/group engine — extracted from DataEngine.tsx's applyFilterDefs/compareOne
// (2026-07-03 P1). Framework-agnostic so DealPilot's deal feed, JobPilot's tracker, and the
// prototype's People/Communities table all filter/sort/group identically instead of each
// re-implementing the waterfall of AND/OR filter logic and multi-sort tie-breaking.

function passesOne(row: Record<string, unknown>, f: RowFilter): boolean {
  const raw = row[f.field];
  const cell = Array.isArray(raw) ? raw.join(" ") : String(raw ?? "");
  const cellLow = cell.toLowerCase();
  const valLow = f.value.toLowerCase();
  switch (f.op) {
    case "is_empty":
      return cell.trim() === "";
    case "is_not_empty":
      return cell.trim() !== "";
    case "is":
      return f.value ? cellLow === valLow : true;
    case "is_not":
      return f.value ? cellLow !== valLow : true;
    case "starts_with":
      return f.value ? cellLow.startsWith(valLow) : true;
    default:
      return f.value ? cellLow.includes(valLow) : true;
  }
}

export function applyFilters<T extends Record<string, unknown>>(
  rows: T[],
  filters: RowFilter[],
  matchMode: "all" | "any" = "all",
): T[] {
  const active = filters.filter((f) => f.op === "is_empty" || f.op === "is_not_empty" || !!f.value);
  if (!active.length) return rows;
  return rows.filter((row) => (matchMode === "any" ? active.some((f) => passesOne(row, f)) : active.every((f) => passesOne(row, f))));
}

function compareOne(a: Record<string, unknown>, b: Record<string, unknown>, s: SortSpec): number {
  const dir = s.dir === "asc" ? 1 : -1;
  const av = a[s.id];
  const bv = b[s.id];
  const avn = Number(av);
  const bvn = Number(bv);
  if (!Number.isNaN(avn) && !Number.isNaN(bvn) && av !== "" && bv !== "" && av != null && bv != null) {
    return (avn - bvn) * dir;
  }
  return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
}

// Multi-sort: sorts[0] is primary, later entries break ties (Notion-style "then by").
export function applySorts<T extends Record<string, unknown>>(rows: T[], sorts: SortSpec[]): T[] {
  if (!sorts.length) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const c = compareOne(a, b, s);
      if (c !== 0) return c;
    }
    return 0;
  });
}

export function groupBy<T extends Record<string, unknown>>(rows: T[], field: string): Array<[string, T[]]> {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const raw = row[field];
    const key =
      raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)
        ? "No value"
        : Array.isArray(raw)
          ? raw.join(", ")
          : String(raw);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }
  return [...buckets.entries()].sort(([a], [b]) => (a === "No value" ? 1 : b === "No value" ? -1 : a.localeCompare(b)));
}
