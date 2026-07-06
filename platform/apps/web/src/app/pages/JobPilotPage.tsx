import { useEffect, useState } from "react";
import { trpc, PILOT_WORKSPACE } from "../lib/trpc";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

type JobPage = Awaited<ReturnType<typeof trpc.jobpilot.list.query>>;

const STAGES = [
  "queued", "tailoring", "evaluating", "approved", "awaiting_review",
  "applying", "parked", "submitted", "confirmed", "rejected_by_user", "failed", "expired",
] as const;

/** Maps to router.ts's `jobpilot.*` — the first Phase 4 backend, wiring the
 * pure `@bridge/jobpilot` scoring/state-machine logic to real persistence. */
export function JobPilotPage() {
  const [page, setPage] = useState<JobPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");

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

  async function advance(applicationId: string, from: string, to: string) {
    setError(null);
    try {
      await trpc.jobpilot.transition.mutate({ workspaceId: PILOT_WORKSPACE, applicationId, from, to });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <h1 className="text-lg font-medium">JobPilot</h1>
      {error && <div className="text-sm text-red-600">{error}</div>}

      <section className="space-y-2 border rounded-md p-4">
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
        <ul className="divide-y">
          {page?.items.map((item) => {
            const app = item.application;
            const idx = app ? STAGES.indexOf(app.stage as (typeof STAGES)[number]) : -1;
            const next = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null;
            return (
              <li key={item.id} className="py-3 flex items-center justify-between gap-4 text-sm">
                <div>
                  <div className="font-medium">
                    {item.title} · {item.company}
                  </div>
                  <div className="text-muted-foreground">
                    {item.location ?? "—"} · stage: {app?.stage ?? "unknown"}
                    {app?.flag ? ` · flag: ${app.flag}` : ""}
                  </div>
                </div>
                {app && next && (
                  <Button size="sm" variant="outline" onClick={() => advance(app.id, app.stage, next)}>
                    → {next}
                  </Button>
                )}
              </li>
            );
          })}
          {page && page.items.length === 0 && (
            <li className="py-2 text-sm text-muted-foreground">No jobs tracked yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
