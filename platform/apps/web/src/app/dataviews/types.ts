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
import type {
  ColumnDependencyPreview,
  ColumnSchemaCapability,
  ColumnTypeName,
} from "../components/shared/StandardColumnMenu.js";

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
  /**
   * Why this surface cannot create a Record by hand. §3a: the add-row is part
   * of the table's shape and ALWAYS renders — a surface that simply omitted it
   * left the user comparing two Modules and finding one silently missing a
   * control (user report 2026-08-10: "I dont see the Add row option in few
   * tabes and in some it is present. I want the UI elements same for all
   * modules and only the data displayed should be different."). Without
   * `onInsert` the row renders disabled and states this reason.
   */
  insertDisabledReason?: string;
  /**
   * Open the new-Record page (TASK-083). Supplied by <DataViews>, which owns
   * the page — a view raises the intent, it does not build a create surface of
   * its own, which is how the table came to have one shape and the Form view
   * another.
   */
  onRequestCreate?: () => void;
  onUpdate?: (rowId: string, patch: Partial<DataRow>) => void | Promise<void>;
  canUpdateRow?: (row: DataRow) => boolean;
  /**
   * The ONE delete path, single and bulk alike.
   *
   * It takes a LIST on purpose. C-12's constraint is that a bulk action obeys
   * the same governance as its single-Record form, and the cheapest way to
   * guarantee that is to have no single-Record form to diverge from: the row
   * caret's Delete calls this with one id. The caller routes it through the
   * governed pipeline once per id, so N Records produce N decisions in the
   * ledger — never one thinner batch write.
   */
  onDeleteRows?: (rowIds: string[]) => void | Promise<void>;
  /** Why this surface cannot delete (§3a/AP-021) — the control states it rather
   *  than vanishing. */
  deleteDisabledReason?: string;
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
  /**
   * The governed schema-mutation capability (TASK-084), as the SERVER reported
   * it plus the handlers that route each command back to it. Absent means the
   * surface never asked, and `StandardColumnMenu` says exactly that on the
   * disabled item rather than inventing a reason.
   */
  columnSchema?: ColumnSchemaActions;
}

export interface ColumnSchemaActions {
  capability: ColumnSchemaCapability | null;
  rename?: (columnId: string, label: string) => Promise<void>;
  changeType?: (columnId: string, kind: ColumnTypeName) => Promise<void>;
  /** Add a column to this Database. Present only where the server said the row
   * store can hold one (`capability.canAddColumn`). */
  addColumn?: (
    columnId: string,
    label: string,
    kind: ColumnTypeName,
    position?: { relativeTo: string; side: "left" | "right" },
  ) => Promise<void>;
  setLocked?: (columnId: string, locked: boolean) => Promise<void>;
  remove?: (columnId: string) => Promise<void>;
  preview?: (columnId: string) => Promise<ColumnDependencyPreview>;
  undo?: () => Promise<void>;
}

export type { GraphScope, RowFilter, SortSpec, TableSpec, ViewConfig };
