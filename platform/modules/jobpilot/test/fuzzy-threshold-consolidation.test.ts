import { test } from "node:test";
import assert from "node:assert/strict";
import { FUZZY_MATCH_THRESHOLD } from "@bridge/dedupe";
import { FUZZY_THRESHOLD } from "../src/answer-bank.js";

// AnswerBank's fuzzy-match floor used to be a locally re-declared `const FUZZY_THRESHOLD = 0.9`
// that happened to match @bridge/dedupe's own threshold by coincidence, not by construction — two
// copies of "0.9" that could silently drift apart. It's now imported directly from @bridge/dedupe
// (FUZZY_MATCH_THRESHOLD), so this proves the two are the exact same value AND the same reference,
// not just two literals that currently agree.
test("AnswerBank's FUZZY_THRESHOLD is the same value/reference as @bridge/dedupe's FUZZY_MATCH_THRESHOLD", () => {
  assert.strictEqual(FUZZY_THRESHOLD, FUZZY_MATCH_THRESHOLD);
  assert.strictEqual(FUZZY_THRESHOLD, 0.9);
});
