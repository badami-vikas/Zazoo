/**
 * GlideTableView — the canvas renderer for the `table` view kind (ADR-160), and
 * since ADR-192 / AP-102 the ONLY renderer any table actually reaches:
 * `TableView` is still the registered entry point but now always delegates here
 * (`GLIDE_ROW_THRESHOLD = 0`). "Ensure all tables are derived from the same
 * primitive" means this file is that primitive.
 *
 * WHY THIS EXISTS: `docs/raw/tool-standardization-plan.md` always named a Glide
 * renderer as the table surface. TASK-009/014 (commit 928d66e) built the
 * `<DataViews>` registry and deleted the Glide renderer's only consumer without
 * ever recording a decision against Glide, leaving the DOM `TableView` with NO
 * virtualization — it renders every sorted row, which is a hard perf cliff on
 * the large directories the product is meant to carry. This file reinstates the
 * canvas grid, but shaped to the `DataViewProps` contract rather than the
 * prototype's bespoke props, so it is a renderer INSIDE the registry grammar
 * rather than a second, ungoverned table surface.
 *
 * THE ONE PATTERN USED THROUGHOUT: canvas paints, DOM governs. Every governed
 * affordance the DOM table carried is reproduced as a real DOM control mounted
 * over the canvas at coordinates Glide reports, never as a canvas-drawn
 * imitation of a control — a painted mark that cannot open its Action would be
 * exactly the AP-021 violation this design exists to avoid. Three affordances
 * follow the pattern: the red-flag control (below), the column header menu
 * (`StandardColumnMenuPanel`, opened from `onHeaderMenuClick`) and the per-row
 * 3-dots menu (`StandardRowMenuItems` in a controlled `<DropdownMenu>` anchored
 * to the actions cell). All three mount the SAME components the DOM renderer
 * used; none of them is re-implemented here.
 *
 * RED-FLAG PARITY — THE AP-021 GAP IS NOW CLOSED. ADR-160 originally kept the
 * DOM path as default because `RedFlagControl` is a DOM popover with no canvas
 * equivalent, and painting a flag-looking mark that could not open the governed
 * flag Action would violate AP-021 ("interactive-looking UI must perform/open/
 * explain a governed action"). Parity is now delivered by TWO COOPERATING
 * LAYERS, never by reimplementing any of RedFlagControl's logic:
 *
 *   Layer 1 — STATE INDICATOR (canvas). `drawCell` decorates a cell that has a
 *   CURRENTLY OPEN flag with the red flag glyph. Per the glossary an open flag
 *   "is ALWAYS visible — it IS the state", so it must survive scrolling past
 *   the hovered cell. This glyph performs NO action; it is paint, nothing else,
 *   which is precisely why it does not implicate AP-021 on its own.
 *   `drawCell` (not `customRenderers`) is used deliberately: it decorates on
 *   top of whatever cell kind is already there, so standard kinds, the built-in
 *   edit overlay, and range copy all keep working untouched.
 *
 *   Layer 2 — THE REAL GOVERNED CONTROL (DOM overlay). On hover (`onItemHovered`)
 *   or tap (`onCellClicked`, the touch path — §5d "Touch and keyboard paths
 *   expose the same control") exactly ONE real `<RedFlagControl>` is mounted,
 *   absolutely positioned over the hovered cell's `bounds`, right-aligned so it
 *   lands exactly where Layer 1 paints its indicator and the two visually
 *   coincide. It is the SAME component the DOM renderer uses, with the SAME
 *   anchor shape and the SAME `formatCell` `renderedValue`, so a flag raised
 *   here is indistinguishable from one raised in the DOM table. Its popover is
 *   already `position: fixed` and viewport-clamped (`clampMenuPosition`), which
 *   is what lets the control live OUTSIDE the cell it targets.
 *
 * The gating is identical to the DOM path — `isSupportedRedFlagModule`,
 * `isFlaggableValue`, and a stable persisted record id — so a flag can never
 * appear on the canvas where the DOM renderer would not have rendered one.
 * `RedFlagProvider` is mounted here exactly as `TableView` mounts it: ONE
 * batched `listForScope` query for the whole visible table, never per cell, and
 * only when the Module is actually supported.
 *
 * Cell semantics come from `../cell-format.js`, shared verbatim with TableView.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataEditor, GridCellKind } from "@glideapps/glide-data-grid";
import type {
  CellClickedEventArgs,
  DrawCellCallback,
  GridCell,
  GridMouseEventArgs,
  Item,
  Rectangle,
  SizedGridColumn,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { applyFilters, applySorts } from "@bridge/tables";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../../components/ui/dropdown-menu.js";
import {
  clampMenuPosition,
  StandardColumnMenuPanel,
  type MenuPosition,
} from "../../components/shared/StandardColumnMenu.js";
import { StandardRowMenuItems } from "../../components/shared/StandardRowMenu.js";
import { RedFlagControl } from "../../components/shared/RedFlagControl.js";
import { RedFlagProvider, useRedFlagContext, type RedFlagAnchor, type RedFlagRow } from "../../components/shared/RedFlagProvider.js";
import { isFlaggableValue, isSupportedRedFlagModule, moduleIdFromDatabaseId } from "../eligibility.js";
import type { DataRow, DataViewProps } from "../types.js";
import { displayText, formatCell, RAG_HEX } from "../cell-format.js";
import {
  GRID_HEADER_HEIGHT,
  GRID_ROW_HEIGHT,
  makeDrawHeader,
  useGridPalette,
  type HeaderSort,
} from "./grid-theme.js";

/** Geometry shared by BOTH layers so the painted indicator and the DOM control
 * land in the same place. `FLAG_GLYPH` is the painted box; `OVERLAY_SIZE` is
 * RedFlagControl's own button (`h-4 w-4` = 16px), centred over the glyph. */
const FLAG_GLYPH = 12;
const FLAG_PAD = 6;
const OVERLAY_SIZE = 16;

/** A row without a stable persisted id can never be the target of a governed update. */
function stableRowId(row: DataRow | undefined): string | null {
  if (!row) return null;
  const id = row["id"];
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

/** The DOM renderer's own withheld-value copy (RedFlagControl.tsx), repeated
 * verbatim: once an approved correction is ENACTED the flagged value must be
 * visibly withheld in EVERY renderer, not just the one that happens to host the
 * popover. Painting the original value here would silently undo the enactment. */
const APPLIED_PLACEHOLDER = "(corrected, pending re-entry)";

/** Paints the open-flag state indicator. Pure paint — see the header block: it
 * is deliberately NOT interactive, so it needs no governed Action of its own. */
function paintFlagGlyph(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  danger: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = danger;
  ctx.fillStyle = danger;
  ctx.lineWidth = 1.25;
  ctx.lineCap = "round";
  // Pole.
  ctx.moveTo(x + 1.5, y + 0.5);
  ctx.lineTo(x + 1.5, y + size);
  ctx.stroke();
  // Pennant.
  ctx.beginPath();
  ctx.moveTo(x + 1.5, y + 0.5);
  ctx.lineTo(x + size - 0.5, y + 0.5);
  ctx.lineTo(x + size - 3.5, y + size * 0.35);
  ctx.lineTo(x + size - 0.5, y + size * 0.7);
  ctx.lineTo(x + 1.5, y + size * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Where the overlay sits, already converted to coordinates relative to the
 * grid container (Glide reports `bounds` in VIEWPORT coordinates). */
interface FlagOverlayTarget {
  col: number;
  row: number;
  left: number;
  top: number;
}

/**
 * The Module allowlist decides whether this table can be flagged AT ALL, and —
 * exactly as in TableView — an unsupported Module never mounts a
 * `RedFlagProvider`, since a batched query whose results nothing could ever
 * render is pure waste.
 */
export function GlideTableView(props: DataViewProps) {
  const moduleId = moduleIdFromDatabaseId(props.spec.id);
  if (!isSupportedRedFlagModule(moduleId)) {
    return <GlideTableGrid {...props} moduleId={moduleId} />;
  }
  return (
    <RedFlagProvider scope={{ moduleId, databaseId: props.spec.id }}>
      <FlaggableGlideTable {...props} moduleId={moduleId} />
    </RedFlagProvider>
  );
}

/** Reads the ONE batched result set and hands the lookup down. Split out purely
 * so `useRedFlagContext()` (which throws outside a provider) is never called on
 * the unsupported-Module path. */
function FlaggableGlideTable(props: DataViewProps & { moduleId: string }) {
  const ctx = useRedFlagContext();
  return <GlideTableGrid {...props} flagFor={ctx.flagFor} />;
}

/** The trailing pinned column that carries the per-row 3-dots menu. It is a
 * real grid column (Glide has no "row actions" concept), kept narrow and
 * excluded from every column-level affordance: it is not reorderable-by-intent,
 * carries no header menu, and is never flaggable. */
const ACTIONS_COL_ID = "__row_actions__";
const ACTIONS_COL_WIDTH = 44;

interface RowMenuTarget {
  row: DataRow;
  recordId: string | null;
  canUpdate: boolean;
  /** Viewport coordinates — the anchor is `position: fixed`, exactly like the
   * column menu, so it does not depend on the grid's scroll offset. */
  x: number;
  y: number;
}

function GlideTableGrid({
  spec,
  view,
  data,
  onViewChange,
  onInsert,
  onOpenRecord,
  onEditRecord,
  onUpdate,
  onDuplicate,
  onPin,
  onRequestFilter,
  onHideColumn,
  canUpdateRow,
  moduleId,
  flagFor,
}: DataViewProps & {
  moduleId: string;
  /** Absent = this Module cannot be flagged; NO flag layer is rendered at all. */
  flagFor?: (anchor: RedFlagAnchor) => RedFlagRow | null;
}) {
  const rows = useMemo(
    () => applySorts(applyFilters(data, view.rowFilters, view.filterMatch), view.sorts),
    [data, view.rowFilters, view.filterMatch, view.sorts],
  );

  // Column order is renderer-local presentation state (drag-to-reorder). It is
  // reconciled whenever the spec's columns change so a removed/hidden column
  // never lingers and a newly added one always appears.
  const [colOrder, setColOrder] = useState<string[]>(() => spec.columns.map((c) => c.id));
  useEffect(() => {
    const incoming = spec.columns.map((c) => c.id);
    const present = new Set(incoming);
    setColOrder((prev) => {
      const kept = prev.filter((id) => present.has(id));
      const added = incoming.filter((id) => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [spec.columns]);

  const [widths, setWidths] = useState<Record<string, number>>({});
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Live Bridge tokens (ADR-182). Recomputed on a `.dark` flip, so the grid
   * follows the palette instead of the frozen light hexes it used to carry. */
  const palette = useGridPalette();
  /** Glide has no row-hover state of its own; the accent wash is applied
   * through `getRowThemeOverride` against this. */
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [flagTarget, setFlagTarget] = useState<FlagOverlayTarget | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ colId: string; label: string; position: MenuPosition } | null>(null);
  const [rowMenu, setRowMenu] = useState<RowMenuTarget | null>(null);
  const closeHeaderMenu = useCallback(() => setHeaderMenu(null), []);

  const orderedColumns = useMemo(() => {
    const byId = new Map(spec.columns.map((c) => [c.id, c]));
    return colOrder.flatMap((id) => {
      const col = byId.get(id);
      return col ? [col] : [];
    });
  }, [spec.columns, colOrder]);

  /** Index of the trailing actions column — always last, never part of
   * `orderedColumns`, so every data-column lookup stays index-aligned. */
  const actionsColIndex = orderedColumns.length;

  /** Sort state keyed by column id, for the header painter. It is NO LONGER
   * spliced into the column title: an arrow inside the title string could not
   * be uppercased or letter-spaced with the label without becoming part of the
   * label, and it broke the moment the title was truncated. `makeDrawHeader`
   * draws a real chevron instead. */
  const sortFor = useCallback(
    (columnId: string): HeaderSort | undefined => {
      const idx = view.sorts.findIndex((s) => s.id === columnId);
      const sort = idx >= 0 ? view.sorts[idx] : undefined;
      if (!sort) return undefined;
      return { dir: sort.dir, rank: view.sorts.length > 1 ? idx + 1 : null };
    },
    [view.sorts],
  );

  const drawHeader = useMemo(() => makeDrawHeader(sortFor), [sortFor]);

  const columns = useMemo<SizedGridColumn[]>(() => {
    const dataColumns = orderedColumns.map((col) => {
      return {
        id: col.id,
        title: col.label,
        width: widths[col.id] ?? col.width ?? 180,
        // Glide's own ⋮ affordance in the header. It draws the marker and
        // reports the click; the MENU itself is the shared DOM panel — see
        // `onHeaderMenuClick`.
        hasMenu: true,
      };
    });
    return [
      ...dataColumns,
      {
        id: ACTIONS_COL_ID,
        title: "",
        width: ACTIONS_COL_WIDTH,
        // No header menu: this column is not part of the Database's schema, so
        // every item in the column menu would be meaningless for it.
        hasMenu: false,
      },
    ];
  }, [orderedColumns, widths]);

  /**
   * The single eligibility test both flag layers use. Deliberately the SAME
   * three gates the DOM renderer applies (supported Module — already proven by
   * `flagFor` existing at all — plus a flaggable value and a STABLE persisted
   * record id), so the canvas can never offer a flag the DOM path would refuse.
   */
  const flagAt = useCallback(
    (c: number, r: number): { anchor: RedFlagAnchor; renderedValue: string; flag: RedFlagRow | null } | null => {
      if (!flagFor) return null;
      const col = orderedColumns[c];
      const row = rows[r];
      if (!col || !row) return null;
      const recordId = stableRowId(row);
      const value = row[col.id];
      if (recordId === null || !isFlaggableValue(value)) return null;
      const anchor: RedFlagAnchor = { kind: "cell", moduleId, databaseId: spec.id, recordId, fieldId: col.id };
      // `formatCell`, NOT `displayText`: the DOM renderer records the plain-text
      // projection as the anchor's `renderedValue`, and the two renderers must
      // record the SAME value for the same cell or a later correction check
      // would differ by renderer.
      return { anchor, renderedValue: formatCell(value), flag: flagFor(anchor) };
    },
    [flagFor, orderedColumns, rows, moduleId, spec.id],
  );

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [c, r] = cell;
      const col = orderedColumns[c];
      const row = rows[r];
      // The actions cell. It paints the same ⋯ marker the DOM row menu's
      // trigger button showed; clicking it opens the real DOM menu
      // (`onCellClicked`). It is NOT the control — it is the marker the control
      // mounts over, the same split the flag layers use.
      if (c === actionsColIndex) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: row ? "⋯" : "",
          allowOverlay: false,
          readonly: true,
          themeOverride: { textDark: palette.theme.textMedium },
        } as GridCell;
      }
      if (!col || !row) {
        return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
      }
      const raw = row[col.id];
      const text = displayText(col, raw);

      // An ENACTED correction withholds the flagged value in every renderer —
      // see APPLIED_PLACEHOLDER. Read-only: the value is deliberately absent,
      // so there is nothing here to edit until it is re-entered or the
      // correction is revoked from the flag's own popover.
      if (flagAt(c, r)?.flag?.value.learningStatus === "applied") {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: APPLIED_PLACEHOLDER,
          allowOverlay: false,
          readonly: true,
          themeOverride: { textDark: palette.theme.textLight },
        } as GridCell;
      }

      // A cell is editable only when the caller supplied a GOVERNED update sink
      // (`onUpdate` routes through the page's own propose/authority path) AND
      // this row passes the caller's row-level permission check AND the column
      // is declared editable. Absent any of those it is painted read-only —
      // never an editable-looking cell with no governed commit path.
      const rowId = stableRowId(row);
      const editable =
        Boolean(onUpdate) &&
        Boolean(col.editable) &&
        !col.locked &&
        rowId !== null &&
        (!canUpdateRow || canUpdateRow(row));

      if (col.display === "rag") {
        const hex = RAG_HEX[String(raw)];
        if (hex) {
          return {
            kind: GridCellKind.Text,
            data: text,
            displayData: "●",
            allowOverlay: false,
            themeOverride: { textDark: hex },
          } as GridCell;
        }
      }

      if (Array.isArray(raw)) {
        return {
          kind: GridCellKind.Bubble,
          data: raw.filter((item) => item !== null && item !== undefined).map(String),
          allowOverlay: false,
        } as GridCell;
      }

      if (typeof raw === "boolean") {
        return { kind: GridCellKind.Boolean, data: raw, allowOverlay: false, readonly: true } as GridCell;
      }

      return {
        kind: GridCellKind.Text,
        data: raw === null || raw === undefined ? "" : String(raw),
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
      } as GridCell;
    },
    [orderedColumns, rows, onUpdate, canUpdateRow, flagAt, actionsColIndex],
  );

  /**
   * Layer 1. `drawCell` DECORATES — it calls `drawContent()` first and then
   * paints on top, so the underlying cell kind (text/bubble/boolean/RAG dot)
   * and Glide's own edit overlay are untouched. A `customRenderers` entry would
   * have had to REPLACE the cell kind and re-implement editing for it; there is
   * no reason to take that on for a decoration.
   */
  const drawCell = useCallback<DrawCellCallback>(
    (args, drawContent) => {
      drawContent();
      if (!flagFor) return;
      const { ctx, rect, col: c, row: r } = args;
      if (c < 0) return; // the row-marker column, which has no data cell behind it
      if (flagAt(c, r)?.flag?.value.status !== "open") return;
      // Open flags ONLY. Everything else is hover/focus-revealed, which is
      // Layer 2's job — painting a subtle glyph for them would be a mark with
      // no action behind it.
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.clip();
      paintFlagGlyph(
        ctx,
        rect.x + rect.width - FLAG_PAD - FLAG_GLYPH,
        rect.y + (rect.height - FLAG_GLYPH) / 2,
        FLAG_GLYPH,
        palette.danger,
      );
      ctx.restore();
    },
    [flagFor, flagAt, palette.danger],
  );

  /** The hovered-row wash. Avilo's `hover:bg-accent-soft/40`, expressed the one
   * way Glide allows a row to be tinted without touching cell content. */
  const getRowThemeOverride = useCallback(
    (row: number) =>
      row === hoverRow ? { bgCell: palette.hoverBg, bgCellMedium: palette.hoverBg } : undefined,
    [hoverRow, palette.hoverBg],
  );

  /** Glide reports `bounds` in viewport coordinates; the overlay is positioned
   * inside a `position: relative` container, so convert once, here. */
  const targetFromBounds = useCallback(
    (location: Item, bounds: { x: number; y: number; width: number; height: number }): FlagOverlayTarget | null => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box) return null;
      const [c, r] = location;
      return {
        col: c,
        row: r,
        left: bounds.x - box.x + bounds.width - FLAG_PAD - FLAG_GLYPH - (OVERLAY_SIZE - FLAG_GLYPH) / 2,
        top: bounds.y - box.y + (bounds.height - OVERLAY_SIZE) / 2,
      };
    },
    [],
  );

  const onItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      if (args.kind !== "cell") {
        setFlagTarget(null);
        setHoverRow(null);
        return;
      }
      setHoverRow(args.location[1]);
      setFlagTarget(targetFromBounds(args.location, args.bounds));
    },
    [targetFromBounds],
  );

  /** Stable identity on purpose: Glide re-runs its visible-region effect
   * whenever this callback's identity changes. Scrolling invalidates EVERY
   * canvas-anchored DOM overlay, not just the flag — the column and row menus
   * are anchored in viewport coordinates too, so they go with it rather than
   * hanging over an unrelated cell. */
  const dropFlagTarget = useCallback(() => {
    setFlagTarget(null);
    setHoverRow(null);
    setHeaderMenu(null);
    setRowMenu(null);
  }, []);

  // Glide renders its edit overlay into a fixed portal node.
  useEffect(() => {
    if (!document.getElementById("portal")) {
      const node = document.createElement("div");
      node.id = "portal";
      node.style.position = "fixed";
      node.style.left = "0";
      node.style.top = "0";
      node.style.zIndex = "9999";
      document.body.appendChild(node);
    }
  }, []);

  // NO ZERO-ROW EARLY RETURN. AP-081: "Table stays visible even at zero rows
  // (Notion-style empty body + Add row), never replaced by a message box." The
  // grid below therefore renders unconditionally — Glide draws the header and
  // an empty body at `rows={0}`, the trailing add-row (when a governed insert
  // path exists) stays put, and the note is an overlay INSIDE the empty body
  // rather than a component that replaces the table.

  const overlay = flagTarget ? flagAt(flagTarget.col, flagTarget.row) : null;

  /** The column the header menu is open for, re-resolved from the spec each
   * render so the menu's handlers can never target a stale column object. */
  const headerMenuColumn = headerMenu ? spec.columns.find((c) => c.id === headerMenu.colId) : undefined;

  return (
    // Height is CONTAINER-DRIVEN, with no floor of its own any more. The old
    // `min-h-96` was a symptom, not a size: `<DataViews>` used to render this
    // grid inside a `space-y-3` stack with no definite height, so `h-full`
    // resolved to zero and the canvas vanished, and the floor was what kept it
    // on screen. `<DataViews>` now ALWAYS hands its view a definite height
    // (viewport share in fill mode, an explicit height otherwise), so `h-full`
    // is the whole story and the floor is gone — a floor here would only fight
    // a short viewport. No `overscroll-behavior` is set: when the grid's inner
    // scroller bottoms out, the remaining delta must chain out to the page
    // scroller and bring the Files/Intelligence Sections up.
    // `relative` is what the Layer-2 overlay is positioned against.
    // The card the grid sits in is the Avilo `Block` chrome expressed in Bridge
    // tokens: a 12px radius (`--radius-card`), a single 1px `--color-border`
    // hairline and the barely-there 1px lift that separates a card from the
    // page without reading as a floating panel. `rounded-md` (8px) and a
    // shadowless border were the old, tighter treatment.
    <div
      ref={containerRef}
      className="relative flex h-full flex-col overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
      style={{ background: palette.theme.bgCell }}
    >
      <DataEditor
        className="min-h-0 flex-1"
        columns={columns}
        rows={rows.length}
        getCellContent={getCellContent}
        drawCell={drawCell}
        // The Avilo header treatment Glide's `Theme` cannot express —
        // UPPERCASE, 0.07em tracking, a drawn sort chevron, a lighter ⋮.
        drawHeader={drawHeader}
        getRowThemeOverride={getRowThemeOverride}
        // 40/36 are Avilo's `py-2.5` on 13px text and its 10px header — a
        // notably airier rhythm than the 36/40 (taller header than row) this
        // grid used to run, which read as a dense spreadsheet rather than a
        // document table.
        rowHeight={GRID_ROW_HEIGHT}
        headerHeight={GRID_HEADER_HEIGHT}
        // NO VERTICAL GRID LINES. Avilo separates columns with the 16px gutter
        // alone; ruling every column boundary is what made this grid read as a
        // spreadsheet. Row rules survive (`horizontalBorderColor`), because
        // without them a wide row cannot be tracked across the table.
        verticalBorder={false}
        // NO ROW-NUMBER GUTTER. Avilo has none, and the numbers were competing
        // with the first data column for the reader's entry point. Reverting is
        // one word (`"number"`) if row-marker selection is ever wanted back.
        rowMarkers="none"
        // THE TRAILING "+ New row". Glide only draws it when `onRowAppended`
        // is defined, which is exactly the gating canon wants: no Page without
        // a governed insert path (`onInsert`) ever shows an add affordance.
        // Where it leads is the DOM table's own "Add row" destination — the
        // Form View — because that is what collects a complete draft and hands
        // it to `onInsert`; appending a blank Record straight to the store
        // would propose an empty row nobody asked for.
        trailingRowOptions={{ sticky: true, tint: true, hint: "New row" }}
        onRowAppended={onInsert ? () => { onViewChange({ ...view, kind: "form" }); } : undefined}
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
        theme={palette.theme}
        // Enables range copy — one of the capabilities the DOM table never had.
        getCellsForSelection={true}
        freezeColumns={1}
        onItemHovered={onItemHovered}
        // A scrolled grid moves every cell out from under the last reported
        // `bounds`, and Glide only re-reports on pointer movement — so the
        // overlay is dropped rather than left anchored to the wrong cell. It
        // comes straight back on the next pointer move.
        onVisibleRegionChanged={dropFlagTarget}
        onColumnResize={(col, newSize) => setWidths((w) => ({ ...w, [String(col.id)]: newSize }))}
        onColumnMoved={(startIdx, endIdx) => {
          // The trailing actions column is not a schema column; dragging it (or
          // dropping a column past it) must never rewrite `colOrder`, whose
          // indices only cover data columns.
          if (startIdx >= actionsColIndex || endIdx >= actionsColIndex) return;
          setColOrder((prev) => {
            const next = [...prev];
            const [moved] = next.splice(startIdx, 1);
            if (moved === undefined) return prev;
            next.splice(endIdx, 0, moved);
            return next;
          });
        }}
        // Header click drives the SAME ViewConfig sort the DOM header writes, so
        // switching renderers never changes what a sort means.
        // THE COLUMN MENU. Glide paints the ⋮ marker (because `hasMenu` is set)
        // and reports where it is; the menu itself is the SAME
        // `StandardColumnMenuPanel` the DOM header opens, mounted below. Nothing
        // about the item list, its disabled items, or their AP-021 reasons is
        // re-stated here.
        onHeaderMenuClick={(c: number, bounds: Rectangle) => {
          const col = orderedColumns[c];
          if (!col) return;
          setRowMenu(null);
          setHeaderMenu({
            colId: col.id,
            label: col.label,
            position: clampMenuPosition({ x: bounds.x, y: bounds.y + bounds.height + 4 }),
          });
        }}
        onHeaderClicked={(c) => {
          const col = orderedColumns[c];
          if (!col) return;
          const active = view.sorts.find((s) => s.id === col.id);
          const dir = active?.dir === "asc" ? "desc" : "asc";
          onViewChange({ ...view, sorts: [{ id: col.id, dir }] });
        }}
        // THE TOUCH PATH (§5d "Touch and keyboard paths expose the same
        // control"): a touchscreen never fires `onItemHovered`, so a tap is what
        // brings the very same RedFlagControl up there. RedFlagControl's own
        // >=44x44 coarse-pointer hit target then applies unchanged.
        onCellClicked={(cell: Item, event: CellClickedEventArgs) => {
          const [c, r] = cell;
          // THE ROW MENU. Clicking the trailing actions cell opens the real DOM
          // menu (`StandardRowMenuItems`) anchored to that cell. It is opened by
          // CLICK, not hover, on purpose: the menu's own popover lives outside
          // the grid, so a hover-mounted menu would unmount the moment the
          // pointer left the canvas to reach it.
          if (c === actionsColIndex) {
            const row = rows[r];
            if (!row) return;
            setFlagTarget(null);
            setHeaderMenu(null);
            setRowMenu({
              row,
              recordId: stableRowId(row),
              canUpdate: !canUpdateRow || canUpdateRow(row),
              x: event.bounds.x + event.bounds.width,
              y: event.bounds.y + event.bounds.height,
            });
            return;
          }
          setRowMenu(null);
          setFlagTarget(targetFromBounds(cell, event.bounds));
        }}
        onCellActivated={(cell) => {
          const [c, r] = cell;
          // The actions cell has its own click behaviour; activating it must not
          // ALSO open the Record behind it.
          if (c === actionsColIndex) return;
          const row = rows[r];
          if (row && onOpenRecord) onOpenRecord(row);
        }}
        onCellEdited={(cell, newValue) => {
          const [c, r] = cell;
          const col = orderedColumns[c];
          const row = rows[r];
          const rowId = stableRowId(row);
          if (!col || !row || !rowId || !onUpdate) return;
          const next = (newValue as { data?: unknown }).data;
          void onUpdate(rowId, { [col.id]: next === null || next === undefined ? "" : next });
        }}
      />
      {overlay && flagTarget && (
        <div
          className="absolute z-10"
          style={{ left: flagTarget.left, top: flagTarget.top, width: OVERLAY_SIZE, height: OVERLAY_SIZE }}
        >
          <RedFlagControl
            anchor={overlay.anchor}
            renderedValue={overlay.renderedValue}
            // Two presentational overrides, no behaviour change:
            // - `[&>button]:opacity-100` — in the DOM table the glyph is
            //   revealed by CSS hover on its wrapper. Here MOUNTING is the
            //   hover signal (this overlay only exists for the hovered/tapped
            //   cell), so the glyph must be visible for the whole time it is
            //   mounted rather than only while the 16px box itself is hovered.
            // - `[&>span:first-child]:hidden` — hides RedFlagControl's own
            //   "(corrected, pending re-entry)" substitute text, which
            //   `getCellContent` already paints on the canvas at full cell
            //   width; drawing it a second time inside a 16px box would just
            //   overflow the cell. The error `role="alert"` span is never the
            //   first child, so it still shows.
            className="[&>button]:opacity-100 [&>span:first-child]:hidden"
          >
            {null}
          </RedFlagControl>
        </div>
      )}
      {/* Zero-row note. An OVERLAY, not a replacement: the header, the column
          menus and the trailing add-row all stay exactly where they are, and
          this is the only thing that changes (AP-081). `pointer-events-none`
          keeps the empty body clickable underneath. */}
      {rows.length === 0 && (
        <div
          className="pointer-events-none absolute inset-x-0 flex justify-center py-8 text-sm text-muted-foreground"
          style={{ top: GRID_HEADER_HEIGHT }}
        >
          No {spec.id} records yet.
        </div>
      )}
      {/* THE COLUMN MENU — the same component the DOM header renders, opened at
          the coordinates Glide reported. It closes itself on outside pointerdown
          and Escape. */}
      {headerMenu && headerMenuColumn && (
        <StandardColumnMenuPanel
          label={headerMenu.label}
          databaseBacked
          position={headerMenu.position}
          onClose={closeHeaderMenu}
          onFilter={() => onRequestFilter?.(headerMenuColumn.id)}
          onSort={(direction) => onViewChange({ ...view, sorts: [{ id: headerMenuColumn.id, dir: direction }] })}
          onHide={onHideColumn ? () => onHideColumn(headerMenuColumn.id) : undefined}
        />
      )}
      {/* THE ROW MENU — the same items the DOM table's 3-dots menu renders. The
          trigger is a zero-size FIXED anchor placed over the actions cell,
          because a canvas has no element for Radix to anchor to; the menu is
          controlled so it survives the pointer leaving the canvas. */}
      {rowMenu && (
        <DropdownMenu open onOpenChange={(open) => { if (!open) setRowMenu(null); }}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden="true" className="fixed" style={{ left: rowMenu.x, top: rowMenu.y, width: 1, height: 1 }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <StandardRowMenuItems
              row={rowMenu.row}
              stableRecordId={rowMenu.recordId}
              canUpdate={rowMenu.canUpdate}
              onOpenRecord={onOpenRecord}
              onEditRecord={onEditRecord}
              onDuplicate={onDuplicate}
              onPin={onPin}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
