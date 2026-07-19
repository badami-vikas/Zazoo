import { useEffect, useMemo, useState } from "react";
import { Briefcase, MoreHorizontal } from "lucide-react";
import { Link } from "react-router";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { CollapsibleInsights } from "../components/shared/CollapsibleInsights";
import { RedFlagControl } from "../components/shared/RedFlagControl";
import { RedFlagProvider } from "../components/shared/RedFlagProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow } from "../dataviews/types";

type JobPilotList = Awaited<ReturnType<typeof trpc.jobpilot.list.query>>;
type JobPilotDefinition = Awaited<ReturnType<typeof trpc.jobpilot.definition.query>>;

/** Display labels for @bridge/jobpilot's normalized `FitRecommendation` —
 * never the raw "pursue"/"review"/"pass" enum value verbatim (AP-023: no
 * green/yellow color-only feedback anywhere, but plain-language labels are
 * always fine). */
const FIT_LABEL: Record<string, string> = { pursue: "Pursue", review: "Needs review", pass: "Pass" };
const JOBPILOT_DATABASE_ID = "jobpilot.jobs";
const LOADING_SPEC: TableSpec = {
  id: JOBPILOT_DATABASE_ID,
  columns: [{ id: "title", label: "Title", kind: "text", editable: false }],
};

/**
 * TASK-010 review round-5 item 6 — the platform's required "rendered
 * bullet" Red Flag surface, wired to a REAL persisted Record (the
 * application's own `id`, validated server-side by `validateAnchorTarget`'s
 * `"jobpilot"` case via `jobpilotStore.getApplication`), not a fixture.
 * These two bullets are already-persisted fields (`stage`, the normalized
 * `flag`) rendered as short fit-signal observations — real, if modest,
 * content a Human could genuinely flag as wrong (e.g. "flag is stale, I
 * already withdrew this application").
 */
function FitSignalBullets({ applicationId, stage, flag, fitScore }: { applicationId: string; stage: string; flag: string | null; fitScore: string | null }) {
  const stageValue = `Stage: ${stage}`;
  const scoreNum = fitScore != null ? Number(fitScore) : null;
  const fitValue = flag ? `Fit: ${FIT_LABEL[flag] ?? flag}${scoreNum != null && Number.isFinite(scoreNum) ? ` (${Math.round(scoreNum * 100)}%)` : ""}` : null;
  return (
    <ul className="flex flex-col gap-1">
      <li className="flex gap-1.5 text-[11px] leading-snug" style={{ color: "var(--color-navy-mid)" }}>
        <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: "var(--color-steel)" }} />
        <RedFlagControl anchor={{ kind: "bullet", moduleId: "jobpilot", target: { type: "record", recordId: applicationId }, bulletPath: "fit.stage" }} renderedValue={stageValue} className="flex-1">
          {stageValue}
        </RedFlagControl>
      </li>
      {fitValue && (
        <li className="flex gap-1.5 text-[11px] leading-snug" style={{ color: "var(--color-navy-mid)" }}>
          <span className="mt-1 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: "var(--color-steel)" }} />
          <RedFlagControl anchor={{ kind: "bullet", moduleId: "jobpilot", target: { type: "record", recordId: applicationId }, bulletPath: "fit.flag" }} renderedValue={fitValue} className="flex-1">
            {fitValue}
          </RedFlagControl>
        </li>
      )}
    </ul>
  );
}

export function JobPilotPage() {
  const [page, setPage] = useState<JobPilotList | null>(null);
  const [definition, setDefinition] = useState<JobPilotDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig(`${JOBPILOT_DATABASE_ID}:table`));
  const [insightsOpen, setInsightsOpen] = useState(true);

  useEffect(() => {
    Promise.all([
      trpc.jobpilot.list.query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 }),
      trpc.jobpilot.definition.query({ workspaceId: PILOT_WORKSPACE }),
    ])
      .then(([nextPage, nextDefinition]) => {
        setPage(nextPage);
        setDefinition(nextDefinition);
      })
      .catch((failure) => setError(String(failure)));
  }, []);

  const spec = definition ?? LOADING_SPEC;
  const rows = useMemo<DataRow[]>(
    () => (page?.items ?? []).map((item) => ({
      id: item.application?.id,
      jobId: item.id,
      title: item.title,
      company: item.company,
      location: item.location,
      salaryMax: item.salaryMax,
      flag: item.application?.flag,
      stage: item.application?.stage ?? "Not tracked",
      fitScore: item.application?.fitScore,
      source: item.source,
    })),
    [page],
  );

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!page || !definition) return <div className="p-6 text-sm text-muted-foreground">Loading Job records…</div>;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
      <Header tabs={[{ id: "JobPilot", icon: Briefcase }]} activeTab="JobPilot" onTabChange={() => {}} />
      <div
        className="flex items-center justify-between border-b px-4 py-2"
        style={{ borderColor: "var(--color-border)", backgroundColor: "white" }}
      >
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>All Jobs</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border px-2.5 py-1.5 text-xs font-medium"
            style={{ borderColor: "var(--color-border)" }}
            onClick={() => setInsightsOpen((open) => !open)}
          >
            {insightsOpen ? "Hide insights" : "Show insights"}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="JobPilot controls"
                className="rounded-md border p-1.5 hover:bg-black/5"
                style={{ borderColor: "var(--color-border)" }}
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/module/job-pilot">Control Panel / Module Detail</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <CollapsibleInsights
        expanded={insightsOpen}
        metrics={[
          { id: "jobs", label: "Jobs", value: String(page.total) },
          { id: "tracked", label: "Tracked", value: String(page.items.filter((item) => item.application).length) },
          { id: "review", label: "Awaiting review", value: String(page.items.filter((item) => item.application?.stage === "awaiting_review").length) },
        ]}
      />
      <div className="flex-1 space-y-8 overflow-auto p-4">
        <section aria-label="Jobs Database">
          <DataViews
            spec={spec}
            view={view}
            data={rows}
            onViewChange={setView}
          />
        </section>
        {page.items.some((item) => item.application) && (
          <RedFlagProvider scope={{ moduleId: "jobpilot" }}>
            <section className="space-y-3" aria-labelledby="jobpilot-fit-signals">
              <h2 id="jobpilot-fit-signals" className="text-sm font-semibold" style={{ color: "var(--color-navy)" }}>
                Fit signals
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {page.items.flatMap((item) => item.application ? [{
                  item,
                  application: item.application,
                }] : []).map(({ item, application }) => (
                  <article key={application.id} className="rounded-md border p-3" style={{ borderColor: "var(--color-border)" }}>
                    <h3 className="mb-2 text-sm font-medium">{item.title}</h3>
                    <FitSignalBullets
                      applicationId={application.id}
                      stage={application.stage}
                      flag={application.flag}
                      fitScore={application.fitScore}
                    />
                  </article>
                ))}
              </div>
            </section>
          </RedFlagProvider>
        )}
        <ModuleFilesSection moduleName="job-pilot" />
      </div>
    </div>
  );
}

export default JobPilotPage;
