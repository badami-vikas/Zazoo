import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import Fastify from "fastify";
import { SignJWT } from "jose";
import {
  assertProductionEnv,
  buildServer,
  closeServerWithDeadline,
  corsOriginConfig,
  desktopOAuthRedirectUri,
  inheritedListenFd,
  listenServer,
  rateLimitBucket,
  rateLimitConfig,
  serverHostConfig,
  watchParentLiveness,
} from "../src/server.js";

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
  withEnv({ API_ALLOWED_ORIGINS: "https://test_fixture_a.example, https://test_fixture_b.example", NODE_ENV: "production" }, () => {
    assert.deepEqual(corsOriginConfig(), ["https://test_fixture_a.example", "https://test_fixture_b.example"]);
  });
  withEnv({ API_ALLOWED_ORIGINS: "https://test_fixture_a.example", NODE_ENV: undefined }, () => {
    assert.deepEqual(corsOriginConfig(), ["https://test_fixture_a.example"]);
  });
});

test("CORS: no allowlist + production => fail closed (no origins allowed)", () => {
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: "production" }, () => {
    assert.deepEqual(corsOriginConfig(), []);
  });
});

test("CORS: no allowlist + non-production + NO verifier => permissive dev default", () => {
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: "development", SUPABASE_JWT_SECRET: undefined, SUPABASE_URL: undefined }, () => {
    assert.equal(corsOriginConfig(), true);
  });
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: undefined, SUPABASE_JWT_SECRET: undefined, SUPABASE_URL: undefined }, () => {
    assert.equal(corsOriginConfig(), true);
  });
});

test("CORS (SEC-2): a configured verifier forces restrictive CORS even in non-production", () => {
  // The whole point of SEC-2: an auth-enabled server must not also echo `origin: true`.
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: "development", SUPABASE_JWT_SECRET: "test_fixture_secret", SUPABASE_URL: undefined }, () => {
    assert.deepEqual(corsOriginConfig(), []);
  });

  test("server host: pure local dev is loopback-only; shared deployments require an explicit network boundary", () => {
    withEnv({
      API_HOST: undefined,
      NODE_ENV: "development",
      DATABASE_URL: undefined,
      SUPABASE_JWT_SECRET: undefined,
      SUPABASE_URL: undefined,
    }, () => {
      assert.equal(serverHostConfig(), "127.0.0.1");
    });
    withEnv({ API_HOST: undefined, NODE_ENV: "production" }, () => {
      assert.equal(serverHostConfig(), "0.0.0.0");
    });
    withEnv({ API_HOST: "192.0.2.10", NODE_ENV: "development" }, () => {
      assert.equal(serverHostConfig(), "192.0.2.10");
    });
  });
  withEnv({ API_ALLOWED_ORIGINS: undefined, NODE_ENV: undefined, SUPABASE_JWT_SECRET: undefined, SUPABASE_URL: "https://test_fixture.supabase.co" }, () => {
    assert.deepEqual(corsOriginConfig(), []);
  });
  // An explicit allowlist still wins even with a verifier configured.
  withEnv({ API_ALLOWED_ORIGINS: "https://test_fixture_app.example", NODE_ENV: "development", SUPABASE_JWT_SECRET: "test_fixture_secret" }, () => {
    assert.deepEqual(corsOriginConfig(), ["https://test_fixture_app.example"]);
  });
});

test("assertProductionEnv: refuses to boot in production without DATABASE_URL", () => {
  withEnv({ NODE_ENV: "production", DATABASE_URL: undefined }, () => {
    assert.throws(() => assertProductionEnv(), /DATABASE_URL/);
  });
});

test("assertProductionEnv: passes in production when DATABASE_URL is set", () => {
  withEnv({ NODE_ENV: "production", DATABASE_URL: "postgres://test_fixture_user:test_fixture_pw@localhost:5432/test_fixture_db" }, () => {
    assert.doesNotThrow(() => assertProductionEnv());
  });
});

test("assertProductionEnv: no-op outside production even without DATABASE_URL", () => {
  withEnv({ NODE_ENV: "development", DATABASE_URL: undefined }, () => {
    assert.doesNotThrow(() => assertProductionEnv());
  });
});

test("server host: a managed sidecar is loopback-only even with shared deployment settings", () => {
  withEnv(
    {
      BRIDGE_SIDECAR_TOKEN: "a".repeat(64),
      API_HOST: "0.0.0.0",
      DATABASE_URL: "postgres://test_fixture",
    },
    () => {
      assert.equal(serverHostConfig(), "127.0.0.1");
    },
  );
});

test("managed sidecar listeners are inherited and fail closed without a reservation", async () => {
  if (process.platform !== "win32") {
    withEnv({ BRIDGE_LISTEN_FD: "12" }, () => {
      assert.equal(inheritedListenFd(), 12);
    });
  }
  withEnv({ BRIDGE_LISTEN_FD: "not-a-descriptor" }, () => {
    assert.throws(
      () => inheritedListenFd(),
      process.platform === "win32"
        ? /unsupported on Windows/
        : /numeric file descriptor/,
    );
  });
  await withEnvAsync(
    {
      BRIDGE_LISTEN_FD: undefined,
      BRIDGE_SIDECAR_TOKEN: "a".repeat(64),
    },
    async () => {
      const app = Fastify();
      try {
        await assert.rejects(
          listenServer(app, 0),
          /parent-retained inherited loopback listener/,
        );
      } finally {
        await app.close();
      }
    },
  );
});

test("desktop OAuth redirect uses the API's child-bound loopback port", () => {
  assert.equal(
    desktopOAuthRedirectUri({
      address: "127.0.0.1",
      family: "IPv4",
      port: 43123,
    }),
    "http://127.0.0.1:43123/integrations/google/callback",
  );
  assert.throws(
    () =>
      desktopOAuthRedirectUri({
        address: "0.0.0.0",
        family: "IPv4",
        port: 43123,
      }),
    /bound loopback TCP address/,
  );
});

test("desktop sidecar shuts down when its inherited parent-liveness pipe closes", async () => {
  const pipe = new PassThrough();
  let shutdowns = 0;
  const stop = watchParentLiveness(pipe, () => {
    shutdowns += 1;
  });
  try {
    pipe.end();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(shutdowns, 1);
  } finally {
    stop();
    pipe.destroy();
  }
});

test("sidecar shutdown exits on completion and has an independent deadline", async (t) => {
  const gracefulExits: number[] = [];
  closeServerWithDeadline(
    { close: async () => {} },
    (code) => gracefulExits.push(code),
    50,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(gracefulExits, [0]);

  const forcedExits: number[] = [];
  let idleSweeps = 0;
  const error = t.mock.method(console, "error", () => {});
  closeServerWithDeadline(
    {
      close: () => new Promise<void>(() => {}),
      server: {
        closeIdleConnections: () => {
          idleSweeps += 1;
        },
      },
    },
    (code) => forcedExits.push(code),
    20,
    5,
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(forcedExits, [1]);
  assert.ok(idleSweeps > 1);
  assert.match(
    String(error.mock.calls[0]?.arguments[0]),
    /graceful shutdown timed out/,
  );
});

test("desktop sidecar capability protects loopback routes and accepts only the exact token", async () => {
  const sidecarToken = "a".repeat(64);
  await withEnvAsync(
    {
      BRIDGE_SIDECAR_TOKEN: sidecarToken,
      SUPABASE_JWT_SECRET: undefined,
      SUPABASE_URL: undefined,
    },
    async () => {
      const app = await buildServer();
      try {
        const missing = await app.inject({ method: "GET", url: "/health" });
        assert.equal(missing.statusCode, 401);
        const invalid = await app.inject({
          method: "GET",
          url: "/health",
          headers: { "x-bridge-sidecar-token": "b".repeat(64) },
        });
        assert.equal(invalid.statusCode, 401);
        const valid = await app.inject({
          method: "GET",
          url: "/health",
          headers: { "x-bridge-sidecar-token": sidecarToken },
        });
        assert.equal(valid.statusCode, 200);
        const shutdown = await app.inject({
          method: "POST",
          url: "/internal/sidecar/shutdown",
          headers: { "x-bridge-sidecar-token": sidecarToken },
        });
        assert.equal(shutdown.statusCode, 202);
        assert.deepEqual(shutdown.json(), { stopping: true });
      } finally {
        await app.close();
      }
    },
  );
});

test("verify failure (bad bearer token) yields a clean 401, not a 500/unhandled rejection — even when the tRPC procedure itself needs no auth", async () => {
  await withEnvAsync(
    { SUPABASE_JWT_SECRET: "test_fixture_correct_secret", SUPABASE_URL: undefined },
    async () => {
      const app = await buildServer();
      try {
        const forged = await new SignJWT({ sub: "test_fixture_attacker" })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(new TextEncoder().encode("test_fixture_wrong_secret"));

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

test("SEC-1: an unauthenticated mutation is rejected with 401 under a configured verifier", async () => {
  // A verifier IS configured (SUPABASE_JWT_SECRET) but the request carries NO bearer
  // token. Pre-SEC-1 this silently resolved to the pilot identity and the mutation ran;
  // now `requireAuthOnMutation` must reject it before the resolver executes. The gate
  // fires ahead of input parsing, so an empty body still exercises exactly this path.
  await withEnvAsync(
    { SUPABASE_JWT_SECRET: "test_fixture_correct_secret", SUPABASE_URL: undefined },
    async () => {
      const app = await buildServer();
      try {
        const res = await app.inject({
          method: "POST",
          url: "/trpc/action.propose",
          headers: { "content-type": "application/json" },
          payload: {},
        });
        assert.equal(res.statusCode, 401);
        const body = res.json();
        assert.equal(body.error.code, -32001); // UNAUTHORIZED JSON-RPC code (tRPC)
      } finally {
        await app.close();
      }
    },
  );
});

test("SEC-1: a query is NOT gated by the mutation auth check (reads still open under a verifier)", async () => {
  // The gate is mutation-only. A tokenless GET to a query/health path under a configured
  // verifier must NOT be turned away by `requireAuthOnMutation` (it 200s; a bad *token*
  // is still rejected by identity resolution, covered by the test above).
  await withEnvAsync(
    { SUPABASE_JWT_SECRET: "test_fixture_correct_secret", SUPABASE_URL: undefined },
    async () => {
      const app = await buildServer();
      try {
        const res = await app.inject({ method: "GET", url: "/trpc/health" });
        assert.equal(res.statusCode, 200);
      } finally {
        await app.close();
      }
    },
  );
});

test("tRPC accepts POST-overridden queries so credentials stay out of request URLs", async () => {
  const app = await buildServer();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/trpc/health",
      headers: { "content-type": "application/json" },
      payload: { json: null },
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /"ok":true/);
  } finally {
    await app.close();
  }
});

test("SEC-2: a burst against a sensitive procedure trips the rate limiter (429)", async () => {
  // Tighten the sensitive cap to 3 so the burst is fast + deterministic. No verifier is
  // configured, so the auth gate lets these tokenless mutations through to tRPC (they
  // then fail input validation) — proving the 429s come from the LIMITER (onRequest),
  // not the auth gate. The sensitive bucket is counted independently of the global one.
  await withEnvAsync(
    {
      API_RATE_LIMIT_SENSITIVE_MAX: "3",
      API_RATE_LIMIT_MAX: "1000",
      SUPABASE_JWT_SECRET: undefined,
      SUPABASE_URL: undefined,
    },
    async () => {
      const app = await buildServer();
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 6; i++) {
          const res = await app.inject({
            method: "POST",
            url: "/trpc/action.propose",
            headers: { "content-type": "application/json" },
            payload: {},
          });

          statuses.push(res.statusCode);
        }
        assert.ok(!statuses.slice(0, 3).includes(429), `first 3 should be under the cap, got ${statuses}`);
        assert.ok(statuses.includes(429), `expected a 429 once the cap is exceeded, got ${statuses}`);
        assert.equal(statuses[statuses.length - 1], 429, `the 6th request should be limited, got ${statuses}`);
      } finally {
        await app.close();
      }
    },
  );
});

test("public Helpdesk create/read/reply paths use the tight sensitive rate bucket", () => {
  assert.equal(rateLimitBucket("/trpc/helpdesk.public.createTicket"), "sensitive");
  assert.equal(rateLimitBucket("/trpc/helpdesk.public.getThread?batch=1"), "sensitive");
  assert.equal(rateLimitBucket("/trpc/helpdesk.public.reply"), "sensitive");
});

test("governed Automation Runs use the tight sensitive rate bucket", () => {
  assert.equal(rateLimitBucket("/trpc/ritual.runById"), "sensitive");
  assert.equal(rateLimitBucket("/trpc/dealpilot.discoverDeals"), "sensitive");
  assert.equal(rateLimitBucket("/trpc/health"), "global");
});

test("SEC-2: rateLimitConfig honors env overrides and falls back to safe defaults", () => {
  withEnv({ API_RATE_LIMIT_MAX: undefined, API_RATE_LIMIT_SENSITIVE_MAX: undefined, API_RATE_LIMIT_WINDOW_MS: undefined }, () => {
    assert.deepEqual(rateLimitConfig(), { globalMax: 300, sensitiveMax: 10, windowMs: 60_000 });
  });
  withEnv({ API_RATE_LIMIT_MAX: "50", API_RATE_LIMIT_SENSITIVE_MAX: "5", API_RATE_LIMIT_WINDOW_MS: "1000" }, () => {
    assert.deepEqual(rateLimitConfig(), { globalMax: 50, sensitiveMax: 5, windowMs: 1000 });
  });
  // Garbage / non-positive values fall back rather than disabling the limiter.
  withEnv({ API_RATE_LIMIT_MAX: "0", API_RATE_LIMIT_SENSITIVE_MAX: "-4", API_RATE_LIMIT_WINDOW_MS: "abc" }, () => {
    assert.deepEqual(rateLimitConfig(), { globalMax: 300, sensitiveMax: 10, windowMs: 60_000 });
  });
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
