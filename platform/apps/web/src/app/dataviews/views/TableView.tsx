/**
 * TableView — the ONE renderer for the `table` view kind (ADR-194).
 *
 * WHAT CHANGED. ADR-160/192/193 progressively moved this surface onto a canvas
 * grid (`glide-data-grid`) for virtualization, then spent ADR-182 hand-painting
 * the Avilo visual language back onto that canvas one primitive at a time. That
 * trade is now reversed: the table is a real DOM <table> again, styled directly,
 * with row windowing supplied by `@tanstack/react-virtual` (already a dependency
 * — see ChatsSurface.tsx) instead of by the renderer's choice of substrate.
 *
 * WHY. Canvas cannot use CSS, so every visual affordance had to be re-drawn by
 * hand and several could not be reproduced at all: the aggregate footer and
 * right-aligned numerics were reported as permanently open in ADR-182, and the
 * rich `renderCell` glyphs (badge pills, meter bars, RAG dots) degraded to flat
 * text. Meanwhile the virtualization those losses bought was never exercised —
 * every page in the shell pages at 25–50 rows, and ADR-192 recorded that the
 * canvas renderer had not rendered once in production before the threshold was
 * dropped to 0. DOM + windowing gives the visual fidelity AND the scale, so
 * there is nothing left to trade.
 *
 * WINDOWING IS NOT A SECOND RENDERER. ADR-160's mistake was a row-count
 * threshold that switched *renderers*, so the feature set silently changed with
 * the size of the result set. Here the threshold switches only whether the rows
 * are windowed; the markup, the styling and every affordance are identical
 * either way, so the two paths cannot drift.
 *
 * PALETTE. Colours come from Bridge tokens through inline `var(--color-*)`,
 * never from Avilo's hexes — the standing ADR-182 decision, and what keeps dark
 * mode working. Only geometry and typography are ported literally (40px rows,
 * 16px/10px cell padding, 13px body, 10px uppercase headers at 0.07em).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { applyFilters, applySorts, groupBy, isMetadataColumn, ROW_HEIGHT_PX } from "@bridge/tables";
import type { ColumnSpec, TableSpec, ViewConfig } from "@bridge/tables";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { StandardColumnMenu } from "../../components/shared/StandardColumnMenu.js";
import { StandardRowMenu } from "../../components/shared/StandardRowMenu.js";
import { TableSelectionBar } from "../../components/shared/TableSelectionBar.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import {
  EMPTY_SELECTION,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  LONG_PRESS_MS,
  isSelecting,
  reduceSelection,
  type SelectionEvent,
} from "../selection.js";
import { RedFlagControl } from "../../components/shared/RedFlagControl.js";
import { StandardCellMenu } from "../../components/shared/StandardCellMenu.js";
import { FormulaCellEditor } from "../../components/shared/FormulaCellEditor.js";
import { RedFlagProvider, useOptionalRedFlagContext } from "../../components/shared/RedFlagProvider.js";
import {
  isFlaggableValue,
  isSupportedRedFlagModule,
  moduleIdFromDatabaseId,
} from "../eligibility.js";
import type { DataRow, DataViewProps } from "../types.js";
import { formatCell, formatCurrency, renderCell, trimZero } from "../cell-format.js";
import type { CellContext } from "../cell-format.js";
import {
  CellEditor,
  coerceCellValue,
  isCellEditable,
  uneditableReason,
} from "../cell-editor.js";
import { columnIdFromLabel } from "../columnId.js";
import { useDismiss } from "../../lib/useDismiss";
import {
  AGGREGATE_LABELS,
  availableAggregates,
  computeAggregate,
  defaultAggregate,
  type AggregateKind,
} from "../aggregate.js";

/**
 * The grid's geometry, in PIXELS rather than Tailwind spacing utilities.
 *
 * `globals.css` sets `html { font-size: 17px }`, so every rem-based Tailwind
 * unit in this app renders 6.25% larger than its name suggests — `h-10` is
 * 42.5px, `px-4` is 17px. That is fine for prose-scaled chrome and wrong for a
 * data grid, where the row height is a hard contract: the windowing estimate
 * has to match the real height, and a 40px row is the rhythm every other
 * measurement here (and the Avilo reference) is tuned to. So the numbers that
 * must be exact are set as pixels and the utilities are used only where a
 * proportional value is genuinely wanted.
 */
const ROW_HEIGHTS = ["short", "medium", "tall"] as const;
const HEADER_HEIGHT = 36;
/** Width assumed for a column the spec never sized, when a FROZEN column's
 *  sticky offset needs a real number. */
const DEFAULT_COL_WIDTH = 180;
/** The leading selection column: a 16px box inside `px-2`. */
const SELECT_COL_WIDTH = 32;
/** Narrower than a finger, so it is a pointer affordance and nothing else. */
const RESIZE_HANDLE_WIDTH = 6;
/** Blank body rows drawn at zero records so an empty table still reads as a
 *  table (grid rhythm, footer, add-row) rather than collapsing to a note. */
const EMPTY_FILLER_ROWS = 3;
/** Avilo's `px-4`, in real pixels. */
const CELL_PAD_X = 16;

/**
 * Above this many rows the body is windowed.
 *
 * Deliberately well above any page's real page size, so the common case renders
 * a plain, fully-semantic table with every row in the DOM (searchable by the
 * browser's own find, and readable by a screen reader in one pass). Windowing is
 * the exception for a genuinely large result set, not the default posture.
 */
const VIRTUALIZE_ABOVE = 100;

/** How long a click waits to discover whether it is half of a double-click.
 *
 * Ported from Avilo. Without it the first click of a double-click opens the
 * record, the row unmounts, and the second click lands on a surface that has
 * already replaced the table — which reads as "double-click does nothing".
 * `stopPropagation` on the dblclick handler cannot help: by then the open has
 * already been requested. Uniform across every cell on purpose; exempting
 * read-only cells makes the row open instantly in some columns and after a beat
 * in others, which reads as lag rather than as a rule. */
const DOUBLE_CLICK_GRACE_MS = 220;

function isNumericColumn(col: ColumnSpec): boolean {
  return (
    col.kind === "number" ||
    col.kind === "autoNumber" ||
    col.display === "currency" ||
    col.display === "multiple"
  );
}

/**
 * The spec's columns in the order the USER put them (`ViewConfig.columnOrder`).
 * Ids the order names but the spec no longer has are inert, and a column the
 * order has never heard of keeps its spec position at the end — a reordered
 * View must not lose a column the Module later added.
 */
function orderColumns(columns: ColumnSpec[], order: string[] | undefined): ColumnSpec[] {
  if (!order || order.length === 0) return columns;
  const known = new Map(columns.map((col) => [col.id, col]));
  const ordered = order.map((id) => known.get(id)).filter((col): col is ColumnSpec => Boolean(col));
  const seen = new Set(ordered.map((col) => col.id));
  return [...ordered, ...columns.filter((col) => !seen.has(col.id))];
}

/** One row of the body, or the header of a group of them. */
type RenderItem =
  | { type: "row"; row: DataRow; index: number }
  | { type: "group"; id: string; label: string; count: number; depth: number; collapsed: boolean };

/** How a column's aggregate result is written back out, in the column's own unit. */
function aggregateFormatter(col: ColumnSpec): ((value: number) => string) | undefined {
  if (col.display === "currency") return formatCurrency;
  if (col.display === "multiple") return (n) => `${trimZero(n)}×`;
  if (col.display === "meter") return (n) => `${Math.round(n)}%`;
  return undefined;
}

export function TableView({
  spec,
  view,
  data,
  onViewChange,
  onInsert,
  insertDisabledReason,
  onRequestCreate,
  onUpdate,
  onOpenRecord,
  onEditRecord,
  canUpdateRow,
  onDuplicate,
  onPin,
  onRequestFilter,
  onHideColumn,
  onDeleteRows,
  deleteDisabledReason,
  columnSchema,
}: DataViewProps) {
  const filtered = useMemo(
    () => applyFilters(data, view.rowFilters, view.filterMatch),
    [data, view.rowFilters, view.filterMatch],
  );
  const sorted = useMemo(() => applySorts(filtered, view.sorts), [filtered, view.sorts]);

  /**
   * EVERY grid mechanic below is VIEW CONFIG, never local state (TASK-109).
   * A width dragged, a column moved, a group collapsed or a summary chosen has
   * to survive a reload of the saved List — holding any of it in `useState`
   * would make the table forget the moment the user navigated away.
   */
  const patchView = useCallback(
    (next: Partial<ViewConfig>) => onViewChange({ ...view, ...next }),
    [onViewChange, view],
  );
  const columns = useMemo(
    () => orderColumns(spec.columns, view.columnOrder),
    [spec.columns, view.columnOrder],
  );
  const rowHeightKey = view.rowHeight ?? "short";
  const rowPx = ROW_HEIGHT_PX[rowHeightKey];
  const wrapCells = view.wrapCells === true;
  const collapsedGroups = view.collapsedGroups ?? [];
  const frozenIndex = view.frozenColumnId
    ? columns.findIndex((col) => col.id === view.frozenColumnId)
    : -1;

  /** The width a column renders at: the user's drag, else the spec's, else auto. */
  const widthOf = useCallback(
    (col: ColumnSpec): number | undefined => view.columnWidths?.[col.id] ?? col.width,
    [view.columnWidths],
  );

  /** The in-flight resize. Local ONLY while the pointer is down; the result is
   *  written to the view on release, so the drag does not re-render the shell
   *  on every pixel. */
  const [resizing, setResizing] = useState<{
    columnId: string;
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);
  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: PointerEvent) =>
      setResizing((current) =>
        current
          ? { ...current, width: Math.max(64, current.startWidth + (event.clientX - current.startX)) }
          : current,
      );
    const onUp = () => {
      setResizing((current) => {
        if (current) {
          patchView({
            columnWidths: { ...(view.columnWidths ?? {}), [current.columnId]: Math.round(current.width) },
          });
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizing, patchView, view.columnWidths]);

  const renderWidth = (col: ColumnSpec): number | undefined =>
    resizing?.columnId === col.id ? Math.round(resizing.width) : widthOf(col);

  /** A frozen column's sticky offset needs a real number for every column to
   *  its left, so a frozen column is always given a concrete width. */
  const frozenLeft = (colIndex: number): number | undefined => {
    if (colIndex > frozenIndex) return undefined;
    let left = SELECT_COL_WIDTH;
    for (let i = 0; i < colIndex; i += 1) {
      left += renderWidth(columns[i]!) ?? DEFAULT_COL_WIDTH;
    }
    return left;
  };

  /** The header being dragged to a new position, or null. */
  const [dragColumnId, setDragColumnId] = useState<string | null>(null);
  const dropColumn = (targetId: string) => {
    if (!dragColumnId || dragColumnId === targetId) return;
    const ids = columns.map((col) => col.id).filter((id) => id !== dragColumnId);
    ids.splice(ids.indexOf(targetId), 0, dragColumnId);
    setDragColumnId(null);
    patchView({ columnOrder: ids });
  };

  const toggleGroup = (id: string) =>
    patchView({
      collapsedGroups: collapsedGroups.includes(id)
        ? collapsedGroups.filter((entry) => entry !== id)
        : [...collapsedGroups, id],
    });

  const moduleId = moduleIdFromDatabaseId(spec.id);
  // A Module the server cannot validate targets for (e.g. "signal" — no backing
  // existence-check store yet) must never render an interactive-looking flag
  // glyph, since redFlag.create would fail-closed on every attempt (AP-021).
  const flaggable = isSupportedRedFlagModule(moduleId);

  const [editing, setEditing] = useState<{ key: string; col: string } | null>(null);
  /** Open cell right-click menu (§5f), or null. Position is the pointer. */
  const [cellMenu, setCellMenu] = useState<CellMenuState | null>(null);
  /**
   * NO DRAFT ROW ANY MORE (TASK-083, C-34 under AP-168/ADR-258). New used to
   * append a blank row here and collect the Record cell by cell — C-33, now
   * REVERSED: New opens the Database's Record page with every field on it, and
   * nothing is written until Save. The table raises the intent; <DataViews>
   * owns the page, so the Form view and the table cannot grow two different
   * create surfaces again.
   */
  const addRowReasonId = useId();
  /**
   * Why New cannot act, or null when it can. Honest default: the surface has no
   * create path wired, and saying so beats a control that vanishes. Pages that
   * know the real reason pass it.
   */
  const createReason = !onInsert
    ? (insertDisabledReason ??
      "This Database has no create path wired yet, so Records cannot be added by hand here.")
    : !onRequestCreate
      ? "This table is rendered outside the shell that owns the Record page, so New has nowhere to open."
      : null;

  /**
   * MULTI-SELECT (C-12). The state is a value, not a set of booleans scattered
   * across handlers — every transition goes through `reduceSelection`, which is
   * where the finger-lift swallow lives and the only part of this that a
   * headless test can drive.
   */
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const selecting = isSelecting(selection);
  /**
   * Dispatch, and report whether the caller should still open the Record.
   *
   * A ref mirror rather than `setSelection(updater)`: React does not run a
   * functional updater synchronously, so the outcome could not be read back in
   * the same handler — and the long-press timer fires ~500ms after the render
   * whose `selection` its closure captured, which is long enough for that
   * closure to be stale.
   */
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const dispatchSelection = useCallback((event: SelectionEvent): boolean => {
    const outcome = reduceSelection(selectionRef.current, event);
    selectionRef.current = outcome.state;
    setSelection(outcome.state);
    return outcome.open;
  }, []);
  // Escape clears, on every table (C-12: "Escape-to-clear behave identically on
  // every surface"). Bound to the document rather than the table so it works
  // while focus sits in the action bar.
  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(EMPTY_SELECTION);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting]);

  /** The in-flight hold: its timer, and where the finger started, so a scroll
   *  cancels it rather than selecting a row the user was swiping past. */
  const longPress = useRef<{
    timer: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
  } | null>(null);
  const cancelLongPress = useCallback(() => {
    if (longPress.current === null) return;
    clearTimeout(longPress.current.timer);
    longPress.current = null;
  }, []);
  useEffect(() => cancelLongPress, [cancelLongPress]);

  /**
   * The ONE delete path. The row caret's Delete, the cell menu's Delete row and
   * the action bar's "Delete N" all land here with a list of ids — there is no
   * single-Record variant to drift from the bulk one, which is what the
   * Constraint on this work asks for. The server issues one governed decision
   * per id (see `relationship.archiveRecords`).
   */
  const deleteRows = useMemo(
    () => (onDeleteRows ? (ids: string[]) => onDeleteRows(ids) : undefined),
    [onDeleteRows],
  );

  // A pending row-open, held back long enough for a second click to cancel it.
  const pendingOpen = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPendingOpen = useCallback(() => {
    if (pendingOpen.current === null) return;
    clearTimeout(pendingOpen.current);
    pendingOpen.current = null;
  }, []);
  // Navigating away unmounts this mid-timer; without the cleanup the callback
  // still fires and pushes a route the user has already left.
  useEffect(() => cancelPendingOpen, [cancelPendingOpen]);

  // A state ref, not `useRef`: the virtualizer reads its scroll element during
  // render, and a `useRef` is still null on the first one. Nothing re-renders
  // when a ref is later populated, so the virtualizer would keep the viewport
  // height it measured against nothing — it rendered a fixed dozen rows and
  // ignored scrolling entirely. Setting state on attach forces the re-render
  // that lets it measure the real element.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const windowed = sorted.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowPx,
    overscan: 12,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Spacer rows rather than absolute positioning: it keeps a real <table> with
  // real <tr> children, so sticky thead/tfoot, colgroup widths and aria-sort all
  // keep working. Absolute positioning would require faking every one of them.
  /**
   * GROUPING (TASK-109). `groupBy` is `@bridge/tables`' own bucketer — the same
   * one the Board view groups with, so a group is one thing across the app.
   *
   * A grouped body is NOT windowed: the group headers make the row heights
   * uneven, which is exactly the assumption the virtualizer's fixed estimate
   * rests on. Grouping a result set large enough to need windowing is the case
   * to revisit if it ever shows up.
   * ponytail: unwindowed while grouped; measure rows if a grouped table gets big.
   */
  const groupedItems = useMemo((): RenderItem[] | null => {
    if (!view.groupBy) return null;
    const items: RenderItem[] = [];
    let index = 0;
    for (const [key, rows] of groupBy(sorted, view.groupBy)) {
      const collapsed = collapsedGroups.includes(key);
      items.push({ type: "group", id: key, label: key, count: rows.length, depth: 0, collapsed });
      if (collapsed) {
        index += rows.length;
        continue;
      }
      if (!view.subGroupBy) {
        for (const row of rows) items.push({ type: "row", row, index: index++ });
        continue;
      }
      for (const [subKey, subRows] of groupBy(rows, view.subGroupBy)) {
        const subId = `${key} / ${subKey}`;
        const subCollapsed = collapsedGroups.includes(subId);
        items.push({
          type: "group",
          id: subId,
          label: subKey,
          count: subRows.length,
          depth: 1,
          collapsed: subCollapsed,
        });
        if (subCollapsed) {
          index += subRows.length;
          continue;
        }
        for (const row of subRows) items.push({ type: "row", row, index: index++ });
      }
    }
    return items;
  }, [sorted, view.groupBy, view.subGroupBy, collapsedGroups]);

  const visible: RenderItem[] =
    groupedItems ??
    (windowed
      ? virtualItems.map((item) => ({
          type: "row" as const,
          row: sorted[item.index]!,
          index: item.index,
        }))
      : sorted.map((row, index) => ({ type: "row" as const, row, index })));
  const padded = windowed && !groupedItems && virtualItems.length > 0;
  const padTop = padded ? virtualItems[0]!.start : 0;
  const padBottom = padded
    ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end
    : 0;

  // +2: the leading selection checkbox column and the trailing row-actions
  // column. Both are part of the table's SHAPE (§3a) — the checkbox column is a
  // table capability, not a page opt-in, so it is always there and pointer users
  // enter multi-select through it.
  const colSpan = columns.length + 2;
  const canEditRow = (row: DataRow) => Boolean(onUpdate) && (!canUpdateRow || canUpdateRow(row));

  const table = (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Shared chrome (C-12): the bar is rendered by the ONE table renderer, so
          every table in the app gets the same count, Cancel and confirmation.
          It renders nothing at zero selected — C-13 forbids a resident delete. */}
      <TableSelectionBar
        count={selection.selected.length}
        onClear={() => setSelection(EMPTY_SELECTION)}
        {...(deleteRows ? { onDelete: () => deleteRows([...selection.selected]) } : {})}
        {...(deleteDisabledReason ? { deleteDisabledReason } : {})}
      />
    <div
      ref={setScrollEl}
      /* max-h-full, NOT h-full: the box is as tall as the table and no taller,
         capped at the height the shell gave it. With h-full a short table left
         dead space inside the border and the add-row + aggregate footer sat in
         the MIDDLE of the view (user report 2026-08-10: "Add record and column
         summary should appear at end of the view section, not middle"). The
         cap keeps the sticky header/footer working once the table is tall
         enough to scroll. */
      className="bridge-scroll max-h-full overflow-auto rounded-xl border"
      style={{ borderColor: "var(--color-border)", background: "var(--color-background)" }}
    >
      {/* A min-width makes the container scroll rather than squeezing columns
          until the row actions clip — these tables have more columns than a
          laptop viewport. At 375px it scrolls inside its own box (AP-081). */}
      <table className="w-full min-w-[860px] border-collapse text-[13px]">
        <thead className="sticky top-0 z-20">
          {/* Avilo's header uses bg-line-soft/60 (its <thead> isn't sticky, so
              translucency is free). Ours IS sticky (`top-0 z-20`) — a
              translucent header would show scrolling rows bleeding through
              underneath it, which is a real visual bug, not a cosmetic
              difference — so this one stays solid. */}
          <tr style={{ background: "var(--color-line-soft)" }}>
            <th
              scope="col"
              className={`w-px whitespace-nowrap px-2 ${frozenIndex >= 0 ? "sticky left-0 z-30" : ""}`}
              style={{
                height: HEADER_HEIGHT,
                background: "var(--color-line-soft)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span className="sr-only">Select rows</span>
            </th>
            {columns.map((col, colIndex) => {
              const activeSort = view.sorts.find((sort) => sort.id === col.id);
              const numeric = isNumericColumn(col);
              const left = frozenLeft(colIndex);
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={
                    activeSort ? (activeSort.dir === "asc" ? "ascending" : "descending") : "none"
                  }
                  // REORDER: the header is the handle. A drag lands the column
                  // before the header it was dropped on, and the result is
                  // written to `columnOrder` — not to local state, so the order
                  // is still there after a reload.
                  draggable
                  onDragStart={() => setDragColumnId(col.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropColumn(col.id)}
                  onDragEnd={() => setDragColumnId(null)}
                  style={{
                    position: "relative",
                    width: renderWidth(col),
                    ...(left === undefined
                      ? {}
                      : { position: "sticky", left, zIndex: 30 }),
                    ...(dragColumnId === col.id ? { opacity: 0.5 } : {}),
                    height: HEADER_HEIGHT,
                    paddingLeft: CELL_PAD_X,
                    paddingRight: CELL_PAD_X,
                    color: "var(--color-warm-gray)",
                    borderBottom: "1px solid var(--color-border)",
                    // COLUMN SEPARATORS (user report 2026-09-05: "I need
                    // vertical lines seperating columns"). The token is the
                    // same one the horizontal rules use, so light and dark
                    // stay consistent. The LAST column gets none: the sticky
                    // row-actions cell already draws that edge with its own
                    // borderLeft, and both would read as a double rule.
                    ...(colIndex < columns.length - 1
                      ? { borderRight: "1px solid var(--color-border)" }
                      : {}),
                  }}
                  className={`whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.07em] ${
                    numeric ? "text-right" : "text-left"
                  }`}
                >
                  {/* RESIZE: the column's own edge. A pointer affordance, so it
                      never competes with the header's right-click menu or with
                      the drag that reorders. */}
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${col.label}`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setResizing({
                        columnId: col.id,
                        startX: event.clientX,
                        startWidth:
                          renderWidth(col) ??
                          (event.currentTarget.parentElement?.getBoundingClientRect().width ??
                            DEFAULT_COL_WIDTH),
                        width: renderWidth(col) ?? DEFAULT_COL_WIDTH,
                      });
                    }}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      height: "100%",
                      width: RESIZE_HANDLE_WIDTH,
                      cursor: "col-resize",
                      touchAction: "none",
                    }}
                  />
                  <span
                    className={`inline-flex items-center gap-1 ${numeric ? "flex-row-reverse" : ""}`}
                  >
                    <StandardColumnMenu
                      label={col.label}
                      databaseBacked
                      // The column's own description IS the tooltip — a column
                      // that explains itself needs no explainer row (user
                      // directive 2026-09-06).
                      {...(col.description ? { description: col.description } : {})}
                      onFilter={() => onRequestFilter?.(col.id)}
                      onSort={(direction) =>
                        onViewChange({ ...view, sorts: [{ id: col.id, dir: direction }] })
                      }
                      onHide={onHideColumn ? () => onHideColumn(col.id) : undefined}
                      // GROUP (TASK-109). The menu's Group command was disabled
                      // on every column of every View because the table never
                      // passed this. Grouping by the column already grouped by
                      // ungroups, so the same command is the way back.
                      onGroup={() =>
                        patchView({ groupBy: view.groupBy === col.id ? null : col.id })
                      }
                      grouped={view.groupBy === col.id}
                      // Freeze / wrap / row height are VIEW settings reached
                      // from any column, the way Notion reaches them.
                      onFreeze={() =>
                        patchView({
                          frozenColumnId: view.frozenColumnId === col.id ? null : col.id,
                        })
                      }
                      frozen={view.frozenColumnId === col.id}
                      onToggleWrap={() => patchView({ wrapCells: !wrapCells })}
                      wrapped={wrapCells}
                      rowHeight={rowHeightKey}
                      onRowHeight={() =>
                        patchView({
                          rowHeight:
                            ROW_HEIGHTS[(ROW_HEIGHTS.indexOf(rowHeightKey) + 1) % ROW_HEIGHTS.length]!,
                        })
                      }
                      // TASK-084: the schema commands, routed to whatever the
                      // server said this surface may do. Absent `columnSchema`
                      // leaves every one of them visible and disabled with the
                      // menu's own stated reason.
                      columnId={col.id}
                      // A derived metadata column has no type to change TO
                      // (TASK-063), so the menu is told nothing rather than a
                      // kind its Change-type list does not contain.
                      {...(isMetadataColumn(col.kind) ? {} : { columnKind: col.kind })}
                      locked={col.locked}
                      capability={columnSchema?.capability ?? null}
                      onRename={
                        columnSchema?.rename
                          ? (label) => columnSchema.rename!(col.id, label)
                          : undefined
                      }
                      onChangeType={
                        columnSchema?.changeType
                          ? (kind, options) => columnSchema.changeType!(col.id, kind, options)
                          : undefined
                      }
                      onSetLocked={
                        columnSchema?.setLocked
                          ? (next) => columnSchema.setLocked!(col.id, next)
                          : undefined
                      }
                      onDelete={
                        columnSchema?.remove ? () => columnSchema.remove!(col.id) : undefined
                      }
                      onAddColumn={
                        columnSchema?.addColumn
                          ? (column, side) =>
                              columnSchema.addColumn!({
                                columnId: columnIdFromLabel(column.label, spec.columns),
                                label: column.label,
                                kind: column.kind,
                                ...(column.options.length > 0 ? { options: column.options } : {}),
                                position: { relativeTo: col.id, side },
                              })
                          : undefined
                      }
                      // DUPLICATE (TASK-109): the governed add-column path with
                      // this column's own type. Values are NOT copied — no
                      // server command copies a column's values, and the
                      // consequence line in the menu says so.
                      onDuplicateColumn={
                        columnSchema?.addColumn && !isMetadataColumn(col.kind)
                          ? (label) =>
                              columnSchema.addColumn!({
                                columnId: columnIdFromLabel(label, spec.columns),
                                label,
                                kind: col.kind as Parameters<
                                  NonNullable<typeof columnSchema.addColumn>
                                >[0]["kind"],
                                // The choices come with the type: duplicating a
                                // select that offered nothing would be the same
                                // empty chooser TASK-112 removed.
                                ...(col.options?.length ? { options: [...col.options] } : {}),
                                position: { relativeTo: col.id, side: "right" },
                              })
                          : undefined
                      }
                      onPreviewDelete={
                        columnSchema?.preview ? () => columnSchema.preview!(col.id) : undefined
                      }
                      onUndo={columnSchema?.undo}
                    />
                    {activeSort && (
                      <>
                        <ChevronDown
                          size={11}
                          aria-hidden="true"
                          className={activeSort.dir === "asc" ? "rotate-180" : undefined}
                          style={{ color: "var(--color-navy-mid)" }}
                        />
                        <span className="sr-only">
                          Sorted {activeSort.dir === "asc" ? "ascending" : "descending"}
                        </span>
                      </>
                    )}
                  </span>
                </th>
              );
            })}
            <th
              scope="col"
              className="bridge-sticky-cell sticky right-0 z-10 w-px whitespace-nowrap text-right text-[10px] font-semibold uppercase tracking-[0.07em]"
              style={{
                height: HEADER_HEIGHT,
                paddingLeft: CELL_PAD_X,
                paddingRight: CELL_PAD_X,
                color: "var(--color-warm-gray)",
                background: "var(--color-line-soft)",
                borderLeft: "1px solid var(--color-border)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <span className="sr-only">Row actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {padTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={colSpan} style={{ height: padTop, padding: 0 }} />
            </tr>
          )}

          {visible.map((item) => {
            if (item.type === "group") {
              return (
                <tr key={`group-${item.id}`} style={{ background: "var(--color-line-soft)" }}>
                  <td colSpan={colSpan} style={{ padding: 0 }}>
                    <button
                      type="button"
                      aria-expanded={!item.collapsed}
                      onClick={() => toggleGroup(item.id)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] font-semibold"
                      style={{
                        color: "var(--color-navy)",
                        paddingLeft: 12 + item.depth * 16,
                      }}
                    >
                      {item.collapsed ? (
                        <ChevronRight size={13} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={13} aria-hidden="true" />
                      )}
                      {item.label}
                      <span style={{ color: "var(--color-warm-gray)" }}>{item.count}</span>
                    </button>
                  </td>
                </tr>
              );
            }
            const { row, index } = item;
            // A red-flag anchor's recordId must be a STABLE persisted id — never
            // the sorted row's array index, which is meaningless once the table
            // is re-sorted and would silently mis-anchor an existing flag onto a
            // DIFFERENT row. A row with no real `id` is simply not flaggable.
            const stableRecordId =
              typeof row["id"] === "string" || typeof row["id"] === "number"
                ? String(row["id"])
                : null;
            const key = stableRecordId ?? String(index);
            const rowEditable = canEditRow(row);
            // Selection is keyed by the STABLE id for the same reason the red
            // flag anchor is: a sorted array index means nothing once the table
            // re-sorts, and a bulk delete keyed on one would delete the wrong
            // Records. A row without a stable id simply is not selectable.
            const selectable = stableRecordId !== null;
            const selected = selectable && selection.selected.includes(stableRecordId);

            return (
              <tr
                key={key}
                data-selected={selected ? "true" : undefined}
                // Long-press (C-12). The hold is cancelled by lift, by a drift
                // past the tolerance (that gesture is a scroll), and by the
                // browser stealing the touch — otherwise a scroll that happens
                // to pause selects whatever it started on.
                onTouchStart={
                  selectable
                    ? (event) => {
                        const touch = event.touches[0];
                        if (!touch) return;
                        cancelLongPress();
                        longPress.current = {
                          x: touch.clientX,
                          y: touch.clientY,
                          timer: setTimeout(() => {
                            longPress.current = null;
                            // A hold is never also an open: cancel the pending
                            // single-click open the same gesture scheduled.
                            cancelPendingOpen();
                            dispatchSelection({ type: "longPress", key: stableRecordId });
                          }, LONG_PRESS_MS),
                        };
                      }
                    : undefined
                }
                onTouchMove={(event) => {
                  const touch = event.touches[0];
                  const start = longPress.current;
                  if (!touch || !start) return;
                  if (
                    Math.abs(touch.clientX - start.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
                    Math.abs(touch.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX
                  ) {
                    cancelLongPress();
                  }
                }}
                onTouchEnd={cancelLongPress}
                onTouchCancel={cancelLongPress}
                // The height is DECLARED (`rowHeight`, three steps), not
                // emerged. The row used
                // to be sized by its tallest cell, which made it 52px — the
                // shared row-menu Button is 34px, and vertical padding on top of
                // that overshot the 40px rhythm every other measurement here is
                // tuned to. It also silently broke windowing, whose `estimateSize`
                // has to agree with the real height or the spacer rows mis-scroll.
                className="bridge-table-row"
                style={{
                  height: rowPx,
                  borderBottom:
                    index === sorted.length - 1 ? undefined : "1px solid var(--color-line-soft)",
                  // iOS raises its own text-selection callout on a long press,
                  // which would fight the selection gesture for the same hold.
                  // This property is touch-only, so desktop text selection and
                  // copy are untouched.
                  WebkitTouchCallout: "none",
                  ...(selected ? { background: "var(--color-row-hover)" } : {}),
                }}
              >
                <td
                  data-stop
                  className={`w-px whitespace-nowrap px-2 align-middle ${
                    frozenIndex >= 0 ? "sticky left-0 z-10" : ""
                  }`}
                  style={
                    frozenIndex >= 0
                      ? { background: "var(--color-background)" }
                      : undefined
                  }
                >
                  <Checkbox
                    checked={selected}
                    disabled={!selectable}
                    aria-label={selected ? "Deselect row" : "Select row"}
                    title={
                      selectable
                        ? undefined
                        : "Unavailable: this row has no stable Record id, so it cannot be selected"
                    }
                    onCheckedChange={() => {
                      if (!stableRecordId) return;
                      cancelPendingOpen();
                      dispatchSelection({ type: "checkbox", key: stableRecordId });
                    }}
                  />
                </td>
                {columns.map((col, colIndex) => {
                  const value = row[col.id];
                  const numeric = isNumericColumn(col);
                  const isEditing = editing?.key === key && editing.col === col.id;
                  // ONE predicate for "can this be typed into" (TASK-109): a
                  // rollup, a button, an auto-number and the four metadata kinds
                  // are never editable anywhere, so no surface decides it alone.
                  const editable = rowEditable && isCellEditable(col);
                  const left = frozenLeft(colIndex);
                  // Plain-text form is always what the red-flag anchor records,
                  // whatever richer glyph the cell happens to render.
                  const text = formatCell(value);
                  const cellContext: CellContext = {
                    ...(editable && stableRecordId && onUpdate
                      ? {
                          onToggle: (next: boolean) => {
                            void onUpdate(stableRecordId, { [col.id]: next });
                          },
                        }
                      : { disabledReason: uneditableReason(col) }),
                  };
                  const rich = renderCell(col, value, cellContext);

                  return (
                    <td
                      key={col.id}
                      className={`align-middle ${wrapCells ? "whitespace-normal break-words" : "whitespace-nowrap"} ${
                        numeric ? "text-right tabular-nums" : ""
                      } ${onOpenRecord && !isEditing ? "cursor-pointer" : ""}`}
                      style={{
                        color: "var(--color-navy)",
                        paddingLeft: CELL_PAD_X,
                        paddingRight: CELL_PAD_X,
                        width: renderWidth(col),
                        ...(left === undefined
                          ? {}
                          : {
                              position: "sticky",
                              left,
                              zIndex: 10,
                              background: "var(--color-background)",
                            }),
                        // The body half of the column separator — same rule,
                        // same last-column exception, as the header above.
                        ...(colIndex < columns.length - 1
                          ? { borderRight: "1px solid var(--color-border)" }
                          : {}),
                      }}
                      // Every tap on a row's cells goes through the reducer,
                      // not straight to open: it decides whether this click is
                      // the finger-lift artefact of a long-press (swallow), a
                      // toggle (multi-select is active), or a genuine open.
                      onClick={
                        isEditing
                          ? undefined
                          : (event) => {
                              if ((event.target as HTMLElement).closest("[data-stop]")) return;
                              cancelPendingOpen();
                              if (!selectable) {
                                // Nothing to toggle, and opening a row mid-selection
                                // would leave the selection behind on a surface the
                                // user has navigated away from.
                                if (selecting || !onOpenRecord) return;
                                pendingOpen.current = setTimeout(() => {
                                  pendingOpen.current = null;
                                  onOpenRecord(row);
                                }, DOUBLE_CLICK_GRACE_MS);
                                return;
                              }
                              const shouldOpen = dispatchSelection({
                                type: "activate",
                                key: stableRecordId,
                              });
                              if (!shouldOpen || !onOpenRecord) return;
                              pendingOpen.current = setTimeout(() => {
                                pendingOpen.current = null;
                                onOpenRecord(row);
                              }, DOUBLE_CLICK_GRACE_MS);
                            }
                      }
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        // The first click of this pair already scheduled an open.
                        cancelPendingOpen();
                        // A checkbox has nothing to type into — its own control
                        // toggles it, so opening an editor over it would be a
                        // second, worse way to do the same thing.
                        if (editable && col.kind !== "checkbox") setEditing({ key, col: col.id });
                      }}
                      // §5f: right-click opens the SAME command list the row
                      // caret does, plus the cell-scoped commands (edit, copy,
                      // clear, flag). The flag lives here now rather than on
                      // hover (user directive 2026-08-10).
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelPendingOpen();
                        setCellMenu({
                          key,
                          row,
                          stableRecordId,
                          rowEditable,
                          columnId: col.id,
                          columnLabel: col.label,
                          editable,
                          text,
                          position: { x: event.clientX, y: event.clientY },
                        });
                      }}
                    >
                      {/* TASK-084: a formula cell holds a computed VALUE and the
                          EXPRESSION that produced it, and fx toggles between
                          them. Only this branch is new — every other cell keeps
                          the kind-shaped CellEditor. */}
                      {isEditing && stableRecordId && col.kind === "formula" && col.expressionField ? (
                        <FormulaCellEditor
                          value={text}
                          expression={String(row[col.expressionField] ?? "")}
                          onCommitExpression={async (next) => {
                            // Throws on the validator's refusal, which the
                            // editor shows while staying open.
                            await onUpdate?.(stableRecordId, { [col.expressionField!]: next });
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      ) : isEditing && stableRecordId ? (
                        <CellEditor
                          col={col}
                          value={value}
                          align={numeric ? "right" : "left"}
                          onCancel={() => setEditing(null)}
                          onCommit={async (next) => {
                            setEditing(null);
                            await onUpdate?.(stableRecordId, {
                              [col.id]: coerceCellValue(col, next),
                            });
                          }}
                        />
                      ) : flaggable && isFlaggableValue(value) && stableRecordId ? (
                        <RedFlagControl
                          anchor={{
                            kind: "cell",
                            moduleId,
                            databaseId: spec.id,
                            recordId: stableRecordId,
                            fieldId: col.id,
                          }}
                          renderedValue={text}
                        >
                          {rich}
                        </RedFlagControl>
                      ) : (
                        rich
                      )}
                    </td>
                  );
                })}

                <td
                  data-stop
                  className="bridge-sticky-cell sticky right-0 z-10 whitespace-nowrap text-right"
                  style={{
                    paddingLeft: CELL_PAD_X,
                    paddingRight: CELL_PAD_X,
                    background: "var(--color-background)",
                    borderLeft: "1px solid var(--color-border)",
                  }}
                >
                  <div className="bridge-row-actions flex items-center justify-end gap-1 opacity-60 transition-opacity">
                    <StandardRowMenu
                      row={row}
                      stableRecordId={stableRecordId}
                      canUpdate={rowEditable}
                      onOpenRecord={onOpenRecord}
                      onEditRecord={onEditRecord}
                      onDuplicate={onDuplicate}
                      onPin={onPin}
                      // The single-Record form of delete IS the bulk path with a
                      // one-element list — never a second, thinner write path.
                      {...(deleteRows && stableRecordId
                        ? { onDelete: () => deleteRows([stableRecordId]) }
                        : {})}
                    />
                  </div>
                </td>
              </tr>
            );
          })}

          {padBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={colSpan} style={{ height: padBottom, padding: 0 }} />
            </tr>
          )}

          {/* EMPTY = AN EMPTY TABLE, NOT A MESSAGE (user directive 2026-08-10:
              "If table is empty show empty table, no text. I want the visual
              aesthetics retained even if empty"). The headers, the column
              rhythm, the footer and the add-row all stay; the body is simply
              blank rows. The previous centred "No <id> records yet." note
              collapsed the table into a text box, which is exactly the
              aesthetic break being called out. */}
          {sorted.length === 0 &&
            Array.from({ length: EMPTY_FILLER_ROWS }, (_, index) => (
              <tr
                key={`empty-${index}`}
                aria-hidden="true"
                style={{
                  height: rowPx,
                  borderBottom:
                    index === EMPTY_FILLER_ROWS - 1
                      ? undefined
                      : "1px solid var(--color-line-soft)",
                }}
              >
                <td colSpan={colSpan} />
              </tr>
            ))}

          {/* The add-row is part of the table's SHAPE, not a per-page opt-in.
              Gating its existence on `onInsert` is what made JobPilot and
              Signals silently lose a control DealPilot and Relationship had —
              the user compared two Modules and correctly called it a bug
              (2026-08-10). §3a: a control that cannot act is disabled and says
              why; it never just disappears. */}
          <tr style={{ borderTop: "1px solid var(--color-line-soft)" }}>
            <td colSpan={colSpan} className="px-2 py-1.5">
              <button
                type="button"
                disabled={createReason !== null}
                onClick={() => onRequestCreate?.()}
                title={createReason ?? undefined}
                aria-describedby={createReason === null ? undefined : addRowReasonId}
                className="bridge-add-row w-full rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                style={{ color: "var(--color-warm-gray)" }}
              >
                + Add record
              </button>
              {createReason !== null && (
                <span id={addRowReasonId} className="sr-only">{createReason}</span>
              )}
            </td>
          </tr>
        </tbody>

        {/* The aggregate footer renders at zero rows too — it is part of the
            table's shape, and gating it on having data made an empty table
            lose its bottom edge (user directive: keep the aesthetics when
            empty). Each AggregateCell over an empty set renders its own
            zero/blank result. */}
        <tfoot className="sticky bottom-0 z-20">
          <tr style={{ background: "var(--color-line-soft)" }}>
              {columns.map((col) => {
                const numeric = isNumericColumn(col);
                const saved = view.aggregates?.[col.id];
                const kind = (saved && saved in AGGREGATE_LABELS
                  ? (saved as AggregateKind)
                  : defaultAggregate(numeric));
                return (
                  <AggregateCell
                    key={col.id}
                    kind={kind}
                    numeric={numeric}
                    align={numeric ? "right" : "left"}
                    values={sorted.map((row) => row[col.id])}
                    format={aggregateFormatter(col)}
                    onChange={(next) =>
                      patchView({ aggregates: { ...(view.aggregates ?? {}), [col.id]: next } })
                    }
                  />
                );
              })}
            <td
              className="bridge-sticky-cell sticky right-0 z-10 px-4 py-2"
              style={{
                background: "var(--color-line-soft)",
                borderLeft: "1px solid var(--color-border)",
                borderTop: "2px solid var(--color-border)",
              }}
            />
          </tr>
        </tfoot>
      </table>

      {/* §5f — the cell right-click menu. Rendered INSIDE the provider subtree
          below so its Flag command can read/write the batched flag state. */}
      {cellMenu && (
        <CellMenu
          state={cellMenu}
          spec={spec}
          moduleId={moduleId}
          onClose={() => setCellMenu(null)}
          onOpenRecord={onOpenRecord}
          onEditRecord={onEditRecord}
          onDuplicate={onDuplicate}
          onPin={onPin}
          onEditCell={() => setEditing({ key: cellMenu.key, col: cellMenu.columnId })}
          onUpdate={onUpdate}
          {...(deleteRows && cellMenu.stableRecordId
            ? {
                onDeleteRow: () => deleteRows([cellMenu.stableRecordId as string]),
                onDelete: () => deleteRows([cellMenu.stableRecordId as string]),
              }
            : {})}
        />
      )}
    </div>
    </div>
  );

  // Only pay for the batched listForScope query when this Module can actually be
  // flagged — an unsupported Module never renders a RedFlagControl at all, so a
  // RedFlagProvider around it would be a wasted query.
  return flaggable ? (
    <RedFlagProvider scope={{ moduleId, databaseId: spec.id }}>{table}</RedFlagProvider>
  ) : (
    table
  );
}

interface CellMenuState {
  key: string;
  row: DataRow;
  stableRecordId: string | null;
  rowEditable: boolean;
  columnId: string;
  columnLabel: string;
  editable: boolean;
  text: string;
  position: { x: number; y: number };
}

/**
 * Binds `StandardCellMenu` to this table's flag state and governed update path.
 * Split out because it needs `useOptionalRedFlagContext`, which only resolves
 * inside the `RedFlagProvider` the table body is wrapped in — and must NOT
 * throw on the Modules that have no flag support at all (AP-021: show the
 * command disabled with its reason, never crash).
 */
function CellMenu({
  state,
  spec,
  moduleId,
  onClose,
  onEditCell,
  onUpdate,
  ...rowHandlers
}: {
  state: CellMenuState;
  spec: TableSpec;
  moduleId: string;
  onClose: () => void;
  onEditCell: () => void;
  onUpdate?: DataViewProps["onUpdate"];
  onOpenRecord?: DataViewProps["onOpenRecord"];
  onEditRecord?: DataViewProps["onEditRecord"];
  onDuplicate?: DataViewProps["onDuplicate"];
  onPin?: DataViewProps["onPin"];
  /** Row-scoped delete, in both places the menu offers it. Same path, one id. */
  onDelete?: (row: DataRow) => void | Promise<void>;
  onDeleteRow?: () => void | Promise<void>;
}) {
  const flags = useOptionalRedFlagContext();
  const anchor =
    state.stableRecordId === null
      ? null
      : ({
          kind: "cell",
          moduleId,
          databaseId: spec.id,
          recordId: state.stableRecordId,
          fieldId: state.columnId,
        } as const);
  const current = anchor && flags ? flags.flagFor(anchor) : null;
  const flagState =
    current?.value.status === "open" ? "flagged" : current ? "cleared" : "none";

  return (
    <StandardCellMenu
      row={state.row}
      stableRecordId={state.stableRecordId}
      canUpdate={state.rowEditable}
      position={state.position}
      onClose={onClose}
      cell={{
        columnId: state.columnId,
        columnLabel: state.columnLabel,
        editable: state.editable,
        flagState,
      }}
      onEditCell={onEditCell}
      onCopyCell={
        state.text
          ? () => navigator.clipboard?.writeText(state.text)
          : undefined
      }
      {...(state.editable && state.stableRecordId && onUpdate
        ? {
            onClearCell: () =>
              onUpdate(state.stableRecordId as string, { [state.columnId]: null }),
          }
        : {})}
      {...(anchor && flags
        ? {
            onToggleFlag: async () => {
              if (current?.value.status === "open") {
                await flags.clear(current.row.id);
                return;
              }
              if (current) {
                await flags.reopen(current.row.id);
                return;
              }
              await flags.create({ anchor, renderedValue: state.text });
            },
          }
        : {})}
      {...rowHandlers}
    />
  );
}

/**
 * A footer cell that computes one aggregate over its column, and lets the user
 * change which. Restores the summary row ADR-182 had to report as permanently
 * open on the former canvas renderer (removed under ADR-194).
 */
function AggregateCell({
  kind,
  numeric,
  align,
  values,
  format,
  onChange,
}: {
  kind: AggregateKind;
  numeric: boolean;
  align: "left" | "right";
  values: unknown[];
  format?: (value: number) => string;
  onChange: (kind: AggregateKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const closeAggregateMenu = useCallback(() => setOpen(false), []);
  const result = useMemo(() => computeAggregate(values, kind), [values, kind]);
  const options = availableAggregates(numeric);

  useDismiss(open, closeAggregateMenu);

  const display =
    result.value === null
      ? "—"
      : result.isCount
        ? String(result.value)
        : (format?.(result.value) ?? String(Math.round(result.value * 100) / 100));

  return (
    <td
      className={`relative whitespace-nowrap ${align === "right" ? "text-right" : ""}`}
      style={{
        height: HEADER_HEIGHT,
        paddingLeft: CELL_PAD_X,
        paddingRight: CELL_PAD_X,
        borderTop: "2px solid var(--color-border)",
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
        className="bridge-agg inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] transition-colors"
      >
        <span
          className="text-[10px] uppercase tracking-[0.06em]"
          style={{ color: "var(--color-warm-gray)" }}
        >
          {AGGREGATE_LABELS[kind]}
        </span>
        <span className="font-semibold tabular-nums" style={{ color: "var(--color-navy)" }}>
          {display}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
          className={`absolute bottom-full z-50 mb-1 min-w-[150px] rounded-xl border py-1 shadow-xl ${
            align === "right" ? "right-2" : "left-2"
          }`}
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-background)",
          }}
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12.5px] hover:bg-black/5"
              style={{ color: "var(--color-navy)" }}
            >
              {AGGREGATE_LABELS[option]}
              {option === kind && (
                <Check size={12} style={{ color: "var(--color-steel)" }} aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
    </td>
  );
}
