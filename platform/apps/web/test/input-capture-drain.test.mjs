/**
 * K11 (TASK-054) — the input drain's decision layer.
 *
 * The drain loop is the third of three independent refusals in this lane
 * (Rust accumulator → drain → server re-distillation), and it is the easiest
 * place to accidentally launder a payload: a loop that simply fetched
 * whatever `raw_id` pointed at would post a secure field's text verbatim the
 * moment a producer bug attached one. `planInputBurstReport` is the pure
 * extraction of that decision, so the property is testable without a shell.
 *
 * The load-bearing assertion is `rawId === null` for every role that is not
 * `content_ok` — a null handle means the text is never even REQUESTED from
 * the local ring, not merely discarded after fetching.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { planInputBurstReport } from "../src/app/lib/input-capture-plan.ts";

const base = {
  kind: "input",
  app_name: "Editor",
  bundle_id: "com.example.editor",
  field_role: "content_ok",
  key_count: 9,
  started_at_ms: 1_760_000_000_000,
  raw_id: 7,
};

test("a content_ok burst with a raw handle is the ONLY case that fetches text", () => {
  const plan = planInputBurstReport(base);
  assert.ok(plan);
  assert.equal(plan.rawId, 7);
  assert.equal(plan.report.fieldRole, "content_ok");
  assert.equal(plan.report.appName, "Editor");
  assert.equal(plan.report.appBundleId, "com.example.editor");
  assert.equal(plan.report.keyCount, 9);
  // `text` is structurally absent from the planner's output — it can only be
  // filled by a caller that first saw a non-null rawId.
  assert.equal("text" in plan.report, false);
});

test("a secure field NEVER yields a raw handle — even when one is attached", () => {
  // The producer should never attach a payload to a secure burst. This
  // asserts the drain does not TRUST that: `raw_id: 7` is present and
  // deliberately ignored because the role does not positively allow content.
  const plan = planInputBurstReport({ ...base, field_role: "secure" });
  assert.ok(plan);
  assert.equal(plan.rawId, null);
  // Still reported — the API records a no-content marker, which is how the
  // lane stays honest that typing happened without saying what was typed.
  assert.equal(plan.report.fieldRole, "secure");
});

test("an undeterminable field fails closed the same way — unknown is sensitive", () => {
  const plan = planInputBurstReport({ ...base, field_role: "undeterminable" });
  assert.ok(plan);
  assert.equal(plan.rawId, null);
  assert.equal(plan.report.fieldRole, "undeterminable");
});

test("the role gate is an opt-in allowlist: an unrecognised role is not reported at all", () => {
  // Mirrors core's CONTENT_ALLOWED_ROLES shape. A role this build does not
  // know about must not be coerced into one it does — the wire schema would
  // reject it, and inventing a value would be the shell asserting something
  // the producer declined to assert.
  for (const role of ["password", "CONTENT_OK", "", "rich_text"]) {
    assert.equal(planInputBurstReport({ ...base, field_role: role }), null, `role: ${role}`);
  }
});

test("a content_ok burst with NO raw handle reports no text rather than being dropped", () => {
  // The ring is bounded and evicts. Losing the payload must not lose the
  // signal that typing happened — that fact is true and consented.
  const { raw_id: _dropped, ...noHandle } = base;
  const plan = planInputBurstReport(noHandle);
  assert.ok(plan);
  assert.equal(plan.rawId, null);
  assert.equal(plan.report.fieldRole, "content_ok");
});

test("non-input observations and malformed identity fields are skipped", () => {
  assert.equal(planInputBurstReport({ ...base, kind: "apps" }), null);
  assert.equal(planInputBurstReport({ ...base, kind: undefined }), null);
  assert.equal(planInputBurstReport({ ...base, app_name: undefined }), null);
  assert.equal(planInputBurstReport({ ...base, bundle_id: 42 }), null);
  assert.equal(planInputBurstReport({ ...base, field_role: undefined }), null);
});

test("typedAt is when typing STARTED, not when the burst flushed", () => {
  // A burst ends on an idle timeout, so using the flush time would place
  // every burst seconds after the fact and skew the time-of-day bucket the
  // rhythm lane groups on.
  const plan = planInputBurstReport(base, () => 9_999_999_999_999);
  assert.ok(plan);
  assert.equal(plan.report.typedAt, new Date(1_760_000_000_000).toISOString());

  // Only a producer that failed to report a start time falls back to now.
  const { started_at_ms: _missing, ...noStart } = base;
  const fallback = planInputBurstReport(noStart, () => 1_700_000_000_000);
  assert.ok(fallback);
  assert.equal(fallback.report.typedAt, new Date(1_700_000_000_000).toISOString());
});

test("host rides along only when the producer reported one", () => {
  assert.equal("host" in planInputBurstReport(base).report, false);
  assert.equal(planInputBurstReport({ ...base, host: "example.com" }).report.host, "example.com");
  // Not repaired into "" — an absent host is a different fact from an empty
  // one, and the denylist's domain matching depends on the difference.
  assert.equal("host" in planInputBurstReport({ ...base, host: 42 }).report, false);
});
