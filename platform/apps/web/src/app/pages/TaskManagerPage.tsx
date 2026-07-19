import { useEffect, useMemo, useState } from "react";
import { ListChecks } from "lucide-react";
import { useSearchParams } from "react-router";
import { normalizeViewKind, type TableSpec, type ViewConfig } from "@bridge/tables";
import { Header } from "../components/shared/Header";
import { CollapsibleInsights } from "../components/shared/CollapsibleInsights";
import { DataViews } from "../dataviews/DataViews";
import { computeEligibleKinds, viewConfigForKind } from "../dataviews/eligibility";
import type { DataRow } from "../dataviews/types";
import {
  PENDING_WORK_GENERATED_AT,
  PENDING_WORK_SOURCE,
  addManualPendingWorkItem,
  applyPendingWorkEdits,
  persistPendingWorkEdits,
  updatePendingWorkItem,
  usePendingWorkEdits,
} from "../data/pending-work";
import {
  persistTaskManagerState,
  reconcileTaskSchedules,
  useTaskManagerState,
} from "../data/task-manager";

const TASK_SPEC: TableSpec = {
  id: "tasks",
  columns: [
    { id: "rank", label: "Rank", kind: "number", editable: false, hiddenInForm: true },
    { id: "title", label: "Task", kind: "text", editable: true, required: true },
    {
      id: "status",
      label: "Status",
      kind: "select",
      editable: false,
      hiddenInForm: true,
      options: ["inbox", "ready", "in_progress", "blocked", "done", "dropped", "open"],
    },
    {
      id: "priority",
      label: "Priority",
      kind: "select",
      editable: false,
      hiddenInForm: true,
      options: ["P0", "P1", "P2", "P3", "P4"],
    },
    { id: "horizon", label: "Horizon", kind: "text", editable: false, hiddenInForm: true },
    { id: "source", label: "Source", kind: "text", editable: false, hiddenInForm: true },
    { id: "scheduledDate", label: "Scheduled", kind: "date", editable: true },
    {
      id: "parentTaskId",
      label: "Parent Task",
      kind: "relation",
      relationTarget: "tasks",
      relationParent: true,
      editable: false,
      hiddenInForm: true,
    },
    { id: "path", label: "Path", kind: "formula", editable: false, hiddenInForm: true },
  ],
};

/** Task Manager projects the canonical docs/TASKS.md queue through shared View Grammar. */
export function TaskManagerPage() {
  const edits = usePendingWorkEdits();
  const taskState = useTaskManagerState();
  const schedules = taskState.schedules ?? {};
  const allItems = useMemo(
    () => applyPendingWorkEdits(PENDING_WORK_SOURCE, edits, true),
    [edits],
  );
  const activeItems = useMemo(
    () => allItems.filter((item) => !item.archived),
    [allItems],
  );
  const rows = useMemo<DataRow[]>(
    () => activeItems.map((item, index) => ({
      id: item.id,
      rank: index + 1,
      title: item.title,
      status: item.canonicalStatus ?? item.status,
      priority: item.priority ?? null,
      horizon: item.horizon ?? null,
      source: item.sourceLine ? `${item.sourceFile}:${item.sourceLine}` : item.sourceFile,
      scheduledDate: schedules[item.id] ?? null,
      parentTaskId: null,
      path: item.id,
    })),
    [activeItems, schedules],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const normalizedView = normalizeViewKind(requestedView);
  const initialKind = normalizedView && computeEligibleKinds(TASK_SPEC).includes(normalizedView)
    ? normalizedView
    : "table";
  const [view, setView] = useState<ViewConfig>(
    viewConfigForKind(TASK_SPEC, initialKind, { id: `tasks:${initialKind}` }),
  );
  const [formRecord, setFormRecord] = useState<DataRow | null>(null);

  useEffect(() => {
    const next = reconcileTaskSchedules(activeItems, schedules, new Date(), 12);
    if (next !== schedules) {
      persistTaskManagerState({ ...taskState, schedules: next });
    }
  }, [activeItems, schedules, taskState]);

  function changeView(next: ViewConfig, preserveFormRecord = false) {
    if (!preserveFormRecord) setFormRecord(null);
    setView(next);
    const params = new URLSearchParams(searchParams);
    params.set("view", next.kind);
    setSearchParams(params, { replace: true });
  }

  async function insertTask(draft: Partial<DataRow>) {
    const title = typeof draft["title"] === "string" ? draft["title"].trim() : "";
    if (!title) throw new Error("Task is required.");
    const nextEdits = addManualPendingWorkItem(edits, title);
    const created = nextEdits.manual?.at(-1);
    persistPendingWorkEdits(nextEdits);
    if (created && typeof draft["scheduledDate"] === "string" && draft["scheduledDate"]) {
      persistTaskManagerState({
        ...taskState,
        schedules: { ...schedules, [created.id]: draft["scheduledDate"] },
      });
    }
  }

  async function updateTask(id: string, patch: Partial<DataRow>) {
    const unsupported = Object.keys(patch).filter(
      (field) => !["id", "rank", "title", "scheduledDate"].includes(field),
    );
    if (unsupported.length > 0) {
      throw new Error(
        "Canonical status, priority, and hierarchy changes must be applied to docs/TASKS.md through the governed work queue.",
      );
    }
    if (typeof patch["title"] === "string" && patch["title"].trim()) {
      persistPendingWorkEdits(updatePendingWorkItem(edits, id, { title: patch["title"].trim() }));
    }
    if (typeof patch["scheduledDate"] === "string") {
      persistTaskManagerState({
        ...taskState,
        schedules: { ...schedules, [id]: patch["scheduledDate"] },
      });
    }
  }

  const archivedCount = allItems.length - activeItems.length;
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <Header
        tabs={[{ id: "task-manager", label: "Task Manager", icon: ListChecks }]}
        activeTab="task-manager"
        onTabChange={() => {}}
      />
      <CollapsibleInsights
        expanded
        metrics={[
          { id: "active", label: "Active", value: String(activeItems.length) },
          {
            id: "in-progress",
            label: "In progress",
            value: String(activeItems.filter((item) => item.canonicalStatus === "in_progress").length),
          },
          {
            id: "archived",
            label: "Archived locally",
            value: String(archivedCount),
            hint: `Canonical projection generated ${new Date(PENDING_WORK_GENERATED_AT).toLocaleDateString()}`,
          },
        ]}
      />
      <div className="flex-1 overflow-auto p-4">
        <DataViews
          spec={TASK_SPEC}
          view={view}
          data={rows}
          onViewChange={changeView}
          onInsert={insertTask}
          onUpdate={updateTask}
          formRecord={formRecord}
          onOpenRecord={(row) => {
            setFormRecord({ ...row });
            changeView(viewConfigForKind(TASK_SPEC, "form", view), true);
          }}
          onEditRecord={(row) => {
            setFormRecord(row);
            changeView(viewConfigForKind(TASK_SPEC, "form", view), true);
          }}
        />
      </div>
    </div>
  );
}
