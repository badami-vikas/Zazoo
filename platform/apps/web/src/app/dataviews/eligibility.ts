import {
  defaultViewConfig,
  normalizeViewKind,
  type ColumnSpec,
  type TableSpec,
  type ViewConfig,
  type ViewKind,
} from "@bridge/tables";

function isParentRelation(spec: TableSpec, column: ColumnSpec): boolean {
  return (
    column.kind === "relation" &&
    (column.relationParent === true || column.relationTarget === spec.id)
  );
}

function driverColumn(spec: TableSpec, kind: ViewKind): ColumnSpec | undefined {
  if (kind === "board") return spec.columns.find((column) => column.kind === "select");
  if (kind === "calendar") return spec.columns.find((column) => column.kind === "date");
  if (kind === "map") return spec.columns.find((column) => column.kind === "location");
  if (kind === "tree") return spec.columns.find((column) => isParentRelation(spec, column));
  if (kind === "graph") {
    return spec.columns.find(
      (column) => column.kind === "relation" && !isParentRelation(spec, column),
    );
  }
  return undefined;
}

export function computeEligibleKinds(spec: TableSpec, _legacyRelationshipFlag = false): ViewKind[] {
  const kinds: ViewKind[] = ["table"];
  if (driverColumn(spec, "board")) kinds.push("board");
  kinds.push("gallery", "form");
  if (driverColumn(spec, "calendar")) kinds.push("calendar");
  if (driverColumn(spec, "map")) kinds.push("map");
  if (driverColumn(spec, "graph")) kinds.push("graph");
  if (driverColumn(spec, "tree")) kinds.push("tree");
  return kinds;
}

export function viewConfigForKind(
  spec: TableSpec,
  kind: ViewKind,
  current?: Partial<ViewConfig>,
): ViewConfig {
  const base = defaultViewConfig(current?.id ?? `${spec.id}:${kind}`, kind);
  const next: ViewConfig = {
    ...base,
    ...current,
    id: current?.id ?? `${spec.id}:${kind}`,
    kind,
  };

  if (kind === "board") next.groupBy = next.groupBy ?? driverColumn(spec, kind)?.id ?? null;
  if (kind === "calendar") next.dateBy = next.dateBy ?? driverColumn(spec, kind)?.id;
  if (kind === "map") next.locationBy = next.locationBy ?? driverColumn(spec, kind)?.id;
  if (kind === "graph") {
    next.relationBy = next.relationBy ?? driverColumn(spec, kind)?.id;
    next.graphScope = next.graphScope ?? "single_database";
  }
  if (kind === "tree") next.parentBy = next.parentBy ?? driverColumn(spec, kind)?.id;
  if (kind !== "form") delete next.formDefaults;

  return next;
}

export function migrateViewConfig(spec: TableSpec, view: ViewConfig): ViewConfig | null {
  const kind = normalizeViewKind((view as { kind: unknown }).kind);
  return kind ? viewConfigForKind(spec, kind, view) : null;
}

/**
 * TASK-010 (docs/raw/ui-architecture-rules-2026-07.md §5d) — whether a
 * rendered cell/bullet value is "eligible" for the platform Red Flag control.
 * Mirrors TableView.tsx's own emptiness check (`formatCell`'s "—" fallback)
 * so eligibility never drifts from what's actually shown: an empty/absent
 * value, a control/action element, or a column header is not a data value a
 * Human could meaningfully flag as incorrect.
 */
export function isFlaggableValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * TASK-010 review round-5 item 6 — the client-side mirror of the server's
 * `validateAnchorTarget` module allowlist (router.ts): a cell/bullet whose
 * derived `moduleId` isn't one of these is server-verified to ALWAYS fail
 * `redFlag.create` with `NOT_FOUND` (fail-closed for an unrecognized
 * module), so rendering an interactive-looking flag glyph there would be a
 * control that can never actually work (AP-021: "interactive-looking UI
 * must open detail/edit/filter/explanation/governed Action" — one that
 * always errors violates this just as much as one that does nothing).
 * `WorkspacePage.tsx` currently also renders a `"signal"` node type through
 * `TableView` — Signals have no backing existence-check store yet, so
 * `"signal"` is deliberately NOT in this list until one exists.
 */
const SUPPORTED_RED_FLAG_MODULES = new Set(["jobpilot", "job-pilot", "dealpilot", "initiative", "touchpoint", "person", "people", "community", "communities"]);
export function isSupportedRedFlagModule(moduleId: string): boolean {
  return SUPPORTED_RED_FLAG_MODULES.has(moduleId);
}

/**
 * TASK-010 review remediation item 5 — the coarser Module identity a
 * Red Flag's `moduleId` field expects, distinct from the concrete
 * Database/table identity (`TableSpec.id`, e.g. "jobpilot.jobs"). `TableSpec`
 * has no separate Module field yet, so this derives it from the
 * dot-namespaced convention every real `TableSpec.id` already follows
 * ("jobpilot.jobs" -> "jobpilot"); a spec with no dot (e.g. "people") is its
 * own Module. NEVER pass `databaseId` itself as `moduleId` — the anchor's
 * `databaseId` field carries the exact table identity already.
 */
export function moduleIdFromDatabaseId(databaseId: string): string {
  const dot = databaseId.indexOf(".");
  return dot > 0 ? databaseId.slice(0, dot) : databaseId;
}
