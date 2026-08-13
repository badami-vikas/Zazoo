import assert from "node:assert/strict";
import test from "node:test";
import { mapGithubIssue, mapGithubPull, mapGithubRepo } from "../src/intake.js";
import { REPO_FIXTURES } from "./fixtures/repos.js";
import { PULL_FIXTURES } from "./fixtures/pulls.js";
import { ISSUE_FIXTURES } from "./fixtures/issues.js";

test("mapGithubRepo maps every DevPilot Table column", () => {
  const [repo] = REPO_FIXTURES;
  const mapped = mapGithubRepo(repo!);
  assert.deepEqual(mapped, {
    sourceId: "1001",
    fullName: "octocat/bridge-demo",
    private: false,
    defaultBranch: "main",
    archived: false,
    pushedAt: "2026-08-10T12:00:00Z",
    url: "https://github.com/octocat/bridge-demo",
  });
});

test("mapGithubPull derives merged/open/closed state and folds in review state", () => {
  const [open, draft, merged] = PULL_FIXTURES;

  const mappedOpen = mapGithubPull(open!, "octocat/bridge-demo", [
    { state: "APPROVED", submitted_at: "2026-08-12T09:00:00Z" },
  ]);
  assert.equal(mappedOpen.state, "open");
  assert.equal(mappedOpen.reviewState, "approved");
  assert.equal(mappedOpen.author, "octocat");
  assert.equal(mappedOpen.additions, 120);

  const mappedDraft = mapGithubPull(draft!, "octocat/bridge-demo", []);
  assert.equal(mappedDraft.isDraft, true);
  assert.equal(mappedDraft.reviewState, "pending");

  const mappedMerged = mapGithubPull(merged!, "octocat/bridge-demo", []);
  assert.equal(mappedMerged.state, "merged", "merged_at set means merged, regardless of state:closed");
});

test("mapGithubIssue maps a real Issue and filters out a PR disguised as one", () => {
  const [realIssue, prAsIssue] = ISSUE_FIXTURES;

  const mapped = mapGithubIssue(realIssue!, "octocat/bridge-demo");
  assert.ok(mapped);
  assert.equal(mapped.number, 12);
  assert.deepEqual(mapped.labels, ["bug", "priority:high"]);
  assert.equal(mapped.assignee, "octocat");

  assert.equal(
    mapGithubIssue(prAsIssue!, "octocat/bridge-demo"),
    undefined,
    "an item carrying pull_request must never become a devpilot_issues row",
  );
});
