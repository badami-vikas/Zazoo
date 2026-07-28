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
  | "skill"
  // "location" (ADR-023/ADR-024 view-convertibility grammar): lets map-view
  // eligibility be computed from a real column kind instead of the
  // `apps/web` id/label-substring heuristic (dataviews/eligibility.ts,
  // MapView.tsx — see docs/BUGS.md "@bridge/tables ColumnKind missing
  // location" row, 2026-07-06). Mirrors `@bridge/core`'s
  // `BlueprintColumnKind`, which added this member first.
  | "location";

export type ViewKind =
  | "table"
  | "board"
  | "gallery"
  | "form"
  | "calendar"
  | "map"
  | "graph"
  | "tree";

export type GraphScope = "single_database" | "multi_database" | "full";

export const VIEW_KINDS: readonly ViewKind[] = [
  "table",
  "board",
  "gallery",
  "form",
  "calendar",
  "map",
  "graph",
  "tree",
] as const;

export interface ColumnSpec {
  id: string;
  label: string;
  kind: ColumnKind;
  editable?: boolean;
  locked?: boolean;
  width?: number;
  options?: string[]; // select/multiselect
  skillId?: string; // kind: "skill" — computed by a governed Skill
  required?: boolean;
  defaultValue?: unknown;
  relationTarget?: string;
  relationParent?: boolean;
  hiddenInForm?: boolean;
  sensitive?: boolean;
  /**
   * Optional presentation hint for the table cell. Purely visual and
   * backward-compatible: a column with no `display` renders exactly as before
   * (plain text). Renderers map the raw value to a richer glyph:
   *   - "badge"    — a coloured pill (palette keyed by value via `badgePalette`)
   *   - "rag"      — a red/yellow/green status dot (value = "red"|"yellow"|"green")
   *   - "meter"    — a 0..100 progress bar coloured by threshold
   *   - "currency" — a compact money label (e.g. $4.2M)
   *   - "multiple" — a ratio label (e.g. 10.2×)
   * The underlying value and edit/sort/filter behaviour are unchanged.
   */
  display?: "badge" | "rag" | "meter" | "currency" | "multiple";
  /** Value → colour token for `display: "badge"`. Unmapped values fall back to a neutral pill. */
  badgePalette?: Record<string, "green" | "yellow" | "red" | "blue" | "gray">;
  /** Value → human label for `display: "badge"`. Display-only; the stored value
   * (used for edit/sort/filter) is unchanged. Unmapped values show as-is. */
  badgeLabels?: Record<string, string>;
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
  /** "form" = standard new-row input view (direct insert, same enrichment process as
   * any other DB write — docs/wiki/ui-architecture.md "Form view"). Always eligible
   * for any table-backed spec; submission calls the caller-supplied `onInsert` hook. */
  kind: ViewKind;
  sorts: SortSpec[];
  rowFilters: RowFilter[];
  filterMatch: "all" | "any";
  groupBy: string | null;
  dateBy?: string;
  locationBy?: string;
  relationBy?: string;
  parentBy?: string;
  graphScope?: GraphScope;
  graphDatabaseIds?: string[];
  formDefaults?: Record<string, unknown>;
}

export function normalizeViewKind(kind: unknown): ViewKind | null {
  if (kind === "kanban") return "board";
  if (kind === "network") return "graph";
  return VIEW_KINDS.includes(kind as ViewKind) ? (kind as ViewKind) : null;
}

export const defaultViewConfig = (id: string, kind: ViewKind = "table"): ViewConfig => ({
  id,
  kind,
  sorts: [],
  rowFilters: [],
  filterMatch: "all",
  groupBy: null,
});
