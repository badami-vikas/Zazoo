import assert from "node:assert/strict";
import test from "node:test";
import { getRoutingDecisionDisplay } from "../src/app/lib/routing-decision-display.ts";

test("route decisions display their route", () => {
  assert.deepEqual(getRoutingDecisionDisplay({ kind: "route", route: "calendar.schedule" }), {
    kindLabel: "route",
    routeLabel: "calendar.schedule",
  });
});

test("clarify decisions display no route", () => {
  assert.deepEqual(getRoutingDecisionDisplay({ kind: "clarify" }), {
    kindLabel: "clarify",
    routeLabel: null,
  });
});

test("direct replies receive a human-readable label and display no route", () => {
  assert.deepEqual(getRoutingDecisionDisplay({ kind: "direct_reply" }), {
    kindLabel: "direct reply",
    routeLabel: null,
  });
});
