import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { DataEditor, GridCellKind, CompactSelection } from '@glideapps/glide-data-grid';
import type { GridCell, GridColumn, Item, GridSelection } from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';

export interface GlideField { id: string; label: string; width?: number; editable?: boolean }

// Title-case the SHOUTING field labels for the grid header.
const pretty = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/&/g, '&');

// Bridge-token theme mapped to concrete hex (Glide is canvas — no CSS vars).
const bridgeTheme = {
  accentColor: '#4D7EA8',
  accentFg: '#FFFFFF',
  accentLight: 'rgba(77,126,168,0.12)',
  textDark: '#1A2B3C',
  textMedium: '#2E4057',
  textLight: '#B8B4A8',
  textBubble: '#1A2B3C',
  textHeader: '#2E4057',
  textHeaderSelected: '#1A2B3C',
  bgCell: '#FFFFFF',
  bgCellMedium: '#FAF9F5',
  bgHeader: '#F0EEE8',
  bgHeaderHasFocus: '#E2DED5',
  bgHeaderHovered: '#EAE7DF',
  bgBubble: '#F0EEE8',
  bgBubbleSelected: '#E2DED5',
  bgSearchResult: 'rgba(196,149,90,0.20)',
  borderColor: '#E2DED5',
  horizontalBorderColor: '#ECEAE3',
  drilldownBorder: '#E2DED5',
  linkColor: '#4D7EA8',
  cellHorizontalPadding: 12,
  cellVerticalPadding: 10,
  headerFontStyle: '600 12px',
  baseFontStyle: '13px',
  fontFamily: 'Geist, Inter, system-ui, sans-serif',
} as const;

export function GlideTable({
  rows, fields, rowHeight, onOpen, onSort, sort, selectable, onSelectedRowsChange, onCellEdit, onCellEdited,
}: {
  rows: any[];
  fields: GlideField[];
  rowHeight: number;
  onOpen: (row: any) => void;
  onSort?: (id: string) => void;
  sort?: { id: string; dir: 'asc' | 'desc' } | null;
  selectable?: boolean;
  onSelectedRowsChange?: (count: number, rowIndices: number[]) => void;
  /** Called when a non-name cell is clicked outside selection mode (popover-based editors). */
  onCellEdit?: (row: any, fieldId: string, pos: { x: number; y: number }) => void;
  /** Called when a cell value is committed via the Glide inline overlay editor. */
  onCellEdited?: (row: any, fieldId: string, value: string) => void;
}) {
  const [gridSelection, setGridSelection] = useState<GridSelection>({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
  const lastMousePos = useRef({ x: 0, y: 0 });
  // clear selection when leaving selection mode
  useEffect(() => { if (!selectable) { setGridSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() }); onSelectedRowsChange?.(0); } }, [selectable]);
  const baseCols = useMemo<GridColumn[]>(() => ([
    { title: 'Name', id: 'name', width: 240 },
    ...fields.map(f => ({
      title: pretty(f.label) + (sort?.id === f.id ? (sort.dir === 'asc' ? '  ↑' : '  ↓') : ''),
      id: f.id, width: f.width || 180,
    })),
  ]), [fields, sort]);

  const [widths, setWidths] = useState<Record<string, number>>({});
  const columns = useMemo(() => baseCols.map(c => ({ ...c, width: widths[c.id as string] ?? (c.width as number) })), [baseCols, widths]);

  const fieldById = useMemo(() => Object.fromEntries(fields.map(f => [f.id, f])), [fields]);
  const getCellContent = useCallback((cell: Item): GridCell => {
    const [c, r] = cell;
    const row = rows[r];
    const col = columns[c];
    const id = col?.id as string;
    let v = row ? row[id] : '';
    if (Array.isArray(v)) v = v.join(', ');
    v = v === null || v === undefined ? '' : String(v);
    const isName = c === 0;
    const isNewRow = !!row?.id && String(row.id).startsWith('new-');
    const editable = isName ? isNewRow : !!fieldById[id]?.editable;
    return {
      kind: GridCellKind.Text,
      data: v,
      displayData: v,
      allowOverlay: editable,
      readonly: !editable,
      cursor: isName && !isNewRow ? 'pointer' : undefined,
      themeOverride: isName ? { textDark: '#4D7EA8', baseFontStyle: '600 13px' } : undefined,
    } as GridCell;
  }, [rows, columns, fieldById]);

  // single instance — provide Glide's overlay portal target once
  useEffect(() => {
    if (!document.getElementById('portal')) {
      const d = document.createElement('div');
      d.id = 'portal';
      d.style.position = 'fixed'; d.style.left = '0'; d.style.top = '0'; d.style.zIndex = '9999';
      document.body.appendChild(d);
    }
  }, []);

  return (
    <div className="h-full w-full" onMouseDown={(e) => { lastMousePos.current = { x: e.clientX, y: e.clientY }; }}>
      <DataEditor
        columns={columns}
        rows={rows.length}
        getCellContent={getCellContent}
        rowHeight={rowHeight}
        headerHeight={40}
        rowMarkers={selectable ? 'checkbox' : 'number'}
        rowSelect={selectable ? 'multi' : 'none'}
        gridSelection={gridSelection}
        onGridSelectionChange={(s) => { setGridSelection(s); onSelectedRowsChange?.(s.rows.length, s.rows.toArray()); }}
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
        theme={bridgeTheme as any}
        getCellsForSelection={true}
        onColumnResize={(col, newSize) => setWidths(w => ({ ...w, [col.id as string]: newSize }))}
        onHeaderClicked={(c) => { const col = columns[c]; if (col?.id && col.id !== 'name' && onSort) onSort(col.id as string); }}
        onCellClicked={(cell) => {
          if (selectable) return;
          const [c, r] = cell;
          const row = rows[r];
          const isNewRow = !!row?.id && String(row.id).startsWith('new-');
          if (c === 0 && row && !isNewRow) { onOpen(row); return; }
          if (c > 0 && row && onCellEdit) onCellEdit(row, columns[c]?.id as string, lastMousePos.current);
        }}
        onCellEdited={(cell, newVal) => {
          const [c, r] = cell;
          const row = rows[r]; const col = columns[c];
          if (!row || !col || !onCellEdited) return;
          const v = (newVal as any).data;
          onCellEdited(row, col.id as string, v === null || v === undefined ? '' : String(v));
        }}
        onDelete={(sel) => {
          // Clear the contents of editable cells in the active range (Delete / Backspace).
          if (sel.current && onCellEdited) {
            const { x, y, width, height } = sel.current.range;
            for (let rr = y; rr < y + height; rr++) {
              const row = rows[rr]; if (!row) continue;
              const isNew = !!row.id && String(row.id).startsWith('new-');
              for (let cc = Math.max(0, x); cc < x + width; cc++) {
                const col = columns[cc]; if (!col) continue;
                const editable = col.id === 'name' ? isNew : !!fieldById[col.id as string]?.editable;
                if (editable) onCellEdited(row, col.id as string, '');
              }
            }
          }
          return sel;
        }}
      />
    </div>
  );
}
