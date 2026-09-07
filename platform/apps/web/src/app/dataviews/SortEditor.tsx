/**
 * Multi-level sort (TASK-110).
 *
 * `applySorts` has always broken ties Notion-style — `sorts[0]` first, later
 * entries deciding equal rows — but every write site in the UI REPLACED the
 * array with a single entry, so the second level was unreachable. This editor
 * appends instead of replacing, and says which level is doing what.
 *
 * The column menu's own "Sort ascending" still replaces level one, which is
 * what a single command on a single column should mean.
 */
import type { SortSpec, TableSpec } from "@bridge/tables";
import { Button } from "../components/ui/button.js";
import { StandardDropdown } from "../components/shared/StandardDropdown.js";

export interface SortEditorProps {
  spec: TableSpec;
  sorts: readonly SortSpec[];
  onChange: (sorts: SortSpec[]) => void;
}

export function SortEditor({ spec, sorts, onChange }: SortEditorProps) {
  function move(index: number, delta: number) {
    const next = [...sorts];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  const unused = spec.columns.filter((column) => !sorts.some((sort) => sort.id === column.id));

  return (
    <div className="w-64 space-y-1.5 p-2">
      <div className="text-xs font-medium text-muted-foreground">Sort</div>
      {sorts.length === 0 ? (
        <p className="text-xs text-muted-foreground">Not sorted.</p>
      ) : (
        sorts.map((sort, index) => (
          <div key={sort.id} className="flex items-center gap-1">
            <span className="w-10 shrink-0 text-xs text-muted-foreground">
              {index === 0 ? "Sort" : "then"}
            </span>
            <StandardDropdown
              ariaLabel={index === 0 ? "Sort column" : "Tie-break column"}
              options={spec.columns.map((column) => ({ id: column.id, label: column.label }))}
              activeId={sort.id}
              onSelect={(id) =>
                onChange(sorts.map((entry, i) => (i === index ? { ...entry, id } : entry)))
              }
              className="min-w-0 flex-1"
            />
            <select
              aria-label="Sort direction"
              value={sort.dir}
              onChange={(event) =>
                onChange(
                  sorts.map((entry, i) =>
                    i === index ? { ...entry, dir: event.target.value as "asc" | "desc" } : entry,
                  ),
                )
              }
              className="h-7 rounded-lg border px-1 text-xs"
              style={{ borderColor: "var(--color-border)" }}
            >
              <option value="asc">A→Z</option>
              <option value="desc">Z→A</option>
            </select>
            <button
              type="button"
              aria-label="Move sort up"
              disabled={index === 0}
              className="rounded border px-1 text-xs disabled:opacity-40"
              style={{ borderColor: "var(--color-border)" }}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Move sort down"
              disabled={index === sorts.length - 1}
              className="rounded border px-1 text-xs disabled:opacity-40"
              style={{ borderColor: "var(--color-border)" }}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Remove sort"
              className="rounded border px-1 text-xs"
              style={{ borderColor: "var(--color-border)" }}
              onClick={() => onChange(sorts.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        ))
      )}
      <div className="flex items-center gap-2 pt-0.5">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={unused.length === 0}
          onClick={() => unused[0] && onChange([...sorts, { id: unused[0].id, dir: "asc" }])}
        >
          {sorts.length === 0 ? "Add sort" : "Add tie-breaker"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={sorts.length === 0}
          onClick={() => onChange([])}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
