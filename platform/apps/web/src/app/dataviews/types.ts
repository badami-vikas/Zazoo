/**
 * <DataViews> shared types — the props every registered view component takes.
 * Built directly against @bridge/tables' TableSpec/ViewConfig (the un-consumed
 * foundation this shell is the first real consumer of), NOT against
 * @bridge/core's structurally-mirrored Blueprint* types — a compiled
 * CompiledWorkspace's tableSpecs/viewConfigs are drop-in compatible with these
 * (see packages/core/src/blueprint.ts's header comment), so WorkspacePage can
 * pass them straight through without a cast.
 */
import type { RowFilter, SortSpec, TableSpec, ViewConfig } from "@bridge/tables";

/** A single data row — deliberately loose (Record<string, unknown>), same shape
 * @bridge/tables' engine.ts (applyFilters/applySorts/groupBy) already assumes. */
export type DataRow = Record<string, unknown>;

/** Props every registered view component receives. `view.kind` is guaranteed
 * (by the registry lookup in DataViews.tsx) to be the kind the component was
 * registered under — a KanbanView never receives a "calendar" ViewConfig. */
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
}

export type { RowFilter, SortSpec, TableSpec, ViewConfig };
