import { test } from "node:test";
import assert from "node:assert/strict";

import {
  draftHelpOffer,
  routeHelpRequest,
  type HelpResponderCandidate,
} from "../src/relationship-help-routing.js";

const candidates: HelpResponderCandidate[] = [
  { personId: "test_fixture_p1", displayName: "test_fixture_responder_one", topics: ["postgres tuning", "database migrations"] },
  { personId: "test_fixture_p2", displayName: "test_fixture_responder_two", topics: ["react performance"] },
  { personId: "test_fixture_p3", displayName: "test_fixture_responder_three", topics: [] },
];

test("Relationship Help Request routing ranks evidenced responders", () => {
  const routes = routeHelpRequest(
    { subject: "postgres migrations failing", body: "our database migrations hang on deploy" },
    candidates,
  );
  assert.equal(routes[0]?.personId, "test_fixture_p1");
  assert.ok(routes[0]!.score > 0);
  assert.ok(routes[0]!.matchedTopics.includes("database migrations"));
});

test("Relationship Help Request routing returns honest empty results", () => {
  assert.deepEqual(routeHelpRequest({ subject: "zzz", body: "qqq" }, candidates), []);
  const matched = routeHelpRequest({ subject: "postgres help", body: "database is slow" }, candidates);
  assert.equal(matched.some((route) => route.personId === "test_fixture_p2"), false);
  assert.equal(matched.some((route) => route.personId === "test_fixture_p3"), false);
});

test("Relationship Help Request routing is deterministic and bounded", () => {
  const tied: HelpResponderCandidate[] = [
    { personId: "test_fixture_b", displayName: "b", topics: ["kubernetes"] },
    { personId: "test_fixture_a", displayName: "a", topics: ["kubernetes"] },
    { personId: "test_fixture_c", displayName: "c", topics: ["kubernetes"] },
  ];
  const routes = routeHelpRequest({ subject: "kubernetes crash", body: "" }, tied, 2);
  assert.deepEqual(routes.map((route) => route.personId), ["test_fixture_a", "test_fixture_b"]);
});

test("Relationship Help Request routing deduplicates evidence topics", () => {
  const [route] = routeHelpRequest(
    { subject: "database migration help", body: "" },
    [{ personId: "test_fixture_p1", displayName: "one", topics: ["database", "database", "database"] }],
  );
  assert.ok(route);
  assert.equal(route.score, 1 / 3);
  assert.deepEqual(route.matchedTopics, ["database"]);
});

test("Relationship Help Offer drafting stays proposal-only", () => {
  const [route] = routeHelpRequest(
    { subject: "postgres help", body: "database migrations" },
    candidates,
  );
  assert.ok(route);
  const draft = draftHelpOffer(
    { subject: "postgres help", body: "database migrations" },
    route,
    "Try the staged runner.",
  );
  assert.equal(draft.kind, "help_offer");
  assert.equal(draft.routedTo, "test_fixture_p1");
  assert.equal(draft.routeEvidence.topicSource, "caller_supplied");
  assert.throws(
    () => draftHelpOffer({ subject: "s", body: "b" }, route, "   "),
    /non-empty/,
  );
});
