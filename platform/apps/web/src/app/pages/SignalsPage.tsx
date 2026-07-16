/**
 * Signals — standalone pinned governance tool (user revision 2026-07-06,
 * overriding ADR-023 item 4's tabs-merge: Signals and Approvals are TWO
 * SEPARATE pinned tools again). Confirmed again 2026-07-07: the toggle stays
 * single-tab ("SIGNALS" alone), NOT merged with People/Communities — a
 * reference mockup showed a merged toggle but the user opted to keep this
 * page standalone.
 *
 * Standard page shell (2026-07-07 spec): centered toggle -> Lists (dynamic
 * type pills, since signal types are system-detected categories, not
 * user-created lists) -> toolbar (view/search/filter/3-dot) -> filter chips
 * -> dashboard -> content view.
 *
 * Dashboard metrics are limited to what the real `signals` schema actually
 * has (type/status/createdAt) — no `priority` column exists yet
 * (platform/packages/db/src/schema.ts:700), so a "High priority" tile is NOT
 * built here; fabricating one would violate the real-data-only policy
 * (docs/dummy.md). Filed as a schema gap below rather than guessed at.
 *
 * Reuses `graph.listSignals` for the read and `graph.recordSignalAction` for
 * dismiss/save — direct reaction bookkeeping, not a governed proposal (see
 * graph-store.ts's header comment: recording a reaction to an observation
 * carries no external effect requiring approval, unlike ApprovalsPage's
 * proposals).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Radio, LayoutGrid, List as ListIcon, Table as TableIcon } from "lucide-react";
import { collectAllPages } from "../lib/pagination";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { StandardToolbar, type ToolbarView } from "../components/shared/StandardToolbar";
import { type ActiveFilter } from "../components/shared/FilterChipsRow";
import { type DashboardMetric } from "../components/shared/DashboardRow";
import { CollapsibleInsights } from "../components/shared/CollapsibleInsights";
import { CardGrid, NotionCard } from "../components/shared/NotionCard";
import { ListView } from "../components/shared/ListView";
import { Button } from "../components/ui/button";

type SignalPage = Awaited<ReturnType<typeof trpc.graph.listSignals.query>>;
type SignalItem = SignalPage["items"][number];

type ViewId = "table" | "card" | "list";
const VIEWS: ToolbarView[] = [
  { id: "table", label: "Table", icon: TableIcon },
  { id: "card", label: "Card", icon: LayoutGrid },
  { id: "list", label: "List", icon: ListIcon },
];

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function recommendedActionLabel(signal: SignalItem): string {
  if (
    typeof signal.recommendedAction === "object" &&
    signal.recommendedAction !== null &&
    !Array.isArray(signal.recommendedAction)
  ) {
    const label = (signal.recommendedAction as Record<string, unknown>).label;
    if (typeof label === "string" && label.trim()) return label.trim();
  }
  return "Review action";
}

export function SignalsPage({ embedded = false }: { embedded?: boolean }) {
  const [page, setPage] = useState<SignalPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("table");
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(true);

  async function refresh(): Promise<void> {
    try {
      const items = await collectAllPages((offset, limit) =>
        trpc.graph.listSignals.query({ workspaceId: PILOT_WORKSPACE, limit, offset }),
      );
      setPage({ items, total: items.length, hasMore: false });
      setLoadError(null);
      setRefreshError(null);
    } catch (e) {
      if (page) setRefreshError(String(e));
      else setLoadError(String(e));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function react(signalId: string, verb: "dismiss" | "save") {
    setBusyId(signalId);
    setActionErrors((current) => {
      const next = { ...current };
      delete next[signalId];
      return next;
    });
    try {
      await trpc.graph.recordSignalAction.mutate({ workspaceId: PILOT_WORKSPACE, signalId, verb });
      await refresh();
    } catch (e) {
      setActionErrors((current) => ({ ...current, [signalId]: String(e) }));
    } finally {
      setBusyId(null);
    }
  }

  const types = useMemo(() => {
    if (!page) return [];
    const set = new Set<string>();
    for (const s of page.items) set.add(s.type);
    return [...set].sort();
  }, [page]);

  const filtered = useMemo(() => {
    if (!page) return [];
    const q = search.trim().toLowerCase();
    return page.items.filter((s) => {
      if (typeFilter && s.type !== typeFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (!q) return true;
      return `${s.type} ${s.subjectType}`.toLowerCase().includes(q);
    });
  }, [page, search, typeFilter, statusFilter]);

  const activeFilters: ActiveFilter[] = [
    ...(typeFilter ? [{ id: "type", label: `Type: ${typeFilter}` }] : []),
    ...(statusFilter ? [{ id: "status", label: `Status: ${statusFilter}` }] : []),
  ];

  const metrics: DashboardMetric[] = page
    ? [
        { id: "total", label: "Total Signals", value: String(page.total) },
        { id: "new", label: "New", value: String(page.items.filter((s) => s.status === "new").length) },
        { id: "today", label: "Detected Today", value: String(page.items.filter((s) => isToday(s.createdAt)).length) },
      ]
    : [];

  if (loadError) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{loadError}</div>;
  if (!page) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
      {!embedded && <Header tabs={[{ id: "Signals", icon: Radio }]} activeTab="Signals" onTabChange={() => {}} />}

      <StandardToolbar
        // Signal types are system-detected categories, not user-created lists — no "Add list".
        lists={[{ id: "__all", label: "All Signals" }, ...types.map((t) => ({ id: t, label: t }))]}
        activeListId={typeFilter ?? "__all"}
        onListSelect={(id) => setTypeFilter(id === "__all" ? null : id)}
        insightsExpanded={insightsOpen}
        onToggleInsights={() => setInsightsOpen((o) => !o)}
        view={view}
        views={VIEWS}
        onViewChange={(id) => setView(id as ViewId)}
        search={search}
        onSearchChange={setSearch}
        onFilterClick={() => setFilterOpen((o) => !o)}
        filterCount={statusFilter ? 1 : 0}
        filterOpen={filterOpen}
        filterPanel={
          <div
            className="absolute top-full right-0 mt-1 w-48 border rounded-xl shadow-lg z-50 overflow-hidden py-1 bg-white"
            style={{ borderColor: "var(--color-border)" }}
          >
            {["new", "actioned", "dismissed", "saved"].map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(s === statusFilter ? null : s);
                  setFilterOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm capitalize"
                style={{ color: s === statusFilter ? "var(--color-steel)" : "var(--color-navy-mid)" }}
              >
                {s}
              </button>
            ))}
          </div>
        }
        moreMenu={<div className="px-3 py-2 text-xs text-[var(--color-warm-gray)]">Nothing here yet</div>}
      />
      <CollapsibleInsights
        expanded={insightsOpen}
        filters={activeFilters}
        onRemoveFilter={(id) => (id === "type" ? setTypeFilter(null) : setStatusFilter(null))}
        onClearFilters={() => {
          setTypeFilter(null);
          setStatusFilter(null);
        }}
        metrics={metrics}
      />
      {refreshError && (
        <div role="alert" className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          The Signal was updated, but the latest list could not be loaded: {refreshError}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div
            className="p-10 text-center border border-dashed rounded-xl m-4"
            style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
          >
            No signals match. Signals appear here once the detection pipeline surfaces one.
          </div>
        ) : view === "table" ? (
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
                <th className="px-4 py-2 font-semibold">Type</th>
                <th className="px-4 py-2 font-semibold">Subject</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s: SignalItem) => (
                <tr key={s.id} className="border-b" style={{ borderColor: "var(--color-border)" }}>
                  <td className="px-4 py-2">
                    <Link
                      to={`/module/relationship/signals/${s.id}`}
                      className="font-medium hover:underline"
                      style={{ color: "var(--color-navy)" }}
                    >
                      {s.type}
                    </Link>
                  </td>
                  <td className="px-4 py-2" style={{ color: "var(--color-warm-gray)" }}>{s.subjectType}</td>
                  <td className="px-4 py-2" style={{ color: "var(--color-warm-gray)" }}>{s.status}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/module/relationship/signals/${s.id}`}>{recommendedActionLabel(s)}</Link>
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "save")}>Save</Button>
                      <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "dismiss")}>Dismiss</Button>
                    </div>
                    {actionErrors[s.id] && <p role="alert" className="mt-1 text-xs text-red-600">{actionErrors[s.id]}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : view === "card" ? (
          <CardGrid>
            {filtered.map((s: SignalItem) => (
              <NotionCard
                key={s.id}
                title={s.type}
                subtitle={s.subjectType}
                metaChips={[s.status]}
                footer={
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/module/relationship/signals/${s.id}`}>{recommendedActionLabel(s)}</Link>
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <Link to={`/module/relationship/signals/${s.id}`}>Evidence</Link>
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "dismiss")}>Dismiss</Button>
                    {actionErrors[s.id] && <span role="alert" className="text-xs text-red-600">{actionErrors[s.id]}</span>}
                  </div>
                }
              />
            ))}
          </CardGrid>
        ) : (
          <ListView
            items={filtered}
            keyFor={(s: SignalItem) => s.id}
            renderRow={(s: SignalItem) => (
              <>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/module/relationship/signals/${s.id}`}
                    className="text-sm font-semibold truncate hover:underline block"
                    style={{ color: "var(--color-navy)" }}
                  >
                    {s.type}
                  </Link>
                  <div className="text-xs truncate" style={{ color: "var(--color-warm-gray)" }}>{s.subjectType} · {s.status}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/module/relationship/signals/${s.id}`}>{recommendedActionLabel(s)}</Link>
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "dismiss")}>Dismiss</Button>
                  </div>
                  {actionErrors[s.id] && <span role="alert" className="max-w-xs text-right text-xs text-red-600">{actionErrors[s.id]}</span>}
                </div>
              </>
            )}
          />
        )}
      </div>
    </div>
  );
}
