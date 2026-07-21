import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, GitPullRequestArrow, Undo2 } from "lucide-react";
import { applyFilters, applySorts } from "@bridge/tables";
import { Button } from "../../components/ui/button.js";
import type { DataRow, DataViewProps } from "../types.js";

interface TreeItem {
  row: DataRow;
  id: string;
  level: number;
  hasChildren: boolean;
  diagnostic?: string;
}

function relationId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return String(id);
  }
  return null;
}

export function TreeView({
  spec,
  view,
  data,
  onOpenRecord,
  onUpdate,
  onProposeTreeMove,
}: DataViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const parentField =
    view.parentBy ??
    spec.columns.find(
      (column) =>
        column.kind === "relation" &&
        (column.relationParent === true || column.relationTarget === spec.id),
    )?.id;

  const items = useMemo(() => {
    if (!parentField) return [];
    const rows = applySorts(
      applyFilters(data, view.rowFilters, view.filterMatch),
      view.sorts,
    );
    const byId = new Map<string, DataRow>();
    const children = new Map<string, string[]>();

    rows.forEach((row, index) => {
      const id = String(row["id"] ?? index);
      byId.set(id, row);
      const parentId = relationId(row[parentField]);
      if (parentId) children.set(parentId, [...(children.get(parentId) ?? []), id]);
    });

    const roots = [...byId.entries()]
      .filter(([, row]) => {
        const parentId = relationId(row[parentField]);
        return !parentId || !byId.has(parentId);
      })
      .map(([id]) => id);
    const flattened: TreeItem[] = [];
    const visited = new Set<string>();

    const walk = (id: string, level: number, ancestry: Set<string>, diagnostic?: string) => {
      const row = byId.get(id);
      if (!row || visited.has(id)) return;
      if (ancestry.has(id)) return;
      visited.add(id);
      const childIds = children.get(id) ?? [];
      flattened.push({ row, id, level, hasChildren: childIds.length > 0, diagnostic });
      if (collapsed.has(id)) return;
      const nextAncestry = new Set(ancestry);
      nextAncestry.add(id);
      for (const childId of childIds) {
        walk(childId, level + 1, nextAncestry);
      }
    };

    roots.forEach((id) => {
      const row = byId.get(id);
      const parentId = row ? relationId(row[parentField]) : null;
      walk(id, 0, new Set(), parentId ? "Parent record is unavailable" : undefined);
    });
    for (const id of byId.keys()) {
      if (!visited.has(id)) walk(id, 0, new Set(), "Cycle detected in parent relation");
    }
    return flattened;
  }, [collapsed, data, parentField, view.filterMatch, view.rowFilters, view.sorts]);

  if (!parentField) {
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        Tree needs a self-referential parent Relation column.
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        No rows yet. Add one to start this hierarchy.
      </div>
    );
  }

  const titleField =
    spec.columns.find((column) => column.id !== parentField && column.kind === "text")?.id ??
    spec.columns.find((column) => column.id !== parentField)?.id;
  const pathField = spec.columns.find((column) => column.id === "path")?.id;
  const checkboxField = spec.columns.find((column) => column.kind === "checkbox")?.id;

  return (
    <div className="rounded-md border overflow-hidden">
      {onProposeTreeMove && (
        <div className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
          <GitPullRequestArrow className="size-3.5" />
          Re-parenting creates a governed proposal; it never rewrites the hierarchy directly.
        </div>
      )}
      <div role="tree" aria-label={`${spec.id} hierarchy`} className="divide-y">
        {items.map(({ row, id, level, hasChildren, diagnostic }) => (
          <div
            key={id}
            role="treeitem"
            aria-level={level + 1}
            aria-expanded={hasChildren ? !collapsed.has(id) : undefined}
            className="flex min-h-10 items-center gap-2 px-2 py-1.5 hover:bg-muted/30"
            style={{ paddingLeft: `${8 + level * 24}px` }}
            draggable={Boolean(onProposeTreeMove)}
            onDragStart={(event) => event.dataTransfer.setData("text/bridge-tree-row-id", id)}
            onDragOver={(event) => {
              if (onProposeTreeMove) event.preventDefault();
            }}
            onDrop={(event) => {
              const childId = event.dataTransfer.getData("text/bridge-tree-row-id");
              if (childId && childId !== id && onProposeTreeMove) {
                void onProposeTreeMove(childId, id);
              }
            }}
          >
            <button
              type="button"
              className="grid size-6 place-items-center rounded hover:bg-muted disabled:opacity-30"
              disabled={!hasChildren}
              aria-label={collapsed.has(id) ? "Expand children" : "Collapse children"}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            >
              {hasChildren && (collapsed.has(id) ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />)}
            </button>
            {checkboxField && (
              <input
                type="checkbox"
                checked={Boolean(row[checkboxField])}
                disabled={!onUpdate}
                aria-label={`Toggle ${String(row[titleField ?? "id"] ?? id)}`}
                onChange={(event) => void onUpdate?.(id, { [checkboxField]: event.target.checked })}
              />
            )}
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-sm font-medium disabled:cursor-default"
              disabled={!onOpenRecord}
              onClick={() => onOpenRecord?.(row)}
            >
              {String(row[titleField ?? "id"] ?? id)}
            </button>
            {pathField && row[pathField] != null && (
              <code className="hidden max-w-48 truncate text-xs text-muted-foreground sm:block">
                {String(row[pathField])}
              </code>
            )}
            {diagnostic && <span className="text-xs text-amber-700">{diagnostic}</span>}
            {onProposeTreeMove && relationId(row[parentField]) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                title="Propose moving to the root"
                aria-label="Propose moving to the root"
                onClick={() => void onProposeTreeMove(id, null)}
              >
                <Undo2 className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
