import { test } from "node:test";
import assert from "node:assert/strict";
import { createFactStore } from "../src/store.js";

test("append: records a fact and it shows up in the entity's history", () => {
  const store = createFactStore();
  const fact = store.append({ entityId: "deal_1", field: "revenue", value: 500000, provenance: "listing", confidence: 0.6 });
  assert.equal(store.all("deal_1").length, 1);
  assert.equal(fact.supersededBy, undefined);
});

test("supersede: a correction marks the old fact superseded without deleting it", () => {
  const store = createFactStore();
  const original = store.append({ entityId: "deal_1", field: "revenue", value: 500000, provenance: "listing", confidence: 0.6 });
  const corrected = store.supersede({ entityId: "deal_1", field: "revenue", value: 480000, provenance: "document", confidence: 0.9 }, original.id);
  const history = store.all("deal_1");
  assert.equal(history.length, 2);
  assert.equal(history[0]?.supersededBy, corrected.id);
});

test("livingProfile: only the live (non-superseded) fact per field appears", () => {
  const store = createFactStore();
  const original = store.append({ entityId: "deal_1", field: "revenue", value: 500000, provenance: "listing", confidence: 0.6 });
  store.supersede({ entityId: "deal_1", field: "revenue", value: 480000, provenance: "document", confidence: 0.9 }, original.id);
  store.append({ entityId: "deal_1", field: "location", value: "Austin, TX", provenance: "public_record", confidence: 1 });

  const profile = store.livingProfile("deal_1");
  assert.equal(profile.revenue?.value, 480000);
  assert.equal(profile.location?.value, "Austin, TX");
  assert.equal(Object.keys(profile).length, 2);
});

test("livingProfile: higher-provenance fact wins a same-timestamp tie", () => {
  const store = createFactStore();
  const a = store.append({ entityId: "p1", field: "title", value: "Guessed Title", provenance: "ai_inferred", confidence: 0.3 });
  const b = store.append({ entityId: "p1", field: "title", value: "Confirmed Title", provenance: "public_record", confidence: 1 });
  // Force identical timestamps to exercise the tie-break path deterministically.
  b.recordedAt = a.recordedAt;
  const profile = store.livingProfile("p1");
  assert.equal(profile.title?.value, "Confirmed Title");
});
