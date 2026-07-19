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
import {
  VIEW_KINDS,
  type TableSpec,
  type ViewConfig,
  type ViewKind,
} from "@bridge/tables";
import {
  CalendarDays,
  Columns3,
  Images,
  ListTree,
  Map,
  Network,
  Rows3,
  TextCursorInput,
  type LucideIcon,
} from "lucide-react";
import type { DataViewProps } from "./types.js";
import { TableView } from "./views/TableView.js";
import { BoardView } from "./views/BoardView.js";
import { CalendarView } from "./views/CalendarView.js";
import { GalleryView } from "./views/GalleryView.js";
import { GraphView } from "./views/GraphView.js";
import { MapView } from "./views/MapView.js";
import { FormView } from "./views/FormView.js";
import { TreeView } from "./views/TreeView.js";
import { computeEligibleKinds } from "./eligibility.js";

/** Exactly @bridge/tables' ViewConfig["kind"] — the data-view grammar. Dashboard/
 * chatbot/canvas (the blueprint's non-tabular views, see packages/core/src/
 * blueprint.ts) are NOT @bridge/tables-backed and are registered separately by
 * DashboardView's own small registry below; <DataViews> itself only renders
 * TableSpec-shaped data views. */
export const VIEW_COMPONENT_REGISTRY: Record<ViewConfig["kind"], ComponentType<DataViewProps>> = {
  table: TableView,
  board: BoardView,
  gallery: GalleryView,
  form: FormView,
  calendar: CalendarView,
  map: MapView,
  graph: GraphView,
  tree: TreeView,
};

export interface ViewMetadata {
  kind: ViewKind;
  label: string;
  icon: LucideIcon;
}

export const VIEW_METADATA: Record<ViewKind, ViewMetadata> = {
  table: { kind: "table", label: "Table", icon: Rows3 },
  board: { kind: "board", label: "Board", icon: Columns3 },
  gallery: { kind: "gallery", label: "Gallery", icon: Images },
  form: { kind: "form", label: "Form", icon: TextCursorInput },
  calendar: { kind: "calendar", label: "Calendar", icon: CalendarDays },
  map: { kind: "map", label: "Map", icon: Map },
  graph: { kind: "graph", label: "Graph", icon: Network },
  tree: { kind: "tree", label: "Tree", icon: ListTree },
};

export const REGISTERED_VIEW_KINDS: ViewKind[] = [...VIEW_KINDS];

export function isRegisteredViewKind(kind: string): kind is ViewConfig["kind"] {
  return Object.prototype.hasOwnProperty.call(VIEW_COMPONENT_REGISTRY, kind);
}

export function toolbarViewsForKinds(kinds: readonly ViewKind[]) {
  return kinds.map((kind) => ({
    id: kind,
    label: VIEW_METADATA[kind].label,
    icon: VIEW_METADATA[kind].icon,
  }));
}

export function toolbarViewsForSpec(spec: TableSpec) {
  return toolbarViewsForKinds(computeEligibleKinds(spec));
}
