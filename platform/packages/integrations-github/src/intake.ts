/**
 * Pure mapping from GitHub REST payloads to DevPilot row shapes. No network,
 * no store — every function here takes already-fetched JSON and returns
 * plain data, fully unit-testable against recorded fixtures.
 *
 * Titles, descriptions, and labels are UNTRUSTED EXTERNAL data: page-authored
 * by whoever opened the PR/Issue on GitHub. Nothing here interprets them as
 * instructions — they pass through as opaque strings for a Table cell to
 * render. A future consumer that feeds one into a model prompt (D2's
 * PR-review Skill) is responsible for its own quarantine at that boundary.
 */
import { isGithubPullDisguisedAsIssue, reduceGithubReviewState, type DevpilotIssueState, type DevpilotPullState, type DevpilotReviewState } from "@bridge/devpilot";
import type { GithubIssuePayload, GithubPullPayload, GithubRepoPayload, GithubReviewPayload } from "./contracts.js";

export interface MappedRepo {
  sourceId: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  archived: boolean;
  pushedAt: string | null;
  url: string;
}

export function mapGithubRepo(payload: GithubRepoPayload): MappedRepo {
  return {
    sourceId: String(payload.id),
    fullName: payload.full_name,
    private: payload.private,
    defaultBranch: payload.default_branch,
    archived: payload.archived,
    pushedAt: payload.pushed_at,
    url: payload.html_url,
  };
}

export interface MappedPull {
  sourceId: string;
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
}

function pullState(payload: GithubPullPayload): DevpilotPullState {
  if (payload.merged_at) return "merged";
  return payload.state === "closed" ? "closed" : "open";
}

export function mapGithubPull(
  payload: GithubPullPayload,
  repoFullName: string,
  reviews: readonly GithubReviewPayload[],
): MappedPull {
  return {
    sourceId: String(payload.id),
    repoFullName,
    number: payload.number,
    title: payload.title,
    state: pullState(payload),
    reviewState: reduceGithubReviewState(reviews.map((r) => ({ state: r.state, submittedAt: r.submitted_at }))),
    author: payload.user?.login ?? null,
    isDraft: payload.draft,
    additions: payload.additions ?? null,
    deletions: payload.deletions ?? null,
    url: payload.html_url,
    externalUpdatedAt: payload.updated_at,
  };
}

export interface MappedIssue {
  sourceId: string;
  repoFullName: string;
  number: number;
  title: string;
  state: DevpilotIssueState;
  labels: string[];
  assignee: string | null;
  url: string;
  externalUpdatedAt: string;
}

/** Returns `undefined` when the payload is a Pull Request disguised as an
 * Issue (GitHub's `/issues` endpoint mixes the two) — the caller must skip
 * it rather than double-count it against devpilot_issues. */
export function mapGithubIssue(payload: GithubIssuePayload, repoFullName: string): MappedIssue | undefined {
  if (isGithubPullDisguisedAsIssue(payload)) return undefined;
  return {
    sourceId: String(payload.id),
    repoFullName,
    number: payload.number,
    title: payload.title,
    state: payload.state,
    labels: payload.labels.map((label) => (typeof label === "string" ? label : label.name)),
    assignee: payload.assignee?.login ?? null,
    url: payload.html_url,
    externalUpdatedAt: payload.updated_at,
  };
}
