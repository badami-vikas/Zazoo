import type { GithubIssuePayload } from "../../src/contracts.js";

export const ISSUE_FIXTURES: GithubIssuePayload[] = [
  {
    id: 3001,
    number: 12,
    title: "Sync loop should back off on secondary rate limits",
    state: "open",
    labels: [{ name: "bug" }, "priority:high"],
    assignee: { login: "octocat" },
    updated_at: "2026-08-12T11:00:00Z",
    html_url: "https://github.com/octocat/bridge-demo/issues/12",
  },
  {
    id: 2001,
    number: 42,
    title: "Add retry budget to the sync loop",
    state: "open",
    labels: [],
    assignee: null,
    updated_at: "2026-08-12T10:00:00Z",
    html_url: "https://github.com/octocat/bridge-demo/pull/42",
    pull_request: { url: "https://api.github.com/repos/octocat/bridge-demo/pulls/42" },
  },
];
