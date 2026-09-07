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
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { applyFilters, applySorts, defaultViewConfig, filterOpsForKind } from "@bridge/tables";
import type { ColumnKind, RowFilter, TableSpec, ViewConfig, ViewKind } from "@bridge/tables";
import { StandardDropdown } from "../components/shared/StandardDropdown.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover.js";
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
import { useSavedViews } from "./useSavedViews.js";
import { FilterBuilder } from "./FilterBuilder.js";
import { SortEditor } from "./SortEditor.js";
import { PaginationBar } from "./PaginationBar.js";
import { DEFAULT_PAGE_SIZE } from "./pagination.js";
import { columnIdFromLabel } from "./columnId.js";
import { RECORD_SECTION_IDS, RECORD_SECTION_LABELS, useRecordSections } from "./useRecordSections.js";
import { RecordPage } from "./RecordPage.js";
import { useShareGrants, type ShareAccessLevel } from "./useShareGrants.js";
import { useRecordMetadata } from "./useRecordMetadata.js";
import { ArrowUpDown, ChevronDown, ChevronUp, Eye, Filter, LayoutList, List as ListIcon, MoreVertical, Plus, Search } from "lucide-react";
import type { DataRow, DataViewProps } from "./types.js";

/**
 * THE SANDWICH ROW never wraps to a second line (user directive 2026-08-10:
 * "there's only one line of elements between toggle and dashboard, they
 * never leak into 2 lines"). Width pressure is absorbed in three stages
 * instead: the search box (the row's one flexible element) shrinks first —
 * pure CSS, no JS needed — then these items give up their text label for an
 * icon, THEN drop out of the row into the 3-dots menu, one at a time, in
 * this priority order (first = first to go).
 */
const COLLAPSE_PRIORITY = ["filter-label", "view-label", "list-label", "filter"] as const;
type CollapseKey = (typeof COLLAPSE_PRIORITY)[number];

/**
 * Measures the row after every layout and, whenever its content overflows
 * its own box (`scrollWidth > clientWidth` — reliable only because the row
 * is `flex-nowrap overflow-hidden`, so overflow never wraps, it only
 * clips), collapses one more item from `COLLAPSE_PRIORITY`. A width GROWTH
 * (ResizeObserver) resets to fully-expanded first, so items reappear as
 * soon as there's room again rather than staying collapsed forever.
 */
function useToolbarOverflow(rowRef: RefObject<HTMLDivElement | null>): Set<CollapseKey> {
  const [containerWidth, setContainerWidth] = useState(0);
  const [hiddenCount, setHiddenCount] = useState(0);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [rowRef]);

  // A wider box may fit everything again — always re-try from expanded.
  useLayoutEffect(() => {
    setHiddenCount(0);
  }, [containerWidth]);

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth && hiddenCount < COLLAPSE_PRIORITY.length) {
      setHiddenCount((count) => count + 1);
    }
  }, [hiddenCount, containerWidth, rowRef]);

  return useMemo(() => new Set(COLLAPSE_PRIORITY.slice(0, hiddenCount)), [hiddenCount]);
}

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
  /** Optional dashboard/stat-card content (user directive 2026-08-10: "The
   * dashboard should appear below the search bar row and its collapsible
   * arrow should be inline"). Renders BELOW the toolbar row — never above it
   * as a page-local banner — behind an inline collapse toggle in that same
   * row, not a separate arrow row of its own. Expanded by default. */
  insights?: ReactNode;
  /**
   * §5's "Custom actions" slot: page-specific controls (scope toggles, a
   * governed action button). This slot exists because its absence is what made
   * pages diverge — with nowhere to put a Goals/Candidates toggle, TaskManager
   * built a second bordered row of its own beneath the toolbar.
   *
   * IT NO LONGER RENDERS IN THE ROW (user report 2026-09-05: "no other buttons
   * should appear … If necessary, add additional options inside 3 dots"). The
   * row is exactly List + View + Search on the left and Filter + ⋮ on the
   * right; whatever a page passes here becomes a labelled group at the top of
   * the ⋮ menu, reaching the same handler from a different address.
   */
  actions?: ReactNode;
  /**
   * How this surface opens a Record page for a NEW Record. Supplying it makes
   * New navigate; without it the shell falls back to rendering the Record page
   * in place of the view (the surfaces that have no Record route of their own).
   */
  onOpenNewRecord?: () => void;
  /**
   * The Module this Database belongs to, for an Record page's Sections.
   * Defaults to the spec id's own prefix (`deal-pilot.deals` → `deal-pilot`),
   * which is how nearly every spec in the repository is named; the handful
   * whose Database is not named after its Module pass it.
   */
  moduleName?: string;
  /**
   * What the Event log calls these Records (TASK-063). Supplying it fills the
   * derived `createdTime`/`createdBy`/`lastEditedTime`/`lastEditedBy` columns
   * for the rows on screen; without it they render honestly empty rather than
   * showing a time nothing recorded.
   */
  recordEntityType?: string;
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
  insights,
  actions,
  onOpenNewRecord,
  moduleName,
  recordEntityType,
  ...viewProps
}: DataViewsProps) {
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  // TASK-062 — saved Lists. Keyed by the Database (the TableSpec id), so a
  // second Database shows its own Views and never this one's.
  const savedViews = useSavedViews(spec.id);
  const [listNameDraft, setListNameDraft] = useState("");
  const [listSaveError, setListSaveError] = useState<string | null>(null);
  const [listPopoverOpen, setListPopoverOpen] = useState(false);
  // TASK-064 — the Share panel's data. Keyed by the SELECTED saved List,
  // because a share points at a saved View and "All" is not one.
  const shareGrants = useShareGrants(savedViews.selectedId);
  const [shareLevel, setShareLevel] = useState<ShareAccessLevel>("view");
  const [shareLink, setShareLink] = useState<string | null>(null);
  // TASK-083 — which Sections every Record page of this Database shows.
  const recordSections = useRecordSections(spec.id);
  /** New is open. The Record page replaces the view; nothing is written until
   *  Save, so backing out is just this flag going false. */
  const [creating, setCreating] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [search, setSearch] = useState("");
  /** The first row on screen. Pagination is the SHELL's, not each page's
   * (TASK-110) — see <PaginationBar>. */
  const [offset, setOffset] = useState(0);
  /** Managing the selected List: rename draft and the delete confirmation.
   * Deleting a List is destructive and irreversible, so it asks first. */
  const [listRenameDraft, setListRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const hidden = useToolbarOverflow(rowRef);

  /**
   * The "Add column" slot, answered by the SERVER (TASK-084 + the 2026-09-05
   * user report "why is add column inactive… I should always be able to add
   * columns in all modules").
   *
   * It used to carry one hard-coded sentence saying no capability existed —
   * true when nothing behind it could add a column, a lie once a Module
   * Database can. Both halves now come from `tableSchema.get`: the handler
   * exists only where `canAddColumn` is true, and the disabled reason is the
   * server's `addReason`, never a sentence composed here.
   *
   * The new column arrives named "New column" and is renamed through the
   * column menu's own Rename, rather than opening a second naming dialog for
   * a field the menu already edits.
   * ponytail: no name/kind picker; add one if users start adding several
   * columns of different kinds in a row.
   */
  const addColumnSlot = useMemo<{ onAdd?: () => void; addDisabledReason?: string }>(() => {
    const schema = viewProps.columnSchema;
    if (!schema?.addColumn || !schema.capability?.canAddColumn) {
      return {
        addDisabledReason:
          schema?.capability?.addReason ??
          schema?.capability?.reason ??
          "This surface has not asked the server whether this Database can gain a column.",
      };
    }
    const add = schema.addColumn;
    return {
      onAdd: () => {
        void add(columnIdFromLabel("New column", spec.columns), "New column", "text");
      },
    };
  }, [viewProps.columnSchema, spec.columns]);

  // Derived metadata first, so a search or a sort on "last edited" sees the
  // real value rather than an empty cell (TASK-063).
  const withMetadata = useRecordMetadata(spec, data, recordEntityType);
  // Free-text search across all columns, applied before the view's own column
  // filters/sorts. Shared by every Module table (empty query = no filtering).
  const searchedData = useMemo(
    () => filterRowsByQuery(withMetadata, search),
    [withMetadata, search],
  );

  /** columnId -> kind, so `applyFilters` compares a date as a date rather
   * than as text. The map the engine has always accepted and nothing passed. */
  const columnKinds = useMemo(
    () =>
      Object.fromEntries(spec.columns.map((column) => [column.id, column.kind])) as Record<
        string,
        ColumnKind
      >,
    [spec.columns],
  );

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
  /**
   * FILTER AND SORT HAPPEN HERE, ONCE, WITH THE COLUMN KINDS.
   *
   * The view components call `applyFilters` themselves but have no kind map to
   * pass, so a date filter compared as text there. The shell has the spec, so
   * it filters and sorts first and hands the view an already-narrowed page with
   * `rowFilters: []` — filtering twice, the second time without kinds, would
   * undo exactly the sharpening this exists for.
   *
   * Above the early returns below because it is a hook: a filtered page is no
   * reason to change how many hooks this component runs.
   */
  const resolved = useMemo(
    () =>
      activeView
        ? applySorts(
            applyFilters(
              searchedData,
              activeView.rowFilters,
              activeView.filterMatch,
              columnKinds,
            ),
            activeView.sorts,
          )
        : searchedData,
    [searchedData, activeView, columnKinds],
  );
  const pageSize = activeView?.pageSize ?? DEFAULT_PAGE_SIZE;
  /** A filter that shrinks the result below the current window would otherwise
   * leave the user staring at an empty page four. */
  const pageOffset = offset >= resolved.length ? 0 : offset;
  const pageRows = useMemo(
    () => resolved.slice(pageOffset, pageOffset + pageSize),
    [resolved, pageOffset, pageSize],
  );
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
  /** What the view renders: this page's rows, and no filters left to re-apply. */
  const pagedView: ViewConfig = { ...activeView, rowFilters: [] };

  function changeFilters(nextFilters: RowFilter[], nextMatch: "all" | "any") {
    setOffset(0);
    onViewChange({ ...activeView!, rowFilters: nextFilters, filterMatch: nextMatch });
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
    search !== "";

  /** Save what is on screen — the view config AND the shell's own column
   * visibility — as a named List on this Database. */
  async function saveCurrentList() {
    const name = listNameDraft.trim();
    if (name === "") return;
    setListSaveError(null);
    try {
      await savedViews.save(name, activeView!, [...hiddenColumns]);
      setListNameDraft("");
      setListPopoverOpen(false);
    } catch (cause) {
      setListSaveError(cause instanceof Error ? cause.message : "Could not save this list");
    }
  }

  async function updateCurrentList() {
    setListSaveError(null);
    try {
      await savedViews.update(activeView!, [...hiddenColumns]);
      setListPopoverOpen(false);
    } catch (cause) {
      setListSaveError(cause instanceof Error ? cause.message : "Could not update this list");
    }
  }

  function resetView() {
    setHiddenColumns(new Set());
    setSearch("");
    setOffset(0);
    onViewChange({ ...activeView!, sorts: [], rowFilters: [], filterMatch: "all" });
  }

  const selectedList = savedViews.views.find((saved) => saved.id === savedViews.selectedId) ?? null;

  /** Every List verb reports the server's own failure text, never a sentence
   * composed here (ADR-247). */
  async function runListAction(action: () => Promise<void>) {
    setListSaveError(null);
    try {
      await action();
    } catch (cause) {
      setListSaveError(cause instanceof Error ? cause.message : "That did not work");
    }
  }

  return (
    <div className={fill ? "flex h-full min-h-0 flex-col gap-3" : "flex flex-col gap-3"}>
      {/* THE SANDWICH ROW (user directive 2026-08-10) — one line, always. It sits
          between the toggle strip above and the Insights band below, and it
          NEVER wraps to a second line: `flex-nowrap` + `min-w-0` on every
          child that can shrink. As the row runs out of width the response is
          staged, not a wrap: the search box narrows first (`ToolbarSearch`),
          then button labels drop to icon-only, and only once that's
          exhausted does a Record move into the 3-dots overflow menu — see
          `useToolbarOverflow` below.

          §5 SLOT ORDER (user report 2026-09-05: "the three dots and filter
          should be right aligned and search bar and list and view dropdowns
          should be left aligned and no other buttons should appear"):
            LEFT  — List dropdown, View dropdown, Search.
            RIGHT — Filter, then the ⋮ (pushed over by `ml-auto`).
          Nothing else. A page's `actions` are a group inside the ⋮ menu, not a
          third button between Filter and it. */}
      <div ref={rowRef} className="flex flex-none flex-nowrap items-center gap-2 overflow-hidden">
        {/* §5: List dropdown ALWAYS renders first, View dropdown second — this is
            the enforcement point, not StandardToolbar (which almost nothing
            mounts). "All" is every Database's own default; the entries beside
            it are saved Views (TASK-062), durable per Database and per owner.
            Add List opens a name field rather than saving an unnamed View: a
            List a user cannot recognise in this dropdown is not a saved List.
            When the surface cannot reach the store at all, the row stays
            visible and says why (§3a/AP-021: explain, don't omit). */}
        <div className="flex shrink-0 items-center gap-2">
          <StandardDropdown
            ariaLabel="Select list"
            options={[
              { id: "all", label: "All" },
              ...savedViews.views.map((saved) => ({ id: saved.id, label: saved.name })),
            ]}
            activeId={savedViews.selectedId ?? "all"}
            onSelect={(id) => {
              const chosen = savedViews.select(id === "all" ? null : id);
              if (!chosen) {
                // "All" is the Database's own default view, not a saved one.
                setHiddenColumns(new Set());
                onViewChange(defaultViewConfig(activeView!.id, activeView!.kind));
                return;
              }
              // A saved View restores BOTH halves of what was on screen: the
              // view config and the column visibility the shell owns.
              setHiddenColumns(new Set(chosen.hiddenColumns));
              onViewChange(chosen.config as unknown as ViewConfig);
            }}
            {...(savedViews.unavailableReason === null
              ? { onAdd: () => setListPopoverOpen(true) }
              : {})}
            addLabel="Add list"
            {...(savedViews.unavailableReason !== null
              ? { addDisabledReason: `Saved Lists are unavailable: ${savedViews.unavailableReason}` }
              : {})}
            emptyLabel="No lists yet"
            triggerIcon={<ListIcon className="size-4 shrink-0" style={{ color: "var(--color-steel)" }} />}
            showLabel={!hidden.has("list-label")}
          />
          {/* Naming a List. Anchored beside the dropdown that opened it rather
              than inside it, because StandardDropdown closes on select and a
              field that vanishes mid-typing is not a field. */}
          <Popover open={listPopoverOpen} onOpenChange={setListPopoverOpen}>
            <PopoverTrigger asChild>
              <span className="sr-only" aria-hidden />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Save this list
              </div>
              <Input
                autoFocus
                placeholder="Name this list…"
                aria-label="List name"
                value={listNameDraft}
                onChange={(event) => setListNameDraft(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void saveCurrentList()}
                className="h-8 w-full rounded-lg border"
                style={{ borderColor: "var(--color-border)" }}
              />
              {listSaveError && (
                <p className="text-xs text-destructive" role="alert">
                  {listSaveError}
                </p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={listNameDraft.trim() === ""}
                  onClick={() => void saveCurrentList()}
                >
                  Save list
                </Button>
                {savedViews.selectedId && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void updateCurrentList()}
                    title="Overwrite the selected list with what is on screen"
                  >
                    Update
                  </Button>
                )}
              </div>

              {/* THE REST OF A LIST'S VERBS (TASK-110). Rename, personal vs
                  shared, default and duplicate were all reachable on the server
                  and unreachable in the UI — `remove()` had existed in the hook
                  with no caller at all. Deleting asks first: it is the one verb
                  here that destroys something. */}
              {selectedList && (
                <div className="space-y-1.5 border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
                  <div className="text-xs font-medium text-muted-foreground">
                    Manage "{selectedList.name}"
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Input
                      placeholder={selectedList.name}
                      aria-label="Rename list"
                      value={listRenameDraft}
                      onChange={(event) => setListRenameDraft(event.target.value)}
                      className="h-8 min-w-0 flex-1 rounded-lg border"
                      style={{ borderColor: "var(--color-border)" }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        listRenameDraft.trim() === "" || listRenameDraft.trim() === selectedList.name
                      }
                      onClick={() =>
                        void runListAction(async () => {
                          await savedViews.rename(selectedList.id, listRenameDraft.trim());
                          setListRenameDraft("");
                        })
                      }
                    >
                      Rename
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      aria-label="List visibility"
                      value={selectedList.scope}
                      onChange={(event) =>
                        void runListAction(() =>
                          savedViews.setScope(
                            selectedList.id,
                            event.target.value as "personal" | "organization",
                          ),
                        )
                      }
                      className="h-8 min-w-0 flex-1 rounded-lg border px-2 text-xs"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <option value="personal">Only me</option>
                      <option value="organization">Everyone here</option>
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        aria-label="Open on this list"
                        checked={selectedList.isDefault === true}
                        onChange={(event) =>
                          void runListAction(() =>
                            savedViews.setDefault(selectedList.id, event.target.checked),
                          )
                        }
                      />
                      Open on this
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => void runListAction(() => savedViews.duplicate(selectedList.id))}
                    >
                      Duplicate
                    </Button>
                    {confirmDelete ? (
                      <>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            void runListAction(async () => {
                              await savedViews.remove(selectedList.id);
                              setConfirmDelete(false);
                              setListPopoverOpen(false);
                            })
                          }
                        >
                          Delete for good
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* SHARE (TASK-064). The affordance shipped disabled with an
                  honest reason — Bridge's only sharing primitive was welded to
                  Helpdesk. It is generalized now, so the control acts. */}
              <div className="border-t pt-2" style={{ borderColor: "var(--color-border)" }}>
                <div className="text-xs font-medium text-muted-foreground">Share this list</div>
                {shareGrants.unavailableReason ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {shareGrants.unavailableReason}
                  </p>
                ) : (
                  <>
                    <div className="mt-1.5 flex items-center gap-2">
                      <select
                        aria-label="Share access level"
                        value={shareLevel}
                        onChange={(event) => setShareLevel(event.target.value as ShareAccessLevel)}
                        className="h-8 flex-1 rounded-lg border px-2 text-xs"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <option value="view">Can view</option>
                        <option value="edit">Can edit</option>
                        <option value="coowner">Co-owner</option>
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const grant = await shareGrants.createLink(shareLevel);
                          setShareLink(grant?.accessToken ?? null);
                        }}
                      >
                        Create link
                      </Button>
                    </div>
                    {shareLink && (
                      // The token itself, not a fabricated URL: Bridge has no
                      // route that opens a shared View yet, and printing one
                      // would be a capability that does not exist (ADR-247).
                      <p className="mt-1.5 break-all text-xs text-muted-foreground">
                        Share token: <span className="font-mono">{shareLink}</span>
                      </p>
                    )}
                    <ul className="mt-2 space-y-1">
                      {shareGrants.grants.map((grant) => (
                        <li key={grant.id} className="flex items-center gap-2 text-xs">
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {grant.granteeUserId ? "Member" : "Link"} · {grant.accessLevel}
                            {grant.usable ? "" : " · revoked"}
                          </span>
                          {grant.usable && (
                            <button
                              type="button"
                              className="rounded border px-1.5 py-0.5"
                              style={{ borderColor: "var(--color-border)" }}
                              onClick={() => void shareGrants.revoke(grant.id)}
                            >
                              Revoke
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>
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
            triggerIcon={(() => {
              const ActiveIcon = VIEW_METADATA[activeView.kind].icon;
              return <ActiveIcon className="size-4 shrink-0" style={{ color: "var(--color-steel)" }} />;
            })()}
            showLabel={!hidden.has("view-label")}
          />
        </div>

        {/* Search sits immediately next to the dropdowns (user directive), and
            is the first thing to give up space — `min-w-0` lets it shrink
            below its own content size instead of forcing the row to wrap. It
            carries a visible rectangular border like every other control in
            the row; without one it read as floating text, not a field. */}
        <div className="relative min-w-[3rem] max-w-[16rem] flex-1 basis-32">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-lg border pl-8"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          />
        </div>

        {/* THE RIGHT GROUP. `ml-auto` is what right-aligns it, so the two
            groups stay pinned to their own edges however wide the search box
            grows or shrinks. */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* ONE Filter control, not two (user report 2026-08-10: "Why are
              there 2 filters, retain only the button. Currently its not
              clickable, why?"). There used to be a always-visible draft input
              AND a button; the button only re-applied whatever was in that
              input, so with the input empty it cleared nothing and looked
              dead. Now the button IS the control: it opens the field picker +
              value + Apply/Clear, so pressing it always does something. */}
          {!hidden.has("filter") && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant={activeView.rowFilters.length > 0 ? "default" : "outline"}
                  aria-label="Filter"
                >
                  <Filter className="size-4" />
                  {!hidden.has("filter-label") && "Filter"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72">
                <FilterBuilder
                  spec={spec}
                  filters={activeView.rowFilters}
                  match={activeView.filterMatch}
                  onChange={changeFilters}
                  addColumnSlot={addColumnSlot}
                />
              </PopoverContent>
            </Popover>
          )}

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
              {/* §5's Custom actions slot, moved here from the row. Same node,
                  same handler — a page's control is still one click away, it
                  just no longer adds a button to a row the user asked to hold
                  only List/View/Search and Filter/⋮. Key events are stopped so
                  Radix's type-ahead does not eat an input a page passes. */}
              {actions && (
                <div
                  className="space-y-1.5 border-b p-2"
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <div className="text-xs font-medium text-muted-foreground">Actions</div>
                  {actions}
                </div>
              )}

              {/* When the row has no space left, Filter drops out of the row
                  and lives here instead — same input, same handler, just a
                  different address (user directive 2026-08-10: "the Records
                  should move inside 3 dots one by one"). Key/click events are
                  stopped so Radix's menu type-ahead doesn't eat keystrokes. */}
              {hidden.has("filter") && (
                <div
                  className="space-y-1.5 border-b p-2"
                  onKeyDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <FilterBuilder
                    spec={spec}
                    filters={activeView.rowFilters}
                    match={activeView.filterMatch}
                    onChange={changeFilters}
                    addColumnSlot={addColumnSlot}
                  />
                </div>
              )}

              {/* Enabled where the server said this Database's row store can
                  hold a new column, disabled WITH THE SERVER'S OWN REASON
                  where it cannot (AP-021: perform OR explain; ADR-247: never
                  claim what is not true). It used to be unconditionally
                  disabled against a sentence saying no capability existed
                  anywhere, which is what the user hit in a Module. */}
              <DropdownMenuItem
                disabled={!addColumnSlot.onAdd}
                {...(addColumnSlot.addDisabledReason
                  ? { title: `Unavailable: ${addColumnSlot.addDisabledReason}` }
                  : {})}
                {...(addColumnSlot.onAdd ? { onSelect: addColumnSlot.onAdd } : {})}
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

              {/* Records (TASK-083, ADR-261 under AP-171). PER-DATABASE:
                  switching one on or off applies to every Record of this
                  Database. Per-Record toggling was rejected — two Records of
                  one Database with different Sections is exactly the
                  single-page divergence the UI gate exists to catch. */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="justify-between">
                  <span className="flex items-center gap-2">
                    <LayoutList className="size-4" /> Records
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {RECORD_SECTION_IDS.filter((id) => recordSections.sections[id]).length} on
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {RECORD_SECTION_IDS.map((section) => (
                    <DropdownMenuCheckboxItem
                      key={section}
                      checked={recordSections.sections[section]}
                      disabled={!recordSections.ready || recordSections.unavailableReason !== null}
                      title={recordSections.unavailableReason ?? undefined}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(checked) =>
                        void recordSections.toggle(section, checked === true)
                      }
                    >
                      {RECORD_SECTION_LABELS[section]}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {recordSections.unavailableReason && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {recordSections.unavailableReason}
                    </div>
                  )}
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
                <DropdownMenuSubContent
                  className="p-0"
                  onKeyDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  {/* Levels, not one column: `applySorts` breaks ties with the
                      later rows and every write site here used to replace the
                      array with a single entry. */}
                  <SortEditor
                    spec={spec}
                    sorts={activeView.sorts}
                    onChange={(sorts) => onViewChange({ ...activeView!, sorts })}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={resetView} disabled={!viewIsModified}>
                Reset view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {insights && (
            <Button
              size="sm"
              variant="ghost"
              className="px-2"
              aria-expanded={insightsOpen}
              aria-label={insightsOpen ? "Hide insights" : "Show insights"}
              title={insightsOpen ? "Hide insights" : "Show insights"}
              onClick={() => setInsightsOpen((open) => !open)}
            >
              {insightsOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          )}
        </div>
      </div>

      {insights && insightsOpen && <div className="flex-none">{insights}</div>}

      {/* THE DEFINITE-HEIGHT BOX. Nothing below this line may fall back to
          content sizing — see the header block. */}
      <div className={fill ? "min-h-0 flex-1 overflow-auto" : "h-[28rem] overflow-auto"}>
        {creating ? (
          <RecordPage
            spec={spec}
            moduleName={moduleName ?? spec.id.split(".")[0]!}
            {...(viewProps.onInsert ? { onSave: viewProps.onInsert } : {})}
            {...(viewProps.insertDisabledReason
              ? { saveDisabledReason: viewProps.insertDisabledReason }
              : {})}
            onCancel={() => setCreating(false)}
          />
        ) : !ViewComponent ? (
          // A kind the grammar names but this build has no renderer for. Say so
          // rather than showing an empty pane (ADR-247).
          <div className="p-6 text-sm" style={{ color: "var(--color-warm-gray)" }}>
            This build has no {VIEW_METADATA[activeView.kind]?.label ?? activeView.kind} view yet.
          </div>
        ) : (
        <ViewComponent
          spec={visibleSpec}
          view={pagedView}
          data={pageRows}
          onViewChange={onViewChange}
          {...viewProps}
          onRequestFilter={(columnId) => {
            // "Filter this column" from the column menu ADDS a row for it
            // rather than replacing whatever is there — a second filter used to
            // overwrite the first.
            if (!activeView!.rowFilters.some((filter) => filter.field === columnId)) {
              const kind = columnKinds[columnId] ?? "text";
              changeFilters(
                [
                  ...activeView!.rowFilters,
                  { field: columnId, op: filterOpsForKind(kind)[0]!, value: "" },
                ],
                activeView!.filterMatch,
              );
            }
            viewProps.onRequestFilter?.(columnId);
          }}
          onHideColumn={(columnId) => {
            setHiddenColumns((current) => new Set(current).add(columnId));
            viewProps.onHideColumn?.(columnId);
          }}
          // New opens a PAGE wherever the surface has a Record route (user
          // report 2026-09-05: "shouldnt I be taken to the element page when
          // adding a new element?"). The inline Record page below stays as the
          // fallback for the hand-written surfaces that have no such route —
          // there it is still a whole-view swap, never a half-page.
          onRequestCreate={onOpenNewRecord ?? (() => setCreating(true))}
        />
        )}
      </div>

      {/* ONE pagination control for every surface (TASK-110). It counts the
          rows the shell actually filtered, so "of N" is the real N. */}
      {!creating && (
        <PaginationBar
          total={resolved.length}
          pageSize={pageSize}
          offset={pageOffset}
          onOffsetChange={setOffset}
          onPageSizeChange={(next) => {
            setOffset(0);
            onViewChange({ ...activeView!, pageSize: next });
          }}
        />
      )}
    </div>
  );
}
