import assert from "node:assert/strict";
import test from "node:test";
import type { GuardedFetchResult } from "@bridge/net-guard";
import { GithubApiGateway, parseNextPageUrl, parseRateLimitHeaders } from "../src/gateway-live.js";
import { MissingGithubGatewayFactory } from "../src/gateway.js";
import { REPO_FIXTURES } from "./fixtures/repos.js";

test("parseNextPageUrl extracts rel=\"next\" from a multi-link header", () => {
  const header =
    '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=5>; rel="last"';
  assert.equal(parseNextPageUrl(header), "https://api.github.com/user/repos?page=2");
  assert.equal(parseNextPageUrl(undefined), undefined);
  assert.equal(parseNextPageUrl('<https://api.github.com/x>; rel="last"'), undefined, "no next page left");
});

test("parseRateLimitHeaders reads GitHub's x-ratelimit-* triple", () => {
  const status = parseRateLimitHeaders({
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4986",
    "x-ratelimit-reset": "1786598400",
  });
  assert.deepEqual(status, {
    limit: 5000,
    remaining: 4986,
    resetAt: new Date(1786598400 * 1000).toISOString(),
  });
  assert.equal(parseRateLimitHeaders({}), undefined, "missing headers must not fabricate a status");
});

function fakeResult(body: unknown, headers: Record<string, string> = {}, status = 200): GuardedFetchResult {
  return {
    finalUrl: "https://api.github.com/x",
    status,
    headers: { "content-type": "application/json", ...headers },
    body: Buffer.from(JSON.stringify(body)),
    truncated: false,
    redirectCount: 0,
    hopOrigins: ["https://api.github.com"],
  } as GuardedFetchResult;
}

test("GithubApiGateway.viewer sends a Bearer token and no-follow redirects", async () => {
  let capturedUrl: string | undefined;
  let capturedOptions: Record<string, unknown> | undefined;
  const gateway = new GithubApiGateway("github_pat_test", {
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options as Record<string, unknown>;
      return fakeResult({ login: "octocat" });
    },
  });
  const viewer = await gateway.viewer();
  assert.equal(viewer.login, "octocat");
  assert.equal(capturedUrl, "https://api.github.com/user");
  assert.equal((capturedOptions?.headers as Record<string, string>).authorization, "Bearer github_pat_test");
  assert.equal(capturedOptions?.maxRedirects, 0);
  assert.deepEqual(capturedOptions?.allowedRedirectOrigins, ["https://api.github.com"]);
});

test("GithubApiGateway.fetchRepos paginates via the returned nextPageToken and surfaces rate limits", async () => {
  const gateway = new GithubApiGateway("ghp_test", {
    fetchImpl: async () =>
      fakeResult(REPO_FIXTURES, {
        link: '<https://api.github.com/user/repos?page=2>; rel="next"',
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1786598400",
      }),
  });
  const result = await gateway.fetchRepos({});
  assert.equal(result.repos.length, 2);
  assert.equal(result.nextPageToken, "https://api.github.com/user/repos?page=2");
  assert.equal(gateway.rateLimitStatus()?.remaining, 4999);
});

test("GithubApiGateway surfaces a non-2xx status as a typed failure, never silently empty data", async () => {
  const gateway = new GithubApiGateway("bad-token", {
    fetchImpl: async () => fakeResult({ message: "Bad credentials" }, {}, 401),
  });
  await assert.rejects(() => gateway.viewer(), /HTTP 401/);
});

test("MissingGithubGatewayFactory fails closed with no fake data", async () => {
  await assert.rejects(
    async () => new MissingGithubGatewayFactory().forToken("anything"),
    /no Personal Access Token connected/,
  );
});

test("GithubApiGateway.fetchPull returns the single-Pull payload including body text", async () => {
  let capturedUrl: string | undefined;
  const gateway = new GithubApiGateway("ghp_test", {
    fetchImpl: async (url) => {
      capturedUrl = url;
      return fakeResult({ id: 1, number: 7, title: "Fix bug", state: "open", body: "Fixes the thing." });
    },
  });
  const pull = await gateway.fetchPull("octo/repo", 7);
  assert.equal(pull.body, "Fixes the thing.");
  assert.equal(capturedUrl, "https://api.github.com/repos/octo/repo/pulls/7");
});

test("GithubApiGateway.fetchPullFiles returns per-file unified-diff patches", async () => {
  const files = [
    { filename: "src/a.ts", status: "modified", additions: 3, deletions: 1, changes: 4, patch: "@@ -1,1 +1,3 @@" },
    { filename: "assets/logo.png", status: "modified", additions: 0, deletions: 0, changes: 0 },
  ];
  let capturedUrl: string | undefined;
  const gateway = new GithubApiGateway("ghp_test", {
    fetchImpl: async (url) => {
      capturedUrl = url;
      return fakeResult(files);
    },
  });
  const result = await gateway.fetchPullFiles("octo/repo", 7);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.patch, "@@ -1,1 +1,3 @@");
  assert.equal(result[1]?.patch, undefined, "a binary file has no patch");
  assert.equal(capturedUrl, "https://api.github.com/repos/octo/repo/pulls/7/files?per_page=100");
});

test("GithubApiGateway.fetchIssue returns the single-Issue payload including body text", async () => {
  let capturedUrl: string | undefined;
  const gateway = new GithubApiGateway("ghp_test", {
    fetchImpl: async (url) => {
      capturedUrl = url;
      return fakeResult({ id: 1, number: 9, title: "Crash on save", state: "open", body: "Steps to reproduce..." });
    },
  });
  const issue = await gateway.fetchIssue("octo/repo", 9);
  assert.equal(issue.body, "Steps to reproduce...");
  assert.equal(capturedUrl, "https://api.github.com/repos/octo/repo/issues/9");
});
