import { test } from "node:test";
import assert from "node:assert/strict";
import { createFactStore } from "@bridge/facts";
import {
  projectSummary,
  projectProfile,
  projectDocuments,
  projectActivity,
} from "../src/projections.js";
import type { DealDocument } from "../src/projections.js";

// ─── projectSummary ───────────────────────────────────────────────────────────

test("projectSummary: empty FactStore returns isEmpty=true with no economics", () => {
  const facts = createFactStore();
  const result = projectSummary("deal_1", { stage: "sourced" }, facts);

  assert.equal(result.dealId, "deal_1");
  assert.equal(result.isEmpty, true);
  assert.equal(result.stage, "sourced");
  assert.equal(result.triage, undefined);
  assert.equal(result.thesisFitScore, undefined);
  assert.deepEqual(result.keyEconomics, {});
  assert.deepEqual(result.flags, []);
  assert.deepEqual(result.recentActivity, []);
});

test("projectSummary: populated FactStore returns real economics", () => {
  const facts = createFactStore();
  const base = { entityId: "deal_2", confidence: 0.9, provenance: "listing" as const };
  facts.append({ ...base, field: "askPrice", value: 1_000_000 });
  facts.append({ ...base, field: "sde", value: 200_000 });
  facts.append({ ...base, field: "revenue", value: 800_000 });

  const result = projectSummary("deal_2", { stage: "triage" }, facts);

  assert.equal(result.isEmpty, false);
  assert.equal(result.keyEconomics.askPrice, 1_000_000);
  assert.equal(result.keyEconomics.sde, 200_000);
  assert.equal(result.keyEconomics.revenue, 800_000);
  // impliedMultiple = 1_000_000 / 200_000 = 5
  assert.equal(result.keyEconomics.impliedMultiple, 5);
});

test("projectSummary: impliedMultiple is absent when sde is zero", () => {
  const facts = createFactStore();
  facts.append({ entityId: "deal_3", field: "askPrice", value: 500_000, confidence: 0.9, provenance: "listing" });
  facts.append({ entityId: "deal_3", field: "sde", value: 0, confidence: 0.9, provenance: "listing" });

  const result = projectSummary("deal_3", { stage: "triage" }, facts);
  assert.equal(result.keyEconomics.impliedMultiple, undefined);
});

test("projectSummary: reads triage and thesisFitScore from facts when present", () => {
  const facts = createFactStore();
  facts.append({ entityId: "deal_4", field: "triage", value: "green", confidence: 1, provenance: "ai_inferred" });
  facts.append({ entityId: "deal_4", field: "thesisFitScore", value: 0.85, confidence: 1, provenance: "ai_inferred" });

  const result = projectSummary("deal_4", { stage: "diligence" }, facts);
  assert.equal(result.triage, "green");
  assert.equal(result.thesisFitScore, 0.85);
});

test("projectSummary: reads P0 flags from flag:p0: prefixed facts", () => {
  const facts = createFactStore();
  facts.append({
    entityId: "deal_5",
    field: "flag:p0:0",
    value: { label: "Revenue too concentrated", source: "analysis" },
    confidence: 1,
    provenance: "user_entered",
  });

  const result = projectSummary("deal_5", { stage: "ic" }, facts);
  assert.equal(result.flags.length, 1);
  assert.equal(result.flags[0]!.severity, "p0");
  assert.equal(result.flags[0]!.label, "Revenue too concentrated");
  assert.equal(result.flags[0]!.source, "analysis");
});

test("projectSummary: recentActivity is capped at 5, newest first", () => {
  const facts = createFactStore();
  // Append 7 facts so activity has 7 events
  for (let i = 0; i < 7; i++) {
    facts.append({ entityId: "deal_6", field: `field_${i}`, value: i, confidence: 0.8, provenance: "listing" });
  }

  const result = projectSummary("deal_6", { stage: "triage" }, facts);
  assert.equal(result.recentActivity.length, 5);
  // newest-first: last-appended fact should come first in recentActivity
  assert.match(result.recentActivity[0]!.summary, /field_6/);
});

// ─── projectProfile ───────────────────────────────────────────────────────────

test("projectProfile: empty FactStore returns isEmpty=true with no profile fields", () => {
  const facts = createFactStore();
  const result = projectProfile("deal_p1", facts);

  assert.equal(result.dealId, "deal_p1");
  assert.equal(result.isEmpty, true);
  assert.equal(result.industry, undefined);
  assert.equal(result.geo, undefined);
});

test("projectProfile: returns real profile fields from FactStore", () => {
  const facts = createFactStore();
  const base = { entityId: "deal_p2", confidence: 0.9, provenance: "document" as const };
  facts.append({ ...base, field: "industry", value: "HVAC" });
  facts.append({ ...base, field: "geo", value: "Texas" });
  facts.append({ ...base, field: "legalName", value: "Acme HVAC LLC" });
  facts.append({ ...base, field: "foundedYear", value: 2005 });
  facts.append({ ...base, field: "employeeCount", value: 42 });
  facts.append({ ...base, field: "website", value: "https://acmehvac.com" });
  facts.append({ ...base, field: "description", value: "Full-service HVAC contractor" });

  const result = projectProfile("deal_p2", facts);

  assert.equal(result.isEmpty, false);
  assert.equal(result.industry, "HVAC");
  assert.equal(result.geo, "Texas");
  assert.equal(result.legalName, "Acme HVAC LLC");
  assert.equal(result.foundedYear, 2005);
  assert.equal(result.employeeCount, 42);
  assert.equal(result.website, "https://acmehvac.com");
  assert.equal(result.description, "Full-service HVAC contractor");
});

test("projectProfile: superseded facts are not surfaced", () => {
  const facts = createFactStore();
  const f1 = facts.append({ entityId: "deal_p3", field: "industry", value: "Auto", confidence: 0.8, provenance: "listing" });
  facts.supersede({ entityId: "deal_p3", field: "industry", value: "HVAC", confidence: 0.95, provenance: "document" }, f1.id);

  const result = projectProfile("deal_p3", facts);
  assert.equal(result.industry, "HVAC");
});

// ─── projectDocuments ─────────────────────────────────────────────────────────

test("projectDocuments: empty FactStore returns isEmpty=true and no documents", () => {
  const facts = createFactStore();
  const result = projectDocuments("deal_d1", facts);

  assert.equal(result.isEmpty, true);
  assert.deepEqual(result.documents, []);
});

test("projectDocuments: doc: facts surface as DealDocument entries", () => {
  const facts = createFactStore();
  const cim: Omit<DealDocument, "id"> = {
    kind: "cim",
    title: "Acme HVAC CIM v1",
    status: "received",
    receivedAt: "2026-07-01T00:00:00Z",
    source: "broker@example.com",
  };
  facts.append({ entityId: "deal_d2", field: "doc:cim:0", value: cim, confidence: 1, provenance: "email" });

  const result = projectDocuments("deal_d2", facts);

  assert.equal(result.isEmpty, false);
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0]!.kind, "cim");
  assert.equal(result.documents[0]!.title, "Acme HVAC CIM v1");
  assert.equal(result.documents[0]!.status, "received");
  assert.ok(result.documents[0]!.id, "fact id should be present");
});

test("projectDocuments: multiple doc kinds surface independently", () => {
  const facts = createFactStore();
  const make = (kind: string, title: string): Omit<DealDocument, "id"> => ({
    kind: kind as DealDocument["kind"],
    title,
    status: "received",
  });
  facts.append({ entityId: "deal_d3", field: "doc:cim:0", value: make("cim", "CIM"), confidence: 1, provenance: "email" });
  facts.append({ entityId: "deal_d3", field: "doc:nda:0", value: make("nda", "NDA"), confidence: 1, provenance: "email" });
  facts.append({ entityId: "deal_d3", field: "doc:financials:0", value: make("financials", "Financials"), confidence: 1, provenance: "document" });

  const result = projectDocuments("deal_d3", facts);

  assert.equal(result.documents.length, 3);
  const kinds = result.documents.map((d) => d.kind).sort();
  assert.deepEqual(kinds, ["cim", "financials", "nda"]);
});

// ─── projectActivity ──────────────────────────────────────────────────────────

test("projectActivity: empty FactStore returns isEmpty=true and no events", () => {
  const facts = createFactStore();
  const result = projectActivity("deal_a1", facts);

  assert.equal(result.isEmpty, true);
  assert.deepEqual(result.events, []);
});

test("projectActivity: events are returned oldest-first", () => {
  const facts = createFactStore();
  facts.append({ entityId: "deal_a2", field: "industry", value: "HVAC", confidence: 0.9, provenance: "listing" });
  facts.append({ entityId: "deal_a2", field: "revenue", value: 500_000, confidence: 0.9, provenance: "listing" });
  facts.append({ entityId: "deal_a2", field: "sde", value: 150_000, confidence: 0.9, provenance: "document" });

  const result = projectActivity("deal_a2", facts);

  assert.equal(result.isEmpty, false);
  assert.equal(result.events.length, 3);
  // Verify chronological order (oldest first)
  for (let i = 1; i < result.events.length; i++) {
    const prev = result.events[i - 1]!.occurredAt;
    const curr = result.events[i]!.occurredAt;
    assert.ok(prev <= curr, `event ${i - 1} should be at or before event ${i}`);
  }
});

test("projectActivity: user_entered provenance maps to 'human' actor", () => {
  const facts = createFactStore();
  facts.append({ entityId: "deal_a3", field: "legalName", value: "Acme LLC", confidence: 1, provenance: "user_entered" });

  const result = projectActivity("deal_a3", facts);

  assert.equal(result.events[0]!.actor, "human");
});

test("projectActivity: ai_inferred provenance maps to 'agent' actor", () => {
  const facts = createFactStore();
  facts.append({ entityId: "deal_a4", field: "thesisFitScore", value: 0.8, confidence: 0.9, provenance: "ai_inferred" });

  const result = projectActivity("deal_a4", facts);

  assert.equal(result.events[0]!.actor, "agent");
});

test("projectActivity: listing/document/email provenances map to 'system' actor", () => {
  const facts = createFactStore();
  facts.append({ entityId: "deal_a5", field: "revenue", value: 500_000, confidence: 0.9, provenance: "listing" });
  facts.append({ entityId: "deal_a5", field: "sde", value: 100_000, confidence: 0.95, provenance: "document" });
  facts.append({ entityId: "deal_a5", field: "geo", value: "Texas", confidence: 0.8, provenance: "email" });

  const result = projectActivity("deal_a5", facts);

  assert.ok(result.events.every((e) => e.actor === "system"), "all system-provenance events should have actor='system'");
});

test("projectActivity: each event carries fact metadata", () => {
  const facts = createFactStore();
  facts.append({ entityId: "deal_a6", field: "revenue", value: 400_000, confidence: 0.85, provenance: "listing" });

  const result = projectActivity("deal_a6", facts);
  const event = result.events[0]!;

  assert.equal(event.kind, "fact_recorded");
  assert.match(event.summary, /revenue/);
  assert.equal(event.metadata?.["field"], "revenue");
  assert.equal(event.metadata?.["confidence"], 0.85);
});
