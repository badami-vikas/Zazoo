import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createIdentityResolver, IdentityVerificationError } from "../src/identity.js";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prior[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("identity: HS256 verify failure (bad secret) rejects with IdentityVerificationError, not a raw jose error", async () => {
  await withEnv(
    { SUPABASE_JWT_SECRET: "dummy_correct_secret", SUPABASE_URL: undefined },
    async () => {
      const resolver = createIdentityResolver("dummy_pilot_user");
      assert.equal(resolver.verifying, true);
      // Signed with a DIFFERENT secret than the resolver is configured with —
      // simulates an invalid/forged bearer token.
      const forged = await new SignJWT({ sub: "dummy_attacker" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(new TextEncoder().encode("dummy_wrong_secret"));

      await assert.rejects(
        () => resolver.resolve(`Bearer ${forged}`),
        (err: unknown) => {
          assert.ok(err instanceof IdentityVerificationError, "must be the typed identity error");
          return true;
        },
      );
    },
  );
});

test("identity: JWKS verify failure (unreachable endpoint) rejects with IdentityVerificationError within the bounded timeout, not an unhandled rejection", { timeout: 15_000 }, async () => {
  await withEnv(
    {
      SUPABASE_JWT_SECRET: undefined,
      // A non-routable address (TEST-NET-1, RFC 5737): the fetch will hang/fail
      // rather than resolve normally, exercising the timeout + catch path.
      SUPABASE_URL: "https://192.0.2.1",
    },
    async () => {
      const resolver = createIdentityResolver("dummy_pilot_user");
      assert.equal(resolver.verifying, true);
      // Any syntactically-plausible bearer token — the JWKS fetch itself is what
      // must fail (timeout/network error), before signature checking even runs.
      const bogusToken = "aGVhZGVy.cGF5bG9hZA.c2ln"; // header.payload.sig (not valid JWT, doesn't matter)

      await assert.rejects(
        () => resolver.resolve(`Bearer ${bogusToken}`),
        (err: unknown) => {
          assert.ok(err instanceof IdentityVerificationError, "must be the typed identity error, not a raw/opaque throw");
          return true;
        },
      );
    },
  );
});

test("identity: no verifier configured + no token => pilot fallback, unaffected by JWKS hardening", async () => {
  await withEnv({ SUPABASE_JWT_SECRET: undefined, SUPABASE_URL: undefined }, async () => {
    const resolver = createIdentityResolver("dummy_pilot_user");
    assert.equal(resolver.verifying, false);
    const actor = await resolver.resolve(undefined);
    assert.deepEqual(actor, { type: "user", id: "dummy_pilot_user" });
  });
});
