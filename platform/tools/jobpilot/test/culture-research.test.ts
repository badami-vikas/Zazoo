import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CULTURE_SOURCE_CATALOG,
  classifyCultureSource,
  planCultureSources,
  partitionCultureEvidence,
  buildSourceDisclosure,
  assertNoFabricatedAffinityOrInsiderClaim,
  type CultureEvidence,
  type CultureSourceCandidate,
} from "../src/culture-research.js";

test("all 5 BRD-named source types are classified, matching AP-008 reuse-intake findings", () => {
  assert.equal(CULTURE_SOURCE_CATALOG.company_official_page.eligibility, "permitted");
  assert.equal(CULTURE_SOURCE_CATALOG.public_blog_or_press.eligibility, "permitted");
  assert.equal(CULTURE_SOURCE_CATALOG.reddit.eligibility, "research_only");
  assert.equal(CULTURE_SOURCE_CATALOG.google_reviews.eligibility, "not_yet_integrated");
  assert.equal(CULTURE_SOURCE_CATALOG.glassdoor.eligibility, "do_not_use");
  // Every non-permitted classification must carry a non-empty reason — "skipped or stop for
  // user/counsel permission" (JP3B exit) requires an ANSWERED question, never a silent gap.
  for (const entry of Object.values(CULTURE_SOURCE_CATALOG)) {
    if (entry.eligibility !== "permitted") assert.ok(entry.reason.length > 20, `${entry.sourceType} needs a real reason`);
  }
});

test("classifyCultureSource returns the catalog entry for a given type", () => {
  assert.equal(classifyCultureSource("glassdoor").eligibility, "do_not_use");
});

test("planCultureSources separates permitted from skipped with zero mutation of input order", () => {
  const candidates: CultureSourceCandidate[] = [
    { sourceType: "company_official_page", sourceLabel: "BCG Careers", url: "https://careers.bcg.com/global/en/interview-process" },
    { sourceType: "glassdoor", sourceLabel: "Glassdoor — BCG reviews", url: "https://www.glassdoor.com/Reviews/BCG-Reviews" },
    { sourceType: "reddit", sourceLabel: "r/consulting BCG thread", url: "https://reddit.com/r/consulting" },
    { sourceType: "google_reviews", sourceLabel: "Google reviews — BCG", url: "https://maps.google.com/?cid=bcg" },
  ];
  const plan = planCultureSources(candidates);
  assert.equal(plan.permitted.length, 1);
  assert.equal(plan.permitted[0]?.sourceType, "company_official_page");
  assert.equal(plan.skipped.length, 3);
  assert.deepEqual(
    plan.skipped.map((s) => s.sourceType).sort(),
    ["glassdoor", "google_reviews", "reddit"],
  );
  for (const skipped of plan.skipped) {
    assert.ok(skipped.reason.length > 0, `${skipped.sourceType} must carry a reason`);
  }
});

function evidence(overrides: Partial<CultureEvidence> & Pick<CultureEvidence, "id" | "claimType" | "claimText">): CultureEvidence {
  return {
    sourceLabel: "test_fixture source",
    sourceUrl: "https://example.com/test_fixture",
    sourceType: "company_official_page",
    retrievedAt: "2026-07-17T00:00:00.000Z",
    authorContext: null,
    agentInference: false,
    ...overrides,
  };
}

test("partitionCultureEvidence groups by claimType, including honest empty buckets", () => {
  const partition = partitionCultureEvidence([
    evidence({ id: "f1", claimType: "fact", claimText: "BCG's official page states X" }),
    evidence({ id: "o1", claimType: "opinion", claimText: "A named consultant said Y", authorContext: "Consultant, London" }),
    evidence({ id: "t1", claimType: "theme", claimText: "Values-driven culture is a repeated theme" }),
  ]);
  assert.equal(partition.facts.length, 1);
  assert.equal(partition.opinions.length, 1);
  assert.equal(partition.themes.length, 1);
  assert.equal(partition.contradictions.length, 0); // honest empty — no fabricated filler row
  assert.equal(partition.inferences.length, 0);
});

test("partitionCultureEvidence rejects an inference row not flagged agentInference (and vice versa)", () => {
  assert.throws(() => partitionCultureEvidence([evidence({ id: "bad1", claimType: "inference", claimText: "x" })]), /agentInference is false/);
  assert.throws(
    () => partitionCultureEvidence([evidence({ id: "bad2", claimType: "fact", claimText: "x", agentInference: true })]),
    /not typed "inference"/,
  );
});

test("partitionCultureEvidence keeps a contradiction's cross-references intact", () => {
  const partition = partitionCultureEvidence([
    evidence({ id: "c1", claimType: "contradiction", claimText: "One review disputes the other", contradicts: ["f1", "o1"] }),
  ]);
  assert.deepEqual(partition.contradictions[0]?.contradicts, ["f1", "o1"]);
});

test("buildSourceDisclosure lists used sources deduped + every skipped source with its reason", () => {
  const used = [
    evidence({ id: "f1", claimType: "fact", claimText: "a" }),
    evidence({ id: "f2", claimType: "fact", claimText: "b" }), // same source — should dedupe
  ];
  const disclosure = buildSourceDisclosure(used, [
    { sourceType: "glassdoor", sourceLabel: "Glassdoor — BCG", url: "https://glassdoor.com/x", eligibility: "do_not_use", reason: "ToS prohibits scraping" },
  ]);
  assert.equal(disclosure.used.length, 1);
  assert.equal(disclosure.skipped.length, 1);
  assert.equal(disclosure.skipped[0]?.reason, "ToS prohibits scraping");
});

test("assertNoFabricatedAffinityOrInsiderClaim passes clean generated text", () => {
  const result = assertNoFabricatedAffinityOrInsiderClaim(
    "Based on BCG's official evaluation dimensions and public interview guidance, prepare behavioral stories aligned to Integrity and Drive.",
  );
  assert.equal(result.clean, true);
  assert.deepEqual(result.violations, []);
});

test("assertNoFabricatedAffinityOrInsiderClaim flags an invented insider claim", () => {
  const result = assertNoFabricatedAffinityOrInsiderClaim(
    "I personally know a friend at BCG who gave me insider information about the interviewers.",
  );
  assert.equal(result.clean, false);
  assert.ok(result.violations.length >= 1);
});

test("assertNoFabricatedAffinityOrInsiderClaim flags a guaranteed-outcome claim", () => {
  const result = assertNoFabricatedAffinityOrInsiderClaim("Follow this and I guarantee you'll get the job.");
  assert.equal(result.clean, false);
});
