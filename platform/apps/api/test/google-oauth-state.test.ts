import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { appRouter } from "../src/router.js";
import { GoogleOAuthStateStore } from "../src/google-oauth-state.js";
import { registerGoogleOAuthRoutes } from "../src/google-oauth-routes.js";
import {
  buildWiring,
  PILOT_USER,
  PILOT_WORKSPACE,
} from "../src/wiring.js";
import { SeededRng, SystemClock, UuidGen } from "@bridge/core";

class TestStatePort {
  readonly rows = new Map<string, unknown>();

  async update<T>(
    workspaceId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => { state: unknown; result: T },
  ): Promise<T> {
    const key = JSON.stringify([workspaceId, namespace]);
    const current = structuredClone(this.rows.get(key) ?? initialState);
    const mutation = reduce(current);
    this.rows.set(key, structuredClone(mutation.state));
    return mutation.result;
  }
}

test("OAuth states are hashed at rest, single-use, bound, and expiring", async () => {
  let now = Date.parse("2026-07-18T00:00:00.000Z");
  const statePort = new TestStatePort();
  const states = new GoogleOAuthStateStore(statePort, () => now, 1_000);
  const raw = await states.issue(
    PILOT_WORKSPACE,
    `${PILOT_WORKSPACE}:google`,
    PILOT_USER,
  );

  assert.match(raw, /^oauth_[0-9a-f]{64}$/);
  assert.equal(JSON.stringify([...statePort.rows.values()]).includes(raw), false);
  assert.deepEqual(await states.consume(PILOT_WORKSPACE, raw), {
    integrationId: `${PILOT_WORKSPACE}:google`,
    actorId: PILOT_USER,
    expiresAt: "2026-07-18T00:00:01.000Z",
  });
  assert.equal(await states.consume(PILOT_WORKSPACE, raw), null);

  const expired = await states.issue(
    PILOT_WORKSPACE,
    `${PILOT_WORKSPACE}:google`,
    PILOT_USER,
  );
  now += 1_001;
  assert.equal(await states.consume(PILOT_WORKSPACE, expired), null);
});

test("Google connect issues an unpredictable state and callback rejects legacy predictable state", async () => {
  const priorId = process.env.GOOGLE_CLIENT_ID;
  const priorSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test_fixture_google_client";
  process.env.GOOGLE_CLIENT_SECRET = "test_fixture_google_secret";
  const wiring = await buildWiring();
  const app = Fastify();
  try {
    await registerGoogleOAuthRoutes(app, wiring);
    const clock = new SystemClock();
    const rng = new SeededRng(91);
    const caller = appRouter.createCaller({
      wiring,
      run: { clock, rng, ids: new UuidGen(clock, rng) },
      identity: { type: "user", id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });
    const result = await caller.google.connectUrl();
    assert.ok(result.url);
    const state = new URL(result.url).searchParams.get("state");
    assert.match(state ?? "", /^oauth_[0-9a-f]{64}$/);
    assert.notEqual(state, wiring.google.integrationId);

    const rejected = await app.inject({
      method: "GET",
      url: `/integrations/google/callback?code=attacker-code&state=${encodeURIComponent(wiring.google.integrationId)}`,
    });
    assert.equal(rejected.statusCode, 302);
    assert.match(rejected.headers.location ?? "", /error=invalid_oauth_state/);
  } finally {
    await app.close();
    await wiring.close();
    if (priorId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = priorSecret;
  }
});

test("desktop OAuth callbacks render a local completion page instead of redirecting to Vite", async () => {
  const priorId = process.env.GOOGLE_CLIENT_ID;
  const priorSecret = process.env.GOOGLE_CLIENT_SECRET;
  const priorDesktop = process.env.BRIDGE_OAUTH_DESKTOP;
  process.env.GOOGLE_CLIENT_ID = "test_fixture_google_client";
  process.env.GOOGLE_CLIENT_SECRET = "test_fixture_google_secret";
  process.env.BRIDGE_OAUTH_DESKTOP = "1";
  const wiring = await buildWiring();
  const app = Fastify();
  try {
    await registerGoogleOAuthRoutes(app, wiring);
    const response = await app.inject({
      method: "GET",
      url: "/integrations/google/callback",
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.headers.location, undefined);
    assert.match(
      response.headers["content-type"] ?? "",
      /^text\/html; charset=utf-8/,
    );
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.body, /Return to Bridge and try again/);
    assert.doesNotMatch(response.body, /localhost:5173/);
  } finally {
    await app.close();
    await wiring.close();
    if (priorId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = priorSecret;
    if (priorDesktop === undefined) delete process.env.BRIDGE_OAUTH_DESKTOP;
    else process.env.BRIDGE_OAUTH_DESKTOP = priorDesktop;
  }
});

test("OAuth callback rejects an actor whose workspace membership was revoked after issuance", async () => {
  const priorId = process.env.GOOGLE_CLIENT_ID;
  const priorSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test_fixture_google_client";
  process.env.GOOGLE_CLIENT_SECRET = "test_fixture_google_secret";
  const wiring = await buildWiring();
  const app = Fastify();
  try {
    await registerGoogleOAuthRoutes(app, wiring);
    const state = await wiring.googleOAuthStates.issue(
      PILOT_WORKSPACE,
      wiring.google.integrationId,
      PILOT_USER,
    );
    wiring.workspaceStore.isMember = async () => false;

    const response = await app.inject({
      method: "GET",
      url: `/integrations/google/callback?code=unexchanged-code&state=${encodeURIComponent(state)}`,
    });

    assert.equal(response.statusCode, 302);
    assert.match(
      response.headers.location ?? "",
      /error=oauth_actor_not_authorized/,
    );
    assert.equal(
      await wiring.googleOAuthStates.consume(PILOT_WORKSPACE, state),
      null,
    );
  } finally {
    await app.close();
    await wiring.close();
    if (priorId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = priorSecret;
  }
});

test("OAuth callback rechecks membership after code exchange and before token storage", async () => {
  const priorId = process.env.GOOGLE_CLIENT_ID;
  const priorSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_CLIENT_ID = "test_fixture_google_client";
  process.env.GOOGLE_CLIENT_SECRET = "test_fixture_google_secret";
  const wiring = await buildWiring();
  const app = Fastify();
  let membershipChecks = 0;
  let exchanged = false;
  try {
    await registerGoogleOAuthRoutes(app, wiring, async () => {
      exchanged = true;
      return {
        accessToken: "test_fixture_access_token",
        refreshToken: "test_fixture_refresh_token",
        scope: "test_fixture_scope",
        tokenType: "Bearer",
      };
    });
    const state = await wiring.googleOAuthStates.issue(
      PILOT_WORKSPACE,
      wiring.google.integrationId,
      PILOT_USER,
    );
    wiring.workspaceStore.isMember = async () => {
      membershipChecks += 1;
      return membershipChecks === 1;
    };

    const response = await app.inject({
      method: "GET",
      url: `/integrations/google/callback?code=exchangeable-code&state=${encodeURIComponent(state)}`,
    });

    assert.equal(exchanged, true);
    assert.equal(membershipChecks, 2);
    assert.equal(response.statusCode, 302);
    assert.match(
      response.headers.location ?? "",
      /error=oauth_actor_not_authorized/,
    );
    assert.equal((await wiring.google.connectionInfo()).connected, false);
  } finally {
    await app.close();
    await wiring.close();
    if (priorId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = priorId;
    if (priorSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = priorSecret;
  }
});
