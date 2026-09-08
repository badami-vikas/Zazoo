/**
 * AuthoredModulePage — the one Page that renders every Module the owner
 * authored through Chief of Staff.
 *
 * A built-in Module ships a hand-written Page against its own table. An
 * authored Module has neither, so this reads its declared columns and its
 * Records from `authoredModules.*` and hands them to the SAME `<DataViews>`
 * shell every other data surface uses. That is the View grammar's own rule
 * holding: "Generation = configurations of REGISTERED components only, never
 * new components" — nothing here is generated, the shape is just data.
 *
 * One component serves every authored Module and every Database in it, keyed
 * off the route params. There is no per-Module code to write, which is the
 * whole point: the person asking for a Module is waiting.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import type { ColumnSpec, TableSpec, ViewConfig } from "@bridge/tables";
import { DataViews } from "../dataviews/DataViews";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import type { DataRow } from "../dataviews/types";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";

type AuthoredColumn = {
  id: string;
  label: string;
  kind: string;
  options?: string[];
  required?: boolean;
};

type AuthoredRecord = { id: string; properties: Record<string, unknown> };

/** The declared column shape, as the table engine's own ColumnSpec. A straight
 * projection: the authored kinds are deliberately a SUBSET of `ColumnKind`
 * (see `AUTHORABLE_COLUMN_KINDS`), so nothing needs translating. */
function toTableSpec(databaseId: string, columns: AuthoredColumn[]): TableSpec {
  return {
    id: databaseId,
    columns: columns.map((column): ColumnSpec => ({
      id: column.id,
      label: column.label,
      kind: column.kind as ColumnSpec["kind"],
      editable: true,
      ...(column.options ? { options: column.options } : {}),
      ...(column.required !== undefined ? { required: column.required } : {}),
    })),
  };
}

const DEFAULT_VIEW: ViewConfig = {
  id: "table",
  kind: "table",
  sorts: [],
  rowFilters: [],
  filterMatch: "all",
  groupBy: null,
};

export function AuthoredModulePage() {
  const { moduleName, pageId } = useParams<{ moduleName: string; pageId: string }>();
  const [columns, setColumns] = useState<AuthoredColumn[] | null>(null);
  const [rows, setRows] = useState<AuthoredRecord[]>([]);
  const [view, setView] = useState<ViewConfig>(DEFAULT_VIEW);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!moduleName || !pageId) return;
    const result = await trpc.authoredModules.records.query({
      organizationId: PILOT_ORGANIZATION,
      moduleName,
      databaseId: pageId,
    });
    setColumns(result.columns as AuthoredColumn[]);
    setRows(result.items.map((item) => ({ id: item.id, properties: item.properties })));
  }, [moduleName, pageId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void load()
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  // A Record is `{ id, ...cells }` for the table engine; the cells live under
  // `properties` on the wire so a column can never collide with `id`.
  const data: DataRow[] = useMemo(
    () => rows.map((row) => ({ id: row.id, ...row.properties })),
    [rows],
  );
  const spec = useMemo(
    () => toTableSpec(pageId ?? "records", columns ?? []),
    [columns, pageId],
  );

  const write = useCallback(
    async (run: () => Promise<unknown>) => {
      setError(null);
      try {
        await run();
        await load();
      } catch (cause) {
        // The server validates every cell against the approved columns, so its
        // refusal is the useful message ("Status must be one of reading,
        // finished") — surfaced rather than swallowed.
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [load],
  );

  const onInsert = useCallback(
    (draft: Partial<DataRow>) =>
      write(() =>
        trpc.authoredModules.createRecord.mutate({
          organizationId: PILOT_ORGANIZATION,
          moduleName: moduleName!,
          databaseId: pageId!,
          properties: stripId(draft),
        }),
      ),
    [moduleName, pageId, write],
  );

  const onUpdate = useCallback(
    (rowId: string, patch: Partial<DataRow>) => {
      const current = rows.find((row) => row.id === rowId);
      if (!current) return;
      return write(() =>
        trpc.authoredModules.updateRecord.mutate({
          organizationId: PILOT_ORGANIZATION,
          moduleName: moduleName!,
          databaseId: pageId!,
          recordId: rowId,
          // A cell edit is a patch; the server replaces the whole Record, so
          // the untouched cells travel with it.
          properties: { ...current.properties, ...stripId(patch) },
        }),
      );
    },
    [moduleName, pageId, rows, write],
  );

  if (loading) return <div className="p-6 text-sm text-neutral-500">Loading…</div>;
  if (columns === null) {
    return (
      <div className="p-6 text-sm text-neutral-500">
        {error ?? "This Module has no Database by that name."}
      </div>
    );
  }

  // Through the standard shell like every other data-shape Page (§3/§5). An
  // authored Module is not a special surface — it is an ordinary Database Page
  // whose columns happen to have been declared at runtime, so it renders the
  // same way rather than growing chrome of its own.
  return (
    <ModuleSurfaceLayout
      {...(error
        ? {
            above: (
              <div
                role="alert"
                className="mx-3 mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 sm:mx-4"
              >
                {error}
              </div>
            ),
          }
        : {})}
      table={
        <DataViews
          spec={spec}
          view={view}
          data={data}
          onViewChange={setView}
          onInsert={onInsert}
          onUpdate={onUpdate}
        />
      }
    />
  );
}

/** `id` is the Record's identity, never one of its cells. */
function stripId(draft: Partial<DataRow>): Record<string, unknown> {
  const { id: _id, ...cells } = draft;
  return cells;
}
