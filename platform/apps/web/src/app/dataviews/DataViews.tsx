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
 * desktop width; each individual view component (TableView/BoardView/...)
 * carries its own mobile behavior (scroll/swipe/agenda-collapse).
 */
import { useMemo, useRef, useState } from "react";
import type { RowFilter, TableSpec, ViewConfig, ViewKind } from "@bridge/tables";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js";
import {
  VIEW_COMPONENT_REGISTRY,
  VIEW_METADATA,
  REGISTERED_VIEW_KINDS,
  isRegisteredViewKind,
} from "./registry.js";
import { computeEligibleKinds, migrateViewConfig, viewConfigForKind } from "./eligibility.js";
import type { DataRow, DataViewProps } from "./types.js";

export interface DataViewsProps
  extends Omit<DataViewProps, "spec" | "view" | "data" | "onViewChange"> {
  spec: TableSpec;
  view: ViewConfig;
  data: DataRow[];
  onViewChange: (next: ViewConfig) => void;
  /** Deprecated compatibility input. Eligibility now comes only from columns. */
  isRelationship?: boolean;
  /** Additional view kinds this spec supports (e.g. all registered kinds for a
   * normal entity), used to build the switcher tabs. Defaults to every
   * registered kind (minus the relationship restriction, if applicable). */
  availableKinds?: ViewKind[];
}

export function DataViews({
  spec,
  view,
  data,
  onViewChange,
  isRelationship: _legacyRelationshipFlag = false,
  availableKinds,
  ...viewProps
}: DataViewsProps) {
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [filterDraft, setFilterDraft] = useState("");
  const [filterColumn, setFilterColumn] = useState(spec.columns[0]?.id ?? "");
  const filterInput = useRef<HTMLInputElement>(null);

  const switcherKinds = useMemo(() => {
    const eligible = computeEligibleKinds(spec);
    const requested = availableKinds ?? eligible;
    return REGISTERED_VIEW_KINDS.filter(
      (kind) => eligible.includes(kind) && requested.includes(kind),
    );
  }, [availableKinds, spec]);

  const visibleSpec: TableSpec = useMemo(
    () => ({ ...spec, columns: spec.columns.filter((c) => !hiddenColumns.has(c.id)) }),
    [spec, hiddenColumns],
  );

  const activeView = migrateViewConfig(spec, view);
  if (!activeView || !isRegisteredViewKind(activeView.kind)) {
    // The enforcement boundary: an unregistered kind never reaches a component.
    return (
      <div className="border border-destructive/50 rounded-md p-4 text-sm text-destructive">
        <div className="font-medium">Unregistered view kind: "{String(view.kind)}"</div>
        <div className="text-muted-foreground mt-1">
          {"<DataViews> only renders configurations of registered components ("}
          {REGISTERED_VIEW_KINDS.join(", ")}
          {"). This view cannot be displayed."}
        </div>
      </div>
    );
  }

  if (!switcherKinds.includes(activeView.kind)) {
    return (
      <div className="border border-destructive/50 rounded-md p-4 text-sm text-destructive">
        <div className="font-medium">
          {VIEW_METADATA[activeView.kind].label} is not eligible for {spec.id}.
        </div>
        <div className="text-muted-foreground mt-1">
          Add the required column metadata or choose one of: {switcherKinds.join(", ")}.
        </div>
      </div>
    );
  }

  const ViewComponent = VIEW_COMPONENT_REGISTRY[activeView.kind];

  function applyTextFilter() {
    const nextFilters: RowFilter[] = filterDraft
      ? [{ field: filterColumn, op: "contains", value: filterDraft }]
      : [];
    onViewChange({ ...activeView!, rowFilters: nextFilters });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={activeView.kind}
          onValueChange={(kind) =>
            onViewChange(viewConfigForKind(spec, kind as ViewKind, activeView))
          }
        >
          <TabsList className="flex-wrap h-auto">
            {switcherKinds.map((kind) => (
              <TabsTrigger key={kind} value={kind}>
                {VIEW_METADATA[kind].label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            ref={filterInput}
            placeholder={`Filter ${spec.columns.find((column) => column.id === filterColumn)?.label ?? spec.id}…`}
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

      <ViewComponent
        spec={visibleSpec}
        view={activeView}
        data={data}
        onViewChange={onViewChange}
        {...viewProps}
        onRequestFilter={(columnId) => {
          setFilterColumn(columnId);
          viewProps.onRequestFilter?.(columnId);
          window.setTimeout(() => filterInput.current?.focus(), 0);
        }}
        onHideColumn={(columnId) => {
          setHiddenColumns((current) => new Set(current).add(columnId));
          viewProps.onHideColumn?.(columnId);
        }}
      />
    </div>
  );
}
