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
  createRecord,
  updateRecord,
  useRecords,
  type Record,
} from "../data/records";

const RECORD_SPEC: TableSpec = {
  id: "records",
  columns: [
    { id: "name", label: "Record", kind: "text", editable: true, required: true },
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
      options: ["private", "team", "organization"],
      defaultValue: "organization",
    },
  ],
};

function recordPatch(draft: Partial<DataRow>): Partial<Record> {
  const patch: Partial<Record> = {};
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
    draft["visibility"] === "organization"
  ) {
    patch.visibility = draft["visibility"];
  }
  return patch;
}

export function WorkPage() {
  const records = useRecords();
  const navigate = useNavigate();
  const [view, setView] = useState<ViewConfig>(
    viewConfigForKind(RECORD_SPEC, "gallery", { id: "records:gallery" }),
  );
  const [formRecord, setFormRecord] = useState<DataRow | null>(null);
  const rows: DataRow[] = records.map((record) => ({
    ...record,
    deadline: record.deadline === "—" ? null : record.deadline,
  }));

  function changeView(next: ViewConfig, preserveFormRecord = false) {
    if (!preserveFormRecord) setFormRecord(null);
    setView(next);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <Header
        tabs={[{ id: "Records", icon: Target }]}
        activeTab="Records"
        onTabChange={() => {}}
      />
      <CollapsibleInsights
        expanded
        metrics={[
          { id: "total", label: "Records", value: String(records.length) },
          {
            id: "active",
            label: "Active",
            value: String(records.filter((record) => record.status === "Active").length),
          },
          {
            id: "completed",
            label: "Completed",
            value: String(records.filter((record) => record.status === "Completed").length),
          },
        ]}
      />
      <div className="flex-1 overflow-auto p-4">
        <DataViews
          spec={RECORD_SPEC}
          view={view}
          data={rows}
          onViewChange={changeView}
          formRecord={formRecord}
          onInsert={async (draft) => {
            const patch = recordPatch(draft);
            if (!patch.name) throw new Error("Record is required.");
            createRecord(patch);
          }}
          onUpdate={async (id, draft) => {
            updateRecord(id, recordPatch(draft));
          }}
          onOpenRecord={(row) => {
            const id = row["id"];
            if (typeof id === "string") navigate(`/record/${encodeURIComponent(id)}`);
          }}
          onEditRecord={(row) => {
            setFormRecord(row);
            changeView(viewConfigForKind(RECORD_SPEC, "form", view), true);
          }}
        />
      </div>
    </div>
  );
}
