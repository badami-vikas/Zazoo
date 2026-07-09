// Schema-driven table contract — generalizes the FieldDef/ViewState shape proven in the
// prototype's DataEngine.tsx (P0/P1 shipped 2026-07-03). "Views as data": a table's columns
// and its views are values, not hardcoded UI branches, so every consumer (DealPilot's feed,
// JobPilot's tracker, the Notion-parity People/Communities tables) shares one engine.

export type ColumnKind =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "date"
  | "checkbox"
  | "url"
  | "relation"
  | "formula"
  | "tool"
  // "location" (ADR-023/ADR-024 view-convertibility grammar): lets map-view
  // eligibility be computed from a real column kind instead of the
  // `apps/web` id/label-substring heuristic (dataviews/eligibility.ts,
  // MapView.tsx — see docs/BUGS.md "@bridge/tables ColumnKind missing
  // location" row, 2026-07-06). Mirrors `@bridge/core`'s
  // `BlueprintColumnKind`, which added this member first.
  | "location";

export interface ColumnSpec {
  id: string;
  label: string;
  kind: ColumnKind;
  editable?: boolean;
  locked?: boolean;
  width?: number;
  options?: string[]; // select/multiselect
  toolId?: string; // kind: "tool" — computed by an internal tool
}

export interface TableSpec {
  id: string; // e.g. "people", "communities", "dealpilot.deals"
  columns: ColumnSpec[];
}

export type FilterOp = "contains" | "is" | "is_not" | "is_empty" | "is_not_empty" | "starts_with";

export interface RowFilter {
  field: string;
  op: FilterOp;
  value: string;
}

export interface SortSpec {
  id: string;
  dir: "asc" | "desc";
}

// A view is data: persisted, swappable, never a hardcoded branch of a component.
export interface ViewConfig {
  id: string;
  kind: "table" | "gallery" | "kanban" | "calendar" | "map" | "network";
  sorts: SortSpec[];
  rowFilters: RowFilter[];
  filterMatch: "all" | "any";
  groupBy: string | null;
}

export const defaultViewConfig = (id: string, kind: ViewConfig["kind"] = "table"): ViewConfig => ({
  id,
  kind,
  sorts: [],
  rowFilters: [],
  filterMatch: "all",
  groupBy: null,
});
