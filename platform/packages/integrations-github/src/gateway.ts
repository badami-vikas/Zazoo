/**
 * GithubGateway — the EGRESS adapter port. It is the ONLY thing that touches
 * the GitHub internet API; everything upstream goes through the governed
 * sync Skill. A gateway instance is bound to one Personal Access Token.
 *
 * One adapter binds this port: GithubApiGateway (gateway-live.ts) — real
 * REST v3 over guardedFetch. There is NO fake/dummy gateway: the platform
 * sources only real data. When no PAT is connected,
 * `MissingGithubGatewayFactory` fails closed.
 */
import type {
  FetchIssuesResult,
  FetchPullsResult,
  FetchReposResult,
  GithubReviewPayload,
  GithubViewer,
  PageOpts,
  RateLimitStatus,
} from "./contracts.js";

export interface GithubGateway {
  /** Validates the token and identifies the account it belongs to. */
  viewer(): Promise<GithubViewer>;
  fetchRepos(opts: PageOpts): Promise<FetchReposResult>;
  fetchPulls(repoFullName: string, opts: PageOpts & { since?: string }): Promise<FetchPullsResult>;
  fetchPullReviews(repoFullName: string, number: number): Promise<GithubReviewPayload[]>;
  fetchIssues(repoFullName: string, opts: PageOpts & { since?: string }): Promise<FetchIssuesResult>;
  rateLimitStatus(): RateLimitStatus | undefined;
}

/** Resolves the gateway bound to a caller-supplied PAT. Synchronous: no
 * token refresh exists for a PAT, so there is nothing to await. */
export interface GithubGatewayFactory {
  forToken(personalAccessToken: string): GithubGateway;
}

/**
 * Fail-closed factory used when no GitHub PAT is connected. No fake data —
 * any attempt to reach GitHub errors clearly instead of silently serving
 * fabricated content. The rest of the API (pipeline, Agents, Automations)
 * still runs.
 */
export class MissingGithubGatewayFactory implements GithubGatewayFactory {
  forToken(_personalAccessToken: string): GithubGateway {
    throw new Error(
      "github: no Personal Access Token connected — connect one at /integrations/github (no fake gateway; the platform sources only real data)",
    );
  }
}
