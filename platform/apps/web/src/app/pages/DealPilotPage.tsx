import { useEffect, useMemo, useState } from "react";
import { Handshake, LayoutGrid, List as ListIcon, Table as TableIcon, RefreshCw } from "lucide-react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { ToolPageHeader } from "../components/shared/ToolPageHeader";
import { Header } from "../components/shared/Header";
import { ListBar } from "../components/shared/ListBar";
import { StandardToolbar, type ToolbarView } from "../components/shared/StandardToolbar";
import { FilterChipsRow, type ActiveFilter } from "../components/shared/FilterChipsRow";
import { DashboardRow, type DashboardMetric } from "../components/shared/DashboardRow";
import { CardGrid, NotionCard } from "../components/shared/NotionCard";
import { ListView } from "../components/shared/ListView";
import { useLists } from "../data/lists";

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
  const lists = useLists(SCOPE);
  void lists;

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
    return page.items.filter((item) => {
      if (industryFilter && item.profile.industry !== industryFilter) return false;
      if (!q) return true;
      const name = String(item.profile.name ?? "").toLowerCase();
      return name.includes(q);
    });
  }, [page, search, industryFilter]);

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
      <ToolPageHeader icon={Handshake} title="DealPilot" />
      <Header tabs={[{ id: "Deals", icon: Handshake }]} activeTab="Deals" onTabChange={() => {}} />
      <ListBar scope={SCOPE} selected={selectedList} onSelect={setSelectedList} allLabel="All Deals" />
      <StandardToolbar
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
        moreMenu={<div className="px-3 py-2 text-xs text-[var(--color-warm-gray)]">Nothing here yet</div>}
      />
      <FilterChipsRow filters={activeFilters} onRemove={() => setIndustryFilter(null)} onClearAll={() => setIndustryFilter(null)} />
      <DashboardRow metrics={metrics} />

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div
            className="p-10 text-center border border-dashed rounded-xl m-4"
            style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
          >
            No candidates match. Source new listings or clear filters.
          </div>
        ) : view === "table" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-4 py-2 font-semibold">Industry</th>
                <th className="px-4 py-2 font-semibold">Fit</th>
              </tr>
            </thead>
            <tbody>
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
