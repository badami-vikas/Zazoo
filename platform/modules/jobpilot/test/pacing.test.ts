import { test } from "node:test";
import assert from "node:assert/strict";
import { createPacingGate } from "../src/pacing.js";

test("createPacingGate: allows applications under both the daily and per-ATS-domain caps", () => {
  const gate = createPacingGate({ maxPerDay: 40, maxPerAtsDomainPerDay: 5 });
  assert.equal(gate.canApply("2026-07-04", "greenhouse.io"), true);
  gate.record("2026-07-04", "greenhouse.io");
  assert.equal(gate.countForDay("2026-07-04"), 1);
  assert.equal(gate.countForAtsDomain("2026-07-04", "greenhouse.io"), 1);
});

test("createPacingGate: blocks once the per-ATS-domain cap is hit, even with daily budget remaining", () => {
  const gate = createPacingGate({ maxPerDay: 40, maxPerAtsDomainPerDay: 2 });
  gate.record("2026-07-04", "lever.co");
  gate.record("2026-07-04", "lever.co");
  assert.equal(gate.canApply("2026-07-04", "lever.co"), false);
  assert.equal(gate.canApply("2026-07-04", "ashbyhq.com"), true); // different domain, unaffected
});

test("createPacingGate: blocks once the daily cap is hit, regardless of which ATS domain", () => {
  const gate = createPacingGate({ maxPerDay: 2, maxPerAtsDomainPerDay: 10 });
  gate.record("2026-07-04", "lever.co");
  gate.record("2026-07-04", "ashbyhq.com");
  assert.equal(gate.canApply("2026-07-04", "greenhouse.io"), false);
});

test("createPacingGate: caps reset on a new day — hitting a cap today never drops tomorrow's capacity", () => {
  const gate = createPacingGate({ maxPerDay: 1, maxPerAtsDomainPerDay: 1 });
  gate.record("2026-07-04", "lever.co");
  assert.equal(gate.canApply("2026-07-04", "lever.co"), false);
  assert.equal(gate.canApply("2026-07-05", "lever.co"), true);
});
