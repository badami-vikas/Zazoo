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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyFilters, applySorts } from "@bridge/tables";
import type { ColumnSpec, TableSpec } from "@bridge/tables";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { StandardColumnMenu } from "../../components/shared/StandardColumnMenu.js";
import { StandardRowMenu } from "../../components/shared/StandardRowMenu.js";
import { RedFlagControl } from "../../components/shared/RedFlagControl.js";
import { StandardCellMenu } from "../../components/shared/StandardCellMenu.js";
import { RedFlagProvider, useOptionalRedFlagContext } from "../../components/shared/RedFlagProvider.js";
import {
  isFlaggableValue,
  isSupportedRedFlagModule,
  moduleIdFromDatabaseId,
} from "../eligibility.js";
import type { DataRow, DataViewProps } from "../types.js";
import { formatCell, formatCurrency, renderCell, trimZero } from "../cell-format.js";
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
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 36;
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
  return col.kind === "number" || col.display === "currency" || col.display === "multiple";
}

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
  onUpdate,
  onOpenRecord,
  onEditRecord,
  canUpdateRow,
  onDuplicate,
  onPin,
  onRequestFilter,
  onHideColumn,
}: DataViewProps) {
  const filtered = useMemo(
    () => applyFilters(data, view.rowFilters, view.filterMatch),
    [data, view.rowFilters, view.filterMatch],
  );
  const sorted = useMemo(() => applySorts(filtered, view.sorts), [filtered, view.sorts]);

  const columns = spec.columns;
  const moduleId = moduleIdFromDatabaseId(spec.id);
  // A Module the server cannot validate targets for (e.g. "signal" — no backing
  // existence-check store yet) must never render an interactive-looking flag
  // glyph, since redFlag.create would fail-closed on every attempt (AP-021).
  const flaggable = isSupportedRedFlagModule(moduleId);

  const [aggregates, setAggregates] = useState<Record<string, AggregateKind>>({});
  const [editing, setEditing] = useState<{ key: string; col: string } | null>(null);
  /** Open cell right-click menu (§5f), or null. Position is the pointer. */
  const [cellMenu, setCellMenu] = useState<CellMenuState | null>(null);
  /**
   * The in-place new-Element draft. Non-null means one blank row is appended to
   * the body with an editor in every column.
   *
   * This used to be `onViewChange({ ...view, kind: "form" })` — clicking "add"
   * swapped the whole surface for the Form View, so the table the user was
   * reading vanished and their scroll position with it. Adding an Element is
   * meant to happen where the Elements are; the Form View is still reachable as
   * a View in its own right for anyone who wants the long form.
   */
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);

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

  /**
   * Hand the draft to the caller's governed insert path and clear it.
   *
   * An all-empty draft is a cancel, not an insert: the row is dismissed rather
   * than sent, so a stray click on "+ Add record" cannot post a blank Record
   * through the pipeline.
   */
  const commitDraft = useCallback(async () => {
    if (!draft || !onInsert) return;
    const filled = Object.entries(draft).filter(
      ([, value]) => value !== undefined && value !== null && String(value).trim() !== "",
    );
    if (filled.length === 0) {
      setDraft(null);
      return;
    }
    await onInsert(Object.fromEntries(filled));
    setDraft(null);
  }, [draft, onInsert]);
  const windowed = sorted.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Spacer rows rather than absolute positioning: it keeps a real <table> with
  // real <tr> children, so sticky thead/tfoot, colgroup widths and aria-sort all
  // keep working. Absolute positioning would require faking every one of them.
  const visible = windowed
    ? virtualItems.map((item) => ({ row: sorted[item.index]!, index: item.index }))
    : sorted.map((row, index) => ({ row, index }));
  const padTop = windowed && virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const padBottom =
    windowed && virtualItems.length > 0
      ? virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end
      : 0;

  const colSpan = columns.length + 1;
  const canEditRow = (row: DataRow) => Boolean(onUpdate) && (!canUpdateRow || canUpdateRow(row));

  const table = (
    <div
      ref={setScrollEl}
      className="bridge-scroll h-full overflow-auto rounded-xl border"
      style={{ borderColor: "var(--color-border)", background: "var(--color-background)" }}
    >
      {/* A min-width makes the container scroll rather than squeezing columns
          until the row actions clip — these tables have more columns than a
          laptop viewport. At 375px it scrolls inside its own box (AP-081). */}
      <table className="w-full min-w-[860px] border-collapse text-[13px]">
        <thead className="sticky top-0 z-20">
          <tr style={{ background: "var(--color-line-soft)" }}>
            {columns.map((col) => {
              const activeSort = view.sorts.find((sort) => sort.id === col.id);
              const numeric = isNumericColumn(col);
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={
                    activeSort ? (activeSort.dir === "asc" ? "ascending" : "descending") : "none"
                  }
                  style={{
                    width: col.width,
                    height: HEADER_HEIGHT,
                    paddingLeft: CELL_PAD_X,
                    paddingRight: CELL_PAD_X,
                    color: "var(--color-warm-gray)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                  className={`whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.07em] ${
                    numeric ? "text-right" : "text-left"
                  }`}
                >
                  <span
                    className={`inline-flex items-center gap-1 ${numeric ? "flex-row-reverse" : ""}`}
                  >
                    <StandardColumnMenu
                      label={col.label}
                      databaseBacked
                      onFilter={() => onRequestFilter?.(col.id)}
                      onSort={(direction) =>
                        onViewChange({ ...view, sorts: [{ id: col.id, dir: direction }] })
                      }
                      onHide={onHideColumn ? () => onHideColumn(col.id) : undefined}
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

          {visible.map(({ row, index }) => {
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

            return (
              <tr
                key={key}
                // h-10 is ROW_HEIGHT, declared rather than emerged. The row used
                // to be sized by its tallest cell, which made it 52px — the
                // shared row-menu Button is 34px, and vertical padding on top of
                // that overshot the 40px rhythm every other measurement here is
                // tuned to. It also silently broke windowing, whose `estimateSize`
                // has to agree with the real height or the spacer rows mis-scroll.
                className="bridge-table-row"
                style={{ height: ROW_HEIGHT, borderBottom: "1px solid var(--color-line-soft)" }}
              >
                {columns.map((col) => {
                  const value = row[col.id];
                  const numeric = isNumericColumn(col);
                  const isEditing = editing?.key === key && editing.col === col.id;
                  const editable = rowEditable && col.editable !== false && !col.locked;
                  // Plain-text form is always what the red-flag anchor records,
                  // whatever richer glyph the cell happens to render.
                  const text = formatCell(value);
                  const rich = renderCell(col, value);

                  return (
                    <td
                      key={col.id}
                      className={`whitespace-nowrap align-middle ${
                        numeric ? "text-right tabular-nums" : ""
                      } ${onOpenRecord && !isEditing ? "cursor-pointer" : ""}`}
                      style={{
                        color: "var(--color-navy)",
                        paddingLeft: CELL_PAD_X,
                        paddingRight: CELL_PAD_X,
                      }}
                      onClick={
                        onOpenRecord && !isEditing
                          ? (event) => {
                              if ((event.target as HTMLElement).closest("[data-stop]")) return;
                              cancelPendingOpen();
                              pendingOpen.current = setTimeout(() => {
                                pendingOpen.current = null;
                                onOpenRecord(row);
                              }, DOUBLE_CLICK_GRACE_MS);
                            }
                          : undefined
                      }
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        // The first click of this pair already scheduled an open.
                        cancelPendingOpen();
                        if (editable) setEditing({ key, col: col.id });
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
                      {isEditing && stableRecordId ? (
                        <InlineEditor
                          initial={value === null || value === undefined ? "" : String(value)}
                          align={numeric ? "right" : "left"}
                          options={col.options}
                          onCancel={() => setEditing(null)}
                          onCommit={async (next) => {
                            setEditing(null);
                            await onUpdate?.(stableRecordId, { [col.id]: next });
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

          {/* Notion-like empty state: the table keeps its headers, footer and
              add-row at zero rows. It is never replaced by a message box — the
              empty note renders INSIDE the body (AP-081). */}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={colSpan}>
                <div
                  className="flex flex-col items-center gap-3 px-5 py-12 text-center"
                  style={{ color: "var(--color-warm-gray)" }}
                >
                  <span className="text-[13px] font-medium">No {spec.id} records yet.</span>
                  {onInsert && !draft && (
                    <Button size="sm" variant="outline" onClick={() => setDraft({})}>
                      <Plus className="size-3.5" /> Add record
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          )}

          {/* The draft Element, in place. It sits inside <tbody> so it inherits
              the same colgroup widths and sticky-column behaviour as a real
              row — a floating overlay would have to re-derive both. */}
          {onInsert && draft && (
            <tr
              className="bridge-table-row"
              style={{ height: ROW_HEIGHT, borderBottom: "1px solid var(--color-line-soft)" }}
            >
              {columns.map((col, index) => (
                <td key={col.id} style={{ paddingLeft: CELL_PAD_X, paddingRight: CELL_PAD_X }}>
                  <DraftCell
                    column={col}
                    autoFocus={index === 0}
                    value={draft[col.id]}
                    onChange={(next) => setDraft((current) => ({ ...current, [col.id]: next }))}
                    onCommit={() => void commitDraft()}
                    onCancel={() => setDraft(null)}
                  />
                </td>
              ))}
              <td className="bridge-sticky-cell sticky right-0 z-10 whitespace-nowrap px-2 text-right">
                <button
                  type="button"
                  onClick={() => void commitDraft()}
                  className="rounded-md px-2 py-1 text-[12px] font-medium hover:bg-black/5 dark:hover:bg-white/10"
                  style={{ color: "var(--color-navy)" }}
                >
                  Save
                </button>
              </td>
            </tr>
          )}

          {onInsert && !draft && sorted.length > 0 && (
            <tr style={{ borderTop: "1px solid var(--color-line-soft)" }}>
              <td colSpan={colSpan} className="px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setDraft({})}
                  className="bridge-add-row w-full rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors"
                  style={{ color: "var(--color-warm-gray)" }}
                >
                  + Add record
                </button>
              </td>
            </tr>
          )}
        </tbody>

        {sorted.length > 0 && (
          <tfoot className="sticky bottom-0 z-20">
            <tr style={{ background: "var(--color-line-soft)" }}>
              {columns.map((col) => {
                const numeric = isNumericColumn(col);
                const kind = aggregates[col.id] ?? defaultAggregate(numeric);
                return (
                  <AggregateCell
                    key={col.id}
                    kind={kind}
                    numeric={numeric}
                    align={numeric ? "right" : "left"}
                    values={sorted.map((row) => row[col.id])}
                    format={aggregateFormatter(col)}
                    onChange={(next) =>
                      setAggregates((current) => ({ ...current, [col.id]: next }))
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
        )}
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
        />
      )}
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
 * open on canvas — Glide has no footer, and `freezeTrailingRows` would have
 * shifted the row indices the flag and menu layers depend on.
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
  const result = useMemo(() => computeAggregate(values, kind), [values, kind]);
  const options = availableAggregates(numeric);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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

/** Inline cell editor. Present only where a governed update path exists —
 * `onUpdate` routes through the caller's pipeline exactly as the Form view's
 * insert does, so editing here is not a second, ungoverned write path. */
function InlineEditor({
  initial,
  align,
  options,
  onCommit,
  onCancel,
}: {
  initial: string;
  align: "left" | "right";
  options?: string[];
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (options) selectRef.current?.focus();
    else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [options]);

  const style = {
    borderColor: "var(--color-steel)",
    background: "var(--color-background)",
    color: "var(--color-navy)",
  };

  if (options) {
    return (
      <select
        ref={selectRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onCommit(event.target.value);
        }}
        onBlur={onCancel}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className="w-full rounded-md border px-2 py-1 text-[13px] outline-none"
        style={style}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => (value === initial ? onCancel() : onCommit(value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(value);
        if (event.key === "Escape") onCancel();
      }}
      className={`w-full min-w-[80px] rounded-md border px-2 py-1 text-[13px] outline-none ${
        align === "right" ? "text-right" : ""
      }`}
      style={style}
    />
  );
}

/**
 * One cell of the in-place new-Element draft row.
 *
 * Deliberately NOT `InlineEditor`: that component edits an existing value and
 * treats blur-without-change as a cancel, which would tear the draft row down
 * the moment the user tabbed between columns. A draft cell holds its value in
 * the parent's draft object and only Escape dismisses.
 */
function DraftCell({
  column,
  value,
  autoFocus,
  onChange,
  onCommit,
  onCancel,
}: {
  column: ColumnSpec;
  value: unknown;
  autoFocus: boolean;
  onChange: (next: unknown) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const style = {
    borderColor: "var(--color-steel)",
    background: "var(--color-background)",
    color: "var(--color-navy)",
  };
  const onKeyDown = (event: { key: string }) => {
    if (event.key === "Enter") onCommit();
    if (event.key === "Escape") onCancel();
  };
  const text = value === undefined || value === null ? "" : String(value);

  if (column.options && column.options.length > 0) {
    return (
      <select
        autoFocus={autoFocus}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border px-2 py-1 text-[13px] outline-none"
        style={style}
      >
        <option value="">—</option>
        {column.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  const numeric = isNumericColumn(column);
  return (
    <input
      autoFocus={autoFocus}
      value={text}
      placeholder={column.label}
      inputMode={numeric ? "decimal" : undefined}
      onChange={(event) =>
        onChange(numeric && event.target.value !== "" ? Number(event.target.value) : event.target.value)
      }
      onKeyDown={onKeyDown}
      className={`w-full min-w-[80px] rounded-md border px-2 py-1 text-[13px] outline-none ${
        numeric ? "text-right" : ""
      }`}
      style={style}
    />
  );
}
