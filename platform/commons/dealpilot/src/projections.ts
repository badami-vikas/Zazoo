// DP0 projections — real-data, empty-state-ready read-side views over the FactStore.
// Each projection function reads from FactStore.livingProfile() and FactStore.all() — never
// dummy or fixture data. An absent entity returns isEmpty: true with all optional fields absent.
// DP0 scope: Summary · Profile · Documents · Activity tabs (plan §1.3, slice DP0).

import type { Fact, FactStore } from "@bridge/facts";
import type { DealStage } from "./deal.js";
import type { ThesisFitBand } from "./types.js";

// ─── Activity ────────────────────────────────────────────────────────────────

export type ActivityActor = "human" | "agent" | "system";

export type ActivityKind =
  | "fact_recorded"
  | "stage_change"
  | "document_added"
  | "agent_run"
  | "user_action";

/** Immutable timeline entry. DP0 derives events from the FactStore audit trail; later slices
 *  (DP1+) extend with agent-run receipts, approval decisions, and document-ingestion events. */
export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  summary: string;
  actor: ActivityActor;
  occurredAt: string; // ISO-8601
  metadata?: Record<string, unknown>;
}

// ─── Flags ───────────────────────────────────────────────────────────────────

/** Risk/flag severity mirroring the P0/P1/P2 register in the plan (§1.3 deal_tabs.Risks). */
export type FlagSeverity = "p0" | "p1" | "p2";

/** A deal flag stored as a Fact with field prefix "flag:<severity>:". */
export interface DealFlag {
  id: string; // fact id
  severity: FlagSeverity;
  label: string;
  source?: string;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

/** Key economics derived from FactStore — all fields optional (honest empty state). */
export interface DealKeyEconomics {
  askPrice?: number;
  revenue?: number;
  sde?: number;
  /** askPrice / sde — computed when both are present and sde > 0. */
  impliedMultiple?: number;
}

/** Decision-first brief for the Deal detail header and Summary tab (plan §1.3 deal_tabs.Summary).
 *  isEmpty indicates no facts have been recorded for this deal yet. */
export interface DealSummaryProjection {
  dealId: string;
  /** True when no facts exist for this deal — UI should render an honest empty state. */
  isEmpty: boolean;
  stage: DealStage;
  thesisFitBand?: ThesisFitBand;
  thesisFitScore?: number; // 0..1, from "thesisFitScore" fact when present
  keyEconomics: DealKeyEconomics;
  flags: DealFlag[]; // P0/P1/P2 flags from "flag:*" facts
  /** Last 5 activity events, newest first. */
  recentActivity: ActivityEvent[];
}

// ─── Profile ─────────────────────────────────────────────────────────────────

/** Company/deal profile facts (plan §1.3 deal_tabs.Profile — legal entities, history, etc.). */
export interface DealProfileProjection {
  dealId: string;
  isEmpty: boolean;
  industry?: string;
  geo?: string;
  legalName?: string;
  foundedYear?: number;
  employeeCount?: number;
  website?: string;
  description?: string;
}

// ─── Documents ───────────────────────────────────────────────────────────────

export type DealDocumentKind =
  | "cim"
  | "teaser"
  | "nda"
  | "financials"
  | "tax"
  | "qoe"
  | "contract"
  | "transcript"
  | "other";

export type DealDocumentStatus = "received" | "pending" | "processing" | "ready";

/** A document registered as a Fact (field prefix "doc:<kind>:"). */
export interface DealDocument {
  /** Fact id of the registering fact. */
  id: string;
  kind: DealDocumentKind;
  title: string;
  status: DealDocumentStatus;
  receivedAt?: string; // ISO-8601
  source?: string;
}

/** Documents tab projection (plan §1.3 deal_tabs.Documents). */
export interface DealDocumentsProjection {
  dealId: string;
  isEmpty: boolean;
  documents: DealDocument[];
}

// ─── Activity ────────────────────────────────────────────────────────────────

/** Unified immutable timeline of all recorded actions (plan §1.3 deal_tabs.Activity).
 *  DP0: populated from the FactStore audit trail (every fact = one event). */
export interface DealActivityProjection {
  dealId: string;
  isEmpty: boolean;
  /** All events, oldest first. */
  events: ActivityEvent[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function actorFromProvenance(provenance: Fact["provenance"]): ActivityActor {
  if (provenance === "user_entered") return "human";
  if (provenance === "ai_inferred") return "agent";
  return "system";
}

function deriveActivityEvents(facts: Fact[]): ActivityEvent[] {
  return facts
    .map(
      (f): ActivityEvent => ({
        id: f.id,
        kind: "fact_recorded",
        summary: `${f.field} recorded via ${f.provenance}`,
        actor: actorFromProvenance(f.provenance),
        occurredAt: f.recordedAt,
        metadata: { field: f.field, confidence: f.confidence, provenance: f.provenance },
      }),
    )
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

// ─── Projection functions ─────────────────────────────────────────────────────

/**
 * Project the Summary tab view for a Deal.
 *
 * Reads: `askPrice`, `revenue`, `sde`, `thesisFitScore`, `thesisFitBand`, `flag:*` and `doc:*` facts.
 * `stage` is passed explicitly because it lives on the Deal shell record, not in FactStore.
 */
export function projectSummary(
  dealId: string,
  shell: { stage: DealStage },
  facts: FactStore,
): DealSummaryProjection {
  const profile = facts.livingProfile(dealId);
  const allFacts = facts.all(dealId);
  const isEmpty = Object.keys(profile).length === 0;

  const askPrice = profile.askPrice?.value as number | undefined;
  const sde = profile.sde?.value as number | undefined;
  const revenue = profile.revenue?.value as number | undefined;
  const impliedMultiple =
    askPrice != null && sde != null && sde > 0 ? askPrice / sde : undefined;

  const thesisFitBand =
    profile.thesisFitBand != null ? (profile.thesisFitBand.value as ThesisFitBand) : undefined;
  const thesisFitScore =
    profile.thesisFitScore != null ? (profile.thesisFitScore.value as number) : undefined;

  const flags: DealFlag[] = Object.entries(profile)
    .filter(([k]) => k.startsWith("flag:"))
    .map(([k, fact]) => {
      const parts = k.split(":");
      const severity = (parts[1] ?? "p2") as FlagSeverity;
      const raw = fact.value as { label: string; source?: string };
      return { id: fact.id, severity, label: raw.label, ...(raw.source && { source: raw.source }) };
    });

  const allEvents = deriveActivityEvents(allFacts);
  const recentActivity = allEvents.slice(-5).reverse(); // last 5, newest first

  return {
    dealId,
    isEmpty,
    stage: shell.stage,
    ...(thesisFitBand != null && { thesisFitBand }),
    ...(thesisFitScore != null && { thesisFitScore }),
    keyEconomics: {
      ...(askPrice != null && { askPrice }),
      ...(revenue != null && { revenue }),
      ...(sde != null && { sde }),
      ...(impliedMultiple != null && { impliedMultiple }),
    },
    flags,
    recentActivity,
  };
}

/**
 * Project the Profile tab view for a Deal.
 *
 * Reads: `industry`, `geo`, `legalName`, `foundedYear`, `employeeCount`, `website`,
 * `description` facts.
 */
export function projectProfile(dealId: string, facts: FactStore): DealProfileProjection {
  const profile = facts.livingProfile(dealId);
  const isEmpty = Object.keys(profile).length === 0;

  return {
    dealId,
    isEmpty,
    ...(profile.industry && { industry: profile.industry.value as string }),
    ...(profile.geo && { geo: profile.geo.value as string }),
    ...(profile.legalName && { legalName: profile.legalName.value as string }),
    ...(profile.foundedYear && { foundedYear: profile.foundedYear.value as number }),
    ...(profile.employeeCount && { employeeCount: profile.employeeCount.value as number }),
    ...(profile.website && { website: profile.website.value as string }),
    ...(profile.description && { description: profile.description.value as string }),
  };
}

/**
 * Project the Documents tab view for a Deal.
 *
 * Documents are stored as facts with field names prefixed by `doc:<kind>:`, e.g. `doc:cim:0`.
 * The fact value must conform to `Omit<DealDocument, "id">`.
 */
export function projectDocuments(dealId: string, facts: FactStore): DealDocumentsProjection {
  const profile = facts.livingProfile(dealId);
  const docFacts = Object.entries(profile).filter(([k]) => k.startsWith("doc:"));

  const documents: DealDocument[] = docFacts.map(([, fact]) => {
    const raw = fact.value as Omit<DealDocument, "id">;
    return { id: fact.id, ...raw };
  });

  return {
    dealId,
    isEmpty: documents.length === 0,
    documents,
  };
}

/**
 * Project the Activity tab view for a Deal — unified immutable timeline.
 *
 * DP0: every fact append in FactStore is surfaced as a `fact_recorded` activity event.
 * All events are returned oldest-first for chronological reading.
 */
export function projectActivity(dealId: string, facts: FactStore): DealActivityProjection {
  const allFacts = facts.all(dealId);
  const events = deriveActivityEvents(allFacts);
  return {
    dealId,
    isEmpty: events.length === 0,
    events,
  };
}
