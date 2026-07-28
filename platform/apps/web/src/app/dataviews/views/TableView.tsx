/**
 * TableView — the default @bridge/tables-backed view: a real <table> driven by
 * TableSpec's columns + ViewConfig's sorts/rowFilters via engine.ts
 * (applyFilters/applySorts), never a hardcoded column list. Registered under
 * kind "table" in registry.ts.
 *
 * Mobile-width-safe: the shadcn Table component already wraps itself in a
 * `overflow-x-auto` container (components/ui/table.tsx), so at 375px the table
 * scrolls horizontally INSIDE its own box rather than blowing out the page.
 */
import { applyFilters, applySorts, type ColumnSpec } from "@bridge/tables";
import type { ReactNode } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table.js";
import { Button } from "../../components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.js";
import { StandardColumnMenu } from "../../components/shared/StandardColumnMenu.js";
import { RedFlagControl } from "../../components/shared/RedFlagControl.js";
import { RedFlagProvider } from "../../components/shared/RedFlagProvider.js";
import { isFlaggableValue, isSupportedRedFlagModule, moduleIdFromDatabaseId } from "../eligibility.js";
import type { DataViewProps } from "../types.js";

export function TableView({
  spec,
  view,
  data,
  onViewChange,
  onInsert,
  onOpenRecord,
  onEditRecord,
  canUpdateRow,
  onDuplicate,
  onPin,
  onRequestFilter,
  onHideColumn,
}: DataViewProps) {
  const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
  const sorted = applySorts(filtered, view.sorts);
  const moduleId = moduleIdFromDatabaseId(spec.id);
  // review round-5 item 6: a Module the server can't validate targets for
  // (e.g. "signal" — no backing existence-check store yet) must never even
  // render an interactive-looking flag glyph, since redFlag.create would
  // fail-closed on EVERY attempt — an "interactive-looking" control that
  // always errors is not a working governed Action (AP-021).
  const flaggable = isSupportedRedFlagModule(moduleId);

  const table = (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            {spec.columns.map((col) => {
              const activeSort = view.sorts.find((sort) => sort.id === col.id);
              return (
                <TableHead
                  key={col.id}
                  aria-sort={
                    activeSort
                      ? activeSort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <div className="flex items-center gap-1">
                    <StandardColumnMenu
                      label={col.label}
                      databaseBacked
                      onFilter={() => onRequestFilter?.(col.id)}
                      onSort={(direction) =>
                        onViewChange({
                          ...view,
                          sorts: [{ id: col.id, dir: direction }],
                        })
                      }
                      onHide={
                        onHideColumn ? () => onHideColumn(col.id) : undefined
                      }
                    />
                    {activeSort && (
                      <>
                        <span aria-hidden="true" className="text-xs">
                          {activeSort.dir === "asc" ? "↑" : "↓"}
                        </span>
                        <span className="sr-only">
                          Sorted {activeSort.dir === "asc" ? "ascending" : "descending"}
                        </span>
                      </>
                    )}
                  </div>
                </TableHead>
              );
            })}
            <TableHead className="w-10"><span className="sr-only">Row actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Notion-like empty state: the table (with all its column headers)
              stays visible even with zero rows; the empty note + Add row live
              inside the body rather than replacing the whole grid. */}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={spec.columns.length + 1}>
                <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
                  <span>No {spec.id} records yet.</span>
                  {onInsert && (
                    <Button size="sm" variant="outline" onClick={() => onViewChange({ ...view, kind: "form" })}>
                      <Plus className="size-3.5" /> Add row
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          )}
          {sorted.map((row, i) => {
            // review round-4 item 6: a red flag anchor's `recordId` must be
            // a STABLE, persisted record id — never the sorted row's
            // array index, which is meaningless once the table is
            // re-sorted/re-filtered and would silently mis-anchor an
            // existing flag onto a DIFFERENT row. A row without a real
            // `id` field is simply not flaggable (React's own `key` still
            // falls back to the index, same as before — that's a
            // rendering-identity concern, unrelated to anchor identity).
            const stableRecordId = typeof row["id"] === "string" || typeof row["id"] === "number" ? String(row["id"]) : null;
            const rowCanUpdate = !canUpdateRow || canUpdateRow(row);
            return (
              <TableRow
                key={stableRecordId ?? i}
                onDoubleClick={() => onOpenRecord?.(row)}
                className={onOpenRecord ? "cursor-pointer" : undefined}
              >
                {spec.columns.map((col) => {
                  const value = row[col.id];
                  // Plain-text form is always what the red-flag anchor records,
                  // regardless of any richer glyph rendered in the cell.
                  const text = formatCell(value);
                  const rich = renderCell(col, value);
                  return (
                    <TableCell key={col.id}>
                      {flaggable && isFlaggableValue(value) && stableRecordId ? (
                        <RedFlagControl
                          anchor={{ kind: "cell", moduleId, databaseId: spec.id, recordId: stableRecordId, fieldId: col.id }}
                          renderedValue={text}
                        >
                          {rich}
                        </RedFlagControl>
                      ) : (
                        rich
                      )}
                    </TableCell>
                  );
                })}
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" aria-label="Open row actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={!onOpenRecord} onSelect={() => onOpenRecord?.(row)}>
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!onEditRecord || !rowCanUpdate}
                        onSelect={() => rowCanUpdate && onEditRecord?.(row)}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!onDuplicate} onSelect={() => void onDuplicate?.(row)}>
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!onPin || !stableRecordId} onSelect={() => stableRecordId && void onPin?.(stableRecordId)}>
                        Pin
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled
                        variant="destructive"
                        title="Unavailable: deletion requires dependency preview and undo support"
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  // Only pay for the batched listForScope query when this Module can
  // actually be flagged — an unsupported Module never renders a
  // RedFlagControl at all, so a RedFlagProvider around it would be a
  // wasted query.
  return flaggable ? <RedFlagProvider scope={{ moduleId, databaseId: spec.id }}>{table}</RedFlagProvider> : table;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

// ── Opt-in rich cell rendering (ADR-155) ─────────────────────────────────────
// A column with no `display` hint renders exactly as before: plain text. Only
// columns that opt in get a glyph, so no existing Module table changes.

const BADGE_TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  yellow: "bg-amber-50 text-amber-700 ring-amber-600/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  gray: "bg-slate-50 text-slate-600 ring-slate-500/20",
};

const RAG_DOT: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-400",
  red: "bg-rose-500",
};

/** Compact money label: 4_200_000 → "$4.2M", 68_000_000 → "$68M". */
function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${trimZero(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}$${trimZero(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}$${trimZero(abs / 1_000)}K`;
  return `${sign}$${abs.toLocaleString()}`;
}

/** One decimal, but drop a trailing ".0" (18.0 → "18", 10.2 → "10.2"). */
function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

function renderCell(col: ColumnSpec, value: unknown): ReactNode {
  if (col.display && value !== null && value !== undefined && value !== "") {
    switch (col.display) {
      case "rag": {
        const tone = RAG_DOT[String(value)];
        if (tone) {
          return (
            <span className="inline-flex items-center" title={String(value)}>
              <span className={`inline-block size-2.5 rounded-full ${tone}`} aria-label={String(value)} />
            </span>
          );
        }
        break;
      }
      case "badge": {
        const tone = BADGE_TONES[col.badgePalette?.[String(value)] ?? "gray"];
        const label = col.badgeLabels?.[String(value)] ?? formatCell(value);
        return (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}
          >
            {label}
          </span>
        );
      }
      case "meter": {
        const pct = Math.max(0, Math.min(100, Number(value)));
        if (!Number.isNaN(pct)) {
          const bar = pct >= 70 ? RAG_DOT.green : pct >= 40 ? RAG_DOT.yellow : RAG_DOT.red;
          return (
            <span className="inline-flex items-center gap-2" title={`${pct}%`}>
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                <span className={`block h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
              </span>
              <span className="text-xs tabular-nums text-slate-500">{pct}%</span>
            </span>
          );
        }
        break;
      }
      case "currency": {
        const n = Number(value);
        if (!Number.isNaN(n)) return <span className="tabular-nums">{formatCurrency(n)}</span>;
        break;
      }
      case "multiple": {
        const n = Number(value);
        if (!Number.isNaN(n)) return <span className="tabular-nums">{trimZero(n)}×</span>;
        break;
      }
    }
  }
  return formatCell(value);
}
