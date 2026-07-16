/**
 * Identity resolution at the API boundary — turns a request into a SERVER-VERIFIED
 * actor. The pipeline gate (authority/floor) is only meaningful if the identity
 * feeding it is trustworthy, so identity is NEVER taken from the request body.
 *
 * Verification modes (auto-selected from env):
 *   - SUPABASE_JWT_SECRET set  → verify the bearer as an HS256 Supabase JWT.
 *   - SUPABASE_URL set         → verify against the project's remote JWKS (ES256/RS256).
 *   - neither set (local dev)  → no verifier; fall back to the server-pinned pilot user.
 *
 * If a verifier IS configured and an Authorization header is present, it MUST contain
 * a non-empty bearer whose signature and subject verify — invalid credentials are
 * rejected, never silently downgraded to the pilot identity. A request with no header
 * uses the pilot fallback; authenticated procedures still reject that fallback whenever
 * a verifier or persistent stores are active.
 *
 * JWKS hardening: the remote JWKS fetch has its own bounded timeout (jose's
 * `timeoutDuration`) AND every verify call is wrapped in try/catch here. A slow or
 * down JWKS endpoint, a network error, or an invalid/expired token must never
 * escape as an unhandled rejection during context creation — it becomes a clean
 * `IdentityVerificationError`, which the tRPC layer maps to 401 Unauthorized
 * (see context.ts / router.ts). Without this, every authenticated request would
 * turn a JWKS outage into a crashed request instead of a 401.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Actor } from "@bridge/core";

/** Bound on the remote JWKS fetch + verify round trip (ms). Keeps a slow/down JWKS
 * endpoint from hanging a request indefinitely; a few seconds is generous for a
 * key-set fetch while still failing fast enough to return a clean 401. */
const JWKS_TIMEOUT_MS = 5_000;

/**
 * Raised whenever bearer verification fails for ANY reason — timeout, network
 * error, malformed/expired/invalid-signature token. Callers (the tRPC context
 * factory) catch this and translate it into a 401, never an unhandled rejection.
 */
export class IdentityVerificationError extends Error {
  constructor(cause: unknown) {
    super(`identity verification failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "IdentityVerificationError";
    this.cause = cause;
  }
}

export interface IdentityResolver {
  /** True when cryptographic verification is active (a JWT secret/JWKS is configured). */
  readonly verifying: boolean;
  /** Resolve the authenticated actor for a request, given its Authorization header.
   * Rejects with `IdentityVerificationError` (never a raw/opaque error) on any
   * verification failure, including JWKS timeout. */
  resolve(authHeader: string | undefined): Promise<Actor>;
}

/** Extract the bearer token from an Authorization header, or null if absent/malformed.
 * Exported so the context factory derives "was a token even presented?" from the exact
 * same parsing the resolver uses — no drift between the two. */
export function bearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  return token ? token : null;
}

/**
 * Whether a cryptographic verifier is configured from the environment, WITHOUT
 * building a resolver. `createIdentityResolver().verifying` is the authoritative
 * runtime signal, but callers that only have env (CORS config, boot logging, the
 * production-env assertion) need the same answer as a pure predicate. Kept in lockstep
 * with the resolver's own `verifying` computation (same two env vars).
 */
export function isVerifierConfigured(): boolean {
  return Boolean(process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_URL);
}

/**
 * Build the resolver. `pilotUserId` is the server-chosen fallback identity used when no
 * verifier is configured or no token is presented.
 */
export function createIdentityResolver(pilotUserId: string): IdentityResolver {
  const hsSecret = process.env.SUPABASE_JWT_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL;

  // HS256 shared-secret verifier (legacy Supabase projects).
  const hsKey = hsSecret ? new TextEncoder().encode(hsSecret) : null;
  // Remote JWKS verifier (asymmetric Supabase JWTs). `timeoutDuration` bounds the
  // key-set HTTP fetch so a down/slow JWKS endpoint fails fast instead of hanging.
  const jwks = !hsKey && supabaseUrl
    ? createRemoteJWKSet(new URL(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`), {
        timeoutDuration: JWKS_TIMEOUT_MS,
      })
    : null;

  const verifying = Boolean(hsKey || jwks);

  function actorFrom(payload: JWTPayload): Actor {
    const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!sub) throw new Error("verified token is missing a non-empty subject");
    return { type: "user", id: sub };
  }

  return {
    verifying,
    async resolve(authHeader) {
      const token = bearerToken(authHeader);
      if (!verifying) {
        // Pure local dev: server-pinned pilot identity (never client-asserted).
        return { type: "user", id: pilotUserId };
      }
      if (!authHeader) return { type: "user", id: pilotUserId };
      if (!token) {
        throw new IdentityVerificationError(new Error("malformed or empty bearer credentials"));
      }
      try {
        if (hsKey) {
          const { payload } = await jwtVerify(token, hsKey);
          return actorFrom(payload);
        }
        // jwks is non-null here (verifying && !hsKey).
        const { payload } = await jwtVerify(token, jwks!);
        return actorFrom(payload);
      } catch (err) {
        // Any verify failure — JWKS fetch timeout, network error, bad signature,
        // expired/malformed token — becomes a typed error the API layer maps to a
        // clean 401, never an unhandled rejection that crashes context creation.
        throw new IdentityVerificationError(err);
      }
    },
  };
}
