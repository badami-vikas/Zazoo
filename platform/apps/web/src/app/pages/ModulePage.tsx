import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Boxes } from "lucide-react";
import { moduleStructure } from "@bridge/core";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { ModuleGovernanceSection } from "../components/shared/ModuleGovernanceSection";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { DataViews } from "../dataviews/DataViews";
import type { ColumnSchemaActions, DataRow } from "../dataviews/types";
import type { ColumnSchemaCapability } from "../components/shared/StandardColumnMenu";

export type Installation = Awaited<ReturnType<typeof trpc.modules.list.query>>["items"][number];

/** The canonical route of a manifest-declared Page in the standard shell. */
export function modulePageRoute(moduleName: string, pageId: string): string {
  return `/module/${moduleName}/${pageId}`;
}

/** The standard Record detail page of a manifest-declared Page (C-15). */
export function moduleRecordRoute(moduleName: string, pageId: string, recordId: string): string {
  return `/module/${moduleName}/${pageId}/${recordId}`;
}

/**
 * The INSTALLED manifest of a Module (never a built-in catalog: a Module the
 * user built is not in one). `undefined` while loading, `null` when the
 * Module is not installed here. Shared by the Module Page and its Record
 * page so both read the same manifest the same way.
 */
export function useInstalledModule(moduleName: string): {
  installation: Installation | null | undefined;
  error: string | null;
} {
  const [installation, setInstallation] = useState<Installation | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
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
  return { installation, error };
}

/**
 * The standard Module Page (ADR 2026-09-04) — what every Module the Builder
 * makes gets without writing a line of React.
 *
 * Reads the installed manifest, picks the Page by id, and renders the same
 * anatomy every hand-written Module Page has (UI Rulebook §3): the Header
 * toggle across the Pages of the current SCOPE — the sub-module's Pages when
 * this Page belongs to one, the root's otherwise (§2, §5h) — the data surface
 * through `DataViews` with the declared Database's columns, and the
 * Intelligence and Governance Sections below. Rows come from
 * `moduleRecords.*`; an empty Database is the same surface with nothing in it
 * (§6b), never a placeholder. A row opens the standard Record detail page.
 */
export function ModulePage() {
  const { moduleName = "", pageId = "" } = useParams();
  const navigate = useNavigate();
  const { installation, error: loadError } = useInstalledModule(moduleName);
  const [spec, setSpec] = useState<TableSpec | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capability, setCapability] = useState<ColumnSchemaCapability | null>(null);
  const [view, setView] = useState<ViewConfig>(() =>
    defaultViewConfig(`${moduleName}.${pageId}:table`),
  );

  const structure = useMemo(
    () => moduleStructure(installation?.manifest ?? { module: undefined }),
    [installation],
  );
  const pages = installation?.manifest?.module?.pages ?? [];
  const page =
    pages.find((candidate) => candidate.id === pageId) ?? structure.rootPages[0] ?? pages[0] ?? null;
  const scope = page ? structure.scopeOf(page.id) : null;
  const scopePages = scope ? scope.pages : structure.rootPages;

  const load = useCallback(async () => {
    if (!page) return;
    try {
      const [definition, list, schema] = await Promise.all([
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
        // The column menu's capability, exactly as Accounting reads it: the
        // server says whether this Database may be reshaped and whether it can
        // gain a column, and the menu disables against that answer.
        trpc.tableSchema.get.query({
          organizationId: PILOT_ORGANIZATION,
          specId: `${moduleName}.${page.databaseId}`,
        }),
      ]);
      setCapability({
        available: schema.available,
        reason: schema.reason,
        canUndo: schema.canUndo,
        canAddColumn: schema.canAddColumn,
        addReason: schema.addReason,
      });
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

  /**
   * Rename / add / change type / lock / remove / undo, routed to the same
   * governed capability Accounting uses (TASK-084). A Module Database's spec
   * comes from its installed manifest, and the user's changes ride over it as
   * the per-Organization column overlay — manifests stay immutable (ADR-178).
   *
   * Every command re-reads through `load()`: the server has the last word on
   * what changed (ADR-247), so nothing here echoes its own input back.
   */
  const specId = page ? `${moduleName}.${page.databaseId}` : "";
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
      addColumn: async (columnId, label, kind) => {
        await trpc.tableSchema.mutate.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId,
          op: { kind: "add", columnId, label, columnKind: kind },
        });
        await load();
      },
      changeType: async (columnId, kind) => {
        await trpc.tableSchema.mutate.mutate({
          organizationId: PILOT_ORGANIZATION,
          specId,
          op: { kind: "setKind", columnId, columnKind: kind },
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

  const shown = error ?? loadError;
  if (shown) return <div className="p-6 text-sm text-red-600">{shown}</div>;
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
        tabs={scopePages.map((candidate) => ({ id: candidate.name, icon: Boxes }))}
        activeTab={page.name}
        onTabChange={(name) => {
          const next = scopePages.find((candidate) => candidate.name === name);
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
                columnSchema={columnSchema}
                moduleName={moduleName}
                searchPlaceholder={`Search ${page.name.toLowerCase()}…`}
                onOpenRecord={(row) => {
                  if (typeof row.id === "string") navigate(moduleRecordRoute(moduleName, page.id, row.id));
                }}
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
