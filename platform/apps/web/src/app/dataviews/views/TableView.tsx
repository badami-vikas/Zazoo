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
import type { DataViewProps } from "../types.js";

export function TableView({ spec, view, data, onViewChange }: DataViewProps) {
  const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
  const sorted = applySorts(filtered, view.sorts);

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

  return (
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
          {sorted.map((row, i) => (
            <TableRow key={String(row["id"] ?? i)}>
              {spec.columns.map((col) => (
                <TableCell key={col.id}>{formatCell(row[col.id])}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
