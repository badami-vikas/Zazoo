import { strict as assert } from "node:assert";
import { test } from "node:test";
import { selectPostings, isFullTime } from "../src/sweep.js";
import type { FetchedPosting } from "../src/fetchers.js";
import type { CandidateProfile } from "../src/types.js";

const candidate: CandidateProfile = { categories: ["Consulting", "Operations"], skills: [] };
const p = (title: string, url?: string): FetchedPosting => ({ company: "Acme", title, ...(url ? { url } : {}) });

test("keeps postings matching a target category and drops the rest", () => {
  const r = selectPostings(
    [p("Operations Manager", "u1"), p("Senior Backend Engineer", "u2"), p("Consulting Associate", "u3")],
    candidate,
    new Set(),
  );
  assert.equal(r.fetched, 3);
  assert.equal(r.rejected, 1);
  assert.deepEqual(r.keep.map((k) => k.posting.title).sort(), ["Consulting Associate", "Operations Manager"]);
});

test("already-stored urls are skipped, not re-proposed", () => {
  // The repeat-sweep guard. Without it a 6-hourly source re-proposes every
  // posting on the board on every single run.
  const r = selectPostings([p("Operations Manager", "u1")], candidate, new Set(["u1"]));
  assert.equal(r.duplicates, 1);
  assert.equal(r.keep.length, 0);
});

test("a url repeated within one run counts once", () => {
  const r = selectPostings([p("Operations Manager", "u1"), p("Operations Manager", "u1")], candidate, new Set());
  assert.equal(r.keep.length, 1);
  assert.equal(r.duplicates, 1);
});

test("postings with no url still pass through", () => {
  const r = selectPostings([p("Operations Lead")], candidate, new Set());
  assert.equal(r.keep.length, 1);
});

test("results are ordered best fit first", () => {
  const located: CandidateProfile = { categories: ["Operations"], skills: [], locations: ["Remote"] };
  const weak: FetchedPosting = { company: "A", title: "Operations Manager", location: "Tokyo", url: "w" };
  const strong: FetchedPosting = { company: "A", title: "Operations Manager", isRemote: true, url: "s" };
  const r = selectPostings([weak, strong], located, new Set());
  assert.equal(r.keep[0]?.posting.url, "s");
  assert.ok(r.keep[0]!.fit.score > r.keep[1]!.fit.score);
});

test("internships and contract roles are dropped even when they score perfectly", () => {
  // A live sweep ranked "Product Management Intern (Summer 2027)" at 1.00 against
  // a second-year MBA profile. Scoring alone cannot catch this — the feeds carry
  // no employment-type field, so the title is the only signal.
  const r = selectPostings(
    [p("Product Management Intern (Summer 2027)", "i1"), p("Operations Co-op", "i2"), p("Consulting Manager", "k1")],
    candidate,
    new Set(),
  );
  assert.equal(r.notFullTime, 2);
  assert.deepEqual(r.keep.map((k) => k.posting.title), ["Consulting Manager"]);
});

test("isFullTime keeps roles whose titles merely contain the letters", () => {
  assert.equal(isFullTime("Internal Audit Manager"), true); // "Intern" inside "Internal"
  assert.equal(isFullTime("International Operations Lead"), true);
  assert.equal(isFullTime("Summer Intern, Strategy"), false);
  assert.equal(isFullTime("Part-time Analyst"), false);
});
