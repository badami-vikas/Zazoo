import type { GithubRepoPayload } from "../../src/contracts.js";

export const REPO_FIXTURES: GithubRepoPayload[] = [
  {
    id: 1001,
    full_name: "octocat/bridge-demo",
    private: false,
    default_branch: "main",
    archived: false,
    pushed_at: "2026-08-10T12:00:00Z",
    html_url: "https://github.com/octocat/bridge-demo",
  },
  {
    id: 1002,
    full_name: "octocat/private-tools",
    private: true,
    default_branch: "trunk",
    archived: false,
    pushed_at: "2026-08-12T09:30:00Z",
    html_url: "https://github.com/octocat/private-tools",
  },
];
