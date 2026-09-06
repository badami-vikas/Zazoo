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
  | "location"
  // Record metadata (TASK-063). DERIVED, never stored twice: the values come
  // from the Event log, so a Form or an inline edit has nothing to write to
  // them. Notion and Airtable both ship these as built-ins, and staleness
  // Automations, activity feeds and "recently edited" Views all need them.
  | "createdTime"
  | "createdBy"
  | "lastEditedTime"
  | "lastEditedBy";

/** The derived-metadata kinds, in one place so no surface re-lists them. */
export const METADATA_COLUMN_KINDS = [
  "createdTime",
  "createdBy",
  "lastEditedTime",
  "lastEditedBy",
] as const satisfies readonly ColumnKind[];

export type MetadataColumnKind = (typeof METADATA_COLUMN_KINDS)[number];

/** Is this column filled by the Event log rather than by anyone typing? */
export function isMetadataColumn(kind: ColumnKind): kind is MetadataColumnKind {
  return (METADATA_COLUMN_KINDS as readonly ColumnKind[]).includes(kind);
}

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
  /**
   * `kind: "formula"` — the row field holding the EXPRESSION, when the cell's
   * own field holds the computed VALUE. The fx affordance in the cell editor
   * toggles between the two (TASK-084); without this the editor has only a
   * value to edit and no expression, so fx is not offered.
   */
  expressionField?: string;
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

/**
 * A per-Organization patch over a shipped `TableSpec` (TASK-084).
 *
 * The Databases these specs describe ship WITH the application, so a column
 * rename is not a migration and must not pretend to be one: the base spec stays
 * the Module author's, and the user's edit is a separable, undoable overlay
 * resolved over it.
 *
 * `added` is expressible only where the row store can actually hold a column
 * the base spec never declared — a Module Database keeps its Records as
 * declared-column documents, so a new column has somewhere to put its values.
 * A store that cannot (the shipped sqlite-backed specs) reports adding
 * unavailable with that reason instead; a control that cannot act stays
 * visible and disabled rather than lying (ADR-001/ADR-247).
 */
export interface ColumnOverlay {
  /** Columns the user added, in the order they were added. Subject to the same
   * labels/kinds/locked/removed entries as any other column, so a rename or a
   * delete needs no second code path. `position` places the column beside an
   * existing one — without it, it lands at the end. */
  added?: {
    id: string;
    label: string;
    kind: ColumnKind;
    position?: { relativeTo: string; side: "left" | "right" };
  }[];
  /** columnId -> the label the user renamed it to. */
  labels?: Record<string, string>;
  /** columnId -> the kind the user changed it to. */
  kinds?: Record<string, ColumnKind>;
  /** Columns the user locked. This list is the whole truth: an id absent from a
   * PRESENT list is unlocked, so unlocking is expressible rather than sticky. */
  locked?: string[];
  /** Columns the user deleted. */
  removed?: string[];
  updatedAt?: string;
}

/**
 * Resolve an overlay over a base spec. Pure: the base is never mutated, and a
 * labels/kinds/locked/removed entry naming a column neither the spec nor
 * `added` has is inert — it can never invent a column, only describe one that
 * is already there.
 */
export function applyColumnOverlay(
  spec: TableSpec,
  overlay: ColumnOverlay | null | undefined,
): TableSpec {
  if (!overlay) return spec;
  const removed = new Set(overlay.removed ?? []);
  const locked = overlay.locked ? new Set(overlay.locked) : null;
  const resolved = [...spec.columns];
  const seen = new Set(spec.columns.map((column) => column.id));
  for (const { id, label, kind, position } of overlay.added ?? []) {
    // An added id colliding with a column already resolved would render twice
    // and write to one cell. The base spec wins; the server refuses the
    // collision at the edge, and this keeps a hand-edited overlay from one.
    if (seen.has(id)) continue;
    seen.add(id);
    const anchor = position ? resolved.findIndex((column) => column.id === position.relativeTo) : -1;
    const entry = { id, label, kind, editable: true };
    // Placement runs BEFORE removal, so a column added beside one the user
    // later deleted keeps its place among what is left. An anchor the spec
    // never had lands the column at the end rather than dropping it: losing a
    // column is worse than losing its place.
    if (anchor < 0) resolved.push(entry);
    else resolved.splice(position!.side === "left" ? anchor : anchor + 1, 0, entry);
  }
  return {
    ...spec,
    columns: resolved
      // Removal is applied FIRST: otherwise a deleted column comes back wearing
      // the label a rename in the same overlay gave it.
      .filter((column) => !removed.has(column.id))
      .map((column) => ({
        ...column,
        label: overlay.labels?.[column.id] ?? column.label,
        kind: overlay.kinds?.[column.id] ?? column.kind,
        ...(locked ? { locked: locked.has(column.id) } : {}),
      })),
  };
}

export const defaultViewConfig = (id: string, kind: ViewKind = "table"): ViewConfig => ({
  id,
  kind,
  sorts: [],
  rowFilters: [],
  filterMatch: "all",
  groupBy: null,
});
