import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router";
import { GitPullRequest, CircleDot, Github } from "lucide-react";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { InstalledModuleBoundary } from "../components/InstalledModuleBoundary";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow } from "../dataviews/types";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

type DevpilotPageId = "pulls" | "issues" | "repos";
type Definitions = Awaited<ReturnType<typeof trpc.devpilot.definitions.query>>;
type PullRow = Awaited<ReturnType<typeof trpc.devpilot.pulls.list.query>>[number];
type IssueRow = Awaited<ReturnType<typeof trpc.devpilot.issues.list.query>>[number];
type RepoRow = Awaited<ReturnType<typeof trpc.devpilot.repos.list.query>>[number];

const TAB_ROUTE: Record<string, string> = {
  "Pull Requests": "/module/devpilot/pulls",
  Issues: "/module/devpilot/issues",
  Repos: "/module/devpilot/repos",
};

const LOADING_SPEC: TableSpec = { id: "loading", columns: [{ id: "title", label: "Title", kind: "text" }] };

/** DevPilot D2 — the shape every engineering-assist draft mutation returns:
 * a pipeline Proposal id/status plus the drafted output (or an honest
 * "scaffolded" note when no model was configured). Never posted anywhere —
 * approve/edit/veto happens on the existing Approvals page. */
interface EngineeringAssistDraft {
  proposalId: string;
  status: string;
  draft?: { draft?: string; scaffolded?: boolean; note?: string } | null;
}

export function DevPilotPage({ page }: { page: DevpilotPageId }) {
  const navigate = useNavigate();
  const [definitions, setDefinitions] = useState<Definitions | null>(null);
  const [pulls, setPulls] = useState<PullRow[] | null>(null);
  const [issues, setIssues] = useState<IssueRow[] | null>(null);
  const [repos, setRepos] = useState<RepoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewConfig | null>(null);
  const [selectedPullId, setSelectedPullId] = useState<string>("");
  const [selectedIssueId, setSelectedIssueId] = useState<string>("");
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<EngineeringAssistDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const nextDefinitions = await trpc.devpilot.definitions.query({ organizationId: PILOT_ORGANIZATION });
      setDefinitions(nextDefinitions);
      if (page === "pulls") {
        setPulls(await trpc.devpilot.pulls.list.query({ organizationId: PILOT_ORGANIZATION }));
        setView((current) => current ?? nextDefinitions.pullsTriageBoardView);
      } else if (page === "issues") {
        setIssues(await trpc.devpilot.issues.list.query({ organizationId: PILOT_ORGANIZATION }));
        setView((current) => current ?? nextDefinitions.issuesUpdatedListView);
      } else {
        setRepos(await trpc.devpilot.repos.list.query({ organizationId: PILOT_ORGANIZATION }));
        setView((current) => current ?? defaultViewConfig("devpilot.repos.table", "table"));
      }
    } catch (failure) {
      setError(String(failure));
    }
  }, [page]);

  useEffect(() => {
    setView(null);
    void load();
  }, [load]);

  const rows = useMemo<DataRow[]>(() => {
    if (page === "pulls") {
      return (pulls ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        repoFullName: p.repoFullName,
        number: p.number,
        state: p.state,
        reviewState: p.reviewState,
        author: p.author,
        isDraft: p.isDraft,
        additions: p.additions,
        deletions: p.deletions,
        externalUpdatedAt: p.externalUpdatedAt,
        url: p.url,
      }));
    }
    if (page === "issues") {
      return (issues ?? []).map((i) => ({
        id: i.id,
        title: i.title,
        source: i.source,
        repoFullName: i.repoFullName,
        number: i.number,
        state: i.state,
        labels: (i.labels as string[]).join(", "),
        assignee: i.assignee,
        priority: i.priority,
        externalUpdatedAt: i.externalUpdatedAt,
        url: i.url,
      }));
    }
    return (repos ?? []).map((r) => ({
      id: r.id,
      fullName: r.fullName,
      private: r.private,
      defaultBranch: r.defaultBranch,
      archived: r.archived,
      tracked: r.tracked,
      pushedAt: r.pushedAt,
      url: r.url,
    }));
  }, [page, pulls, issues, repos]);

  async function setTracked(rowId: string, patch: Partial<DataRow>) {
    if (patch["tracked"] === undefined) return;
    await trpc.devpilot.repos.setTracked.mutate({
      organizationId: PILOT_ORGANIZATION,
      repoId: rowId,
      tracked: Boolean(patch["tracked"]),
    });
    await load();
  }

  async function draftReview(kind: "review" | "practice") {
    if (!selectedPullId) return;
    setDraftBusy(kind);
    setDraftError(null);
    setDraftResult(null);
    try {
      const result =
        kind === "review"
          ? await trpc.devpilot.pulls.reviewDraft.mutate({ organizationId: PILOT_ORGANIZATION, pullId: selectedPullId })
          : await trpc.devpilot.pulls.suggestPracticeDraft.mutate({
              organizationId: PILOT_ORGANIZATION,
              pullId: selectedPullId,
            });
      setDraftResult(result as EngineeringAssistDraft);
    } catch (failure) {
      setDraftError(String(failure));
    } finally {
      setDraftBusy(null);
    }
  }

  async function draftAnalysis() {
    if (!selectedIssueId) return;
    setDraftBusy("analyze");
    setDraftError(null);
    setDraftResult(null);
    try {
      const result = await trpc.devpilot.issues.analyzeDraft.mutate({
        organizationId: PILOT_ORGANIZATION,
        issueId: selectedIssueId,
      });
      setDraftResult(result as EngineeringAssistDraft);
    } catch (failure) {
      setDraftError(String(failure));
    } finally {
      setDraftBusy(null);
    }
  }

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;
  const spec =
    page === "pulls"
      ? (definitions?.pulls ?? LOADING_SPEC)
      : page === "issues"
        ? (definitions?.issues ?? LOADING_SPEC)
        : (definitions?.repos ?? LOADING_SPEC);
  const loading = !definitions || !view;

  return (
    <InstalledModuleBoundary moduleName="devpilot">
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          tabs={[
            { id: "Pull Requests", icon: GitPullRequest },
            { id: "Issues", icon: CircleDot },
            { id: "Repos", icon: Github },
          ]}
          activeTab={page === "pulls" ? "Pull Requests" : page === "issues" ? "Issues" : "Repos"}
          onTabChange={(id) => {
            const route = TAB_ROUTE[id];
            if (route) navigate(route);
          }}
        />
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading {page}…</div>
        ) : (
          <ModuleSurfaceLayout
            table={
              <section aria-label={`DevPilot ${page}`} className="flex h-full min-h-0 flex-col">
                {(page === "pulls" || page === "issues") && (
                  <div className="border-b p-3">
                    {page === "pulls" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={selectedPullId}
                          onValueChange={(value) => {
                            setSelectedPullId(value);
                            setDraftResult(null);
                            setDraftError(null);
                          }}
                        >
                          <SelectTrigger className="h-8 max-w-xs text-sm">
                            <SelectValue placeholder="Select a Pull Request…" />
                          </SelectTrigger>
                          <SelectContent>
                            {(pulls ?? []).map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                #{p.number} {p.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!selectedPullId || draftBusy !== null}
                          onClick={() => void draftReview("review")}
                        >
                          {draftBusy === "review" ? "Drafting…" : "Draft review"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!selectedPullId || draftBusy !== null}
                          onClick={() => void draftReview("practice")}
                        >
                          {draftBusy === "practice" ? "Drafting…" : "Suggest practices"}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={selectedIssueId}
                          onValueChange={(value) => {
                            setSelectedIssueId(value);
                            setDraftResult(null);
                            setDraftError(null);
                          }}
                        >
                          <SelectTrigger className="h-8 max-w-xs text-sm">
                            <SelectValue placeholder="Select an Issue…" />
                          </SelectTrigger>
                          <SelectContent>
                            {(issues ?? []).map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                #{i.number} {i.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!selectedIssueId || draftBusy !== null}
                          onClick={() => void draftAnalysis()}
                        >
                          {draftBusy === "analyze" ? "Analyzing…" : "Analyze"}
                        </Button>
                      </div>
                    )}
                    {draftError && <p className="mt-2 text-sm text-red-600">{draftError}</p>}
                    {draftResult && (
                      <div className="mt-2 rounded-md border bg-muted/30 p-3 text-sm">
                        {draftResult.draft?.scaffolded ? (
                          <p className="text-muted-foreground">{draftResult.draft.note}</p>
                        ) : (
                          <p className="whitespace-pre-wrap">{draftResult.draft?.draft}</p>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">
                          This is a draft proposal — nothing was sent to GitHub. Review, edit, or veto it on{" "}
                          <Link to="/approvals" className="underline">
                            Approvals
                          </Link>
                          .
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  <DataViews
                    spec={spec}
                    view={view!}
                    data={rows}
                    searchPlaceholder={`Search ${page}…`}
                    insertDisabledReason={
                      page === "repos"
                        ? "Repos arrive from the connected GitHub Integration — track one by toggling Tracked."
                        : `${page === "pulls" ? "Pull requests" : "Issues"} arrive from the connected GitHub Integration, not by hand.`
                    }
                    onViewChange={setView}
                    {...(page === "repos" ? { onUpdate: setTracked, canUpdateRow: () => true } : {})}
                  />
                </div>
              </section>
            }
          />
        )}
      </div>
    </InstalledModuleBoundary>
  );
}

export default DevPilotPage;
