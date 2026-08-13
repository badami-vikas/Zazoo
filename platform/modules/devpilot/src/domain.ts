/**
 * DevPilot domain types — pure shapes for a freelance engineer's tracked
 * repos, pull requests, and issues. No network, no credentials: rows arrive
 * from @bridge/integrations-github's intake mapping and are persisted by
 * @bridge/db's DrizzleDevpilotStore. This module only defines what a row IS.
 */

/** Every source a devpilot_issues row may have come from. Jira joins in D3;
 * declaring both now keeps the column stable across that migration. */
export const DEVPILOT_SOURCES = ["github", "jira"] as const;
export type DevpilotSource = (typeof DEVPILOT_SOURCES)[number];

export const DEVPILOT_PULL_STATES = ["open", "closed", "merged"] as const;
export type DevpilotPullState = (typeof DEVPILOT_PULL_STATES)[number];

export const DEVPILOT_REVIEW_STATES = [
  "pending",
  "approved",
  "changes_requested",
  "commented",
  "none",
] as const;
export type DevpilotReviewState = (typeof DEVPILOT_REVIEW_STATES)[number];

export const DEVPILOT_ISSUE_STATES = ["open", "closed"] as const;
export type DevpilotIssueState = (typeof DEVPILOT_ISSUE_STATES)[number];

export interface DevRepo {
  id: string;
  organizationId: string;
  source: DevpilotSource;
  sourceId: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  archived: boolean;
  tracked: boolean;
  pushedAt: string | null;
  url: string;
  syncedAt: string;
}

export interface DevPull {
  id: string;
  organizationId: string;
  source: DevpilotSource;
  sourceId: string;
  repoId: string | null;
  repoFullName: string;
  number: number;
  title: string;
  state: DevpilotPullState;
  reviewState: DevpilotReviewState;
  author: string | null;
  isDraft: boolean;
  additions: number | null;
  deletions: number | null;
  url: string;
  externalUpdatedAt: string;
  syncedAt: string;
}

export interface DevIssue {
  id: string;
  organizationId: string;
  source: DevpilotSource;
  sourceId: string;
  repoId: string | null;
  repoFullName: string | null;
  number: number;
  title: string;
  state: DevpilotIssueState;
  labels: string[];
  assignee: string | null;
  priority: string | null;
  url: string;
  externalUpdatedAt: string;
  syncedAt: string;
}

/** GitHub's `/repos/{owner}/{repo}/issues` endpoint mixes pull requests into
 * issue listings — an item carrying `pull_request` is a PR, not an Issue, and
 * must be filtered before it ever reaches devpilot_issues. */
export function isGithubPullDisguisedAsIssue(payload: { pull_request?: unknown }): boolean {
  return payload.pull_request !== undefined && payload.pull_request !== null;
}

/** Deterministic review-state reduction from GitHub's review list — the
 * gateway hands over raw per-reviewer states; a Pull has exactly one. Most
 * recent decisive review wins; an empty list is "pending" review has not
 * started, distinct from "none" (D1 never emits "none" — reserved for a
 * future source with no review concept, e.g. a Jira-linked PR). */
export function reduceGithubReviewState(
  reviews: ReadonlyArray<{ state: string; submittedAt: string }>,
): DevpilotReviewState {
  if (reviews.length === 0) return "pending";
  const latest = [...reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).at(-1)!;
  switch (latest.state.toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "commented";
    default:
      return "pending";
  }
}
