/**
 * <DataViews> — the single shell every entity's views render through
 * (docs/wiki/vision.md "View grammar": "`<DataViews>` shell = enforcement
 * point -> Phase-1 critical path"). Picks the registered component for the
 * active view's kind, renders the view-switcher dropdown (only kinds valid
 * for the spec), column show/hide, and a filter bar.
 *
 * ENFORCEMENT: the registry lookup (registry.ts's VIEW_COMPONENT_REGISTRY) is
 * the only path from a ViewConfig.kind to a rendered component. An unknown
 * kind renders this component's explicit error message, never a dynamic
 * import or a silently-blank view — "generation = configs of REGISTERED
 * components only" is enforced HERE, not by convention elsewhere.
 *
 * Mobile-width-safe from day 1: the switcher is a compact dropdown and the
 * column-visibility/filter controls stack under `sm:` rather than assuming
 * desktop width; each individual view component (TableView/BoardView/...)
 * carries its own mobile behavior (scroll/swipe/agenda-collapse).
 *
 * HEIGHT IS DECLARED HERE, NOT GUESSED DOWNSTREAM. This shell used to be a
 * `space-y-3` stack — a box with no definite height — so a view that asks for
 * `height: 100%` (the canvas grid does; canvas cannot size itself to content)
 * resolved to ZERO and vanished. GlideTableView papered over that with a
 * `min-h-96` floor of its own. The floor is gone; the contract is now: the
 * shell ALWAYS hands its view a definite height.
 *
 *   - `fill` (default): the shell is a flex column at `h-full`, and the view
 *     takes `min-h-0 flex-1` — every pixel the Page gave the shell. Callers
 *     mount it inside `<ModuleSurfaceLayout>`'s table region, whose height is
 *     definite, so the table covers the content viewport.
 *   - `fill={false}`: for the one surface that stacks SEVERAL views down an
 *     auto-height page (OrganizationPage's plan preview). There is no viewport
 *     share to hand out, so the view gets an explicit fixed height instead.
 *     A `min-height` would NOT do — percentage heights do not resolve against
 *     it — which is exactly why the old floor never worked.
 *
 * The view box is `overflow-auto` in both modes — the canvas table scrolls its
 * own body and never overflows it, while the content-sized renderers (Form,
 * Board, Gallery, Tree, Calendar, Graph, Dashboard) can be taller than the box
 * and must stay reachable rather than being clipped. Neither mode sets
 * `overscroll-behavior`: scroll chaining out to the page scroller when the
 * table bottoms out is the WANTED behaviour, and `contain` would break it.
 */
import { useMemo, useRef, useState } from "react";
import type { RowFilter, TableSpec, ViewConfig, ViewKind } from "@bridge/tables";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
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
import { filterRowsByQuery } from "./rowSearch.js";
import { Search } from "lucide-react";
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
  /** Placeholder for the free-text search box (e.g. "Search deals…"). Defaults to "Search…". */
  searchPlaceholder?: string;
  /** Whether this shell fills the height its parent gives it (default) or
   * declares its own fixed view height. See the header block: `false` is only
   * for a page that stacks several views in auto-height flow. */
  fill?: boolean;
}

export function DataViews({
  spec,
  view,
  data,
  onViewChange,
  isRelationship: _legacyRelationshipFlag = false,
  availableKinds,
  searchPlaceholder = "Search…",
  fill = true,
  ...viewProps
}: DataViewsProps) {
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [filterDraft, setFilterDraft] = useState("");
  const [filterColumn, setFilterColumn] = useState(spec.columns[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const filterInput = useRef<HTMLInputElement>(null);

  // Free-text search across all columns, applied before the view's own column
  // filters/sorts. Shared by every Module table (empty query = no filtering).
  const searchedData = useMemo(() => filterRowsByQuery(data, search), [data, search]);

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
    <div className={fill ? "flex h-full min-h-0 flex-col gap-3" : "flex flex-col gap-3"}>
      <div className="flex flex-none flex-wrap items-center justify-between gap-2">
        <Select
          value={activeView.kind}
          onValueChange={(kind) =>
            onViewChange(viewConfigForKind(spec, kind as ViewKind, activeView))
          }
        >
          <SelectTrigger size="sm" aria-label="Switch view" className="w-auto min-w-[8.5rem] gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {switcherKinds.map((kind) => {
              const Icon = VIEW_METADATA[kind].icon;
              return (
                <SelectItem key={kind} value={kind}>
                  <Icon className="size-4" />
                  {VIEW_METADATA[kind].label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-40 pl-8"
            />
          </div>
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

      {/* THE DEFINITE-HEIGHT BOX. Nothing below this line may fall back to
          content sizing — see the header block. */}
      <div className={fill ? "min-h-0 flex-1 overflow-auto" : "h-[28rem] overflow-auto"}>
        <ViewComponent
          spec={visibleSpec}
          view={activeView}
          data={searchedData}
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
    </div>
  );
}
