/**
 * Signals is the Relationship Module's participant-linked Event surface.
 * Column metadata drives the canonical DataViews grammar; selecting a Record
 * exposes direct save/dismiss reactions and the governed Action detail.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Radio } from "lucide-react";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { collectAllPages } from "../lib/pagination";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { DashboardRow, type DashboardMetric } from "../components/shared/DashboardRow";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { Button } from "../components/ui/button";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow, GraphNode } from "../dataviews/types";

type SignalPage = Awaited<ReturnType<typeof trpc.relationship.listSignals.query>>;
type SignalItem = SignalPage["items"][number];

const SIGNALS_SPEC: TableSpec = {
  id: "signals",
  columns: [
    { id: "type", label: "Signal", kind: "text", editable: false, hiddenInForm: true },
    { id: "subjectType", label: "Participant type", kind: "text", editable: false, hiddenInForm: true },
    {
      id: "subject",
      label: "Participant",
      kind: "relation",
      relationTarget: "relationship-records",
      editable: false,
      hiddenInForm: true,
    },
    { id: "status", label: "Status", kind: "select", editable: false, hiddenInForm: true },
    { id: "recommendedAction", label: "Recommended Action", kind: "text", editable: false, hiddenInForm: true },
    { id: "createdAt", label: "Detected", kind: "date", editable: false, hiddenInForm: true },
  ],
};

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
  const navigate = useNavigate();
  const [page, setPage] = useState<SignalPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig("signals:table"));
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      const items = await collectAllPages((offset, limit) =>
        trpc.relationship.listSignals.query({ organizationId: PILOT_ORGANIZATION, limit, offset }),
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
      await trpc.relationship.recordSignalAction.mutate({ organizationId: PILOT_ORGANIZATION, signalId, verb });
      await refresh();
    } catch (e) {
      setActionErrors((current) => ({ ...current, [signalId]: String(e) }));
    } finally {
      setBusyId(null);
    }
  }

  const rows = useMemo<DataRow[]>(
    () => (page?.items ?? []).map((signal) => ({
      id: signal.id,
      type: signal.type,
      subjectType: signal.subjectType,
      subject: signal.subjectId,
      status: signal.status,
      recommendedAction: recommendedActionLabel(signal),
      createdAt: signal.createdAt,
    })),
    [page],
  );
  const selectedSignal = page?.items.find((signal) => signal.id === selectedSignalId) ?? null;

  const metrics: DashboardMetric[] = page
    ? [
        { id: "total", label: "Total Signals", value: String(page.total) },
        { id: "new", label: "New", value: String(page.items.filter((s) => s.status === "new").length) },
        { id: "today", label: "Detected Today", value: String(page.items.filter((s) => isToday(s.createdAt)).length) },
      ]
    : [];

  function openRecord(row: DataRow | GraphNode) {
    const recordId = String("recordId" in row && row.recordId ? row.recordId : row.id);
    const signal = page?.items.find((item) => item.id === recordId);
    if (signal) {
      setSelectedSignalId(signal.id);
      return;
    }
    const subjectId = recordId.startsWith("relationship-records:")
      ? recordId.slice("relationship-records:".length)
      : recordId;
    const subject = page?.items.find((item) => item.subjectId === subjectId);
    if (subject) {
      navigate(`/module/relationship/${subject.subjectType === "person" ? "people" : "communities"}/${subjectId}`);
    }
  }

  if (loadError) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{loadError}</div>;
  if (!page) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
      {!embedded && <Header tabs={[{ id: "Signals", icon: Radio }]} activeTab="Signals" onTabChange={() => {}} />}

      {refreshError && (
        <div role="alert" className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          The Signal was updated, but the latest list could not be loaded: {refreshError}
        </div>
      )}

      <ModuleSurfaceLayout
        table={
          <section aria-label="Signals Database" className="h-full">
            <DataViews
              spec={SIGNALS_SPEC}
              view={view}
              data={rows}
              onViewChange={setView}
              onOpenRecord={openRecord}
              insights={<DashboardRow metrics={metrics} />}
            />
          </section>
        }
        // The selected-Signal strip stays INSIDE the first screen: it is the
        // direct response to clicking a row, so putting it below the fold
        // would make selection look like it did nothing.
        footer={selectedSignal ? (
          <section className="mx-4 mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }} aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide" style={{ color: "var(--color-warm-gray)" }}>Selected Signal</p>
                <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>{selectedSignal.type}</h2>
                <p className="text-xs capitalize" style={{ color: "var(--color-warm-gray)" }}>
                  {selectedSignal.subjectType} · {selectedSignal.status}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/module/relationship/signals/${selectedSignal.id}`}>{recommendedActionLabel(selectedSignal)}</Link>
                </Button>
                <Button size="sm" variant="outline" disabled={busyId === selectedSignal.id} onClick={() => react(selectedSignal.id, "save")}>Save</Button>
                <Button size="sm" variant="outline" disabled={busyId === selectedSignal.id} onClick={() => react(selectedSignal.id, "dismiss")}>Dismiss</Button>
              </div>
            </div>
            {actionErrors[selectedSignal.id] && <p role="alert" className="mt-2 text-xs text-red-600">{actionErrors[selectedSignal.id]}</p>}
          </section>
        ) : null}
        below={
          <>
            <ModuleFilesSection moduleName="relationship" />
            <ModuleIntelligenceSection moduleName="relationship" />
          </>
        }
      />
    </div>
  );
}
