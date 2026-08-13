/**
 * GitHub Personal Access Token handling — validation and MASKED metadata
 * only. The raw token is never logged, never returned from any function
 * here, and never round-tripped through a tRPC response; callers persist it
 * to @bridge/local's SecretStore and pass the plain string straight into
 * `GithubGatewayFactory.forToken` at the point of use.
 */

const CLASSIC_PAT_PATTERN = /^ghp_[A-Za-z0-9]{36}$/;
const FINE_GRAINED_PAT_PATTERN = /^github_pat_[A-Za-z0-9_]{22,}$/;

export type GithubPatKind = "classic" | "fine-grained";

export interface MaskedPatMetadata {
  kind: GithubPatKind;
  /** Last 4 characters only — enough for the owner to recognize which token
   * they connected, never enough to reconstruct it. */
  last4: string;
}

/** Shape-only validation (GitHub's own format, not a liveness check — the
 * gateway's `viewer()` call is what actually proves the token works). */
export function classifyPatShape(pat: string): GithubPatKind | undefined {
  if (CLASSIC_PAT_PATTERN.test(pat)) return "classic";
  if (FINE_GRAINED_PAT_PATTERN.test(pat)) return "fine-grained";
  return undefined;
}

export function maskPat(pat: string): MaskedPatMetadata {
  const kind = classifyPatShape(pat);
  if (!kind) throw new Error("not a recognized GitHub Personal Access Token shape");
  return { kind, last4: pat.slice(-4) };
}

/** Parses the `X-OAuth-Scopes` header GitHub returns on an authenticated
 * classic-PAT request. Fine-grained PATs return no such header (their
 * permissions are per-repository and not enumerable from a response header),
 * so an absent header is not an error — the caller renders "fine-grained
 * (per-repository)" instead of a scope list. */
export function parseOAuthScopesHeader(headerValue: string | undefined): string[] {
  if (!headerValue) return [];
  return headerValue
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);
}
