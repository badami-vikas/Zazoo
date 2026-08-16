import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Users, FileBarChart } from "lucide-react";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { ModuleGovernanceSection } from "../components/shared/ModuleGovernanceSection";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { DashboardRow } from "../components/shared/DashboardRow";
import { InstalledModuleBoundary } from "../components/InstalledModuleBoundary";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow } from "../dataviews/types";

/**
 * Accounting — Clients and Reports Pages (TASK-071). Real, possibly-empty
 * data from `ctx.wiring.accountingDb` (the imported Avilo Advisory sqlite,
 * ADR-237). Formula-engine/P&L computation stays out of this pass — Reports
 * shows the versioned formula registry itself, not computed figures.
 */
type AccountingPageId = "clients" | "reports";
type ClientRow = Awaited<ReturnType<typeof trpc.accounting.clientsList.query>>["items"][number];
type FormulaRow = Awaited<ReturnType<typeof trpc.accounting.reportsList.query>>["items"][number];

const TAB_ROUTE: Record<string, string> = {
  Clients: "/module/accounting/clients",
  Reports: "/module/accounting/reports",
};

const LOADING_SPEC: TableSpec = { id: "loading", columns: [{ id: "name", label: "Name", kind: "text" }] };

export function AccountingPage({ page }: { page: AccountingPageId }) {
  const navigate = useNavigate();
  const [spec, setSpec] = useState<TableSpec | null>(null);
  const [clients, setClients] = useState<ClientRow[] | null>(null);
  const [formulas, setFormulas] = useState<FormulaRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig(`accounting.${page}:table`));

  const load = useCallback(async () => {
    try {
      if (page === "clients") {
        const [definition, list] = await Promise.all([
          trpc.accounting.clientsDefinition.query({ organizationId: PILOT_ORGANIZATION }),
          trpc.accounting.clientsList.query({ organizationId: PILOT_ORGANIZATION }),
        ]);
        setSpec(definition as TableSpec);
        setClients(list.items);
      } else {
        const [definition, list] = await Promise.all([
          trpc.accounting.reportsDefinition.query({ organizationId: PILOT_ORGANIZATION }),
          trpc.accounting.reportsList.query({ organizationId: PILOT_ORGANIZATION }),
        ]);
        setSpec(definition as TableSpec);
        setFormulas(list.items);
      }
    } catch (failure) {
      setError(String(failure));
    }
  }, [page]);

  useEffect(() => {
    setSpec(null);
    setView(defaultViewConfig(`accounting.${page}:table`));
    void load();
  }, [page, load]);

  const rows = useMemo<DataRow[]>(() => {
    if (page === "clients") {
      return (clients ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        legalName: c.legalName,
        stage: c.stage,
        industry: c.industry,
        owner: c.owner,
        createdAt: c.createdAt,
      }));
    }
    return (formulas ?? []).map((f) => ({
      id: f.id,
      label: f.label,
      unit: f.unit,
      description: f.description,
      version: f.version,
      active: f.active,
    }));
  }, [page, clients, formulas]);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  return (
    <InstalledModuleBoundary moduleName="accounting">
      <div className="flex h-full flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
        <Header
          tabs={[
            { id: "Clients", icon: Users },
            { id: "Reports", icon: FileBarChart },
          ]}
          activeTab={page === "clients" ? "Clients" : "Reports"}
          onTabChange={(id) => {
            const route = TAB_ROUTE[id];
            if (route) navigate(route);
          }}
        />
        {!spec ? (
          <div className="p-6 text-sm text-muted-foreground">Loading {page}…</div>
        ) : (
          <ModuleSurfaceLayout
            table={
              <section aria-label={`Accounting ${page}`} className="h-full">
                <DataViews
                  spec={spec}
                  view={view}
                  data={rows}
                  searchPlaceholder={page === "clients" ? "Search clients…" : "Search reports…"}
                  insertDisabledReason={
                    page === "clients"
                      ? "Clients arrive from onboarding an advisory engagement, not implemented in this pass."
                      : "The formula registry ships with the application — edit a formula's expression from Formulas, not here."
                  }
                  onViewChange={setView}
                  insights={
                    <DashboardRow
                      metrics={
                        page === "clients"
                          ? [{ id: "clients", label: "Clients", value: String(clients?.length ?? 0) }]
                          : [{ id: "formulas", label: "Metrics", value: String(formulas?.length ?? 0) }]
                      }
                    />
                  }
                />
              </section>
            }
            below={
              <>
                <ModuleIntelligenceSection moduleName="accounting" />
                <ModuleGovernanceSection moduleName="accounting" />
              </>
            }
          />
        )}
      </div>
    </InstalledModuleBoundary>
  );
}

export default AccountingPage;
