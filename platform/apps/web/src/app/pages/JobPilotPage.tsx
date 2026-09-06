import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Briefcase, ChevronDown, ChevronUp, Upload } from "lucide-react";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { ModuleGovernanceSection } from "../components/shared/ModuleGovernanceSection";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { DashboardRow } from "../components/shared/DashboardRow";
import { RedFlagControl } from "../components/shared/RedFlagControl";
import { RedFlagProvider } from "../components/shared/RedFlagProvider";
import { Button } from "../components/ui/button";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow } from "../dataviews/types";

type OnboardingState = Awaited<ReturnType<typeof trpc.jobpilot.onboarding.get.query>>;

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("The resume could not be read."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The resume could not be encoded."));
        return;
      }
      const separator = reader.result.indexOf(",");
      resolve(separator >= 0 ? reader.result.slice(separator + 1) : reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * TASK-076 — JobPilot's onboarding: upload resume, select interested job
 * functions, then rank them. Three steps, in that order, and the wizard
 * never shows again once step 3 submits (`completedAt` is the gate).
 */
function JobPilotOnboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [ranked, setRanked] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableFunctions, setAvailableFunctions] = useState<readonly string[]>([]);

  useEffect(() => {
    void trpc.jobpilot.onboarding.get
      .query({ organizationId: PILOT_ORGANIZATION })
      .then((state) => setAvailableFunctions(state.availableFunctions))
      .catch((cause) => setError(String(cause)));
  }, []);

  async function uploadResume(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await trpc.modules.addFile.mutate({
        organizationId: PILOT_ORGANIZATION,
        moduleName: "job-pilot",
        fileName: file.name,
        contentBase64: await fileBase64(file),
      });
      await trpc.jobpilot.onboarding.saveResume.mutate({
        organizationId: PILOT_ORGANIZATION,
        resumeFileName: file.name,
      });
      setResumeFileName(file.name);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setUploading(false);
    }
  }

  function toggleFunction(name: string) {
    setSelected((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );
  }

  function moveRank(index: number, direction: -1 | 1) {
    setRanked((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  async function finish() {
    setSubmitting(true);
    setError(null);
    try {
      await trpc.jobpilot.onboarding.complete.mutate({
        organizationId: PILOT_ORGANIZATION,
        selectedFunctions: ranked,
      });
      onComplete();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-lg flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="w-full space-y-6 rounded-lg border p-6" style={{ borderColor: "var(--color-border)" }}>
        <div className="space-y-1">
          <h1 className="text-lg font-semibold" style={{ color: "var(--color-navy)" }}>
            Set up JobPilot
          </h1>
          <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
            Step {step} of 3
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
              Upload your resume to get started.
            </p>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-6 text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-navy-mid)" }}>
              <Upload className="size-4" />
              {resumeFileName ?? (uploading ? "Uploading…" : "Choose a resume file")}
              <input type="file" className="hidden" onChange={uploadResume} disabled={uploading} />
            </label>
            <Button className="w-full" disabled={!resumeFileName} onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
              Which job functions are you interested in?
            </p>
            <div className="flex flex-wrap gap-2">
              {availableFunctions.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleFunction(name)}
                  className="rounded-full border px-3 py-1 text-sm"
                  style={
                    selected.includes(name)
                      ? { backgroundColor: "var(--color-navy)", color: "white", borderColor: "var(--color-navy)" }
                      : { borderColor: "var(--color-border)", color: "var(--color-navy-mid)" }
                  }
                >
                  {name}
                </button>
              ))}
            </div>
            <Button
              className="w-full"
              disabled={selected.length === 0}
              onClick={() => {
                setRanked(selected);
                setStep(3);
              }}
            >
              Continue
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--color-navy-mid)" }}>
              Rank them by priority — top is most important.
            </p>
            <ol className="space-y-2">
              {ranked.map((name, index) => (
                <li key={name} className="flex items-center justify-between rounded-md border p-2 text-sm" style={{ borderColor: "var(--color-border)" }}>
                  <span>
                    {index + 1}. {name}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => moveRank(index, -1)} className="disabled:opacity-30">
                      <ChevronUp className="size-4" />
                    </button>
                    <button type="button" aria-label={`Move ${name} down`} disabled={index === ranked.length - 1} onClick={() => moveRank(index, 1)} className="disabled:opacity-30">
                      <ChevronDown className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            <Button className="w-full" disabled={submitting} onClick={() => void finish()}>
              {submitting ? "Finishing…" : "Finish"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [page, setPage] = useState<JobPilotList | null>(null);
  const [definition, setDefinition] = useState<JobPilotDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig(`${JOBPILOT_DATABASE_ID}:table`));

  useEffect(() => {
    void trpc.jobpilot.onboarding.get
      .query({ organizationId: PILOT_ORGANIZATION })
      .then(setOnboarding)
      .catch((cause) => setError(String(cause)));
  }, []);

  const load = useCallback(async () => {
    try {
      const [nextPage, nextDefinition] = await Promise.all([
        trpc.jobpilot.list.query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 }),
        trpc.jobpilot.definition.query({ organizationId: PILOT_ORGANIZATION }),
      ]);
      setPage(nextPage);
      setDefinition(nextDefinition);
    } catch (failure) {
      setError(String(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  async function moveStage(rowId: string, patch: Partial<DataRow>) {
    const to = patch["stage"];
    if (to === undefined) return; // Only stage moves persist; other fields have no store contract.
    const current = rows.find((row) => row.id === rowId);
    const from = current?.stage;
    if (!from || String(from) === String(to)) return;
    await trpc.jobpilot.transition.mutate({
      organizationId: PILOT_ORGANIZATION,
      applicationId: rowId,
      from: String(from),
      to: String(to),
    });
    await load();
  }

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  if (!onboarding) return <div className="p-6 text-sm text-muted-foreground">Loading JobPilot…</div>;
  if (!onboarding.profile?.completedAt) {
    return (
      <JobPilotOnboarding
        onComplete={() => {
          void trpc.jobpilot.onboarding.get.query({ organizationId: PILOT_ORGANIZATION }).then(setOnboarding);
        }}
      />
    );
  }
  if (!page || !definition) return <div className="p-6 text-sm text-muted-foreground">Loading Job records…</div>;

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
      <Header tabs={[{ id: "JobPilot", icon: Briefcase }]} activeTab="JobPilot" onTabChange={() => {}} />
      {/* The "All Jobs" bar is gone for the same reason as Signals': the tab
          strip already names the surface, and the row existed only to carry a
          labelled insights toggle that now sits inside the section.
          ADR-180 removed the 3-dots menu — its one item linked to Module
          Detail, a Page that shows the Sections already below this table. */}
      <ModuleSurfaceLayout
        table={
          <section aria-label="Jobs Database" className="h-full">
            <DataViews
              spec={spec}
              view={view}
              data={rows}
              searchPlaceholder="Search jobs…"
              insertDisabledReason="Jobs arrive from the JobPilot sourcing Integration, not by hand — track one by moving its Stage."
              onViewChange={setView}
              onUpdate={moveStage}
              canUpdateRow={(row) => Boolean(row["id"])}
              insights={
                <DashboardRow
                  metrics={[
                    { id: "jobs", label: "Jobs", value: String(page.total) },
                    { id: "tracked", label: "Tracked", value: String(page.items.filter((item) => item.application).length) },
                    { id: "review", label: "Awaiting review", value: String(page.items.filter((item) => item.application?.stage === "awaiting_review").length) },
                  ]}
                />
              }
            />
          </section>
        }
        below={
          <>
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
            <ModuleIntelligenceSection moduleName="job-pilot" />
            <ModuleGovernanceSection moduleName="job-pilot" />
          </>
        }
      />
    </div>
  );
}

export default JobPilotPage;
