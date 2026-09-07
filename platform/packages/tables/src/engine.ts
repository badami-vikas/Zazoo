import type { ColumnKind, RowFilter, SortSpec } from "./types.js";

// Pure filter/sort/group engine — extracted from DataEngine.tsx's applyFilterDefs/compareOne
// (2026-07-03 P1). Framework-agnostic so DealPilot's deal feed, JobPilot's tracker, and the
// prototype's People/Communities table all filter/sort/group identically instead of each
// re-implementing the waterfall of AND/OR filter logic and multi-sort tie-breaking.

/** The options in an `is_any_of` / `is_none_of` value, which is a comma list. */
function optionList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
}

/** A checkbox cell is true for `true`, `"true"`, `1` and `"yes"`, false otherwise. */
function isChecked(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw !== 0;
  const text = String(raw ?? "").trim().toLowerCase();
  return text === "true" || text === "yes" || text === "1";
}

/** A date cell as a timestamp, or NaN when it is not a date at all. */
function timestamp(raw: unknown): number {
  if (raw instanceof Date) return raw.getTime();
  const text = String(raw ?? "").trim();
  return text === "" ? Number.NaN : new Date(text).getTime();
}

function passesOne(row: Record<string, unknown>, f: RowFilter, kind: ColumnKind | undefined): boolean {
  const raw = row[f.field];
  const cell = Array.isArray(raw) ? raw.join(" ") : String(raw ?? "");
  const cellLow = cell.toLowerCase();
  const valLow = f.value.toLowerCase();
  switch (f.op) {
    case "is_empty":
      return cell.trim() === "";
    case "is_not_empty":
      return cell.trim() !== "";
    case "is_checked":
      return isChecked(raw);
    case "is_not_checked":
      return !isChecked(raw);
    case "is_any_of": {
      const wanted = optionList(f.value);
      if (wanted.length === 0) return true;
      const held = Array.isArray(raw) ? raw.map((v) => String(v).toLowerCase()) : [cellLow];
      return held.some((v) => wanted.includes(v));
    }
    case "is_none_of": {
      const wanted = optionList(f.value);
      if (wanted.length === 0) return true;
      const held = Array.isArray(raw) ? raw.map((v) => String(v).toLowerCase()) : [cellLow];
      return !held.some((v) => wanted.includes(v));
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      // A number comparison on something that is not a number excludes the row
      // rather than falling back to text: "> 5" matching "apple" would be a lie.
      const left = Number(raw);
      const right = Number(f.value);
      if (f.value === "" ) return true;
      if (Number.isNaN(left) || Number.isNaN(right)) return false;
      return f.op === "gt" ? left > right : f.op === "gte" ? left >= right : f.op === "lt" ? left < right : left <= right;
    }
    case "before":
    case "after":
    case "on_or_before":
    case "on_or_after": {
      const left = timestamp(raw);
      const right = timestamp(f.value);
      if (f.value.trim() === "") return true;
      if (Number.isNaN(left) || Number.isNaN(right)) return false;
      return f.op === "before"
        ? left < right
        : f.op === "after"
          ? left > right
          : f.op === "on_or_before"
            ? left <= right
            : left >= right;
    }
    case "is":
      if (!f.value) return true;
      // Dates compare as instants, so "2026-09-06" matches "2026-09-06T10:00Z".
      if (kind === "date" || kind === "createdTime" || kind === "lastEditedTime") {
        const left = timestamp(raw);
        const right = timestamp(f.value);
        if (Number.isNaN(left) || Number.isNaN(right)) return cellLow === valLow;
        return new Date(left).toDateString() === new Date(right).toDateString();
      }
      if (Array.isArray(raw)) return raw.some((v) => String(v).toLowerCase() === valLow);
      return cellLow === valLow;
    case "is_not":
      if (!f.value) return true;
      if (Array.isArray(raw)) return !raw.some((v) => String(v).toLowerCase() === valLow);
      return cellLow !== valLow;
    case "starts_with":
      return f.value ? cellLow.startsWith(valLow) : true;
    case "ends_with":
      return f.value ? cellLow.endsWith(valLow) : true;
    case "does_not_contain":
      return f.value ? !cellLow.includes(valLow) : true;
    default:
      return f.value ? cellLow.includes(valLow) : true;
  }
}

/**
 * Apply a view's filters.
 *
 * `kinds` (columnId -> kind) is optional and only sharpens comparison: without
 * it every operator still works, dates just compare as text. Passing it is what
 * makes "is" on a date match the same day rather than the same string.
 */
export function applyFilters<T extends Record<string, unknown>>(
  rows: T[],
  filters: RowFilter[],
  matchMode: "all" | "any" = "all",
  kinds: Record<string, ColumnKind> = {},
): T[] {
  const active = filters.filter(
    (f) => f.op === "is_empty" || f.op === "is_not_empty" || f.op === "is_checked" || f.op === "is_not_checked" || !!f.value,
  );
  if (!active.length) return rows;
  return rows.filter((row) =>
    matchMode === "any"
      ? active.some((f) => passesOne(row, f, kinds[f.field]))
      : active.every((f) => passesOne(row, f, kinds[f.field])),
  );
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
