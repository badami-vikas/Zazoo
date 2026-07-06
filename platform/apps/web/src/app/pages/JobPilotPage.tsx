import { useEffect, useMemo, useState } from "react";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { DataViews, type DataRow } from "../dataviews/index";

type JobPage = Awaited<ReturnType<typeof trpc.jobpilot.list.query>>;

const STAGES = [
  "queued", "tailoring", "evaluating", "approved", "awaiting_review",
  "applying", "parked", "submitted", "confirmed", "rejected_by_user", "failed", "expired",
] as const;

/** JobPilot's list, migrated to render through <DataViews> (P1 Workspace
 * Generator: proving the shell/registry against a real page instead of only
 * synthetic fixtures) — the data flow (fetch/create/transition via
 * trpc.jobpilot.*) is UNCHANGED, only the list's rendering moved from a plain
 * <ul> to the registered TableView/KanbanView via the DataViews shell. Maps to
 * router.ts's `jobpilot.*`. */
export function JobPilotPage() {
  const [page, setPage] = useState<JobPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig("jobpilot.applications", "table"));

  function refresh() {
    trpc.jobpilot.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }
  useEffect(refresh, []);

  async function addJob() {
    if (!title || !company) return;
    setError(null);
    try {
      await trpc.jobpilot.create.mutate({
        workspaceId: PILOT_WORKSPACE,
        title,
        company,
        ...(location ? { location } : {}),
        candidate: { categories: [], skills: [] },
      });
      setTitle("");
      setCompany("");
      setLocation("");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function advanceStage(applicationId: string, from: string, to: string) {
    setError(null);
    try {
      await trpc.jobpilot.transition.mutate({ workspaceId: PILOT_WORKSPACE, applicationId, from, to });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  // TableSpec — the tracked-applications table's columns, schema-driven (not a
  // hardcoded JSX column list) per @bridge/tables' "views as data" contract.
  const spec: TableSpec = useMemo(
    () => ({
      id: "jobpilot.applications",
      columns: [
        { id: "title", label: "Title", kind: "text" },
        { id: "company", label: "Company", kind: "text" },
        { id: "location", label: "Location", kind: "text" },
        { id: "stage", label: "Stage", kind: "select", options: [...STAGES] },
        { id: "flag", label: "Flag", kind: "text" },
      ],
    }),
    [],
  );

  // Flatten each item (job + nested application) into one row per @bridge/tables'
  // Record<string, unknown> row shape — same data trpc.jobpilot.list already
  // returns, just reshaped for the engine's filter/sort/group functions.
  const rows: DataRow[] = useMemo(
    () =>
      (page?.items ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        company: item.company,
        location: item.location ?? "",
        stage: item.application?.stage ?? "unknown",
        flag: item.application?.flag ?? "",
        _applicationId: item.application?.id ?? null,
      })),
    [page],
  );

  function nextStageFor(stage: string): string | null {
    const idx = STAGES.indexOf(stage as (typeof STAGES)[number]);
    return idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1]! : null;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-medium">JobPilot</h1>
      {error && <div className="text-sm text-red-600">{error}</div>}

      <section className="space-y-2 border rounded-md p-4 max-w-2xl">
        <h2 className="text-sm font-medium">Track a job</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company">Company</Label>
            <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="location">Location</Label>
            <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <Button onClick={addJob}>Add</Button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          {page?.total ?? "…"} tracked{page?.hasMore ? " (more available)" : ""}
        </h2>
        <DataViews
          spec={spec}
          view={{ ...view, groupBy: view.groupBy ?? "stage" }}
          data={rows}
          onViewChange={setView}
        />
        {/* Stage-advance actions stay separate from the generic view (DataViews
            doesn't know about JobPilot's state machine) — a thin action list
            keyed off the same rows already rendered above. */}
        {rows.length > 0 && (
          <div className="border rounded-md divide-y">
            {rows.map((row) => {
              const stage = String(row["stage"]);
              const next = nextStageFor(stage);
              const applicationId = row["_applicationId"] as string | null;
              if (!applicationId || !next) return null;
              return (
                <div key={String(row["id"])} className="flex items-center justify-between gap-4 p-2 text-sm">
                  <span>
                    {String(row["title"])} · {String(row["company"])} — {stage}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => advanceStage(applicationId, stage, next)}>
                    → {next}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
