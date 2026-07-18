import { useEffect, useMemo, useState } from "react";
import { Briefcase, LayoutGrid, List as ListIcon, Table as TableIcon } from "lucide-react";
import { Link } from "react-router";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { CardGrid, NotionCard } from "../components/shared/NotionCard";
import { Header } from "../components/shared/Header";
import { ListView } from "../components/shared/ListView";
import { StandardToolbar, type ToolbarView } from "../components/shared/StandardToolbar";
import { StandardColumnMenu } from "../components/shared/StandardColumnMenu";
import { CollapsibleInsights } from "../components/shared/CollapsibleInsights";
import { CreateListModal } from "../components/shared/ListDropdown";
import { RedFlagControl } from "../components/shared/RedFlagControl";
import { RedFlagProvider } from "../components/shared/RedFlagProvider";
import { createList, useLists } from "../data/lists";

type JobPilotList = Awaited<ReturnType<typeof trpc.jobpilot.list.query>>;
type JobItem = JobPilotList["items"][number];
type ViewId = "table" | "card" | "list";
type SortField = "title" | "company" | "stage";

/** Display labels for @bridge/jobpilot's normalized `FitRecommendation` —
 * never the raw "pursue"/"review"/"pass" enum value verbatim (AP-023: no
 * green/yellow color-only feedback anywhere, but plain-language labels are
 * always fine). */
const FIT_LABEL: Record<string, string> = { pursue: "Pursue", review: "Needs review", pass: "Pass" };

/**
 * TASK-010 review round-5 item 6 — the platform's required "rendered
 * bullet" Red Flag surface, wired to a REAL persisted Record (the
 * application's own `id`, validated server-side by `validateAnchorTarget`'s
 * `"jobpilot"` case via `jobpilotStore.getApplication`), not a fixture.
 * These two bullets are already-persisted fields (`stage`, the normalized
 * `flag`) rendered as short fit-signal observations — real, if modest,
 * content a Human could genuinely flag as wrong (e.g. "flag is stale, I
 * already withdrew this application").
 */
function FitSignalBullets({ applicationId, stage, flag, fitScore }: { applicationId: string; stage: string; flag: string | null; fitScore: string | null }) {
  const stageValue = `Stage: ${stage}`;
  const scoreNum = fitScore != null ? Number(fitScore) : null;
  const fitValue = flag ? `Fit: ${FIT_LABEL[flag] ?? flag}${scoreNum != null && Number.isFinite(scoreNum) ? ` (${Math.round(scoreNum * 100)}%)` : ""}` : null;
  return (
    <ul className="flex flex-col gap-1">
      <li className="flex gap-1.5 text-[11px] leading-snug" style={{ color: "var(--color-navy-mid)" }}>
        <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: "var(--color-steel)" }} />
        <RedFlagControl anchor={{ kind: "bullet", moduleId: "jobpilot", target: { type: "record", recordId: applicationId }, bulletPath: "fit.stage" }} renderedValue={stageValue} className="flex-1">
          {stageValue}
        </RedFlagControl>
      </li>
      {fitValue && (
        <li className="flex gap-1.5 text-[11px] leading-snug" style={{ color: "var(--color-navy-mid)" }}>
          <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: "var(--color-steel)" }} />
          <RedFlagControl anchor={{ kind: "bullet", moduleId: "jobpilot", target: { type: "record", recordId: applicationId }, bulletPath: "fit.flag" }} renderedValue={fitValue} className="flex-1">
            {fitValue}
          </RedFlagControl>
        </li>
      )}
    </ul>
  );
}

const VIEWS: ToolbarView[] = [
  { id: "table", label: "Table", icon: TableIcon },
  { id: "card", label: "Card", icon: LayoutGrid },
  { id: "list", label: "List", icon: ListIcon },
];

export function JobPilotPage() {
  const [page, setPage] = useState<JobPilotList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("table");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState<{ field: SortField; direction: "asc" | "desc" } | null>(null);
  const [selectedList, setSelectedList] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [addListOpen, setAddListOpen] = useState(false);
  const lists = useLists("jobpilot");

  useEffect(() => {
    trpc.jobpilot.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 })
      .then(setPage)
      .catch((failure) => setError(String(failure)));
  }, []);

  const stages = useMemo(
    () => [...new Set((page?.items ?? []).map((item) => item.application?.stage).filter((stage): stage is string => Boolean(stage)))].sort(),
    [page],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = (page?.items ?? []).filter((item) => {
      if (stageFilter && item.application?.stage !== stageFilter) return false;
      return !query || `${item.title} ${item.company} ${item.location ?? ""}`.toLowerCase().includes(query);
    });
    if (!sort) return rows;
    return [...rows].sort((left, right) => {
      const value = (item: JobItem) => {
        if (sort.field === "stage") return item.application?.stage ?? "";
        return String(item[sort.field] ?? "");
      };
      const order = value(left).localeCompare(value(right));
      return sort.direction === "asc" ? order : -order;
    });
  }, [page, search, sort, stageFilter]);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!page) return <div className="p-6 text-sm text-muted-foreground">Loading Job records…</div>;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
      <Header tabs={[{ id: "JobPilot", icon: Briefcase }]} activeTab="JobPilot" onTabChange={() => {}} />
      <StandardToolbar
        lists={[{ id: "__all", label: "All Jobs" }, ...lists.map((list) => ({ id: list.id, label: list.name }))]}
        activeListId={selectedList ?? "__all"}
        onListSelect={(id) => setSelectedList(id === "__all" ? null : id)}
        onAddList={() => setAddListOpen(true)}
        insightsExpanded={insightsOpen}
        onToggleInsights={() => setInsightsOpen((open) => !open)}
        view={view}
        views={VIEWS}
        onViewChange={(id) => setView(id as ViewId)}
        search={search}
        onSearchChange={setSearch}
        onFilterClick={() => setFilterOpen((open) => !open)}
        filterCount={stageFilter ? 1 : 0}
        filterOpen={filterOpen}
        filterPanel={
          <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border bg-white py-1 shadow-lg" style={{ borderColor: "var(--color-border)" }}>
            {stages.length === 0 ? (
              <p className="px-3 py-2 text-xs" style={{ color: "var(--color-warm-gray)" }}>No application stages yet</p>
            ) : stages.map((stage) => (
              <button
                key={stage}
                type="button"
                className="w-full px-3 py-2 text-left text-sm"
                style={{ color: stage === stageFilter ? "var(--color-steel)" : "var(--color-navy-mid)" }}
                onClick={() => {
                  setStageFilter(stage === stageFilter ? null : stage);
                  setFilterOpen(false);
                }}
              >
                {stage}
              </button>
            ))}
          </div>
        }
        moreMenu={
          <Link
            to="/module/job-pilot"
            className="block w-full px-3 py-2 text-left text-xs hover:bg-black/5"
            style={{ color: "var(--color-navy-mid)" }}
          >
            Open Module Detail
          </Link>
        }
      />
      <CollapsibleInsights
        expanded={insightsOpen}
        metrics={[
          { id: "jobs", label: "Jobs", value: String(page.total) },
          { id: "visible", label: "Visible", value: String(visible.length) },
          { id: "review", label: "Awaiting review", value: String(page.items.filter((item) => item.application?.stage === "awaiting_review").length) },
        ]}
      />
      {addListOpen && (
        <CreateListModal
          onClose={() => setAddListOpen(false)}
          onCreate={(name, instruction) => setSelectedList(createList("jobpilot", name, instruction).id)}
        />
      )}

      <div className="flex-1 overflow-auto">
        {view === "table" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
                <th className="px-4 py-2 font-semibold">
                  <StandardColumnMenu label="Role" databaseBacked onFilter={() => setFilterOpen(true)} onSort={(direction) => setSort({ field: "title", direction })} />
                </th>
                <th className="px-4 py-2 font-semibold">
                  <StandardColumnMenu label="Company" databaseBacked onFilter={() => setFilterOpen(true)} onSort={(direction) => setSort({ field: "company", direction })} />
                </th>
                <th className="px-4 py-2 font-semibold">
                  <StandardColumnMenu label="Stage" databaseBacked onFilter={() => setFilterOpen(true)} onSort={(direction) => setSort({ field: "stage", direction })} />
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-10 text-center" style={{ color: "var(--color-warm-gray)" }}>
                    {page.total === 0
                      ? "No real job records yet. Save a posting through JobPilot intake to populate this database."
                      : "No job records match the current search and filters."}
                  </td>
                </tr>
              )}
              {visible.map((item) => (
                <tr key={item.id} className="border-b" style={{ borderColor: "var(--color-border)" }}>
                  <td className="px-4 py-2 font-medium" style={{ color: "var(--color-navy)" }}>{item.title}</td>
                  <td className="px-4 py-2" style={{ color: "var(--color-navy-mid)" }}>{item.company}</td>
                  <td className="px-4 py-2" style={{ color: "var(--color-warm-gray)" }}>{item.application?.stage ?? "Not tracked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : visible.length === 0 ? (
          <div className="m-4 rounded-xl border border-dashed p-10 text-center" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
            {page.total === 0
              ? "No real job records yet. Save a posting through JobPilot intake to populate this database."
              : "No job records match the current search and filters."}
          </div>
        ) : view === "card" ? (
          <RedFlagProvider scope={{ moduleId: "jobpilot" }}>
            <CardGrid>
              {visible.map((item) => (
                <NotionCard
                  key={item.id}
                  title={item.title}
                  subtitle={`${item.company}${item.location ? ` · ${item.location}` : ""}`}
                  metaChips={[item.source ?? "Source not recorded"]}
                  footer={
                    item.application ? (
                      <FitSignalBullets applicationId={item.application.id} stage={item.application.stage} flag={item.application.flag} fitScore={item.application.fitScore} />
                    ) : (
                      <span className="text-[11px]" style={{ color: "var(--color-warm-gray)" }}>Not tracked</span>
                    )
                  }
                />
              ))}
            </CardGrid>
          </RedFlagProvider>
        ) : (
          <ListView
            items={visible}
            keyFor={(item: JobItem) => item.id}
            renderRow={(item: JobItem) => (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold" style={{ color: "var(--color-navy)" }}>{item.title}</div>
                  <div className="truncate text-xs" style={{ color: "var(--color-warm-gray)" }}>{item.company}</div>
                </div>
                <span className="text-xs" style={{ color: "var(--color-navy-mid)" }}>{item.application?.stage ?? "Not tracked"}</span>
              </>
            )}
          />
        )}
      </div>
    </div>
  );
}

export default JobPilotPage;
