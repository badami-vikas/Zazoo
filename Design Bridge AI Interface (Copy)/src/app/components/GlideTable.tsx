import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { DataEditor, GridCellKind, CompactSelection } from '@glideapps/glide-data-grid';
import type { GridCell, GridColumn, SizedGridColumn, Item, GridSelection } from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';

const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const reUrl = /^https?:\/\//i;

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
  rows, fields, rowHeight, onOpen, onSort, sort, selectable, onSelectedRowsChange, onCellEdit, onCellEdited, onRowMenu,
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
  /** Called when the user right-clicks a row cell; receives the row object and mouse position. */
  onRowMenu?: (row: any, pos: { x: number; y: number }) => void;
}) {
  const [gridSelection, setGridSelection] = useState<GridSelection>({ columns: CompactSelection.empty(), rows: CompactSelection.empty() });
  const lastMousePos = useRef({ x: 0, y: 0 });
  // clear selection when leaving selection mode
  useEffect(() => { if (!selectable) { setGridSelection({ columns: CompactSelection.empty(), rows: CompactSelection.empty() }); onSelectedRowsChange?.(0, []); } }, [selectable]);

  // Column order: ['name', ...field ids in display order]. Reconcile when fields change.
  const [colOrder, setColOrder] = useState<string[]>(() => ['name', ...fields.map(f => f.id)]);
  useEffect(() => {
    const incoming = new Set(['name', ...fields.map(f => f.id)]);
    setColOrder(prev => {
      const kept = prev.filter(id => incoming.has(id));
      const added = ['name', ...fields.map(f => f.id)].filter(id => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [fields]);

  const baseCols = useMemo<SizedGridColumn[]>(() => {
    const colMap = new Map<string, SizedGridColumn>([
      ['name', { title: 'Name', id: 'name', width: 240 }],
      ...fields.map(f => [f.id, {
        title: pretty(f.label) + (sort?.id === f.id ? (sort.dir === 'asc' ? '  ↑' : '  ↓') : ''),
        id: f.id, width: f.width || 180,
      }] as [string, SizedGridColumn]),
    ]);
    return colOrder.filter(id => colMap.has(id)).map(id => colMap.get(id)!);
  }, [fields, sort, colOrder]);

  const [widths, setWidths] = useState<Record<string, number>>({});
  const columns = useMemo(() => baseCols.map(c => ({ ...c, width: widths[c.id as string] ?? (c.width as number) })), [baseCols, widths]);

  const fieldById = useMemo(() => Object.fromEntries(fields.map(f => [f.id, f])), [fields]);
  const getCellContent = useCallback((cell: Item): GridCell => {
    const [c, r] = cell;
    const row = rows[r];
    const col = columns[c];
    const id = col?.id as string;
    const rawVal = row ? row[id] : undefined;
    const isName = col?.id === 'name';
    const isNewRow = !!row?.id && String(row.id).startsWith('new-');
    const editable = isName ? isNewRow : !!fieldById[id]?.editable;

    // Boolean → checkbox cell (non-name only)
    if (!isName && typeof rawVal === 'boolean') {
      return {
        kind: GridCellKind.Boolean,
        data: rawVal,
        allowOverlay: false,
        readonly: true,
      } as GridCell;
    }

    // Array → Bubble chips (non-name only; display-only, no overlay)
    if (!isName && Array.isArray(rawVal)) {
      return {
        kind: GridCellKind.Bubble,
        data: rawVal.filter((item: any) => item !== null && item !== undefined).map(String),
        allowOverlay: false,
      } as GridCell;
    }

    let v = rawVal;
    v = v === null || v === undefined ? '' : String(v);

    // Email / URL → Uri cell (non-name only)
    if (!isName && (reEmail.test(v) || reUrl.test(v))) {
      return {
        kind: GridCellKind.Uri,
        data: v,
        displayData: v,
        allowOverlay: editable,
        readonly: !editable,
      } as GridCell;
    }

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
    <div className="h-full w-full" onMouseDown={(e) => { lastMousePos.current = { x: e.clientX, y: e.clientY }; }} onContextMenu={(e) => { lastMousePos.current = { x: e.clientX, y: e.clientY }; }}>
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
        freezeColumns={1}
        onColumnResize={(col, newSize) => setWidths(w => ({ ...w, [col.id as string]: newSize }))}
        onColumnMoved={(startIdx, endIdx) => {
          // Name col (index 0) is pinned — clamp destination to >= 1, never move name
          if (startIdx === 0) return;
          const clamped = Math.max(1, endIdx);
          setColOrder(prev => {
            const next = [...prev];
            const [moved] = next.splice(startIdx, 1);
            next.splice(clamped, 0, moved);
            return next;
          });
        }}
        onHeaderClicked={(c) => { const col = columns[c]; if (col?.id && col.id !== 'name' && onSort) onSort(col.id as string); }}
        onCellClicked={(cell) => {
          if (selectable) return;
          const [c, r] = cell;
          const row = rows[r];
          // Uri (email/url) cells open their link on click — don't fire popover/open
          const cellContent = getCellContent(cell);
          if (cellContent.kind === GridCellKind.Uri) {
            const uri = cellContent.data;
            if (reEmail.test(uri)) window.open(`mailto:${uri}`, '_self');
            else window.open(uri, '_blank', 'noopener');
            return;
          }
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
        onPaste={(target: Item, values: readonly (readonly string[])[]): boolean => {
          if (!onCellEdited) return false;
          const [targetCol, targetRow] = target;
          for (let dr = 0; dr < values.length; dr++) {
            const pasteRow = values[dr];
            const rr = targetRow + dr;
            const row = rows[rr]; if (!row) continue;
            const isNew = !!row.id && String(row.id).startsWith('new-');
            for (let dc = 0; dc < pasteRow.length; dc++) {
              const cc = targetCol + dc;
              const col = columns[cc]; if (!col) continue;
              const editable = col.id === 'name' ? isNew : !!fieldById[col.id as string]?.editable;
              if (!editable) continue;
              onCellEdited(row, col.id as string, String(pasteRow[dc]));
            }
          }
          return false;
        }}
        onCellContextMenu={(cell, event) => {
          if (typeof (event as any).preventDefault === 'function') (event as any).preventDefault();
          if (!onRowMenu) return;
          const [, r] = cell;
          const row = rows[r]; if (!row) return;
          onRowMenu(row, { x: lastMousePos.current.x, y: lastMousePos.current.y });
        }}
      />
    </div>
  );
}
