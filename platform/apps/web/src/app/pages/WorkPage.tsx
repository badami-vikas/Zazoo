import { useState } from "react";
import { Target } from "lucide-react";
import { useNavigate } from "react-router";
import type { TableSpec, ViewConfig } from "@bridge/tables";
import { Header } from "../components/shared/Header";
import { CollapsibleInsights } from "../components/shared/CollapsibleInsights";
import { DataViews } from "../dataviews/DataViews";
import { viewConfigForKind } from "../dataviews/eligibility";
import type { DataRow } from "../dataviews/types";
import {
  createInitiative,
  updateInitiative,
  useInitiatives,
  type Initiative,
} from "../data/initiatives";

const INITIATIVE_SPEC: TableSpec = {
  id: "initiatives",
  columns: [
    { id: "name", label: "Initiative", kind: "text", editable: true, required: true },
    {
      id: "status",
      label: "Status",
      kind: "select",
      editable: true,
      options: ["Planning", "Active", "On Hold", "Completed"],
      defaultValue: "Planning",
    },
    {
      id: "list",
      label: "List",
      kind: "select",
      editable: true,
      options: ["Work", "Academics", "Personal"],
      defaultValue: "Work",
    },
    { id: "goal", label: "Goal", kind: "text", editable: true },
    { id: "progress", label: "Progress", kind: "number", editable: true, defaultValue: 0 },
    { id: "owner", label: "Owner", kind: "text", editable: true, defaultValue: "You" },
    { id: "deadline", label: "Deadline", kind: "date", editable: true },
    {
      id: "visibility",
      label: "Visibility",
      kind: "select",
      editable: true,
      options: ["private", "team", "workspace"],
      defaultValue: "workspace",
    },
  ],
};

function initiativePatch(draft: Partial<DataRow>): Partial<Initiative> {
  const patch: Partial<Initiative> = {};
  if (typeof draft["name"] === "string") patch.name = draft["name"].trim();
  if (
    draft["status"] === "Planning" ||
    draft["status"] === "Active" ||
    draft["status"] === "On Hold" ||
    draft["status"] === "Completed"
  ) {
    patch.status = draft["status"];
  }
  if (typeof draft["list"] === "string") patch.list = draft["list"];
  if (typeof draft["goal"] === "string") patch.goal = draft["goal"];
  if (typeof draft["progress"] === "number") {
    patch.progress = Math.min(100, Math.max(0, draft["progress"]));
  }
  if (typeof draft["owner"] === "string") patch.owner = draft["owner"];
  if (typeof draft["deadline"] === "string") patch.deadline = draft["deadline"] || "—";
  if (
    draft["visibility"] === "private" ||
    draft["visibility"] === "team" ||
    draft["visibility"] === "workspace"
  ) {
    patch.visibility = draft["visibility"];
  }
  return patch;
}

export function WorkPage() {
  const initiatives = useInitiatives();
  const navigate = useNavigate();
  const [view, setView] = useState<ViewConfig>(
    viewConfigForKind(INITIATIVE_SPEC, "gallery", { id: "initiatives:gallery" }),
  );
  const [formRecord, setFormRecord] = useState<DataRow | null>(null);
  const rows: DataRow[] = initiatives.map((initiative) => ({
    ...initiative,
    deadline: initiative.deadline === "—" ? null : initiative.deadline,
  }));

  function changeView(next: ViewConfig, preserveFormRecord = false) {
    if (!preserveFormRecord) setFormRecord(null);
    setView(next);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <Header
        tabs={[{ id: "Initiatives", icon: Target }]}
        activeTab="Initiatives"
        onTabChange={() => {}}
      />
      <CollapsibleInsights
        expanded
        metrics={[
          { id: "total", label: "Initiatives", value: String(initiatives.length) },
          {
            id: "active",
            label: "Active",
            value: String(initiatives.filter((initiative) => initiative.status === "Active").length),
          },
          {
            id: "completed",
            label: "Completed",
            value: String(initiatives.filter((initiative) => initiative.status === "Completed").length),
          },
        ]}
      />
      <div className="flex-1 overflow-auto p-4">
        <DataViews
          spec={INITIATIVE_SPEC}
          view={view}
          data={rows}
          onViewChange={changeView}
          formRecord={formRecord}
          onInsert={async (draft) => {
            const patch = initiativePatch(draft);
            if (!patch.name) throw new Error("Initiative is required.");
            createInitiative(patch);
          }}
          onUpdate={async (id, draft) => {
            updateInitiative(id, initiativePatch(draft));
          }}
          onOpenRecord={(row) => {
            const id = row["id"];
            if (typeof id === "string") navigate(`/initiative/${encodeURIComponent(id)}`);
          }}
          onEditRecord={(row) => {
            setFormRecord(row);
            changeView(viewConfigForKind(INITIATIVE_SPEC, "form", view), true);
          }}
        />
      </div>
    </div>
  );
}
