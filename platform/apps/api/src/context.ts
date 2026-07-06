/**
 * tRPC request context. Carries the assembled pipeline + a per-request RunCtx
 * (determinism seams). At the system boundary we use the wall clock; the RNG is
 * seeded from the clock so engine code stays deterministic and replayable.
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
import { SeededRng, SystemClock, UuidGen, type Actor, type RunCtx } from "@bridge/core";
import type { Wiring } from "./wiring.js";
import { createIdentityResolver, IdentityVerificationError } from "./identity.js";

export interface ApiContext {
  wiring: Wiring;
  run: RunCtx;
  /** The authenticated actor (server-resolved, never client-asserted). Approvals and
   * human-origin proposals authorize against this. */
  identity: Actor;
}

/** Minimal shape of what the tRPC Fastify adapter hands createContext. */
interface CreateContextArgs {
  req?: { headers?: Record<string, string | string[] | undefined> };
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function makeContextFactory(wiring: Wiring) {
  // Server-chosen fallback identity (override via env). Replaced by the verified
  // Supabase user when a bearer token is presented and a verifier is configured.
  const pilotUserId = process.env.BRIDGE_PILOT_USER_ID ?? wiring.pilotUserId;
  const identityResolver = createIdentityResolver(pilotUserId);

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
    // UuidGen (not UlidGen): ledger ids are written to Postgres `uuid` columns.
    return {
      wiring,
      run: { clock, rng, ids: new UuidGen(clock, rng) },
      identity,
    };
  };
}
