/**
 * GlideTableView — the canvas renderer for the `table` view kind (ADR-160).
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
 * WHAT IT DELIBERATELY DOES NOT DO: it does not paint red-flag glyphs.
 * `RedFlagControl` is a DOM popover and has no canvas equivalent; rendering a
 * flag-looking mark that could not open the governed flag Action would violate
 * AP-021 ("interactive-looking UI must perform a governed action"). `TableView`
 * therefore keeps the DOM path as the default and only hands rows to this
 * renderer past the virtualization threshold, where the DOM path would stall
 * regardless. That asymmetry is intentional and recorded in ADR-160.
 *
 * Cell semantics come from `../cell-format.js`, shared verbatim with TableView.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataEditor, GridCellKind } from "@glideapps/glide-data-grid";
import type { GridCell, Item, SizedGridColumn } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { applyFilters, applySorts } from "@bridge/tables";
import type { DataRow, DataViewProps } from "../types.js";
import { displayText, RAG_HEX } from "../cell-format.js";

/** Bridge-token theme mapped to concrete hex (Glide is canvas — no CSS vars). */
const bridgeTheme = {
  accentColor: "#4D7EA8",
  accentFg: "#FFFFFF",
  accentLight: "rgba(77,126,168,0.12)",
  textDark: "#1A2B3C",
  textMedium: "#2E4057",
  textLight: "#B8B4A8",
  textBubble: "#1A2B3C",
  textHeader: "#2E4057",
  textHeaderSelected: "#1A2B3C",
  bgCell: "#FFFFFF",
  bgCellMedium: "#FAF9F5",
  bgHeader: "#F0EEE8",
  bgHeaderHasFocus: "#E2DED5",
  bgHeaderHovered: "#EAE7DF",
  bgBubble: "#F0EEE8",
  bgBubbleSelected: "#E2DED5",
  bgSearchResult: "rgba(196,149,90,0.20)",
  borderColor: "#E2DED5",
  horizontalBorderColor: "#ECEAE3",
  drilldownBorder: "#E2DED5",
  linkColor: "#4D7EA8",
  cellHorizontalPadding: 12,
  cellVerticalPadding: 10,
  headerFontStyle: "600 12px",
  baseFontStyle: "13px",
  fontFamily: "Geist, Inter, system-ui, sans-serif",
} as const;

/** A row without a stable persisted id can never be the target of a governed update. */
function stableRowId(row: DataRow | undefined): string | null {
  if (!row) return null;
  const id = row["id"];
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export function GlideTableView({
  spec,
  view,
  data,
  onViewChange,
  onOpenRecord,
  onUpdate,
  canUpdateRow,
}: DataViewProps) {
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

  const orderedColumns = useMemo(() => {
    const byId = new Map(spec.columns.map((c) => [c.id, c]));
    return colOrder.flatMap((id) => {
      const col = byId.get(id);
      return col ? [col] : [];
    });
  }, [spec.columns, colOrder]);

  const columns = useMemo<SizedGridColumn[]>(
    () =>
      orderedColumns.map((col) => {
        const idx = view.sorts.findIndex((s) => s.id === col.id);
        const sort = idx >= 0 ? view.sorts[idx] : undefined;
        // Multi-sort shows a rank number so the precedence is visible, matching
        // the DOM header's ↑/↓ affordance.
        const arrow = sort
          ? (sort.dir === "asc" ? "  ↑" : "  ↓") + (view.sorts.length > 1 ? String(idx + 1) : "")
          : "";
        return {
          id: col.id,
          title: col.label + arrow,
          width: widths[col.id] ?? col.width ?? 180,
        };
      }),
    [orderedColumns, view.sorts, widths],
  );

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [c, r] = cell;
      const col = orderedColumns[c];
      const row = rows[r];
      if (!col || !row) {
        return { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false };
      }
      const raw = row[col.id];
      const text = displayText(col, raw);

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
    [orderedColumns, rows, onUpdate, canUpdateRow],
  );

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

  if (rows.length === 0) {
    return (
      <div className="border rounded-md py-8 text-center text-sm text-muted-foreground">
        No {spec.id} records yet.
      </div>
    );
  }

  return (
    <div className="border rounded-md overflow-hidden" style={{ height: "60vh" }}>
      <DataEditor
        columns={columns}
        rows={rows.length}
        getCellContent={getCellContent}
        rowHeight={36}
        headerHeight={40}
        rowMarkers="number"
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
        theme={bridgeTheme as never}
        // Enables range copy — one of the capabilities the DOM table never had.
        getCellsForSelection={true}
        freezeColumns={1}
        onColumnResize={(col, newSize) => setWidths((w) => ({ ...w, [String(col.id)]: newSize }))}
        onColumnMoved={(startIdx, endIdx) => {
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
        onHeaderClicked={(c) => {
          const col = orderedColumns[c];
          if (!col) return;
          const active = view.sorts.find((s) => s.id === col.id);
          const dir = active?.dir === "asc" ? "desc" : "asc";
          onViewChange({ ...view, sorts: [{ id: col.id, dir }] });
        }}
        onCellActivated={(cell) => {
          const [, r] = cell;
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
    </div>
  );
}
