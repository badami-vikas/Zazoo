import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Boxes } from "lucide-react";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { ModuleGovernanceSection } from "../components/shared/ModuleGovernanceSection";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow } from "../dataviews/types";

type Installation = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];
type PageBinding = NonNullable<NonNullable<Installation["manifest"]>["module"]>["pages"][number];

/** The canonical route of a manifest-declared Page in the standard shell. */
export function modulePageRoute(moduleName: string, pageId: string): string {
  return `/module/${moduleName}/${pageId}`;
}

/**
 * The standard Module Page (ADR 2026-09-04) — what every Module the Builder
 * makes gets without writing a line of React.
 *
 * Reads the INSTALLED manifest (never a built-in catalog: a Module the user
 * built is not in one), picks the Page by id, and renders the same anatomy
 * every hand-written Module Page has (UI Rulebook §3): the Header toggle
 * across the Module's Pages, the data surface through `DataViews` with the
 * declared Database's columns, and the Intelligence and Governance Sections
 * below. Rows come from `moduleRecords.*`; an empty Database is the same
 * surface with nothing in it (§6b), never a placeholder.
 */
export function ModulePage() {
  const { moduleName = "", pageId = "" } = useParams();
  const navigate = useNavigate();
  const [installation, setInstallation] = useState<Installation | null | undefined>(undefined);
  const [spec, setSpec] = useState<TableSpec | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewConfig>(() =>
    defaultViewConfig(`${moduleName}.${pageId}:table`),
  );

  useEffect(() => {
    let cancelled = false;
    setInstallation(undefined);
    setError(null);
    trpc.modules.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((result) => {
        if (cancelled) return;
        setInstallation(
          result.items.find(
            (item) =>
              item.moduleName === moduleName &&
              item.state === "available" &&
              item.status === "installed",
          ) ?? null,
        );
      })
      .catch((failure) => {
        if (!cancelled) setError(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [moduleName]);

  const pages: PageBinding[] = useMemo(
    () => installation?.manifest?.module?.pages ?? [],
    [installation],
  );
  const page = pages.find((candidate) => candidate.id === pageId) ?? pages[0] ?? null;

  const load = useCallback(async () => {
    if (!page) return;
    try {
      const [definition, list] = await Promise.all([
        trpc.moduleRecords.definition.query({
          organizationId: PILOT_ORGANIZATION,
          moduleName,
          databaseId: page.databaseId,
        }),
        trpc.moduleRecords.list.query({
          organizationId: PILOT_ORGANIZATION,
          moduleName,
          databaseId: page.databaseId,
        }),
      ]);
      setSpec(definition.spec);
      setRows(list.items);
      setView(defaultViewConfig(`${moduleName}.${page.id}:table`));
    } catch (failure) {
      setError(String(failure));
    }
  }, [moduleName, page]);

  useEffect(() => {
    setSpec(null);
    void load();
  }, [load]);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (installation === undefined) return null;
  if (installation === null) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {moduleName} is not an installed Module of this Organization.
      </div>
    );
  }
  if (!page) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {installation.manifest?.module?.displayName ?? moduleName} declares no Pages yet. Ask the
        Builder to add one to its module.yaml.
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-1 flex-col overflow-hidden"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <Header
        tabs={pages.map((candidate) => ({ id: candidate.name, icon: Boxes }))}
        activeTab={page.name}
        onTabChange={(name) => {
          const next = pages.find((candidate) => candidate.name === name);
          if (next) navigate(modulePageRoute(moduleName, next.id));
        }}
      />
      {!spec ? (
        <div className="p-6 text-sm text-muted-foreground">Loading {page.name}…</div>
      ) : (
        <ModuleSurfaceLayout
          table={
            <section aria-label={`${installation.manifest?.module?.displayName ?? moduleName} ${page.name}`} className="h-full">
              <DataViews
                spec={spec}
                view={view}
                data={rows}
                onViewChange={setView}
                moduleName={moduleName}
                searchPlaceholder={`Search ${page.name.toLowerCase()}…`}
                onInsert={async (draft) => {
                  await trpc.moduleRecords.insert.mutate({
                    organizationId: PILOT_ORGANIZATION,
                    moduleName,
                    databaseId: page.databaseId,
                    fields: draft,
                  });
                  await load();
                }}
                onDeleteRows={async (recordIds) => {
                  await trpc.moduleRecords.remove.mutate({
                    organizationId: PILOT_ORGANIZATION,
                    moduleName,
                    databaseId: page.databaseId,
                    recordIds,
                  });
                  await load();
                }}
              />
            </section>
          }
          below={
            <>
              <ModuleIntelligenceSection moduleName={moduleName} />
              <ModuleGovernanceSection moduleName={moduleName} />
            </>
          }
        />
      )}
    </div>
  );
}
