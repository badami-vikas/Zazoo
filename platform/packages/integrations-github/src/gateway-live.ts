/**
 * GithubApiGateway — the REAL egress adapter. Binds the GithubGateway port to
 * GitHub REST v3 over @bridge/net-guard's `guardedFetch` (DNS-pinned SSRF
 * guard, bounded redirects, bounded response size). This is the ONLY file
 * that talks to the GitHub internet API; everything upstream is governed by
 * the sync Skill.
 */
import { guardedFetch, type GuardedFetchResult } from "@bridge/net-guard";
import type {
  FetchIssuesResult,
  FetchPullsResult,
  FetchReposResult,
  GithubIssuePayload,
  GithubPullFilePayload,
  GithubPullPayload,
  GithubRepoPayload,
  GithubReviewPayload,
  GithubViewer,
  PageOpts,
  RateLimitStatus,
} from "./contracts.js";
import type { GithubGateway, GithubGatewayFactory } from "./gateway.js";

const API_ORIGIN = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 4_000_000;
const DEFAULT_PER_PAGE = 100;
const USER_AGENT = "Bridge-DevPilot";

type GuardedFetchFn = (url: string, options?: Parameters<typeof guardedFetch>[1]) => Promise<GuardedFetchResult>;

/** Extracts the `rel="next"` URL from a GitHub `Link` response header. Pure —
 * exported for direct unit testing without a network call. */
export function parseNextPageUrl(linkHeader: string | string[] | undefined): string | undefined {
  const value = Array.isArray(linkHeader) ? linkHeader.join(", ") : linkHeader;
  if (!value) return undefined;
  for (const part of value.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (match) return match[1];
  }
  return undefined;
}

/** Parses GitHub's `x-ratelimit-*` response headers. Pure — exported for
 * direct unit testing without a network call. */
export function parseRateLimitHeaders(
  headers: Record<string, string | string[] | undefined>,
): RateLimitStatus | undefined {
  const limit = Number(headers["x-ratelimit-limit"]);
  const remaining = Number(headers["x-ratelimit-remaining"]);
  const resetEpochSeconds = Number(headers["x-ratelimit-reset"]);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(resetEpochSeconds)) {
    return undefined;
  }
  return { limit, remaining, resetAt: new Date(resetEpochSeconds * 1000).toISOString() };
}

class GithubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

export class GithubApiGateway implements GithubGateway {
  #pat: string;
  #fetchImpl: GuardedFetchFn;
  #lastRateLimit: RateLimitStatus | undefined;

  constructor(personalAccessToken: string, deps: { fetchImpl?: GuardedFetchFn } = {}) {
    this.#pat = personalAccessToken;
    this.#fetchImpl = deps.fetchImpl ?? guardedFetch;
  }

  rateLimitStatus(): RateLimitStatus | undefined {
    return this.#lastRateLimit;
  }

  async #request(url: string): Promise<GuardedFetchResult> {
    const response = await this.#fetchImpl(url, {
      headers: {
        authorization: `Bearer ${this.#pat}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": USER_AGENT,
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxBytes: DEFAULT_MAX_BYTES,
      maxRedirects: 0,
      allowedRedirectOrigins: [API_ORIGIN],
    });
    this.#lastRateLimit = parseRateLimitHeaders(response.headers as Record<string, string | string[] | undefined>);
    if (response.status < 200 || response.status >= 300) {
      throw new GithubApiError(response.status, `GitHub API ${url} returned HTTP ${response.status}`);
    }
    return response;
  }

  async #getJson<T>(url: string): Promise<{ body: T; nextPageToken: string | undefined }> {
    const response = await this.#request(url);
    const body = JSON.parse(response.body.toString("utf8")) as T;
    const nextPageToken = parseNextPageUrl(response.headers.link as string | string[] | undefined);
    return { body, nextPageToken };
  }

  async viewer(): Promise<GithubViewer> {
    const { body } = await this.#getJson<{ login: string }>(`${API_ORIGIN}/user`);
    return { login: body.login };
  }

  async fetchRepos(opts: PageOpts): Promise<FetchReposResult> {
    const url =
      opts.pageToken ?? `${API_ORIGIN}/user/repos?per_page=${opts.perPage ?? DEFAULT_PER_PAGE}&sort=pushed`;
    const { body, nextPageToken } = await this.#getJson<GithubRepoPayload[]>(url);
    return { repos: body, ...(nextPageToken ? { nextPageToken } : {}) };
  }

  async fetchPulls(repoFullName: string, opts: PageOpts & { since?: string }): Promise<FetchPullsResult> {
    const url =
      opts.pageToken ??
      `${API_ORIGIN}/repos/${repoFullName}/pulls?state=all&sort=updated&direction=desc&per_page=${opts.perPage ?? DEFAULT_PER_PAGE}`;
    const { body, nextPageToken } = await this.#getJson<GithubPullPayload[]>(url);
    return { pulls: body, ...(nextPageToken ? { nextPageToken } : {}) };
  }

  async fetchPullReviews(repoFullName: string, number: number): Promise<GithubReviewPayload[]> {
    const { body } = await this.#getJson<GithubReviewPayload[]>(
      `${API_ORIGIN}/repos/${repoFullName}/pulls/${number}/reviews?per_page=100`,
    );
    return body;
  }

  async fetchIssues(repoFullName: string, opts: PageOpts & { since?: string }): Promise<FetchIssuesResult> {
    const sinceParam = opts.since ? `&since=${encodeURIComponent(opts.since)}` : "";
    const url =
      opts.pageToken ??
      `${API_ORIGIN}/repos/${repoFullName}/issues?state=all&sort=updated&direction=desc&per_page=${opts.perPage ?? DEFAULT_PER_PAGE}${sinceParam}`;
    const { body, nextPageToken } = await this.#getJson<GithubIssuePayload[]>(url);
    return { issues: body, ...(nextPageToken ? { nextPageToken } : {}) };
  }

  async fetchPull(repoFullName: string, number: number): Promise<GithubPullPayload> {
    const { body } = await this.#getJson<GithubPullPayload>(`${API_ORIGIN}/repos/${repoFullName}/pulls/${number}`);
    return body;
  }

  async fetchPullFiles(repoFullName: string, number: number): Promise<GithubPullFilePayload[]> {
    const { body } = await this.#getJson<GithubPullFilePayload[]>(
      `${API_ORIGIN}/repos/${repoFullName}/pulls/${number}/files?per_page=100`,
    );
    return body;
  }

  async fetchIssue(repoFullName: string, number: number): Promise<GithubIssuePayload> {
    const { body } = await this.#getJson<GithubIssuePayload>(`${API_ORIGIN}/repos/${repoFullName}/issues/${number}`);
    return body;
  }
}

/** Resolves a GithubApiGateway for a caller-supplied PAT. */
export class LiveGithubGatewayFactory implements GithubGatewayFactory {
  forToken(personalAccessToken: string): GithubGateway {
    return new GithubApiGateway(personalAccessToken);
  }
}
