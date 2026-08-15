/**
 * Wire contracts for the GitHub integration — the typed edge between the
 * egress adapter (gateway-live.ts) and the rest of the platform. Shapes are
 * intentionally narrow: only the fields DevPilot's Table specs render. Titles
 * and descriptions are UNTRUSTED EXTERNAL data (page-authored by whoever
 * opened the PR/Issue) — never assumed to be instructions.
 */

export interface GithubViewer {
  login: string;
}

export interface GithubRepoPayload {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  archived: boolean;
  pushed_at: string | null;
  html_url: string;
}

export interface GithubPullPayload {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  merged_at: string | null;
  draft: boolean;
  user: { login: string } | null;
  additions?: number;
  deletions?: number;
  updated_at: string;
  html_url: string;
  /** Free text the PR author wrote. UNTRUSTED EXTERNAL — never assumed to be
   * instructions (D2, ADR-237). Absent on some list-endpoint responses. */
  body?: string | null;
}

/** One changed file from a Pull Request's file list. `patch` is GitHub's own
 * unified-diff snippet for the file, UNTRUSTED EXTERNAL, and absent for
 * binary files or files GitHub judged too large to diff. */
export interface GithubPullFilePayload {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GithubReviewPayload {
  state: string;
  submitted_at: string;
}

/** GitHub's `/issues` endpoint returns Issues AND Pull Requests in one list;
 * an item carrying `pull_request` is a PR and must be filtered before it
 * reaches devpilot_issues (see domain.ts's isGithubPullDisguisedAsIssue). */
export interface GithubIssuePayload {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  labels: Array<{ name: string } | string>;
  assignee: { login: string } | null;
  updated_at: string;
  html_url: string;
  pull_request?: unknown;
  /** Free text the Issue author wrote. UNTRUSTED EXTERNAL (D2, ADR-237). */
  body?: string | null;
}

export interface PageOpts {
  /** Opaque `next` URL from the prior response's Link header — never
   * constructed by hand, only round-tripped. */
  pageToken?: string;
  perPage?: number;
}

export interface FetchReposResult {
  repos: GithubRepoPayload[];
  nextPageToken?: string;
}

export interface FetchPullsResult {
  pulls: GithubPullPayload[];
  nextPageToken?: string;
}

export interface FetchIssuesResult {
  issues: GithubIssuePayload[];
  nextPageToken?: string;
}

/** Rate-limit headers surfaced so the sync Skill can skip a cycle instead of
 * tight-retrying into exhaustion (constitution Layer B budget meter). */
export interface RateLimitStatus {
  limit: number;
  remaining: number;
  resetAt: string;
}

export const GITHUB_SOURCE = "github" as const;

/** Least-privilege fine-grained PAT scopes DevPilot asks for — read-only,
 * per-repo scoped by the user at token-creation time on github.com. */
export const GITHUB_REQUIRED_PAT_PERMISSIONS: readonly string[] = [
  "Metadata: Read-only",
  "Contents: Read-only",
  "Pull requests: Read-only",
  "Issues: Read-only",
];
