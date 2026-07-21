// SourceConnector port — one shape for every sourcing tier (API client, email-alert parser,
// template-detect scraper, LLM-synthesized extractor, Playwright browser-agent fallback).
// Every connector emits CaptureEnvelopes; nothing here writes to the graph directly — that only
// happens through the platform's ONE intake seam (tool_captures -> proposal -> Approvals).

export type ConnectorTier = "free" | "forms" | "email" | "browser_agent" | "human";

import type { TaintLabel, TrustOrigin } from "@bridge/core";
export type { TrustOrigin };

export interface SourceQuery {
  kind: "person" | "company";
  hints: Record<string, string | undefined>;
}

export interface CaptureEnvelope {
  sourceConnectorId: string;
  /** Stable provider id when one exists; drives restart-safe ingestion dedupe. */
  sourceRecordId?: string;
  tier: ConnectorTier;
  query: SourceQuery;
  payload: Record<string, unknown>;
  confidence: number; // 0..1, connector's own estimate — the intake seam re-scores independently
  costUnits: number; // abstract cost (API credits, browser-minutes, human-minutes) this call consumed
  capturedAt: string;
  /** PI-1 provenance. Optional + additive: connectors set it (external fetches
   * are `untrusted_external`); the intake seam treats ABSENT as
   * `untrusted_external` too, so an untagged envelope is never trusted by
   * default. Tag-and-persist only — no behavior gating (that is PI-2). */
  trustOrigin?: TrustOrigin;
  taintLabel?: TaintLabel;
}

export interface SourceConnector {
  id: string;
  tier: ConnectorTier;
  // Every unit costs a fixed or query-dependent amount; the waterfall reserves this BEFORE
  // calling fetch and settles the actual cost after, so a runaway connector can't blow budget.
  estimateCost(query: SourceQuery): number;
  fetch(query: SourceQuery): Promise<CaptureEnvelope[]>;
}

export interface BudgetLedger {
  reserve(units: number): boolean; // false = insufficient budget, connector is skipped
  settle(reserved: number, actual: number): void;
  remaining(): number;
}

export function createBudgetLedger(totalUnits: number): BudgetLedger {
  let spent = 0;
  let held = 0;
  return {
    reserve(units) {
      if (spent + held + units > totalUnits) return false;
      held += units;
      return true;
    },
    settle(reserved, actual) {
      held -= reserved;
      spent += actual;
    },
    remaining() {
      return totalUnits - spent - held;
    },
  };
}
