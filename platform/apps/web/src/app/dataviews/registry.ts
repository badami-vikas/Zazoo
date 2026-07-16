/**
 * ViewComponentRegistry — the grammar ENFORCEMENT POINT for <DataViews>
 * (docs/wiki/vision.md "View grammar": "Generation = configurations of
 * REGISTERED components only, never new components." `<DataViews>` shell =
 * enforcement point -> Phase-1 critical path).
 *
 * This is a plain `Record`, not a dynamic import/lazy-component-resolution
 * mechanism — on purpose. A blueprint's view.kind can only ever be one of the
 * kinds enumerated here; there is no code path that turns an arbitrary string
 * into a rendered component. An unregistered kind is a registry MISS, and
 * DataViews.tsx renders an explicit error boundary message for it rather than
 * attempting any fallback dynamic render.
 */
import type { ComponentType } from "react";
import type { ViewConfig } from "@bridge/tables";
import type { DataViewProps } from "./types.js";
import { TableView } from "./views/TableView.js";
import { KanbanView } from "./views/KanbanView.js";
import { CalendarView } from "./views/CalendarView.js";
import { GalleryView } from "./views/GalleryView.js";
import { GraphView } from "./views/GraphView.js";
import { MapView } from "./views/MapView.js";
import { FormView } from "./views/FormView.js";

/** Exactly @bridge/tables' ViewConfig["kind"] — the data-view grammar. Dashboard/
 * chatbot/canvas (the blueprint's non-tabular views, see packages/core/src/
 * blueprint.ts) are NOT @bridge/tables-backed and are registered separately by
 * DashboardView's own small registry below; <DataViews> itself only renders
 * TableSpec-shaped data views. */
export const VIEW_COMPONENT_REGISTRY: Record<ViewConfig["kind"], ComponentType<DataViewProps>> = {
  table: TableView,
  kanban: KanbanView,
  calendar: CalendarView,
  gallery: GalleryView,
  map: MapView, // no map-rendering library in this repo — honest grouped-by-location list fallback (ADR-023, docs/BUGS.md)
  network: GraphView,
  /** Form view (UI architecture canon, AP-011): first-class standard view that collects
   * a new row; submission = direct insert through the caller-supplied onInsert hook,
   * which routes through action.propose / Learning Agent enrichment like every other
   * DB write. Always eligible for any table-backed spec (eligibility.ts). */
  form: FormView,
};

/** Registered kinds, in the canonical morph order the vision doc lists
 * ("table (morphable: calendar/kanban/map/graph/card)") — used to render the
 * view-switcher tabs in blueprint-declared order rather than object-key order.
 * "form" appears last: it is an input surface, not a data display format. */
export const REGISTERED_VIEW_KINDS: ViewConfig["kind"][] = ["table", "kanban", "calendar", "gallery", "map", "network", "form"];

export function isRegisteredViewKind(kind: string): kind is ViewConfig["kind"] {
  return kind in VIEW_COMPONENT_REGISTRY;
}
