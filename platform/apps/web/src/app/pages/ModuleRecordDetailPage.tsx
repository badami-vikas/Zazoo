/**
 * The standard Record detail page of a Builder-built Module (TASK-100,
 * UI Rulebook "Element (detail) pages"): the element level of Module →
 * sub-module → Page → Section → Record.
 *
 * Nothing is declared for it beyond the Database's Sections. Its anatomy is
 * the book's: a sticky back + path header (C-15), the Database's columns as
 * fields — editable ones as inputs, derived ones saying what fills them, the
 * same rule the new-Record page applies — and the enabled Sections through
 * the one per-Database component every Record page shares. Typing changes a
 * draft in React state; the Record is written on Save only (C-34).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router";
import { moduleStructure } from "@bridge/core";
import type { TableSpec } from "@bridge/tables";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { RecordSections } from "../components/shared/RecordSections";
import { nonEditableReason } from "../dataviews/RecordPage";
import { FieldInput } from "../dataviews/views/FormView";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";
import { modulePageRoute, useInstalledModule } from "./ModulePage";

type Row = Awaited<ReturnType<typeof trpc.moduleRecords.list.query>>["items"][number];

/** The Record's own name: its first text column, else its id. */
function recordTitle(spec: TableSpec, row: Row): string {
  const named = spec.columns.find((column) => column.kind === "text" && typeof row[column.id] === "string" && row[column.id]);
  return named ? String(row[named.id]) : row.id;
}

export function ModuleRecordDetailPage() {
  const { moduleName = "", pageId = "", recordId = "" } = useParams();
  const { installation, error: loadError } = useInstalledModule(moduleName);
  const [spec, setSpec] = useState<TableSpec | null>(null);
  const [row, setRow] = useState<Row | null | undefined>(undefined);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manifest = installation?.manifest;
  const page = manifest?.module?.pages.find((candidate) => candidate.id === pageId) ?? null;
  const scope = useMemo(
    () => (page ? moduleStructure(manifest ?? { module: undefined }).scopeOf(page.id) : null),
    [manifest, page],
  );
  const specId = `${moduleName}.${page?.databaseId ?? ""}`;

  const load = useCallback(async () => {
    if (!page) return;
    try {
      const [definition, list] = await Promise.all([
        trpc.moduleRecords.definition.query({ organizationId: PILOT_ORGANIZATION, moduleName, databaseId: page.databaseId }),
        trpc.moduleRecords.list.query({ organizationId: PILOT_ORGANIZATION, moduleName, databaseId: page.databaseId }),
      ]);
      const found = list.items.find((candidate) => candidate.id === recordId) ?? null;
      setSpec(definition.spec);
      setRow(found);
      setDraft(found ? { ...found } : {});
      setError(null);
    } catch (failure) {
      setError(String(failure));
    }
  }, [moduleName, page, recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!spec || !row || !page) return;
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      for (const column of spec.columns) {
        if (nonEditableReason(column) === null && draft[column.id] !== row[column.id]) fields[column.id] = draft[column.id];
      }
      if (Object.keys(fields).length > 0) {
        await trpc.moduleRecords.update.mutate({
          organizationId: PILOT_ORGANIZATION,
          moduleName,
          databaseId: page.databaseId,
          recordId,
          fields,
        });
      }
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSaving(false);
    }
  }

  const shown = error ?? loadError;
  const back = page ? modulePageRoute(moduleName, page.id) : `/module/${moduleName}`;
  const dirty = !!spec && !!row && spec.columns.some((column) => draft[column.id] !== row[column.id]);
  const displayName = manifest?.module?.displayName ?? moduleName;
  const path = [displayName, ...(scope ? [scope.name] : []), page?.name ?? pageId];

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: "var(--color-surface)" }}>
      {/* C-15: back + path, sticky; content scrolls under it. */}
      <header
        className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4"
        style={{ backgroundColor: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <Link to={back} aria-label={`Back to ${page?.name ?? "the Page"}`} className="inline-flex items-center gap-1 text-sm text-[var(--color-steel)]">
          <ArrowLeft className="size-4" /> {page?.name ?? "Back"}
        </Link>
        <p className="min-w-0 truncate text-sm" style={{ color: "var(--color-navy)" }}>
          {path.join(" / ")}
          {spec && row ? ` / ${recordTitle(spec, row)}` : ""}
        </p>
      </header>

      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        {shown && <p role="alert" className="text-sm text-red-600">{shown}</p>}
        {installation === null && (
          <p className="text-sm text-muted-foreground">{moduleName} is not an installed Module of this Organization.</p>
        )}
        {installation && !page && (
          <p className="text-sm text-muted-foreground">{displayName} declares no Page {pageId}.</p>
        )}
        {page && row === null && (
          <p className="text-sm text-muted-foreground">No Record {recordId} in {page.name}.</p>
        )}
        {spec && row && (
          <>
            <div className="space-y-4 rounded-xl border p-5" style={{ borderColor: "var(--color-border)" }}>
              {spec.columns.map((column) => {
                const reason = nonEditableReason(column);
                return (
                  <div key={column.id} className="space-y-1.5">
                    <Label htmlFor={`record-field-${column.id}`} className="text-sm font-medium">
                      {column.label}
                      {column.required && <span aria-hidden="true" className="text-destructive"> *</span>}
                    </Label>
                    <div id={`record-field-${column.id}`}>
                      {reason === null ? (
                        <FieldInput
                          col={column}
                          value={draft[column.id]}
                          onChange={(next) => setDraft((current) => ({ ...current, [column.id]: next }))}
                        />
                      ) : (
                        <p className="rounded-lg border border-dashed px-3 py-2 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
                          {row[column.id] != null && row[column.id] !== "" ? String(row[column.id]) : reason}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => setDraft({ ...row })}>
                  Discard
                </Button>
              </div>
            </div>
            {/* The same Sections every other Record page of this Database shows. */}
            <RecordSections specId={specId} moduleName={moduleName} recordId={recordId} />
          </>
        )}
      </div>
    </div>
  );
}
