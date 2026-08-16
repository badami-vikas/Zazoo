import { useCallback, useEffect, useMemo, useState } from "react";
import { NotebookText } from "lucide-react";
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

/** D2C sub-module: Notes (TASK-074). Real, possibly-empty `noteDocuments`
 * rows from `ctx.wiring.d2cDb`. The per-document block editor is a later
 * pass — this Page is the document list. */
export function D2CNotesPage() {
  const [spec, setSpec] = useState<TableSpec | null>(null);
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof trpc.d2cNotes.documentsList.query>>["items"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig("d2c-notes.documents:table"));

  const load = useCallback(async () => {
    try {
      const [definition, list] = await Promise.all([
        trpc.d2cNotes.documentsDefinition.query({ organizationId: PILOT_ORGANIZATION }),
        trpc.d2cNotes.documentsList.query({ organizationId: PILOT_ORGANIZATION }),
      ]);
      setSpec(definition as TableSpec);
      setDocuments(list.items);
    } catch (failure) {
      setError(String(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<DataRow[]>(
    () => (documents ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
    [documents],
  );

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  return (
    <InstalledModuleBoundary moduleName="d2c-notes">
      <div className="flex h-full flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
        <Header tabs={[{ id: "Notes", icon: NotebookText }]} activeTab="Notes" onTabChange={() => {}} />
        {!spec ? (
          <div className="p-6 text-sm text-muted-foreground">Loading notes…</div>
        ) : (
          <ModuleSurfaceLayout
            table={
              <section aria-label="Notes" className="h-full">
                <DataViews
                  spec={spec}
                  view={view}
                  data={rows}
                  searchPlaceholder={`Search notes…`}
                  insertDisabledReason="Creating a note document inline is not implemented in this pass."
                  onViewChange={setView}
                  insights={<DashboardRow metrics={[{ id: "documents", label: "Documents", value: String(documents?.length ?? 0) }]} />}
                />
              </section>
            }
            below={
              <>
                <ModuleIntelligenceSection moduleName="d2c-notes" />
                <ModuleGovernanceSection moduleName="d2c-notes" />
              </>
            }
          />
        )}
      </div>
    </InstalledModuleBoundary>
  );
}

export default D2CNotesPage;
