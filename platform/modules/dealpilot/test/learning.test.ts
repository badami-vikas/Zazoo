/** DealPilot learning binding — pure mapping contract: a triage decision plus
 * a DealProfile become a generic observed signal carrying only generalizable
 * facets (industry, geo, SDE band, source), never free text as attributes. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { dealDecisionSignal, sdeBand } from "../src/learning.js";

test("sdeBand buckets deterministically and rejects invalid input", () => {
  assert.equal(sdeBand(100_000), "sde_lt_250k");
  assert.equal(sdeBand(250_000), "sde_250k_500k");
  assert.equal(sdeBand(750_000), "sde_500k_1m");
  assert.equal(sdeBand(2_000_000), "sde_gte_1m");
  assert.equal(sdeBand(null), null);
  assert.equal(sdeBand(undefined), null);
  assert.equal(sdeBand(-1), null);
  assert.equal(sdeBand(Number.NaN), null);
});

test("dealDecisionSignal maps a dismissal to generalizable attributes only", () => {
  const signal = dealDecisionSignal({
    id: "sig-1",
    organizationId: "org-1",
    ownerUserId: "user-1",
    dealRecordId: "deal-42",
    action: "dismiss",
    profile: { industry: "Restaurants", geo: "Texas", sde: 300_000, ownerNotes: "too greasy" },
    sourceId: "source-bizmarket",
    reason: "no interest in food service",
  });
  assert.equal(signal.moduleId, "dealpilot");
  assert.equal(signal.recordKind, "deal");
  assert.equal(signal.recordId, "deal-42");
  assert.equal(signal.action, "dismiss");
  assert.deepEqual(signal.attributes, {
    industry: "restaurants",
    geo: "texas",
    sde_band: "sde_250k_500k",
    source: "source-bizmarket",
  });
  // Free text rides as `reason` (data), never as a pattern attribute.
  assert.equal(signal.reason, "no interest in food service");
  assert.equal("ownerNotes" in signal.attributes, false);
});

test("missing profile facets are simply omitted (honest empty, no placeholders)", () => {
  const signal = dealDecisionSignal({
    id: "sig-2",
    organizationId: "org-1",
    ownerUserId: "user-1",
    dealRecordId: "deal-7",
    action: "pursue",
    profile: {},
  });
  assert.deepEqual(signal.attributes, {});
  assert.equal(signal.reason, undefined);
});
