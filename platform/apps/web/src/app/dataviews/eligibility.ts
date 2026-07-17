/**
 * View-switcher eligibility (ADR-023 item 6: "every table-backed entity is
 * convertible to kanban + card always, calendar when a date column exists,
 * map when a location column exists, graph when a relation column exists —
 * eligibility computed from column kinds").
 *
 * `compileBlueprint` (packages/core, owned by a concurrent session this pass)
 * does not yet expose this computation, and `@bridge/tables`' `ColumnKind`
 * has no dedicated "location" kind — so this stays a client-side heuristic
 * over the columns a view already receives, mirrored locally per CLAUDE.md's
 * "mirror it locally in apps/web" guidance (see OnboardingDialog.tsx's
 * REGISTERED_NODE_TYPES for the precedent). Table/kanban/gallery ("card") are
 * unconditionally eligible for any table-backed spec; calendar/map/network
 * are gated on the spec actually carrying a column that could plausibly drive
 * them, so the switcher never offers a view that would only ever render an
 * empty/broken state.
 */
import type { ColumnSpec, TableSpec, ViewConfig } from "@bridge/tables";

/** Column ids/labels that plausibly carry a location — no geocoding, just a
 * name-based heuristic. A real "location" ColumnKind is the honest long-term
 * fix (would live in @bridge/tables, out of this session's lane). */
const LOCATION_HINTS = ["location", "address", "city", "region", "country", "lat", "lng", "latitude", "longitude", "place"];

function isLocationColumn(col: ColumnSpec): boolean {
  const haystack = `${col.id} ${col.label}`.toLowerCase();
  return LOCATION_HINTS.some((hint) => haystack.includes(hint));
}

function hasDateColumn(columns: ColumnSpec[]): boolean {
  return columns.some((c) => c.kind === "date");
}

function hasLocationColumn(columns: ColumnSpec[]): boolean {
  return columns.some((c) => isLocationColumn(c));
}

function hasRelationColumn(columns: ColumnSpec[]): boolean {
  return columns.some((c) => c.kind === "relation");
}

/**
 * Always-eligible kinds for any table-backed spec, plus the conditional ones
 * this spec's columns actually support. Order matches the canonical morph
 * order registry.ts documents (table, kanban, card/gallery, then conditional
 * calendar/map/graph, then form last — it is an input surface, not a display
 * format, but is always eligible per the UI architecture spec AP-011).
 */
export function computeEligibleKinds(spec: TableSpec, isRelationship = false): ViewConfig["kind"][] {
  if (isRelationship) {
    // Grammar restriction unchanged (docs/wiki/vision.md: relationship views
    // are graph OR table ONLY) — this function still reports both truthfully
    // rather than special-casing relationships to a fixed list, so a future
    // relationship-shaped spec that also carries a date/location column isn't
    // silently under-reported. DataViews.tsx applies the graph|table filter.
    return ["table", "network"];
  }

  const kinds: ViewConfig["kind"][] = ["table", "kanban", "gallery"];
  if (hasDateColumn(spec.columns)) kinds.push("calendar");
  if (hasLocationColumn(spec.columns)) kinds.push("map");
  if (hasRelationColumn(spec.columns)) kinds.push("network");
  // Form is always offered for any table-backed entity spec — it is the standard
  // new-row input surface (UI architecture canon AP-011, "Form view").
  kinds.push("form");
  return kinds;
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
