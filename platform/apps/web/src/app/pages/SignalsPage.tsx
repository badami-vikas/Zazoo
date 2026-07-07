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
 * act/dismiss/save — a direct write, not a governed proposal (see
 * graph-store.ts's header comment: recording a reaction to an observation
 * carries no external effect requiring approval, unlike ApprovalsPage's
 * proposals).
 */
import { useEffect, useMemo, useState } from "react";
import { Radio, LayoutGrid, List as ListIcon, Table as TableIcon } from "lucide-react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { Pill } from "../components/shared/Pill";
import { StandardToolbar, type ToolbarView } from "../components/shared/StandardToolbar";
import { FilterChipsRow, type ActiveFilter } from "../components/shared/FilterChipsRow";
import { DashboardRow, type DashboardMetric } from "../components/shared/DashboardRow";
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

export function SignalsPage() {
  const [page, setPage] = useState<SignalPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("table");
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  function refresh() {
    trpc.graph.listSignals
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }
  useEffect(refresh, []);

  async function react(signalId: string, verb: "act" | "dismiss" | "save") {
    setBusyId(signalId);
    try {
      await trpc.graph.recordSignalAction.mutate({ workspaceId: PILOT_WORKSPACE, signalId, verb });
      refresh();
    } catch (e) {
      setError(String(e));
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

  if (error) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (!page) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
      <Header tabs={[{ id: "Signals", icon: Radio }]} activeTab="Signals" onTabChange={() => {}} />

      <div className="flex items-center gap-1.5 px-4 py-2.5 overflow-x-auto border-b bg-white" style={{ borderColor: "var(--color-border)" }}>
        <Pill label="All" active={typeFilter === null} onClick={() => setTypeFilter(null)} />
        {types.map((t) => (
          <Pill key={t} label={t} active={typeFilter === t} onClick={() => setTypeFilter(t === typeFilter ? null : t)} />
        ))}
      </div>

      <StandardToolbar
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
      <FilterChipsRow
        filters={activeFilters}
        onRemove={(id) => (id === "type" ? setTypeFilter(null) : setStatusFilter(null))}
        onClearAll={() => {
          setTypeFilter(null);
          setStatusFilter(null);
        }}
      />
      <DashboardRow metrics={metrics} />

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div
            className="p-10 text-center border border-dashed rounded-xl m-4"
            style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}
          >
            No signals match. Signals appear here once the detection pipeline surfaces one.
          </div>
        ) : view === "table" ? (
          <table className="w-full text-sm">
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
                  <td className="px-4 py-2" style={{ color: "var(--color-navy)" }}>{s.type}</td>
                  <td className="px-4 py-2" style={{ color: "var(--color-warm-gray)" }}>{s.subjectType}</td>
                  <td className="px-4 py-2" style={{ color: "var(--color-warm-gray)" }}>{s.status}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "act")}>Act</Button>
                      <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "save")}>Save</Button>
                      <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "dismiss")}>Dismiss</Button>
                    </div>
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
                    <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "act")}>Act</Button>
                    <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "dismiss")}>Dismiss</Button>
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
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--color-navy)" }}>{s.type}</div>
                  <div className="text-xs truncate" style={{ color: "var(--color-warm-gray)" }}>{s.subjectType} · {s.status}</div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "act")}>Act</Button>
                  <Button size="sm" variant="outline" disabled={busyId === s.id} onClick={() => react(s.id, "dismiss")}>Dismiss</Button>
                </div>
              </>
            )}
          />
        )}
      </div>
    </div>
  );
}
