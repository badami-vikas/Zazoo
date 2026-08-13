import assert from "node:assert/strict";
import test from "node:test";
import { isGithubPullDisguisedAsIssue, reduceGithubReviewState } from "../src/domain.js";

test("isGithubPullDisguisedAsIssue filters PRs out of /issues listings", () => {
  assert.equal(isGithubPullDisguisedAsIssue({ pull_request: { url: "https://api.github.com/x" } }), true);
  assert.equal(isGithubPullDisguisedAsIssue({}), false);
  assert.equal(isGithubPullDisguisedAsIssue({ pull_request: null }), false);
  assert.equal(isGithubPullDisguisedAsIssue({ pull_request: undefined }), false);
});

test("reduceGithubReviewState picks the most recent decisive review", () => {
  assert.equal(reduceGithubReviewState([]), "pending");
  assert.equal(
    reduceGithubReviewState([
      { state: "COMMENTED", submittedAt: "2026-08-01T00:00:00Z" },
      { state: "APPROVED", submittedAt: "2026-08-02T00:00:00Z" },
    ]),
    "approved",
  );
  assert.equal(
    reduceGithubReviewState([
      { state: "APPROVED", submittedAt: "2026-08-01T00:00:00Z" },
      { state: "CHANGES_REQUESTED", submittedAt: "2026-08-02T00:00:00Z" },
    ]),
    "changes_requested",
  );
  assert.equal(reduceGithubReviewState([{ state: "DISMISSED", submittedAt: "2026-08-01T00:00:00Z" }]), "pending");
});
