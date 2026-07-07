import { test } from "node:test";
import assert from "node:assert/strict";

import { routeHelpRequest, draftHelpOffer, type HelpResponderCandidate } from "../src/index.js";

const candidates: HelpResponderCandidate[] = [
  { personId: "test_fixture_p1", displayName: "test_fixture_responder_one", topics: ["postgres tuning", "database migrations"] },
  { personId: "test_fixture_p2", displayName: "test_fixture_responder_two", topics: ["react performance"] },
  { personId: "test_fixture_p3", displayName: "test_fixture_responder_three", topics: [] },
];

test("routeHelpRequest: ranks the topic-overlapping responder first", () => {
  const routes = routeHelpRequest(
    { subject: "postgres migrations failing", body: "our database migrations hang on deploy" },
    candidates,
  );
  assert.equal(routes[0]?.personId, "test_fixture_p1");
  assert.ok(routes[0]!.score > 0);
  assert.ok(routes[0]!.matchedTopics.includes("database migrations"));
});

test("routeHelpRequest: zero-match candidates are excluded, not fabricated", () => {
  const routes = routeHelpRequest({ subject: "postgres help", body: "database is slow" }, candidates);
  assert.equal(routes.some((r) => r.personId === "test_fixture_p3"), false);
  assert.equal(routes.some((r) => r.personId === "test_fixture_p2"), false);
});

test("routeHelpRequest: an unmatched request returns an honest empty list", () => {
  const routes = routeHelpRequest({ subject: "zzz", body: "qqq" }, candidates);
  assert.deepEqual(routes, []);
});

test("routeHelpRequest: deterministic ordering with personId tiebreak", () => {
  const tied: HelpResponderCandidate[] = [
    { personId: "test_fixture_b", displayName: "b", topics: ["kubernetes"] },
    { personId: "test_fixture_a", displayName: "a", topics: ["kubernetes"] },
  ];
  const routes = routeHelpRequest({ subject: "kubernetes crash", body: "" }, tied);
  assert.deepEqual(routes.map((r) => r.personId), ["test_fixture_a", "test_fixture_b"]);
});

test("routeHelpRequest: respects the limit", () => {
  const many: HelpResponderCandidate[] = Array.from({ length: 5 }, (_, i) => ({
    personId: `test_fixture_p${i}`,
    displayName: `test_fixture_${i}`,
    topics: ["testing"],
  }));
  const routes = routeHelpRequest({ subject: "testing question", body: "" }, many, 2);
  assert.equal(routes.length, 2);
});

test("draftHelpOffer: produces a proposal-inputs shape, rejects empty body", () => {
  const routes = routeHelpRequest({ subject: "postgres help", body: "database migrations" }, candidates);
  const draft = draftHelpOffer({ subject: "postgres help", body: "database migrations" }, routes[0]!, "Try the staged runner.");
  assert.equal(draft.kind, "help_offer");
  assert.equal(draft.routedTo, "test_fixture_p1");
  assert.throws(() => draftHelpOffer({ subject: "s", body: "b" }, routes[0]!, "   "), /non-empty/);
});
