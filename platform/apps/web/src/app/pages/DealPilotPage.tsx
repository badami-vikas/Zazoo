import { useEffect, useMemo, useState } from "react";
import { Handshake, LayoutGrid, List as ListIcon, Table as TableIcon, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { CreateListModal } from "../components/shared/ListDropdown";
import { StandardToolbar, type ToolbarView } from "../components/shared/StandardToolbar";
import { type ActiveFilter } from "../components/shared/FilterChipsRow";
import { type DashboardMetric } from "../components/shared/DashboardRow";
import { CollapsibleInsights } from "../components/shared/CollapsibleInsights";
import { CardGrid, NotionCard } from "../components/shared/NotionCard";
import { ListView } from "../components/shared/ListView";
import { useLists, createList } from "../data/lists";
import { StandardColumnMenu } from "../components/shared/StandardColumnMenu";

type DealPilotList = Awaited<ReturnType<typeof trpc.dealpilot.list.query>>;
type DealItem = DealPilotList["items"][number];

type ViewId = "table" | "card" | "list";
const VIEWS: ToolbarView[] = [
  { id: "table", label: "Table", icon: TableIcon },
  { id: "card", label: "Card", icon: LayoutGrid },
  { id: "list", label: "List", icon: ListIcon },
];

const SCOPE = "dealpilot";

/**
 * Standard page shell (user spec 2026-07-07): centered toggle -> Lists -> toolbar
 * (view/search/filter/3-dot) -> filter chips (conditional) -> dashboard (analytics) ->
 * content view (table/card/list). Ported from the prototype's DealPilotPage shape, wired to
 * the real `dealpilot.list` tRPC procedure instead of local fixture hooks — every row is real
 * candidate data from the governed sourcing pipeline, no dummy content.
 */
export function DealPilotPage() {
  const [page, setPage] = useState<DealPilotList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("table");
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [industryFilter, setIndustryFilter] = useState<string | null>(null);
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [addListOpen, setAddListOpen] = useState(false);
  const [sort, setSort] = useState<{ field: "name" | "industry" | "fit"; direction: "asc" | "desc" } | null>(null);
  const lists = useLists(SCOPE);

  function load() {
    trpc.dealpilot.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }
  useEffect(load, []);

  const industries = useMemo(() => {
    if (!page) return [];
    const set = new Set<string>();
    for (const item of page.items) {
      const industry = item.profile.industry;
      if (typeof industry === "string" && industry) set.add(industry);
    }
    return [...set].sort();
  }, [page]);

  const filtered = useMemo(() => {
    if (!page) return [];
    const q = search.trim().toLowerCase();
    const visible = page.items.filter((item) => {
      if (industryFilter && item.profile.industry !== industryFilter) return false;
      if (!q) return true;
      const name = String(item.profile.name ?? "").toLowerCase();
      return name.includes(q);
    });
    if (!sort) return visible;
    return [...visible].sort((left, right) => {
      const leftValue = sort.field === "fit" ? left.fit.triage : String(left.profile[sort.field] ?? "");
      const rightValue = sort.field === "fit" ? right.fit.triage : String(right.profile[sort.field] ?? "");
      const order = leftValue.localeCompare(rightValue);
      return sort.direction === "asc" ? order : -order;
    });
  }, [page, search, industryFilter, sort]);

  const activeFilters: ActiveFilter[] = industryFilter ? [{ id: "industry", label: `Industry: ${industryFilter}` }] : [];

  const metrics: DashboardMetric[] = page
    ? [
        { id: "total", label: "Candidates", value: String(page.total) },
        { id: "green", label: "Thesis fit", value: String(page.items.filter((i) => i.fit.triage === "green").length), hint: "green flag" },
        { id: "review", label: "Needs review", value: String(page.items.filter((i) => i.fit.triage === "yellow").length), hint: "yellow flag" },
      ]
    : [];

  if (error) return <div className="p-6 text-red-600 text-sm">{error}</div>;
  if (!page) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
      {/* No separate title row — the centered toggle IS the page's identity element per the
          standard shell spec (2026-07-07): one tab per tool section, no tool-name row above it. */}
      <Header tabs={[{ id: "DealPilot", icon: Handshake }]} activeTab="DealPilot" onTabChange={() => {}} />
      <StandardToolbar
        lists={[{ id: "__all", label: "All Deals" }, ...lists.map((l) => ({ id: l.id, label: l.name }))]}
        activeListId={selectedList ?? "__all"}
        onListSelect={(id) => setSelectedList(id === "__all" ? null : id)}
        onAddList={() => setAddListOpen(true)}
        insightsExpanded={insightsOpen}
        onToggleInsights={() => setInsightsOpen((o) => !o)}
        view={view}
        views={VIEWS}
        onViewChange={(id) => setView(id as ViewId)}
        search={search}
        onSearchChange={setSearch}
        onFilterClick={() => setFilterOpen((o) => !o)}
        filterCount={activeFilters.length}
        filterOpen={filterOpen}
        filterPanel={
          <div
            className="absolute top-full right-0 mt-1 w-56 border rounded-xl shadow-lg z-50 overflow-hidden py-1 bg-white"
            style={{ borderColor: "var(--color-border)" }}
          >
            {industries.length === 0 && <div className="px-3 py-2 text-xs text-[var(--color-warm-gray)]">No industries yet</div>}
            {industries.map((ind) => (
              <button
                key={ind}
                onClick={() => {
                  setIndustryFilter(ind === industryFilter ? null : ind);
                  setFilterOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm"
                style={{ color: ind === industryFilter ? "var(--color-steel)" : "var(--color-navy-mid)" }}
              >
                {ind}
              </button>
            ))}
          </div>
        }
        customActions={
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border shadow-sm text-sm font-medium"
            style={{ borderColor: "var(--color-border)", backgroundColor: "white", color: "var(--color-navy-mid)" }}
          >
            <RefreshCw className="w-3.5 h-3.5" style={{ color: "var(--color-steel)" }} />
            Refresh
          </button>
        }
        moreMenu={
          <Link
            to="/module/deal-pilot"
            className="block w-full px-3 py-2 text-left text-xs hover:bg-black/5"
            style={{ color: "var(--color-navy-mid)" }}
          >
            Open Module Detail
          </Link>
        }
      />
      <CollapsibleInsights
        expanded={insightsOpen}
        filters={activeFilters}
        onRemoveFilter={() => setIndustryFilter(null)}
        onClearFilters={() => setIndustryFilter(null)}
        metrics={metrics}
      />
      {addListOpen && (
        <CreateListModal
          onClose={() => setAddListOpen(false)}
          onCreate={(name, instruction) => setSelectedList(createList(SCOPE, name, instruction).id)}
        />
      )}

      <div className="flex-1 overflow-auto">
        {view === "table" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
                <th className="px-4 py-2 font-semibold">
                  <StandardColumnMenu label="Name" databaseBacked onFilter={() => setFilterOpen(true)} onSort={(direction) => setSort({ field: "name", direction })} />
                </th>
                <th className="px-4 py-2 font-semibold">
                  <StandardColumnMenu label="Industry" databaseBacked onFilter={() => setFilterOpen(true)} onSort={(direction) => setSort({ field: "industry", direction })} />
                </th>
                <th className="px-4 py-2 font-semibold">
                  <StandardColumnMenu label="Fit" databaseBacked onFilter={() => setFilterOpen(true)} onSort={(direction) => setSort({ field: "fit", direction })} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-10 text-center" style={{ color: "var(--color-warm-gray)" }}>
                    {page.total === 0
                      ? "No real Deal records yet. Run governed source intake to populate this database."
                      : "No Deal records match the current search and filters."}
                  </td>
                </tr>
              )}
              {filtered.map((item) => (
                <tr key={item.id} className="border-b" style={{ borderColor: "var(--color-border)" }}>
                  <td className="px-4 py-2" style={{ color: "var(--color-navy)" }}>
                    {String(item.profile.name ?? item.id)}
                  </td>
                  <td className="px-4 py-2" style={{ color: "var(--color-warm-gray)" }}>
                    {String(item.profile.industry ?? "—")}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-xs px-1.5 py-0.5 rounded-full border" style={{ borderColor: "var(--color-border)", color: "var(--color-navy-mid)" }}>
                      {item.fit.triage}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : filtered.length === 0 ? (
          <div
            className="p-10 text-center border border-dashed rounded-xl m-4"
            style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
          >
            {page.total === 0
              ? "No real Deal records yet. Run governed source intake to populate this database."
              : "No Deal records match the current search and filters."}
          </div>
        ) : view === "card" ? (
          <CardGrid>
            {filtered.map((item) => (
              <NotionCard
                key={item.id}
                title={String(item.profile.name ?? item.id)}
                subtitle={String(item.profile.industry ?? "—")}
                metaChips={[item.fit.triage]}
              />
            ))}
          </CardGrid>
        ) : (
          <ListView
            items={filtered}
            keyFor={(item: DealItem) => item.id}
            renderRow={(item: DealItem) => (
              <>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--color-navy)" }}>
                    {String(item.profile.name ?? item.id)}
                  </div>
                  <div className="text-xs truncate" style={{ color: "var(--color-warm-gray)" }}>
                    {String(item.profile.industry ?? "—")}
                  </div>
                </div>
                <span className="text-xs shrink-0" style={{ color: "var(--color-navy-mid)" }}>
                  {item.fit.triage}
                </span>
              </>
            )}
          />
        )}
      </div>
    </div>
  );
}
