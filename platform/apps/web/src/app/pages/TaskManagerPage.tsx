import { useEffect, useMemo, useState } from "react";
import { ListChecks, Target } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { normalizeViewKind, type TableSpec, type ViewConfig } from "@bridge/tables";
import { Header } from "../components/shared/Header";
import { CollapsibleInsights } from "../components/shared/CollapsibleInsights";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { DataViews } from "../dataviews/DataViews";
import { computeEligibleKinds, viewConfigForKind } from "../dataviews/eligibility";
import type { DataRow } from "../dataviews/types";
import { API_TRANSPORT_CONFIGURED, PILOT_ORGANIZATION, trpc } from "../lib/trpc";

const PILOT_USER = "e0f0053b-fc44-476e-be27-1371e179e958";

const TASK_SPEC: TableSpec = {
  id: "task-manager.tasks",
  columns: [
    { id: "path", label: "Path", kind: "formula", editable: false, hiddenInForm: true },
    { id: "title", label: "Task", kind: "text", editable: true, required: true },
    { id: "isGoal", label: "Goal", kind: "checkbox", editable: true },
    {
      id: "status",
      label: "Status",
      kind: "select",
      editable: true,
      options: ["candidate", "committed", "pending", "in_progress", "blocked", "done", "parked", "abandoned", "archived"],
    },
    { id: "priority", label: "Priority", kind: "select", editable: true, options: ["P0", "P1", "P2", "P3", "P4"] },
    { id: "outcomeTitle", label: "Outcome", kind: "text", editable: true },
    { id: "outcomeMeasure", label: "Measure", kind: "text", editable: true },
    { id: "outcomeTarget", label: "Target", kind: "text", editable: true },
    { id: "exitTest", label: "Exit test", kind: "text", editable: true },
    {
      id: "parentTaskId",
      label: "Parent Task",
      kind: "relation",
      relationTarget: "task-manager.tasks",
      relationParent: true,
      editable: true,
    },
    { id: "scheduledFor", label: "Scheduled", kind: "date", editable: true },
    { id: "ownerId", label: "Owner", kind: "text", editable: false, hiddenInForm: true },
  ],
};

type TaskRow = Awaited<ReturnType<typeof trpc.taskManager.list.query>>[number];
type TaskProposal = NonNullable<Awaited<ReturnType<typeof trpc.taskManager.create.mutate>>["impactFitProposal"]>;

function toDataRow(task: TaskRow): DataRow {
  const outcome = task.outcomes[0];
  return {
    id: task.id,
    path: task.path,
    title: task.title,
    isGoal: task.isGoal,
    status: task.status,
    priority: task.priority,
    outcomeTitle: outcome?.title ?? null,
    outcomeMeasure: outcome?.measure ?? null,
    outcomeTarget: outcome?.target ?? null,
    exitTest: task.exitTest ?? null,
    parentTaskId: task.parentTaskId ?? null,
    scheduledFor: task.scheduledFor ?? null,
    ownerId: task.ownerId,
  };
}

export function TaskManagerPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [goalsOnly, setGoalsOnly] = useState(false);
  const [candidatesOnly, setCandidatesOnly] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<TaskProposal | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = normalizeViewKind(searchParams.get("view"));
  const initialKind = requestedView && computeEligibleKinds(TASK_SPEC).includes(requestedView) ? requestedView : "table";
  const [view, setView] = useState<ViewConfig>(viewConfigForKind(TASK_SPEC, initialKind, { id: `tasks:${initialKind}` }));

  async function load() {
    if (!API_TRANSPORT_CONFIGURED) {
      setTasks([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setTasks(await trpc.taskManager.list.query({ organizationId: PILOT_ORGANIZATION }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visibleTasks = useMemo(
    () => tasks.filter((task) => (!goalsOnly || task.isGoal) && (!candidatesOnly || task.status === "candidate")),
    [candidatesOnly, goalsOnly, tasks],
  );
  const rows = useMemo(() => visibleTasks.map(toDataRow), [visibleTasks]);

  function changeView(next: ViewConfig) {
    setView(next);
    const params = new URLSearchParams(searchParams);
    params.set("view", next.kind);
    setSearchParams(params, { replace: true });
  }

  async function insertTask(draft: Partial<DataRow>) {
    const title = typeof draft["title"] === "string" ? draft["title"].trim() : "";
    if (!title) throw new Error("Task title is required.");
    const isGoal = draft["isGoal"] === true;
    const outcomeTitle = typeof draft["outcomeTitle"] === "string" ? draft["outcomeTitle"].trim() : "";
    const outcomeMeasure = typeof draft["outcomeMeasure"] === "string" ? draft["outcomeMeasure"].trim() : "";
    const outcomeTarget = typeof draft["outcomeTarget"] === "string" ? draft["outcomeTarget"].trim() : "";
    const created = await trpc.taskManager.create.mutate({
      organizationId: PILOT_ORGANIZATION,
      title,
      isGoal,
      outcomes: outcomeTitle && outcomeMeasure && outcomeTarget
        ? [{
            id: crypto.randomUUID(),
            title: outcomeTitle,
            measure: outcomeMeasure,
            target: outcomeTarget,
            indicatorKind: "lagging",
          }]
        : [],
      ...(isGoal ? { reviewCadence: "weekly" } : {}),
      ...(typeof draft["exitTest"] === "string" && draft["exitTest"].trim() ? { exitTest: draft["exitTest"].trim() } : {}),
      ...(typeof draft["parentTaskId"] === "string" && draft["parentTaskId"] ? { parentTaskId: draft["parentTaskId"] } : {}),
      ...(typeof draft["scheduledFor"] === "string" && draft["scheduledFor"] ? { scheduledFor: draft["scheduledFor"] } : {}),
      priority: typeof draft["priority"] === "string" ? draft["priority"] : "P2",
      status: draft["status"] === "candidate" ? "candidate" : "pending",
      ownerType: "human",
      ownerId: PILOT_USER,
    });
    setPendingProposal(created.impactFitProposal ?? null);
    await load();
  }

  async function decideProposal(decision: "approve" | "veto") {
    if (!pendingProposal) return;
    await trpc.taskManager.decideProposal.mutate({
      organizationId: PILOT_ORGANIZATION,
      proposalId: pendingProposal.id,
      decision,
    });
    setPendingProposal(null);
    await load();
  }

  async function updateTask(id: string, patch: Partial<DataRow>) {
    if (typeof patch["status"] === "string") {
      await trpc.taskManager.transition.mutate({
        organizationId: PILOT_ORGANIZATION,
        taskId: id,
        status: patch["status"] as TaskRow["status"],
      });
      await load();
      return;
    }
    throw new Error("Open Record Detail to edit outcomes, evidence, or structure through governed Actions.");
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <Header tabs={[{ id: "queue", label: "Queue", icon: ListChecks }]} activeTab="queue" onTabChange={() => {}} />
      <CollapsibleInsights
        expanded
        metrics={[
          { id: "active", label: "Active", value: String(tasks.filter((task) => !["done", "archived", "abandoned"].includes(task.status)).length) },
          { id: "in-progress", label: "In progress", value: String(tasks.filter((task) => task.status === "in_progress").length) },
          { id: "goals", label: "Goal-flagged", value: String(tasks.filter((task) => task.isGoal).length) },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2" style={{ borderColor: "var(--color-border)" }}>
        <button type="button" aria-pressed={goalsOnly} onClick={() => setGoalsOnly((value) => !value)} className="rounded-md border px-3 py-1.5 text-xs">
          <Target className="mr-1 inline size-3.5" /> Goals
        </button>
        <button type="button" aria-pressed={candidatesOnly} onClick={() => setCandidatesOnly((value) => !value)} className="rounded-md border px-3 py-1.5 text-xs">
          Candidates
        </button>
      </div>
      {pendingProposal && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-4 py-3 text-sm">
          <p>Internal Strategist impact-fit and resequence proposal is ready for review.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void decideProposal("approve")} className="rounded-md bg-[var(--color-navy)] px-3 py-1.5 text-white">Approve placement</button>
            <button type="button" onClick={() => void decideProposal("veto")} className="rounded-md border px-3 py-1.5">Veto</button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        {loading ? (
          <p role="status" className="p-6 text-sm text-muted-foreground">Loading Task Records…</p>
        ) : error ? (
          <p role="alert" className="p-6 text-sm text-red-600">Task Manager could not load: {error}</p>
        ) : (
          <>
            {/* Notion-like: the table is always present. When no Database is
                connected we show an honest banner above the (empty) table
                rather than hiding it. */}
            {!API_TRANSPORT_CONFIGURED && (
              <div className="mb-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                No Task Database is connected. Start the Bridge API to create the first real Task.
              </div>
            )}
            <DataViews
              spec={TASK_SPEC}
              view={view}
              data={rows}
              onViewChange={changeView}
              {...(API_TRANSPORT_CONFIGURED ? { onInsert: insertTask, onUpdate: updateTask } : {})}
              onOpenRecord={(row) => navigate(`/task-manager/${String(row.id)}`)}
              onEditRecord={(row) => navigate(`/task-manager/${String(row.id)}`)}
            />
          </>
        )}
        <div className="mt-6">
          <ModuleFilesSection moduleName="task-manager" />
        </div>
        <div className="mt-6">
          <ModuleIntelligenceSection moduleName="task-manager" />
        </div>
      </div>
    </div>
  );
}
