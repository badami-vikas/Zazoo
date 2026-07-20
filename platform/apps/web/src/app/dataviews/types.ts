/**
 * <DataViews> shared types — the props every registered view component takes.
 * Built directly against @bridge/tables' TableSpec/ViewConfig (the un-consumed
 * foundation this shell is the first real consumer of), NOT against
 * @bridge/core's structurally-mirrored Blueprint* types — a compiled
 * CompiledOrganization's tableSpecs/viewConfigs are drop-in compatible with these
 * (see packages/core/src/blueprint.ts's header comment), so OrganizationPage can
 * pass them straight through without a cast.
 */
import type { GraphScope, RowFilter, SortSpec, TableSpec, ViewConfig } from "@bridge/tables";

/** A single data row — deliberately loose (Record<string, unknown>), same shape
 * @bridge/tables' engine.ts (applyFilters/applySorts/groupBy) already assumes. */
export type DataRow = Record<string, unknown>;

export interface GraphDatabase {
  id: string;
  label: string;
  moduleId: string;
}

export interface GraphNode {
  id: string;
  recordId?: string;
  label: string;
  databaseId: string;
  databaseLabel: string;
  moduleId: string;
  recordType?: string;
  subtitle?: string;
  recordPath?: string;
  actionKind?: "signal";
  provenance?: string;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  relationType: string;
  evidence?: string;
  sourceModule?: string;
  recordPath?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  databases: GraphDatabase[];
  hasMore?: boolean;
}

/** Props every registered view component receives. `view.kind` is guaranteed
 * (by the registry lookup in DataViews.tsx) to be the kind the component was
 * registered under — a BoardView never receives a "calendar" ViewConfig. */
export interface DataViewProps {
  spec: TableSpec;
  view: ViewConfig;
  data: DataRow[];
  /** Fired when the user edits sorts/filters/groupBy/columns from within a view
   * (e.g. clicking a column header to sort). DataViews merges the patch into
   * the current ViewConfig and calls the shell's own onViewChange. */
  onViewChange: (next: ViewConfig) => void;
  /** Fired by FormView when the user submits a new row. The caller is responsible
   * for routing this through the governed pipeline (e.g. action.propose). Absent
   * for read-only views — FormView disables its submit button when not provided. */
  onInsert?: (draft: Partial<DataRow>) => void | Promise<void>;
  onUpdate?: (rowId: string, patch: Partial<DataRow>) => void | Promise<void>;
  canUpdateRow?: (row: DataRow) => boolean;
  onDelete?: (rowId: string) => void | Promise<void>;
  onDuplicate?: (row: DataRow) => void | Promise<void>;
  onPin?: (rowId: string) => void | Promise<void>;
  onOpenRecord?: (row: DataRow | GraphNode) => void;
  onEditRecord?: (row: DataRow) => void;
  onOpenRelation?: (edge: GraphEdge) => void;
  onInvokeNodeAction?: (node: GraphNode) => void;
  onProposeTreeMove?: (rowId: string, parentId: string | null) => void | Promise<void>;
  graphData?: GraphData;
  graphLoading?: boolean;
  graphError?: string | null;
  onGraphScopeChange?: (scope: GraphScope, databaseIds: string[]) => void;
  onLoadMoreGraph?: () => void;
  formRecord?: DataRow | null;
  onRequestFilter?: (columnId: string) => void;
  onHideColumn?: (columnId: string) => void;
}

export type { GraphScope, RowFilter, SortSpec, TableSpec, ViewConfig };
