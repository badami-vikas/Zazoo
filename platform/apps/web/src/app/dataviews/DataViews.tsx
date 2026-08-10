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
 * `height: 100%` resolved to ZERO and vanished. The canvas grid hit this first
 * (canvas cannot size itself to content) and papered over it with a `min-h-96`
 * floor of its own. That renderer is gone (ADR-194), but the contract it forced
 * is the right one and still holds: the shell ALWAYS hands its view a definite
 * height. `TableView` relies on it too — its sticky header, sticky aggregate
 * footer and row windowing all need a real scroll viewport, not a box that
 * grows to fit its own content.
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
import { StandardDropdown } from "../components/shared/StandardDropdown.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { ArrowUpDown, Eye, MoreVertical, Plus, Search } from "lucide-react";
import type { DataRow, DataViewProps } from "./types.js";
import { ControlPanel } from "./ControlPanel.js";

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
  /** Optional handler for the View dropdown's pinned "＋ Add view" slot (§5e).
   * Omitted until saved per-user view configs land; the dropdown simply hides
   * the slot rather than showing a control that does nothing (§3a). */
  onAddView?: () => void;
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
  onAddView,
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

  /** What the "Sort by" row reports without being opened. */
  const activeSortLabel =
    activeView.sorts.length === 0
      ? null
      : (spec.columns.find((col) => col.id === activeView.sorts[0]!.id)?.label ??
        activeView.sorts[0]!.id);

  /** "Reset view" is only offered when there is something to reset — an enabled
   * control that would visibly do nothing is the thing AP-021 forbids. Hidden
   * columns are local state here, so they count as modification too. */
  const viewIsModified =
    activeView.sorts.length > 0 ||
    activeView.rowFilters.length > 0 ||
    hiddenColumns.size > 0 ||
    search !== "" ||
    filterDraft !== "";

  function resetView() {
    setHiddenColumns(new Set());
    setSearch("");
    setFilterDraft("");
    onViewChange({ ...activeView!, sorts: [], rowFilters: [] });
  }

  return (
    <div className={fill ? "flex h-full min-h-0 flex-col gap-3" : "flex flex-col gap-3"}>
      <div className="flex flex-none flex-wrap items-center justify-between gap-2">
        {/* §5e: the View dropdown is a StandardDropdown like every other dropdown —
            selected first, searchable, pinned Add slot. Not a bespoke Select. */}
        <StandardDropdown
          ariaLabel="Switch view"
          options={switcherKinds.map((kind) => {
            const Icon = VIEW_METADATA[kind].icon;
            return {
              id: kind,
              label: VIEW_METADATA[kind].label,
              icon: <Icon className="size-4 shrink-0" />,
            };
          })}
          activeId={activeView.kind}
          onSelect={(kind) =>
            onViewChange(viewConfigForKind(spec, kind as ViewKind, activeView))
          }
          {...(onAddView ? { onAdd: onAddView } : {})}
          addLabel="Add view"
          emptyLabel="No eligible views"
        />

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

          {/* The overflow menu, in the Avilo shape: the view-level commands
              collect behind one ⋮ instead of each claiming a toolbar button.
              "Columns" was the only one that had, and it is now "View options"
              — the same checkbox list, under the name the reference uses. Each
              entry carries its own count on the right so the menu says what
              state the View is in before it is opened. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label="View actions" className="px-2">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {/* Disabled with a stated reason rather than hidden: AP-021 —
                  interactive-looking UI must perform OR explain. Adding a
                  column is a schema mutation and this surface has no governed
                  capability for one. */}
              <DropdownMenuItem
                disabled
                title="Unavailable: adding a column is a schema mutation, and this surface has no governed schema-mutation capability"
                className="justify-between"
              >
                <span className="flex items-center gap-2">
                  <Plus className="size-4" /> Add column
                </span>
                <span className="text-xs text-muted-foreground">{spec.columns.length} available</span>
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="justify-between">
                  <span className="flex items-center gap-2">
                    <Eye className="size-4" /> View options
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {hiddenColumns.size} hidden
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
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
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="justify-between">
                  <span className="flex items-center gap-2">
                    <ArrowUpDown className="size-4" /> Sort by
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {activeSortLabel ?? "None"}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    disabled={!activeView || activeView.sorts.length === 0}
                    onSelect={() => activeView && onViewChange({ ...activeView, sorts: [] })}
                  >
                    Clear sort
                  </DropdownMenuItem>
                  {spec.columns.map((col) => (
                    <DropdownMenuItem
                      key={col.id}
                      onSelect={() =>
                        activeView &&
                        onViewChange({ ...activeView, sorts: [{ id: col.id, dir: "asc" }] })
                      }
                    >
                      {col.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={resetView} disabled={!viewIsModified}>
                Reset view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ControlPanel spec={spec} eligibleKinds={switcherKinds} />
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
