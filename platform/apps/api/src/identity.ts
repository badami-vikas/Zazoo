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
 * If a verifier IS configured and a bearer token is present, it MUST verify — an
 * invalid token is rejected (never silently downgraded to the pilot identity). A
 * request with no token uses the pilot fallback so local/no-auth dev still works.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Actor } from "@bridge/core";

export interface IdentityResolver {
  /** True when cryptographic verification is active (a JWT secret/JWKS is configured). */
  readonly verifying: boolean;
  /** Resolve the authenticated actor for a request, given its Authorization header. */
  resolve(authHeader: string | undefined): Promise<Actor>;
}

function bearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : null;
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
  // Remote JWKS verifier (asymmetric Supabase JWTs).
  const jwks = !hsKey && supabaseUrl
    ? createRemoteJWKSet(new URL(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`))
    : null;

  const verifying = Boolean(hsKey || jwks);

  function actorFrom(payload: JWTPayload): Actor {
    const sub = typeof payload.sub === "string" && payload.sub ? payload.sub : pilotUserId;
    return { type: "user", id: sub };
  }

  return {
    verifying,
    async resolve(authHeader) {
      const token = bearer(authHeader);
      if (!verifying || !token) {
        // Dev / no-auth: server-pinned pilot identity (never client-asserted).
        return { type: "user", id: pilotUserId };
      }
      if (hsKey) {
        const { payload } = await jwtVerify(token, hsKey);
        return actorFrom(payload);
      }
      // jwks is non-null here (verifying && !hsKey).
      const { payload } = await jwtVerify(token, jwks!);
      return actorFrom(payload);
    },
  };
}
