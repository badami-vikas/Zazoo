import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  BriefcaseBusiness,
  Database,
  Eye,
  Layers,
  LockKeyhole,
  RefreshCw,
  Target,
  TrendingUp,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { Header } from "../components/shared/Header";
import { ModuleFilesSection } from "../components/shared/ModuleFilesSection";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { DashboardRow } from "../components/shared/DashboardRow";
import { DataViews } from "../dataviews/DataViews";
import { viewConfigForKind } from "../dataviews/eligibility";
import type { DataRow, GraphNode } from "../dataviews/types";
import { defaultViewConfig, type ColumnSpec, type TableSpec, type ViewConfig } from "@bridge/tables";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { supabase } from "../lib/supabase";

type PageId = "deals" | "sources" | "theses";
type ModuleManifest = Awaited<ReturnType<typeof trpc.dealpilot.module.query>>;
type RecordPage = Awaited<ReturnType<typeof trpc.dealpilot.records.query>>;
type RecordRow = RecordPage["items"][number];
type RecordDetail = Awaited<ReturnType<typeof trpc.dealpilot.detail.query>>;
type CapturePage = Awaited<ReturnType<typeof trpc.dealpilot.captures.query>>;
type Capture = CapturePage["items"][number];

const PAGE_META = {
  deals: { label: "Deals", icon: BriefcaseBusiness, kind: "deal" as const },
  sources: { label: "Sources", icon: Database, kind: "source" as const },
  theses: { label: "Theses", icon: Target, kind: "thesis" as const },
};

// Files are a SECTION below the table (ui-architecture-rules §3), reached by
// scrolling past the view — never a sibling toggle Page. A Page is derived from
// a Database (§2); a folder of Files is not one. `ModuleFilesSection` renders
// them as a real file explorer (ADR-195).
const ALL_TABS = ( Object.keys(PAGE_META) as (keyof typeof PAGE_META)[] ).map(
  (id) => ({ id, label: PAGE_META[id].label, icon: PAGE_META[id].icon }),
);

function parsePage(value: string | undefined): PageId {
  return value === "sources" || value === "theses" ? value : "deals";
}

function recordName(record: RecordRow): string {
  if (record.kind === "deal") return record.company;
  return record.name;
}

function recordPage(record: RecordRow): PageId {
  if (record.kind === "deal") return "deals";
  if (record.kind === "source") return "sources";
  return "theses";
}

function displayValue(record: RecordRow, field: string): string {
  if (record.kind === "source" && (field === "userId" || field === "password")) {
    return record.credentialRef ? "Locked - re-authenticate in Record Detail" : "Unavailable";
  }
  if (field === "sources" || field === "theses" || field === "deals" || field === "tasks" || field === "relationships") {
    return "-";
  }
  const value: unknown = Object.entries(record).find(([key]) => key === field)?.[1];
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && value) return value;
  return "-";
}

// ── Deals table presentation (ADR-155) ──────────────────────────────────────
// Canonical stage value → mockup-facing label (display only; the stored value
// stays canonical so edit/sort/filter and updateDeal keep working).
const STAGE_LABELS: Record<string, string> = {
  sourced: "New",
  triage: "Triage",
  engaged: "Pursue",
  nda_cim: "NDA/CIM",
  diligence: "Diligence",
  ic: "IC",
  loi: "LOI",
  closing: "Closing",
  portfolio: "Portfolio",
  passed: "Passed",
};
const STAGE_TONES: Record<string, "green" | "yellow" | "red" | "blue" | "gray"> = {
  sourced: "gray",
  triage: "yellow",
  engaged: "blue",
  nda_cim: "blue",
  diligence: "blue",
  ic: "blue",
  loi: "blue",
  closing: "blue",
  portfolio: "green",
  passed: "gray",
};
const DEAL_STAGE_OPTIONS = Object.keys(STAGE_LABELS);
// Table-cell presentation hints per deal column (opt-in; @bridge/tables ColumnSpec.display).
const DEAL_DISPLAY: Record<string, NonNullable<ColumnSpec["display"]>> = {
  stage: "badge",
  revenue: "currency",
  ebitda: "currency",
  askingPrice: "currency",
  multiple: "multiple",
  evidenceScore: "meter",
};
// Deal fields kept off the redesigned Deals table (still on Record Detail / manifest).
// "rag" dropped everywhere 2026-08-10 (user directive: "Drop the RYG column
// everywhere") — the standalone R/Y/G status column duplicated the Stage badge
// without adding information, and was never wired to a governed capability.
const DEAL_TABLE_OMIT = new Set(["sde", "evidenceHealth", "sources", "theses", "rag"]);

/** Compact money label for the stat cards: 214_000_000 → "$214M". */
function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}


/** Implied EV multiple = asking price / EBITDA, when both are present and EBITDA > 0. */
function impliedMultiple(record: RecordRow): number | undefined {
  if (record.kind !== "deal") return undefined;
  const { askingPrice, ebitda } = record;
  if (typeof askingPrice === "number" && typeof ebitda === "number" && ebitda > 0) {
    return askingPrice / ebitda;
  }
  return undefined;
}

const CREATE_FIELDS: Record<PageId, ReadonlySet<string>> = {
  deals: new Set([
    "company",
    "stage",
    "fitScore",
    "thesisTag",
    "sourceChannel",
    "revenue",
    "ebitda",
    "askingPrice",
    "evidenceScore",
    "p0Flags",
  ]),
  sources: new Set([
    "name",
    "link",
    "connectionType",
    "spendCap",
    "rightsAttested",
    "userId",
    "password",
  ]),
  theses: new Set(["name", "focus", "targetCagr", "criteria", "exclusions"]),
};

const REQUIRED_FIELDS: Record<PageId, ReadonlySet<string>> = {
  deals: new Set(["company"]),
  sources: new Set(["name", "link", "connectionType", "spendCap", "rightsAttested"]),
  theses: new Set(["name", "focus"]),
};

const RELATION_TARGETS: Record<string, string> = {
  deals: "dealpilot.deals",
  sources: "dealpilot.sources",
  theses: "dealpilot.theses",
  relationships: "people",
  tasks: "tasks",
};

function buildTableSpec(
  pageId: PageId,
  page: ModuleManifest["pages"][number],
  rows: RecordRow[],
): TableSpec {
  const editableFields = CREATE_FIELDS[pageId];
  const requiredFields = REQUIRED_FIELDS[pageId];
  const columns: ColumnSpec[] = page.columns.map((column) => {
    const editable = editableFields.has(column.id);
    const kind: ColumnSpec["kind"] = column.kind === "credential" ? "text" : column.kind;
    const observedOptions = kind === "select"
      ? [...new Set(rows.map((row) => row[column.id as keyof RecordRow]).filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        ))]
      : undefined;
    const options = column.id === "connectionType"
      ? ["url", "email_alert", "api", "account"]
      : observedOptions;
    return {
      id: column.id,
      label: column.label,
      kind,
      editable,
      locked: column.kind === "credential" && !editable,
      hiddenInForm: !editable,
      required: requiredFields.has(column.id),
      sensitive: column.kind === "credential",
      ...(options && options.length > 0 ? { options } : {}),
      ...(column.kind === "relation"
        ? { relationTarget: RELATION_TARGETS[column.id], editable: false, hiddenInForm: true }
        : {}),
      ...(column.id === "connectionType" ? { defaultValue: "url" } : {}),
      ...(column.id === "rightsAttested" ? { defaultValue: false } : {}),
    };
  });
  if (pageId === "deals") {
    return { id: page.databaseId, columns: decorateDealsColumns(columns) };
  }
  return { id: page.databaseId, columns };
}

/**
 * Curates the Deals table (ADR-155) to the triage view: drops secondary columns
 * kept on Record Detail, attaches opt-in presentation hints (stage/RAG badges,
 * currency, evidence meter), pins explicit select options for the Form, and
 * inserts the derived MULTIPLE column after Asking price. Purely presentational —
 * the underlying values and governed create/update contract are unchanged.
 */
function decorateDealsColumns(columns: ColumnSpec[]): ColumnSpec[] {
  const decorated = columns
    .filter((column) => !DEAL_TABLE_OMIT.has(column.id))
    .map((column) => {
      const next: ColumnSpec = { ...column };
      if (DEAL_DISPLAY[column.id]) next.display = DEAL_DISPLAY[column.id];
      if (column.id === "stage") {
        next.options = DEAL_STAGE_OPTIONS;
        next.badgePalette = STAGE_TONES;
        next.badgeLabels = STAGE_LABELS;
        next.defaultValue = "sourced";
      }
      return next;
    });
  const multipleColumn: ColumnSpec = {
    id: "multiple",
    label: "Multiple",
    kind: "number",
    editable: false,
    hiddenInForm: true,
    display: "multiple",
  };
  const askIndex = decorated.findIndex((column) => column.id === "askingPrice");
  if (askIndex === -1) decorated.push(multipleColumn);
  else decorated.splice(askIndex + 1, 0, multipleColumn);
  return decorated;
}

async function queryAllRecords(page: PageId): Promise<RecordPage> {
  let current = await trpc.dealpilot.records.query({
    organizationId: PILOT_ORGANIZATION,
    page,
    limit: 200,
    offset: 0,
  });
  const items = [...current.items];
  while (current.hasMore && current.items.length > 0) {
    current = await trpc.dealpilot.records.query({
      organizationId: PILOT_ORGANIZATION,
      page,
      limit: 200,
      offset: items.length,
    });
    items.push(...current.items);
  }
  return { items, total: current.total, hasMore: false };
}

export function DealPilotPage() {
  const navigate = useNavigate();
  const params = useParams<{ page?: string; recordId?: string }>();
  const pageId = parsePage(params.page);
  const recordId = params.recordId;
  const [manifest, setManifest] = useState<ModuleManifest | null>(null);
  const [records, setRecords] = useState<RecordPage | null>(null);
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig("dealpilot:table"));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [formRecord, setFormRecord] = useState<DataRow | null>(null);
  const loadGeneration = useRef(0);
  const routeKey = `${pageId}:${recordId ?? ""}`;
  const currentRouteKey = useRef(routeKey);
  currentRouteKey.current = routeKey;
  const setRouteNotice = useCallback((message: string | null) => {
    if (currentRouteKey.current === routeKey) setNotice(message);
  }, [routeKey]);

  useEffect(() => {
    if (!params.page) navigate("/dealpilot/deals", { replace: true });
  }, [navigate, params.page]);

  const load = useCallback(async (expectedRouteKey = routeKey): Promise<boolean> => {
    if (currentRouteKey.current !== expectedRouteKey) return false;
    const generation = ++loadGeneration.current;
    const isCurrent = () =>
      loadGeneration.current === generation &&
      currentRouteKey.current === expectedRouteKey;
    setError(null);
    setRecords(null);
    setDetail(null);
    setCaptures([]);
    try {
      if (recordId) {
        const [module, selected, sourceCaptures] = await Promise.all([
          trpc.dealpilot.module.query({ organizationId: PILOT_ORGANIZATION }),
          trpc.dealpilot.detail.query({
            organizationId: PILOT_ORGANIZATION,
            kind: PAGE_META[pageId].kind,
            id: recordId,
          }),
          pageId === "sources"
            ? trpc.dealpilot.captures
                .query({
                  organizationId: PILOT_ORGANIZATION,
                  sourceId: recordId,
                  limit: 200,
                  offset: 0,
                })
                .catch((captureError: unknown) => {
                  // Captures (raw bodies) stay on the Local Plane; the public cloud
                  // refuses them. Render the Source Record with no captures rather
                  // than failing the whole detail load.
                  const message =
                    captureError instanceof Error ? captureError.message : String(captureError);
                  if (/Local Plane|public cloud/i.test(message)) {
                    return { items: [], total: 0, hasMore: false };
                  }
                  throw captureError;
                })
            : Promise.resolve({ items: [], total: 0, hasMore: false }),
        ]);
        if (!isCurrent()) return false;
        setManifest(module);
        setDetail(selected);
        setCaptures(sourceCaptures.items);
      } else {
        const [module, page] = await Promise.all([
          trpc.dealpilot.module.query({ organizationId: PILOT_ORGANIZATION }),
          queryAllRecords(pageId),
        ]);
        if (!isCurrent()) return false;
        setManifest(module);
        setRecords(page);
      }
      return true;
    } catch (loadError) {
      if (!isCurrent()) return false;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      return true;
    }
  }, [pageId, recordId, routeKey]);

  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);

  useEffect(() => {
    setNotice(null);
    setPendingProposalId(null);
  }, [pageId, recordId]);

  const activePage = manifest?.pages.find((page) => page.id === pageId);
  const tableSpec = useMemo<TableSpec>(
    () => activePage
      ? buildTableSpec(pageId, activePage, records?.items ?? [])
      : { id: `dealpilot.${pageId}`, columns: [{ id: "name", label: "Record", kind: "text" }] },
    [activePage, pageId, records?.items],
  );
  const dataRows = useMemo<DataRow[]>(
    () => (records?.items ?? []).map((record) => {
      const row: DataRow = { ...record };
      if (record.kind === "source") {
        row["userId"] = displayValue(record, "userId");
        row["password"] = displayValue(record, "password");
      }
      if (record.kind === "deal") {
        // Derived, read-only presentation column (ADR-155) — never persisted.
        const multiple = impliedMultiple(record);
        if (multiple !== undefined) row["multiple"] = multiple;
      }
      return row;
    }),
    [records?.items],
  );

  const dealStats = useMemo(() => {
    if (pageId !== "deals" || !records) return null;
    const deals = records.items.filter(
      (record): record is Extract<RecordRow, { kind: "deal" }> => record.kind === "deal",
    );
    // Total EV excludes archived/passed deals, matching the pipeline value a
    // partner tracks (a passed deal is no longer in the funnel).
    const totalEv = deals
      .filter((deal) => deal.stage !== "passed")
      .reduce((sum, deal) => sum + (deal.askingPrice ?? 0), 0);
    const p0Flags = deals.reduce((sum, deal) => sum + (deal.p0Flags ?? 0), 0);
    const scored = deals.filter((deal) => typeof deal.evidenceScore === "number");
    const avgEvidence = scored.length
      ? Math.round(scored.reduce((sum, deal) => sum + (deal.evidenceScore ?? 0), 0) / scored.length)
      : null;
    return { showing: deals.length, totalEv, p0Flags, avgEvidence };
  }, [pageId, records]);

  useEffect(() => {
    setView(defaultViewConfig(`${tableSpec.id}:table`));
  }, [pageId, tableSpec.id]);

  async function createRecord(draft: Partial<DataRow>) {
    if (pageId === "deals") {
      await trpc.dealpilot.createDeal.mutate({
        organizationId: PILOT_ORGANIZATION,
        company: String(draft["company"] ?? ""),
        ...(draft["revenue"] !== undefined ? { revenue: Number(draft["revenue"]) } : {}),
        ...(draft["ebitda"] !== undefined ? { ebitda: Number(draft["ebitda"]) } : {}),
        ...(draft["askingPrice"] !== undefined ? { askingPrice: Number(draft["askingPrice"]) } : {}),
        ...(draft["rag"] ? { rag: String(draft["rag"]) as "red" | "yellow" | "green" } : {}),
        ...(draft["fitScore"] !== undefined ? { fitScore: Number(draft["fitScore"]) } : {}),
        ...(draft["evidenceScore"] !== undefined ? { evidenceScore: Number(draft["evidenceScore"]) } : {}),
        ...(draft["p0Flags"] !== undefined ? { p0Flags: Number(draft["p0Flags"]) } : {}),
        ...(draft["thesisTag"] ? { thesisTag: String(draft["thesisTag"]) } : {}),
        ...(draft["sourceChannel"] ? { sourceChannel: String(draft["sourceChannel"]) } : {}),
      });
      await load();
      setRouteNotice("Deal added.");
      return;
    }
    if (pageId === "sources") {
      await trpc.dealpilot.createSource.mutate({
        organizationId: PILOT_ORGANIZATION,
        name: String(draft["name"] ?? ""),
        link: String(draft["link"] ?? ""),
        connectionType: String(draft["connectionType"] ?? "url") as "url" | "email_alert" | "api" | "account",
        spendCap: Number(draft["spendCap"] ?? 0),
        rightsAttested: draft["rightsAttested"] === true,
        ...(draft["userId"] ? { userId: String(draft["userId"]) } : {}),
        ...(draft["password"] ? { password: String(draft["password"]) } : {}),
      });
      await load();
      setRouteNotice("Source added. Open it to run governed Deal discovery.");
      return;
    }
    const result = await trpc.dealpilot.createThesis.mutate({
      organizationId: PILOT_ORGANIZATION,
      name: String(draft["name"] ?? ""),
      focus: String(draft["focus"] ?? ""),
      criteria: String(draft["criteria"] ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
      exclusions: String(draft["exclusions"] ?? "").split("\n").map((value) => value.trim()).filter(Boolean),
      ...(draft["targetCagr"] !== undefined ? { targetCagr: Number(draft["targetCagr"]) } : {}),
    });
    await load();
    const proposalId = result.discovery.status === "pending_review" ? result.discovery.id : null;
    setPendingProposalId(proposalId);
    setRouteNotice(
      proposalId
        ? `Thesis added. Source discovery found ${((result.discovery.output?.proposedOutput as { relations?: unknown[] } | undefined)?.relations ?? []).length} authorized Source candidate(s) and awaits approval.`
        : `Thesis added. Source discovery status: ${result.discovery.status}.`,
    );
  }

  async function updateRecord(rowId: string, patch: Partial<DataRow>) {
    if (pageId === "deals") {
      await trpc.dealpilot.updateDeal.mutate({
        organizationId: PILOT_ORGANIZATION,
        id: rowId,
        ...(patch["company"] !== undefined ? { company: String(patch["company"]) } : {}),
        ...(patch["stage"] !== undefined
          ? {
              stage: String(patch["stage"]) as
                | "sourced"
                | "triage"
                | "engaged"
                | "nda_cim"
                | "diligence"
                | "ic"
                | "loi"
                | "closing"
                | "portfolio"
                | "passed",
            }
          : {}),
        ...(patch["revenue"] !== undefined ? { revenue: Number(patch["revenue"]) } : {}),
        ...(patch["ebitda"] !== undefined ? { ebitda: Number(patch["ebitda"]) } : {}),
        ...(patch["sde"] !== undefined ? { sde: Number(patch["sde"]) } : {}),
        ...(patch["askingPrice"] !== undefined ? { askingPrice: Number(patch["askingPrice"]) } : {}),
        ...(patch["rag"] !== undefined ? { rag: String(patch["rag"]) as "red" | "yellow" | "green" } : {}),
        ...(patch["fitScore"] !== undefined ? { fitScore: Number(patch["fitScore"]) } : {}),
        ...(patch["evidenceScore"] !== undefined ? { evidenceScore: Number(patch["evidenceScore"]) } : {}),
        ...(patch["p0Flags"] !== undefined ? { p0Flags: Number(patch["p0Flags"]) } : {}),
        ...(patch["thesisTag"] !== undefined ? { thesisTag: String(patch["thesisTag"]) } : {}),
        ...(patch["sourceChannel"] !== undefined ? { sourceChannel: String(patch["sourceChannel"]) } : {}),
      });
      await load();
      setRouteNotice("Deal updated.");
      return;
    }
    if (pageId === "sources") {
      await trpc.dealpilot.updateSource.mutate({
        organizationId: PILOT_ORGANIZATION,
        id: rowId,
        ...(patch["name"] !== undefined ? { name: String(patch["name"]) } : {}),
        ...(patch["link"] !== undefined ? { link: String(patch["link"]) } : {}),
        ...(patch["connectionType"] !== undefined
          ? {
              connectionType: String(patch["connectionType"]) as
                | "url"
                | "email_alert"
                | "api"
                | "account",
            }
          : {}),
        ...(patch["spendCap"] !== undefined ? { spendCap: Number(patch["spendCap"]) } : {}),
        ...(patch["health"] !== undefined
          ? { health: String(patch["health"]) as "ready" | "degraded" | "paused" }
          : {}),
      });
      await load();
      setRouteNotice("Source updated.");
      return;
    }
    // Theses are create-only in the domain contract (no updateThesis).
  }

  function openRecord(row: DataRow | GraphNode) {
    if ("kind" in row && (row.kind === "deal" || row.kind === "source" || row.kind === "thesis")) {
      navigate(`/dealpilot/${recordPage(row as RecordRow)}/${String(row.id)}`);
      return;
    }
    const databaseId = "databaseId" in row && typeof row.databaseId === "string"
      ? row.databaseId
      : tableSpec.id;
    const targetPage = databaseId === "dealpilot.sources"
      ? "sources"
      : databaseId === "dealpilot.theses"
        ? "theses"
        : databaseId === "dealpilot.deals"
          ? "deals"
          : null;
    const rawId = String("recordId" in row && row.recordId ? row.recordId : row.id);
    const targetId = rawId.startsWith(`${databaseId}:`) ? rawId.slice(databaseId.length + 1) : rawId;
    if (targetPage && targetId) navigate(`/dealpilot/${targetPage}/${targetId}`);
  }

  const tabs = ALL_TABS;

  function handleTabChange(id: string) {
    navigate(`/dealpilot/${id}`);
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
        <Header tabs={tabs} activeTab={pageId} onTabChange={handleTabChange} />
        <div className="grid flex-1 place-items-center p-8">
          <div className="max-w-md space-y-3 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button className="text-sm underline" onClick={() => void load()}>Retry</button>
          </div>
        </div>
      </div>
    );
  }
  if (!manifest || (!recordId && !records) || (recordId && !detail)) {
    return <div className="flex-1 p-8 text-sm text-[var(--color-warm-gray)]">Loading DealPilot...</div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
      <Header
        tabs={tabs}
        activeTab={pageId}
        onTabChange={handleTabChange}
      />
      {recordId && detail ? (
        <RecordDetailSurface
          key={detail.record.id}
          detail={detail}
          captures={captures}
          notice={notice}
          onNotice={setRouteNotice}
          onReload={load}
        />
      ) : (
        <>
          {/* The "All Deals" heading + "Add Deal" button row was removed
              2026-08-10 (user directive: "There should be no All deals, Add
              deal kind of row.") — <DataViews> already owns both: its List
              dropdown carries the list identity ("All"), and its in-place
              add-row (TableView's onInsert affordance) is the one standard
              way to create a record, not a page-local duplicate. */}
          {notice && (
            <div className="px-4 py-2 border-b text-sm flex items-center justify-between" style={{ borderColor: "var(--color-border)" }}>
              <span>{notice}</span>
              {pendingProposalId && (
                <button
                  className="font-semibold underline"
                  onClick={async () => {
                    try {
                      const result = await trpc.action.decide.mutate({
                        proposalId: pendingProposalId,
                        decision: "approve",
                      });
                      if (!(await load())) return;
                      setPendingProposalId(null);
                      if (result.effectsStatus === "failed") {
                        setRouteNotice(
                          `Approval was recorded, but Source linking failed: ${result.effectsError}. Review the failed effect in Approvals.`,
                        );
                        return;
                      }
                      setRouteNotice(
                        `Source discovery approved and ${result.dealPilotEffects.length} authorized Source candidate(s) linked.`,
                      );
                    } catch (approvalError) {
                      setRouteNotice(approvalError instanceof Error ? approvalError.message : String(approvalError));
                    }
                  }}
                >
                  Approve
                </button>
              )}
            </div>
          )}
          <ModuleSurfaceLayout
            table={
              <section className="h-full" aria-label={`${PAGE_META[pageId].label} Database`}>
                <DataViews
                  spec={tableSpec}
                  view={view}
                  data={dataRows}
                  searchPlaceholder={`Search ${PAGE_META[pageId].label.toLowerCase()}…`}
                  onViewChange={setView}
                  onInsert={createRecord}
                  {...(pageId !== "theses" ? { onUpdate: updateRecord } : {})}
                  formRecord={formRecord}
                  onEditRecord={(row) => {
                    setFormRecord(row);
                    setView(viewConfigForKind(tableSpec, "form", view));
                  }}
                  onOpenRecord={openRecord}
                  insights={
                    dealStats ? (
                      <DashboardRow
                        metrics={[
                          { id: "showing", label: "Showing", value: String(dealStats.showing), icon: Layers },
                          { id: "ev", label: "Total EV", value: formatMoney(dealStats.totalEv), icon: TrendingUp },
                          {
                            id: "p0",
                            label: "P0 flags",
                            value: String(dealStats.p0Flags),
                            icon: AlertTriangle,
                            ...(dealStats.p0Flags > 0 ? { tone: "warn" as const } : {}),
                          },
                          {
                            id: "evidence",
                            label: "Avg evidence",
                            value: dealStats.avgEvidence === null ? "—" : `${dealStats.avgEvidence}%`,
                            icon: Activity,
                          },
                        ]}
                      />
                    ) : undefined
                  }
                />
              </section>
            }
            below={
              <>
                <ModuleFilesSection moduleName="deal-pilot" />
                <ModuleIntelligenceSection moduleName="deal-pilot" />
              </>
            }
          />
        </>
      )}
    </div>
  );
}

function RecordDetailSurface({
  detail,
  captures,
  notice,
  onNotice,
  onReload,
}: {
  detail: RecordDetail;
  captures: Capture[];
  notice: string | null;
  onNotice: (message: string | null) => void;
  onReload: () => Promise<boolean>;
}) {
  const record = detail.record;
  const [reauthToken, setReauthToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Partial<Record<"userId" | "password", string>>>({});
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthBusy, setReauthBusy] = useState(false);
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const reauthClearTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (reauthClearTimer.current !== null) {
        window.clearTimeout(reauthClearTimer.current);
      }
    },
    [],
  );

  async function reauthenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setReauthBusy(true);
    setReauthError(null);
    try {
      const password = String(new FormData(event.currentTarget).get("password") ?? "");
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user?.email) {
        throw new Error("Password re-authentication requires a signed-in account with an email address.");
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userData.user.email,
        password,
      });
      if (signInError) throw signInError;
      const session = await trpc.dealpilot.reauthenticateCredential.mutate({
        organizationId: PILOT_ORGANIZATION,
        sourceId: record.id,
      });
      setReauthToken(session.token);
      setRevealed({});
      if (reauthClearTimer.current !== null) {
        window.clearTimeout(reauthClearTimer.current);
      }
      reauthClearTimer.current = window.setTimeout(() => {
        setReauthToken(null);
        setRevealed({});
        reauthClearTimer.current = null;
      }, Math.max(0, Date.parse(session.expiresAt) - Date.now()));
      setReauthOpen(false);
      onNotice(`Re-authenticated until ${new Date(session.expiresAt).toLocaleTimeString()}.`);
    } catch (reauthError) {
      setReauthError(reauthError instanceof Error ? reauthError.message : String(reauthError));
    } finally {
      setReauthBusy(false);
    }
  }

  async function access(field: "userId" | "password", action: "reveal" | "copy") {
    if (!reauthToken) {
      onNotice("Re-authenticate before revealing or copying credentials.");
      return;
    }
    try {
      const result = await trpc.dealpilot.accessCredential.mutate({
        organizationId: PILOT_ORGANIZATION,
        sourceId: record.id,
        token: reauthToken,
        field,
        action,
      });
      if (action === "copy") {
        await navigator.clipboard.writeText(result.value);
        onNotice(
          `${field === "userId" ? "User ID" : "Password"} copied. Bridge will request clipboard clearing in 30 seconds where the OS permits it.`,
        );
        window.setTimeout(() => {
          void navigator.clipboard
            .readText()
            .then((current) =>
              current === result.value
                ? navigator.clipboard.writeText("")
                : undefined,
            )
            .catch(() => {
              onNotice("The OS did not permit automatic clipboard clearing; overwrite the clipboard when finished.");
            });
        }, 30_000);
        return;
      }
      setRevealed((current) => ({ ...current, [field]: result.value }));
      window.setTimeout(() => {
        setRevealed((current) => {
          const next = { ...current };
          delete next[field];
          return next;
        });
      }, 30_000);
    } catch (accessError) {
      setReauthToken(null);
      setRevealed({});
      onNotice(accessError instanceof Error ? accessError.message : String(accessError));
    }
  }

  async function clearCredential() {
    if (!reauthToken) {
      onNotice("Re-authenticate before revoking this Source credential.");
      return;
    }
    if (
      !window.confirm(
        "Revoke and permanently remove this Source credential from the secure vault?",
      )
    ) {
      return;
    }
    try {
      await trpc.dealpilot.clearCredential.mutate({
        organizationId: PILOT_ORGANIZATION,
        sourceId: record.id,
        token: reauthToken,
      });
      setReauthToken(null);
      setRevealed({});
      if (reauthClearTimer.current !== null) {
        window.clearTimeout(reauthClearTimer.current);
        reauthClearTimer.current = null;
      }
      if (await onReload()) {
        onNotice("Source credential revoked and removed from the secure vault.");
      }
    } catch (clearError) {
      setReauthToken(null);
      setRevealed({});
      onNotice(clearError instanceof Error ? clearError.message : String(clearError));
    }
  }

  const fields = Object.entries(record).filter(
    ([key]) => !["organizationId", "kind", "credentialRef", "credentialOwnerId"].includes(key),
  );
  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to={`/dealpilot/${recordPage(record)}`} className="text-sm underline">Back to {PAGE_META[recordPage(record)].label}</Link>
          <h1 className="text-2xl font-semibold mt-2">{recordName(record)}</h1>
        </div>
        {record.kind === "source" && (
          <button
            type="button"
            disabled={discovering}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-white text-sm"
            onClick={async () => {
              if (discovering) return;
              setDiscovering(true);
              try {
                const result = await trpc.dealpilot.discoverDeals.mutate({
                  organizationId: PILOT_ORGANIZATION,
                  sourceId: record.id,
                });
                if (await onReload()) {
                  onNotice(
                    `Governed Deal discovery ${result.status}; charged ${result.spend.actual.toLocaleString()} of ${result.spend.cap.toLocaleString()} Source spend units.`,
                  );
                }
              } catch (discoveryError) {
                onNotice(discoveryError instanceof Error ? discoveryError.message : String(discoveryError));
              } finally {
                setDiscovering(false);
              }
            }}
          >
            <RefreshCw className={`w-4 h-4 ${discovering ? "animate-spin" : ""}`} />
            {discovering ? "Discovering..." : "Discover Deals"}
          </button>
        )}
      </div>
      {notice && <div className="p-3 rounded-lg border bg-white text-sm">{notice}</div>}
      <section className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="font-semibold mb-3">Fields</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          {fields.map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs uppercase" style={{ color: "var(--color-warm-gray)" }}>{key}</dt>
              <dd className="text-sm break-words">{Array.isArray(value) ? value.join(", ") || "-" : String(value ?? "-")}</dd>
            </div>
          ))}
        </dl>
      </section>
      {record.kind === "source" && (
        <section className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><LockKeyhole className="w-4 h-4" /> Credential controls</h2>
            <button
              type="button"
              className="text-sm underline"
              onClick={() => {
                setReauthError(null);
                setReauthOpen(true);
              }}
            >
              Re-authenticate
            </button>
          </div>
          {(["userId", "password"] as const).map((field) => {
            // credentialProjection is null in the public cloud (credentials stay on
            // the Local Plane) — render those Source credential slots as unavailable.
            const projection =
              "credentialProjection" in detail && detail.credentialProjection
                ? detail.credentialProjection[field]
                : { state: "unavailable" as const };
            return (
              <div key={field} className="mt-4 flex flex-wrap items-center gap-3">
                <span className="w-24 text-sm font-medium">{field === "userId" ? "User ID" : "Password"}</span>
                <code className="text-sm">{revealed[field] ?? projection.masked ?? "Unavailable"}</code>
                {projection.state === "available" && (
                  <>
                    <button className="text-sm underline flex items-center gap-1" onClick={() => void access(field, "reveal")}>
                      <Eye className="w-3.5 h-3.5" /> Reveal
                    </button>
                    <button className="text-sm underline" onClick={() => void access(field, "copy")}>Copy</button>
                  </>
                )}
              </div>
            );
          })}
          {"credentialCleanupAvailable" in detail &&
            detail.credentialCleanupAvailable && (
              <button
                type="button"
                className="mt-5 text-sm font-medium text-red-700 underline"
                onClick={() => void clearCredential()}
              >
                Revoke credential
              </button>
            )}
        </section>
      )}
      {record.kind === "source" && reauthOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dealpilot-reauth-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <form
            onSubmit={reauthenticate}
            className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-5 shadow-xl"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div>
              <h2 id="dealpilot-reauth-title" className="font-semibold">Confirm your identity</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--color-warm-gray)" }}>
                Enter your Bridge account password. It is sent only to Supabase Auth and never to the Bridge API.
              </p>
            </div>
            <label className="block text-sm">
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
                className="mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>
            {reauthError && <p className="text-sm text-red-700">{reauthError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={reauthBusy}
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={() => setReauthOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={reauthBusy}
                className="rounded-lg px-3 py-2 text-sm text-white disabled:opacity-60"
                style={{ backgroundColor: "var(--color-steel)" }}
              >
                {reauthBusy ? "Confirming..." : "Confirm"}
              </button>
            </div>
          </form>
        </div>
      )}
      <section className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="font-semibold mb-3">Related Records</h2>
        {detail.relatedRecords.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-warm-gray)" }}>No related Records yet.</p>
        ) : (
          <div className="space-y-2">
            {detail.relatedRecords.map((related) => (
              <Link key={related.id} className="block text-sm underline" to={`/dealpilot/${recordPage(related)}/${related.id}`}>
                {recordName(related)}
              </Link>
            ))}
          </div>
        )}
      </section>
      {record.kind === "source" && captures.length > 0 && (
        <section className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="font-semibold mb-3">Quarantined Deal candidates</h2>
          {captures.map((capture) => (
            <div key={capture.captureId} className="flex items-center justify-between gap-4 py-2 border-b">
              <span className="text-sm">{String(capture.payload.name ?? capture.captureId)}</span>
              <button
                className="text-sm font-semibold underline"
                onClick={async () => {
                  try {
                    await trpc.dealpilot.commit.mutate({
                      organizationId: PILOT_ORGANIZATION,
                      captureId: capture.captureId,
                    });
                    if (await onReload()) {
                      onNotice("Candidate committed as a Deal with Source and Thesis provenance.");
                    }
                  } catch (commitError) {
                    onNotice(commitError instanceof Error ? commitError.message : String(commitError));
                  }
                }}
              >
                Add Deal
              </button>
            </div>
          ))}
        </section>
      )}
      <section className="rounded-xl border bg-white p-5" style={{ borderColor: "var(--color-border)" }}>
        <h2 className="font-semibold mb-3">Sections</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {detail.sections.map((section) => (
            <div key={section} className="rounded-lg border p-3 text-sm">
              <strong>{section}</strong>
              <p className="mt-1" style={{ color: "var(--color-warm-gray)" }}>No connected data in this Section yet.</p>
            </div>
          ))}
        </div>
      </section>
      <ModuleFilesSection moduleName="deal-pilot" />
      <div className="mt-6">
        <ModuleIntelligenceSection moduleName="deal-pilot" />
      </div>
    </div>
  );
}
