import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { corsOriginConfig, assertProductionEnv, buildServer } from "../src/server.js";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prior[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Async-safe variant: awaits `fn()` before restoring env, so the restore doesn't
 * race an in-flight async body (plain `withEnv`'s `finally` fires before an
 * unawaited returned Promise settles). Used by tests whose body performs async
 * work — e.g. building the server / making requests — while env vars are set. */
async function withEnvAsync<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prior: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prior[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("CORS: explicit API_ALLOWED_ORIGINS always wins, in any NODE_ENV", () => {
  withEnv({ API_ALLOWED_ORIGINS: "https://dummy_a.example, https://dummy_b.example", NODE_ENV: "production" }, () => {
    assert.deepEqual(corsOriginConfig(), ["https://dummy_a.example", "https://dummy_b.example"]);
  });
  withEnv({ API_ALLOWED_ORIGINS: "https://dummy_a.example", NODE_ENV: undefined }, () => {
    assert.deepEqual(corsOriginConfig(), ["https://dummy_a.example"]);
  });
});

test("CORS: no allowlist + production => fail closed (no origins allowed)", () => {
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: "production" }, () => {
    assert.deepEqual(corsOriginConfig(), []);
  });
});

test("CORS: no allowlist + non-production => permissive dev default", () => {
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: "development" }, () => {
    assert.equal(corsOriginConfig(), true);
  });
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: undefined }, () => {
    assert.equal(corsOriginConfig(), true);
  });
});

test("assertProductionEnv: refuses to boot in production without DATABASE_URL", () => {
  withEnv({ NODE_ENV: "production", DATABASE_URL: undefined }, () => {
    assert.throws(() => assertProductionEnv(), /DATABASE_URL/);
  });
});

test("assertProductionEnv: passes in production when DATABASE_URL is set", () => {
  withEnv({ NODE_ENV: "production", DATABASE_URL: "postgres://dummy_user:dummy_pw@localhost:5432/dummy_db" }, () => {
    assert.doesNotThrow(() => assertProductionEnv());
  });
});

test("assertProductionEnv: no-op outside production even without DATABASE_URL", () => {
  withEnv({ NODE_ENV: "development", DATABASE_URL: undefined }, () => {
    assert.doesNotThrow(() => assertProductionEnv());
  });
});

test("verify failure (bad bearer token) yields a clean 401, not a 500/unhandled rejection — even when the tRPC procedure itself needs no auth", async () => {
  await withEnvAsync(
    { SUPABASE_JWT_SECRET: "dummy_correct_secret", SUPABASE_URL: undefined },
    async () => {
      const app = await buildServer();
      try {
        const forged = await new SignJWT({ sub: "dummy_attacker" })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(new TextEncoder().encode("dummy_wrong_secret"));

        const res = await app.inject({
          method: "GET",
          url: "/trpc/health",
          headers: { authorization: `Bearer ${forged}` },
        });
        // Identity resolution runs at context-creation time, before the procedure
        // body executes, so a bad bearer token 401s even for an unauthenticated
        // query — this is what proves createContext no longer explodes uncaught.
        assert.equal(res.statusCode, 401);
        const body = res.json();
        assert.equal(body.error.code, -32001); // UNAUTHORIZED JSON-RPC code (tRPC)
      } finally {
        await app.close();
      }
    },
  );
});

test("/health/ready: reports ready with per-store checks on the in-memory/pglite dev stack", async () => {
  const app = await buildServer();
  try {
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ready, true);
    assert.equal(body.checks.ledger, "ok");
    assert.equal(body.checks.localPlane, "ok");
  } finally {
    await app.close();
  }
});
