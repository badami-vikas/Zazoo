import { useEffect, useState } from "react";
import { CalendarRange } from "lucide-react";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { Header } from "../components/shared/Header";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow } from "../dataviews/types";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { EventSpeakerExtraction } from "./events/EventSpeakerExtraction";

const EVENTS_SPEC: TableSpec = {
  id: "events.events",
  columns: [
    { id: "name", label: "Name", kind: "text", editable: true, required: true },
    { id: "url", label: "URL", kind: "url", editable: true },
    { id: "type", label: "Type", kind: "select", editable: true, options: ["conference", "meetup", "summit", "webinar"] },
    { id: "startsAt", label: "Starts", kind: "date", editable: true },
    { id: "endsAt", label: "Ends", kind: "date", editable: true },
    { id: "location", label: "Location", kind: "location", editable: true },
    {
      id: "status",
      label: "Status",
      kind: "select",
      editable: true,
      options: ["watching", "registered", "attending", "attended"],
      defaultValue: "watching",
    },
    { id: "extractionStatus", label: "Speaker extraction", kind: "text", editable: false, hiddenInForm: true },
  ],
};

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoOrUndefined(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function EventsPage() {
  const [rows, setRows] = useState<DataRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<ViewConfig>(defaultViewConfig(`${EVENTS_SPEC.id}:table`, "table"));

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    trpc.events.list
      .query({ organizationId: PILOT_ORGANIZATION, limit: 100, offset: 0 })
      .then((page) => {
        if (!active) return;
        setTotal(page.total);
        setRows(
          page.items.map((item) => ({
            id: item.id,
            name: item.name,
            url: item.url ?? "",
            type: item.type ?? "",
            startsAt: item.startsAt ?? "",
            endsAt: item.endsAt ?? "",
            location: item.location ?? "",
            status: item.status,
            extractionStatus: item.extractionStatus,
          })),
        );
      })
      .catch((cause) => {
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
    };
  }, [reload]);

  async function insertRecord(draft: Partial<DataRow>) {
    const name = textOrUndefined(draft["name"]);
    if (!name) throw new Error("Name is required.");
    await trpc.events.create.mutate({
      organizationId: PILOT_ORGANIZATION,
      name,
      ...(textOrUndefined(draft["url"]) ? { url: textOrUndefined(draft["url"]) } : {}),
      ...(textOrUndefined(draft["type"]) ? { type: textOrUndefined(draft["type"]) as never } : {}),
      ...(isoOrUndefined(draft["startsAt"]) ? { startsAt: isoOrUndefined(draft["startsAt"]) } : {}),
      ...(isoOrUndefined(draft["endsAt"]) ? { endsAt: isoOrUndefined(draft["endsAt"]) } : {}),
      ...(textOrUndefined(draft["location"]) ? { location: textOrUndefined(draft["location"]) } : {}),
    });
    setReload((value) => value + 1);
  }

  async function updateRecord(id: string, draft: Partial<DataRow>) {
    await trpc.events.update.mutate({
      organizationId: PILOT_ORGANIZATION,
      id,
      ...(draft["name"] !== undefined ? { name: textOrUndefined(draft["name"]) } : {}),
      ...(draft["url"] !== undefined ? { url: textOrUndefined(draft["url"]) } : {}),
      ...(draft["type"] !== undefined ? { type: draft["type"] as never } : {}),
      ...(draft["startsAt"] !== undefined ? { startsAt: isoOrUndefined(draft["startsAt"]) } : {}),
      ...(draft["endsAt"] !== undefined ? { endsAt: isoOrUndefined(draft["endsAt"]) } : {}),
      ...(draft["location"] !== undefined ? { location: textOrUndefined(draft["location"]) } : {}),
      ...(draft["status"] !== undefined ? { status: draft["status"] as "watching" | "registered" | "attending" | "attended" } : {}),
    });
    setReload((value) => value + 1);
  }

  if (error) return <div className="p-4 sm:p-6 text-sm text-red-600 break-words">{error}</div>;
  if (rows === null) return <div className="p-4 sm:p-6 text-sm text-muted-foreground">Loading Events…</div>;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden w-full max-w-full" style={{ backgroundColor: "var(--color-background)" }}>
      <Header tabs={[{ id: "Events", icon: CalendarRange }]} activeTab="Events" onTabChange={() => {}} />
      <ModuleSurfaceLayout
        table={
          <section aria-label="Events landing section" className="h-full">
            <DataViews
              spec={EVENTS_SPEC}
              view={view}
              data={rows}
              onViewChange={setView}
              onInsert={insertRecord}
              onUpdate={updateRecord}
              canUpdateRow={() => true}
            />
          </section>
        }
        footer={
          total > 0 ? (
            <div className="border-t px-4 py-3 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-warm-gray)" }}>
              {total} Events
            </div>
          ) : null
        }
        below={
          <>
            <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
              <h3 className="text-sm font-medium mb-3">Speaker extraction</h3>
              <EventSpeakerExtraction
                events={rows.map((row) => ({
                  id: String(row["id"]),
                  name: String(row["name"] ?? ""),
                  url: typeof row["url"] === "string" && row["url"] ? row["url"] : undefined,
                }))}
              />
            </div>
            <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
              <ModuleFilesSection moduleName="events" />
            </div>
            <div className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)" }}>
              <ModuleIntelligenceSection moduleName="events" />
            </div>
          </>
        }
      />
    </div>
  );
}

export default EventsPage;
