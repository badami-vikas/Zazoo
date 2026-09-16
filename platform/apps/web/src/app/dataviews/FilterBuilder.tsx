/**
 * The Filter popover's body (TASK-110).
 *
 * WHAT THIS REPLACES: one hardcoded expression. The shell used to write
 * `[{ field, op: "contains", value }]` whatever the column held, so a number
 * column offered "contains" and `ViewConfig.filterMatch` — read by seven views
 * — was written by nothing and therefore permanently "all".
 *
 * Every operator on screen comes from `filterOpsForKind(column.kind)` and is
 * worded by `FILTER_OP_LABELS`. Nothing here keeps its own list: a picker with
 * a private copy of the grammar is the same defect one indirection further on.
 */
import { useMemo } from "react";
import {
  FILTER_OP_LABELS,
  VALUELESS_FILTER_OPS,
  filterOpsForKind,
  type ColumnSpec,
  type FilterOp,
  type RowFilter,
  type TableSpec,
} from "@bridge/tables";
import { StandardDropdown } from "../components/shared/StandardDropdown.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";

/** Operators whose value is a calendar instant, so the box is a date field. */
const DATE_OPS: readonly FilterOp[] = ["before", "after", "on_or_before", "on_or_after"];
/** Operators whose value is a LIST of options, comma-separated in storage. */
const MULTI_OPS: readonly FilterOp[] = ["is_any_of", "is_none_of"];

/** The options a choice column offers, from whichever field declares them. */
function choicesOf(column: ColumnSpec | undefined): string[] {
  if (!column) return [];
  if (column.options?.length) return column.options;
  return column.statusGroups ? Object.keys(column.statusGroups) : [];
}

function needsDateBox(column: ColumnSpec | undefined, op: FilterOp): boolean {
  if (DATE_OPS.includes(op)) return true;
  const kind = column?.kind;
  return (
    (op === "is" || op === "is_not") &&
    (kind === "date" || kind === "createdTime" || kind === "lastEditedTime")
  );
}

export interface FilterBuilderProps {
  spec: TableSpec;
  filters: readonly RowFilter[];
  match: "all" | "any";
  onChange: (filters: RowFilter[], match: "all" | "any") => void;
  /** The ⋮ menu's Add-column slot, so the column picker offers it too. */
  addColumnSlot?: { onAdd?: () => void; addDisabledReason?: string };
}

export function FilterBuilder({
  spec,
  filters,
  match,
  onChange,
  addColumnSlot,
}: FilterBuilderProps) {
  const byId = useMemo(
    () => new Map(spec.columns.map((column) => [column.id, column])),
    [spec.columns],
  );

  function replace(index: number, next: RowFilter) {
    onChange(
      filters.map((filter, i) => (i === index ? next : filter)),
      match,
    );
  }

  /** Changing the column re-picks the operator: an operator the new kind does
   * not offer would be a filter the engine cannot evaluate. */
  function changeColumn(index: number, columnId: string) {
    const ops = filterOpsForKind(byId.get(columnId)?.kind ?? "text");
    const current = filters[index]!;
    const op = ops.includes(current.op) ? current.op : ops[0]!;
    replace(index, { field: columnId, op, value: VALUELESS_FILTER_OPS.includes(op) ? "" : current.value });
  }

  function addFilter() {
    const column = spec.columns[0];
    if (!column) return;
    const op = filterOpsForKind(column.kind)[0]!;
    onChange([...filters, { field: column.id, op, value: "" }], match);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Filter</span>
        {/* The AND/OR control. It writes `filterMatch`, which is what the seven
            views already read — the field existed, nothing set it. */}
        <select
          aria-label="Match filters"
          value={match}
          disabled={filters.length < 2}
          onChange={(event) => onChange([...filters], event.target.value as "all" | "any")}
          className="h-7 rounded-lg border px-1.5 text-xs disabled:opacity-50"
          style={{ borderColor: "var(--color-border)" }}
        >
          <option value="all">Match all</option>
          <option value="any">Match any</option>
        </select>
      </div>

      {filters.length === 0 && (
        <p className="text-xs text-muted-foreground">No filters.</p>
      )}

      {filters.map((filter, index) => {
        const column = byId.get(filter.field);
        const ops = filterOpsForKind(column?.kind ?? "text");
        const choices = choicesOf(column);
        const valueless = VALUELESS_FILTER_OPS.includes(filter.op);
        return (
          <div key={`${filter.field}-${index}`} className="space-y-1.5 rounded-lg border p-1.5" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center gap-1.5">
              <StandardDropdown
                ariaLabel="Filter column"
                options={spec.columns.map((c) => ({ id: c.id, label: c.label }))}
                activeId={filter.field}
                onSelect={(id) => changeColumn(index, id)}
                addLabel="Add column"
                {...(addColumnSlot ?? {})}
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                aria-label="Remove filter"
                className="rounded border px-1.5 py-0.5 text-xs"
                style={{ borderColor: "var(--color-border)" }}
                onClick={() =>
                  onChange(
                    filters.filter((_, i) => i !== index),
                    match,
                  )
                }
              >
                ✕
              </button>
            </div>
            <StandardDropdown
              ariaLabel="Filter operator"
              options={ops.map((op) => ({ id: op, label: FILTER_OP_LABELS[op] }))}
              activeId={filter.op}
              onSelect={(op) =>
                replace(index, {
                  ...filter,
                  op: op as FilterOp,
                  value: VALUELESS_FILTER_OPS.includes(op as FilterOp) ? "" : filter.value,
                })
              }
              className="w-full"
            />
            {/* The value control follows the OPERATOR, not the column: hidden
                where the operator carries its own meaning, a native date field
                where it compares instants, a set of checkboxes where it takes
                a list. */}
            {valueless ? null : MULTI_OPS.includes(filter.op) && choices.length > 0 ? (
              <div className="max-h-32 space-y-0.5 overflow-auto">
                {choices.map((choice) => {
                  const selected = filter.value
                    .split(",")
                    .map((part) => part.trim())
                    .filter(Boolean);
                  const on = selected.includes(choice);
                  return (
                    <label key={choice} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          replace(index, {
                            ...filter,
                            value: (on
                              ? selected.filter((part) => part !== choice)
                              : [...selected, choice]
                            ).join(","),
                          })
                        }
                      />
                      {choice}
                    </label>
                  );
                })}
              </div>
            ) : (
              <Input
                type={needsDateBox(column, filter.op) ? "date" : "text"}
                aria-label="Filter value"
                placeholder={FILTER_OP_LABELS[filter.op]}
                value={filter.value}
                onChange={(event) => replace(index, { ...filter, value: event.target.value })}
                className="h-8 w-full rounded-lg border"
                style={{ borderColor: "var(--color-border)" }}
              />
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={spec.columns.length === 0}
          onClick={addFilter}
        >
          Add filter
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={filters.length === 0}
          onClick={() => onChange([], match)}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
