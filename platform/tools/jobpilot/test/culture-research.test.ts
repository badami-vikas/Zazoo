import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CULTURE_SOURCE_CATALOG,
  classifyCultureSource,
  planCultureSources,
  partitionCultureEvidence,
  buildSourceDisclosure,
  assertNoFabricatedAffinityOrInsiderClaim,
  groundClaims,
  type CultureEvidence,
  type CultureSourceCandidate,
  type CultureResultRef,
  type GroundedClaimInput,
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

// ---------------------------------------------------------------------------
// TASK-011 remediation (2026-07-17 security review) — groundClaims
// ---------------------------------------------------------------------------

function cultureResult(overrides: Partial<CultureResultRef> & Pick<CultureResultRef, "sourceId" | "content" | "contentHash">): CultureResultRef {
  return {
    sourceType: "company_official_page",
    sourceLabel: "test_fixture source",
    sourceUrl: "https://example.com/test_fixture",
    retrievedAt: "2026-07-17T00:00:00.000Z",
    trustOrigin: "untrusted_external",
    expiresAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

test("groundClaims accepts a fact/opinion whose quote is a real substring of the correct result with a matching hash", () => {
  const results = new Map([
    ["src1", cultureResult({ sourceId: "src1", content: "Our culture is built on trust and collaboration.", contentHash: "hash-1" })],
  ]);
  const claims: GroundedClaimInput[] = [
    { id: "c1", claimType: "fact", sourceId: "src1", quote: "built on trust and collaboration", contentHash: "hash-1" },
  ];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.claimText, "built on trust and collaboration");
});

test("groundClaims rejects a quote that is absent from the result's real content", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "Our culture is built on trust.", contentHash: "hash-1" })]]);
  const claims: GroundedClaimInput[] = [
    { id: "c1", claimType: "fact", sourceId: "src1", quote: "we guarantee industry-leading pay", contentHash: "hash-1" },
  ];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0]?.reason, "quote-not-found-in-result");
});

test("groundClaims rejects a mutated/stale content hash even when the quote text matches", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "Our culture is built on trust.", contentHash: "real-hash-abc" })]]);
  const claims: GroundedClaimInput[] = [
    { id: "c1", claimType: "fact", sourceId: "src1", quote: "built on trust", contentHash: "stale-hash-xyz" },
  ];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0]?.reason, "content-hash-mismatch");
});

test("groundClaims rejects a fact/opinion claim citing an unknown/unfetched source", () => {
  const results = new Map<string, CultureResultRef>();
  const claims: GroundedClaimInput[] = [{ id: "c1", claimType: "fact", sourceId: "not-fetched", quote: "x", contentHash: "h" }];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0]?.reason, "unknown-source");
});

test("groundClaims rejects a missing quote on a fact/opinion claim", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "text", contentHash: "h" })]]);
  const claims: GroundedClaimInput[] = [{ id: "c1", claimType: "opinion", sourceId: "src1", contentHash: "h" }];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0]?.reason, "missing-quote");
});

test("groundClaims rejects duplicate claim ids within one batch", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "trust and collaboration", contentHash: "h" })]]);
  const claims: GroundedClaimInput[] = [
    { id: "dup", claimType: "fact", sourceId: "src1", quote: "trust", contentHash: "h" },
    { id: "dup", claimType: "fact", sourceId: "src1", quote: "collaboration", contentHash: "h" },
  ];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, false);
  assert.equal(result.failures.some((f) => f.reason === "duplicate-claim-id"), true);
});

test("groundClaims accepts a theme/inference referencing real supporting claims in the same batch", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "trust and collaboration", contentHash: "h" })]]);
  const claims: GroundedClaimInput[] = [
    { id: "fact1", claimType: "fact", sourceId: "src1", quote: "trust", contentHash: "h" },
    { id: "theme1", claimType: "theme", quote: "values-driven theme", supportingClaimIds: ["fact1"] },
  ];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.length, 2);
});

test("groundClaims rejects a theme/inference with an empty supporting set", () => {
  const result = groundClaims([{ id: "t1", claimType: "theme", quote: "x", supportingClaimIds: [] }], new Map());
  assert.equal(result.ok, false);
  assert.equal(result.failures[0]?.reason, "empty-supporting-set");
});

test("groundClaims rejects a theme that references a dangling (nonexistent) supporting claim id", () => {
  const result = groundClaims([{ id: "t1", claimType: "theme", quote: "x", supportingClaimIds: ["ghost"] }], new Map());
  assert.equal(result.ok, false);
  assert.equal(result.failures[0]?.reason, "dangling-reference");
});

test("groundClaims rejects a theme that self-references as its own support", () => {
  const result = groundClaims([{ id: "t1", claimType: "theme", quote: "x", supportingClaimIds: ["t1"] }], new Map());
  assert.equal(result.ok, false);
  assert.equal(result.failures[0]?.reason, "self-reference");
});

test("groundClaims accepts a contradiction referencing real claim ids and rejects a forged/dangling reference", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "great culture. also: toxic culture.", contentHash: "h" })]]);
  const claims: GroundedClaimInput[] = [
    { id: "a", claimType: "fact", sourceId: "src1", quote: "great culture", contentHash: "h" },
    { id: "b", claimType: "opinion", sourceId: "src1", quote: "toxic culture", contentHash: "h" },
    { id: "c1", claimType: "contradiction", quote: "these conflict", contradicts: ["a", "b"] },
  ];
  const ok = groundClaims(claims, results);
  assert.equal(ok.ok, true);

  // TASK-011 remediation (2026-07-19 RE-review, issue 10) — a contradiction
  // now requires at least TWO DISTINCT contradicted ids; both forged here,
  // so the "at least 2 real" gate is satisfied by count but both refs
  // dangle.
  const forged = groundClaims(
    [{ id: "c2", claimType: "contradiction", quote: "forged", contradicts: ["nonexistent-claim-1", "nonexistent-claim-2"] }],
    results,
  );
  assert.equal(forged.ok, false);
  assert.equal(forged.failures[0]?.reason, "dangling-reference");
});

test("groundClaims rejects a contradiction with fewer than TWO DISTINCT contradicted ids — a single (or a duplicated) reference has nothing to conflict with (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 10)", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "great culture.", contentHash: "h" })]]);
  const claims: GroundedClaimInput[] = [
    { id: "a", claimType: "fact", sourceId: "src1", quote: "great culture", contentHash: "h" },
    { id: "c1", claimType: "contradiction", quote: "x", contradicts: ["a"] },
  ];
  const single = groundClaims(claims, results);
  assert.equal(single.ok, false);
  assert.equal(single.failures[0]?.reason, "insufficient-contradiction-roots");

  // Padding with a DUPLICATE of the same id must not satisfy the minimum —
  // it is still only ONE distinct conflicting position.
  const duplicated = groundClaims(
    [
      { id: "a", claimType: "fact", sourceId: "src1", quote: "great culture", contentHash: "h" },
      { id: "c2", claimType: "contradiction", quote: "x", contradicts: ["a", "a"] },
    ],
    results,
  );
  assert.equal(duplicated.ok, false);
  assert.equal(duplicated.failures[0]?.reason, "insufficient-contradiction-roots");
});

test("groundClaims: duplicate supporting-claim ids do not satisfy the theme/inference minimum-support requirement by repetition alone (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 10)", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "great culture.", contentHash: "h" })]]);
  // A single real supporting claim, repeated, must be treated as exactly
  // ONE distinct supporting claim — it still grounds successfully (theme/
  // inference only requires >= 1 DISTINCT support), but the dedupe must
  // not let the caller "count" it twice in the rendered text.
  const claims: GroundedClaimInput[] = [
    { id: "a", claimType: "fact", sourceId: "src1", quote: "great culture", contentHash: "h" },
    { id: "t1", claimType: "theme", quote: "x", supportingClaimIds: ["a", "a", "a"] },
  ];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, true);
  const theme = result.evidence.find((e) => e.id === "t1")!;
  assert.match(theme.claimText, /Recurring theme across 1 supporting claim\(s\)/);
});

test("groundClaims: derived (theme/inference/contradiction) evidence carries a distinct provenance kind and a non-navigable sentinel URL, never a real CultureSourceType with an empty URL (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 10)", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "great culture. also: toxic culture.", contentHash: "h" })]]);
  const claims: GroundedClaimInput[] = [
    { id: "a", claimType: "fact", sourceId: "src1", quote: "great culture", contentHash: "h" },
    { id: "b", claimType: "opinion", sourceId: "src1", quote: "toxic culture", contentHash: "h" },
    { id: "t1", claimType: "theme", quote: "x", supportingClaimIds: ["a"] },
    { id: "c1", claimType: "contradiction", quote: "y", contradicts: ["a", "b"] },
  ];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, true);
  const theme = result.evidence.find((e) => e.id === "t1")!;
  const contradiction = result.evidence.find((e) => e.id === "c1")!;
  assert.equal(theme.sourceType, "internal_derived_synthesis");
  assert.notEqual(theme.sourceUrl, "");
  assert.equal(contradiction.sourceType, "internal_derived_synthesis");
  assert.notEqual(contradiction.sourceUrl, "");
});

test("groundClaims: authorContext is ALWAYS null on every produced evidence row, regardless of any caller-supplied value — never a fabrication vector for attributed quotes (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 11)", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "great culture.", contentHash: "h" })]]);
  const claims: GroundedClaimInput[] = [
    { id: "a", claimType: "fact", sourceId: "src1", quote: "great culture", contentHash: "h", authorContext: "Jane Doe, invented VP of HR" },
  ];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, true);
  assert.equal(result.evidence[0]!.authorContext, null);
});

// ---------------------------------------------------------------------------
// TASK-011 remediation (2026-07-18 coordinator final review, issue 2) — the
// reference graph among theme/inference/contradiction claims must be a DAG
// rooted in real result-grounded fact/opinion claims. A purely synthetic
// cyclic chain (never touching a fact/opinion) previously passed validation
// because the old checks only verified "the referenced id exists in this
// batch", not "the referenced id is itself grounded" or "there is no cycle".
// ---------------------------------------------------------------------------

test("groundClaims rejects a two-node cycle of theme claims that never touches a fact/opinion", () => {
  // theme1 supports theme2, theme2 supports theme1 — every id "exists" in
  // the batch (the OLD dangling-reference check alone would have accepted
  // this), but neither ever reaches a real fact/opinion.
  const claims: GroundedClaimInput[] = [
    { id: "theme1", claimType: "theme", quote: "x", supportingClaimIds: ["theme2"] },
    { id: "theme2", claimType: "theme", quote: "y", supportingClaimIds: ["theme1"] },
  ];
  const result = groundClaims(claims, new Map());
  assert.equal(result.ok, false);
  assert.ok(result.failures.every((f) => f.reason === "reference-cycle" || f.reason === "not-transitively-grounded"));
  assert.ok(result.failures.some((f) => f.claimId === "theme1"));
});

test("groundClaims rejects a longer (3-node) cycle among theme/inference claims", () => {
  const claims: GroundedClaimInput[] = [
    { id: "a", claimType: "theme", quote: "a", supportingClaimIds: ["b"] },
    { id: "b", claimType: "inference", quote: "b", supportingClaimIds: ["c"] },
    { id: "c", claimType: "theme", quote: "c", supportingClaimIds: ["a"] },
  ];
  const result = groundClaims(claims, new Map());
  assert.equal(result.ok, false);
  // Every claim in the cycle must be rejected (as either the cycle itself or
  // "not transitively grounded" — both are truthful for a claim on a cycle
  // that never reaches real evidence) — none may silently pass.
  assert.equal(result.failures.length, 3);
});

test("groundClaims accepts a DEEP (multi-hop) chain that eventually roots in a real fact — proves transitive rootedness is checked, not just direct references", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "trust and collaboration", contentHash: "h" })]]);
  const claims: GroundedClaimInput[] = [
    { id: "fact1", claimType: "fact", sourceId: "src1", quote: "trust", contentHash: "h" },
    { id: "theme1", claimType: "theme", quote: "t1", supportingClaimIds: ["fact1"] },
    { id: "theme2", claimType: "theme", quote: "t2", supportingClaimIds: ["theme1"] },
    { id: "inference1", claimType: "inference", quote: "i1", supportingClaimIds: ["theme2"] },
  ];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.length, 4);
});

test("groundClaims rejects a deep chain that never bottoms out in a real fact/opinion (every id exists, none is a root)", () => {
  const claims: GroundedClaimInput[] = [
    { id: "theme1", claimType: "theme", quote: "t1", supportingClaimIds: ["theme2"] },
    { id: "theme2", claimType: "theme", quote: "t2", supportingClaimIds: ["theme3"] },
    { id: "theme3", claimType: "theme", quote: "t3", supportingClaimIds: ["theme1"] }, // closes the cycle
  ];
  const result = groundClaims(claims, new Map());
  assert.equal(result.ok, false);
  assert.equal(result.evidence.length, 0);
});

test("groundClaims rejects a contradiction whose contradicted branch is itself ungrounded (a contradiction cannot borrow rootedness from a claim that has none)", () => {
  const results = new Map([["src1", cultureResult({ sourceId: "src1", content: "trust and collaboration", contentHash: "h" })]]);
  const claims: GroundedClaimInput[] = [
    { id: "fact1", claimType: "fact", sourceId: "src1", quote: "trust", contentHash: "h" },
    { id: "ungrounded-theme", claimType: "theme", quote: "floating", supportingClaimIds: ["also-ungrounded"] },
    { id: "also-ungrounded", claimType: "theme", quote: "floating2", supportingClaimIds: ["ungrounded-theme"] },
    { id: "c1", claimType: "contradiction", quote: "conflict", contradicts: ["fact1", "ungrounded-theme"] },
  ];
  const result = groundClaims(claims, results);
  assert.equal(result.ok, false);
  const c1Failure = result.failures.find((f) => f.claimId === "c1");
  assert.ok(c1Failure, "the contradiction referencing an ungrounded branch must itself fail");
});

test("groundClaims rejects an empty-result graph — theme/inference/contradiction claims with NO fact/opinion claims anywhere in the batch can never ground", () => {
  const claims: GroundedClaimInput[] = [
    { id: "theme1", claimType: "theme", quote: "t1", supportingClaimIds: ["theme2"] },
    { id: "theme2", claimType: "theme", quote: "t2", supportingClaimIds: ["theme1"] },
  ];
  const result = groundClaims(claims, new Map());
  assert.equal(result.ok, false);
  assert.equal(result.evidence.length, 0);
});


