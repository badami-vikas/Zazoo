import { useState } from "react";
import { applyFilters, applySorts, groupBy } from "@bridge/tables";
import { Plus } from "lucide-react";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import type { DataViewProps } from "../types.js";

export function BoardView({
  spec,
  view,
  data,
  onViewChange,
  onInsert,
  onUpdate,
  canUpdateRow,
  onOpenRecord,
}: DataViewProps) {
  const [mutationError, setMutationError] = useState<string | null>(null);
  const filtered = applyFilters(data, view.rowFilters, view.filterMatch);
  const sorted = applySorts(filtered, view.sorts);

  const groupField = view.groupBy ?? spec.columns.find((c) => c.kind === "select")?.id;
  if (!groupField) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md">
        Board needs a group-by column (a select field) — none configured for {spec.id}.
      </div>
    );
  }

  const groupColumn = spec.columns.find((column) => column.id === groupField);
  const groupCanUpdate =
    groupColumn?.editable === true && groupColumn.locked !== true;
  const groupedRows = new Map(groupBy(sorted, groupField));
  const groupKeys = [
    ...(groupColumn?.options ?? []),
    ...groupedRows.keys(),
  ].filter((key, index, all) => all.indexOf(key) === index);
  const groups = groupKeys.map((key) => [key, groupedRows.get(key) ?? []] as const);
  const titleField =
    spec.columns.find((column) => column.kind === "text")?.id ??
    spec.columns.find((column) => column.kind !== "select")?.id ??
    spec.columns[0]?.id;

  async function moveRow(rowId: string, key: string) {
    if (!onUpdate || !groupCanUpdate) return;
    const row = sorted.find((candidate, index) =>
      String(candidate["id"] ?? index) === rowId,
    );
    if (!row || (canUpdateRow && !canUpdateRow(row))) return;
    setMutationError(null);
    try {
      await onUpdate(rowId, { [groupField!]: key });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "The row could not be moved.");
    }
  }

  if (groups.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground text-center border rounded-md">
        No {spec.id} data yet. Connect an account or add one to see it here.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {mutationError && <p role="alert" className="text-xs text-red-600">{mutationError}</p>}
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2">
      {groups.map(([key, rows]) => (
        <div
          key={key}
          className="flex-none w-[80vw] max-w-[280px] snap-start border rounded-md bg-muted/30"
          onDragOver={(event) => {
            if (onUpdate && groupCanUpdate) event.preventDefault();
          }}
          onDrop={(event) => {
            const rowId = event.dataTransfer.getData("text/bridge-row-id");
            if (rowId) void moveRow(rowId, key);
          }}
        >
          <div className="px-3 py-2 border-b text-sm font-medium flex items-center justify-between gap-2">
            <span className="truncate">{key}</span>
            <Badge variant="secondary">{rows.length}</Badge>
          </div>
          <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
            {rows.map((row, i) => {
              const rowId = String(row["id"] ?? i);
              const rowCanUpdate =
                Boolean(onUpdate) &&
                groupCanUpdate &&
                (!canUpdateRow || canUpdateRow(row));
              return (
                <div
                  key={rowId}
                  className="border rounded-md bg-card p-2 text-sm space-y-2"
                  draggable={rowCanUpdate}
                  onDragStart={(event) => event.dataTransfer.setData("text/bridge-row-id", rowId)}
                >
                  <button
                    type="button"
                    className="text-left w-full font-medium"
                    onClick={() => onOpenRecord?.(row)}
                    disabled={!onOpenRecord}
                  >
                    {titleField ? formatCell(row[titleField]) : "—"}
                  </button>
                  {rowCanUpdate && groupColumn?.options && (
                    <label className="block text-xs text-muted-foreground">
                      Move to
                      <select
                        className="mt-1 w-full rounded border bg-background px-2 py-1 text-foreground"
                        value={key}
                        onChange={(event) => void moveRow(rowId, event.target.value)}
                      >
                        {groupColumn.options.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              );
            })}
            {onInsert && (
              <Button
                size="sm"
                variant="ghost"
                className="w-full justify-start"
                onClick={() =>
                  onViewChange({
                    ...view,
                    kind: "form",
                    formDefaults: { [groupField]: key },
                  })
                }
              >
                <Plus className="size-3.5" />
                Add row
              </Button>
            )}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
