/**
 * The new-Record page of a manifest-declared Page, at
 * `/module/:moduleName/:pageId/new` (user report 2026-09-05: "shouldnt I be
 * taken to the element page when adding a new element?").
 *
 * WHY IT IS A ROUTE AND NOT A MODE. New used to swap the table for an inline
 * `<RecordPage>` INSIDE the Module Page — which still rendered its own
 * Intelligence and Governance Sections below, so the user saw both twice. A
 * Record page is a page: it gets its own address, its own back link, and one
 * set of Sections.
 *
 * It reuses `<RecordPage>` — the same fields, the same "nothing is written
 * until Save" contract (C-34) — rather than growing a second create surface.
 * Save writes through `moduleRecords.insert` and returns to the Page.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { TableSpec } from "@bridge/tables";
import { RecordPage } from "../dataviews/RecordPage";
import { PILOT_ORGANIZATION, trpc } from "../lib/trpc";
import { modulePageRoute, useInstalledModule } from "./ModulePage";

export function ModuleNewRecordPage() {
  const { moduleName = "", pageId = "" } = useParams();
  const navigate = useNavigate();
  const { installation, error: loadError } = useInstalledModule(moduleName);
  const [spec, setSpec] = useState<TableSpec | null>(null);
  const [error, setError] = useState<string | null>(null);

  const page =
    installation?.manifest?.module?.pages.find((candidate) => candidate.id === pageId) ?? null;
  const databaseId = page?.databaseId ?? "";

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    trpc.moduleRecords.definition
      .query({ organizationId: PILOT_ORGANIZATION, moduleName, databaseId })
      .then((definition) => {
        if (!cancelled) setSpec(definition.spec);
      })
      .catch((failure) => {
        if (!cancelled) setError(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [moduleName, databaseId, page]);

  const back = useCallback(
    () => navigate(modulePageRoute(moduleName, pageId)),
    [navigate, moduleName, pageId],
  );

  const shown = error ?? loadError;

  return (
    <div className="h-full overflow-auto p-4 sm:p-6" style={{ backgroundColor: "var(--color-surface)" }}>
      {shown && <p role="alert" className="text-sm text-red-600">{shown}</p>}
      {installation === null && (
        <p className="text-sm text-muted-foreground">
          {moduleName} is not an installed Module of this Organization.
        </p>
      )}
      {installation && !page && (
        <p className="text-sm text-muted-foreground">
          {installation.manifest?.module?.displayName ?? moduleName} declares no Page {pageId}.
        </p>
      )}
      {spec && (
        <RecordPage
          spec={spec}
          moduleName={moduleName}
          onSave={async (draft) => {
            await trpc.moduleRecords.insert.mutate({
              organizationId: PILOT_ORGANIZATION,
              moduleName,
              databaseId,
              fields: draft,
            });
          }}
          onCancel={back}
        />
      )}
    </div>
  );
}
