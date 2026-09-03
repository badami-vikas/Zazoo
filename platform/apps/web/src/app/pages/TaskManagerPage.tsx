import { useEffect, useMemo, useState } from "react";
import { Download, ListChecks } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { normalizeViewKind, type TableSpec, type ViewConfig } from "@bridge/tables";
import { Header } from "../components/shared/Header";
import { DashboardRow } from "../components/shared/DashboardRow";
import { Button } from "../components/ui/button";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { ModuleGovernanceSection } from "../components/shared/ModuleGovernanceSection";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { DataViews } from "../dataviews/DataViews";
import { computeEligibleKinds, viewConfigForKind } from "../dataviews/eligibility";
import type { DataRow } from "../dataviews/types";
import { canonicalLedgerImportPayload, PENDING_WORK_SOURCE } from "../data/pending-work";
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
    // Read-only text, not a number: the unit is part of the judgement, and an
    // un-estimated Task must render blank rather than 0 (AP-247).
    { id: "estimate", label: "Estimate", kind: "text", editable: false },
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
    {
      // TM5 (ADR-205) — the non-parent relation that makes Graph view
      // eligible on this Page at all. `computeEligibleKinds` requires a
      // relation column that is NOT the parent, and until ADR-204 created
      // `depends_on` the Task Database had only `parentTaskId`, so Graph was
      // structurally impossible here rather than merely unbuilt.
      id: "dependsOn",
      label: "Depends on",
      kind: "relation",
      relationTarget: "task-manager.tasks",
      // Read-only in the grid: an edge can close a cycle, and a cycle is
      // refused server-side with a reason (ADR-204). Editing it inline would
      // put that refusal behind a cell that silently reverts.
      editable: false,
    },
    { id: "scheduledFor", label: "Scheduled", kind: "date", editable: true },
    { id: "ownerId", label: "Owner", kind: "text", editable: false, hiddenInForm: true },
  ],
};

type TaskRow = Awaited<ReturnType<typeof trpc.taskManager.list.query>>[number];
type TaskProposal = NonNullable<Awaited<ReturnType<typeof trpc.taskManager.create.mutate>>["impactFitProposal"]>;

function toDataRow(task: TaskRow, dependsOn: readonly string[] = []): DataRow {
  const outcome = task.outcomes[0];
  return {
    id: task.id,
    path: task.path,
    title: task.title,
    isGoal: task.isGoal,
    status: task.status,
    priority: task.priority,
    estimate: task.estimate ?? null,
    outcomeTitle: outcome?.title ?? null,
    outcomeMeasure: outcome?.measure ?? null,
    outcomeTarget: outcome?.target ?? null,
    exitTest: task.exitTest ?? null,
    parentTaskId: task.parentTaskId ?? null,
    dependsOn: dependsOn.length > 0 ? dependsOn.join(", ") : null,
    scheduledFor: task.scheduledFor ?? null,
    ownerId: task.ownerId,
  };
}

export function TaskManagerPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingProposal, setPendingProposal] = useState<TaskProposal | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [dependenciesByTask, setDependenciesByTask] = useState<Record<string, string[]>>({});
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
      const [rows, graph] = await Promise.all([
        trpc.taskManager.list.query({ organizationId: PILOT_ORGANIZATION }),
        trpc.taskManager.dependencies.query({ organizationId: PILOT_ORGANIZATION }),
      ]);
      setTasks(rows);
      const byTask: Record<string, string[]> = {};
      for (const edge of graph.dependencies) {
        byTask[edge.taskId] = [...(byTask[edge.taskId] ?? []), edge.dependsOnTaskId];
      }
      setDependenciesByTask(byTask);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // ADR-271 — the repository's canonical ledger becomes real Task Records.
  // The payload is the committed projection that ships in this bundle; the
  // server derives one deterministic id per ledger row, so pressing this twice
  // re-states statuses instead of minting a second copy of the queue.
  async function importCanonicalLedger() {
    setImporting(true);
    setImportNote(null);
    setError(null);
    try {
      const plan = await trpc.taskManager.importCanonicalLedger.mutate({
        organizationId: PILOT_ORGANIZATION,
        entries: canonicalLedgerImportPayload(PENDING_WORK_SOURCE),
      });
      setImportNote(plan.note);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  }

  // No page-local scope toggles. "Goals" and "Candidates" were two buttons in
  // the toolbar's actions slot that each applied one row filter — `isGoal` and
  // `status`, both already columns in TASK_SPEC and both already reachable
  // through the kit's Filter control (user report 2026-09-01: "Why do I see
  // goals and candidates next to filter? I need only filter and filters to
  // appear inside it"). A filter that lives outside the Filter button is a
  // second filter UI, which is the same report this kit already answered once
  // on 2026-08-10. Deleted rather than re-homed: the capability did not move,
  // it was already there.
  const rows = useMemo(
    () => tasks.map((task) => toDataRow(task, dependenciesByTask[task.id] ?? [])),
    [tasks, dependenciesByTask],
  );

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
      {pendingProposal && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-4 py-3 text-sm">
          <p>Internal Strategist impact-fit and resequence proposal is ready for review.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void decideProposal("approve")} className="rounded-md bg-[var(--color-navy)] px-3 py-1.5 text-white">Approve placement</button>
            <button type="button" onClick={() => void decideProposal("veto")} className="rounded-md border px-3 py-1.5">Veto</button>
          </div>
        </div>
      )}
      <ModuleSurfaceLayout
        above={
          /* Notion-like: the table is always present. When no Database is
             connected we show an honest banner above the (empty) table
             rather than hiding it. It sits in the first screen, so it
             shrinks the table instead of pushing it out of view. */
          !API_TRANSPORT_CONFIGURED && !loading && !error ? (
            <div className="mx-3 mt-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground sm:mx-4 sm:mt-4">
              No Task Database is connected. Start the Bridge API to create the first real Task.
            </div>
          ) : null
        }
        table={
          loading ? (
            <p role="status" className="p-6 text-sm text-muted-foreground">Loading Task Records…</p>
          ) : error ? (
            <p role="alert" className="p-6 text-sm text-red-600">Task Manager could not load: {error}</p>
          ) : (
            <>
            {importNote ? (
              <p role="status" className="px-3 pt-3 text-xs text-muted-foreground sm:px-4">{importNote}</p>
            ) : null}
            <DataViews
              spec={TASK_SPEC}
              view={view}
              data={rows}
              onViewChange={changeView}
              {...(API_TRANSPORT_CONFIGURED
                ? { onInsert: insertTask, onUpdate: updateTask }
                : { insertDisabledReason: "The API transport is not configured in this build, so Tasks cannot be created here." })}
              onOpenRecord={(row) => navigate(`/task-manager/${String(row.id)}`)}
              onEditRecord={(row) => navigate(`/task-manager/${String(row.id)}`)}
              insights={
                <DashboardRow
                  metrics={[
                    { id: "active", label: "Active", value: String(tasks.filter((task) => !["done", "archived", "abandoned"].includes(task.status)).length) },
                    { id: "in-progress", label: "In progress", value: String(tasks.filter((task) => task.status === "in_progress").length) },
                    { id: "goals", label: "Goal-flagged", value: String(tasks.filter((task) => task.isGoal).length) },
                  ]}
                />
              }
              actions={
                <Button
                    size="sm"
                    variant="outline"
                    disabled={!API_TRANSPORT_CONFIGURED || importing}
                    title={
                      API_TRANSPORT_CONFIGURED
                        ? "Create Task Records from docs/TASKS.md — Horizon Goal nodes over their Tasks. Safe to repeat."
                        : "The API transport is not configured in this build, so the ledger cannot be imported here."
                    }
                    onClick={() => void importCanonicalLedger()}
                  >
                    <Download className="size-3.5" />
                    {importing ? "Importing…" : "Import ledger"}
                  </Button>
              }
            />
            </>
          )
        }
        below={
          <>
            <ModuleFilesSection moduleName="task-manager" />
            <ModuleIntelligenceSection moduleName="task-manager" />
            <ModuleGovernanceSection moduleName="task-manager" />
          </>
        }
      />
    </div>
  );
}
