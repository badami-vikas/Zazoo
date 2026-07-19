/**
 * tRPC request context. Carries the assembled pipeline + a per-request RunCtx
 * (determinism seams). At the system boundary we use the wall clock and a
 * request-scoped deterministic RNG. Persisted IDs use independent cryptographic
 * entropy so same-millisecond requests in different processes cannot collide.
 *
 * `identity` is the SERVER-RESOLVED actor for the request — never client-asserted.
 * Governed control-plane calls (e.g. approving a proposal) authorize against this,
 * so a client cannot claim to be a human (or another user) to slip past the gate.
 *
 * NOTE (tracked, see docs/wiki/known-issues.md): identity is currently PINNED to the
 * single pilot user server-side. The Supabase-JWT verification seam — reading the
 * bearer token and deriving the real user — is the remaining Phase C work. Even
 * pinned, this closes the "client claims to be a human approver" hole, because the
 * decider is chosen by the server, not the request body.
 *
 * JWKS hardening: `identityResolver.resolve` can reject with
 * `IdentityVerificationError` (JWKS timeout, network error, invalid token — see
 * identity.ts). That is caught here and re-thrown as a `TRPCError({code:
 * "UNAUTHORIZED"})`, which the tRPC fastify adapter maps to a clean 401 response.
 * Without this, a JWKS outage would surface as an unhandled rejection during
 * context creation instead of a normal auth failure.
 */
import { TRPCError } from "@trpc/server";
import { decodeJwt } from "jose";
import { SeededRng, SystemClock, UuidGen, type Actor, type Rng, type RunCtx } from "@bridge/core";
import type { Wiring } from "./wiring.js";
import { bearerToken, createIdentityResolver, IdentityVerificationError } from "./identity.js";
import { SIDECAR_TOKEN_HEADER, validSidecarToken } from "./sidecar-auth.js";

export interface ApiContext {
  wiring: Wiring;
  run: RunCtx;
  /** The authenticated actor (server-resolved, never client-asserted). Approvals and
   * human-origin proposals authorize against this. */
  identity: Actor;
  /** True when this request carried a VERIFIED identity — i.e. a verifier is configured
   * AND the request presented a bearer token that resolved without error. False for a
   * tokenless request (which falls back to the pilot identity) or when no verifier is
   * configured. The mutation auth gate (router.ts) keys off this. */
  authenticated: boolean;
  /** True when a cryptographic verifier is configured for this process (mirrors
   * `IdentityResolver.verifying`). Lets the mutation gate distinguish "pure in-memory
   * dev, no auth expected" from "a verifier exists, so a tokenless caller is anonymous". */
  verifying: boolean;
  /** Password-AMR timestamp from the already-verified bearer. Credential
   * reveal/copy/revoke accepts it only while it remains within the recent-auth window. */
  reauthenticatedAt?: number;
}

class CryptographicRng implements Rng {
  next(): number {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0]! / 4_294_967_296;
  }
}

/** Minimal shape of what the tRPC Fastify adapter hands createContext. */
interface CreateContextArgs {
  req?: { headers?: Record<string, string | string[] | undefined> };
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function verifiedReauthenticationAt(
  payload: ReturnType<typeof decodeJwt>,
): number | undefined {
  const candidates: number[] = [];
  if (Array.isArray(payload.amr)) {
    for (const entry of payload.amr) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "method" in entry &&
        entry.method === "password" &&
        "timestamp" in entry &&
        typeof entry.timestamp === "number" &&
        Number.isFinite(entry.timestamp)
      ) {
        candidates.push(entry.timestamp);
      }
    }
  }
  const latest = Math.max(...candidates);
  return Number.isFinite(latest) ? latest * 1_000 : undefined;
}

export function makeContextFactory(wiring: Wiring) {
  // buildWiring resolves the configured pilot once so bootstrap, governance,
  // integrations, and request identity cannot disagree.
  const identityResolver = createIdentityResolver(wiring.pilotUserId);

  return async function createContext(args?: CreateContextArgs): Promise<ApiContext> {
    const clock = new SystemClock();
    const rng = new SeededRng(clock.nowMs() >>> 0); // boundary seed
    const authHeader = headerValue(args?.req?.headers?.["authorization"]);
    let identity: Actor;
    try {
      identity = await identityResolver.resolve(authHeader);
    } catch (err) {
      if (err instanceof IdentityVerificationError) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "invalid or unverifiable credentials", cause: err });
      }
      throw err;
    }
    // "Authenticated" = a verifier is active AND a bearer token was actually presented
    // (and, since resolve() didn't throw above, it verified). A tokenless request under
    // a verifier resolves to the pilot fallback but is NOT authenticated — the mutation
    // gate must still reject it. Derived from the SAME parser resolve() uses, so the two
    // never drift.
    const verifying = identityResolver.verifying;
    const token = bearerToken(authHeader);
    const sidecarAuthenticated = validSidecarToken(
      args?.req?.headers?.[SIDECAR_TOKEN_HEADER],
    );
    // A sidecar capability proves that a request came through the managed local
    // client, not which Human is acting. Once a user verifier is configured,
    // only a verified bearer may satisfy user authentication.
    const authenticated = verifying
      ? token !== null
      : sidecarAuthenticated;
    let reauthenticatedAt: number | undefined;
    if (verifying && token) {
      const payload = decodeJwt(token);
      reauthenticatedAt = verifiedReauthenticationAt(payload);
    }
    // UuidGen (not UlidGen): ledger ids are written to Postgres `uuid` columns.
    // Its entropy must not repeat when two request contexts start in one millisecond.
    return {
      wiring,
      run: { clock, rng, ids: new UuidGen(clock, new CryptographicRng()) },
      identity,
      authenticated,
      verifying,
      ...(reauthenticatedAt != null ? { reauthenticatedAt } : {}),
    };
  };
}
