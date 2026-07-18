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
import { applyFilters, applySorts } from "@bridge/tables";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table.js";
import { RedFlagControl } from "../../components/shared/RedFlagControl.js";
import { RedFlagProvider } from "../../components/shared/RedFlagProvider.js";
import { isFlaggableValue, isSupportedRedFlagModule, moduleIdFromDatabaseId } from "../eligibility.js";
import type { DataViewProps } from "../types.js";

export function TableView({ spec, view, data, onViewChange }: DataViewProps) {
  const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
  const sorted = applySorts(filtered, view.sorts);
  const moduleId = moduleIdFromDatabaseId(spec.id);
  // review round-5 item 6: a Module the server can't validate targets for
  // (e.g. "signal" — no backing existence-check store yet) must never even
  // render an interactive-looking flag glyph, since redFlag.create would
  // fail-closed on EVERY attempt — an "interactive-looking" control that
  // always errors is not a working governed Action (AP-021).
  const flaggable = isSupportedRedFlagModule(moduleId);

  function toggleSort(columnId: string) {
    const existing = view.sorts.find((s) => s.id === columnId);
    const nextDir = existing ? (existing.dir === "asc" ? "desc" : "asc") : "asc";
    onViewChange({ ...view, sorts: [{ id: columnId, dir: nextDir }] });
  }

  if (sorted.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md">
        No {spec.id} data yet. Connect an account or add one to see it here.
      </div>
    );
  }

  const table = (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            {spec.columns.map((col) => {
              const sort = view.sorts.find((s) => s.id === col.id);
              return (
                <TableHead
                  key={col.id}
                  className="cursor-pointer select-none"
                  onClick={() => toggleSort(col.id)}
                  aria-sort={sort ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  {col.label}
                  {sort ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
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
            return (
              <TableRow key={stableRecordId ?? i}>
                {spec.columns.map((col) => {
                  const value = row[col.id];
                  const cell = formatCell(value);
                  return (
                    <TableCell key={col.id}>
                      {flaggable && isFlaggableValue(value) && stableRecordId ? (
                        <RedFlagControl
                          anchor={{ kind: "cell", moduleId, databaseId: spec.id, recordId: stableRecordId, fieldId: col.id }}
                          renderedValue={cell}
                        >
                          {cell}
                        </RedFlagControl>
                      ) : (
                        cell
                      )}
                    </TableCell>
                  );
                })}
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
