import { useCallback, useEffect, useMemo, useState } from "react";
import { Leaf } from "lucide-react";
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

/** D2C sub-module: Plant Records (TASK-071). Real, possibly-empty `plants`
 * rows from `ctx.wiring.d2cDb`. */
export function D2CResearchPage() {
  const [spec, setSpec] = useState<TableSpec | null>(null);
  const [plants, setPlants] = useState<Awaited<ReturnType<typeof trpc.d2cResearch.plantsList.query>>["items"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig("d2c-research.plants:table"));

  const load = useCallback(async () => {
    try {
      const [definition, list] = await Promise.all([
        trpc.d2cResearch.plantsDefinition.query({ organizationId: PILOT_ORGANIZATION }),
        trpc.d2cResearch.plantsList.query({ organizationId: PILOT_ORGANIZATION }),
      ]);
      setSpec(definition as TableSpec);
      setPlants(list.items);
    } catch (failure) {
      setError(String(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<DataRow[]>(
    () => (plants ?? []).map((p) => ({
      id: p.id,
      commonName: p.commonName,
      botanicalName: p.botanicalName,
      summary: p.summary,
    })),
    [plants],
  );

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  return (
    <InstalledModuleBoundary moduleName="d2c-research">
      <div className="flex h-full flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
        <Header tabs={[{ id: "Research", icon: Leaf }]} activeTab="Research" onTabChange={() => {}} />
        {!spec ? (
          <div className="p-6 text-sm text-muted-foreground">Loading plant records…</div>
        ) : (
          <ModuleSurfaceLayout
            table={
              <section aria-label="Plant Records" className="h-full">
                <DataViews
                  spec={spec}
                  view={view}
                  data={rows}
                  searchPlaceholder={`Search plants…`}
                  insertDisabledReason="Plant records are added from a research link, not implemented in this pass."
                  onViewChange={setView}
                  insights={<DashboardRow metrics={[{ id: "plants", label: "Plants", value: String(plants?.length ?? 0) }]} />}
                />
              </section>
            }
            below={
              <>
                <ModuleIntelligenceSection moduleName="d2c-research" />
                <ModuleGovernanceSection moduleName="d2c-research" />
              </>
            }
          />
        )}
      </div>
    </InstalledModuleBoundary>
  );
}

export default D2CResearchPage;
