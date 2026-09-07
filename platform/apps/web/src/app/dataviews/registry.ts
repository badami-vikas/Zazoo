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
  List,
  GanttChartSquare,
  BarChart3,
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
import { ListView } from "./views/ListView.js";
import { TimelineView } from "./views/TimelineView.js";
import { ChartView } from "./views/ChartView.js";
import { computeEligibleKinds } from "./eligibility.js";

/** Exactly @bridge/tables' ViewConfig["kind"] — the data-view grammar. Dashboard/
 * chatbot/canvas (the blueprint's non-tabular views, see packages/core/src/
 * blueprint.ts) are NOT @bridge/tables-backed and are registered separately by
 * DashboardView's own small registry below; <DataViews> itself only renders
 * TableSpec-shaped data views. */
/**
 * A View kind with no entry here has no renderer IN THIS BUILD. The map is
 * deliberately partial (2026-09-06): the grammar in @bridge/tables can name a
 * kind before its component exists, and the honest answer at that point is a
 * stated reason, not a crash or a silently missing option. `computeEligibleKinds`
 * filters against these keys, so an unrendered kind is never offered.
 */
export const VIEW_COMPONENT_REGISTRY: Partial<Record<ViewConfig["kind"], ComponentType<DataViewProps>>> = {
  table: TableView,
  board: BoardView,
  list: ListView,
  timeline: TimelineView,
  chart: ChartView,
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
  list: { kind: "list", label: "List", icon: List },
  timeline: { kind: "timeline", label: "Timeline", icon: GanttChartSquare },
  chart: { kind: "chart", label: "Chart", icon: BarChart3 },
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
