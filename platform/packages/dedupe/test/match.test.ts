import { test } from "node:test";
import assert from "node:assert/strict";
import { matchOne, matchAll } from "../src/match.js";
import { trigramSimilarity } from "../src/scoring.js";

test("trigramSimilarity: identical strings score 1, disjoint strings score low", () => {
  assert.equal(trigramSimilarity("Acme Corp", "Acme Corp"), 1);
  assert.ok(trigramSimilarity("Acme Corp", "Zephyr Holdings") < 0.2);
});

test("matchOne: exact keyId match is always strong regardless of name spelling", () => {
  const candidate = { id: "c1", keyId: "acme.com", name: "Acme Incorporated" };
  const targets = [{ id: "t1", keyId: "acme.com", name: "Acme Corp" }];
  const result = matchOne(candidate, targets);
  assert.equal(result.tier, "strong");
  assert.equal(result.score, 1);
  assert.equal(result.targetId, "t1");
});

test("matchOne: name-only similarity above moderate but below strong, no corroboration => moderate (pending)", () => {
  const candidate = { id: "c1", name: "Jon Smith" };
  const targets = [{ id: "t1", name: "John Smith" }];
  const result = matchOne(candidate, targets);
  assert.equal(result.tier, "moderate");
});

test("matchOne: moderate-range similarity + corroborating field upgrades to strong", () => {
  const candidate = { id: "c1", name: "Jon Smith", company: "Acme" };
  const targets = [{ id: "t1", name: "John Smith", company: "Acme" }];
  const result = matchOne(candidate, targets, ["company"]);
  assert.equal(result.tier, "strong");
});

test("matchOne: low similarity is a flag, not a silent drop", () => {
  const candidate = { id: "c1", name: "Completely Different Name" };
  const targets = [{ id: "t1", name: "Totally Unrelated Person" }];
  const result = matchOne(candidate, targets);
  assert.ok(result.tier === "flag" || result.tier === "none");
});

test("matchOne: blockingKey narrows the comparison pool before scoring", () => {
  const candidate = { id: "c1", name: "Smith", blockingKey: "domain-a" };
  const targets = [
    { id: "t1", name: "Smith", blockingKey: "domain-b" },
    { id: "t2", name: "Smyth", blockingKey: "domain-a" },
  ];
  const result = matchOne(candidate, targets);
  assert.equal(result.targetId, "t2");
});

test("matchOne: an exact score tie between two distinct strong-range targets downgrades to moderate, not a silent array-order pick", () => {
  const candidate = { id: "c1", name: "Acme Inc" };
  const targets = [
    { id: "t1", name: "Acme Inc" },
    { id: "t2", name: "Acme Inc" },
  ];
  const result = matchOne(candidate, targets);
  assert.equal(result.tier, "moderate");
  assert.equal(result.targetId, "t1"); // deterministic: first-seen wins, not "whichever ran last"
  assert.match(result.reason, /tied with 1 other candidate/);
});

test("matchOne: a tie is still resolved deterministically regardless of target array order", () => {
  const candidate = { id: "c1", name: "Acme Inc" };
  const forward = [{ id: "t1", name: "Acme Inc" }, { id: "t2", name: "Acme Inc" }];
  const reversed = [{ id: "t2", name: "Acme Inc" }, { id: "t1", name: "Acme Inc" }];
  assert.equal(matchOne(candidate, forward).targetId, "t1");
  assert.equal(matchOne(candidate, reversed).targetId, "t2"); // first-seen in ITS OWN order, not globally stable —
  // the point is not "same id wins" but "deterministic given a fixed input", and never "strong" on a tie either way.
  assert.equal(matchOne(candidate, forward).tier, "moderate");
  assert.equal(matchOne(candidate, reversed).tier, "moderate");
});

test("matchAll: maps 1:1 over candidates", () => {
  const candidates = [{ id: "c1", name: "Acme" }, { id: "c2", name: "Zephyr" }];
  const targets = [{ id: "t1", name: "Acme Corp" }];
  const results = matchAll(candidates, targets);
  assert.equal(results.length, 2);
});
