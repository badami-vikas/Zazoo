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
import type { ColumnSchemaActions, DataRow } from "../dataviews/types";
import type { ColumnSchemaCapability } from "../components/shared/StandardColumnMenu";

/**
 * Accounting — Clients and Reports Pages (TASK-074). Real, possibly-empty
 * data from `ctx.wiring.accountingDb` (the imported Avilo Advisory sqlite,
 * ADR-246). Formula-engine/P&L computation stays out of this pass — Reports
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
  const [capability, setCapability] = useState<ColumnSchemaCapability | null>(null);
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig(`accounting.${page}:table`));

  /**
   * The RESOLVED spec, not the shipped one (TASK-084).
   *
   * `tableSchema.get` returns the Module author's spec with this Organization's
   * column overlay already applied, plus whether the schema-mutation capability
   * exists here at all. Using it as the spec is what makes a rename survive a
   * reload; using its `available`/`reason` is what keeps the column menu honest
   * about what it can do.
   */
  const load = useCallback(async () => {
    try {
      const specId = page === "clients" ? "accounting.books" : "accounting.reports";
      const schema = await trpc.tableSchema.get.query({
        organizationId: PILOT_ORGANIZATION,
        specId,
      });
      setCapability({
        available: schema.available,
        reason: schema.reason,
        canUndo: schema.canUndo,
        canAddColumn: schema.canAddColumn,
        addReason: schema.addReason,
      });
      if (page === "clients") {
        const [definition, list] = await Promise.all([
          trpc.accounting.clientsDefinition.query({ organizationId: PILOT_ORGANIZATION }),
          trpc.accounting.clientsList.query({ organizationId: PILOT_ORGANIZATION }),
        ]);
        setSpec((schema.spec ?? definition) as TableSpec);
        setClients(list.items);
      } else {
        const [definition, list] = await Promise.all([
          trpc.accounting.reportsDefinition.query({ organizationId: PILOT_ORGANIZATION }),
          trpc.accounting.reportsList.query({ organizationId: PILOT_ORGANIZATION }),
        ]);
        setSpec((schema.spec ?? definition) as TableSpec);
        setFormulas(list.items);
      }
    } catch (failure) {
      setError(String(failure));
    }
  }, [page]);

  const specId = page === "clients" ? "accounting.books" : "accounting.reports";

  /** Every command re-reads through `load()` afterwards: the server has the
   * last word on what changed (ADR-247), so nothing here echoes its own input
   * back into the table as if it had succeeded. */
  const columnSchema = useMemo<ColumnSchemaActions>(
    () => ({
      capability,
      rename: async (columnId, label) => {
        await trpc.tableSchema.mutate.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId,
          op: { kind: "rename", columnId, label },
        });
        await load();
      },
      changeType: async (columnId, kind, options) => {
        await trpc.tableSchema.mutate.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId,
          op: {
            kind: "setKind",
            columnId,
            columnKind: kind,
            ...(options?.length ? { options } : {}),
          },
        });
        await load();
      },
      setLocked: async (columnId, locked) => {
        await trpc.tableSchema.mutate.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId,
          op: { kind: "setLocked", columnId, locked },
        });
        await load();
      },
      remove: async (columnId) => {
        await trpc.tableSchema.mutate.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId,
          op: { kind: "delete", columnId },
        });
        await load();
      },
      preview: (columnId) =>
        trpc.tableSchema.preview.query({ organizationId: PILOT_ORGANIZATION, specId, columnId }),
      undo: async () => {
        await trpc.tableSchema.undo.mutate({ organizationId: PILOT_ORGANIZATION, specId });
        await load();
      },
    }),
    [capability, specId, load],
  );

  /**
   * The fx commit path. A formula column's `expressionField` is the only field
   * this Page writes: `setFormulaExpression` validates through Accounting's own
   * engine BEFORE the write, so a bad expression is refused rather than stored,
   * and the reload afterwards is what recomputes every dependent metric.
   */
  const updateRow = useCallback(
    async (rowId: string, patch: Record<string, unknown>) => {
      const expression = patch["expression"];
      if (typeof expression !== "string") return;
      await trpc.tableSchema.setFormulaExpression.mutate({
        organizationId: PILOT_ORGANIZATION,
        formulaId: rowId,
        expression,
      });
      await load();
    },
    [load],
  );

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
      /**
       * The computed metric. `null` until facts are imported — the engine
       * evaluates one (client, period) scope and this Page scopes to neither,
       * so there is no honest figure to show and none is invented (ADR-247:
       * unknown is first-class). The EXPRESSION beside it is real and editable.
       */
      value: null,
      expression: f.expression,
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
                      : "The formula registry ships with the application — a new metric is added by the Module, but an existing one's expression is editable here with fx."
                  }
                  columnSchema={columnSchema}
                  onUpdate={page === "reports" ? updateRow : undefined}
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
