import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnswerBank, normalizeQuestion, NeedsHuman } from "../src/answer-bank.js";

test("createAnswerBank: exact normalized match resolves directly", () => {
  const bank = createAnswerBank([{ questionNorm: normalizeQuestion("Are you authorized to work in the US?"), questionRaw: "Are you authorized to work in the US?", answer: "Yes", source: "config" }]);
  const answer = bank.resolve("are you authorized to work in the US");
  assert.equal(answer.answer, "Yes");
});

test("createAnswerBank: fuzzy match above threshold resolves to the closest known question", () => {
  const bank = createAnswerBank([{ questionNorm: normalizeQuestion("What is your expected salary"), questionRaw: "What is your expected salary?", answer: "$150,000", source: "human" }]);
  const answer = bank.resolve("What is your expected salary range?");
  assert.equal(answer.answer, "$150,000");
});

test("createAnswerBank: sensitive questions (SSN, payment) always raise NeedsHuman regardless of bank contents", () => {
  const bank = createAnswerBank([{ questionNorm: normalizeQuestion("What is your social security number"), questionRaw: "What is your social security number?", answer: "never-store-this", source: "human" }]);
  assert.throws(() => bank.resolve("What is your social security number?"), NeedsHuman);
});

test("createAnswerBank: unknown question with no fuzzy match raises NeedsHuman", () => {
  const bank = createAnswerBank();
  assert.throws(() => bank.resolve("Why do you want to work here?"), NeedsHuman);
});

test("createAnswerBank: record() persists a new answer that resolve() can then find", () => {
  const bank = createAnswerBank();
  bank.record({ questionNorm: normalizeQuestion("Do you require visa sponsorship"), questionRaw: "Do you require visa sponsorship?", answer: "No", source: "human" });
  const answer = bank.resolve("Do you require visa sponsorship?");
  assert.equal(answer.answer, "No");
});
