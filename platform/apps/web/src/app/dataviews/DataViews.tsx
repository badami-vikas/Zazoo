/**
 * <DataViews> — the single shell every entity's views render through
 * (docs/wiki/vision.md "View grammar": "`<DataViews>` shell = enforcement
 * point -> Phase-1 critical path"). Picks the registered component for the
 * active view's kind, renders view-switcher tabs (only kinds valid for the
 * spec), column show/hide, and a filter bar.
 *
 * ENFORCEMENT: the registry lookup (registry.ts's VIEW_COMPONENT_REGISTRY) is
 * the only path from a ViewConfig.kind to a rendered component. An unknown
 * kind renders this component's explicit error message, never a dynamic
 * import or a silently-blank view — "generation = configs of REGISTERED
 * components only" is enforced HERE, not by convention elsewhere.
 *
 * Mobile-width-safe from day 1: the switcher tabs wrap (`flex-wrap`) and the
 * column-visibility/filter controls stack under `sm:` rather than assuming
 * desktop width; each individual view component (TableView/KanbanView/...)
 * carries its own mobile behavior (scroll/swipe/agenda-collapse).
 */
import { useMemo, useState } from "react";
import type { RowFilter, TableSpec, ViewConfig } from "@bridge/tables";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import { VIEW_COMPONENT_REGISTRY, REGISTERED_VIEW_KINDS, isRegisteredViewKind } from "./registry.js";
import type { DataRow } from "./types.js";

/** Relationship-shaped table ids are grammar-restricted to graph|table (see
 * packages/core/src/blueprint.ts) — the same restriction is mirrored here so
 * the switcher never even OFFERS kanban/calendar/gallery for a relationship
 * spec, rather than only rejecting it after the fact at compile time. */
const RELATIONSHIP_ALLOWED_KINDS: ViewConfig["kind"][] = ["network", "table"];

export interface DataViewsProps {
  spec: TableSpec;
  view: ViewConfig;
  data: DataRow[];
  onViewChange: (next: ViewConfig) => void;
  /** True when this TableSpec projects a relationship node type — restricts
   * the switcher to graph|table per the grammar. Defaults to false. */
  isRelationship?: boolean;
  /** Additional view kinds this spec supports (e.g. all registered kinds for a
   * normal entity), used to build the switcher tabs. Defaults to every
   * registered kind (minus the relationship restriction, if applicable). */
  availableKinds?: ViewConfig["kind"][];
}

export function DataViews({ spec, view, data, onViewChange, isRelationship = false, availableKinds }: DataViewsProps) {
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [filterDraft, setFilterDraft] = useState("");

  const switcherKinds = useMemo(() => {
    const base = availableKinds ?? REGISTERED_VIEW_KINDS;
    const restricted = isRelationship ? base.filter((k) => RELATIONSHIP_ALLOWED_KINDS.includes(k)) : base;
    return restricted.filter(isRegisteredViewKind);
  }, [availableKinds, isRelationship]);

  const visibleSpec: TableSpec = useMemo(
    () => ({ ...spec, columns: spec.columns.filter((c) => !hiddenColumns.has(c.id)) }),
    [spec, hiddenColumns],
  );

  if (!isRegisteredViewKind(view.kind)) {
    // The enforcement boundary: an unregistered kind never reaches a component.
    return (
      <div className="border border-destructive/50 rounded-md p-4 text-sm text-destructive">
        <div className="font-medium">Unregistered view kind: "{view.kind}"</div>
        <div className="text-muted-foreground mt-1">
          {"<DataViews> only renders configurations of registered components ("}
          {REGISTERED_VIEW_KINDS.join(", ")}
          {"). This view cannot be displayed."}
        </div>
      </div>
    );
  }

  const ViewComponent = VIEW_COMPONENT_REGISTRY[view.kind];

  function applyTextFilter() {
    const nextFilters: RowFilter[] = filterDraft
      ? [{ field: spec.columns[0]?.id ?? "", op: "contains", value: filterDraft }]
      : [];
    onViewChange({ ...view, rowFilters: nextFilters });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={view.kind} onValueChange={(kind) => onViewChange({ ...view, kind: kind as ViewConfig["kind"] })}>
          <TabsList className="flex-wrap h-auto">
            {switcherKinds.map((kind) => (
              <TabsTrigger key={kind} value={kind}>
                {kind}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder={`Filter ${spec.id}…`}
            value={filterDraft}
            onChange={(e) => setFilterDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyTextFilter()}
            className="h-8 w-40"
          />
          <Button size="sm" variant="outline" onClick={applyTextFilter}>
            Filter
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {spec.columns.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={!hiddenColumns.has(col.id)}
                  onCheckedChange={(checked) => {
                    setHiddenColumns((prev) => {
                      const next = new Set(prev);
                      if (checked) next.delete(col.id);
                      else next.add(col.id);
                      return next;
                    });
                  }}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ViewComponent spec={visibleSpec} view={view} data={data} onViewChange={onViewChange} />
    </div>
  );
}
